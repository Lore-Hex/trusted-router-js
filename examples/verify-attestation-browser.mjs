// Document-only gateway attestation for code that cannot see its TLS
// connection: browser pages, Web Workers, and apps whose requests go through a
// fetch proxy or a platform HTTP stack.
//
// It uses only fetch, crypto.getRandomValues, and WebCrypto, so it drops into
// a bundled web app (Vite, webpack, esbuild) unchanged. It also runs in Deno,
// Bun, and Node 20+; from a build of this repository:
//
//   node --input-type=module -e '
//     import { verifyGatewayFromBrowser } from "./examples/verify-attestation-browser.mjs";
//     console.log(await verifyGatewayFromBrowser());'
//
// What a pass means: a Google-signed token, minted just now for this page's
// random nonce, names a gateway build the published trust release pins. What
// it does not mean: that this page's other requests reach that gateway. The
// result says so with `binding: "none"`. Where the TLS connection is visible,
// use verifyGatewaySession() from "@lore-hex/trusted-router/session" (Node)
// for an exporter-bound check instead.

import {
  policyFromTrustRelease,
  verifyGatewayAttestationDocument,
} from "@lore-hex/trusted-router/attestation";

const ATTESTATION_URL = "https://api.trustedrouter.com/attestation";
const TRUST_RELEASE_URL = "https://trust.trustedrouter.com/trust/gcp-release.json";

function randomNonceHex(bytes = 32) {
  const nonce = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(nonce, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function ok(response, what) {
  if (!response.ok) throw new Error(`${what} returned HTTP ${response.status}`);
  return response;
}

/**
 * Verify the gateway's attestation document from a browser.
 *
 * `fetchAttestation(url)` performs the GET for the gateway's /attestation.
 * The gateway does not send CORS headers there, so a page on another origin
 * passes a function that goes through its own same-origin relay, for example
 *
 *   (url) => fetch(`/api/trustedrouter-attestation${new URL(url).search}`)
 *
 * Relaying the document does not weaken this check. A relay can hand the
 * token along, but it cannot forge one, answer a fresh nonce with an old one,
 * or change what the token is checked against: Google's JWKS and the trust
 * release are fetched here directly, never through the relay. (Both serve
 * CORS. The trust release is read with a plain GET so no preflight is needed.)
 *
 * Resolves to a GatewayAttestationDocument; rejects with
 * AttestationVerificationError on any failed check. Verify again for each new
 * session, and never trust a result past its `expiresAt`.
 */
export async function verifyGatewayFromBrowser({
  fetchAttestation = (url) => fetch(url),
} = {}) {
  const nonceHex = randomNonceHex();
  const [release, document] = await Promise.all([
    fetch(TRUST_RELEASE_URL)
      .then((response) => ok(response, "trust release"))
      .then((response) => response.json()),
    fetchAttestation(`${ATTESTATION_URL}?nonce=${nonceHex}`)
      .then((response) => ok(response, "attestation endpoint"))
      .then(async (response) => new Uint8Array(await response.arrayBuffer())),
  ]);
  const policy = await policyFromTrustRelease({ release });
  return verifyGatewayAttestationDocument(document, { policy, nonceHex });
}
