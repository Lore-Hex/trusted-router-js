export declare const VERSION: string;
export declare const DEFAULT_API_BASE_URL: "https://api.quillrouter.com/v1";
export declare const DEFAULT_TRUST_RELEASE_URL: "https://trust.trustedrouter.com/trust/gcp-release.json";
export declare const AUTO_MODEL: "trustedrouter/auto";
export declare const REGION_HOSTS: Readonly<Record<string, string>>;

export declare function regionBaseUrl(region: string): string;

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
export declare class RateLimitError extends TrustedRouterError {
  retryAfter: number | null;
  constructor(statusCode: number, message: string, payload?: unknown, retryAfter?: number | null);
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
  maxRetries?: number;
}

export interface PerCallOptions {
  apiKey?: string | null;
  extraHeaders?: Record<string, string> | null;
  idempotencyKey?: string | null;
  /** Per-call timeout in milliseconds (uses AbortController). */
  timeout?: number | null;
}

export interface RequestOptions extends Omit<RequestInit, "headers" | "body">, PerCallOptions {
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

export interface BillingCheckoutRequest extends PerCallOptions {
  amount: string | number;
  paymentMethod?: string | null;
  workspaceId?: string | null;
  successUrl?: string | null;
  cancelUrl?: string | null;
}

export declare class TrustedRouter {
  apiKey: string | null;
  baseUrl: string;
  region: string | null;
  fetch: TrustedRouterFetch;
  defaultHeaders: Record<string, string>;
  maxRetries: number;
  constructor(options?: TrustedRouterOptions);

  request(method: string, path: string, init?: RequestOptions): Promise<Record<string, unknown>>;
  rawRequest(method: string, path: string, init?: RequestOptions): Promise<Response>;

  chatCompletions(req?: ChatRequest): Promise<ChatCompletion>;
  chatCompletionsChunks(req?: ChatRequest): AsyncIterable<ChatCompletionChunk>;
  chatCompletionsText(req?: ChatRequest): AsyncIterable<string>;
  chatCompletionsRawStream(req?: ChatRequest): AsyncIterable<Uint8Array>;

  models(): Promise<Record<string, unknown>>;
  providers(): Promise<Record<string, unknown>>;
  regions(): Promise<Record<string, unknown>>;
  credits(): Promise<Record<string, unknown>>;
  embeddings(req: EmbeddingsRequest): Promise<Record<string, unknown>>;
  messages(req: MessagesRequest): Promise<Record<string, unknown>>;

  billingCheckout(req: BillingCheckoutRequest): Promise<Record<string, unknown>>;
  stablecoinCheckout(req: Omit<BillingCheckoutRequest, "paymentMethod">): Promise<Record<string, unknown>>;
  authSession(): Promise<Record<string, unknown>>;
  logout(): Promise<Record<string, unknown>>;
  activity(params?: Record<string, string | number | boolean | null | undefined>): Promise<Record<string, unknown>>;

  attestation(): Promise<Uint8Array>;
  trustRelease(url?: string): Promise<Record<string, unknown>>;
}

export declare function fetchTrustRelease(options?: {
  trustUrl?: string;
  fetchImpl?: TrustedRouterFetch;
}): Promise<Record<string, unknown>>;

export { fetchTrustRelease as trustRelease };

export declare function collectCompletion(chunks: ChatCompletionChunk[]): ChatCompletion;
