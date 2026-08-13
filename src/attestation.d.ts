export declare const GCP_ISSUER: "https://confidentialcomputing.googleapis.com";
export declare const GCP_JWKS_URI: string;
export declare const EXPORTER_LABEL: "EXPORTER-Channel-Binding";
export declare const EXPORTER_LENGTH: 32;

export declare class AttestationVerificationError extends Error {}

export interface AttestationPolicy {
  audience: string;
  imageDigest: string | null;
  imageDigests?: string[];
  imageReference: string | null;
  imageReferences?: string[];
  certSha256?: string | null;
  allowDebug?: boolean;
}

/**
 * Whether the policy constrains which workload image is acceptable. A policy
 * pinning neither a digest nor a reference cannot distinguish the gateway from
 * any other attested Confidential Space workload; both policy construction and
 * verification refuse one.
 */
export declare function pinsImageIdentity(policy: AttestationPolicy | null | undefined): boolean;

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
  allowDebug?: boolean;
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
