export declare const GCP_ISSUER: "https://confidentialcomputing.googleapis.com";
export declare const GCP_JWKS_URI: string;
export declare const EXPORTER_LABEL: "EXPORTER-Channel-Binding";
export declare const EXPORTER_LENGTH: 32;

export declare class AttestationVerificationError extends Error {}

export interface AttestationPolicy {
  audience: string;
  imageDigest: string | null;
  imageReference: string | null;
  certSha256?: string | null;
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

export declare function policyFromTrustRelease(opts?: {
  release?: Record<string, unknown> | null;
  audience?: string;
  certSha256?: string | null;
  trustReleaseUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<AttestationPolicy>;

export declare function verifyGatewayAttestation(
  document: Uint8Array | string,
  opts: {
    policy: AttestationPolicy;
    nonceHex?: string | null;
    tlsCertDer?: Uint8Array | null;
    tlsExporter?: Uint8Array | null;
    jwks?: { keys: Array<Record<string, unknown>> } | null;
    jwksUrl?: string;
    fetchImpl?: typeof fetch;
  },
): Promise<GatewayAttestation>;
