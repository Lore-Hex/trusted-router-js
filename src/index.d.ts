export declare const DEFAULT_API_BASE_URL = "https://api.quillrouter.com/v1";
export declare const DEFAULT_TRUST_RELEASE_URL =
  "https://trust.trustedrouter.com/trust/gcp-release.json";
export declare const AUTO_MODEL = "trustedrouter/auto";

export type TrustedRouterHeaders = HeadersInit;

export interface TrustedRouterOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface RequestOptions extends Omit<RequestInit, "headers" | "body"> {
  headers?: TrustedRouterHeaders;
  body?: BodyInit | Record<string, unknown> | null;
}

export declare class TrustedRouterError extends Error {
  statusCode: number;
  payload: unknown;
  constructor(statusCode: number, message: string, payload?: unknown);
}

export declare class TrustedRouter {
  apiKey?: string;
  baseUrl: string;
  fetch: typeof fetch;
  constructor(options?: TrustedRouterOptions);
  rawRequest(method: string, path: string, init?: RequestOptions): Promise<Response>;
  request(method: string, path: string, init?: RequestOptions): Promise<Record<string, unknown>>;
  chatCompletions(params: {
    model?: string;
    messages: Array<Record<string, unknown>>;
    [key: string]: unknown;
  }): Promise<Record<string, unknown>>;
  autoChatCompletions(params: {
    messages: Array<Record<string, unknown>>;
    [key: string]: unknown;
  }): Promise<Record<string, unknown>>;
  chatCompletionsChunks(params: {
    model?: string;
    messages: Array<Record<string, unknown>>;
    [key: string]: unknown;
  }): AsyncIterable<Record<string, unknown>>;
  chatCompletionsText(params: {
    model?: string;
    messages: Array<Record<string, unknown>>;
    [key: string]: unknown;
  }): AsyncIterable<string>;
  models(): Promise<Record<string, unknown>>;
  providers(): Promise<Record<string, unknown>>;
  regions(): Promise<Record<string, unknown>>;
  credits(): Promise<Record<string, unknown>>;
  billingCheckout(params: {
    amount: string | number;
    paymentMethod?: string;
    workspaceId?: string;
    successUrl?: string;
    cancelUrl?: string;
  }): Promise<Record<string, unknown>>;
  stablecoinCheckout(params: {
    amount: string | number;
    workspaceId?: string;
    successUrl?: string;
    cancelUrl?: string;
  }): Promise<Record<string, unknown>>;
  walletChallenge(address: string): Promise<Record<string, unknown>>;
  walletVerify(params: {
    address: string;
    message: string;
    signature: string;
  }): Promise<Record<string, unknown>>;
  authSession(): Promise<Record<string, unknown>>;
  logout(): Promise<Record<string, unknown>>;
  activity(params?: Record<string, string | number | boolean | null | undefined>): Promise<
    Record<string, unknown>
  >;
  trustRelease(url?: string): Promise<Record<string, unknown>>;
}

export declare function fetchTrustRelease(options?: {
  trustUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<Record<string, unknown>>;

export { fetchTrustRelease as trustRelease };
