/**
 * Browser-side OAuth (PKCE) convenience flow for TrustedRouter.
 *
 * Wraps the lower-level helpers on the TrustedRouter client
 * (createOAuthAuthorization + exchangeOAuthKey) with the small amount
 * of stateful bookkeeping a single-page app needs: it stashes the CSRF
 * `state` and the PKCE `codeVerifier` in sessionStorage across the
 * browser redirect, then validates + clears them on the way back.
 *
 *   const flow = new BrowserOAuthFlow("https://app.example/auth/callback", {
 *     client: new TrustedRouter(),
 *   });
 *   const { url } = await flow.initiate({ keyLabel: "My App", limit: "5" });
 *   location.assign(url); // user approves in TrustedRouter, redirects back
 *   // ...on the callback page:
 *   const { key, user_id, identity } = await flow.handleCallback();
 *
 * Uses only Web Crypto + sessionStorage — no native deps. The actual
 * URL building and key exchange live on the TrustedRouter instance, so
 * this stays a thin, faithful wrapper over the live backend contract.
 */

import { isRecord } from "./internal/records.js";
import type {
  TrustedRouter,
  CreateOAuthAuthorizationOptions,
  OAuthIdentity,
} from "./index.js";

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

const STORAGE_KEY = "_tr_oauth";

interface StoredOAuthState {
  codeVerifier: string;
  state?: string;
}

export class BrowserOAuthError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = "BrowserOAuthError";
  }
}

export class BrowserOAuthFlow {
  declare callbackUrl: string;
  declare client: TrustedRouter;
  declare storageKey: string;
  declare private _storage: Storage | null;

  /**
   * @param {string} callbackUrl - the redirect target registered for this
   *   app; TrustedRouter sends the user back here with ?code & ?state.
   * @param {object} options
   * @param {import("./index.js").TrustedRouter} options.client - a
   *   TrustedRouter instance used to build the authorize URL and exchange
   *   the code for a delegated key.
   * @param {Storage} [options.storage] - storage backend; defaults to
   *   globalThis.sessionStorage.
   * @param {string} [options.storageKey] - sessionStorage key to use.
   */
  constructor(callbackUrl: string, options: BrowserOAuthFlowOptions);
  constructor(callbackUrl: string, { client, storage = null, storageKey = STORAGE_KEY }: Partial<BrowserOAuthFlowOptions> = {}) {
    if (!callbackUrl) throw new BrowserOAuthError("callbackUrl is required");
    if (!client) throw new BrowserOAuthError("a TrustedRouter client is required");
    this.callbackUrl = callbackUrl;
    this.client = client;
    this.storageKey = storageKey;
    this._storage = storage;
  }

  get storage(): Storage {
    const store = this._storage ?? globalThis.sessionStorage;
    if (!store) {
      throw new BrowserOAuthError(
        "sessionStorage is unavailable; pass { storage } explicitly",
      );
    }
    return store;
  }

  /**
   * Build the authorize URL and persist {state, codeVerifier} so the
   * callback can validate the redirect. Returns { url, state }.
   * @param {object} [opts] - forwarded to createOAuthAuthorization
   *   (keyLabel, limit, usageLimitType, expiresAt, spawnAgent, spawnCloud,
   *   state, codeVerifier, ...).
   */
  async initiate(opts: BrowserOAuthInitiateOptions = {}): Promise<BrowserOAuthInitiateResult> {
    const authorization = await this.client.createOAuthAuthorization({
      ...opts,
      callbackUrl: this.callbackUrl,
    });
    this.storage.setItem(
      this.storageKey,
      JSON.stringify({
        state: authorization.state,
        codeVerifier: authorization.codeVerifier,
      }),
    );
    return { url: authorization.url, state: authorization.state };
  }

  /**
   * Complete the flow: read the stashed {state, codeVerifier}, validate
   * the returned state against it, exchange code+verifier for a delegated
   * key, then clear storage. Returns { key, user_id, identity }.
   * @param {URLSearchParams|string|null} [searchParams] - the callback
   *   query params; defaults to globalThis.location.search.
   */
  async handleCallback(searchParams: URLSearchParams | string | null = null): Promise<BrowserOAuthCallbackResult> {
    const params = toSearchParams(searchParams);
    const stored = this._readStored();

    const returnedState = params.get("state");
    if (stored.state) {
      if (!returnedState) {
        throw new BrowserOAuthError("missing state in OAuth callback");
      }
      if (returnedState !== stored.state) {
        throw new BrowserOAuthError("OAuth state mismatch");
      }
    }

    const code = params.get("code");
    if (!code) throw new BrowserOAuthError("missing code in OAuth callback");

    let exchanged;
    try {
      exchanged = await this.client.exchangeOAuthKey({
        code,
        codeVerifier: stored.codeVerifier,
      });
    } finally {
      this.clear();
    }

    return {
      key: exchanged.key,
      user_id: exchanged.user_id ?? params.get("user_id") ?? null,
      identity: exchanged.identity ?? null,
    };
  }

  /** Remove any persisted OAuth state. Safe to call at any time. */
  clear(): void {
    try {
      this.storage.removeItem(this.storageKey);
    } catch {
      /* ignore */
    }
  }

  private _readStored(): StoredOAuthState {
    let raw;
    try {
      raw = this.storage.getItem(this.storageKey);
    } catch {
      raw = null;
    }
    if (!raw) {
      throw new BrowserOAuthError(
        "no pending OAuth flow found; call initiate() first",
      );
    }
    let stored: unknown;
    try {
      stored = JSON.parse(raw);
    } catch {
      throw new BrowserOAuthError("stored OAuth state is corrupt");
    }

    if (!isRecord(stored)) {
      this.clear();
      throw new BrowserOAuthError(
        "stored OAuth state is malformed: expected an object with string codeVerifier",
      );
    }
    const codeVerifier = Object.hasOwn(stored, "codeVerifier") ? stored.codeVerifier : undefined;
    if (typeof codeVerifier !== "string" || codeVerifier.length === 0) {
      this.clear();
      throw new BrowserOAuthError(
        "stored OAuth state is malformed: codeVerifier must be a non-empty string",
      );
    }
    if (Object.hasOwn(stored, "state")) {
      if (typeof stored.state !== "string") {
        this.clear();
        throw new BrowserOAuthError(
          "stored OAuth state is malformed: state must be a string",
        );
      }
      return { codeVerifier, state: stored.state };
    }
    return { codeVerifier };
  }
}

function toSearchParams(searchParams: URLSearchParams | string | null): URLSearchParams {
  if (searchParams instanceof URLSearchParams) return searchParams;
  if (typeof searchParams === "string") return new URLSearchParams(searchParams);
  const search = globalThis.location?.search;
  if (typeof search !== "string") {
    throw new BrowserOAuthError(
      "no search params available; pass them to handleCallback()",
    );
  }
  return new URLSearchParams(search);
}
