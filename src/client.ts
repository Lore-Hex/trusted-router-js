/**
 * L8 — CLIENT FACADE.
 *
 * `TrustedRouter` is endpoint wrappers only: constructor/config validation,
 * plane selection (inference = ranked baseUrls with aliases; control =
 * `_controlRequest` pinning `_baseUrls: [controlBaseUrl]`, whose length-1
 * candidate list makes failover structurally impossible), and delegation to
 * the transport engine. Zero loops, zero sleeps, zero candidate-index
 * references — those live only in ./internal/transport.js.
 *
 * `attestation()`, `status()`, and `trustRelease()` are documented
 * single-shot metadata fetches that stay outside the engine by design — as
 * is the client telemetry beacon (./internal/beacon.js), which this facade
 * creates lazily on the first inference call and flushes in `close()`.
 */

import { requireRecord, responseObject, responseTokens, userInfo, keyExchange, chatChunk } from "./internal/wire.js";
import { TelemetryReporter, sdkIdentity } from "./internal/beacon.js";
import {
  classifyError,
  jsonOrThrow,
  throwFromResponse,
} from "./internal/errors.js";
import {
  AUTO_MODEL,
  DEFAULT_API_BASE_URL,
  DEFAULT_CONTROL_BASE_URL,
  DEFAULT_REGION_PROBE_TIMEOUT_MS,
  DEFAULT_STATUS_URL,
  DEFAULT_TRUST_RELEASE_URL,
  FUSION_MODEL,
  modelsPath,
} from "./internal/models.js";
import {
  broadcastDestinationBody,
  chatCompletionBody,
  fusionTool,
  responsesBody,
} from "./internal/orchestration.js";
import {
  callbackUrlWithState,
  createOAuthPkcePair,
  randomOAuthState,
} from "./internal/pkce.js";
import { collectCompletion, iterSseChunks, iterSseEvents } from "./internal/sse.js";
import { resolveTelemetryEnabled } from "./internal/telemetry.js";
import {
  DEFAULT_USER_AGENT,
  baseUrls as inferenceBaseUrls,
  newIdempotencyKey,
  parseRetryAfter,
  requestJson,
  requestStream,
} from "./internal/transport.js";
import { fetchTrustRelease } from "./internal/trust.js";

import type {
  TrustedRouterOptions, TrustedRouterFetch, RequestOptions,
  ChatRequest, ChatCompletion, ChatCompletionChunk, FusionRequest,
  ModelListOptions, EmbeddingsRequest, MessagesRequest, ResponsesRequest,
  ResponseObject, ResponseInputTokens, BroadcastDestinationRequest,
  BillingCheckoutRequest, OAuthAuthorizeUrlOptions, CreateOAuthAuthorizationOptions,
  OAuthAuthorization, OAuthKeyExchangeRequest, OAuthKeyExchangeResponse, UserInfoResponse,
} from "./index.js";
import type { TransportRequestInit } from "./internal/transport.js";
import type { TelemetrySink } from "./internal/telemetry.js";

type ClientTelemetrySink = TelemetrySink & { close?: (options: { timeoutMs: number }) => void | Promise<void> };
interface InternalClientOptions extends TrustedRouterOptions {
  region?: unknown;
  failoverRegions?: unknown;
  _telemetrySink?: ClientTelemetrySink | null;
}

// SDK-only empty default preserves omitted-argument behavior; methods supply/check fields.
const EMPTY_CHATREQUEST = Object.freeze({}) as ChatRequest;
// SDK-only empty default preserves omitted-argument behavior; methods supply/check fields.
const EMPTY_FUSIONREQUEST = Object.freeze({}) as FusionRequest;
// SDK-only empty default preserves omitted-argument behavior; methods supply/check fields.
const EMPTY_RESPONSESREQUEST = Object.freeze({}) as ResponsesRequest;
// SDK-only empty default preserves omitted-argument behavior; methods supply/check fields.
const EMPTY_BROADCASTDESTINATIONREQUEST = Object.freeze({}) as BroadcastDestinationRequest;
// SDK-only empty default preserves omitted-argument behavior; methods supply/check fields.
const EMPTY_BILLINGCHECKOUTREQUEST = Object.freeze({}) as BillingCheckoutRequest;
// SDK-only empty default preserves omitted-argument behavior; methods supply/check fields.
const EMPTY_OMITBILLINGCHECKOUTREQUESTPAYMENTMETHOD = Object.freeze({}) as Omit<BillingCheckoutRequest, "paymentMethod">;
// SDK-only empty default preserves omitted-argument behavior; methods supply/check fields.
const EMPTY_OAUTHAUTHORIZEURLOPTIONS = Object.freeze({}) as OAuthAuthorizeUrlOptions;
// SDK-only empty default preserves omitted-argument behavior; methods supply/check fields.
const EMPTY_CREATEOAUTHAUTHORIZATIONOPTIONS = Object.freeze({}) as CreateOAuthAuthorizationOptions;
// SDK-only empty default preserves omitted-argument behavior; methods supply/check fields.
const EMPTY_OAUTHKEYEXCHANGEREQUEST = Object.freeze({}) as OAuthKeyExchangeRequest;

export class TrustedRouter {
  declare apiKey: string | null;
  declare baseUrl: string;
  declare controlBaseUrl: string;
  declare workspaceId: string | null;
  declare fetch: TrustedRouterFetch;
  declare defaultHeaders: Record<string, string>;
  declare maxRetries: number;
  declare regionalFailover: boolean;
  declare baseUrls: string[];
  declare regionProbeTimeout: number;
  declare regionAffinityPending: boolean;
  declare regionAffinityPromise: Promise<string[]> | null;
  declare telemetryEnabled: boolean;
  declare telemetrySampleRate: number;
  declare private _telemetrySink: ClientTelemetrySink | null;
  declare private _ownsTelemetryReporter: boolean;

  constructor(options?: TrustedRouterOptions);
  constructor({
    apiKey = null,
    baseUrl = null,
    controlBaseUrl = null,
    region = null,
    fetchImpl = globalThis.fetch,
    headers = {},
    workspaceId = null,
    maxRetries = 2,
    regionalFailover = true,
    regionalAffinity = null,
    regionProbeTimeout = DEFAULT_REGION_PROBE_TIMEOUT_MS,
    failoverRegions = null,
    telemetry = null,
    telemetrySampleRate = 0.01,
    _telemetrySink = null,
  }: InternalClientOptions = {}) {
    if (!fetchImpl) {
      throw new Error("A fetch implementation is required");
    }
    if (region !== null && region !== undefined) {
      throw new Error(
        "region pinning has been removed; use the global TrustedRouter apex",
      );
    }
    if (failoverRegions !== null && failoverRegions !== undefined) {
      throw new Error(
        "failoverRegions has been removed; the apex is a global load balancer",
      );
    }
    const useRegionalAffinity = !baseUrl && (
      regionalAffinity === null
        ? fetchImpl === globalThis.fetch
        : Boolean(regionalAffinity)
    );
    if (!baseUrl) {
      baseUrl = DEFAULT_API_BASE_URL;
    }
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.controlBaseUrl = (controlBaseUrl ?? DEFAULT_CONTROL_BASE_URL).replace(
      /\/+$/,
      "",
    );
    this.workspaceId = workspaceId;
    this.fetch = fetchImpl;
    this.defaultHeaders = headers;
    this.maxRetries = Math.max(0, Number.isFinite(maxRetries) ? maxRetries : 0);
    this.regionalFailover =
      regionalFailover === null ? true : Boolean(regionalFailover);
    this.baseUrls = inferenceBaseUrls(this.baseUrl);
    this.regionProbeTimeout = Math.max(100, Number(regionProbeTimeout) || 0);
    this.regionAffinityPending = useRegionalAffinity && this.regionalFailover;
    this.regionAffinityPromise = null;
    this.telemetryEnabled = resolveTelemetryEnabled(telemetry, {
      baseUrl: this.baseUrl,
      controlBaseUrl: this.controlBaseUrl,
      environ:
        typeof process !== "undefined" && process.env ? process.env : {},
    });
    this.telemetrySampleRate = telemetrySampleRate;
    this._telemetrySink = _telemetrySink ?? null;
    this._ownsTelemetryReporter = false;
  }

  /**
   * The beacon sink the engine hands finished records to: an injected sink,
   * or a TelemetryReporter created on the first inference call (client
   * telemetry contract v1 §6.2 — its own fetch, never this client's
   * fetchImpl; its worker starts on the first record, never here).
   */
  _telemetrySinkOrStart() {
    if (this._telemetrySink === null) {
      this._telemetrySink = new TelemetryReporter({
        controlBaseUrl: this.controlBaseUrl,
        apiKeyProvider: () => this.apiKey,
        workspaceId: this.workspaceId,
        sdkIdentity: sdkIdentity(),
        successSampleRate: this.telemetrySampleRate,
      });
      this._ownsTelemetryReporter = true;
    }
    return this._telemetrySink;
  }

  /**
   * Flush buffered client telemetry with one bounded attempt (default 2 s)
   * and stop its worker. Optional: the reporter also flushes once on
   * `beforeExit`; call this when the process ends via `process.exit()` or
   * when a client is discarded early.
   */
  async close({ timeoutMs = 2_000 }: { timeoutMs?: number } = {}): Promise<void> {
    const sink = this._telemetrySink;
    if (this._ownsTelemetryReporter && sink !== null && typeof sink.close === "function") {
      await sink.close({ timeoutMs });
    }
  }

  // ---- core request loop ----------------------------------------------

  request(method: string, path: string, init?: RequestOptions): Promise<Record<string, unknown>>;
  async request(method: string, path: string, init: TransportRequestInit = {}): Promise<Record<string, unknown>> {
    return requireRecord(await requestJson(this, method, path, init));
  }

  /**
   * Lower-level: returns the raw Response without parsing. Used by the
   * streaming chat methods so callers (or downstream relays) can read
   * the SSE bytes directly.
   */
  async rawRequest(method: string, path: string, init: RequestOptions = {}): Promise<Response> {
    return requestStream(this, method, path, init);
  }

  _controlRequest(method: string, path: string, init: RequestOptions & Pick<TransportRequestInit, "_credentialFree"> = {}): Promise<Record<string, unknown>> {
    const requestInit = { ...init };
    if (
      requestInit._credentialFree !== true &&
      requestInit.idempotencyKey == null &&
      !["GET", "HEAD", "OPTIONS", "TRACE"].includes(String(method).toUpperCase())
    ) {
      requestInit.idempotencyKey = newIdempotencyKey();
    }
    const controlInit = { ...requestInit, _baseUrls: [this.controlBaseUrl] };
    return this.request(method, path, controlInit);
  }

  // ---- chat ------------------------------------------------------------

  chatCompletions(options?: ChatRequest): Promise<ChatCompletion>;
  async chatCompletions({
    model = AUTO_MODEL,
    messages,
    apiKey = null,
    extraHeaders = null,
    idempotencyKey = null,
    workspaceId = null,
    timeout = null,
    signal = null,
    ...params
  }: ChatRequest = EMPTY_CHATREQUEST): Promise<ChatCompletion> {
    // The gateway always streams. Collect chunks into an OpenAI-shape
    // chat.completion dict so callers that asked for non-streaming
    // still get a single result back.
    const chunks = [];
    for await (const chunk of this.chatCompletionsChunks({
      model,
      messages,
      apiKey,
      extraHeaders,
      idempotencyKey,
      workspaceId,
      timeout,
      signal,
      ...params,
    })) {
      chunks.push(chunk);
    }
    return collectCompletion(chunks);
  }

  /** Yield each parsed `chat.completion.chunk` as a plain object. */
  chatCompletionsChunks(options?: ChatRequest): AsyncIterable<ChatCompletionChunk>;
  async *chatCompletionsChunks({
    model = AUTO_MODEL,
    messages,
    apiKey = null,
    extraHeaders = null,
    idempotencyKey = null,
    workspaceId = null,
    timeout = null,
    signal = null,
    ...params
  }: ChatRequest = EMPTY_CHATREQUEST) {
    const requestIdempotencyKey = idempotencyKey ?? newIdempotencyKey();
    const response = await this.rawRequest("POST", "/chat/completions", {
      headers: { accept: "text/event-stream" },
      body: chatCompletionBody({ model, messages, params }),
      apiKey,
      extraHeaders,
      idempotencyKey: requestIdempotencyKey,
      workspaceId,
      timeout,
      signal,
    });
    if (!response.ok) {
      await throwFromResponse(response);
    }
    for await (const chunk of iterSseChunks(response)) yield chatChunk(chunk);
  }

  /** Yield only the text deltas — the simplest streaming consumer. */
  async *chatCompletionsText(opts: ChatRequest = EMPTY_CHATREQUEST): AsyncIterable<string> {
    for await (const chunk of this.chatCompletionsChunks(opts)) {
      const text = chunk?.choices?.[0]?.delta?.content;
      if (typeof text === "string" && text.length > 0) {
        yield text;
      }
    }
  }

  /** Pass-through SSE bytes — for HTTP relays that don't want to decode. */
  chatCompletionsRawStream(options?: ChatRequest): AsyncIterable<Uint8Array>;
  async *chatCompletionsRawStream({
    model = AUTO_MODEL,
    messages,
    apiKey = null,
    extraHeaders = null,
    idempotencyKey = null,
    workspaceId = null,
    timeout = null,
    signal = null,
    ...params
  }: ChatRequest = EMPTY_CHATREQUEST) {
    const requestIdempotencyKey = idempotencyKey ?? newIdempotencyKey();
    const response = await this.rawRequest("POST", "/chat/completions", {
      headers: { accept: "text/event-stream" },
      body: chatCompletionBody({ model, messages, params }),
      apiKey,
      extraHeaders,
      idempotencyKey: requestIdempotencyKey,
      workspaceId,
      timeout,
      signal,
    });
    if (!response.ok) {
      await throwFromResponse(response);
    }
    // Node 20 fetch bodies implement async byte iteration; DOM typings omit that protocol.
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      yield chunk;
    }
  }

  // ---- fusion ----------------------------------------------------------

  /**
   * Run a request through TrustedRouter Fusion: fan it across a panel of
   * models and return one answer chosen/synthesized by a judge model. Returns
   * an OpenAI-shape chat.completion, same as `chatCompletions`. Pass
   * `fallbackJudges` so a single squeamish judge can't sink a prompt.
   */
  fusion(options?: FusionRequest): Promise<ChatCompletion>;
  async fusion({
    messages,
    analysisModels = null,
    model = null, // judge / synthesis model
    selectionStrategy = null,
    fallbackJudges = null,
    fallbackFinalModels = null,
    maxCompletionTokens = null,
    maxToolCalls = null,
    preset = null,
    ...params
  }: FusionRequest = EMPTY_FUSIONREQUEST): Promise<ChatCompletion> {
    return this.chatCompletions({
      model: FUSION_MODEL,
      messages,
      tools: [
        fusionTool({
          analysisModels,
          model,
          selectionStrategy,
          fallbackJudges,
          fallbackFinalModels,
          maxCompletionTokens,
          maxToolCalls,
          preset,
        }),
      ],
      ...params,
    });
  }

  // ---- catalog / metadata ---------------------------------------------

  models(options: ModelListOptions = {}) {
    return this._controlRequest("GET", modelsPath(options));
  }
  providers() {
    return this._controlRequest("GET", "/providers");
  }
  regions() {
    return this._controlRequest("GET", "/regions");
  }
  credits({ workspaceId = null }: { workspaceId?: string | null } = {}) {
    return this._controlRequest("GET", "/credits", { workspaceId });
  }

  embeddings({
    model,
    input,
    encodingFormat = null,
    dimensions = null,
    user = null,
    sessionId = null,
    trace = null,
    tags = null,
    provider = null,
    apiKey = null,
    extraHeaders = null,
    idempotencyKey = null,
    workspaceId = null,
    timeout = null,
    signal = null,
  }: EmbeddingsRequest) {
    const body: Record<string, unknown> = { model, input };
    if (encodingFormat !== null) body.encoding_format = encodingFormat;
    if (dimensions !== null) body.dimensions = dimensions;
    if (user !== null) body.user = user;
    if (sessionId !== null) body.session_id = sessionId;
    if (trace !== null) body.trace = trace;
    if (tags !== null) body.tags = tags;
    if (provider !== null) body.provider = provider;
    return this.request("POST", "/embeddings", {
      body,
      apiKey,
      extraHeaders,
      idempotencyKey: idempotencyKey ?? newIdempotencyKey(),
      workspaceId,
      timeout,
      signal,
    });
  }

  messages({
    model,
    messages,
    maxTokens = 1024,
    apiKey = null,
    extraHeaders = null,
    idempotencyKey = null,
    workspaceId = null,
    timeout = null,
    signal = null,
    ...params
  }: MessagesRequest) {
    return this.request("POST", "/messages", {
      body: { model, messages, max_tokens: maxTokens, ...params },
      apiKey,
      extraHeaders,
      idempotencyKey: idempotencyKey ?? newIdempotencyKey(),
      workspaceId,
      timeout,
      signal,
    });
  }

  responses(options: ResponsesRequest): Promise<ResponseObject>;
  async responses({
    model = AUTO_MODEL,
    input,
    instructions = null,
    apiKey = null,
    extraHeaders = null,
    idempotencyKey = null,
    workspaceId = null,
    timeout = null,
    signal = null,
    ...params
  }: ResponsesRequest = EMPTY_RESPONSESREQUEST): Promise<ResponseObject> {
    const requestIdempotencyKey = idempotencyKey ?? newIdempotencyKey();
    return responseObject(await this.request("POST", "/responses", {
      body: responsesBody({
        model,
        input,
        instructions,
        stream: false,
        params,
      }),
      apiKey,
      extraHeaders,
      idempotencyKey: requestIdempotencyKey,
      workspaceId,
      timeout,
      signal,
    }));
  }

  responsesEvents(options: ResponsesRequest): AsyncIterable<Record<string, unknown>>;
  async *responsesEvents({
    model = AUTO_MODEL,
    input,
    instructions = null,
    apiKey = null,
    extraHeaders = null,
    idempotencyKey = null,
    workspaceId = null,
    timeout = null,
    signal = null,
    ...params
  }: ResponsesRequest = EMPTY_RESPONSESREQUEST) {
    const requestIdempotencyKey = idempotencyKey ?? newIdempotencyKey();
    const response = await this.rawRequest("POST", "/responses", {
      headers: { accept: "text/event-stream" },
      body: responsesBody({ model, input, instructions, stream: true, params }),
      apiKey,
      extraHeaders,
      idempotencyKey: requestIdempotencyKey,
      workspaceId,
      timeout,
      signal,
    });
    if (!response.ok) {
      await throwFromResponse(response);
    }
    yield* iterSseEvents(response);
  }

  responsesRawStream(options: ResponsesRequest): AsyncIterable<Uint8Array>;
  async *responsesRawStream({
    model = AUTO_MODEL,
    input,
    instructions = null,
    apiKey = null,
    extraHeaders = null,
    idempotencyKey = null,
    workspaceId = null,
    timeout = null,
    signal = null,
    ...params
  }: ResponsesRequest = EMPTY_RESPONSESREQUEST) {
    const requestIdempotencyKey = idempotencyKey ?? newIdempotencyKey();
    const response = await this.rawRequest("POST", "/responses", {
      headers: { accept: "text/event-stream" },
      body: responsesBody({ model, input, instructions, stream: true, params }),
      apiKey,
      extraHeaders,
      idempotencyKey: requestIdempotencyKey,
      workspaceId,
      timeout,
      signal,
    });
    if (!response.ok) {
      await throwFromResponse(response);
    }
    // Node 20 fetch bodies implement async byte iteration; DOM typings omit that protocol.
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      yield chunk;
    }
  }

  responsesInputTokens(options: ResponsesRequest): Promise<ResponseInputTokens>;
  async responsesInputTokens({
    model = AUTO_MODEL,
    input,
    instructions = null,
    workspaceId = null,
    idempotencyKey = null,
    signal = null,
    ...params
  }: ResponsesRequest = EMPTY_RESPONSESREQUEST): Promise<ResponseInputTokens> {
    return responseTokens(await this.request("POST", "/responses/input_tokens", {
      body: responsesBody({
        model,
        input,
        instructions,
        stream: false,
        params,
      }),
      workspaceId,
      idempotencyKey: idempotencyKey ?? newIdempotencyKey(),
      signal,
    }));
  }

  broadcastDestinations({ workspaceId = null }: { workspaceId?: string | null } = {}) {
    return this._controlRequest("GET", "/broadcast/destinations", { workspaceId });
  }

  createBroadcastDestination(options: BroadcastDestinationRequest): Promise<Record<string, unknown>>;
  createBroadcastDestination({
    type,
    name = "Broadcast destination",
    endpoint = null,
    enabled = true,
    includeContent = false,
    method = "POST",
    headers = null,
    apiKey = null,
    workspaceId = null,
  }: BroadcastDestinationRequest = EMPTY_BROADCASTDESTINATIONREQUEST): Promise<Record<string, unknown>> {
    return this._controlRequest("POST", "/broadcast/destinations", {
      body: broadcastDestinationBody({
        type,
        name,
        endpoint,
        enabled,
        includeContent,
        method,
        headers,
        apiKey,
      }),
      workspaceId,
    });
  }

  getBroadcastDestination(id: string, { workspaceId = null }: { workspaceId?: string | null } = {}) {
    return this._controlRequest("GET", `/broadcast/destinations/${id}`, {
      workspaceId,
    });
  }

  updateBroadcastDestination(id: string, { workspaceId = null, ...patch }: Record<string, unknown> & { workspaceId?: string | null } = {}) {
    return this._controlRequest("PATCH", `/broadcast/destinations/${id}`, {
      body: Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined),
      ),
      workspaceId,
    });
  }

  deleteBroadcastDestination(id: string, { workspaceId = null }: { workspaceId?: string | null } = {}) {
    return this._controlRequest("DELETE", `/broadcast/destinations/${id}`, {
      workspaceId,
    });
  }

  testBroadcastDestination(id: string, { workspaceId = null }: { workspaceId?: string | null } = {}) {
    return this._controlRequest("POST", `/broadcast/destinations/${id}/test`, {
      workspaceId,
    });
  }

  async status(url: string = DEFAULT_STATUS_URL): Promise<Record<string, unknown>> {
    return requireRecord(await jsonOrThrow(
      await this.fetch(url, {
        headers: { "user-agent": DEFAULT_USER_AGENT },
        credentials: "omit",
        redirect: "manual",
      }),
    ));
  }

  // ---- billing + auth -------------------------------------------------

  billingCheckout(options: BillingCheckoutRequest): Promise<Record<string, unknown>>;
  billingCheckout({
    amount,
    paymentMethod = null,
    workspaceId = null,
    successUrl = null,
    cancelUrl = null,
    idempotencyKey = null,
  }: BillingCheckoutRequest = EMPTY_BILLINGCHECKOUTREQUEST): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = { amount };
    if (paymentMethod !== null) body.payment_method = paymentMethod;
    if (workspaceId !== null) body.workspace_id = workspaceId;
    if (successUrl !== null) body.success_url = successUrl;
    if (cancelUrl !== null) body.cancel_url = cancelUrl;
    return this._controlRequest("POST", "/billing/checkout", {
      body,
      idempotencyKey,
      workspaceId,
    });
  }

  stablecoinCheckout(req: Omit<BillingCheckoutRequest, "paymentMethod">): Promise<Record<string, unknown>>;
  stablecoinCheckout({ amount, ...params }: Omit<BillingCheckoutRequest, "paymentMethod"> = EMPTY_OMITBILLINGCHECKOUTREQUESTPAYMENTMETHOD) {
    return this.billingCheckout({
      amount,
      paymentMethod: "stablecoin",
      ...params,
    });
  }

  authSession() {
    return this._controlRequest("GET", "/auth/session");
  }
  logout() {
    return this._controlRequest("POST", "/auth/logout");
  }

  /**
   * Fetch the OIDC-style profile for the instance's delegated key.
   * GET /auth/userinfo with Authorization: Bearer <api_key>.
   * Returns the parsed body, e.g. { data: { sub, email, email_verified,
   * wallet_address, workspace_id, created_at } }.
   */
  async userInfo(): Promise<UserInfoResponse> {
    return userInfo(await this._controlRequest("GET", "/auth/userinfo"));
  }

  oauthAuthorizeUrl(options: OAuthAuthorizeUrlOptions): string;
  oauthAuthorizeUrl({
    callbackUrl,
    codeChallenge = null,
    codeChallengeMethod = codeChallenge ? "S256" : null,
    keyLabel = null,
    limit = null,
    usageLimitType = null,
    expiresAt = null,
    spawnAgent = null,
    spawnCloud = null,
    state = null,
  }: OAuthAuthorizeUrlOptions = EMPTY_OAUTHAUTHORIZEURLOPTIONS): string {
    if (!callbackUrl) throw new Error("callbackUrl is required");
    if (codeChallengeMethod && !codeChallenge) {
      throw new Error("codeChallenge is required when codeChallengeMethod is set");
    }
    const authorizeUrl = new URL(`${this.controlBaseUrl}/auth`);
    authorizeUrl.searchParams.set(
      "callback_url",
      state ? callbackUrlWithState(callbackUrl, state) : callbackUrl,
    );
    if (codeChallenge) authorizeUrl.searchParams.set("code_challenge", codeChallenge);
    if (codeChallengeMethod) {
      authorizeUrl.searchParams.set("code_challenge_method", codeChallengeMethod);
    }
    if (keyLabel) authorizeUrl.searchParams.set("key_label", keyLabel);
    if (limit !== null && limit !== undefined) {
      authorizeUrl.searchParams.set("limit", String(limit));
    }
    if (usageLimitType) authorizeUrl.searchParams.set("usage_limit_type", usageLimitType);
    if (expiresAt) authorizeUrl.searchParams.set("expires_at", expiresAt);
    if (spawnAgent) authorizeUrl.searchParams.set("spawn_agent", spawnAgent);
    if (spawnCloud) authorizeUrl.searchParams.set("spawn_cloud", spawnCloud);
    return authorizeUrl.toString();
  }

  createOAuthAuthorization(options: CreateOAuthAuthorizationOptions): Promise<OAuthAuthorization>;
  async createOAuthAuthorization({
    codeVerifier = null,
    state = randomOAuthState(),
    ...options
  }: CreateOAuthAuthorizationOptions = EMPTY_CREATEOAUTHAUTHORIZATIONOPTIONS): Promise<OAuthAuthorization> {
    const pkce = await createOAuthPkcePair({ codeVerifier });
    return {
      ...pkce,
      state,
      url: this.oauthAuthorizeUrl({
        ...options,
        state,
        codeChallenge: pkce.codeChallenge,
        codeChallengeMethod: pkce.codeChallengeMethod,
      }),
    };
  }

  exchangeOAuthKey(options: OAuthKeyExchangeRequest): Promise<OAuthKeyExchangeResponse>;
  async exchangeOAuthKey({
    code,
    codeVerifier = null,
    codeChallengeMethod = null,
    timeout = null,
  }: OAuthKeyExchangeRequest = EMPTY_OAUTHKEYEXCHANGEREQUEST): Promise<OAuthKeyExchangeResponse> {
    if (!code) throw new Error("code is required");
    const body: Record<string, unknown> = { code };
    if (codeVerifier) body.code_verifier = codeVerifier;
    if (codeChallengeMethod) body.code_challenge_method = codeChallengeMethod;
    return keyExchange(await this._controlRequest("POST", "/auth/keys", {
      body,
      apiKey: "",
      _credentialFree: true,
      credentials: "omit",
      timeout,
    }));
  }

  activity(params: Record<string, string | number | boolean | null | undefined> = {}) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        query.set(key, String(value));
      }
    }
    const suffix = query.size > 0 ? `?${query}` : "";
    return this._controlRequest("GET", `/activity${suffix}`);
  }

  // ---- attestation ----------------------------------------------------

  /** Fetch the gateway attestation JWT as raw bytes (Uint8Array). */
  async attestation() {
    // /attestation lives at the API ROOT, not under /v1.
    const url = this.baseUrl.replace(/\/v1$/, "") + "/attestation";
    const response = await this.fetch(url, {
      headers: { "user-agent": DEFAULT_USER_AGENT },
      credentials: "omit",
      redirect: "manual",
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw classifyError(
        response.status,
        text.slice(0, 240) || response.statusText,
        null,
        parseRetryAfter(response.headers),
      );
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  trustRelease(url: string = DEFAULT_TRUST_RELEASE_URL) {
    return fetchTrustRelease({ trustUrl: url, fetchImpl: this.fetch });
  }
}
