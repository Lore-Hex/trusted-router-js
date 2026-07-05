#!/usr/bin/env node

import {
  fetchAttestationAgain,
  verifyGatewaySession,
} from "../src/session.js";
import { policyFromTrustRelease } from "../src/attestation.js";

function argValue(name) {
  const prefix = `${name}=`;
  const idx = process.argv.indexOf(name);
  if (idx !== -1) return process.argv[idx + 1] ?? null;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  return inline ? inline.slice(prefix.length) : null;
}

function hex(bytes) {
  return Buffer.from(bytes).toString("hex");
}

async function main() {
  const baseUrl =
    argValue("--base-url") ||
    process.env.TR_BASE_URL ||
    "https://api.trustedrouter.com/v1";
  const expectDigest = argValue("--expect-digest");
  const trustReleaseUrl = argValue("--trust-release-url") || undefined;
  const policy = expectDigest
    ? {
        audience: "quill-cloud",
        imageDigest: expectDigest,
        imageReference: null,
      }
    : await policyFromTrustRelease({ trustReleaseUrl });

  const session = await verifyGatewaySession({ baseUrl, policy });
  try {
    console.log("JWT: verified");
    console.log(`digest: ${session.attestation.imageDigest || "(not pinned)"}`);
    console.log(`cert-fp: ${session.attestation.certSha256}`);
    console.log(`fresh-nonce: ${session.attestation.nonce}`);
    console.log(`exporter: ${hex(session.exporter)}`);
    console.log(`dbgstat: ${JSON.stringify(session.attestation.rawClaims.dbgstat ?? null)}`);
    const again = await fetchAttestationAgain(session);
    console.log(`pin-follow-up: ${again.length} byte JWT over same socket`);
  } finally {
    session.socket.destroy();
  }
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exitCode = 1;
});
