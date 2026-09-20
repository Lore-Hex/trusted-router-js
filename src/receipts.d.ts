export type ReceiptAttestationStatus = "verified" | "unverified_by_this_sdk";
export type ReceiptRoute = "chat.completions" | "responses";
export type ReceiptResponseDomain = "body" | "sse-data-v1" | "sse-events-v1";

export interface FlattenedReceiptJws {
  protected: string;
  payload: string;
  signature: string;
  [key: string]: unknown;
}

export interface ReceiptHashClaims {
  alg: "sha256";
  hash: string;
  of: ReceiptResponseDomain;
  events: number | null;
}

export interface ReceiptModelClaims {
  requested: string;
  selected: string;
  provider: string;
  endpoint: string;
}

export interface ReceiptUpstreamClaims {
  tier: "tee-verified" | "tls-webpki";
  policy: string | null;
  verifiedAt: number | null;
  verificationExpiresAt: number | null;
  certSha256: string | null;
}

export interface ReceiptClaims {
  rv: 1;
  iss: string;
  iat: number;
  jti: string;
  gen: string | null;
  nonce: string | null;
  route: ReceiptRoute;
  req: ReceiptHashClaims & { of: "body"; events: null };
  resp: ReceiptHashClaims;
  model: ReceiptModelClaims;
  upstream: ReceiptUpstreamClaims;
  attSha256: string | null;
  attestationStatus: ReceiptAttestationStatus;
  /** Alias of attestationStatus. */
  attestation: ReceiptAttestationStatus;
}

interface ReceiptVerificationOptions {
  /** HTTPS origin that must match the signed iss claim after origin normalization. */
  expectedIssuer: string;
  expectedNonce?: string | null;
  maxAgeSeconds?: number | null;
  now?: number | null;
  /** Exact GCP CS JWT bytes pinned by att_sha256 or embedded in a flattened receipt. */
  attestation?: ArrayBuffer | ArrayBufferView | null;
  requireAttestation?: boolean;
}

type ReceiptBytes = ArrayBuffer | ArrayBufferView;

/** Both traffic bindings are required unless inspection is explicitly requested. */
export type VerifyReceiptOptions = ReceiptVerificationOptions & (
  | ({ requireBindings?: true; requestBody: ReceiptBytes } & (
      | { responseBody: ReceiptBytes; responseStream?: null }
      | { responseStream: ReceiptBytes; responseBody?: null }
    ))
  | ({ requireBindings: false; requestBody?: ReceiptBytes | null } & (
      | { responseBody?: ReceiptBytes | null; responseStream?: null }
      | { responseStream?: ReceiptBytes | null; responseBody?: null }
    ))
);

export declare class ReceiptVerificationError extends Error {}
export declare class ReceiptStructureError extends ReceiptVerificationError {}
export declare class ReceiptHeaderError extends ReceiptVerificationError {}
export declare class ReceiptSignatureError extends ReceiptVerificationError {}
export declare class ReceiptClaimsError extends ReceiptVerificationError {}
export declare class MissingBindingError extends ReceiptClaimsError {}
export declare class ReceiptIssuerError extends ReceiptClaimsError {}
export declare class ReceiptTimeError extends ReceiptClaimsError {}
export declare class ReceiptNonceError extends ReceiptClaimsError {}
export declare class ReceiptUpstreamError extends ReceiptClaimsError {}
export declare class ReceiptHashError extends ReceiptVerificationError {}
export declare class ReceiptAttestationError extends ReceiptVerificationError {}
export declare class MissingAttestationError extends ReceiptAttestationError {}
export declare class UnsupportedAttestationError extends ReceiptAttestationError {}

export declare function verifyReceipt(
  receipt: string | ArrayBuffer | ArrayBufferView | FlattenedReceiptJws,
  options: VerifyReceiptOptions,
): Promise<ReceiptClaims>;

export declare class ReceiptCapture implements AsyncIterableIterator<Uint8Array> {
  constructor(source: AsyncIterable<Uint8Array> | Iterable<Uint8Array>);
  readonly receipt: FlattenedReceiptJws | null;
  readonly capturedBytes: Uint8Array;
  next(): Promise<IteratorResult<Uint8Array>>;
  return(value?: unknown): Promise<IteratorResult<Uint8Array>>;
  [Symbol.asyncIterator](): AsyncIterableIterator<Uint8Array>;
  /** Supplies the response stream from captured bytes; the request is still required. */
  verify(options: ReceiptVerificationOptions & { responseBody?: null; responseStream?: never } & (
    | { requireBindings?: true; requestBody: ReceiptBytes }
    | { requireBindings: false; requestBody?: ReceiptBytes | null }
  )): Promise<ReceiptClaims>;
}
