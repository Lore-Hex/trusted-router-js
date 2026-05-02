export const DEFAULT_API_BASE_URL = "https://api.quillrouter.com/v1";
export const DEFAULT_TRUST_RELEASE_URL =
  "https://trust.trustedrouter.com/trust/gcp-release.json";

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

  chatCompletions({ model, messages, ...params }) {
    return this.request("POST", "/chat/completions", {
      body: { model, messages, ...params },
    });
  }

  models() {
    return this.request("GET", "/models");
  }

  credits() {
    return this.request("GET", "/credits");
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
