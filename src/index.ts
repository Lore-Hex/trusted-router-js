/**
 * TrustedRouter JavaScript SDK — public barrel (L9).
 *
 * OpenAI-compatible client for https://api.trustedrouter.com/v1. Mirrors
 * the Python SDK's surface so multi-language teams stay in sync: typed
 * errors, automatic retries with backoff, apex load-balancer failover,
 * per-call extras (extraHeaders/idempotencyKey/timeout/apiKey/workspaceId),
 * and messages/activity wrappers.
 *
 * This file is a pure re-export shim over src/client.js and src/internal/*;
 * every name importable before the internal restructure keeps working.
 * Implementation layers: internal/transport.js (policy kernel + candidate
 * set + THE retry/failover engine + attempt assembly), internal/sse.js
 * (stream codec), internal/errors.js (error taxonomy), internal/models.js +
 * internal/orchestration.js (constants and tool builders), internal/pkce.js
 * (browser OAuth), internal/trust.js (trust-release fetch),
 * internal/telemetry.js + internal/beacon.js (content-free client
 * reliability telemetry: the x-tr-client header and the beacon channel).
 *
 * Attestation verification (`verifyGatewayAttestation`) lives in
 * ./attestation.js. TLS session pinning lives in the Node-only
 * @lore-hex/trusted-router/session subpath so browser root imports do not
 * pull Node built-ins.
 */

import type { ProviderPreferences } from "./internal/models.js";

export { TrustedRouter } from "./client.js";
export {
  AuthenticationError,
  BadRequestError,
  EndpointNotSupportedError,
  InternalError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  TrustedRouterError,
} from "./internal/errors.js";
export {
  ADVISOR_MODEL,
  ALIAS_API_BASE_URLS,
  ATHENA_MODEL,
  AUTO_MODEL,
  CONFIDENTIAL_MODEL,
  DEFAULT_API_BASE_URL,
  DEFAULT_CONTROL_BASE_URL,
  DEFAULT_REGION_PROBE_TIMEOUT_MS,
  DEFAULT_STATUS_URL,
  DEFAULT_TRUST_RELEASE_URL,
  E2E_MODEL,
  EU_MODEL,
  FAST_MODEL,
  FUSION_FREEDOM_FALLBACK_JUDGES,
  FUSION_FREEDOM_PANEL,
  FUSION_MODEL,
  MAP_REDUCE_MODEL,
  PROMETHEUS_MODEL,
  ProviderPreferences,
  REGION_BASE_URLS,
  SELECTOR_MODEL,
  SOCRATES_MODEL,
  SUBAGENT_MODEL,
  SYNTH_MODEL,
  US_MODEL,
  VERSION,
  ZDR_MODEL,
  ZEUS_MODEL,
} from "./internal/models.js";
export {
  advisorTool,
  fusionTool,
  mapReduceTool,
  selectorTool,
  subagentTool,
} from "./internal/orchestration.js";
export { createOAuthPkcePair, randomOAuthState } from "./internal/pkce.js";
export { collectCompletion } from "./internal/sse.js";
export {
  DEFAULT_TELEMETRY_PATH,
  TELEMETRY_ENDPOINTS,
  TELEMETRY_ERROR_CLASSES,
  TELEMETRY_FINAL_OUTCOMES,
  TELEMETRY_HOSTS,
  TELEMETRY_LATENCY_BUCKETS,
  TELEMETRY_OUTCOMES,
  TELEMETRY_SCHEMA_VERSION,
  TELEMETRY_TIMEOUT_PHASES,
  resolveTelemetryEnabled,
} from "./internal/telemetry.js";
export { fetchTrustRelease, trustRelease } from "./internal/trust.js";
export {
  MissingAttestationError,
  MissingBindingError,
  ReceiptAttestationError,
  ReceiptCapture,
  ReceiptClaimsError,
  ReceiptHashError,
  ReceiptHeaderError,
  ReceiptIssuerError,
  ReceiptNonceError,
  ReceiptSignatureError,
  ReceiptStructureError,
  ReceiptTimeError,
  ReceiptUpstreamError,
  ReceiptVerificationError,
  UnsupportedAttestationError,
  verifyReceipt,
} from "./receipts.js";

export type {
  FlattenedReceiptJws,
  ReceiptAttestationStatus,
  ReceiptClaims,
  ReceiptHashClaims,
  ReceiptModelClaims,
  ReceiptResponseDomain,
  ReceiptRoute,
  ReceiptUpstreamClaims,
  VerifyReceiptOptions,
} from "./receipts.js";

export type FusionSelectionStrategy =
  | "synthesize"
  | "synthesize_non_refusals"
  | "first_success"
  | "first_non_refusal";

export interface FusionToolOptions {
  enabled?: boolean | null;
  analysisModels?: string[] | null;
  /** judge / synthesis model */
  model?: string | null;
  selectionStrategy?: FusionSelectionStrategy | string | null;
  fallbackJudges?: string[] | null;
  fallbackFinalModels?: string[] | null;
  maxCompletionTokens?: number | null;
  maxToolCalls?: number | null;
  preset?: "quality" | "budget" | "frontier" | null;
  panelPrompt?: string | null;
  synthesisPrompt?: string | null;
}

export interface FusionTool {
  type: "trustedrouter:fusion";
  parameters: Record<string, unknown>;
}

export interface AdvisorToolOptions {
  enabled?: boolean | null;
  depth?: number | null;
  workerModels?: string[] | null;
  advisorModels?: string[] | null;
  maxGetAdviceCalls?: number | null;
  advisorMaxTokens?: number | null;
  workerTimeoutMs?: number | null;
  advisorTimeoutMs?: number | null;
  autoInitialAdvice?: boolean | null;
}

export interface AdvisorTool {
  type: "trustedrouter:advisor";
  parameters: Record<string, unknown>;
}

export interface SelectorToolOptions {
  enabled?: boolean | null;
  analysisModels?: string[] | null;
  selectorModels?: string[] | null;
  selectorPrompt?: string | null;
  maxCompletionTokens?: number | null;
}

export interface SelectorTool {
  type: "trustedrouter:selector";
  parameters: Record<string, unknown>;
}

export interface MapReduceToolOptions {
  enabled?: boolean | null;
  mapperModels?: string[] | null;
  parallelModels?: string[] | null;
  reducerModels?: string[] | null;
  maxParts?: number | null;
  mapperPrompt?: string | null;
  parallelPrompt?: string | null;
  reducerPrompt?: string | null;
  maxCompletionTokens?: number | null;
}

export interface MapReduceTool {
  type: "trustedrouter:mapreduce";
  parameters: Record<string, unknown>;
}

export interface SubagentToolOptions {
  enabled?: boolean | null;
  controllerModel?: string | null;
  model?: string | null;
  instructions?: string | null;
  depth?: number | null;
  maxSubagentCalls?: number | null;
  maxCompletionTokens?: number | null;
  temperature?: number | null;
  reasoning?: unknown;
  tools?: Array<Record<string, unknown>> | null;
}

export interface SubagentTool {
  type: "trustedrouter:subagent";
  parameters: Record<string, unknown>;
}

export interface ProviderPreferencesOptions {
  order?: string[] | null;
  only?: string[] | null;
  ignore?: string[] | null;
  sort?: "price" | "latency" | "throughput" | null;
  allowFallbacks?: boolean | null;
  requireParameters?: boolean | null;
  dataCollection?: "allow" | "deny" | null;
  minPrivacy?: "any" | "no_store" | "zdr" | "confidential" | "e2e" | "e2ee" | null;
  jurisdiction?: "us" | null;
  usage?: "credits" | "byok" | null;
  quantizations?: string[] | null;
  maxPrice?: Record<string, unknown> | null;
}

// ---- client -------------------------------------------------------------

export type TrustedRouterHeaders = HeadersInit;

export type TrustedRouterFetch = typeof fetch;

export interface TrustedRouterOptions {
  apiKey?: string | null;
  baseUrl?: string | null;
  controlBaseUrl?: string | null;
  fetchImpl?: TrustedRouterFetch;
  headers?: Record<string, string>;
  workspaceId?: string | null;
  maxRetries?: number;
  /** Default: true. Retry connection and gateway failures across regions. */
  regionalFailover?: boolean | null;
  /**
   * Probe healthy regional endpoints once and pin the fastest for this client.
   * Defaults on for the global fetch implementation and off for injected fetches.
   */
  regionalAffinity?: boolean | null;
  /** Per-region health-probe timeout in milliseconds. Default: 1500. */
  regionProbeTimeout?: number;
  /**
   * Content-free client reliability telemetry (client telemetry contract
   * v1): the per-attempt x-tr-client header on inference attempts AND the
   * beacon channel — bounded batches of closed-enum events and exact
   * per-minute counters POSTed to `{controlBaseUrl}/client-events` by a
   * background worker that never keeps the process alive. Default: resolved
   * from TRUSTEDROUTER_TELEMETRY, then DO_NOT_TRACK, then on only for known
   * TrustedRouter base and control hosts. Opting out disables both channels.
   * Set TRUSTEDROUTER_TELEMETRY_DEBUG=1 to echo every batch to stderr.
   */
  telemetry?: boolean | null;
  /**
   * Fraction (0..1) of healthy, fast, first-attempt calls the beacon samples
   * as diagnostic events; failures, retries, and slow calls are always
   * retained, and exact counters are never sampled. Default: 0.01.
   */
  telemetrySampleRate?: number;
}

export interface PerCallOptions {
  apiKey?: string | null;
  extraHeaders?: Record<string, string> | null;
  workspaceId?: string | null;
  idempotencyKey?: string | null;
  /** Per-call timeout in milliseconds (uses AbortController). */
  timeout?: number | null;
  /** Cancel the logical request, including an open response body. */
  signal?: AbortSignal | null;
}

export type RequestTags = Record<string, string>;

export interface RequestOptions
  extends Omit<RequestInit, "headers" | "body" | "method" | "redirect">, PerCallOptions {
  headers?: TrustedRouterHeaders;
  body?: BodyInit | Record<string, unknown> | null;
}

export interface ModelListOptions {
  openWeights?: boolean | null;
  providerJurisdiction?: string | null;
  providerRegion?: string | null;
}

export interface ChatMessage {
  role: string;
  content: string | null;
  name?: string | null;
  reasoning?: string | null;
  reasoning_content?: string | null;
  refusal?: string | null;
  tool_calls?: Array<Record<string, unknown>> | null;
  function_call?: Record<string, unknown> | null;
  tool_call_id?: string | null;
  [extra: string]: unknown;
}

export interface ChatChoice {
  index: number;
  message: ChatMessage;
  finish_reason?: string | null;
  logprobs?: Record<string, unknown> | null;
  [extra: string]: unknown;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatCompletion {
  id: string;
  object: "chat.completion";
  created?: number;
  model?: string;
  choices: ChatChoice[];
  usage?: ChatUsage;
  [extra: string]: unknown;
}

export interface ChatCompletionChunk {
  id?: string;
  object?: "chat.completion.chunk";
  created?: number;
  model?: string;
  choices: Array<{
    index?: number;
    delta?: {
      role?: string;
      content?: string | null;
      reasoning?: string | null;
      reasoning_content?: string | null;
      refusal?: string | null;
      tool_calls?: unknown[];
      function_call?: Record<string, unknown> | null;
      [extra: string]: unknown;
    };
    finish_reason?: string | null;
  }>;
  [extra: string]: unknown;
}

export interface ChatRequest extends PerCallOptions {
  model?: string;
  messages: Array<Record<string, unknown>>;
  tags?: RequestTags | null;
  user?: string | null;
  session_id?: string | null;
  trace?: Record<string, unknown> | null;
  depth?: number | null;
  workerModels?: string[] | null;
  advisorModels?: string[] | null;
  maxGetAdviceCalls?: number | null;
  advisorMaxTokens?: number | null;
  advisorTimeoutMs?: number | null;
  analysisModels?: string[] | null;
  /** judge / synthesis model for direct trustedrouter/synth calls */
  judgeModel?: string | null;
  selectionStrategy?: FusionSelectionStrategy | string | null;
  fallbackJudges?: string[] | null;
  fallbackFinalModels?: string[] | null;
  maxCompletionTokens?: number | null;
  maxToolCalls?: number | null;
  preset?: "quality" | "budget" | "frontier" | string | null;
  panelPrompt?: string | null;
  synthesisPrompt?: string | null;
  finalPrompt?: string | null;
  selectorModels?: string[] | null;
  selectorModel?: string | null;
  selectorPrompt?: string | null;
  mapperModels?: string[] | null;
  mapperModel?: string | null;
  mapperPrompt?: string | null;
  parallelModels?: string[] | null;
  parallelModel?: string | null;
  parallelPrompt?: string | null;
  reducerModels?: string[] | null;
  reducerModel?: string | null;
  reducerPrompt?: string | null;
  [extra: string]: unknown;
}

export interface FusionRequest extends PerCallOptions, FusionToolOptions {
  messages: Array<Record<string, unknown>>;
  [extra: string]: unknown;
}

export interface EmbeddingsRequest extends PerCallOptions {
  model: string;
  input: string | string[] | number[] | number[][];
  encodingFormat?: string | null;
  dimensions?: number | null;
  user?: string | null;
  sessionId?: string | null;
  trace?: Record<string, unknown> | null;
  tags?: RequestTags | null;
  provider?: ProviderPreferences | ProviderPreferencesOptions | null;
}

export interface MessagesRequest extends PerCallOptions {
  model: string;
  messages: Array<Record<string, unknown>>;
  maxTokens?: number;
  tags?: RequestTags | null;
  [extra: string]: unknown;
}

export interface ResponsesRequest extends PerCallOptions {
  model?: string;
  input: string | Array<Record<string, unknown>>;
  instructions?: string | null;
  tags?: RequestTags | null;
  user?: string | null;
  session_id?: string | null;
  trace?: Record<string, unknown> | null;
  [extra: string]: unknown;
}

export interface ResponseObject {
  id: string;
  object: "response";
  created_at?: number;
  status?: string;
  model?: string | null;
  output?: Array<Record<string, unknown>>;
  usage?: Record<string, unknown> | null;
  [extra: string]: unknown;
}

export interface ResponseInputTokens {
  input_tokens: number;
  total_tokens?: number | null;
  [extra: string]: unknown;
}

export interface BroadcastDestinationRequest {
  type: "posthog" | "webhook" | string;
  name?: string;
  endpoint?: string | null;
  enabled?: boolean;
  includeContent?: boolean;
  method?: "POST" | "PUT";
  headers?: Record<string, string> | null;
  apiKey?: string | null;
  workspaceId?: string | null;
}

export interface BillingCheckoutRequest extends PerCallOptions {
  amount: string | number;
  paymentMethod?: string | null;
  workspaceId?: string | null;
  successUrl?: string | null;
  cancelUrl?: string | null;
}

export interface OAuthPkcePair {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
}

export interface OAuthAuthorizeUrlOptions {
  callbackUrl: string;
  codeChallenge?: string | null;
  codeChallengeMethod?: "S256" | "plain" | null;
  keyLabel?: string | null;
  limit?: string | number | null;
  usageLimitType?: "daily" | "weekly" | "monthly" | null;
  expiresAt?: string | null;
  spawnAgent?: string | null;
  spawnCloud?: string | null;
  state?: string | null;
}

export interface CreateOAuthAuthorizationOptions
  extends Omit<OAuthAuthorizeUrlOptions, "codeChallenge" | "codeChallengeMethod" | "state"> {
  codeVerifier?: string | null;
  state?: string | null;
}

export interface OAuthAuthorization extends OAuthPkcePair {
  state: string | null;
  url: string;
}

export interface OAuthKeyExchangeRequest {
  code: string;
  codeVerifier?: string | null;
  codeChallengeMethod?: "S256" | "plain" | null;
  timeout?: number | null;
}

export interface OAuthKeyExchangeResponse {
  key: string;
  user_id?: string | null;
  identity?: OAuthIdentity | null;
  data: Record<string, unknown>;
}

/** A sourced email-domain match, not proof of employment or investor endorsement. */
export interface CompanyAffiliation {
  company_name: string;
  funding_organization: string;
  relationship: string;
  domain: string;
  founding_year: number | null;
  source_url: string;
  checked_at: string;
  match_method: string;
}

export interface OAuthIdentity {
  sub: string;
  email?: string | null;
  email_verified?: boolean | null;
  wallet_address?: string | null;
  company_affiliations?: CompanyAffiliation[];
  [extra: string]: unknown;
}

export interface UserInfoData extends OAuthIdentity {
  workspace_id?: string | null;
  created_at?: string | null;
}

export interface UserInfoResponse {
  data: UserInfoData;
}
