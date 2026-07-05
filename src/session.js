import {
  AttestationVerificationError,
  EXPORTER_LABEL,
  EXPORTER_LENGTH,
  GCP_JWKS_URI,
  verifyGatewayAttestation,
} from "./attestation.js";

const sessionMeta = new WeakMap();
let nodeRuntime = null;

/**
 * Open a TLS 1.3 session, bind `/attestation` to that same session's RFC 9266
 * exporter, verify the fresh nonce + exporter closure, and return the live
 * pinned socket. The caller owns the returned socket and must destroy it.
 */
export async function verifyGatewaySession({
  baseUrl,
  policy,
  jwks = null,
  jwksUrl = GCP_JWKS_URI,
  connectIp = null,
  timeoutMs = 15_000,
  ca = null,
} = {}) {
  if (!policy) {
    throw new AttestationVerificationError("policy is required");
  }
  const { randomBytes, tlsConnect } = await loadNodeRuntime();
  const meta = parseGatewayUrl(baseUrl);
  const socket = tlsConnect({
    host: connectIp || meta.host,
    port: meta.port,
    servername: meta.host,
    minVersion: "TLSv1.3",
    ALPNProtocols: ["http/1.1"],
    rejectUnauthorized: true,
    ...(ca === null ? {} : { ca }),
  });
  const socketState = watchSocketState(socket);

  let keepSocket = false;
  try {
    await waitForSecureConnect(socket, timeoutMs);
    assertTlsAuthorized(socket);
    const exporter = socket.exportKeyingMaterial(EXPORTER_LENGTH, EXPORTER_LABEL);
    const peer = socket.getPeerCertificate(true);
    if (!peer?.raw) {
      throw new AttestationVerificationError("TLS peer certificate missing raw DER");
    }
    const leafDer = new Uint8Array(peer.raw);
    const nonceHex = randomBytes(EXPORTER_LENGTH).toString("hex");
    const document = await fetchAttestationDocument(socket, {
      ...meta,
      nonceHex,
      timeoutMs,
    });
    const attestation = await verifyGatewayAttestation(document, {
      policy,
      nonceHex,
      tlsCertDer: leafDer,
      tlsExporter: exporter,
      jwks,
      jwksUrl,
    });
    await assertSocketPinnable(socket, socketState);
    const session = { attestation, socket, exporter, leafDer };
    sessionMeta.set(session, { ...meta, timeoutMs });
    keepSocket = true;
    return session;
  } finally {
    socketState.cleanup();
    if (!keepSocket) socket.destroy();
  }
}

/**
 * Fetch `/attestation` again over the same pinned TLS socket. This demonstrates
 * that follow-up traffic is still on the verified G6 exporter-bound session.
 */
export async function fetchAttestationAgain(session, {
  nonceHex = null,
} = {}) {
  const { randomBytes } = await loadNodeRuntime();
  if (nonceHex === null) nonceHex = randomBytes(EXPORTER_LENGTH).toString("hex");
  const meta = sessionMeta.get(session);
  if (!meta) {
    throw new AttestationVerificationError(
      "session was not created by verifyGatewaySession",
    );
  }
  return await fetchAttestationDocument(session.socket, {
    ...meta,
    nonceHex,
  });
}

async function loadNodeRuntime() {
  if (nodeRuntime === null) {
    const [{ randomBytes }, { connect }] = await Promise.all([
      import("node:crypto"),
      import("node:tls"),
    ]);
    nodeRuntime = { randomBytes, tlsConnect: connect };
  }
  return nodeRuntime;
}

function parseGatewayUrl(baseUrl) {
  if (!baseUrl) {
    throw new AttestationVerificationError("baseUrl is required");
  }
  let url;
  try {
    url = new URL(baseUrl);
  } catch (err) {
    throw new AttestationVerificationError(`invalid baseUrl: ${err.message}`);
  }
  if (url.protocol !== "https:") {
    throw new AttestationVerificationError("baseUrl must use https");
  }
  const host = url.hostname;
  const port = url.port ? Number(url.port) : 443;
  if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) {
    throw new AttestationVerificationError(`invalid TLS port ${JSON.stringify(url.port)}`);
  }
  let rootPath = url.pathname.replace(/\/+$/, "");
  if (rootPath.endsWith("/v1")) rootPath = rootPath.slice(0, -3);
  const attestationPath = `${rootPath || ""}/attestation`;
  return {
    host,
    port,
    hostHeader: url.port ? `${host}:${port}` : host,
    attestationPath,
  };
}

function assertTlsAuthorized(socket) {
  if (socket.authorized === true) return;
  const reason = socket.authorizationError
    ? `: ${socket.authorizationError}`
    : "";
  throw new AttestationVerificationError(
    `TLS certificate verification failed${reason}`,
  );
}

function watchSocketState(socket) {
  const state = { ended: false, closed: false };
  const onEnd = () => {
    state.ended = true;
  };
  const onClose = () => {
    state.closed = true;
  };
  socket.once("end", onEnd);
  socket.once("close", onClose);
  return {
    get ended() {
      return state.ended;
    },
    get closed() {
      return state.closed;
    },
    cleanup() {
      socket.off("end", onEnd);
      socket.off("close", onClose);
    },
  };
}

async function assertSocketPinnable(socket, state) {
  await new Promise((resolve) => setImmediate(resolve));
  if (
    state.ended ||
    state.closed ||
    socket.destroyed ||
    socket.closed === true ||
    socket.readableEnded === true ||
    socket.writable === false ||
    socket.writableEnded === true ||
    socket.writableDestroyed === true
  ) {
    throw new AttestationVerificationError(
      "attestation response unpinnable: TLS socket ended or closed",
    );
  }
}

function waitForSecureConnect(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.off("secureConnect", onSecureConnect);
      socket.off("error", onError);
      socket.off("timeout", onTimeout);
      socket.setTimeout(0);
    };
    const finish = (err) => {
      cleanup();
      if (err) reject(err);
      else resolve();
    };
    const onSecureConnect = () => finish(null);
    const onError = (err) => finish(err);
    const onTimeout = () => {
      finish(new AttestationVerificationError("TLS connection timed out"));
    };
    socket.once("secureConnect", onSecureConnect);
    socket.once("error", onError);
    socket.once("timeout", onTimeout);
    socket.setTimeout(timeoutMs);
  });
}

async function fetchAttestationDocument(socket, {
  hostHeader,
  attestationPath,
  nonceHex,
  timeoutMs,
}) {
  const path = `${attestationPath}?nonce=${encodeURIComponent(nonceHex)}`;
  const request = [
    `GET ${path} HTTP/1.1`,
    `Host: ${hostHeader}`,
    "Connection: keep-alive",
    "",
    "",
  ].join("\r\n");
  await writeRequest(socket, request, timeoutMs);
  const response = await readHttpResponse(socket, timeoutMs);
  if (response.statusCode !== 200) {
    throw new AttestationVerificationError(
      `attestation endpoint returned HTTP ${response.statusCode}`,
    );
  }
  return response.body;
}

function writeRequest(socket, request, timeoutMs) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.off("error", onError);
      socket.off("timeout", onTimeout);
      socket.setTimeout(0);
    };
    const finish = (err) => {
      cleanup();
      if (err) reject(err);
      else resolve();
    };
    const onError = (err) => finish(err);
    const onTimeout = () => {
      finish(new AttestationVerificationError("attestation request timed out"));
    };
    socket.once("error", onError);
    socket.once("timeout", onTimeout);
    socket.setTimeout(timeoutMs);
    socket.write(request, "ascii", () => finish(null));
  });
}

function readHttpResponse(socket, timeoutMs) {
  let buffer = Buffer.alloc(0);

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("end", onEnd);
      socket.off("timeout", onTimeout);
      socket.setTimeout(0);
    };
    const finish = (err, response = null, rest = null) => {
      cleanup();
      if (err) {
        reject(err);
      } else {
        socket.pause();
        if (rest.length > 0) socket.unshift(rest);
        resolve(response);
      }
    };
    const tryParse = () => {
      let result;
      try {
        result = parseHttpResponse(buffer);
      } catch (err) {
        finish(err);
        return;
      }
      if (result) finish(null, result.response, result.rest);
    };
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      tryParse();
    };
    const onError = (err) => finish(err);
    const onEnd = () => {
      finish(new AttestationVerificationError("TLS socket ended before HTTP response"));
    };
    const onTimeout = () => {
      finish(new AttestationVerificationError("attestation response timed out"));
    };
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("end", onEnd);
    socket.once("timeout", onTimeout);
    socket.setTimeout(timeoutMs);
    socket.resume();
  });
}

function parseHttpResponse(buffer) {
  const headerEnd = buffer.indexOf("\r\n\r\n");
  if (headerEnd === -1) return null;
  const head = buffer.subarray(0, headerEnd).toString("latin1");
  const lines = head.split("\r\n");
  const statusMatch = /^HTTP\/1\.([01]) ([0-9]{3})(?: .*)?$/.exec(lines[0] || "");
  if (!statusMatch) {
    throw new AttestationVerificationError("invalid HTTP status line from attestation endpoint");
  }
  const httpMinor = statusMatch[1];
  const statusCode = Number(statusMatch[2]);
  const headers = new Map();
  for (const line of lines.slice(1)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const name = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    headers.set(name, headers.has(name) ? `${headers.get(name)}, ${value}` : value);
  }
  const connectionTokens = new Set(
    (headers.get("connection") || "")
      .split(",")
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean),
  );
  if (
    connectionTokens.has("close") ||
    (httpMinor === "0" && !connectionTokens.has("keep-alive"))
  ) {
    throw new AttestationVerificationError(
      "attestation response unpinnable: server sent Connection: close",
    );
  }
  if (headers.has("transfer-encoding")) {
    throw new AttestationVerificationError(
      "attestation endpoint must return Content-Length, not transfer-encoding",
    );
  }
  const lengthRaw = headers.get("content-length");
  if (lengthRaw === undefined) {
    throw new AttestationVerificationError(
      "attestation endpoint response missing Content-Length",
    );
  }
  const contentLength = Number(lengthRaw);
  if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
    throw new AttestationVerificationError("invalid attestation Content-Length");
  }
  const bodyStart = headerEnd + 4;
  const bodyEnd = bodyStart + contentLength;
  if (buffer.length < bodyEnd) return null;
  return {
    response: {
      statusCode,
      headers,
      body: buffer.subarray(bodyStart, bodyEnd),
    },
    rest: buffer.subarray(bodyEnd),
  };
}
