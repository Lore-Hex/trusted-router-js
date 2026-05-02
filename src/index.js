export const DEFAULT_API_BASE_URL = "https://api.quillrouter.com/v1";
export const DEFAULT_TRUST_RELEASE_URL =
  "https://trust.trustedrouter.com/trust/gcp-release.json";
export const AUTO_MODEL = "trustedrouter/auto";

export class TrustedRouterError extends Error {
  constructor(statusCode, message, payload) {
    super(message);
    this.name = "TrustedRouterError";
    this.statusCode = statusCode;
    this.payload = payload;
  }
}

export class TrustedRouter {
  constructor({
    apiKey,
    baseUrl = DEFAULT_API_BASE_URL,
    fetchImpl = globalThis.fetch,
  } = {}) {
    if (!fetchImpl) {
      throw new Error("A fetch implementation is required");
    }
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetch = fetchImpl;
  }

  async request(method, path, init = {}) {
    const { headers = {}, body, ...rest } = init;
    const requestHeaders = new Headers(headers);
    let requestBody = body;

    if (this.apiKey && !requestHeaders.has("authorization")) {
      requestHeaders.set("authorization", `Bearer ${this.apiKey}`);
    }

    if (isJsonBody(requestBody)) {
      if (!requestHeaders.has("content-type")) {
        requestHeaders.set("content-type", "application/json");
      }
      requestBody = JSON.stringify(requestBody);
    }

    const response = await this.fetch(`${this.baseUrl}/${path.replace(/^\/+/, "")}`, {
      method,
      headers: requestHeaders,
      body: requestBody,
      ...rest,
    });

    return jsonOrThrow(response);
  }

  chatCompletions({ model = AUTO_MODEL, messages, ...params }) {
    return this.request("POST", "/chat/completions", {
      body: { model, messages, ...params },
    });
  }

  autoChatCompletions({ messages, ...params }) {
    return this.chatCompletions({ model: AUTO_MODEL, messages, ...params });
  }

  async *chatCompletionsChunks({ model = AUTO_MODEL, messages, ...params }) {
    const response = await this.rawRequest("POST", "/chat/completions", {
      headers: { accept: "text/event-stream" },
      body: { model, messages, stream: true, ...params },
    });
    if (!response.ok) {
      await throwResponse(response);
    }
    yield* iterSseChunks(response);
  }

  async *chatCompletionsText({ model = AUTO_MODEL, messages, ...params }) {
    for await (const chunk of this.chatCompletionsChunks({ model, messages, ...params })) {
      const text = chunk?.choices?.[0]?.delta?.content;
      if (typeof text === "string" && text.length > 0) {
        yield text;
      }
    }
  }

  rawRequest(method, path, init = {}) {
    const { headers = {}, body, ...rest } = init;
    const requestHeaders = new Headers(headers);
    let requestBody = body;

    if (this.apiKey && !requestHeaders.has("authorization")) {
      requestHeaders.set("authorization", `Bearer ${this.apiKey}`);
    }

    if (isJsonBody(requestBody)) {
      if (!requestHeaders.has("content-type")) {
        requestHeaders.set("content-type", "application/json");
      }
      requestBody = JSON.stringify(requestBody);
    }

    return this.fetch(`${this.baseUrl}/${path.replace(/^\/+/, "")}`, {
      method,
      headers: requestHeaders,
      body: requestBody,
      ...rest,
    });
  }

  models() {
    return this.request("GET", "/models");
  }

  providers() {
    return this.request("GET", "/providers");
  }

  regions() {
    return this.request("GET", "/regions");
  }

  credits() {
    return this.request("GET", "/credits");
  }

  billingCheckout({
    amount,
    paymentMethod,
    workspaceId,
    successUrl,
    cancelUrl,
  }) {
    const body = { amount };
    if (paymentMethod) body.payment_method = paymentMethod;
    if (workspaceId) body.workspace_id = workspaceId;
    if (successUrl) body.success_url = successUrl;
    if (cancelUrl) body.cancel_url = cancelUrl;
    return this.request("POST", "/billing/checkout", { body });
  }

  stablecoinCheckout({ amount, ...params }) {
    return this.billingCheckout({ amount, paymentMethod: "stablecoin", ...params });
  }

  googleAuth({ credential, email, name, sub } = {}) {
    const body = {};
    if (credential) body.credential = credential;
    if (email) body.email = email;
    if (name) body.name = name;
    if (sub) body.sub = sub;
    return this.request("POST", "/auth/google", { body });
  }

  walletChallenge(address) {
    return this.request("POST", "/auth/wallet/challenge", { body: { address } });
  }

  walletVerify({ address, message, signature }) {
    return this.request("POST", "/auth/wallet/verify", {
      body: { address, message, signature },
    });
  }

  authSession() {
    return this.request("GET", "/auth/session");
  }

  logout() {
    return this.request("POST", "/auth/logout");
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

  trustRelease(url = DEFAULT_TRUST_RELEASE_URL) {
    return fetchTrustRelease({ trustUrl: url, fetchImpl: this.fetch });
  }
}

export async function fetchTrustRelease({
  trustUrl = DEFAULT_TRUST_RELEASE_URL,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!fetchImpl) {
    throw new Error("A fetch implementation is required");
  }
  return jsonOrThrow(await fetchImpl(trustUrl));
}

export const trustRelease = fetchTrustRelease;

async function jsonOrThrow(response) {
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new TrustedRouterError(
      response.status,
      errorMessage(payload) || response.statusText || "TrustedRouter error",
      payload,
    );
  }

  return payload;
}

async function throwResponse(response) {
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { message: text };
  }
  throw new TrustedRouterError(
    response.status,
    errorMessage(payload) || response.statusText || "TrustedRouter error",
    payload,
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
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      yield JSON.parse(data);
    }
  }
  buffer += decoder.decode();
  for (const line of buffer.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    yield JSON.parse(data);
  }
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

function isJsonBody(body) {
  if (!body || typeof body === "string") {
    return false;
  }
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    return false;
  }
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
    return false;
  }
  if (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer) {
    return false;
  }
  return true;
}
