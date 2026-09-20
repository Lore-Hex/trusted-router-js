// The Node-only session consumer explicitly loads TLS types; tsconfig disables auto-loading.
/// <reference types="node" />

// Compile-only consumer contract: all public imports go through package exports.
import {
  TrustedRouter,
  collectCompletion,
  createOAuthPkcePair,
  verifyReceipt as verifyReceiptFromRoot,
  type TrustedRouterOptions,
  type ChatRequest,
  type ChatMessage,
  type ChatChoice,
  type ChatCompletion,
  type ChatCompletionChunk,
  type OAuthAuthorization,
  type OAuthIdentity,
} from "@lore-hex/trusted-router";
import {
  verifyReceipt,
  ReceiptCapture,
  MissingBindingError,
  ReceiptClaimsError,
  type ReceiptClaims,
  type VerifyReceiptOptions,
} from "@lore-hex/trusted-router/receipts";
import {
  policyFromTrustRelease,
  verifyGatewayAttestation,
  verifyReceiptKeyAttestation,
  type AttestationPolicy,
  type GatewayAttestation,
} from "@lore-hex/trusted-router/attestation";
import {
  BrowserOAuthFlow,
  type BrowserOAuthCallbackResult,
  type BrowserOAuthInitiateResult,
} from "@lore-hex/trusted-router/oauth";
import {
  verifyGatewaySession,
  fetchAttestationAgain,
  type GatewaySession,
} from "@lore-hex/trusted-router/session";

const options: TrustedRouterOptions = {
  apiKey: "example-key",
  baseUrl: "https://api.trustedrouter.com/v1",
  fetchImpl: fetch,
  maxRetries: 2,
  regionalFailover: true,
  telemetry: false,
  headers: { "x-example": "consumer" },
};
const client = new TrustedRouter(options);
// @ts-expect-error Retry counts must be numeric.
new TrustedRouter({ maxRetries: "two" });

const message: ChatMessage = { role: "user", content: "Hello" };
const request: ChatRequest = {
  model: "trustedrouter/auto",
  messages: [message],
  maxCompletionTokens: 64,
  signal: new AbortController().signal,
};
const completion: ChatCompletion = await client.chatCompletions(request);
const completionKind: "chat.completion" = completion.object;
const choice: ChatChoice | undefined = completion.choices[0];
if (choice) {
  const text: string | null = choice.message.content;
  const index: number = choice.index;
  // @ts-expect-error Message content can be null and is not a number.
  const numericContent: number = choice.message.content;
}
// @ts-expect-error A supplied chat request requires messages.
client.chatCompletions({ model: "trustedrouter/auto" });
// @ts-expect-error Message content is text or null.
const invalidMessage: ChatMessage = { role: "user", content: 123 };
const chunks: AsyncIterable<ChatCompletionChunk> = client.chatCompletionsChunks(request);
for await (const chunk of chunks) {
  const kind: "chat.completion.chunk" | undefined = chunk.object;
  const delta: string | null | undefined = chunk.choices[0]?.delta?.content;
}
const collected: ChatCompletion = collectCompletion([
  { object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "Hi" } }] },
]);
const rawResponse: Response = await client.rawRequest("GET", "/models");
const body: ReadableStream<Uint8Array> | null = rawResponse.body;

const bytes = new TextEncoder().encode("exact wire bytes");
const issuer = "https://api.trustedrouter.com";
const bound: VerifyReceiptOptions = {
  expectedIssuer: issuer,
  requestBody: bytes,
  responseBody: bytes,
  attestation: bytes,
};
const verified: ReceiptClaims = await verifyReceipt("compact-jws", bound);
const issuerClaim: string = verified.iss;
const status: "verified" | "unverified_by_this_sdk" = verified.attestationStatus;
const hashAlgorithm: "sha256" = verified.req.alg;
const rootResult: Promise<ReceiptClaims> = verifyReceiptFromRoot("compact-jws", bound);
const streamResult: Promise<ReceiptClaims> = verifyReceipt("compact-jws", {
  expectedIssuer: issuer, requestBody: bytes, responseStream: bytes, requireBindings: true,
});
const inspection: Promise<ReceiptClaims> = verifyReceipt("compact-jws", {
  expectedIssuer: issuer, requireBindings: false, requireAttestation: false,
});
verifyReceipt("compact-jws", { expectedIssuer: issuer, requireBindings: false, requestBody: bytes });
const bindingError: ReceiptClaimsError = new MissingBindingError("missing traffic");
// @ts-expect-error Verification always requires options.
verifyReceipt("compact-jws");
// @ts-expect-error Issuer pinning cannot be omitted, even with traffic bindings.
verifyReceipt("compact-jws", { requestBody: bytes, responseBody: bytes });
// @ts-expect-error Inspection still requires an expected issuer.
verifyReceipt("compact-jws", { requireBindings: false });
// @ts-expect-error Default verification requires both traffic bindings.
verifyReceipt("compact-jws", { expectedIssuer: issuer });
// @ts-expect-error Request bytes are required by default.
verifyReceipt("compact-jws", { expectedIssuer: issuer, responseBody: bytes });
// @ts-expect-error Response bytes or a response stream are required by default.
verifyReceipt("compact-jws", { expectedIssuer: issuer, requestBody: bytes });
// @ts-expect-error Null request bytes do not bind traffic.
verifyReceipt("compact-jws", { expectedIssuer: issuer, requestBody: null, responseBody: bytes });
// @ts-expect-error Null response bytes do not bind traffic.
verifyReceipt("compact-jws", { expectedIssuer: issuer, requestBody: bytes, responseBody: null });
// @ts-expect-error Explicit binding enforcement still requires traffic.
verifyReceipt("compact-jws", { expectedIssuer: issuer, requireBindings: true });
// @ts-expect-error Exactly one response representation may be supplied.
verifyReceipt("compact-jws", { expectedIssuer: issuer, requestBody: bytes, responseBody: bytes, responseStream: bytes });
// @ts-expect-error Bytes must be supplied without lossy string conversion.
verifyReceipt("compact-jws", { expectedIssuer: issuer, requestBody: "text", responseBody: bytes });
// @ts-expect-error Verification resolves to claims; failure rejects, never returns false.
const falseResult: Promise<false> = verifyReceipt("compact-jws", bound);

const capture = new ReceiptCapture(client.chatCompletionsRawStream(request));
const capturedClaims: Promise<ReceiptClaims> = capture.verify({ expectedIssuer: issuer, requestBody: bytes });
capture.verify({ expectedIssuer: issuer, requireBindings: false });
const capturedBytes: Uint8Array = capture.capturedBytes;
for await (const chunk of capture) {
  const raw: Uint8Array = chunk;
}
// @ts-expect-error Capture supplies the response binding, but still needs request bytes.
capture.verify({ expectedIssuer: issuer });
// @ts-expect-error Capture does not bypass issuer pinning.
capture.verify({ requestBody: bytes });
// @ts-expect-error Capture supplies responseStream itself and rejects overrides at runtime.
capture.verify({ expectedIssuer: issuer, requestBody: bytes, responseStream: bytes });
// @ts-expect-error A response body conflicts with the captured stream.
capture.verify({ expectedIssuer: issuer, requestBody: bytes, responseBody: bytes });

const policy: AttestationPolicy = await policyFromTrustRelease({ fetchImpl: fetch });
const attestation: GatewayAttestation = await verifyGatewayAttestation(bytes, {
  policy, nonceHex: "0123", tlsCertDer: bytes, tlsExporter: bytes,
});
const certificateHash: string = attestation.certSha256;
const receiptKeyVerification: Promise<void> = verifyReceiptKeyAttestation(bytes, {
  policy, keyCommitmentHex: "0123",
});
// @ts-expect-error Attestation verification requires a policy.
verifyGatewayAttestation(bytes, {});
// @ts-expect-error Receipt-key attestation requires the key commitment.
verifyReceiptKeyAttestation(bytes, { policy });

const session: GatewaySession = await verifyGatewaySession({
  baseUrl: issuer, policy, ca: "PEM certificate", timeoutMs: 5000,
});
const sessionAttestation: GatewayAttestation = await fetchAttestationAgain(session, { nonceHex: "0123" });
const exporter: Uint8Array = session.exporter;
const authorized: boolean = session.socket.authorized;
session.socket.destroy();
// @ts-expect-error Session verification requires a policy.
verifyGatewaySession({ baseUrl: issuer });
// @ts-expect-error Session verification requires a base URL.
verifyGatewaySession({ policy });

const pkce = await createOAuthPkcePair();
const method: "S256" = pkce.codeChallengeMethod;
const authorization: OAuthAuthorization = await client.createOAuthAuthorization({
  callbackUrl: "https://example.com/callback", codeVerifier: pkce.codeVerifier,
});
const exchanged = await client.exchangeOAuthKey({ code: "authorization-code", codeVerifier: authorization.codeVerifier });
const apiKey: string = exchanged.key;
const identity: OAuthIdentity | null | undefined = exchanged.identity;
const flow = new BrowserOAuthFlow("https://example.com/callback", { client, storage: sessionStorage });
const initiated: BrowserOAuthInitiateResult = await flow.initiate({ keyLabel: "Browser app" });
const callback: BrowserOAuthCallbackResult = await flow.handleCallback(new URLSearchParams("code=example"));
const callbackKey: string = callback.key;
const callbackIdentity: OAuthIdentity | null = callback.identity;
flow.clear();
// @ts-expect-error Browser flow requires a client.
new BrowserOAuthFlow("https://example.com/callback", {});
// @ts-expect-error OAuth authorization requires a callback URL.
client.createOAuthAuthorization({});
// @ts-expect-error OAuth exchange requires a code.
client.exchangeOAuthKey({ codeVerifier: pkce.codeVerifier });
