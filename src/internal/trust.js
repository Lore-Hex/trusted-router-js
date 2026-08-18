/**
 * Trust-release fetch — the published record of what the attested gateway
 * should be running (image digests/references, rollout pins).
 *
 * Lives in its own internal module so src/attestation.js can import it
 * WITHOUT going through the ./index.js barrel: attestation → barrel →
 * client → internal would be a module cycle, and ESM temporal-dead-zone on
 * const bindings makes that fragile. Internal modules import internal
 * modules; only consumers import the barrel.
 *
 * This is a documented single-shot, credential-free metadata fetch — it
 * stays OUTSIDE the transport engine by design (no retries, no failover).
 */

import { jsonOrThrow } from "./errors.js";
import { DEFAULT_TRUST_RELEASE_URL } from "./models.js";
import { DEFAULT_USER_AGENT } from "./transport.js";

export { DEFAULT_TRUST_RELEASE_URL };

export async function fetchTrustRelease({
  trustUrl = DEFAULT_TRUST_RELEASE_URL,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!fetchImpl) {
    throw new Error("A fetch implementation is required");
  }
  return jsonOrThrow(
    await fetchImpl(trustUrl, {
      headers: { "user-agent": DEFAULT_USER_AGENT },
      credentials: "omit",
      redirect: "manual",
    }),
  );
}

export const trustRelease = fetchTrustRelease;
