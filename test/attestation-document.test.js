/**
 * Document-only gateway attestation (verifyGatewayAttestationDocument) and the
 * `binding` level every verification reports.
 *
 * The fixture is the claim set the live gateway returned on 2026-10-13 (see
 * fixtures/attestation/metadata.json). Its shape is the reason this mode
 * exists: there is no tls_cert_sha256 claim, and the leaf certificate hash is
 * one anonymous eat_nonce entry among several, so verifyGatewayAttestation()
 * cannot pass without the certificate DER — which a browser never has. The
 * tests re-sign those claims with a generated key and a fresh expiry, slot the
 * test's own nonce where the caller nonce sat, and check that every claim
 * check still runs while no TLS binding is claimed.
 */

import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes, sign as nodeSign, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  AttestationVerificationError,
  EXPORTER_LENGTH,
  GCP_ISSUER,
  GCP_JWKS_URI,
  policyFromTrustRelease,
  verifyGatewayAttestation,
  verifyGatewayAttestationDocument,
} from "../dist/attestation.js";
import { TrustedRouter } from "../dist/index.js";

process.env.TRUSTEDROUTER_TELEMETRY = "0";

const fixture = (name) => new URL(`./fixtures/attestation/${name}`, import.meta.url);
const LIVE_CLAIMS = JSON.parse(readFileSync(fixture("live-gateway-claims.json"), "utf8"));
const LEAF_DER = new Uint8Array(new X509Certificate(readFileSync(fixture("live-gateway-leaf.pem"))).raw);
const LEAF_SHA = createHash("sha256").update(LEAF_DER).digest("hex");
const CALLER_NONCE_SLOT = 3;

const b64url = (value) => Buffer.from(value).toString("base64url");
const signer = generateKeyPairSync("rsa", { modulusLength: 2048 });
const stranger = generateKeyPairSync("rsa", { modulusLength: 2048 });

function jwkOf(keyPair, kid = "test-kid") {
  const { n, e } = keyPair.publicKey.export({ format: "jwk" });
  return { kid, kty: "RSA", alg: "RS256", use: "sig", n, e };
}

const JWKS = { keys: [jwkOf(signer)] };

function makeJwt(claims, { keyPair = signer, kid = "test-kid" } = {}) {
  const header = b64url(JSON.stringify({ alg: "RS256", kid, typ: "JWT" }));
  const payload = b64url(JSON.stringify(claims));
  const signature = nodeSign("sha256", Buffer.from(`${header}.${payload}`), keyPair.privateKey);
  return new TextEncoder().encode(`${header}.${payload}.${b64url(signature)}`);
}

const freshNonce = () => randomBytes(32).toString("hex");

/** The live claim set, freshly dated, answering `nonce`. */
function liveClaims(nonce, overrides = {}) {
  const claims = structuredClone(LIVE_CLAIMS);
  const now = Math.floor(Date.now() / 1000);
  claims.iat = now;
  claims.nbf = now;
  claims.exp = now + 3600;
  claims.eat_nonce[CALLER_NONCE_SLOT] = nonce;
  return { ...claims, ...overrides };
}

// What policyFromTrustRelease() builds from a release that publishes this build.
const POLICY = await policyFromTrustRelease({
  release: {
    image_digest: LIVE_CLAIMS.submods.container.image_digest,
    image_reference: LIVE_CLAIMS.submods.container.image_reference,
  },
});

const noFetch = async (url) => {
  throw new Error(`unexpected fetch ${url}`);
};

function rejectsWith(promise, pattern) {
  return assert.rejects(promise, (error) => {
    assert.ok(error instanceof AttestationVerificationError, `unexpected error: ${error}`);
    assert.match(error.message, pattern);
    return true;
  });
}

// ---- the live shape ----------------------------------------------------

test("document: the live-shaped token verifies with binding none", async () => {
  const nonceHex = freshNonce();
  const result = await verifyGatewayAttestationDocument(makeJwt(liveClaims(nonceHex)), {
    policy: POLICY, nonceHex, jwks: JWKS, fetchImpl: noFetch,
  });
  assert.equal(result.binding, "none");
  assert.equal(result.nonce, nonceHex);
  assert.equal(result.imageDigest, LIVE_CLAIMS.submods.container.image_digest);
  assert.equal(result.imageReference, LIVE_CLAIMS.submods.container.image_reference);
  assert.equal(result.issuer, GCP_ISSUER);
  assert.equal(result.audience, "quill-cloud");
  assert.equal(typeof result.expiresAt, "number");
  assert.equal(result.rawClaims.hwmodel, "GCP_INTEL_TDX");
  // No certificate is named as the connection's, so none is returned as one.
  assert.equal(Object.hasOwn(result, "certSha256"), false);
  assert.ok(result.certSha256Candidates.includes(LEAF_SHA));
  assert.ok(!result.certSha256Candidates.includes(nonceHex));
  assert.deepEqual(result.certSha256Candidates, LIVE_CLAIMS.eat_nonce.slice(0, CALLER_NONCE_SLOT));
});

test("document: the default verifier still requires TLS evidence for the live shape", async () => {
  const nonceHex = freshNonce();
  const jwt = makeJwt(liveClaims(nonceHex));
  await rejectsWith(
    verifyGatewayAttestation(jwt, { policy: POLICY, nonceHex, jwks: JWKS }),
    /does not commit to a TLS cert SHA-256.*verifyGatewayAttestationDocument/,
  );
  const bound = await verifyGatewayAttestation(jwt, {
    policy: POLICY, nonceHex, tlsCertDer: LEAF_DER, jwks: JWKS,
  });
  assert.equal(bound.binding, "tls-cert");
  assert.equal(bound.certSha256, LEAF_SHA);
});

test("document: fetches Google's JWKS through fetchImpl when none is supplied", async () => {
  const nonceHex = freshNonce();
  const urls = [];
  const result = await verifyGatewayAttestationDocument(makeJwt(liveClaims(nonceHex)), {
    policy: POLICY,
    nonceHex,
    fetchImpl: async (url) => {
      urls.push(url);
      return new Response(JSON.stringify(JWKS));
    },
  });
  assert.deepEqual(urls, [GCP_JWKS_URI]);
  assert.equal(result.binding, "none");
});

test("document: an uppercase nonce matches the gateway's lowercase echo", async () => {
  const nonceHex = freshNonce();
  const result = await verifyGatewayAttestationDocument(makeJwt(liveClaims(nonceHex)), {
    policy: POLICY, nonceHex: nonceHex.toUpperCase(), jwks: JWKS,
  });
  assert.equal(result.nonce, nonceHex.toUpperCase());
  assert.ok(!result.certSha256Candidates.includes(nonceHex));
});

// ---- failures ------------------------------------------------------------

test("document: a different nonce is rejected (replay)", async () => {
  const jwt = makeJwt(liveClaims(freshNonce()));
  await rejectsWith(
    verifyGatewayAttestationDocument(jwt, { policy: POLICY, nonceHex: freshNonce(), jwks: JWKS }),
    /not present in JWT nonces/,
  );
});

test("document: the nonce must be in eat_nonce, not only the legacy nonces claim", async () => {
  const nonceHex = freshNonce();
  const claims = liveClaims(nonceHex);
  claims.eat_nonce = claims.eat_nonce.slice(0, CALLER_NONCE_SLOT);
  claims.nonces = [nonceHex];
  await rejectsWith(
    verifyGatewayAttestationDocument(makeJwt(claims), { policy: POLICY, nonceHex, jwks: JWKS }),
    /not present in JWT nonces/,
  );
  delete claims.eat_nonce;
  await rejectsWith(
    verifyGatewayAttestationDocument(makeJwt(claims), { policy: POLICY, nonceHex, jwks: JWKS }),
    /not present in JWT nonces/,
  );
});

test("document: a workload digest outside the policy is rejected", async () => {
  const nonceHex = freshNonce();
  const claims = liveClaims(nonceHex);
  claims.submods.container.image_digest = `sha256:${"0".repeat(64)}`;
  await rejectsWith(
    verifyGatewayAttestationDocument(makeJwt(claims), { policy: POLICY, nonceHex, jwks: JWKS }),
    /image_digest mismatch/,
  );
});

test("document: a workload reference outside the policy is rejected", async () => {
  const nonceHex = freshNonce();
  const claims = liveClaims(nonceHex);
  claims.submods.container.image_reference = "us-central1-docker.pkg.dev/someone/else/img:tag";
  await rejectsWith(
    verifyGatewayAttestationDocument(makeJwt(claims), { policy: POLICY, nonceHex, jwks: JWKS }),
    /image_reference mismatch/,
  );
});

test("document: a signature from an unpublished key is rejected", async () => {
  const nonceHex = freshNonce();
  await rejectsWith(
    verifyGatewayAttestationDocument(makeJwt(liveClaims(nonceHex), { keyPair: stranger }), {
      policy: POLICY, nonceHex, jwks: JWKS,
    }),
    /signature verification failed/,
  );
});

test("document: claims edited after signing are rejected", async () => {
  const nonceHex = freshNonce();
  const [header, , signature] = new TextDecoder().decode(makeJwt(liveClaims(freshNonce()))).split(".");
  const forged = `${header}.${b64url(JSON.stringify(liveClaims(nonceHex)))}.${signature}`;
  await rejectsWith(
    verifyGatewayAttestationDocument(forged, { policy: POLICY, nonceHex, jwks: JWKS }),
    /signature verification failed/,
  );
});

test("document: an expired token is rejected", async () => {
  const nonceHex = freshNonce();
  const claims = liveClaims(nonceHex, { exp: Math.floor(Date.now() / 1000) - 1 });
  await rejectsWith(
    verifyGatewayAttestationDocument(makeJwt(claims), { policy: POLICY, nonceHex, jwks: JWKS }),
    /expired/,
  );
});

for (const [name, overrides, pattern] of [
  ["issuer", { iss: "https://evil.example" }, /unexpected issuer/],
  ["audience", { aud: "someone-else" }, /audience/],
  ["debug workload", { dbgstat: "enabled" }, /disabled-since-boot/],
  ["non-Confidential-Space workload", { swname: "GCE" }, /not running Confidential Space/],
  ["Secure Boot", { secboot: false }, /Secure Boot/],
  ["hardware model", { hwmodel: "GCP_SHIELDED_VM" }, /hardware model/],
]) {
  test(`document: the ${name} check still runs`, async () => {
    const nonceHex = freshNonce();
    await rejectsWith(
      verifyGatewayAttestationDocument(makeJwt(liveClaims(nonceHex, overrides)), {
        policy: POLICY, nonceHex, jwks: JWKS,
      }),
      pattern,
    );
  });
}

test("document: a policy pinning no image is refused", async () => {
  const nonceHex = freshNonce();
  await rejectsWith(
    verifyGatewayAttestationDocument(makeJwt(liveClaims(nonceHex)), {
      policy: { audience: "quill-cloud", imageDigest: null, imageDigests: [], imageReference: null, imageReferences: [] },
      nonceHex,
      jwks: JWKS,
    }),
    /pins no image identity/,
  );
  await rejectsWith(
    verifyGatewayAttestationDocument(makeJwt(liveClaims(nonceHex)), { nonceHex, jwks: JWKS }),
    /policy is required/,
  );
});

test("document: a missing or weak nonce is refused before any fetch", async () => {
  const jwt = makeJwt(liveClaims(freshNonce()));
  for (const nonceHex of [
    undefined,
    null,
    "",
    7,
    "ab".repeat(15), // 15 bytes: below the 16-byte floor
    "abc".repeat(11), // odd length
    "zz".repeat(32), // not hex
    ` ${"ab".repeat(32)}`, // not trimmed for the caller
    "ab".repeat(65), // 65 bytes: above the ceiling
  ]) {
    await rejectsWith(
      verifyGatewayAttestationDocument(jwt, { policy: POLICY, nonceHex, fetchImpl: noFetch }),
      /fresh nonce of 16 to 64 random bytes/,
    );
  }
});

// ---- certificate candidates ---------------------------------------------

test("document: certificate candidates are hash-shaped, deduplicated, and exclude the nonce", async () => {
  const nonceHex = freshNonce();
  const labelled = "AB".repeat(32);
  const claims = liveClaims(nonceHex, {
    tls_cert_sha256: labelled,
    eat_nonce: [LEAF_SHA, nonceHex, labelled.toLowerCase(), LEAF_SHA.toUpperCase(), "short", 7, null, "f".repeat(65)],
  });
  const result = await verifyGatewayAttestationDocument(makeJwt(claims), { policy: POLICY, nonceHex, jwks: JWKS });
  assert.deepEqual(result.certSha256Candidates, [labelled.toLowerCase(), LEAF_SHA]);
  assert.equal(result.binding, "none");
});

test("document: a single-string eat_nonce is accepted", async () => {
  const nonceHex = freshNonce();
  const result = await verifyGatewayAttestationDocument(makeJwt(liveClaims(nonceHex, { eat_nonce: nonceHex })), {
    policy: POLICY, nonceHex, jwks: JWKS,
  });
  assert.deepEqual(result.certSha256Candidates, []);
});

// ---- binding levels of the default verifier ------------------------------

test("binding: a claimed certificate with no connection evidence reports none", async () => {
  const claims = liveClaims(freshNonce(), { tls_cert_sha256: LEAF_SHA });
  const jwt = makeJwt(claims);
  const claimed = await verifyGatewayAttestation(jwt, { policy: POLICY, jwks: JWKS });
  assert.equal(claimed.binding, "none");
  assert.equal(claimed.certSha256, LEAF_SHA);
  // A policy pin compares against a published hash, not this connection.
  const pinned = await verifyGatewayAttestation(jwt, { policy: { ...POLICY, certSha256: LEAF_SHA }, jwks: JWKS });
  assert.equal(pinned.binding, "none");
});

test("binding: a matching tlsCertDer reports tls-cert, a different one is rejected", async () => {
  const nonceHex = freshNonce();
  const jwt = makeJwt(liveClaims(nonceHex, { tls_cert_sha256: LEAF_SHA }));
  const bound = await verifyGatewayAttestation(jwt, { policy: POLICY, nonceHex, tlsCertDer: LEAF_DER, jwks: JWKS });
  assert.equal(bound.binding, "tls-cert");
  await rejectsWith(
    verifyGatewayAttestation(jwt, { policy: POLICY, nonceHex, tlsCertDer: new Uint8Array([1, 2, 3]), jwks: JWKS }),
    /TLS cert mismatch/,
  );
});

test("binding: a committed TLS exporter reports tls-exporter", async () => {
  const nonceHex = freshNonce();
  const tlsExporter = randomBytes(EXPORTER_LENGTH);
  const claims = liveClaims(nonceHex);
  claims.eat_nonce[2] = tlsExporter.toString("hex");
  const result = await verifyGatewayAttestation(makeJwt(claims), {
    policy: POLICY, nonceHex, tlsCertDer: LEAF_DER, tlsExporter: new Uint8Array(tlsExporter), jwks: JWKS,
  });
  assert.equal(result.binding, "tls-exporter");
  assert.equal(result.certSha256, LEAF_SHA);
});

// ---- fetching a challenged document --------------------------------------

test("client.attestation sends the nonce to the API root", async () => {
  const urls = [];
  const client = new TrustedRouter({
    fetchImpl: async (url) => {
      urls.push(url);
      return new Response("header.payload.signature");
    },
  });
  const nonceHex = freshNonce();
  const document = await client.attestation({ nonceHex });
  assert.equal(new TextDecoder().decode(document), "header.payload.signature");
  await client.attestation();
  assert.deepEqual(urls, [
    `https://api.trustedrouter.com/attestation?nonce=${nonceHex}`,
    "https://api.trustedrouter.com/attestation",
  ]);
});
