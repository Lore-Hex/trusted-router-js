/**
 * GCP Confidential Space attestation verification for TrustedRouter.
 *
 * Mirrors the Python SDK's attestation module. The hosted gateway runs
 * as a Confidential Space workload; its `/attestation` endpoint mints
 * an OIDC JWT signed by Google's CSP signer that commits to:
 *   - the workload's container image digest (sha256:...)
 *   - the workload's image reference (Artifact Registry path:tag)
 *   - the caller-supplied `nonce` (binds the doc to this request)
 *   - the workload's TLS leaf cert SHA-256 (binds it to the
 *     connection the client is on right now)
 *
 * Verifying the JWT proves the gateway you're about to use is the
 * exact build the trust page advertises.
 *
 * Uses the WebCrypto SubtleCrypto API — no native deps. Runs in
 * Node 20+ and any modern browser.
 */

import { fetchTrustRelease, DEFAULT_TRUST_RELEASE_URL } from "./index.js";

export const GCP_ISSUER = "https://confidentialcomputing.googleapis.com";
export const GCP_JWKS_URI =
  "https://www.googleapis.com/service_accounts/v1/metadata/jwk/" +
  "signer@confidentialspace-sign.iam.gserviceaccount.com";

export class AttestationVerificationError extends Error {
  constructor(message) {
    super(message);
    this.name = "AttestationVerificationError";
  }
}

/**
 * Build a verification policy from the published trust release. If
 * `release` is omitted, fetches it from `trustReleaseUrl`. The
 * audience defaults to "quill-cloud" — the gateway hard-codes this.
 */
export async function policyFromTrustRelease({
  release = null,
  audience = "quill-cloud",
  certSha256 = null,
  trustReleaseUrl = DEFAULT_TRUST_RELEASE_URL,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (release === null) {
    release = await fetchTrustRelease({ trustUrl: trustReleaseUrl, fetchImpl });
  }
  return {
    audience,
    certSha256,
    imageDigest: release?.image_digest ?? null,
    imageReference: release?.image_reference ?? null,
  };
}

/**
 * Verify a Confidential Space attestation JWT.
 *
 *   document       Uint8Array — the JWT bytes returned by client.attestation()
 *   policy         { audience, imageDigest, imageReference, certSha256? }
 *   nonceHex       The same nonce sent in the /attestation request (optional)
 *   tlsCertDer     Uint8Array — DER bytes of the gateway's leaf cert (optional)
 *   jwks           pre-fetched Google JWKS (optional; will fetch if absent)
 *
 * Returns a GatewayAttestation object on success. Throws
 * AttestationVerificationError on any failure — never returns false.
 */
export async function verifyGatewayAttestation(document, {
  policy,
  nonceHex = null,
  tlsCertDer = null,
  jwks = null,
  jwksUrl = GCP_JWKS_URI,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!policy) {
    throw new AttestationVerificationError("policy is required");
  }
  const { header, payload, signingInput, signature } = parseJwt(document);
  if (!jwks) {
    jwks = await fetchJwks(jwksUrl, fetchImpl);
  }
  await verifyRs256(jwks, header, signingInput, signature);
  return await checkClaims(payload, { policy, nonceHex, tlsCertDer });
}

// ---- internals ---------------------------------------------------------

function b64urlDecode(segment) {
  const padded = segment + "=".repeat((4 - (segment.length % 4)) % 4);
  const b64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToString(bytes) {
  return new TextDecoder().decode(bytes);
}

function parseJwt(document) {
  const text = typeof document === "string"
    ? document
    : bytesToString(document);
  const parts = text.trim().split(".");
  if (parts.length !== 3) {
    throw new AttestationVerificationError(
      `expected 3 JWT segments, got ${parts.length}`,
    );
  }
  const [hB64, pB64, sB64] = parts;
  let header, payload, signature;
  try {
    header = JSON.parse(bytesToString(b64urlDecode(hB64)));
    payload = JSON.parse(bytesToString(b64urlDecode(pB64)));
    signature = b64urlDecode(sB64);
  } catch (err) {
    throw new AttestationVerificationError(`invalid JWT encoding: ${err.message}`);
  }
  const signingInput = new TextEncoder().encode(`${hB64}.${pB64}`);
  return { header, payload, signingInput, signature };
}

async function fetchJwks(url, fetchImpl) {
  const fetcher = fetchImpl ?? globalThis.fetch;
  if (!fetcher) {
    throw new AttestationVerificationError("no fetch available to load JWKS");
  }
  const response = await fetcher(url);
  if (!response.ok) {
    throw new AttestationVerificationError(
      `JWKS fetch returned HTTP ${response.status}`,
    );
  }
  const data = await response.json();
  if (!data || !Array.isArray(data.keys)) {
    throw new AttestationVerificationError("JWKS response missing `keys` array");
  }
  return data;
}

async function verifyRs256(jwks, header, signingInput, signature) {
  if (header.alg !== "RS256") {
    throw new AttestationVerificationError(
      `unsupported JWT alg ${JSON.stringify(header.alg)}; expected RS256`,
    );
  }
  const jwk = (jwks.keys || []).find((k) => k.kid === header.kid);
  if (!jwk) {
    throw new AttestationVerificationError(
      `no JWK with kid=${JSON.stringify(header.kid)} in JWKS — gateway key may have rotated`,
    );
  }
  if (jwk.kty !== "RSA") {
    throw new AttestationVerificationError("expected RSA key in JWKS");
  }
  let key;
  try {
    key = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
  } catch (err) {
    throw new AttestationVerificationError(`failed to import JWK: ${err.message}`);
  }
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    signature,
    signingInput,
  );
  if (!ok) {
    throw new AttestationVerificationError("JWT signature verification failed");
  }
}

async function checkClaims(claims, { policy, nonceHex, tlsCertDer }) {
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp === "number" && claims.exp <= now) {
    throw new AttestationVerificationError(
      `JWT expired at ${claims.exp} (now=${now})`,
    );
  }
  if (claims.iss !== GCP_ISSUER) {
    throw new AttestationVerificationError(
      `unexpected issuer ${JSON.stringify(claims.iss)}; expected ${GCP_ISSUER}`,
    );
  }
  const audList = Array.isArray(claims.aud)
    ? claims.aud
    : (claims.aud != null ? [claims.aud] : []);
  if (!audList.includes(policy.audience)) {
    throw new AttestationVerificationError(
      `audience ${JSON.stringify(policy.audience)} not in JWT aud ${JSON.stringify(audList)}`,
    );
  }

  const submods = (claims.submods || {}).container || {};
  const imageDigest = submods.image_digest || "";
  const imageReference = submods.image_reference || "";

  if (policy.imageDigest && imageDigest !== policy.imageDigest) {
    throw new AttestationVerificationError(
      `image_digest mismatch: workload=${JSON.stringify(imageDigest)}, ` +
      `policy=${JSON.stringify(policy.imageDigest)}`,
    );
  }
  if (policy.imageReference && imageReference !== policy.imageReference) {
    throw new AttestationVerificationError(
      `image_reference mismatch: workload=${JSON.stringify(imageReference)}, ` +
      `policy=${JSON.stringify(policy.imageReference)}`,
    );
  }

  // Nonce binding (replay defense)
  let nonces = claims.eat_nonce || claims.nonces || [];
  if (typeof nonces === "string") nonces = [nonces];
  let nonceMatch = null;
  if (nonceHex !== null) {
    if (!nonces.includes(nonceHex)) {
      throw new AttestationVerificationError(
        `nonce ${JSON.stringify(nonceHex)} not present in JWT nonces ${JSON.stringify(nonces)}`,
      );
    }
    nonceMatch = nonceHex;
  }

  // Cert binding
  let certSha = claims.tls_cert_sha256
    || claims.workload_tls_cert_sha256
    || (tlsCertDer ? findCertInNonces(nonces, await sha256Hex(tlsCertDer)) : null);
  if (typeof certSha !== "string" || certSha.length !== 64) {
    throw new AttestationVerificationError(
      "JWT does not commit to a TLS cert SHA-256 — cannot bind connection",
    );
  }
  certSha = certSha.toLowerCase();

  if (tlsCertDer) {
    const actual = await sha256Hex(tlsCertDer);
    if (actual !== certSha) {
      throw new AttestationVerificationError(
        `TLS cert mismatch: connection=${JSON.stringify(actual)}, JWT=${JSON.stringify(certSha)}`,
      );
    }
  }

  if (policy.certSha256 && certSha !== policy.certSha256.toLowerCase()) {
    throw new AttestationVerificationError(
      "JWT-committed cert SHA-256 doesn't match policy pin",
    );
  }

  return {
    certSha256: certSha,
    imageDigest,
    imageReference,
    nonce: nonceMatch,
    expiresAt: typeof claims.exp === "number" ? claims.exp : null,
    issuer: claims.iss ?? null,
    audience: policy.audience,
    rawClaims: claims,
  };
}

function findCertInNonces(nonces, certHex) {
  for (const n of nonces) {
    if (typeof n === "string" && n.toLowerCase() === certHex) return n.toLowerCase();
  }
  return null;
}

async function sha256Hex(bytes) {
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  const arr = new Uint8Array(buf);
  let hex = "";
  for (const b of arr) hex += b.toString(16).padStart(2, "0");
  return hex;
}
