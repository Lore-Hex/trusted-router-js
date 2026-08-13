/**
 * Property tests for the attestation policy boundary.
 *
 * The law: for every claims set K and policy P,
 *
 *     verifyGatewayAttestation(K, P) resolves  =>  K's image identity was in P's accepted list
 *
 * Before the non-vacuity guard this was false, and falsifiably so: a trust
 * release carrying no image fields (a truncated body, an error page that
 * parsed as JSON, a schema change) produced a policy whose accepted lists were
 * both empty, and both image checks are guarded on a non-empty list. The
 * verifier then resolved for *any* genuinely-attested Confidential Space
 * workload while reporting success.
 *
 * This package ships with no dependencies and no devDependencies, so rather
 * than pull in a property-testing library these tests drive a small seeded
 * generator. The seed is fixed, so a failure reproduces exactly; raise RUNS
 * locally to search harder.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign as nodeSign } from "node:crypto";

import {
  AttestationVerificationError,
  policyFromTrustRelease,
  pinsImageIdentity,
  verifyGatewayAttestation,
} from "../src/attestation.js";

const RUNS = Number(process.env.RUNS || 200);

// ---- seeded generator (mulberry32) --------------------------------------

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (r, xs) => xs[Math.floor(r() * xs.length)];

function identifier(r) {
  const alphabet = "abcdef0123456789:";
  const len = 1 + Math.floor(r() * 8);
  let out = "";
  for (let i = 0; i < len; i += 1) out += alphabet[Math.floor(r() * alphabet.length)];
  return out;
}

function identifierList(r, min) {
  const n = min + Math.floor(r() * 3);
  return Array.from({ length: n }, () => identifier(r));
}

// ---- JWT fixtures --------------------------------------------------------

const b64url = (buf) => Buffer.from(buf).toString("base64url");

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

function publicJwk(kid = "test-kid") {
  const jwk = publicKey.export({ format: "jwk" });
  return { kid, kty: "RSA", alg: "RS256", use: "sig", n: jwk.n, e: jwk.e };
}

const FAKE_CERT = Buffer.from("FAKE-CERT-DER-BYTES-FOR-TESTING");
const FAKE_CERT_SHA = createHash("sha256").update(FAKE_CERT).digest("hex");

function makeJwt(claims) {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "test-kid" }));
  const payload = b64url(JSON.stringify(claims));
  const signature = nodeSign("sha256", Buffer.from(`${header}.${payload}`), privateKey);
  return `${header}.${payload}.${b64url(signature)}`;
}

/** Claims passing every check except the image checks, so a property failure
 *  can only be attributed to image identity. */
function claimsFor({ imageDigest = "sha256:pinned", imageReference = "registry/img:pinned" } = {}) {
  return {
    iss: "https://confidentialcomputing.googleapis.com",
    aud: ["quill-cloud"],
    exp: Math.floor(Date.now() / 1000) + 600,
    dbgstat: "disabled-since-boot",
    swname: "CONFIDENTIAL_SPACE",
    secboot: true,
    hwmodel: "GCP_AMD_SEV",
    submods: { container: { image_digest: imageDigest, image_reference: imageReference } },
    tls_cert_sha256: FAKE_CERT_SHA,
    eat_nonce: [FAKE_CERT_SHA],
  };
}

const verify = (claims, policy) =>
  verifyGatewayAttestation(makeJwt(claims), {
    policy,
    tlsCertDer: FAKE_CERT,
    jwks: { keys: [publicJwk()] },
  });

// ---- the law -------------------------------------------------------------

test("property: a verified digest is always in the accepted list", async () => {
  const r = rng(0x5eed);
  for (let i = 0; i < RUNS; i += 1) {
    const accepted = identifierList(r, 1);
    const workload = r() < 0.4 ? pick(r, accepted) : identifier(r);
    const policy = {
      audience: "quill-cloud",
      imageDigest: null,
      imageDigests: accepted,
      imageReference: null,
      imageReferences: [],
    };

    let result = null;
    try {
      result = await verify(claimsFor({ imageDigest: workload }), policy);
    } catch (err) {
      assert.ok(err instanceof AttestationVerificationError, `unexpected error: ${err}`);
      continue; // rejection is always sound
    }

    assert.ok(
      accepted.includes(workload),
      `accepted digest ${workload} not in policy list ${JSON.stringify(accepted)}`,
    );
    assert.equal(result.imageDigest, workload);
  }
});

test("property: a verified reference is always in the accepted list", async () => {
  const r = rng(0xc0ffee);
  for (let i = 0; i < RUNS; i += 1) {
    const accepted = identifierList(r, 1);
    const workload = r() < 0.4 ? pick(r, accepted) : identifier(r);
    const policy = {
      audience: "quill-cloud",
      imageDigest: null,
      imageDigests: [],
      imageReference: null,
      imageReferences: accepted,
    };

    try {
      await verify(claimsFor({ imageReference: workload }), policy);
    } catch (err) {
      assert.ok(err instanceof AttestationVerificationError, `unexpected error: ${err}`);
      continue;
    }

    assert.ok(accepted.includes(workload));
  }
});

// ---- non-vacuity of constructed policies ---------------------------------

test("property: policyFromTrustRelease never returns a vacuous policy", async () => {
  const r = rng(0xbadc0de);
  const fieldValues = [
    undefined, null, "", "sha256:abc", 7, true, [], [null], [7], [""], ["a"], {}, "   ",
  ];
  const keys = [
    "image_digest",
    "accepted_image_digests",
    "image_reference",
    "accepted_image_references",
    "unrelated",
  ];

  for (let i = 0; i < RUNS; i += 1) {
    const release = {};
    for (const key of keys) {
      if (r() < 0.55) release[key] = pick(r, fieldValues);
    }

    let policy;
    try {
      policy = await policyFromTrustRelease({ release });
    } catch (err) {
      assert.ok(err instanceof AttestationVerificationError, `unexpected error: ${err}`);
      continue;
    }

    assert.ok(
      pinsImageIdentity(policy),
      `built an unpinned policy from ${JSON.stringify(release)}`,
    );
  }
});

test("an empty release is refused", async () => {
  await assert.rejects(
    () => policyFromTrustRelease({ release: {} }),
    /pins no image identity/,
  );
});

test("a release whose accepted lists hold no usable strings is refused", async () => {
  await assert.rejects(
    () => policyFromTrustRelease({ release: { accepted_image_digests: [null, 7, ""] } }),
    /pins no image identity/,
  );
});

test("a release with only one identity kind is still accepted", async () => {
  const policy = await policyFromTrustRelease({ release: { image_digest: "sha256:beef" } });
  assert.deepEqual(policy.imageDigests, ["sha256:beef"]);
  assert.deepEqual(policy.imageReferences, []);
  assert.ok(pinsImageIdentity(policy));
});

test("verification refuses a hand-built vacuous policy", async () => {
  await assert.rejects(
    () =>
      verify(claimsFor(), {
        audience: "quill-cloud",
        imageDigest: null,
        imageDigests: [],
        imageReference: null,
        imageReferences: [],
      }),
    /pins no image identity/,
  );
});

test("pinning only the TLS cert is refused", async () => {
  await assert.rejects(
    () =>
      verify(claimsFor(), {
        audience: "quill-cloud",
        certSha256: FAKE_CERT_SHA,
        imageDigest: null,
        imageDigests: [],
        imageReference: null,
        imageReferences: [],
      }),
    /pins no image identity/,
  );
});

// ---- the guard agrees with the checks it guards ---------------------------

test("property: pinsImageIdentity is exactly the disjunction of the checks it guards", () => {
  const r = rng(0x1234);
  const maybeId = () => (r() < 0.5 ? null : identifier(r));
  const maybeList = () => (r() < 0.5 ? [] : identifierList(r, 1));

  for (let i = 0; i < RUNS; i += 1) {
    const policy = {
      audience: "quill-cloud",
      imageDigest: maybeId(),
      imageDigests: maybeList(),
      imageReference: maybeId(),
      imageReferences: maybeList(),
    };

    // Mirrors the two enabling conditions inside verifyGatewayAttestation. If
    // the guard and the checks ever drift apart, the hole reopens silently.
    const digestCheckRuns =
      (Array.isArray(policy.imageDigests) && policy.imageDigests.length > 0) ||
      Boolean(policy.imageDigest);
    const referenceCheckRuns =
      (Array.isArray(policy.imageReferences) && policy.imageReferences.length > 0) ||
      Boolean(policy.imageReference);

    assert.equal(pinsImageIdentity(policy), digestCheckRuns || referenceCheckRuns);
  }
});
