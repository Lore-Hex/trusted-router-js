export declare const VERSION: string;
export declare const DEFAULT_API_BASE_URL: "https://api.trustedrouter.com/v1";
export declare const DEFAULT_CONTROL_BASE_URL: "https://trustedrouter.com/v1";
export declare const DEFAULT_TRUST_RELEASE_URL: "https://trust.trustedrouter.com/trust/gcp-release.json";
export declare const DEFAULT_STATUS_URL: "https://status.trustedrouter.com/status.json";
export declare const DEFAULT_REGION_PROBE_TIMEOUT_MS: 1500;
export declare const REGION_BASE_URLS: ReadonlyArray<string>;
export declare const ALIAS_API_BASE_URLS: ReadonlyArray<string>;
export declare const AUTO_MODEL: "trustedrouter/auto";
export declare const FAST_MODEL: "trustedrouter/fast";
export declare const ZDR_MODEL: "trustedrouter/zdr";
export declare const E2E_MODEL: "trustedrouter/e2e";
export declare const CONFIDENTIAL_MODEL: "trustedrouter/confidential";
export declare const EU_MODEL: "trustedrouter/eu";
export declare const US_MODEL: "trustedrouter/us";
export declare const FUSION_MODEL: "trustedrouter/fusion";
export declare const SYNTH_MODEL: "trustedrouter/synth";
export declare const ADVISOR_MODEL: "trustedrouter/advisor";
export declare const SELECTOR_MODEL: "trustedrouter/selector";
export declare const MAP_REDUCE_MODEL: "trustedrouter/mapreduce";
export declare const SUBAGENT_MODEL: "trustedrouter/subagent";
export declare const SOCRATES_MODEL: "trustedrouter/socrates-1.1";
export declare const PROMETHEUS_MODEL: "trustedrouter/prometheus-2.0";
export declare const ZEUS_MODEL: "trustedrouter/zeus-1.0";
export declare const ATHENA_MODEL: "trustedrouter/athena";
export declare const FUSION_FREEDOM_PANEL: ReadonlyArray<string>;
export declare const FUSION_FREEDOM_FALLBACK_JUDGES: ReadonlyArray<string>;

// ---- client telemetry (contract v1) --------------------------------------

export declare const TELEMETRY_SCHEMA_VERSION: 1;
export declare const DEFAULT_TELEMETRY_PATH: "/client-events";
export declare const TELEMETRY_HOSTS: ReadonlyArray<string>;
export declare const TELEMETRY_ENDPOINTS: ReadonlyArray<string>;
export declare const TELEMETRY_OUTCOMES: ReadonlyArray<string>;
export declare const TELEMETRY_FINAL_OUTCOMES: ReadonlyArray<string>;
export declare const TELEMETRY_ERROR_CLASSES: ReadonlyArray<string>;

export declare function resolveTelemetryEnabled(
  explicit: boolean | null | undefined,
  options: {
    baseUrl: string;
    controlBaseUrl: string;
    environ: Record<string, string | undefined>;
  },
): boolean;

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

export declare function fusionTool(options?: FusionToolOptions): FusionTool;

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

export declare function advisorTool(options?: AdvisorToolOptions): AdvisorTool;

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
export declare function selectorTool(options?: SelectorToolOptions): SelectorTool;

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
export declare function mapReduceTool(options?: MapReduceToolOptions): MapReduceTool;

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
export declare function subagentTool(options?: SubagentToolOptions): SubagentTool;

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
export declare class ProviderPreferences {
  constructor(options?: ProviderPreferencesOptions);
  static zdr(): ProviderPreferences;
  static confidential(): ProviderPreferences;
  static usOnly(): ProviderPreferences;
  [key: string]: unknown;
}

// ---- error hierarchy ----------------------------------------------------

export declare class TrustedRouterError extends Error {
  statusCode: number;
  payload: unknown;
  layer: string | null;
  source: string | null;
  provider: string | null;
  requestId: string | null;
  constructor(statusCode: number, message: string, payload?: unknown);
}
export declare class BadRequestError extends TrustedRouterError {}
export declare class AuthenticationError extends TrustedRouterError {}
export declare class PermissionDeniedError extends TrustedRouterError {}
export declare class NotFoundError extends TrustedRouterError {}
export declare class EndpointNotSupportedError extends TrustedRouterError {}
export declare class RateLimitError extends TrustedRouterError {
  retryAfter: number | null;
  constructor(
    statusCode: number,
    message: string,
    payload?: unknown,
    retryAfter?: number | null,
  );
}
export declare class InternalError extends TrustedRouterError {}

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
   * Send the content-free x-tr-client reliability header on inference
   * attempts (client telemetry contract v1). Default: resolved from
   * TRUSTEDROUTER_TELEMETRY, then DO_NOT_TRACK, then on only for known
   * TrustedRouter base and control hosts.
   */
  telemetry?: boolean | null;
}

export interface PerCallOptions {
  apiKey?: string | null;
  extraHeaders?: Record<string, string> | null;
  workspaceId?: string | null;
  idempotencyKey?: string | null;
  /** Per-call timeout in milliseconds (uses AbortController). */
  timeout?: number | null;
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

export interface OAuthIdentity {
  sub: string;
  email?: string | null;
  email_verified?: boolean | null;
  wallet_address?: string | null;
  [extra: string]: unknown;
}

export interface UserInfoData {
  sub: string;
  email?: string | null;
  email_verified?: boolean | null;
  wallet_address?: string | null;
  workspace_id?: string | null;
  created_at?: string | null;
  [extra: string]: unknown;
}

export interface UserInfoResponse {
  data: UserInfoData;
}

export declare class TrustedRouter {
  apiKey: string | null;
  baseUrl: string;
  controlBaseUrl: string;
  fetch: TrustedRouterFetch;
  defaultHeaders: Record<string, string>;
  maxRetries: number;
  regionalFailover: boolean;
  baseUrls: string[];
  telemetryEnabled: boolean;
  constructor(options?: TrustedRouterOptions);

  request(
    method: string,
    path: string,
    init?: RequestOptions,
  ): Promise<Record<string, unknown>>;
  rawRequest(
    method: string,
    path: string,
    init?: RequestOptions,
  ): Promise<Response>;

  chatCompletions(req?: ChatRequest): Promise<ChatCompletion>;
  chatCompletionsChunks(req?: ChatRequest): AsyncIterable<ChatCompletionChunk>;
  chatCompletionsText(req?: ChatRequest): AsyncIterable<string>;
  chatCompletionsRawStream(req?: ChatRequest): AsyncIterable<Uint8Array>;
  fusion(req?: FusionRequest): Promise<ChatCompletion>;

  models(options?: ModelListOptions): Promise<Record<string, unknown>>;
  providers(): Promise<Record<string, unknown>>;
  regions(): Promise<Record<string, unknown>>;
  credits(options?: {
    workspaceId?: string | null;
  }): Promise<Record<string, unknown>>;
  embeddings(req: EmbeddingsRequest): Promise<Record<string, unknown>>;
  messages(req: MessagesRequest): Promise<Record<string, unknown>>;
  responses(req: ResponsesRequest): Promise<ResponseObject>;
  responsesEvents(
    req: ResponsesRequest,
  ): AsyncIterable<Record<string, unknown>>;
  responsesRawStream(req: ResponsesRequest): AsyncIterable<Uint8Array>;
  responsesInputTokens(req: ResponsesRequest): Promise<ResponseInputTokens>;
  broadcastDestinations(options?: {
    workspaceId?: string | null;
  }): Promise<Record<string, unknown>>;
  createBroadcastDestination(
    req: BroadcastDestinationRequest,
  ): Promise<Record<string, unknown>>;
  getBroadcastDestination(
    id: string,
    options?: { workspaceId?: string | null },
  ): Promise<Record<string, unknown>>;
  updateBroadcastDestination(
    id: string,
    patch?: Record<string, unknown> & { workspaceId?: string | null },
  ): Promise<Record<string, unknown>>;
  deleteBroadcastDestination(
    id: string,
    options?: { workspaceId?: string | null },
  ): Promise<Record<string, unknown>>;
  testBroadcastDestination(
    id: string,
    options?: { workspaceId?: string | null },
  ): Promise<Record<string, unknown>>;
  status(url?: string): Promise<Record<string, unknown>>;

  billingCheckout(
    req: BillingCheckoutRequest,
  ): Promise<Record<string, unknown>>;
  stablecoinCheckout(
    req: Omit<BillingCheckoutRequest, "paymentMethod">,
  ): Promise<Record<string, unknown>>;
  authSession(): Promise<Record<string, unknown>>;
  logout(): Promise<Record<string, unknown>>;
  userInfo(): Promise<UserInfoResponse>;
  oauthAuthorizeUrl(options: OAuthAuthorizeUrlOptions): string;
  createOAuthAuthorization(
    options: CreateOAuthAuthorizationOptions,
  ): Promise<OAuthAuthorization>;
  exchangeOAuthKey(
    req: OAuthKeyExchangeRequest,
  ): Promise<OAuthKeyExchangeResponse>;
  activity(
    params?: Record<string, string | number | boolean | null | undefined>,
  ): Promise<Record<string, unknown>>;

  attestation(): Promise<Uint8Array>;
  trustRelease(url?: string): Promise<Record<string, unknown>>;
}

export declare function fetchTrustRelease(options?: {
  trustUrl?: string;
  fetchImpl?: TrustedRouterFetch;
}): Promise<Record<string, unknown>>;

export { fetchTrustRelease as trustRelease };

export declare function randomOAuthState(options?: {
  byteLength?: number;
}): string;

export declare function createOAuthPkcePair(options?: {
  codeVerifier?: string | null;
}): Promise<OAuthPkcePair>;

export declare function collectCompletion(
  chunks: ChatCompletionChunk[],
): ChatCompletion;
