/**
 * TrustedRouter JavaScript SDK.
 *
 * OpenAI-compatible client for https://api.trustedrouter.com/v1.
 *
 * Mirrors the Python SDK's surface so multi-language teams stay in
 * sync: typed errors, automatic retries with backoff, apex load-balancer
 * failover, per-call extras
 * (extraHeaders/idempotencyKey/timeout/apiKey/workspaceId), and
 * messages/activity wrappers.
 *
 * Attestation verification (`verifyGatewayAttestation`) lives in
 * ./attestation.js. TLS session pinning lives in the Node-only
 * @lore-hex/trusted-router/session subpath so browser root imports do not
 * pull Node built-ins.
 */

import {
  ADVISOR_MODEL,
  ALIAS_API_BASE_URLS,
  AUTO_MODEL,
  DEFAULT_API_BASE_URL,
  DEFAULT_CONTROL_BASE_URL,
  DEFAULT_REGION_PROBE_TIMEOUT_MS,
  DEFAULT_STATUS_URL,
  DEFAULT_TRUST_RELEASE_URL,
  FUSION_MODEL,
  REGION_BASE_URLS,
  VERSION,
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

// ---- error hierarchy ---------------------------------------------------

export class TrustedRouterError extends Error {
  constructor(statusCode, message, payload) {
    super(message);
    this.name = "TrustedRouterError";
    this.statusCode = statusCode;
    this.payload = payload;
    const detail = payload?.error && typeof payload.error === "object"
      ? payload.error
      : (payload && typeof payload === "object" ? payload : {});
    this.layer = typeof detail.layer === "string" ? detail.layer : null;
    this.source = typeof detail.source === "string" ? detail.source : null;
    this.provider = typeof detail.provider === "string" ? detail.provider : null;
    this.requestId = typeof detail.request_id === "string" ? detail.request_id : null;
  }
}

export class BadRequestError extends TrustedRouterError {
  constructor(...args) {
    super(...args);
    this.name = "BadRequestError";
  }
}

export class AuthenticationError extends TrustedRouterError {
  constructor(...args) {
    super(...args);
    this.name = "AuthenticationError";
  }
}

export class PermissionDeniedError extends TrustedRouterError {
  constructor(...args) {
    super(...args);
    this.name = "PermissionDeniedError";
  }
}

export class NotFoundError extends TrustedRouterError {
  constructor(...args) {
    super(...args);
    this.name = "NotFoundError";
  }
}

export class EndpointNotSupportedError extends TrustedRouterError {
  constructor(...args) {
    super(...args);
    this.name = "EndpointNotSupportedError";
  }
}

export class RateLimitError extends TrustedRouterError {
  constructor(statusCode, message, payload, retryAfter = null) {
    super(statusCode, message, payload);
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
  }
}

export class InternalError extends TrustedRouterError {
  constructor(...args) {
    super(...args);
    this.name = "InternalError";
  }
}

function classifyError(statusCode, message, payload, retryAfter) {
  if (statusCode === 401)
    return new AuthenticationError(statusCode, message, payload);
  if (statusCode === 403)
    return new PermissionDeniedError(statusCode, message, payload);
  if (statusCode === 404)
    return new NotFoundError(statusCode, message, payload);
  if (statusCode === 429)
    return new RateLimitError(statusCode, message, payload, retryAfter);
  if (statusCode === 501)
    return new EndpointNotSupportedError(statusCode, message, payload);
  if (statusCode >= 400 && statusCode < 500)
    return new BadRequestError(statusCode, message, payload);
  if (statusCode >= 500) return new InternalError(statusCode, message, payload);
  return new TrustedRouterError(statusCode, message, payload);
}

function readHeader(headers, name) {
  return headers?.get?.(name) ?? headers?.[name] ?? null;
}

function parseRetryAfter(headers) {
  // retry-after-ms wins when both are present: it is the more precise of the
  // two, and a server that sends it means the sub-second value.
  const rawMs = readHeader(headers, "retry-after-ms");
  if (rawMs) {
    const ms = Number(String(rawMs).trim());
    if (Number.isFinite(ms) && ms >= 0) return ms / 1000;
  }
  const raw = readHeader(headers, "retry-after");
  if (!raw) return null;
  const n = Number(String(raw).trim());
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// The gateway's explicit verdict, which overrides every heuristic below it.
//
// A status code cannot say whether a provider already ran. A 502 from "could
// not reach the provider" and a 502 from "the generation succeeded and then
// settlement failed" are indistinguishable here, and only the second is
// dangerous to re-send. The gateway knows and says so. Same header OpenAI's
// clients honour.
//
// Returns null when the server did not say, which leaves existing behaviour
// untouched for older gateways and for deliberately unlabelled paths.
function shouldRetryVerdict(headers) {
  const raw = readHeader(headers, "x-should-retry");
  if (raw == null) return null;
  const value = String(raw).trim().toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

// ---- retry policy ------------------------------------------------------

function isRetryable(statusCode) {
  return statusCode === 429 || statusCode >= 500;
}

// May this move to a DIFFERENT domain. An explicit `x-should-retry: false`
// forbids it outright: that is the gateway saying a provider already ran, which
// is exactly when re-sending anywhere costs a second generation.
function isRegionalFailoverable(statusCode, headers) {
  if (shouldRetryVerdict(headers) === false) return false;
  return statusCode === 502 || statusCode === 503 || statusCode === 504;
}

function baseUrls(primaryBaseUrl) {
  // This list MUST have more than one entry or failover cannot engage: every
  // advance below is guarded by `baseIndex < requestBaseUrls.length - 1`, so a
  // single-entry list made those branches unreachable.
  //
  // Aliases are appended only for the default host. A caller who passed their
  // own baseUrl (private deployment, test server, regional pin) gets exactly
  // that; silently redirecting their traffic to a public alias would be worse
  // than failing.
  const primary = primaryBaseUrl.replace(/\/+$/, "");
  if (primary !== DEFAULT_API_BASE_URL.replace(/\/+$/, "")) return [primary];
  return [...new Set([primary, ...ALIAS_API_BASE_URLS.map((u) => u.replace(/\/+$/, ""))])];
}

function regionCandidates(primaryBaseUrl) {
  return [...new Set([...REGION_BASE_URLS, primaryBaseUrl.replace(/\/+$/, "")])];
}

function healthyRegionStatus(statusCode) {
  return statusCode === 200 || statusCode === 401;
}

// May we send this again — independent of WHERE it goes.
//
// This used to return `regionalFailover` for inference 502/503/504, so pinning
// to one host ALSO stopped retrying the gateway statuses entirely: one switch
// answering two questions. regionalFailover now governs only the destination.
function shouldRetryResponse(statusCode, _isInferenceRequest, _regionalFailover, headers) {
  const verdict = shouldRetryVerdict(headers);
  if (verdict !== null) return verdict;
  return isRetryable(statusCode);
}

// A transport failure means no server saw the request, so it is always safe to
// send again; regionalFailover only decides whether the retry may change host.
function shouldRetryTransport(_isInferenceRequest, _regionalFailover) {
  return true;
}

function transportError(error) {
  const message =
    error && typeof error.message === "string" ? error.message : String(error);
  return new InternalError(
    503,
    `TrustedRouter endpoint unavailable: ${message}`,
    null,
  );
}

function retrySleepMs(attempt, retryAfterSeconds) {
  // Exponential backoff with full jitter, capped at 30s. Honor
  // retry-after as a floor.
  const baseMs = Math.min(30_000, 500 * 2 ** attempt);
  const jittered = Math.random() * baseMs;
  const floor = (retryAfterSeconds ?? 0) * 1000;
  return Math.max(jittered, floor);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function newIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) {
    return `tr-req-${globalThis.crypto.randomUUID()}`;
  }
  const suffix = Math.random().toString(36).slice(2);
  return `tr-req-${Date.now().toString(36)}-${suffix}`;
}

// ---- user agent --------------------------------------------------------

function userAgent() {
  const node =
    typeof process !== "undefined" && process.versions?.node
      ? `node/${process.versions.node}`
      : "browser";
  const platform = typeof process !== "undefined" ? process.platform : "web";
  return `trusted-router-js/${VERSION} ${node} ${platform}`;
}

const DEFAULT_USER_AGENT = userAgent();

// ---- main client -------------------------------------------------------

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
    this.baseUrls = baseUrls(this.baseUrl);
    this.regionProbeTimeout = Math.max(100, Number(regionProbeTimeout) || 0);
    this.regionAffinityPending = useRegionalAffinity && this.regionalFailover;
    this.regionAffinityPromise = null;
  }

  async _activeBaseUrls() {
    if (!this.regionAffinityPending) return this.baseUrls;
    if (!this.regionAffinityPromise) {
      this.regionAffinityPromise = this._rankRegionalBaseUrls();
    }
    this.baseUrls = await this.regionAffinityPromise;
    this.regionAffinityPending = false;
    return this.baseUrls;
  }

  async _rankRegionalBaseUrls() {
    const candidates = regionCandidates(this.baseUrl);
    let winner = null;
    try {
      winner = await Promise.any(
        candidates.map(async (baseUrl) => {
          const response = await this._fetchWithTimeout(
            `${baseUrl.replace(/\/v1$/, "")}/health`,
            { method: "GET", headers: { accept: "application/json" } },
            this.regionProbeTimeout,
          );
          try {
            await response.text();
          } catch {
            // Status is still enough to rank a liveness response.
          }
          if (!healthyRegionStatus(response.status)) {
            throw new Error("unhealthy regional gateway");
          }
          return baseUrl;
        }),
      );
    } catch {
      return [this.baseUrl];
    }
    return [...new Set([winner, this.baseUrl, ...candidates])];
  }

  // ---- core request loop ----------------------------------------------

  async request(method, path, init = {}) {
    const {
      _baseUrls = null,
      headers = {},
      body,
      apiKey = null,
      idempotencyKey = null,
      timeout = null,
      extraHeaders = null,
      workspaceId = null,
      ...rest
    } = init;

    const isInferenceRequest = _baseUrls === null;
    const requestIdempotencyKey = idempotencyKey ?? (
      isInferenceRequest && !["GET", "HEAD", "OPTIONS"].includes(String(method).toUpperCase())
        ? newIdempotencyKey()
        : null
    );
    const requestHeaders = this._buildHeaders({
      headers,
      extraHeaders,
      idempotencyKey: requestIdempotencyKey,
      apiKey,
      workspaceId,
    });
    const requestBody = serializeBody(body, requestHeaders);

    const requestBaseUrls = _baseUrls ?? await this._activeBaseUrls();
    let attempt = 0;
    let baseIndex = 0;
    while (true) {
      const requestBaseUrl = requestBaseUrls[baseIndex];
      const url = `${requestBaseUrl}/${String(path).replace(/^\/+/, "")}`;
      let response;
      try {
        response = await this._fetchWithTimeout(
          url,
          {
            method,
            headers: requestHeaders,
            body: requestBody,
            ...rest,
          },
          timeout,
        );
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        if (
          attempt >= this.maxRetries ||
          !shouldRetryTransport(isInferenceRequest, this.regionalFailover)
        ) {
          throw transportError(error);
        }
        if (
          isInferenceRequest &&
          this.regionalFailover &&
          baseIndex < requestBaseUrls.length - 1
        ) {
          baseIndex += 1;
        }
        await sleep(retrySleepMs(attempt, null));
        attempt += 1;
        continue;
      }

      if (
        attempt >= this.maxRetries ||
        !shouldRetryResponse(
          response.status,
          isInferenceRequest,
          this.regionalFailover,
          response.headers,
        )
      ) {
        return jsonOrThrow(response);
      }
      const retryAfter = parseRetryAfter(response.headers);
      // Drain the response so we don't leak a connection while sleeping.
      try {
        await response.text();
      } catch {
        /* ignore */
      }
      if (
        isInferenceRequest &&
        this.regionalFailover &&
        isRegionalFailoverable(response.status, response.headers) &&
        baseIndex < requestBaseUrls.length - 1
      ) {
        baseIndex += 1;
      }
      await sleep(retrySleepMs(attempt, retryAfter));
      attempt += 1;
    }
  }

  /**
   * Lower-level: returns the raw Response without parsing. Used by the
   * streaming chat methods so callers (or downstream relays) can read
   * the SSE bytes directly.
   */
  async rawRequest(method, path, init = {}) {
    const {
      _baseUrls = null,
      headers = {},
      body,
      apiKey = null,
      idempotencyKey = null,
      timeout = null,
      extraHeaders = null,
      workspaceId = null,
      ...rest
    } = init;
    const isInferenceRequest = _baseUrls === null;
    const requestIdempotencyKey = idempotencyKey ?? (
      isInferenceRequest && !["GET", "HEAD", "OPTIONS"].includes(String(method).toUpperCase())
        ? newIdempotencyKey()
        : null
    );
    const requestHeaders = this._buildHeaders({
      headers,
      extraHeaders,
      idempotencyKey: requestIdempotencyKey,
      apiKey,
      workspaceId,
    });
    const requestBody = serializeBody(body, requestHeaders);
    const requestBaseUrls = _baseUrls ?? await this._activeBaseUrls();
    let attempt = 0;
    let baseIndex = 0;
    while (true) {
      const requestBaseUrl = requestBaseUrls[baseIndex];
      const url = `${requestBaseUrl}/${String(path).replace(/^\/+/, "")}`;
      let response;
      try {
        response = await this._fetchWithTimeout(
          url,
          {
            method,
            headers: requestHeaders,
            body: requestBody,
            ...rest,
          },
          timeout,
        );
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        if (
          attempt >= this.maxRetries ||
          !shouldRetryTransport(isInferenceRequest, this.regionalFailover)
        ) {
          throw transportError(error);
        }
        if (
          isInferenceRequest &&
          this.regionalFailover &&
          baseIndex < requestBaseUrls.length - 1
        ) {
          baseIndex += 1;
        }
        await sleep(retrySleepMs(attempt, null));
        attempt += 1;
        continue;
      }
      if (
        attempt >= this.maxRetries ||
        !isRegionalFailoverable(response.status, response.headers) ||
        !isInferenceRequest ||
        !this.regionalFailover
      ) {
        return response;
      }
      try {
        await response.text();
      } catch {
        /* ignore */
      }
      if (
        isInferenceRequest &&
        this.regionalFailover &&
        isRegionalFailoverable(response.status, response.headers) &&
        baseIndex < requestBaseUrls.length - 1
      ) {
        baseIndex += 1;
      }
      await sleep(retrySleepMs(attempt, parseRetryAfter(response.headers)));
      attempt += 1;
    }
  }

  _controlRequest(method, path, init = {}) {
    return this.request(method, path, {
      ...init,
      _baseUrls: [this.controlBaseUrl],
    });
  }

  _buildHeaders({
    headers,
    extraHeaders,
    idempotencyKey,
    apiKey,
    workspaceId,
  }) {
    const out = new Headers({ "user-agent": DEFAULT_USER_AGENT });
    for (const [k, v] of Object.entries(this.defaultHeaders)) out.set(k, v);
    if (headers) {
      const it =
        headers instanceof Headers
          ? headers.entries()
          : Object.entries(headers);
      for (const [k, v] of it) out.set(k, v);
    }
    if (extraHeaders) {
      for (const [k, v] of Object.entries(extraHeaders)) out.set(k, v);
    }
    if (idempotencyKey) out.set("idempotency-key", idempotencyKey);
    const selectedWorkspaceId = workspaceId ?? this.workspaceId;
    if (selectedWorkspaceId)
      out.set("x-trustedrouter-workspace", selectedWorkspaceId);
    const bearer = apiKey ?? this.apiKey;
    if (bearer && !out.has("authorization")) {
      out.set("authorization", `Bearer ${bearer}`);
    }
    return out;
  }

  async _fetchWithTimeout(url, init, timeoutMs) {
    if (!timeoutMs) {
      return this.fetch(url, init);
    }
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await this.fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(id);
    }
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
  }) {
    const body = { model, input };
    if (encodingFormat !== null) body.encoding_format = encodingFormat;
    if (dimensions !== null) body.dimensions = dimensions;
    if (user !== null) body.user = user;
    if (sessionId !== null) body.session_id = sessionId;
    if (trace !== null) body.trace = trace;
    if (tags !== null) body.tags = tags;
    if (provider !== null) body.provider = provider;
    return this.request("POST", "/embeddings", { body });
  }

  messages({ model, messages, maxTokens = 1024, ...params }) {
    return this.request("POST", "/messages", {
      body: { model, messages, max_tokens: maxTokens, ...params },
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

// ---- module-level helpers ----------------------------------------------

export async function fetchTrustRelease({
  trustUrl = DEFAULT_TRUST_RELEASE_URL,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!fetchImpl) {
    throw new Error("A fetch implementation is required");
  }
  return jsonOrThrow(
    await fetchImpl(trustUrl, {
      headers: { "user-agent": DEFAULT_USER_AGENT },
    }),
  );
}

export const trustRelease = fetchTrustRelease;

// ---- internals ---------------------------------------------------------

function serializeBody(body, headers) {
  if (!body || typeof body === "string") return body;
  if (typeof FormData !== "undefined" && body instanceof FormData) return body;
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams)
    return body;
  if (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer)
    return body;
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return JSON.stringify(body);
}

async function jsonOrThrow(response) {
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }
  if (!response.ok) {
    throw classifyError(
      response.status,
      errorMessage(payload) || response.statusText || "TrustedRouter error",
      payload,
      parseRetryAfter(response.headers),
    );
  }
  return payload ?? {};
}

async function throwFromResponse(response) {
  const text = await response.text().catch(() => "");
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }
  throw classifyError(
    response.status,
    errorMessage(payload) || response.statusText || "TrustedRouter error",
    payload,
    parseRetryAfter(response.headers),
  );
}

function errorMessage(payload) {
  if (payload && typeof payload === "object") {
    if (payload.error && typeof payload.error === "object") {
      return payload.error.message || payload.error.type;
    }
    return payload.message;
  }
  return undefined;
}

