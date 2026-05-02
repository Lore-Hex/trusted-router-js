export declare const DEFAULT_API_BASE_URL = "https://api.quillrouter.com/v1";
export declare const DEFAULT_TRUST_RELEASE_URL =
  "https://trust.trustedrouter.com/trust/gcp-release.json";

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
  request(method: string, path: string, init?: RequestOptions): Promise<Record<string, unknown>>;
  chatCompletions(params: {
    model: string;
    messages: Array<Record<string, unknown>>;
    [key: string]: unknown;
  }): Promise<Record<string, unknown>>;
  models(): Promise<Record<string, unknown>>;
  credits(): Promise<Record<string, unknown>>;
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
