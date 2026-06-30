/**
 * TrustedRouter JavaScript SDK.
 *
 * OpenAI-compatible client for https://api.quillrouter.com/v1.
 *
 * Mirrors the Python SDK's surface so multi-language teams stay in
 * sync: typed errors, automatic retries with backoff, region pinning,
 * per-call extras (extraHeaders/idempotencyKey/timeout/apiKey/workspaceId),
 * and messages/activity wrappers.
 *
 * Attestation verification (`verifyGatewayAttestation`) lives in
 * ./attestation.js — split out so the base bundle stays small and
 * SubtleCrypto is only imported when callers actually need to verify.
 */

export const VERSION = "0.3.0";
export const DEFAULT_API_BASE_URL = "https://api.quillrouter.com/v1";
export const DEFAULT_TRUST_RELEASE_URL =
  "https://trust.trustedrouter.com/trust/gcp-release.json";
export const DEFAULT_STATUS_URL =
  "https://status.trustedrouter.com/status.json";
export const AUTO_MODEL = "trustedrouter/auto";
export const FAST_MODEL = "trustedrouter/fast";
export const FUSION_MODEL = "trustedrouter/fusion";
export const SOCRATES_MODEL = "trustedrouter/socrates-1.0";
export const ADVISOR_MODEL = "trustedrouter/advisor";

// Recommended panel + judge fallback chain for maximum willingness to answer.
// Use gateway-supported latest aliases where possible so examples survive
// provider deprecations without requiring an SDK release.
export const FUSION_FREEDOM_PANEL = Object.freeze([
  "minimax/minimax-m3",
  "~kimi/latest",
  "~zai/glm-latest",
  "google/gemma-4-31b-it",
  "deepseek/deepseek-v4-flash",
]);
export const FUSION_FREEDOM_FALLBACK_JUDGES = Object.freeze([
  "minimax/minimax-m3",
  "~zai/glm-latest",
  "~kimi/latest",
  "deepseek/deepseek-v4-flash",
  "google/gemma-4-31b-it",
]);

/**
 * Build a `trustedrouter:fusion` tool spec. Fan a request across a panel of
 * models and have a judge model pick or synthesize one answer. Omit a field to
 * let the gateway default it (selectionStrategy defaults to
 * "synthesize_non_refusals").
 */
export function fusionTool({
  analysisModels = null,
  model = null, // judge / synthesis model
  selectionStrategy = null,
  fallbackJudges = null,
  fallbackFinalModels = null,
  maxCompletionTokens = null,
  maxToolCalls = null,
  preset = null,
} = {}) {
  const parameters = {};
  if (preset !== null) parameters.preset = preset;
  if (analysisModels !== null) parameters.analysis_models = analysisModels;
  if (model !== null) parameters.model = model;
  if (selectionStrategy !== null) parameters.selection_strategy = selectionStrategy;
  if (fallbackJudges !== null) parameters.fallback_judges = fallbackJudges;
  if (fallbackFinalModels !== null) parameters.fallback_final_models = fallbackFinalModels;
  if (maxCompletionTokens !== null) parameters.max_completion_tokens = maxCompletionTokens;
  if (maxToolCalls !== null) parameters.max_tool_calls = maxToolCalls;
  return { type: "trustedrouter:fusion", parameters };
}

/**
 * Build a `trustedrouter:advisor` tool spec for Socrates orchestration. The
 * gateway consumes this config and gives the worker model a private
 * `_trustedrouter_get_advice` tool.
 */
export function advisorTool({
  depth = null,
  workerModels = null,
  advisorModels = null,
  maxGetAdviceCalls = null,
  advisorMaxTokens = null,
  advisorTimeoutMs = null,
} = {}) {
  const parameters = {};
  if (depth !== null) parameters.depth = depth;
  if (workerModels !== null) parameters.worker_models = workerModels;
  if (advisorModels !== null) parameters.advisor_models = advisorModels;
  if (maxGetAdviceCalls !== null) {
    parameters.max_get_advice_calls = maxGetAdviceCalls;
  }
  if (advisorMaxTokens !== null) parameters.advisor_max_tokens = advisorMaxTokens;
  if (advisorTimeoutMs !== null) parameters.advisor_timeout_ms = advisorTimeoutMs;
  return { type: "trustedrouter:advisor", parameters };
}

const ADVISOR_MODELS = Object.freeze(new Set([ADVISOR_MODEL]));
const FUSION_PRIMITIVE_MODELS = Object.freeze(
  new Set([
    "trustedrouter/fusion",
    "trustedrouter/fusion-code",
    "trustedrouter/synth",
    "trustedrouter/synth-code",
    "trustedrouter/selector",
    "trustedrouter/mapreduce",
  ]),
);

function chatCompletionBody({ model, messages, params }) {
  const bodyParams = { ...params };
  const tools = [...(bodyParams.tools ?? [])];
  delete bodyParams.tools;

  const advisor = {};
  for (const [sdkKey, gatewayKey] of [
    ["depth", "depth"],
    ["workerModels", "worker_models"],
    ["advisorModels", "advisor_models"],
    ["maxGetAdviceCalls", "max_get_advice_calls"],
    ["advisorMaxTokens", "advisor_max_tokens"],
    ["advisorTimeoutMs", "advisor_timeout_ms"],
  ]) {
    if (Object.hasOwn(bodyParams, sdkKey)) {
      if (bodyParams[sdkKey] !== null && bodyParams[sdkKey] !== undefined) {
        advisor[gatewayKey] = bodyParams[sdkKey];
      }
      delete bodyParams[sdkKey];
    }
  }
  if (Object.keys(advisor).length > 0) {
    tools.push({ type: "trustedrouter:advisor", parameters: advisor });
  }

  const fusion = {};
  for (const [sdkKey, gatewayKey] of [
    ["analysisModels", "analysis_models"],
    ["judgeModel", "model"],
    ["selectionStrategy", "selection_strategy"],
    ["fallbackJudges", "fallback_judges"],
    ["fallbackFinalModels", "fallback_final_models"],
    ["maxCompletionTokens", "max_completion_tokens"],
    ["maxToolCalls", "max_tool_calls"],
    ["preset", "preset"],
    ["panelPrompt", "panel_prompt"],
    ["synthesisPrompt", "synthesis_prompt"],
    ["finalPrompt", "final_prompt"],
    ["selectorModels", "selector_models"],
    ["selectorModel", "selector_model"],
    ["selectorPrompt", "selector_prompt"],
    ["mapperModels", "mapper_models"],
    ["mapperModel", "mapper_model"],
    ["mapperPrompt", "mapper_prompt"],
    ["parallelModels", "parallel_models"],
    ["parallelModel", "parallel_model"],
    ["parallelPrompt", "parallel_prompt"],
    ["reducerModels", "reducer_models"],
    ["reducerModel", "reducer_model"],
    ["reducerPrompt", "reducer_prompt"],
  ]) {
    if (Object.hasOwn(bodyParams, sdkKey)) {
      if (bodyParams[sdkKey] !== null && bodyParams[sdkKey] !== undefined) {
        fusion[gatewayKey] = bodyParams[sdkKey];
      }
      delete bodyParams[sdkKey];
    }
  }
  if (Object.keys(fusion).length > 0) {
    tools.push({ type: "trustedrouter:fusion", parameters: fusion });
  }

  const normalizedModel = String(model || "").trim().toLowerCase();
  const out = { model, messages, stream: true, ...bodyParams };
  if (
    tools.length > 0 ||
    ADVISOR_MODELS.has(normalizedModel) ||
    FUSION_PRIMITIVE_MODELS.has(normalizedModel)
  ) {
    if (tools.length > 0) out.tools = tools;
  }
  return out;
}

// Region routing — mirror of Python REGION_HOSTS. The us-central1 entry
// aliases the apex because the regional subdomain isn't published yet.
export const REGION_HOSTS = Object.freeze({
  "us-central1": "api.quillrouter.com",
  "us-east4": "api-us-east4.quillrouter.com",
  "europe-west4": "api-europe-west4.quillrouter.com",
});
export const DEFAULT_FAILOVER_REGIONS = Object.freeze([
  "us-central1",
  "us-east4",
  "europe-west4",
]);

export function regionBaseUrl(region) {
  if (!Object.hasOwn(REGION_HOSTS, region)) {
    const known = Object.keys(REGION_HOSTS).sort().join(", ");
    throw new Error(
      `unknown TrustedRouter region '${region}'; known: ${known}`,
    );
  }
  return `https://${REGION_HOSTS[region]}/v1`;
}

// ---- error hierarchy ---------------------------------------------------

export class TrustedRouterError extends Error {
  constructor(statusCode, message, payload) {
    super(message);
    this.name = "TrustedRouterError";
    this.statusCode = statusCode;
    this.payload = payload;
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

function parseRetryAfter(headers) {
  const raw = headers.get?.("retry-after") ?? headers["retry-after"] ?? null;
  if (!raw) return null;
  const n = Number(String(raw).trim());
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// ---- retry policy ------------------------------------------------------

function isRetryable(statusCode) {
  return statusCode === 429 || statusCode >= 500;
}

function isRegionalFailoverable(statusCode) {
  return statusCode === 502 || statusCode === 503 || statusCode === 504;
}

function regionalBaseUrls(primaryBaseUrl, enabled, failoverRegions = null) {
  const urls = [primaryBaseUrl.replace(/\/+$/, "")];
  if (!enabled) return urls;
  for (const region of failoverRegions ?? DEFAULT_FAILOVER_REGIONS) {
    const candidate = regionBaseUrl(region).replace(/\/+$/, "");
    if (!urls.includes(candidate)) urls.push(candidate);
  }
  return urls;
}

function transportError(error) {
  const message =
    error && typeof error.message === "string" ? error.message : String(error);
  return new InternalError(
    503,
    `TrustedRouter regional endpoint unavailable: ${message}`,
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

// ---- browser OAuth / PKCE helpers -------------------------------------

export function randomOAuthState({ byteLength = 16 } = {}) {
  return randomBase64Url(byteLength);
}

export async function createOAuthPkcePair({ codeVerifier = null } = {}) {
  const verifier = codeVerifier ?? randomBase64Url(32);
  return {
    codeVerifier: verifier,
    codeChallenge: await sha256Base64Url(verifier),
    codeChallengeMethod: "S256",
  };
}

function randomBase64Url(byteLength) {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("Web Crypto getRandomValues is required");
  }
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return base64UrlEncodeBytes(bytes);
}

async function sha256Base64Url(text) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto subtle digest is required");
  }
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return base64UrlEncodeBytes(new Uint8Array(digest));
}

function base64UrlEncodeBytes(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded =
    typeof btoa === "function"
      ? btoa(binary)
      : Buffer.from(binary, "binary").toString("base64");
  return encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function callbackUrlWithState(callbackUrl, state) {
  const url = new URL(callbackUrl);
  url.searchParams.set("state", state);
  return url.toString();
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
    region = null,
    fetchImpl = globalThis.fetch,
    headers = {},
    workspaceId = null,
    maxRetries = 2,
    regionalFailover = null,
    failoverRegions = null,
  } = {}) {
    if (!fetchImpl) {
      throw new Error("A fetch implementation is required");
    }
    const explicitEndpoint = Boolean(region || baseUrl);
    if (region && baseUrl) {
      throw new Error("pass region OR baseUrl, not both");
    }
    if (region) {
      baseUrl = regionBaseUrl(region);
    }
    if (!baseUrl) {
      baseUrl = DEFAULT_API_BASE_URL;
    }
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.region = region;
    this.workspaceId = workspaceId;
    this.fetch = fetchImpl;
    this.defaultHeaders = headers;
    this.maxRetries = Math.max(0, Number.isFinite(maxRetries) ? maxRetries : 0);
    const failoverEnabled =
      regionalFailover === null ? !explicitEndpoint : Boolean(regionalFailover);
    this.baseUrls = regionalBaseUrls(
      this.baseUrl,
      failoverEnabled,
      failoverRegions,
    );
  }

  // ---- core request loop ----------------------------------------------

  async request(method, path, init = {}) {
    const {
      headers = {},
      body,
      apiKey = null,
      idempotencyKey = null,
      timeout = null,
      extraHeaders = null,
      workspaceId = null,
      ...rest
    } = init;

    const requestHeaders = this._buildHeaders({
      headers,
      extraHeaders,
      idempotencyKey,
      apiKey,
      workspaceId,
    });
    const requestBody = serializeBody(body, requestHeaders);

    let attempt = 0;
    let baseIndex = 0;
    while (true) {
      const url = `${this.baseUrls[baseIndex]}/${String(path).replace(/^\/+/, "")}`;
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
        if (attempt >= this.maxRetries) throw transportError(error);
        if (baseIndex < this.baseUrls.length - 1) baseIndex += 1;
        await sleep(retrySleepMs(attempt, null));
        attempt += 1;
        continue;
      }

      if (attempt >= this.maxRetries || !isRetryable(response.status)) {
        return jsonOrThrow(response);
      }
      if (
        isRegionalFailoverable(response.status) &&
        baseIndex < this.baseUrls.length - 1
      ) {
        baseIndex += 1;
      }
      const retryAfter = parseRetryAfter(response.headers);
      // Drain the response so we don't leak a connection while sleeping.
      try {
        await response.text();
      } catch {
        /* ignore */
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
      headers = {},
      body,
      apiKey = null,
      idempotencyKey = null,
      timeout = null,
      extraHeaders = null,
      workspaceId = null,
      ...rest
    } = init;
    const requestHeaders = this._buildHeaders({
      headers,
      extraHeaders,
      idempotencyKey,
      apiKey,
      workspaceId,
    });
    const requestBody = serializeBody(body, requestHeaders);
    let attempt = 0;
    let baseIndex = 0;
    while (true) {
      const url = `${this.baseUrls[baseIndex]}/${String(path).replace(/^\/+/, "")}`;
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
        if (attempt >= this.maxRetries) throw transportError(error);
        if (baseIndex < this.baseUrls.length - 1) baseIndex += 1;
        await sleep(retrySleepMs(attempt, null));
        attempt += 1;
        continue;
      }
      if (
        attempt >= this.maxRetries ||
        !isRegionalFailoverable(response.status) ||
        baseIndex >= this.baseUrls.length - 1
      ) {
        return response;
      }
      try {
        await response.text();
      } catch {
        /* ignore */
      }
      baseIndex += 1;
      await sleep(retrySleepMs(attempt, parseRetryAfter(response.headers)));
      attempt += 1;
    }
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

  /**
   * Run a request through TrustedRouter Socrates: a fast worker model can ask
   * a stronger private advisor model for guidance when it is stuck.
   */
  async socrates({
    messages,
    depth = null,
    workerModels = null,
    advisorModels = null,
    maxGetAdviceCalls = null,
    advisorMaxTokens = null,
    advisorTimeoutMs = null,
    model = SOCRATES_MODEL,
    ...params
  } = {}) {
    const tools = [...(params.tools ?? [])];
    delete params.tools;
    tools.push(
      advisorTool({
        depth,
        workerModels,
        advisorModels,
        maxGetAdviceCalls,
        advisorMaxTokens,
        advisorTimeoutMs,
      }),
    );
    return this.chatCompletions({
      model,
      messages,
      tools,
      ...params,
    });
  }

  // ---- catalog / metadata ---------------------------------------------

  models() {
    return this.request("GET", "/models");
  }
  providers() {
    return this.request("GET", "/providers");
  }
  regions() {
    return this.request("GET", "/regions");
  }
  credits({ workspaceId = null } = {}) {
    return this.request("GET", "/credits", { workspaceId });
  }

  embeddings({
    model,
    input,
    encodingFormat = null,
    dimensions = null,
    user = null,
  }) {
    const body = { model, input };
    if (encodingFormat !== null) body.encoding_format = encodingFormat;
    if (dimensions !== null) body.dimensions = dimensions;
    if (user !== null) body.user = user;
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
    return this.request("GET", "/broadcast/destinations", { workspaceId });
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
    return this.request("POST", "/broadcast/destinations", {
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
    return this.request("GET", `/broadcast/destinations/${id}`, {
      workspaceId,
    });
  }

  updateBroadcastDestination(id, { workspaceId = null, ...patch } = {}) {
    return this.request("PATCH", `/broadcast/destinations/${id}`, {
      body: Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined),
      ),
      workspaceId,
    });
  }

  deleteBroadcastDestination(id, { workspaceId = null } = {}) {
    return this.request("DELETE", `/broadcast/destinations/${id}`, {
      workspaceId,
    });
  }

  testBroadcastDestination(id, { workspaceId = null } = {}) {
    return this.request("POST", `/broadcast/destinations/${id}/test`, {
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
    return this.request("POST", "/billing/checkout", {
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
    return this.request("GET", "/auth/session");
  }
  logout() {
    return this.request("POST", "/auth/logout");
  }

  /**
   * Fetch the OIDC-style profile for the instance's delegated key.
   * GET /auth/userinfo with Authorization: Bearer <api_key>.
   * Returns the parsed body, e.g. { data: { sub, email, email_verified,
   * wallet_address, workspace_id, created_at } }.
   */
  userInfo() {
    return this.request("GET", "/auth/userinfo");
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
    const authorizeUrl = new URL(`${this.baseUrl}/auth`);
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
    return this.request("POST", "/auth/keys", {
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
    return this.request("GET", `/activity${suffix}`);
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

async function* iterSseChunks(response) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      const parsed = parseSseLine(line);
      if (parsed !== null) yield parsed;
    }
  }
  buffer += decoder.decode();
  for (const line of buffer.split(/\r?\n/)) {
    const parsed = parseSseLine(line);
    if (parsed !== null) yield parsed;
  }
}

async function* iterSseEvents(response) {
  const decoder = new TextDecoder();
  let buffer = "";
  let frame = [];
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (line === "") {
        const parsed = parseSseFrame(frame);
        frame = [];
        if (parsed !== null) yield parsed;
      } else {
        frame.push(line);
      }
    }
  }
  buffer += decoder.decode();
  for (const line of buffer.split(/\r?\n/)) {
    if (line === "") {
      const parsed = parseSseFrame(frame);
      frame = [];
      if (parsed !== null) yield parsed;
    } else if (line) {
      frame.push(line);
    }
  }
  const parsed = parseSseFrame(frame);
  if (parsed !== null) yield parsed;
}

function parseSseLine(line) {
  if (!line.startsWith("data:")) return null;
  const data = line.slice(5).trim();
  if (!data || data === "[DONE]") return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function parseSseFrame(lines) {
  if (!lines.length) return null;
  let event = null;
  const dataParts = [];
  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataParts.push(line.slice(5).trim());
    }
  }
  const data = dataParts.join("\n").trim();
  if (!data || data === "[DONE]") return null;
  let payload;
  try {
    payload = JSON.parse(data);
  } catch {
    payload = { data };
  }
  if (
    event &&
    payload &&
    typeof payload === "object" &&
    !Object.hasOwn(payload, "event")
  ) {
    return { event, ...payload };
  }
  return payload && typeof payload === "object"
    ? payload
    : { event, data: payload };
}

function responsesBody({ model, input, instructions, stream, params }) {
  const body = { model, input, ...params, stream };
  delete body.apiKey;
  delete body.extraHeaders;
  delete body.idempotencyKey;
  delete body.timeout;
  delete body.workspaceId;
  if (instructions !== null && instructions !== undefined) {
    body.instructions = instructions;
  }
  return body;
}

function broadcastDestinationBody({
  type,
  name,
  endpoint,
  enabled,
  includeContent,
  method,
  headers,
  apiKey,
}) {
  const body = {
    type,
    name,
    enabled,
    include_content: includeContent,
    method,
  };
  if (endpoint !== null && endpoint !== undefined) body.endpoint = endpoint;
  if (headers !== null && headers !== undefined) body.headers = headers;
  if (apiKey !== null && apiKey !== undefined) body.api_key = apiKey;
  return body;
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

/**
 * Roll a list of chat.completion.chunk frames into a single
 * chat.completion dict. Mirrors the Python `_collect_completion`
 * helper so the two SDKs produce identical aggregated output.
 */
export function collectCompletion(chunks) {
  if (chunks.length === 0) {
    return {
      id: "",
      object: "chat.completion",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "" },
          finish_reason: "stop",
        },
      ],
    };
  }
  const parts = [];
  let finishReason = null;
  for (const c of chunks) {
    const choice = c?.choices?.[0];
    if (!choice) continue;
    const content = choice?.delta?.content;
    if (typeof content === "string") parts.push(content);
    if (choice.finish_reason) finishReason = choice.finish_reason;
  }
  const last = chunks[chunks.length - 1];
  return {
    id: last?.id ?? "",
    object: "chat.completion",
    created: last?.created ?? 0,
    model: last?.model ?? "",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: parts.join("") },
        finish_reason: finishReason ?? "stop",
      },
    ],
  };
}
