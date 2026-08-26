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

export interface VerifyReceiptOptions {
  requestBody?: ArrayBuffer | ArrayBufferView | null;
  responseBody?: ArrayBuffer | ArrayBufferView | null;
  responseStream?: ArrayBuffer | ArrayBufferView | null;
  expectedNonce?: string | null;
  maxAgeSeconds?: number | null;
  now?: number | null;
  requireAttestation?: boolean;
}

export declare class ReceiptVerificationError extends Error {}
export declare class ReceiptStructureError extends ReceiptVerificationError {}
export declare class ReceiptHeaderError extends ReceiptVerificationError {}
export declare class ReceiptSignatureError extends ReceiptVerificationError {}
export declare class ReceiptClaimsError extends ReceiptVerificationError {}
export declare class ReceiptTimeError extends ReceiptClaimsError {}
export declare class ReceiptNonceError extends ReceiptClaimsError {}
export declare class ReceiptUpstreamError extends ReceiptClaimsError {}
export declare class ReceiptHashError extends ReceiptVerificationError {}
export declare class ReceiptAttestationError extends ReceiptVerificationError {}
export declare class MissingAttestationError extends ReceiptAttestationError {}
export declare class UnsupportedAttestationError extends ReceiptAttestationError {}

export declare function verifyReceipt(
  receipt: string | ArrayBuffer | ArrayBufferView | FlattenedReceiptJws,
  options?: VerifyReceiptOptions,
): Promise<ReceiptClaims>;

export declare class ReceiptCapture implements AsyncIterableIterator<Uint8Array> {
  constructor(source: AsyncIterable<Uint8Array> | Iterable<Uint8Array>);
  readonly receipt: FlattenedReceiptJws | null;
  readonly capturedBytes: Uint8Array;
  next(): Promise<IteratorResult<Uint8Array>>;
  return(value?: unknown): Promise<IteratorResult<Uint8Array>>;
  [Symbol.asyncIterator](): AsyncIterableIterator<Uint8Array>;
  verify(options?: Omit<VerifyReceiptOptions, "responseStream">): Promise<ReceiptClaims>;
}
