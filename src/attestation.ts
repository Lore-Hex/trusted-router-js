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

import { fetchTrustRelease, DEFAULT_TRUST_RELEASE_URL } from "./internal/trust.js";

export interface AttestationPolicy {
  audience: string;
  imageDigest: string | null;
  imageDigests?: string[];
  imageReference: string | null;
  imageReferences?: string[];
  certSha256?: string | null;
  allowDebug?: boolean;
}

export interface GatewayAttestation {
  certSha256: string;
  imageDigest: string;
  imageReference: string;
  nonce: string | null;
  expiresAt: number | null;
  issuer: string | null;
  audience: string;
  rawClaims: Record<string, unknown>;
}

interface PolicyFromTrustReleaseOptions {
  release?: Record<string, unknown> | null;
  audience?: string;
  certSha256?: string | null;
  allowDebug?: boolean;
  trustReleaseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface Jwks {
  keys: Array<Record<string, unknown>>;
}

interface JwtVerificationOptions {
  jwks?: Jwks | null;
  jwksUrl?: string;
  fetchImpl?: typeof fetch;
}

interface VerifyGatewayAttestationOptions extends JwtVerificationOptions {
  policy: AttestationPolicy;
  nonceHex?: string | null;
  tlsCertDer?: Uint8Array | null;
  tlsExporter?: Uint8Array | null;
}

interface VerifyReceiptKeyAttestationOptions extends JwtVerificationOptions {
  policy: AttestationPolicy;
  keyCommitmentHex: string;
}

interface CheckClaimsOptions {
  policy: AttestationPolicy;
  nonceHex: string | null;
  tlsCertDer: Uint8Array | null;
  tlsExporter: Uint8Array | null;
  bindingMode?: "live-channel" | "receipt-key";
}

export const GCP_ISSUER = "https://confidentialcomputing.googleapis.com";
export const GCP_JWKS_URI =
  "https://www.googleapis.com/service_accounts/v1/metadata/jwk/" +
  "signer@confidentialspace-sign.iam.gserviceaccount.com";
export const EXPORTER_LABEL = "EXPORTER-Channel-Binding";
export const EXPORTER_LENGTH = 32;

export class AttestationVerificationError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = "AttestationVerificationError";
  }
}

/**
 * Whether a policy constrains *which* workload image is acceptable.
 *
 * Both image checks in `verifyGatewayAttestation` are guarded on a non-empty
 * accepted list, so a policy pinning neither a digest nor a reference accepts
 * any genuinely-attested Confidential Space workload — it proves "some CSP VM"
 * rather than "the gateway build we published". Policy construction and
 * verification both refuse that state rather than silently downgrading the
 * guarantee.
 *
 * @param {AttestationPolicy} policy
 * @returns {boolean}
 */
export function pinsImageIdentity(policy: AttestationPolicy | null | undefined): boolean {
  if (!policy) return false;
  const digests = Array.isArray(policy.imageDigests) ? policy.imageDigests : [];
  const references = Array.isArray(policy.imageReferences) ? policy.imageReferences : [];
  return Boolean(
    digests.length > 0 ||
    policy.imageDigest ||
    references.length > 0 ||
    policy.imageReference,
  );
}

/**
 * Build a verification policy from the published trust release. If
 * `release` is omitted, fetches it from `trustReleaseUrl`. The
 * audience defaults to "quill-cloud" — the gateway hard-codes this.
 *
 * Throws AttestationVerificationError when an image pin is malformed or the
 * release carries no image identity at all.
 */
export async function policyFromTrustRelease({
  release = null,
  audience = "quill-cloud",
  certSha256 = null,
  allowDebug = false,
  trustReleaseUrl = DEFAULT_TRUST_RELEASE_URL,
  fetchImpl = globalThis.fetch,
}: PolicyFromTrustReleaseOptions = {}): Promise<AttestationPolicy> {
  if (release === null) {
    release = await fetchTrustRelease({ trustUrl: trustReleaseUrl, fetchImpl });
  }
  const imageDigest = release?.image_digest == null
    ? null : readImagePin(release.image_digest, "image_digest", IMAGE_DIGEST);
  const publishedDigests = readImagePins(
    release?.accepted_image_digests, "accepted_image_digests", IMAGE_DIGEST,
  );
  const imageReference = release?.image_reference == null
    ? null : readImagePin(release.image_reference, "image_reference", IMAGE_REFERENCE);
  const publishedReferences = readImagePins(
    release?.accepted_image_references, "accepted_image_references", IMAGE_REFERENCE,
  );
  const policy: AttestationPolicy = {
    audience,
    certSha256,
    imageDigest,
    imageDigests: publishedDigests.length > 0
      ? publishedDigests
      : (imageDigest ? [imageDigest] : []),
    imageReference,
    imageReferences: publishedReferences.length > 0
      ? publishedReferences
      : (imageReference ? [imageReference] : []),
    allowDebug,
  };
  if (!pinsImageIdentity(policy)) {
    // A truncated body, an error page that happens to parse as JSON, or a
    // schema change all land here. Returning the policy anyway would leave the
    // caller believing it verified a specific build while both image checks
    // silently no-op, so refuse where the degraded input is still visible.
    throw new AttestationVerificationError(
      "trust release pins no image identity (none of image_digest, " +
      "accepted_image_digests, image_reference, accepted_image_references); " +
      "refusing to build a policy that would accept any Confidential Space workload",
    );
  }
  return policy;
}

/**
 * Verify a Confidential Space attestation JWT.
 *
 *   document       Uint8Array — the JWT bytes returned by client.attestation()
 *   policy         { audience, imageDigest, imageReference, certSha256? }
 *   nonceHex       The same nonce sent in the /attestation request (optional)
 *   tlsCertDer     Uint8Array — DER bytes of the gateway's leaf cert (optional)
 *   tlsExporter    Uint8Array — RFC 9266 exporter from the same TLS session
 *   jwks           pre-fetched Google JWKS (optional; will fetch if absent)
 *
 * Returns a GatewayAttestation object on success. Throws
 * AttestationVerificationError on any failure — never returns false.
 */
export function verifyGatewayAttestation(
  document: Uint8Array | string,
  opts: VerifyGatewayAttestationOptions,
): Promise<GatewayAttestation>;
export async function verifyGatewayAttestation(document: Uint8Array | string, {
  policy,
  nonceHex = null,
  tlsCertDer = null,
  tlsExporter = null,
  jwks = null,
  jwksUrl = GCP_JWKS_URI,
  fetchImpl = globalThis.fetch,
}: Partial<VerifyGatewayAttestationOptions> = {}): Promise<GatewayAttestation> {
  if (!policy) {
    throw new AttestationVerificationError("policy is required");
  }
  const payload = await verifiedJwtClaims(document, { jwks, jwksUrl, fetchImpl });
  return await checkClaims(payload, {
    policy,
    nonceHex,
    tlsCertDer,
    tlsExporter,
    bindingMode: "live-channel",
  });
}

/**
 * Verify a GCP Confidential Space key-binding attestation for a receipt key.
 *
 * This performs the same signature, issuer, audience, validity, debug,
 * hardware, and image-policy checks as verifyGatewayAttestation(), but omits
 * live TLS certificate/exporter binding. The receipt key commitment must occur
 * somewhere in the token's eat_nonce values.
 */
export function verifyReceiptKeyAttestation(
  document: Uint8Array | string,
  opts: VerifyReceiptKeyAttestationOptions,
): Promise<void>;
export async function verifyReceiptKeyAttestation(document: Uint8Array | string, {
  policy,
  keyCommitmentHex,
  jwks = null,
  jwksUrl = GCP_JWKS_URI,
  fetchImpl = globalThis.fetch,
}: Partial<VerifyReceiptKeyAttestationOptions> = {}): Promise<void> {
  if (!policy) {
    throw new AttestationVerificationError("policy is required");
  }
  if (typeof keyCommitmentHex !== "string" || !/^[0-9a-fA-F]{64}$/.test(keyCommitmentHex)) {
    throw new AttestationVerificationError(
      "receipt key commitment must be a 32-byte SHA-256 hex string",
    );
  }
  const payload = await verifiedJwtClaims(document, { jwks, jwksUrl, fetchImpl });
  await checkClaims(payload, {
    policy,
    nonceHex: keyCommitmentHex,
    tlsCertDer: null,
    tlsExporter: null,
    bindingMode: "receipt-key",
  });
}

// ---- internals ---------------------------------------------------------

// Verification uses exact string membership, so never trim, lowercase, or
// otherwise normalize release pins. Digests include the sha256: prefix.
const IMAGE_DIGEST = /^sha256:[0-9a-f]{64}$/;
const IMAGE_PATH_COMPONENT = "[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*";
// Container repository name, optional registry/port, tag and/or digest.
const IMAGE_REFERENCE = new RegExp(
  "^(?:[a-z0-9]+(?:[.-][a-z0-9]+)*(?::[0-9]+)?/)?" +
  IMAGE_PATH_COMPONENT + "(?:/" + IMAGE_PATH_COMPONENT + ")*" +
  "(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})?(?:@sha256:[0-9a-f]{64})?$",
);

function readImagePin(value: unknown, field: string, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new AttestationVerificationError(`trust release ${field} is not a valid image pin`);
  }
  return value;
}

function readImagePins(value: unknown, field: string, pattern: RegExp): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new AttestationVerificationError(`trust release ${field} must be an array of image pins`);
  }
  const values: unknown[] = value;
  // Array.from validates even holes in a caller-supplied sparse array.
  return Array.from(values, (entry, index) => readImagePin(entry, `${field}[${index}]`, pattern));
}

function b64urlDecode(segment: string) {
  const padded = segment + "=".repeat((4 - (segment.length % 4)) % 4);
  const b64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToString(bytes: Uint8Array) {
  return new TextDecoder().decode(bytes);
}

function parseJwt(document: Uint8Array | string) {
  const text = typeof document === "string"
    ? document
    : bytesToString(document);
  const parts = text.trim().split(".");
  if (parts.length !== 3) {
    throw new AttestationVerificationError(
      `expected 3 JWT segments, got ${parts.length}`,
    );
  }
  const [hB64, pB64, sB64] = parts as [string, string, string];
  let header: unknown, payload: unknown, signature;
  try {
    header = JSON.parse(bytesToString(b64urlDecode(hB64)));
    payload = JSON.parse(bytesToString(b64urlDecode(pB64)));
    signature = b64urlDecode(sB64);
  } catch (err) {
    throw new AttestationVerificationError(`invalid JWT encoding: ${(err as { message: unknown }).message}`);
  }
  const signingInput = new TextEncoder().encode(`${hB64}.${pB64}`);
  return { header, payload, signingInput, signature };
}

async function fetchJwks(url: string, fetchImpl: typeof fetch): Promise<Jwks> {
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
  const data: unknown = await response.json();
  if (!data || !Array.isArray((data as { keys?: unknown }).keys)) {
    throw new AttestationVerificationError("JWKS response missing `keys` array");
  }
  // Only the keys array is checked here; individual keys retain unknown fields.
  return data as Jwks;
}

async function verifyRs256(
  jwks: Jwks,
  header: Record<string, unknown>,
  signingInput: Uint8Array<ArrayBuffer>,
  signature: Uint8Array<ArrayBuffer>,
) {
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
      // WebCrypto validates the RSA fields; pass them through unchanged.
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true } as JsonWebKey,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
  } catch (err) {
    throw new AttestationVerificationError(`failed to import JWK: ${(err as { message: unknown }).message}`);
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

async function verifiedJwtClaims(
  document: Uint8Array | string,
  { jwks, jwksUrl, fetchImpl }: Required<JwtVerificationOptions>,
) {
  const { header, payload, signingInput, signature } = parseJwt(document);
  if (!jwks) {
    jwks = await fetchJwks(jwksUrl, fetchImpl);
  }
  // Preserve legacy property access (including failures on null headers).
  await verifyRs256(jwks, header as Record<string, unknown>, signingInput, signature);
  return payload as Record<string, unknown>;
}

async function checkClaims(claims: Record<string, unknown>, {
  policy,
  nonceHex,
  tlsCertDer,
  tlsExporter,
  bindingMode = "live-channel",
}: CheckClaimsOptions): Promise<GatewayAttestation> {
  if (bindingMode !== "live-channel" && bindingMode !== "receipt-key") {
    throw new AttestationVerificationError(
      `unsupported attestation binding mode ${JSON.stringify(bindingMode)}`,
    );
  }
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(claims.exp)) {
    throw new AttestationVerificationError("JWT is missing a valid expiration");
  }
  if ((claims.exp as number) <= now) {
    throw new AttestationVerificationError(
      `JWT expired at ${claims.exp} (now=${now})`,
    );
  }
  if (claims.iss !== GCP_ISSUER) {
    throw new AttestationVerificationError(
      `unexpected issuer ${JSON.stringify(claims.iss)}; expected ${GCP_ISSUER}`,
    );
  }
  if (!policy.allowDebug && claims.dbgstat !== "disabled-since-boot") {
    throw new AttestationVerificationError(
      "debug Confidential Space workload must report disabled-since-boot",
    );
  }
  if (claims.swname !== "CONFIDENTIAL_SPACE") {
    throw new AttestationVerificationError(
      "attested workload is not running Confidential Space",
    );
  }
  if (claims.secboot !== true) {
    throw new AttestationVerificationError(
      "attested workload does not report Secure Boot",
    );
  }
  if (!["GCP_AMD_SEV", "GCP_AMD_SEV_ES", "GCP_INTEL_TDX"].includes(claims.hwmodel as string)) {
    throw new AttestationVerificationError(
      `unsupported confidential hardware model ${JSON.stringify(claims.hwmodel)}`,
    );
  }
  let audList;
  if (typeof claims.aud === "string") {
    audList = [claims.aud];
  } else if (Array.isArray(claims.aud) && claims.aud.every((value: unknown): value is string => typeof value === "string")) {
    audList = claims.aud;
  } else {
    throw new AttestationVerificationError("JWT aud must be a string or string list");
  }
  if (!audList.includes(policy.audience)) {
    throw new AttestationVerificationError(
      `audience ${JSON.stringify(policy.audience)} not in JWT aud ${JSON.stringify(audList)}`,
    );
  }

  if (!pinsImageIdentity(policy)) {
    // Defence in depth for hand-built policies: both image checks below are
    // guarded on a non-empty accepted list, so reaching them with nothing
    // pinned would accept any attested workload.
    throw new AttestationVerificationError(
      "attestation policy pins no image identity; refusing to verify against a " +
      "policy that cannot distinguish the gateway from any other workload",
    );
  }

  // These projections preserve the legacy unchecked nested property reads.
  const submods = ((claims.submods || {}) as Record<string, unknown>).container || {};
  const imageDigest = (submods as Record<string, unknown>).image_digest ?? "";
  const imageReference = (submods as Record<string, unknown>).image_reference ?? "";
  if (typeof imageDigest !== "string" || typeof imageReference !== "string") {
    throw new AttestationVerificationError("JWT image_digest and image_reference must be strings when present");
  }

  const acceptedImageDigests = Array.isArray(policy.imageDigests) && policy.imageDigests.length > 0
    ? policy.imageDigests
    : (policy.imageDigest ? [policy.imageDigest] : []);
  if (acceptedImageDigests.length > 0 && !acceptedImageDigests.includes(imageDigest)) {
    throw new AttestationVerificationError(
      `image_digest mismatch: workload=${JSON.stringify(imageDigest)}, ` +
      `policy=${JSON.stringify(acceptedImageDigests)}`,
    );
  }
  const acceptedImageReferences = Array.isArray(policy.imageReferences) && policy.imageReferences.length > 0
    ? policy.imageReferences
    : (policy.imageReference ? [policy.imageReference] : []);
  if (acceptedImageReferences.length > 0 && !acceptedImageReferences.includes(imageReference)) {
    throw new AttestationVerificationError(
      `image_reference mismatch: workload=${JSON.stringify(imageReference)}, ` +
      `policy=${JSON.stringify(acceptedImageReferences)}`,
    );
  }

  // Nonce binding (replay defense)
  const eatNonces = claims.eat_nonce;
  let nonces = eatNonces || claims.nonces || [];
  if (typeof nonces === "string") nonces = [nonces];
  let nonceMatch = null;
  if (nonceHex !== null) {
    let noncePresent;
    if (bindingMode === "receipt-key") {
      const receiptNonces = typeof eatNonces === "string"
        ? [eatNonces]
        : (Array.isArray(eatNonces) ? eatNonces : []);
      noncePresent = hasNonce(receiptNonces, nonceHex);
    } else {
      noncePresent = hasNonce(nonces as Iterable<unknown>, nonceHex);
    }
    if (!noncePresent) {
      throw new AttestationVerificationError(
        `nonce ${JSON.stringify(nonceHex)} not present in JWT nonces ${JSON.stringify(nonces)}`,
      );
    }
    nonceMatch = nonceHex;
  }

  if (bindingMode === "live-channel" && tlsExporter !== null) {
    if (nonceHex === null) {
      throw new AttestationVerificationError(
        "fresh nonce required with exporter binding",
      );
    }
    const exporterHex = bytesToHex(tlsExporter);
    if (!hasNonce(nonces as Iterable<unknown>, exporterHex)) {
      throw new AttestationVerificationError(
        "TLS exporter not present in JWT nonces",
      );
    }
    // G6/RFC 9266 session binding needs both the fresh caller nonce and
    // exporter. A single-slot relay can echo one value, but cannot satisfy
    // this distinctness check and the exporter membership check together.
    if (constantTimeStringEqual(nonceHex.toLowerCase(), exporterHex)) {
      throw new AttestationVerificationError(
        "fresh nonce must be distinct from TLS exporter",
      );
    }
  }

  let certSha;
  if (bindingMode === "live-channel") {
    // Cert binding
    certSha = claims.tls_cert_sha256
      || claims.workload_tls_cert_sha256
      || (tlsCertDer ? findCertInNonces(nonces as Iterable<unknown>, await sha256Hex(tlsCertDer)) : null);
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
  } else {
    // A receipt attestation certifies a durable signing key. It is not
    // evidence about the verifier's current TLS connection.
    certSha = "";
  }

  return {
    certSha256: certSha,
    imageDigest,
    imageReference,
    nonce: nonceMatch,
    expiresAt: claims.exp as number,
    issuer: claims.iss ?? null,
    audience: policy.audience,
    rawClaims: claims,
  };
}

function findCertInNonces(nonces: Iterable<unknown>, certHex: string) {
  for (const n of nonces) {
    if (typeof n === "string" && constantTimeStringEqual(n.toLowerCase(), certHex)) {
      return n.toLowerCase();
    }
  }
  return null;
}

function hasNonce(nonces: Iterable<unknown>, expectedHex: string) {
  const expected = String(expectedHex).toLowerCase();
  let found = false;
  for (const n of nonces) {
    if (typeof n === "string") {
      found = constantTimeStringEqual(n.toLowerCase(), expected) || found;
    }
  }
  return found;
}

function constantTimeStringEqual(a: string, b: string) {
  const left = String(a);
  const right = String(b);
  const max = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < max; i++) {
    diff |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function bytesToHex(bytes: Uint8Array) {
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

async function sha256Hex(bytes: Uint8Array) {
  // Preserve the original view; WebCrypto rejects unsupported backing buffers.
  const buf = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  const arr = new Uint8Array(buf);
  let hex = "";
  for (const b of arr) hex += b.toString(16).padStart(2, "0");
  return hex;
}
