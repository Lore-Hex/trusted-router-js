export declare const VERSION: string;
export declare const DEFAULT_API_BASE_URL: "https://api.quillrouter.com/v1";
export declare const DEFAULT_TRUST_RELEASE_URL: "https://trust.trustedrouter.com/trust/gcp-release.json";
export declare const DEFAULT_STATUS_URL: "https://status.trustedrouter.com/status.json";
export declare const AUTO_MODEL: "trustedrouter/auto";
export declare const FAST_MODEL: "trustedrouter/fast";
export declare const FUSION_MODEL: "trustedrouter/fusion";
export declare const SOCRATES_MODEL: "trustedrouter/socrates-1.0";
export declare const ADVISOR_MODEL: "trustedrouter/advisor";
export declare const FUSION_FREEDOM_PANEL: ReadonlyArray<string>;
export declare const FUSION_FREEDOM_FALLBACK_JUDGES: ReadonlyArray<string>;
export declare const REGION_HOSTS: Readonly<Record<string, string>>;
export declare const DEFAULT_FAILOVER_REGIONS: ReadonlyArray<string>;

export declare function regionBaseUrl(region: string): string;

export type FusionSelectionStrategy =
  | "synthesize"
  | "synthesize_non_refusals"
  | "first_success"
  | "first_non_refusal";

export interface FusionToolOptions {
  analysisModels?: string[] | null;
  /** judge / synthesis model */
  model?: string | null;
  selectionStrategy?: FusionSelectionStrategy | string | null;
  fallbackJudges?: string[] | null;
  fallbackFinalModels?: string[] | null;
  maxCompletionTokens?: number | null;
  maxToolCalls?: number | null;
  preset?: "quality" | "budget" | null;
}

export interface FusionTool {
  type: "trustedrouter:fusion";
  parameters: Record<string, unknown>;
}

export declare function fusionTool(options?: FusionToolOptions): FusionTool;

export interface AdvisorToolOptions {
  depth?: number | null;
  workerModels?: string[] | null;
  advisorModels?: string[] | null;
  maxGetAdviceCalls?: number | null;
  advisorMaxTokens?: number | null;
  advisorTimeoutMs?: number | null;
}

export interface AdvisorTool {
  type: "trustedrouter:advisor";
  parameters: Record<string, unknown>;
}

export declare function advisorTool(options?: AdvisorToolOptions): AdvisorTool;

// ---- error hierarchy ----------------------------------------------------

export declare class TrustedRouterError extends Error {
  statusCode: number;
  payload: unknown;
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
  region?: keyof typeof REGION_HOSTS | string | null;
  fetchImpl?: TrustedRouterFetch;
  headers?: Record<string, string>;
  workspaceId?: string | null;
  maxRetries?: number;
  regionalFailover?: boolean | null;
  failoverRegions?: string[] | readonly string[] | null;
}

export interface PerCallOptions {
  apiKey?: string | null;
  extraHeaders?: Record<string, string> | null;
  workspaceId?: string | null;
  idempotencyKey?: string | null;
  /** Per-call timeout in milliseconds (uses AbortController). */
  timeout?: number | null;
}

export interface RequestOptions
  extends Omit<RequestInit, "headers" | "body">, PerCallOptions {
  headers?: TrustedRouterHeaders;
  body?: BodyInit | Record<string, unknown> | null;
}

export interface ChatMessage {
  role: string;
  content: string | null;
  name?: string | null;
  tool_calls?: Array<Record<string, unknown>> | null;
  tool_call_id?: string | null;
}

export interface ChatChoice {
  index: number;
  message: ChatMessage;
  finish_reason?: string | null;
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
    delta?: { role?: string; content?: string | null; tool_calls?: unknown[] };
    finish_reason?: string | null;
  }>;
  [extra: string]: unknown;
}

export interface ChatRequest extends PerCallOptions {
  model?: string;
  messages: Array<Record<string, unknown>>;
  [extra: string]: unknown;
}

export interface FusionRequest extends PerCallOptions, FusionToolOptions {
  messages: Array<Record<string, unknown>>;
  [extra: string]: unknown;
}

export interface SocratesRequest extends PerCallOptions, AdvisorToolOptions {
  messages: Array<Record<string, unknown>>;
  model?: string;
  [extra: string]: unknown;
}

export interface EmbeddingsRequest extends PerCallOptions {
  model: string;
  input: string | string[] | number[] | number[][];
  encodingFormat?: string | null;
  dimensions?: number | null;
  user?: string | null;
}

export interface MessagesRequest extends PerCallOptions {
  model: string;
  messages: Array<Record<string, unknown>>;
  maxTokens?: number;
  [extra: string]: unknown;
}

export interface ResponsesRequest extends PerCallOptions {
  model?: string;
  input: string | Array<Record<string, unknown>>;
  instructions?: string | null;
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
  region: string | null;
  fetch: TrustedRouterFetch;
  defaultHeaders: Record<string, string>;
  maxRetries: number;
  baseUrls: string[];
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
  socrates(req?: SocratesRequest): Promise<ChatCompletion>;

  models(): Promise<Record<string, unknown>>;
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
