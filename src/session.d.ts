export interface GatewaySession {
  attestation: import("./attestation.js").GatewayAttestation;
  socket: import("node:tls").TLSSocket;
  exporter: Uint8Array;
  leafDer: Uint8Array;
}

export interface VerifyGatewaySessionOptions {
  baseUrl: string;
  policy: import("./attestation.js").AttestationPolicy;
  jwks?: { keys: Array<Record<string, unknown>> } | null;
  jwksUrl?: string;
  connectIp?: string | null;
  timeoutMs?: number;
  /** Optional trust roots, useful for verified loopback tests. */
  ca?: import("node:tls").ConnectionOptions["ca"] | null;
}

export declare function verifyGatewaySession(
  options: VerifyGatewaySessionOptions,
): Promise<GatewaySession>;

export declare function fetchAttestationAgain(
  session: GatewaySession,
  options?: { nonceHex?: string },
): Promise<Uint8Array>;
