import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  MissingAttestationError,
  ReceiptCapture,
  ReceiptHashError,
  ReceiptHeaderError,
  ReceiptNonceError,
  ReceiptSignatureError,
  ReceiptStructureError,
  ReceiptTimeError,
  ReceiptUpstreamError,
  UnsupportedAttestationError,
  verifyReceipt,
} from "../src/receipts.js";
import { receiptVerificationDependencies } from "../src/internal/receipt-dependencies.js";

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}

const NOW = 1_756_223_999;
const fixtureRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "receipts",
);
const enc = (value) => new TextEncoder().encode(value);

function b64url(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeB64url(value) {
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function digest(value) {
  return b64url(await crypto.subtle.digest("SHA-256", value));
}

async function keypair() {
  return crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
}

async function baseClaims({ responseOf = "body", responseHash = null } = {}) {
  const response = {
    alg: "sha256",
    hash: responseHash ?? await digest(enc("response")),
    of: responseOf,
  };
  if (responseOf !== "body") response.events = 1;
  return {
    rv: 1,
    iss: "https://api.trustedrouter.com",
    iat: NOW,
    jti: "chatcmpl-test",
    gen: "gen-test",
    nonce: "nonce_test",
    route: "chat.completions",
    req: { alg: "sha256", hash: await digest(enc("request")), of: "body" },
    resp: response,
    model: {
      requested: "requested",
      selected: "selected",
      provider: "provider",
      endpoint: "endpoint",
    },
    upstream: {
      tier: "tee-verified",
      policy: "chutes-tdx-nvidia-e2e-v1",
      verified_at: NOW - 60,
      verification_expires_at: NOW + 240,
    },
    att_sha256: await digest(enc("attestation")),
  };
}

async function signReceipt(claims, {
  key = null,
  flattened = false,
  headerUpdates = {},
  signingKey = null,
  payloadText = null,
  serializeHeader = JSON.stringify,
} = {}) {
  key ??= await keypair();
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", key.publicKey));
  const header = {
    alg: "EdDSA",
    typ: "inference-receipt+jws",
    kid: await digest(publicRaw),
    jwk: { kty: "OKP", crv: "Ed25519", x: b64url(publicRaw) },
    ...(flattened ? { att: "fake.jwt.token", att_kind: "gcp-cs-jwt" } : {}),
    ...headerUpdates,
  };
  const protectedSegment = b64url(enc(serializeHeader(header)));
  const payloadSegment = b64url(enc(payloadText ?? JSON.stringify(claims)));
  const signature = await crypto.subtle.sign(
    "Ed25519",
    (signingKey ?? key).privateKey,
    enc(`${protectedSegment}.${payloadSegment}`),
  );
  const flattenedValue = {
    protected: protectedSegment,
    payload: payloadSegment,
    signature: b64url(signature),
  };
  return {
    receipt: flattened
      ? flattenedValue
      : `${flattenedValue.protected}.${flattenedValue.payload}.${flattenedValue.signature}`,
    key,
  };
}

function receiptEvent(receipt) {
  return enc(`data: ${JSON.stringify({
    id: "chatcmpl-test",
    object: "chat.completion.chunk",
    choices: [],
    inference_receipt: receipt,
  })}\n\n`);
}

function join(...values) {
  const size = values.reduce((sum, value) => sum + value.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.length;
  }
  return result;
}

async function streamReceipt({ events = 1 } = {}) {
  const payload = enc('{"choices":[{"delta":{"content":"hello"}}]}');
  const claims = await baseClaims({
    responseOf: "sse-data-v1",
    responseHash: await digest(join(payload, enc("\n"))),
  });
  delete claims.att_sha256;
  claims.resp.events = events;
  const { receipt } = await signReceipt(claims, { flattened: true });
  return {
    receipt,
    stream: join(enc("data: "), payload, enc("\n\n"), receiptEvent(receipt), enc("data: [DONE]\n\n")),
  };
}

// Frozen vectors carry placeholder evidence; mirror the Python fixture suite's
// monkeypatch while still exercising the exact signed JWS and wire bytes.
receiptVerificationDependencies.policyFromTrustRelease = async () => ({});
receiptVerificationDependencies.verifyGatewayAttestation = async () => ({});

for (const name of ["compact-body", "chat-stream", "responses-stream"]) {
  test(`frozen receipt fixture verifies: ${name}`, async () => {
    const directory = path.join(fixtureRoot, name);
    const metadata = JSON.parse(await readFile(path.join(directory, "metadata.json"), "utf8"));
    const options = {
      expectedNonce: metadata.expected_nonce,
      requireAttestation: metadata.require_attestation,
      now: metadata.now,
      requestBody: await readFile(path.join(directory, "request.body")),
    };
    if (name === "compact-body") {
      options.responseBody = await readFile(path.join(directory, "response.body"));
    } else {
      options.responseStream = await readFile(path.join(directory, "response.sse"));
    }
    const verified = await verifyReceipt(
      await readFile(path.join(directory, "receipt.jws")),
      options,
    );
    assert.equal(verified.rv, 1);
  });
}

test("compact receipt verifies exact request and response bodies", async () => {
  const { receipt } = await signReceipt(await baseClaims());
  const verified = await verifyReceipt(receipt, {
    requestBody: enc("request"),
    responseBody: enc("response"),
    expectedNonce: "nonce_test",
    maxAgeSeconds: 10,
    now: NOW,
    requireAttestation: false,
  });
  assert.equal(verified.model.provider, "provider");
  assert.equal(verified.attestationStatus, "unverified_by_this_sdk");
  assert.equal(verified.attestation, verified.attestationStatus);
});

test("flipped payload byte fails signature verification", async () => {
  const { receipt } = await signReceipt(await baseClaims());
  const [protectedSegment, payloadSegment, signature] = receipt.split(".");
  const payload = decodeB64url(payloadSegment);
  payload[payload.length - 2] ^= 1;
  await assert.rejects(
    verifyReceipt(`${protectedSegment}.${b64url(payload)}.${signature}`, {
      now: NOW, requireAttestation: false,
    }),
    ReceiptSignatureError,
  );
});

test("receipt signed by a key other than header jwk fails", async () => {
  const key = await keypair();
  const { receipt } = await signReceipt(await baseClaims(), {
    key,
    signingKey: await keypair(),
  });
  await assert.rejects(
    verifyReceipt(receipt, { now: NOW, requireAttestation: false }),
    ReceiptSignatureError,
  );
});

test("edited claim with stale signature fails", async () => {
  const { receipt } = await signReceipt(await baseClaims());
  const [protectedSegment, payloadSegment, signature] = receipt.split(".");
  const claims = JSON.parse(new TextDecoder().decode(decodeB64url(payloadSegment)));
  claims.model.selected = "tampered";
  const edited = `${protectedSegment}.${b64url(enc(JSON.stringify(claims)))}.${signature}`;
  await assert.rejects(
    verifyReceipt(edited, { now: NOW, requireAttestation: false }),
    ReceiptSignatureError,
  );
});

test("wrong kid fails header check before signature", async () => {
  const { receipt } = await signReceipt(await baseClaims(), {
    headerUpdates: { kid: await digest(enc("wrong")) },
  });
  await assert.rejects(
    verifyReceipt(receipt, { now: NOW, requireAttestation: false }),
    ReceiptHeaderError,
  );
});

test("stream byte flip fails response hash", async () => {
  const { receipt, stream } = await streamReceipt();
  const tampered = enc(new TextDecoder().decode(stream).replace("hello", "jello"));
  await assert.rejects(
    verifyReceipt(receipt, { responseStream: tampered, now: NOW }),
    ReceiptHashError,
  );
});

test("receipt must be the last data event before DONE", async () => {
  const { receipt, stream } = await streamReceipt();
  const tampered = enc(
    new TextDecoder().decode(stream).replace(
      "data: [DONE]",
      'data: {"choices":[]}\n\ndata: [DONE]',
    ),
  );
  await assert.rejects(
    verifyReceipt(receipt, { responseStream: tampered, now: NOW }),
    /receipt is not the last data event/,
  );
});

test("stream events claim is exact", async () => {
  const { receipt, stream } = await streamReceipt({ events: 2 });
  await assert.rejects(
    verifyReceipt(receipt, { responseStream: stream, now: NOW }),
    /events check failed/,
  );
});

test("future iat fails", async () => {
  const claims = await baseClaims();
  claims.iat = NOW + 61;
  const { receipt } = await signReceipt(claims);
  await assert.rejects(
    verifyReceipt(receipt, { now: NOW, requireAttestation: false }),
    ReceiptTimeError,
  );
});

test("maxAgeSeconds rejects an old receipt", async () => {
  const { receipt } = await signReceipt(await baseClaims());
  await assert.rejects(
    verifyReceipt(receipt, {
      now: NOW + 11,
      maxAgeSeconds: 10,
      requireAttestation: false,
    }),
    ReceiptTimeError,
  );
});

test("expired tee-verified window fails", async () => {
  const claims = await baseClaims();
  claims.upstream.verification_expires_at = NOW;
  const { receipt } = await signReceipt(claims);
  await assert.rejects(
    verifyReceipt(receipt, { now: NOW, requireAttestation: false }),
    ReceiptUpstreamError,
  );
});

test("nonce mismatch fails", async () => {
  const { receipt } = await signReceipt(await baseClaims());
  await assert.rejects(
    verifyReceipt(receipt, {
      expectedNonce: "different", now: NOW, requireAttestation: false,
    }),
    ReceiptNonceError,
  );
});

for (const kind of ["aws-nitro-cose", "azure-maa-jwt"]) {
  test(`unsupported attestation kind fails closed: ${kind}`, async () => {
    const claims = await baseClaims();
    delete claims.att_sha256;
    const { receipt } = await signReceipt(claims, {
      flattened: true,
      headerUpdates: { att_kind: kind },
    });
    await assert.rejects(
      verifyReceipt(receipt, { now: NOW, requireAttestation: false }),
      UnsupportedAttestationError,
    );
  });
}

test("missing attestation throws by default", async () => {
  const { receipt } = await signReceipt(await baseClaims());
  await assert.rejects(verifyReceipt(receipt, { now: NOW }), MissingAttestationError);

  const claims = await baseClaims();
  delete claims.att_sha256;
  const { receipt: flattened } = await signReceipt(claims, {
    flattened: true,
    headerUpdates: { att: null, att_kind: null },
  });
  await assert.rejects(
    verifyReceipt(flattened, { now: NOW, requireAttestation: false }),
    MissingAttestationError,
  );
});

test("duplicate JSON members are rejected in flattened, header, and claims JSON", async () => {
  const claims = await baseClaims();
  const { receipt } = await signReceipt(claims, {
    payloadText: `${JSON.stringify(claims).slice(0, -1)},"rv":1}`,
  });
  await assert.rejects(
    verifyReceipt(receipt, { now: NOW, requireAttestation: false }),
    ReceiptStructureError,
  );

  const flattened = JSON.stringify((await signReceipt(claims, { flattened: true })).receipt);
  const duplicateFlattened = `${flattened.slice(0, -1)},"payload":"duplicate"}`;
  await assert.rejects(
    verifyReceipt(duplicateFlattened, { now: NOW }),
    ReceiptStructureError,
  );

  const { receipt: duplicateHeader } = await signReceipt(claims, {
    serializeHeader: (header) => `${JSON.stringify(header).slice(0, -1)},"alg":"EdDSA"}`,
  });
  await assert.rejects(
    verifyReceipt(duplicateHeader, { now: NOW, requireAttestation: false }),
    ReceiptStructureError,
  );
});

test("GCP attestation verification receives the domain-separated key commitment", async () => {
  const originalPolicy = receiptVerificationDependencies.policyFromTrustRelease;
  const originalVerify = receiptVerificationDependencies.verifyGatewayAttestation;
  const policy = { fixture: true };
  let seen = null;
  receiptVerificationDependencies.policyFromTrustRelease = async () => policy;
  receiptVerificationDependencies.verifyGatewayAttestation = async (document, options) => {
    seen = { document, options };
  };
  try {
    const claims = await baseClaims();
    delete claims.att_sha256;
    const { receipt, key } = await signReceipt(claims, { flattened: true });
    const verified = await verifyReceipt(receipt, { now: NOW });
    const publicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", key.publicKey));
    const commitment = await crypto.subtle.digest(
      "SHA-256",
      join(enc("inference-receipt-key-v1\0"), publicRaw),
    );
    const expectedHex = [...new Uint8Array(commitment)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    assert.equal(verified.attestationStatus, "verified");
    assert.equal(new TextDecoder().decode(seen.document), "fake.jwt.token");
    assert.deepEqual(seen.options, { policy, nonceHex: expectedHex });
  } finally {
    receiptVerificationDependencies.policyFromTrustRelease = originalPolicy;
    receiptVerificationDependencies.verifyGatewayAttestation = originalVerify;
  }
});

test("multi-line data and unknown SSE fields fail verification", async () => {
  const { receipt, stream } = await streamReceipt();
  const text = new TextDecoder().decode(stream);
  for (const tampered of [
    text.replace("data: {\"choices\"", "data: first\ndata: {\"choices\""),
    text.replace("data: {\"choices\"", "id: 1\ndata: {\"choices\""),
  ]) {
    await assert.rejects(
      verifyReceipt(receipt, { responseStream: enc(tampered), now: NOW }),
      ReceiptHashError,
    );
  }
});

test("ReceiptCapture preserves exact async chunks, discovers, and verifies receipt", async () => {
  const { receipt, stream } = await streamReceipt();
  async function* chunks() {
    yield stream.subarray(0, 17);
    yield stream.subarray(17, 83);
    yield stream.subarray(83);
  }
  const capture = new ReceiptCapture(chunks());
  const consumed = [];
  for await (const chunk of capture) consumed.push(chunk);
  assert.deepEqual(join(...consumed), stream);
  assert.deepEqual(capture.capturedBytes, stream);
  assert.deepEqual(capture.receipt, receipt);
  assert.equal((await capture.verify({ now: NOW })).jti, "chatcmpl-test");
});
