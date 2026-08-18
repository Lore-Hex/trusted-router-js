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
 * single-shot metadata fetches that stay outside the engine by design.
 */

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

export class TrustedRouter {
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
  } = {}) {
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
  }

  // ---- core request loop ----------------------------------------------

  async request(method, path, init = {}) {
    return requestJson(this, method, path, init);
  }

  /**
   * Lower-level: returns the raw Response without parsing. Used by the
   * streaming chat methods so callers (or downstream relays) can read
   * the SSE bytes directly.
   */
  async rawRequest(method, path, init = {}) {
    return requestStream(this, method, path, init);
  }

  _controlRequest(method, path, init = {}) {
    const requestInit = { ...init };
    if (
      requestInit._credentialFree !== true &&
      requestInit.idempotencyKey == null &&
      !["GET", "HEAD", "OPTIONS", "TRACE"].includes(String(method).toUpperCase())
    ) {
      requestInit.idempotencyKey = newIdempotencyKey();
    }
    return this.request(method, path, {
      ...requestInit,
      _baseUrls: [this.controlBaseUrl],
    });
  }

  // ---- chat ------------------------------------------------------------

  async chatCompletions({
    model = AUTO_MODEL,
    messages,
    apiKey = null,
    extraHeaders = null,
    idempotencyKey = null,
    workspaceId = null,
    timeout = null,
    ...params
  } = {}) {
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
      ...params,
    })) {
      chunks.push(chunk);
    }
    return collectCompletion(chunks);
  }

  /** Yield each parsed `chat.completion.chunk` as a plain object. */
  async *chatCompletionsChunks({
    model = AUTO_MODEL,
    messages,
    apiKey = null,
    extraHeaders = null,
    idempotencyKey = null,
    workspaceId = null,
    timeout = null,
    ...params
  } = {}) {
    const requestIdempotencyKey = idempotencyKey ?? newIdempotencyKey();
    const response = await this.rawRequest("POST", "/chat/completions", {
      headers: { accept: "text/event-stream" },
      body: chatCompletionBody({ model, messages, params }),
      apiKey,
      extraHeaders,
      idempotencyKey: requestIdempotencyKey,
      workspaceId,
      timeout,
    });
    if (!response.ok) {
      await throwFromResponse(response);
    }
    yield* iterSseChunks(response);
  }

  /** Yield only the text deltas — the simplest streaming consumer. */
  async *chatCompletionsText(opts = {}) {
    for await (const chunk of this.chatCompletionsChunks(opts)) {
      const text = chunk?.choices?.[0]?.delta?.content;
      if (typeof text === "string" && text.length > 0) {
        yield text;
      }
    }
  }

  /** Pass-through SSE bytes — for HTTP relays that don't want to decode. */
  async *chatCompletionsRawStream({
    model = AUTO_MODEL,
    messages,
    apiKey = null,
    extraHeaders = null,
    idempotencyKey = null,
    workspaceId = null,
    timeout = null,
    ...params
  } = {}) {
    const requestIdempotencyKey = idempotencyKey ?? newIdempotencyKey();
    const response = await this.rawRequest("POST", "/chat/completions", {
      headers: { accept: "text/event-stream" },
      body: chatCompletionBody({ model, messages, params }),
      apiKey,
      extraHeaders,
      idempotencyKey: requestIdempotencyKey,
      workspaceId,
      timeout,
    });
    if (!response.ok) {
      await throwFromResponse(response);
    }
    for await (const chunk of response.body) {
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
  } = {}) {
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

  models(options = {}) {
    return this._controlRequest("GET", modelsPath(options));
  }
  providers() {
    return this._controlRequest("GET", "/providers");
  }
  regions() {
    return this._controlRequest("GET", "/regions");
  }
  credits({ workspaceId = null } = {}) {
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
  }) {
    const body = { model, input };
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
    ...params
  }) {
    return this.request("POST", "/messages", {
      body: { model, messages, max_tokens: maxTokens, ...params },
      apiKey,
      extraHeaders,
      idempotencyKey: idempotencyKey ?? newIdempotencyKey(),
      workspaceId,
      timeout,
    });
  }

  responses({
    model = AUTO_MODEL,
    input,
    instructions = null,
    apiKey = null,
    extraHeaders = null,
    idempotencyKey = null,
    workspaceId = null,
    timeout = null,
    ...params
  } = {}) {
    const requestIdempotencyKey = idempotencyKey ?? newIdempotencyKey();
    return this.request("POST", "/responses", {
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
    });
  }

  async *responsesEvents({
    model = AUTO_MODEL,
    input,
    instructions = null,
    apiKey = null,
    extraHeaders = null,
    idempotencyKey = null,
    workspaceId = null,
    timeout = null,
    ...params
  } = {}) {
    const requestIdempotencyKey = idempotencyKey ?? newIdempotencyKey();
    const response = await this.rawRequest("POST", "/responses", {
      headers: { accept: "text/event-stream" },
      body: responsesBody({ model, input, instructions, stream: true, params }),
      apiKey,
      extraHeaders,
      idempotencyKey: requestIdempotencyKey,
      workspaceId,
      timeout,
    });
    if (!response.ok) {
      await throwFromResponse(response);
    }
    yield* iterSseEvents(response);
  }

  async *responsesRawStream({
    model = AUTO_MODEL,
    input,
    instructions = null,
    apiKey = null,
    extraHeaders = null,
    idempotencyKey = null,
    workspaceId = null,
    timeout = null,
    ...params
  } = {}) {
    const requestIdempotencyKey = idempotencyKey ?? newIdempotencyKey();
    const response = await this.rawRequest("POST", "/responses", {
      headers: { accept: "text/event-stream" },
      body: responsesBody({ model, input, instructions, stream: true, params }),
      apiKey,
      extraHeaders,
      idempotencyKey: requestIdempotencyKey,
      workspaceId,
      timeout,
    });
    if (!response.ok) {
      await throwFromResponse(response);
    }
    for await (const chunk of response.body) {
      yield chunk;
    }
  }

  responsesInputTokens({
    model = AUTO_MODEL,
    input,
    instructions = null,
    workspaceId = null,
    idempotencyKey = null,
    ...params
  } = {}) {
    return this.request("POST", "/responses/input_tokens", {
      body: responsesBody({
        model,
        input,
        instructions,
        stream: false,
        params,
      }),
      workspaceId,
      idempotencyKey: idempotencyKey ?? newIdempotencyKey(),
    });
  }

  broadcastDestinations({ workspaceId = null } = {}) {
    return this._controlRequest("GET", "/broadcast/destinations", { workspaceId });
  }

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
  } = {}) {
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

  getBroadcastDestination(id, { workspaceId = null } = {}) {
    return this._controlRequest("GET", `/broadcast/destinations/${id}`, {
      workspaceId,
    });
  }

  updateBroadcastDestination(id, { workspaceId = null, ...patch } = {}) {
    return this._controlRequest("PATCH", `/broadcast/destinations/${id}`, {
      body: Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined),
      ),
      workspaceId,
    });
  }

  deleteBroadcastDestination(id, { workspaceId = null } = {}) {
    return this._controlRequest("DELETE", `/broadcast/destinations/${id}`, {
      workspaceId,
    });
  }

  testBroadcastDestination(id, { workspaceId = null } = {}) {
    return this._controlRequest("POST", `/broadcast/destinations/${id}/test`, {
      workspaceId,
    });
  }

  async status(url = DEFAULT_STATUS_URL) {
    return jsonOrThrow(
      await this.fetch(url, {
        headers: { "user-agent": DEFAULT_USER_AGENT },
        credentials: "omit",
        redirect: "manual",
      }),
    );
  }

  // ---- billing + auth -------------------------------------------------

  billingCheckout({
    amount,
    paymentMethod = null,
    workspaceId = null,
    successUrl = null,
    cancelUrl = null,
    idempotencyKey = null,
  } = {}) {
    const body = { amount };
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

  stablecoinCheckout({ amount, ...params } = {}) {
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
  userInfo() {
    return this._controlRequest("GET", "/auth/userinfo");
  }

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
  } = {}) {
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

  async createOAuthAuthorization({
    codeVerifier = null,
    state = randomOAuthState(),
    ...options
  } = {}) {
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

  exchangeOAuthKey({
    code,
    codeVerifier = null,
    codeChallengeMethod = null,
    timeout = null,
  } = {}) {
    if (!code) throw new Error("code is required");
    const body = { code };
    if (codeVerifier) body.code_verifier = codeVerifier;
    if (codeChallengeMethod) body.code_challenge_method = codeChallengeMethod;
    return this._controlRequest("POST", "/auth/keys", {
      body,
      apiKey: "",
      _credentialFree: true,
      credentials: "omit",
      timeout,
    });
  }

  activity(params = {}) {
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

  trustRelease(url = DEFAULT_TRUST_RELEASE_URL) {
    return fetchTrustRelease({ trustUrl: url, fetchImpl: this.fetch });
  }
}
