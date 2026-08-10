/**
 * L6 — ERROR TAXONOMY.
 *
 * The typed error hierarchy, status→exception classification, and response
 * decode/raise helpers. This is the single copy in the SDK: oauth /
 * attestation / session import from here (directly or via the barrel) and
 * keep no private duplicates.
 *
 * Attribution fields (layer/source/provider/requestId) are lifted from the
 * gateway payload and the raw payload is preserved on the error
 * (test/parity-contract.test.js "errors expose attribution and retain the
 * raw payload").
 */

import { parseRetryAfter } from "./transport.js";

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

export function classifyError(statusCode, message, payload, retryAfter) {
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

export function errorMessage(payload) {
  if (payload && typeof payload === "object") {
    if (payload.error && typeof payload.error === "object") {
      return payload.error.message || payload.error.type;
    }
    return payload.message;
  }
  return undefined;
}

export async function jsonOrThrow(response) {
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

export async function throwFromResponse(response) {
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
