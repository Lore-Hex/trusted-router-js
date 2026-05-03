/**
 * Coverage for the GCP attestation verifier. Strategy mirrors the
 * Python SDK's tests: generate a real RSA keypair via SubtleCrypto,
 * sign a JWT with it, expose the public half as a JWKS dict, then run
 * verifyGatewayAttestation against crafted-but-real JWTs to exercise
 * both the happy path and every claim-mismatch we want to fail loudly.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  AttestationVerificationError,
  GCP_ISSUER,
  policyFromTrustRelease,
  verifyGatewayAttestation,
} from "../src/attestation.js";

// ---- helpers -----------------------------------------------------------

const enc = (s) => new TextEncoder().encode(s);

function b64url(bytes) {
  // bytes can be Uint8Array OR ArrayBuffer
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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

async function publicJwk(keyPair, kid = "test-kid") {
  const jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  return { ...jwk, kid, alg: "RS256" };
}

async function makeJwt(keyPair, claims, { kid = "test-kid", alg = "RS256" } = {}) {
  const header = { alg, typ: "JWT", kid };
  const h = b64url(enc(JSON.stringify(header)));
  const p = b64url(enc(JSON.stringify(claims)));
  const signingInput = enc(`${h}.${p}`);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keyPair.privateKey, signingInput);
  return enc(`${h}.${p}.${b64url(sig)}`);
}

async function sha256Hex(bytes) {
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  let hex = "";
  for (const b of new Uint8Array(buf)) hex += b.toString(16).padStart(2, "0");
  return hex;
}

const FAKE_CERT = enc("FAKE-CERT-DER-BYTES-FOR-TESTING");
let FAKE_CERT_SHA;

async function goodClaims({ nonce = null } = {}) {
  if (!FAKE_CERT_SHA) FAKE_CERT_SHA = await sha256Hex(FAKE_CERT);
  const nonces = nonce ? [nonce, FAKE_CERT_SHA] : [FAKE_CERT_SHA];
  return {
    iss: GCP_ISSUER,
    aud: ["quill-cloud"],
    exp: Math.floor(Date.now() / 1000) + 600,
    submods: {
      container: {
        image_digest: "sha256:abc123",
        image_reference: "us-central1-docker.pkg.dev/proj/repo/img:tag",
      },
    },
    tls_cert_sha256: FAKE_CERT_SHA,
    eat_nonce: nonces,
  };
}

// ---- happy path --------------------------------------------------------

test("verify: happy path returns GatewayAttestation", async () => {
  const kp = await genKeypair();
  const jwks = { keys: [await publicJwk(kp)] };
  const nonce = "deadbeef".repeat(4);
  const jwt = await makeJwt(kp, await goodClaims({ nonce }));
  const policy = {
    audience: "quill-cloud",
    imageDigest: "sha256:abc123",
    imageReference: "us-central1-docker.pkg.dev/proj/repo/img:tag",
  };
  const result = await verifyGatewayAttestation(jwt, {
    policy, nonceHex: nonce, tlsCertDer: FAKE_CERT, jwks,
  });
  assert.equal(result.imageDigest, "sha256:abc123");
  assert.equal(result.nonce, nonce);
  assert.equal(result.audience, "quill-cloud");
  assert.equal(result.issuer, GCP_ISSUER);
});

test("verify: works when aud is a string not a list (RFC 7519)", async () => {
  const kp = await genKeypair();
  const jwks = { keys: [await publicJwk(kp)] };
  const claims = { ...(await goodClaims()), aud: "quill-cloud" };
  const jwt = await makeJwt(kp, claims);
  const result = await verifyGatewayAttestation(jwt, {
    policy: { audience: "quill-cloud", imageDigest: "sha256:abc123", imageReference: null },
    tlsCertDer: FAKE_CERT, jwks,
  });
  assert.equal(result.audience, "quill-cloud");
});

// ---- failure modes -----------------------------------------------------

test("verify: malformed JWT (wrong segment count) raises", async () => {
  await assert.rejects(
    verifyGatewayAttestation(enc("only.two"), { policy: { audience: "x", imageDigest: null, imageReference: null }, jwks: { keys: [] } }),
    /3 JWT segments/,
  );
});

test("verify: bad base64 in JWT raises", async () => {
  await assert.rejects(
    verifyGatewayAttestation(enc("!!!.???.@@@"), { policy: { audience: "x", imageDigest: null, imageReference: null }, jwks: { keys: [] } }),
    /invalid JWT/,
  );
});

test("verify: unsupported alg raises", async () => {
  const kp = await genKeypair();
  const jwt = await makeJwt(kp, await goodClaims(), { alg: "HS256" });
  await assert.rejects(
    verifyGatewayAttestation(jwt, { policy: { audience: "quill-cloud", imageDigest: null, imageReference: null }, jwks: { keys: [await publicJwk(kp)] } }),
    /unsupported JWT alg/,
  );
});

test("verify: missing kid in JWKS raises", async () => {
  const kp = await genKeypair();
  const jwt = await makeJwt(kp, await goodClaims(), { kid: "missing-kid" });
  await assert.rejects(
    verifyGatewayAttestation(jwt, { policy: { audience: "quill-cloud", imageDigest: null, imageReference: null }, jwks: { keys: [await publicJwk(kp, "other")] } }),
    /no JWK with kid/,
  );
});

test("verify: signature mismatch raises (JWT signed by A, JWKS has B)", async () => {
  const kpA = await genKeypair();
  const kpB = await genKeypair();
  const jwt = await makeJwt(kpA, await goodClaims());
  await assert.rejects(
    verifyGatewayAttestation(jwt, { policy: { audience: "quill-cloud", imageDigest: null, imageReference: null }, jwks: { keys: [await publicJwk(kpB)] } }),
    /signature/,
  );
});

test("verify: expired JWT raises", async () => {
  const kp = await genKeypair();
  const claims = { ...(await goodClaims()), exp: Math.floor(Date.now() / 1000) - 60 };
  const jwt = await makeJwt(kp, claims);
  await assert.rejects(
    verifyGatewayAttestation(jwt, { policy: { audience: "quill-cloud", imageDigest: null, imageReference: null }, jwks: { keys: [await publicJwk(kp)] } }),
    /expired/,
  );
});

test("verify: wrong issuer raises", async () => {
  const kp = await genKeypair();
  const claims = { ...(await goodClaims()), iss: "https://evil.example/issuer" };
  const jwt = await makeJwt(kp, claims);
  await assert.rejects(
    verifyGatewayAttestation(jwt, { policy: { audience: "quill-cloud", imageDigest: null, imageReference: null }, jwks: { keys: [await publicJwk(kp)] } }),
    /issuer/,
  );
});

test("verify: wrong audience raises", async () => {
  const kp = await genKeypair();
  const claims = { ...(await goodClaims()), aud: ["someone-else"] };
  const jwt = await makeJwt(kp, claims);
  await assert.rejects(
    verifyGatewayAttestation(jwt, { policy: { audience: "quill-cloud", imageDigest: null, imageReference: null }, jwks: { keys: [await publicJwk(kp)] } }),
    /audience/,
  );
});

test("verify: image_digest mismatch raises", async () => {
  const kp = await genKeypair();
  const jwt = await makeJwt(kp, await goodClaims());
  await assert.rejects(
    verifyGatewayAttestation(jwt, {
      policy: { audience: "quill-cloud", imageDigest: "sha256:DIFFERENT", imageReference: null },
      tlsCertDer: FAKE_CERT, jwks: { keys: [await publicJwk(kp)] },
    }),
    /image_digest mismatch/,
  );
});

test("verify: image_reference mismatch raises", async () => {
  const kp = await genKeypair();
  const jwt = await makeJwt(kp, await goodClaims());
  await assert.rejects(
    verifyGatewayAttestation(jwt, {
      policy: { audience: "quill-cloud", imageDigest: null, imageReference: "europe-docker.pkg.dev/x/y/z:t" },
      tlsCertDer: FAKE_CERT, jwks: { keys: [await publicJwk(kp)] },
    }),
    /image_reference mismatch/,
  );
});

test("verify: missing nonce echo raises (replay defense)", async () => {
  const kp = await genKeypair();
  const jwt = await makeJwt(kp, await goodClaims()); // no caller nonce in claims
  await assert.rejects(
    verifyGatewayAttestation(jwt, {
      policy: { audience: "quill-cloud", imageDigest: null, imageReference: null },
      nonceHex: "expected-nonce-hex",
      tlsCertDer: FAKE_CERT,
      jwks: { keys: [await publicJwk(kp)] },
    }),
    /nonce/,
  );
});

test("verify: missing cert binding raises", async () => {
  const kp = await genKeypair();
  const claims = await goodClaims();
  delete claims.tls_cert_sha256;
  claims.eat_nonce = []; // also no cert sha in nonces
  const jwt = await makeJwt(kp, claims);
  await assert.rejects(
    verifyGatewayAttestation(jwt, {
      policy: { audience: "quill-cloud", imageDigest: null, imageReference: null },
      tlsCertDer: FAKE_CERT, jwks: { keys: [await publicJwk(kp)] },
    }),
    /TLS cert/,
  );
});

test("verify: JWT cert sha mismatch with actual TLS cert raises", async () => {
  const kp = await genKeypair();
  const claims = await goodClaims();
  claims.tls_cert_sha256 = "0".repeat(64); // wrong cert
  claims.eat_nonce = ["0".repeat(64)];
  const jwt = await makeJwt(kp, claims);
  await assert.rejects(
    verifyGatewayAttestation(jwt, {
      policy: { audience: "quill-cloud", imageDigest: null, imageReference: null },
      tlsCertDer: FAKE_CERT, jwks: { keys: [await publicJwk(kp)] },
    }),
    /TLS cert mismatch/,
  );
});

test("verify: explicit policy.certSha256 mismatch raises", async () => {
  const kp = await genKeypair();
  const jwt = await makeJwt(kp, await goodClaims());
  await assert.rejects(
    verifyGatewayAttestation(jwt, {
      policy: { audience: "quill-cloud", imageDigest: null, imageReference: null, certSha256: "0".repeat(64) },
      tlsCertDer: FAKE_CERT, jwks: { keys: [await publicJwk(kp)] },
    }),
    /policy pin/,
  );
});

// ---- policyFromTrustRelease -------------------------------------------

test("policyFromTrustRelease pulls digest + reference from release dict", async () => {
  const policy = await policyFromTrustRelease({
    release: {
      image_digest: "sha256:beef",
      image_reference: "us-central1-docker.pkg.dev/p/r/i:tag",
    },
  });
  assert.equal(policy.imageDigest, "sha256:beef");
  assert.equal(policy.imageReference, "us-central1-docker.pkg.dev/p/r/i:tag");
  assert.equal(policy.audience, "quill-cloud");
});

test("policyFromTrustRelease handles missing fields with nulls", async () => {
  const policy = await policyFromTrustRelease({ release: {} });
  assert.equal(policy.imageDigest, null);
  assert.equal(policy.imageReference, null);
});

test("AttestationVerificationError exposes name", () => {
  const e = new AttestationVerificationError("x");
  assert.equal(e.name, "AttestationVerificationError");
  assert.equal(e.message, "x");
});
