import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:tls";
import test from "node:test";

import {
  fetchAttestationAgain,
  verifyGatewaySession,
} from "../src/session.js";
import {
  EXPORTER_LABEL,
  EXPORTER_LENGTH,
  GCP_ISSUER,
} from "../src/attestation.js";

const TEST_CERT = `-----BEGIN CERTIFICATE-----
MIIDJTCCAg2gAwIBAgIUd0m8ZtJrberG6+Xs71DQPZzrTG4wDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJbG9jYWxob3N0MB4XDTI2MDcwNTE5MDc1OVoXDTM2MDcw
MjE5MDc1OVowFDESMBAGA1UEAwwJbG9jYWxob3N0MIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEAh5lUGVA4611JPHsVBcu8h38KnZ1hZRs9bnyVk8RFzMNZ
ot9ox3EAobT64XrlK5pYjFOB+rq3ra9j+B0Mxt8Lbn3EYs+ClXO84eCb2IiVLucl
cjBDmW5v1xFq2a7Jpgpj7T0Kv+9YZ9GfJSZOM/mEyVMi2SX5tZbvbrVG17j9nBNj
vege+Y4g7qzzPy3Im0MwPFD6W5k8kMVZWykrWlOAdG5zLhkK5B3euk7Jle7ZsqMV
+wNoiO8l52QXGWwCi0M28KKTnFJgwgusoKcTk4/zGk1601vgioLpC3WkYagP615E
qt4d81YmLIROFqKW8xZHBXcroyAmH8eJdFJ4qZXGowIDAQABo28wbTAdBgNVHQ4E
FgQUdPfYUbJXAhkuZ6Qzz06WFa7GC/cwHwYDVR0jBBgwFoAUdPfYUbJXAhkuZ6Qz
z06WFa7GC/cwDwYDVR0TAQH/BAUwAwEB/zAaBgNVHREEEzARgglsb2NhbGhvc3SH
BH8AAAEwDQYJKoZIhvcNAQELBQADggEBAGYUY8t99O0rBWtd3YwTUC3MOHWZ9JQ5
ftBXpRuJTwFJ0Qn0JqlFrzFmya3BK4gJltupWsyFQwUDFQtDr3V3/WBd+U/OPFt7
kLREuv4e7aFhmsDInokAISeK5RhzjXaufdOr0H1rpv2FrLLnLsCOCPBczZu+MFjh
kMaYiX+JolgfCYCqyvH7RqOE+3k1PDiKjV2kEp6g8aHjlzZcJ8PWKIIec+C6si7/
976AeshUJ+lUZ9QEmh4r3S74/jrVWPqACBIuTaqnMnIHn4aUspwO1MvlFcOYwZLE
ZmPxs0UxhI9CBJZCZ+Oh0NOCJTHAkjIZzb9sacrgVA6uB3l0my++H6g=
-----END CERTIFICATE-----`;

const TEST_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQCHmVQZUDjrXUk8
exUFy7yHfwqdnWFlGz1ufJWTxEXMw1mi32jHcQChtPrheuUrmliMU4H6uretr2P4
HQzG3wtufcRiz4KVc7zh4JvYiJUu5yVyMEOZbm/XEWrZrsmmCmPtPQq/71hn0Z8l
Jk4z+YTJUyLZJfm1lu9utUbXuP2cE2O96B75jiDurPM/LcibQzA8UPpbmTyQxVlb
KStaU4B0bnMuGQrkHd66TsmV7tmyoxX7A2iI7yXnZBcZbAKLQzbwopOcUmDCC6yg
pxOTj/MaTXrTW+CKgukLdaRhqA/rXkSq3h3zViYshE4WopbzFkcFdyujICYfx4l0
UniplcajAgMBAAECggEAFWKip01bdLnlI3iROQqdL0y4wAvX65SvYb3x7yM3aOhE
OjzRbxGM1R6lqdWdJVJ1yvJz9OGUDKc1H9EhDeTpDiIf91THwPScYjlEtZKGM1FO
urgO6TidbdtNhorw5X1iWMIq8FikkNcNVNQPkFXhUckJSBrw9hPEVimZGcuPP8PP
oeoiGMKSfU2onFUbrULfoXvcOghMwpl6C/+zmOcyGfkNN1qLVI/RED4IkOfwptg7
KHsYXvDkUGqc4ONIF4OAZETw38RL6/wf2cmX2o61KISHMJcF26c9vsgWnrVTpSNH
RSXeLOr6lRal4YMM4jl10Rci6HeWjFTkIpSy99hRdQKBgQC96Qk3n8Qg3PFAgBID
oxiqCjOSvWlrhsjn6CTTx0HE1exddb+Y0Zx6Hg2V4IqxWFCdSMX1XOea8VUx6TD6
lqiI3DYhUffy1pvhvTS7PQpcSlcI9GxC7VxKdHMd9EAo2tktT4JMyQXkmp0Yn3v1
EUsZNXiaCjIbk3loz8/35Q2V/wKBgQC2ybwmRulYtJJ7YJ7hMR6NK+ou2yHl2Mc4
jq1ImoikCjAwL/HIME5jV3NKy0UI8qycc8B5JPSs7m5veCDzXrNcFx+VQgwraPs+
5pkFcG+krU2frTzKYdUq6u28EWSww+fNlR1cMtm/oENUr5hf6MLzZTpleGN+6kol
EH63ZJO3XQKBgFvPRCB7AXMtvQgEojDV8T+LLQGcxlEwWQIcLWmgo8AH93v7R8QW
WcKDsuepJQO1gUt4ehMzddhnIVu+s2oB2bpIU3bqTKc+bx/Du7FlQhP58HeoyonU
fFCWWWy6vyXBH0sTbBe4+ztYL+hOebuxP5ARVJuLoEvKkOBFzvG170p7AoGAP5Di
XJFWfuG0+zD7r6aMUF3QP+E25Z7AkVuUyWXsVNeyMF/L/mlGKWf1ETKlXFpAStw6
OCbw696zCxLEqr3pNAJammZwovwMO7Cn0Gtsd+FI2Fm/hUYGgrlWWYvW714Bk83i
evi4HtrV73JtVBU3DrvKVhVKzI0focodtxtD/4UCgYBVmrG6wVtFE5dLQF6X2zfe
2VVM8pV0WwnCLDf5RfdcG3xf7NhVK17ZY71LnerWif1YvsJZOfa5oFTjbKJF5qPD
eWIuA8l6LReDEKSlbFXhjTi4ZuV3kMf5/thIRmB/pGjRAm1WgYiFQHCbIVRMk1MF
WUF1Qs6oAfcdk8qq7d3f6w==
-----END PRIVATE KEY-----`;

const enc = (s) => new TextEncoder().encode(s);

function b64url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

function bytesToHex(bytes) {
  return Buffer.from(bytes).toString("hex");
}

function pemToDer(pem) {
  const body = pem
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");
  return Buffer.from(body, "base64");
}

async function genKeypair() {
  return crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
}

async function publicJwk(keyPair, kid = "session-test-kid") {
  const jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  return { ...jwk, kid, alg: "RS256" };
}

async function makeJwt(keyPair, claims, { kid = "session-test-kid" } = {}) {
  const header = { alg: "RS256", typ: "JWT", kid };
  const h = b64url(enc(JSON.stringify(header)));
  const p = b64url(enc(JSON.stringify(claims)));
  const signingInput = enc(`${h}.${p}`);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keyPair.privateKey, signingInput);
  return enc(`${h}.${p}.${b64url(sig)}`);
}

function listen(server) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      server.off("listening", onListening);
      server.off("error", onError);
    };
    const onListening = () => {
      cleanup();
      resolve();
    };
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    server.once("listening", onListening);
    server.once("error", onError);
    server.listen(0, "127.0.0.1");
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function parseNonce(requestHead) {
  const [requestLine] = requestHead.split("\r\n");
  const [, target] = requestLine.split(" ");
  const url = new URL(target, "https://localhost");
  return url.searchParams.get("nonce");
}

async function makeAttestationBody(keyPair, {
  certSha,
  exporter,
  nonce,
  audience = "quill-cloud",
  imageDigest = "sha256:loopback",
  imageReference = "localhost/test:session",
}) {
  const claims = {
    iss: GCP_ISSUER,
    aud: [audience],
    exp: Math.floor(Date.now() / 1000) + 600,
    submods: {
      container: {
        image_digest: imageDigest,
        image_reference: imageReference,
      },
    },
    tls_cert_sha256: certSha,
    eat_nonce: [certSha, bytesToHex(exporter), nonce],
  };
  return Buffer.from(await makeJwt(keyPair, claims));
}

function readExactly(socket, byteLength, timeoutMs = 5_000) {
  if (byteLength === 0) return Promise.resolve(Buffer.alloc(0));
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("timeout", onTimeout);
      socket.setTimeout(0);
    };
    const finish = (err, bytes = null, rest = Buffer.alloc(0)) => {
      cleanup();
      socket.pause();
      if (rest.length > 0) socket.unshift(rest);
      if (err) reject(err);
      else resolve(bytes);
    };
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < byteLength) return;
      finish(
        null,
        buffer.subarray(0, byteLength),
        buffer.subarray(byteLength),
      );
    };
    const onError = (err) => finish(err);
    const onTimeout = () => finish(new Error("timed out reading pinned socket"));
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("timeout", onTimeout);
    socket.setTimeout(timeoutMs);
    socket.resume();
  });
}

test("verifyGatewaySession rejects an untrusted TLS certificate even when Node TLS verification is disabled globally", async () => {
  const certDer = pemToDer(TEST_CERT);
  const certSha = createHash("sha256").update(certDer).digest("hex");
  const keyPair = await genKeypair();
  const jwks = { keys: [await publicJwk(keyPair)] };
  const serverErrors = [];
  const sockets = new Set();
  const policy = {
    audience: "quill-cloud",
    imageDigest: "sha256:loopback",
    imageReference: "localhost/test:session",
  };

  const server = createServer({
    key: TEST_KEY,
    cert: TEST_CERT,
    minVersion: "TLSv1.3",
    maxVersion: "TLSv1.3",
    ALPNProtocols: ["http/1.1"],
  }, (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let buffer = Buffer.alloc(0);
    let handling = Promise.resolve();

    const drain = async () => {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const requestHead = buffer.subarray(0, headerEnd).toString("latin1");
      buffer = buffer.subarray(headerEnd + 4);
      const nonce = parseNonce(requestHead);
      const exporter = socket.exportKeyingMaterial(EXPORTER_LENGTH, EXPORTER_LABEL);
      const body = await makeAttestationBody(keyPair, {
        certSha,
        exporter,
        nonce,
      });
      socket.write(
        Buffer.concat([
          Buffer.from(
            `HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\nConnection: keep-alive\r\n\r\n`,
            "ascii",
          ),
          body,
        ]),
      );
    };

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      handling = handling.then(drain).catch((err) => {
        serverErrors.push(err);
        socket.destroy(err);
      });
    });
  });

  await listen(server);
  const port = server.address().port;
  const previousRejectUnauthorized = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  try {
    await assert.rejects(
      () => verifyGatewaySession({
        baseUrl: `https://localhost:${port}/v1`,
        policy,
        jwks,
        connectIp: "127.0.0.1",
        timeoutMs: 5_000,
      }),
      (err) => {
        assert.match(err.message, /self-signed certificate|certificate verification/i);
        return true;
      },
    );
    assert.deepEqual(serverErrors, []);
  } finally {
    if (previousRejectUnauthorized === undefined) {
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    } else {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousRejectUnauthorized;
    }
    for (const socket of sockets) socket.destroy();
    await close(server);
  }
});

test("verifyGatewaySession rejects a socket that EOFs after a complete attestation response", async () => {
  const certDer = pemToDer(TEST_CERT);
  const certSha = createHash("sha256").update(certDer).digest("hex");
  const keyPair = await genKeypair();
  const jwks = { keys: [await publicJwk(keyPair)] };
  const serverErrors = [];
  const sockets = new Set();
  const policy = {
    audience: "quill-cloud",
    imageDigest: "sha256:loopback",
    imageReference: "localhost/test:session",
  };

  const server = createServer({
    key: TEST_KEY,
    cert: TEST_CERT,
    minVersion: "TLSv1.3",
    maxVersion: "TLSv1.3",
    ALPNProtocols: ["http/1.1"],
  }, (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let buffer = Buffer.alloc(0);
    let handling = Promise.resolve();

    const drain = async () => {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const requestHead = buffer.subarray(0, headerEnd).toString("latin1");
      buffer = buffer.subarray(headerEnd + 4);
      const nonce = parseNonce(requestHead);
      const exporter = socket.exportKeyingMaterial(EXPORTER_LENGTH, EXPORTER_LABEL);
      const body = await makeAttestationBody(keyPair, {
        certSha,
        exporter,
        nonce,
      });
      socket.end(
        Buffer.concat([
          Buffer.from(
            `HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\n\r\n`,
            "ascii",
          ),
          body,
        ]),
      );
    };

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      handling = handling.then(drain).catch((err) => {
        serverErrors.push(err);
        socket.destroy(err);
      });
    });
  });

  await listen(server);
  const port = server.address().port;
  try {
    await assert.rejects(
      () => verifyGatewaySession({
        baseUrl: `https://localhost:${port}/v1`,
        policy,
        jwks,
        connectIp: "127.0.0.1",
        ca: TEST_CERT,
        timeoutMs: 5_000,
      }),
      {
        name: "AttestationVerificationError",
        message: "attestation response unpinnable: TLS socket ended or closed",
      },
    );
    assert.deepEqual(serverErrors, []);
  } finally {
    for (const socket of sockets) socket.destroy();
    await close(server);
  }
});

test("verifyGatewaySession binds attestation to the live TLS exporter", async () => {
  const certDer = pemToDer(TEST_CERT);
  const certSha = createHash("sha256").update(certDer).digest("hex");
  const keyPair = await genKeypair();
  const jwks = { keys: [await publicJwk(keyPair)] };
  const serverExporters = [];
  const serverErrors = [];
  const sockets = new Set();
  const policy = {
    audience: "quill-cloud",
    imageDigest: "sha256:loopback",
    imageReference: "localhost/test:session",
  };

  const server = createServer({
    key: TEST_KEY,
    cert: TEST_CERT,
    minVersion: "TLSv1.3",
    maxVersion: "TLSv1.3",
    ALPNProtocols: ["http/1.1"],
  }, (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let buffer = Buffer.alloc(0);
    let handling = Promise.resolve();

    const drain = async () => {
      while (true) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) return;
        const requestHead = buffer.subarray(0, headerEnd).toString("latin1");
        buffer = buffer.subarray(headerEnd + 4);
        const nonce = parseNonce(requestHead);
        const exporter = socket.exportKeyingMaterial(EXPORTER_LENGTH, EXPORTER_LABEL);
        serverExporters.push(Buffer.from(exporter));
        const claims = {
          iss: GCP_ISSUER,
          aud: ["quill-cloud"],
          exp: Math.floor(Date.now() / 1000) + 600,
          submods: {
            container: {
              image_digest: "sha256:loopback",
              image_reference: "localhost/test:session",
            },
          },
          tls_cert_sha256: certSha,
          eat_nonce: [certSha, bytesToHex(exporter), nonce],
        };
        const body = Buffer.from(await makeJwt(keyPair, claims));
        socket.write(
          `HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\nConnection: keep-alive\r\n\r\n`,
        );
        socket.write(body);
      }
    };

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      handling = handling.then(drain).catch((err) => {
        serverErrors.push(err);
        socket.destroy(err);
      });
    });
  });

  await listen(server);
  const port = server.address().port;
  let sessionA = null;
  let sessionB = null;
  try {
    sessionA = await verifyGatewaySession({
      baseUrl: `https://localhost:${port}/v1`,
      policy,
      jwks,
      connectIp: "127.0.0.1",
      ca: TEST_CERT,
      timeoutMs: 5_000,
    });
    assert.equal(bytesToHex(sessionA.exporter), bytesToHex(serverExporters[0]));
    assert.equal(sessionA.attestation.certSha256, certSha);
    assert.equal(sessionA.attestation.nonce.length, EXPORTER_LENGTH * 2);

    const secondJwt = await fetchAttestationAgain(sessionA);
    assert.ok(secondJwt.length > 0);
    assert.equal(bytesToHex(sessionA.exporter), bytesToHex(serverExporters[1]));

    sessionB = await verifyGatewaySession({
      baseUrl: `https://localhost:${port}/v1`,
      policy,
      jwks,
      connectIp: "127.0.0.1",
      ca: TEST_CERT,
      timeoutMs: 5_000,
    });
    assert.notEqual(bytesToHex(sessionA.exporter), bytesToHex(sessionB.exporter));
    assert.notEqual(bytesToHex(serverExporters[0]), bytesToHex(serverExporters[2]));
    assert.deepEqual(serverErrors, []);
  } finally {
    sessionA?.socket.destroy();
    sessionB?.socket.destroy();
    for (const socket of sockets) socket.destroy();
    await close(server);
  }
});

test("verifyGatewaySession preserves bytes after attestation Content-Length", async () => {
  const certDer = pemToDer(TEST_CERT);
  const certSha = createHash("sha256").update(certDer).digest("hex");
  const keyPair = await genKeypair();
  const jwks = { keys: [await publicJwk(keyPair)] };
  const serverErrors = [];
  const sockets = new Set();
  const extra = Buffer.from("bytes-after-attestation-body");
  const policy = {
    audience: "quill-cloud",
    imageDigest: "sha256:loopback",
    imageReference: "localhost/test:session",
  };

  const server = createServer({
    key: TEST_KEY,
    cert: TEST_CERT,
    minVersion: "TLSv1.3",
    maxVersion: "TLSv1.3",
    ALPNProtocols: ["http/1.1"],
  }, (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let buffer = Buffer.alloc(0);
    let handling = Promise.resolve();

    const drain = async () => {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const requestHead = buffer.subarray(0, headerEnd).toString("latin1");
      buffer = buffer.subarray(headerEnd + 4);
      const nonce = parseNonce(requestHead);
      const exporter = socket.exportKeyingMaterial(EXPORTER_LENGTH, EXPORTER_LABEL);
      const body = await makeAttestationBody(keyPair, {
        certSha,
        exporter,
        nonce,
      });
      const head = Buffer.from(
        `HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\nConnection: keep-alive\r\n\r\n`,
        "ascii",
      );
      socket.write(Buffer.concat([head, body, extra]));
    };

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      handling = handling.then(drain).catch((err) => {
        serverErrors.push(err);
        socket.destroy(err);
      });
    });
  });

  await listen(server);
  const port = server.address().port;
  let session = null;
  try {
    session = await verifyGatewaySession({
      baseUrl: `https://localhost:${port}/v1`,
      policy,
      jwks,
      connectIp: "127.0.0.1",
      ca: TEST_CERT,
      timeoutMs: 5_000,
    });
    assert.equal(
      (await readExactly(session.socket, extra.length)).toString("latin1"),
      extra.toString("latin1"),
    );
    assert.deepEqual(serverErrors, []);
  } finally {
    session?.socket.destroy();
    for (const socket of sockets) socket.destroy();
    await close(server);
  }
});

test("verifyGatewaySession rejects Connection close attestation responses", async () => {
  const certDer = pemToDer(TEST_CERT);
  const certSha = createHash("sha256").update(certDer).digest("hex");
  const keyPair = await genKeypair();
  const jwks = { keys: [await publicJwk(keyPair)] };
  const serverErrors = [];
  const sockets = new Set();
  let sawServerSocketClose = false;
  let resolveServerSocketClosed;
  const serverSocketClosed = new Promise((resolve) => {
    resolveServerSocketClosed = resolve;
  });
  const policy = {
    audience: "quill-cloud",
    imageDigest: "sha256:loopback",
    imageReference: "localhost/test:session",
  };

  const server = createServer({
    key: TEST_KEY,
    cert: TEST_CERT,
    minVersion: "TLSv1.3",
    maxVersion: "TLSv1.3",
    ALPNProtocols: ["http/1.1"],
  }, (socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sawServerSocketClose = true;
      sockets.delete(socket);
      resolveServerSocketClosed();
    });
    let buffer = Buffer.alloc(0);
    let handling = Promise.resolve();

    const drain = async () => {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const requestHead = buffer.subarray(0, headerEnd).toString("latin1");
      buffer = buffer.subarray(headerEnd + 4);
      const nonce = parseNonce(requestHead);
      const exporter = socket.exportKeyingMaterial(EXPORTER_LENGTH, EXPORTER_LABEL);
      const body = await makeAttestationBody(keyPair, {
        certSha,
        exporter,
        nonce,
      });
      socket.write(
        Buffer.concat([
          Buffer.from(
            `HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`,
            "ascii",
          ),
          body,
        ]),
      );
    };

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      handling = handling.then(drain).catch((err) => {
        serverErrors.push(err);
        socket.destroy(err);
      });
    });
  });

  await listen(server);
  const port = server.address().port;
  try {
    await assert.rejects(
      () => verifyGatewaySession({
        baseUrl: `https://localhost:${port}/v1`,
        policy,
        jwks,
        connectIp: "127.0.0.1",
        ca: TEST_CERT,
        timeoutMs: 5_000,
      }),
      {
        name: "AttestationVerificationError",
        message: "attestation response unpinnable: server sent Connection: close",
      },
    );
    await serverSocketClosed;
    assert.equal(sawServerSocketClose, true);
    assert.deepEqual(serverErrors, []);
  } finally {
    for (const socket of sockets) socket.destroy();
    await close(server);
  }
});
