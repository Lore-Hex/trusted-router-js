/**
 * TrustedRouter JavaScript SDK.
 *
 * OpenAI-compatible client for https://api.quillrouter.com/v1.
 *
 * Mirrors the Python SDK's surface so multi-language teams stay in
 * sync: typed errors, automatic retries with backoff, region pinning,
 * per-call extras (extraHeaders/idempotencyKey/timeout/apiKey), and
 * embeddings/messages/activity wrappers.
 *
 * Attestation verification (`verifyGatewayAttestation`) lives in
 * ./attestation.js — split out so the base bundle stays small and
 * SubtleCrypto is only imported when callers actually need to verify.
 */

export const VERSION = "0.2.0";
export const DEFAULT_API_BASE_URL = "https://api.quillrouter.com/v1";
export const DEFAULT_TRUST_RELEASE_URL =
  "https://trust.trustedrouter.com/trust/gcp-release.json";
export const AUTO_MODEL = "trustedrouter/auto";

// Region routing — mirror of Python REGION_HOSTS. The us-central1 entry
// aliases the apex because the regional subdomain isn't published yet.
export const REGION_HOSTS = Object.freeze({
  "us-central1": "api.quillrouter.com",
  "europe-west4": "api-europe-west4.quillrouter.com",
});

export function regionBaseUrl(region) {
  if (!Object.hasOwn(REGION_HOSTS, region)) {
    const known = Object.keys(REGION_HOSTS).sort().join(", ");
    throw new Error(`unknown TrustedRouter region '${region}'; known: ${known}`);
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
  if (statusCode === 401) return new AuthenticationError(statusCode, message, payload);
  if (statusCode === 403) return new PermissionDeniedError(statusCode, message, payload);
  if (statusCode === 404) return new NotFoundError(statusCode, message, payload);
  if (statusCode === 429) return new RateLimitError(statusCode, message, payload, retryAfter);
  if (statusCode >= 400 && statusCode < 500) return new BadRequestError(statusCode, message, payload);
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

function retrySleepMs(attempt, retryAfterSeconds) {
  // Exponential backoff with full jitter, capped at 30s. Honor
  // retry-after as a floor.
  const baseMs = Math.min(30_000, 500 * 2 ** attempt);
  const jittered = Math.random() * baseMs;
  const floor = (retryAfterSeconds ?? 0) * 1000;
  return Math.max(jittered, floor);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- user agent --------------------------------------------------------

function userAgent() {
  const node = typeof process !== "undefined" && process.versions?.node
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
    maxRetries = 2,
  } = {}) {
    if (!fetchImpl) {
      throw new Error("A fetch implementation is required");
    }
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
    this.fetch = fetchImpl;
    this.defaultHeaders = headers;
    this.maxRetries = Math.max(0, Number.isFinite(maxRetries) ? maxRetries : 0);
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
      ...rest
    } = init;

    const url = `${this.baseUrl}/${String(path).replace(/^\/+/, "")}`;
    const requestHeaders = this._buildHeaders({ headers, extraHeaders, idempotencyKey, apiKey });
    const requestBody = serializeBody(body, requestHeaders);

    let attempt = 0;
    while (true) {
      const response = await this._fetchWithTimeout(url, {
        method,
        headers: requestHeaders,
        body: requestBody,
        ...rest,
      }, timeout);

      if (attempt >= this.maxRetries || !isRetryable(response.status)) {
        return jsonOrThrow(response);
      }
      const retryAfter = parseRetryAfter(response.headers);
      // Drain the response so we don't leak a connection while sleeping.
      try { await response.text(); } catch { /* ignore */ }
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
      ...rest
    } = init;
    const url = `${this.baseUrl}/${String(path).replace(/^\/+/, "")}`;
    const requestHeaders = this._buildHeaders({ headers, extraHeaders, idempotencyKey, apiKey });
    const requestBody = serializeBody(body, requestHeaders);
    return this._fetchWithTimeout(url, {
      method,
      headers: requestHeaders,
      body: requestBody,
      ...rest,
    }, timeout);
  }

  _buildHeaders({ headers, extraHeaders, idempotencyKey, apiKey }) {
    const out = new Headers({ "user-agent": DEFAULT_USER_AGENT });
    for (const [k, v] of Object.entries(this.defaultHeaders)) out.set(k, v);
    if (headers) {
      const it = headers instanceof Headers ? headers.entries() : Object.entries(headers);
      for (const [k, v] of it) out.set(k, v);
    }
    if (extraHeaders) {
      for (const [k, v] of Object.entries(extraHeaders)) out.set(k, v);
    }
    if (idempotencyKey) out.set("idempotency-key", idempotencyKey);
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
    timeout = null,
    ...params
  } = {}) {
    // The gateway always streams. Collect chunks into an OpenAI-shape
    // chat.completion dict so callers that asked for non-streaming
    // still get a single result back.
    const chunks = [];
    for await (const chunk of this.chatCompletionsChunks({
      model, messages, apiKey, extraHeaders, idempotencyKey, timeout, ...params,
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
    timeout = null,
    ...params
  } = {}) {
    const response = await this.rawRequest("POST", "/chat/completions", {
      headers: { accept: "text/event-stream" },
      body: { model, messages, stream: true, ...params },
      apiKey,
      extraHeaders,
      idempotencyKey,
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
    timeout = null,
    ...params
  } = {}) {
    const response = await this.rawRequest("POST", "/chat/completions", {
      headers: { accept: "text/event-stream" },
      body: { model, messages, stream: true, ...params },
      apiKey,
      extraHeaders,
      idempotencyKey,
      timeout,
    });
    if (!response.ok) {
      await throwFromResponse(response);
    }
    for await (const chunk of response.body) {
      yield chunk;
    }
  }

  // ---- catalog / metadata ---------------------------------------------

  models() { return this.request("GET", "/models"); }
  providers() { return this.request("GET", "/providers"); }
  regions() { return this.request("GET", "/regions"); }
  credits() { return this.request("GET", "/credits"); }

  embeddings({ model, input, encodingFormat = null, dimensions = null, user = null }) {
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

  // ---- billing + auth -------------------------------------------------

  billingCheckout({
    amount, paymentMethod = null, workspaceId = null,
    successUrl = null, cancelUrl = null, idempotencyKey = null,
  } = {}) {
    const body = { amount };
    if (paymentMethod !== null) body.payment_method = paymentMethod;
    if (workspaceId !== null) body.workspace_id = workspaceId;
    if (successUrl !== null) body.success_url = successUrl;
    if (cancelUrl !== null) body.cancel_url = cancelUrl;
    return this.request("POST", "/billing/checkout", { body, idempotencyKey });
  }

  stablecoinCheckout({ amount, ...params } = {}) {
    return this.billingCheckout({ amount, paymentMethod: "stablecoin", ...params });
  }

  authSession() { return this.request("GET", "/auth/session"); }
  logout() { return this.request("POST", "/auth/logout"); }

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
      throw classifyError(response.status, text.slice(0, 240) || response.statusText, null, parseRetryAfter(response.headers));
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
  return jsonOrThrow(await fetchImpl(trustUrl, {
    headers: { "user-agent": DEFAULT_USER_AGENT },
  }));
}

export const trustRelease = fetchTrustRelease;

// ---- internals ---------------------------------------------------------

function serializeBody(body, headers) {
  if (!body || typeof body === "string") return body;
  if (typeof FormData !== "undefined" && body instanceof FormData) return body;
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) return body;
  if (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer) return body;
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
    try { payload = JSON.parse(text); } catch { payload = { message: text }; }
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

function parseSseLine(line) {
  if (!line.startsWith("data:")) return null;
  const data = line.slice(5).trim();
  if (!data || data === "[DONE]") return null;
  try { return JSON.parse(data); } catch { return null; }
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
      choices: [{
        index: 0,
        message: { role: "assistant", content: "" },
        finish_reason: "stop",
      }],
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
    choices: [{
      index: 0,
      message: { role: "assistant", content: parts.join("") },
      finish_reason: finishReason ?? "stop",
    }],
  };
}
