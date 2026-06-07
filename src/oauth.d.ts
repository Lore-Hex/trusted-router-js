import type {
  TrustedRouter,
  CreateOAuthAuthorizationOptions,
  OAuthIdentity,
} from "./index.js";

export declare class BrowserOAuthError extends Error {}

export interface BrowserOAuthFlowOptions {
  client: TrustedRouter;
  /** Storage backend; defaults to globalThis.sessionStorage. */
  storage?: Storage | null;
  /** sessionStorage key to use; defaults to "_tr_oauth". */
  storageKey?: string;
}

export interface BrowserOAuthInitiateResult {
  url: string;
  state: string | null;
}

export interface BrowserOAuthCallbackResult {
  key: string;
  user_id: string | null;
  identity: OAuthIdentity | null;
}

export type BrowserOAuthInitiateOptions = Omit<
  CreateOAuthAuthorizationOptions,
  "callbackUrl"
>;

export declare class BrowserOAuthFlow {
  callbackUrl: string;
  client: TrustedRouter;
  storageKey: string;
  readonly storage: Storage;
  constructor(callbackUrl: string, options: BrowserOAuthFlowOptions);
  initiate(
    opts?: BrowserOAuthInitiateOptions,
  ): Promise<BrowserOAuthInitiateResult>;
  handleCallback(
    searchParams?: URLSearchParams | string | null,
  ): Promise<BrowserOAuthCallbackResult>;
  clear(): void;
}
