import assert from "node:assert/strict";
import test from "node:test";

import {
  AttestationVerificationError,
  policyFromTrustRelease,
} from "../dist/attestation.js";

const digest = `sha256:${"ab".repeat(32)}`;
const reference = "us-central1-docker.pkg.dev/project/repository/image:tag";
const releasePins = { image_digest: digest, image_reference: reference };
const invalidValues = [
  ["numeric", 7], ["zero", 0], ["object", {}], ["boolean", false],
  ["array", []], ["empty", ""], ["whitespace", "   "],
];
const invalidDigests = [
  ["missing prefix", "ab".repeat(32)], ["wrong algorithm", `sha512:${"a".repeat(64)}`],
  ["short", "sha256:abc123"], ["long", `sha256:${"a".repeat(65)}`],
  ["nonhex", `sha256:${"g".repeat(64)}`], ["uppercase", `sha256:${"A".repeat(64)}`],
  ["trailing newline", `${digest}\n`], ["leading space", ` ${digest}`],
];
const invalidReferences = [
  ["URL", `https://${reference}`], ["missing tag", "registry/image:"],
  ["empty path component", "registry//image:tag"], ["invalid tag", "registry/image:!"],
  ["short digest", "registry/image@sha256:abc123"],
  ["trailing newline", `${reference}\n`], ["embedded space", "registry/im age:tag"],
];

async function rejectsPin(release, field) {
  await assert.rejects(policyFromTrustRelease({ release }), (error) => {
    assert.ok(error instanceof AttestationVerificationError);
    assert.ok(error.message.includes(field), error.message);
    return true;
  });
}

for (const [scalar, list, valid, malformed] of [
  ["image_digest", "accepted_image_digests", digest, invalidDigests],
  ["image_reference", "accepted_image_references", reference, invalidReferences],
]) {
  for (const [label, value] of [
    ...invalidValues, ...malformed, ["coercible array", [valid]],
    ["coercible object", { toString: () => valid }],
  ]) {
    test(`policy pins: ${scalar} rejects ${label} even with valid alternatives`, async () => {
      await rejectsPin({ ...releasePins, [list]: [valid], [scalar]: value }, scalar);
    });
    test(`policy pins: ${list} rejects ${label} entry instead of dropping it`, async () => {
      await rejectsPin({ ...releasePins, [list]: [valid, value] }, `${list}[1]`);
    });
  }
  for (const [label, value] of [["null", null], ["undefined", undefined]]) {
    test(`policy pins: ${list} rejects ${label} entry`, async () => {
      await rejectsPin({ ...releasePins, [list]: [valid, value] }, `${list}[1]`);
    });
  }
  for (const [label, value] of [["null", null], ["string", valid], ["object", {}], ["numeric", 7]]) {
    test(`policy pins: ${list} rejects ${label} instead of an array`, async () => {
      await rejectsPin({ ...releasePins, [list]: value }, list);
    });
  }
  test(`policy pins: ${list} rejects sparse entries`, async () => {
    await rejectsPin({ ...releasePins, [list]: [valid, , valid] }, `${list}[1]`);
  });
  test(`policy pins: missing optional fields with only ${scalar}`, async () => {
    const policy = await policyFromTrustRelease({ release: { [scalar]: valid } });
    assert.deepEqual(policy, {
      audience: "quill-cloud", certSha256: null, allowDebug: false,
      imageDigest: scalar === "image_digest" ? digest : null,
      imageDigests: scalar === "image_digest" ? [digest] : [],
      imageReference: scalar === "image_reference" ? reference : null,
      imageReferences: scalar === "image_reference" ? [reference] : [],
    });
  });
  test(`policy pins: ${list} alone and null scalar remain supported`, async () => {
    const policy = await policyFromTrustRelease({ release: { [scalar]: null, [list]: [valid] } });
    assert.deepEqual(scalar === "image_digest" ? policy.imageDigests : policy.imageReferences, [valid]);
    assert.equal(policy.imageDigest, null);
    assert.equal(policy.imageReference, null);
  });
}

test("policy pins: empty accepted lists fall back to scalar pins", async () => {
  const policy = await policyFromTrustRelease({
    release: { ...releasePins, accepted_image_digests: [], accepted_image_references: [] },
  });
  assert.deepEqual(policy.imageDigests, [digest]);
  assert.deepEqual(policy.imageReferences, [reference]);
});

test("policy pins: valid references are preserved exactly", async () => {
  const references = [reference, "localhost:5000/repo/image:Tag_1", `registry/image@${digest}`,
    `registry/image:tag@${digest}`, "registry/repo/image", "image:tag"];
  const policy = await policyFromTrustRelease({ release: { accepted_image_references: references } });
  assert.deepEqual(policy.imageReferences, references);
});

test("policy pins: fetched malformed record fails with typed error", async () => {
  await assert.rejects(policyFromTrustRelease({
    fetchImpl: async () => new Response(JSON.stringify({ ...releasePins, image_digest: 7 })),
  }), AttestationVerificationError);
});

test("policy pins: fetched valid record preserves pins", async () => {
  const policy = await policyFromTrustRelease({
    fetchImpl: async () => new Response(JSON.stringify(releasePins)),
  });
  assert.equal(policy.imageDigest, digest);
  assert.equal(policy.imageReference, reference);
});
