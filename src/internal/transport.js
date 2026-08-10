/**
 * L1 (policy kernel) + L2 (plane router / candidate set) + L3 (transport
 * engine) + L4 (attempt assembly) for the TrustedRouter JS SDK.
 *
 * `performRequest` is THE single retry/failover loop. It is the ONLY place
 * in the codebase where a base-URL candidate index advances and the ONLY
 * place that sleeps between attempts. Client facades contain zero loops,
 * zero sleeps, zero index references. (The abort timer in fetchWithTimeout
 * is a timeout, not a between-attempt sleep; the OAuth/attestation/session
 * modules are documented single-shot or TLS-state loops outside the engine
 * by design.)
 *
 * INVARIANTS (cross-SDK, keep in sync with ARCHITECTURE):
 *  (1) Failover set {502,503,504} ⊂ retry set {429, ≥500, verdict-true}.
 *      — test/alias-domain-failover.test.js "a 503 from the primary reaches
 *        an alias"; test/features.test.js "request retries on 429 then
 *        succeeds".
 *  (2) 500 NEVER moves domains — a server processed the non-idempotent
 *      inference; re-sending elsewhere risks a second generation.
 *      — test/alias-domain-failover.test.js "a 500 does NOT move to another
 *        domain" and its streaming twin in test/should-retry-header.test.js.
 *  (3) Aliases exist only for the default host; the control plane always has
 *      exactly one candidate (list length is the gate, not a second flag);
 *      custom bases are never redirected.
 *      — test/alias-domain-failover.test.js "a custom baseUrl is never
 *        redirected to a public alias"; test/index.test.js "control requests
 *        retry without regional failover".
 *  (4) x-should-retry overrides both predicates in both directions: explicit
 *      false forbids retry AND failover; explicit true forces retry;
 *      absent/unparseable keeps status heuristics.
 *      — test/should-retry-header.test.js "a labelled spent 502 is not
 *        retried, and does not move domains" / "a labelled-retryable 400 is
 *        retried even though the status says otherwise" (+ streaming twins).
 *  (5) Idempotency key minted once per logical call before the loop and
 *      re-sent verbatim across every attempt and domain move — the caller is
 *      never double-charged (idempotent auth + exactly-once settlement).
 *      — test/features.test.js "regional affinity pins fastest endpoint and
 *        preserves idempotency on failover"; test/index.test.js "streaming
 *        rawRequest fails over before returning error response".
 *  (6) Retries happen only before any body bytes are surfaced; a broken open
 *      stream propagates, never reconnects. The engine never drains a
 *      success body (that is what lets streaming share it).
 *      — test/should-retry-header.test.js "streaming: a broken open stream
 *        propagates and never reconnects".
 *  (7) The failover flag governs WHERE, never WHETHER — a pinned client
 *      still retries in place.
 *      — test/should-retry-header.test.js "a pinned client still retries in
 *        place" (+ streaming twin).
 *  (8) Transport errors (no server saw the request) may always move hosts
 *      within the flag gating; HTTP moves additionally require a
 *      failoverable status.
 *      — test/index.test.js "transport errors fail over to an alias";
 *        test/alias-domain-failover.test.js "a dead primary domain reaches
 *        an alias".
 *  (9) Terminal asymmetries are per-SDK contract and survive verbatim:
 *      exhausted-status RETURNS the response for the caller to classify
 *      (requestJson throws via jsonOrThrow, requestStream hands the raw
 *      Response to throwFromResponse) while IO exhaustion THROWS a
 *      transportError.
 *      — test/features.test.js "chatCompletionsRawStream raises typed error
 *        on 429"; test/features.test.js "request retries on 503 then gives
 *        up".
 * (10) The verdict-false guard inside isRegionalFailoverable is deliberately
 *      unreachable through the engine (shouldRetryResponse terminates on
 *      verdict-false first). It is a documented surviving mutant, mirrored
 *      across SDKs — moved verbatim, never "fixed", never tested.
 */

import { InternalError, jsonOrThrow } from "./errors.js";
import {
  ALIAS_API_BASE_URLS,
  DEFAULT_API_BASE_URL,
  REGION_BASE_URLS,
  VERSION,
} from "./models.js";

// ---- L1: policy kernel (pure, no I/O, no clock) -------------------------

export function readHeader(headers, name) {
  return headers?.get?.(name) ?? headers?.[name] ?? null;
}

export function parseRetryAfter(headers) {
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
export function shouldRetryVerdict(headers) {
  const raw = readHeader(headers, "x-should-retry");
  if (raw == null) return null;
  const value = String(raw).trim().toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

export function isRetryable(statusCode) {
  return statusCode === 429 || statusCode >= 500;
}

// May this move to a DIFFERENT domain. An explicit `x-should-retry: false`
// forbids it outright: that is the gateway saying a provider already ran, which
// is exactly when re-sending anywhere costs a second generation.
export function isRegionalFailoverable(statusCode, headers) {
  if (shouldRetryVerdict(headers) === false) return false;
  return statusCode === 502 || statusCode === 503 || statusCode === 504;
}

// May we send this again — independent of WHERE it goes.
//
// This used to return `regionalFailover` for inference 502/503/504, so pinning
// to one host ALSO stopped retrying the gateway statuses entirely: one switch
// answering two questions. regionalFailover now governs only the destination.
export function shouldRetryResponse(statusCode, _isInferenceRequest, _regionalFailover, headers) {
  const verdict = shouldRetryVerdict(headers);
  if (verdict !== null) return verdict;
  return isRetryable(statusCode);
}

// A transport failure means no server saw the request, so it is always safe to
// send again; regionalFailover only decides whether the retry may change host.
export function shouldRetryTransport(_isInferenceRequest, _regionalFailover) {
  return true;
}

export function transportError(error) {
  const message =
    error && typeof error.message === "string" ? error.message : String(error);
  return new InternalError(
    503,
    `TrustedRouter endpoint unavailable: ${message}`,
    null,
  );
}

export function retrySleepMs(attempt, retryAfterSeconds) {
  // Exponential backoff with full jitter, capped at 30s. Honor
  // retry-after as a floor.
  const baseMs = Math.min(30_000, 500 * 2 ** attempt);
  const jittered = Math.random() * baseMs;
  const floor = (retryAfterSeconds ?? 0) * 1000;
  return Math.max(jittered, floor);
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- L2: plane router / candidate set ------------------------------------

export function baseUrls(primaryBaseUrl) {
  // This list MUST have more than one entry or failover cannot engage: the
  // advance in performRequest is guarded by
  // `baseIndex < candidates.length - 1`, so a single-entry list makes it
  // unreachable by construction.
  //
  // Aliases are appended only for the default host. A caller who passed their
  // own baseUrl (private deployment, test server, regional pin) gets exactly
  // that; silently redirecting their traffic to a public alias would be worse
  // than failing.
  const primary = primaryBaseUrl.replace(/\/+$/, "");
  if (primary !== DEFAULT_API_BASE_URL.replace(/\/+$/, "")) return [primary];
  return [...new Set([primary, ...ALIAS_API_BASE_URLS.map((u) => u.replace(/\/+$/, ""))])];
}

export function regionCandidates(primaryBaseUrl) {
  return [...new Set([...REGION_BASE_URLS, primaryBaseUrl.replace(/\/+$/, "")])];
}

export function healthyRegionStatus(statusCode) {
  return statusCode === 200 || statusCode === 401;
}

/**
 * The candidate provider for the inference plane, with the lazy once-only
 * regional-affinity ranking semantics preserved (regionAffinityPending /
 * regionAffinityPromise — pinned by test/features.test.js "regional affinity
 * pins fastest endpoint and preserves idempotency on failover").
 *
 * Mutates ctx.baseUrls so `sdk.baseUrls` stays a live property.
 */
export async function activeBaseUrls(ctx) {
  if (!ctx.regionAffinityPending) return ctx.baseUrls;
  if (!ctx.regionAffinityPromise) {
    ctx.regionAffinityPromise = rankRegionalBaseUrls(ctx);
  }
  ctx.baseUrls = await ctx.regionAffinityPromise;
  ctx.regionAffinityPending = false;
  return ctx.baseUrls;
}

export async function rankRegionalBaseUrls(ctx) {
  const candidates = regionCandidates(ctx.baseUrl);
  let winner = null;
  try {
    winner = await Promise.any(
      candidates.map(async (baseUrl) => {
        const response = await fetchWithTimeout(
          ctx,
          `${baseUrl.replace(/\/v1$/, "")}/health`,
          { method: "GET", headers: { accept: "application/json" } },
          ctx.regionProbeTimeout,
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
    return [ctx.baseUrl];
  }
  return [...new Set([winner, ctx.baseUrl, ...candidates])];
}

// ---- L4: attempt assembly -------------------------------------------------

export function userAgent() {
  const node =
    typeof process !== "undefined" && process.versions?.node
      ? `node/${process.versions.node}`
      : "browser";
  const platform = typeof process !== "undefined" ? process.platform : "web";
  return `trusted-router-js/${VERSION} ${node} ${platform}`;
}

export const DEFAULT_USER_AGENT = userAgent();

export function newIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) {
    return `tr-req-${globalThis.crypto.randomUUID()}`;
  }
  const suffix = Math.random().toString(36).slice(2);
  return `tr-req-${Date.now().toString(36)}-${suffix}`;
}

export function serializeBody(body, headers) {
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

export function buildHeaders(ctx, {
  headers,
  extraHeaders,
  idempotencyKey,
  apiKey,
  workspaceId,
}) {
  const out = new Headers({ "user-agent": DEFAULT_USER_AGENT });
  for (const [k, v] of Object.entries(ctx.defaultHeaders)) out.set(k, v);
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
  const selectedWorkspaceId = workspaceId ?? ctx.workspaceId;
  if (selectedWorkspaceId)
    out.set("x-trustedrouter-workspace", selectedWorkspaceId);
  const bearer = apiKey ?? ctx.apiKey;
  if (bearer && !out.has("authorization")) {
    out.set("authorization", `Bearer ${bearer}`);
  }
  return out;
}

export async function fetchWithTimeout(ctx, url, init, timeoutMs) {
  if (!timeoutMs) {
    return ctx.fetch(url, init);
  }
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await ctx.fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

// ---- L3: transport engine ---------------------------------------------

/**
 * THE single retry/failover loop for every request mode — buffered JSON and
 * streaming-open alike. Returns the terminal Response UNDRAINED so streaming
 * consumers can read the body directly; buffered callers go through
 * `requestJson`, which drains and classifies.
 *
 * ctx is the TrustedRouter instance (or any object with fetch, maxRetries,
 * regionalFailover, defaultHeaders, apiKey, workspaceId, baseUrl, baseUrls,
 * regionAffinityPending/Promise, regionProbeTimeout).
 *
 * Candidates resolve once per logical call: `init._baseUrls` pins the list
 * (the control plane passes `[controlBaseUrl]`, so a length-1 list makes the
 * advance unreachable by construction); otherwise the ranked inference list
 * is used. The idempotency key is minted ONCE before the loop and replayed
 * verbatim on every attempt and every domain.
 */
export async function performRequest(ctx, method, path, init = {}) {
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
  const requestHeaders = buildHeaders(ctx, {
    headers,
    extraHeaders,
    idempotencyKey: requestIdempotencyKey,
    apiKey,
    workspaceId,
  });
  const requestBody = serializeBody(body, requestHeaders);

  const candidates = _baseUrls ?? await activeBaseUrls(ctx);
  let attempt = 0;
  let baseIndex = 0;
  while (true) {
    const url = `${candidates[baseIndex]}/${String(path).replace(/^\/+/, "")}`;
    // ONE decision point per attempt. `decision.move` asks the policy kernel
    // whether the retry MAY change host; the shared tail below is the only
    // place that actually advances.
    let decision;
    let response = null;
    try {
      response = await fetchWithTimeout(
        ctx,
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
        attempt >= ctx.maxRetries ||
        !shouldRetryTransport(isInferenceRequest, ctx.regionalFailover)
      ) {
        throw transportError(error);
      }
      // No server saw the request, so re-sending is always safe and moving
      // hosts is allowed whenever the flag gating permits (invariant 8).
      decision = { move: true, retryAfter: null };
    }
    if (response !== null) {
      if (
        attempt >= ctx.maxRetries ||
        !shouldRetryResponse(
          response.status,
          isInferenceRequest,
          ctx.regionalFailover,
          response.headers,
        )
      ) {
        // Terminal: surface the response UNDRAINED (invariants 6 and 9).
        return response;
      }
      decision = {
        move: isRegionalFailoverable(response.status, response.headers),
        retryAfter: parseRetryAfter(response.headers),
      };
      // Drain ONLY responses already decided retryable, so we don't leak a
      // connection while sleeping. Success bodies are never drained here.
      try {
        await response.text();
      } catch {
        /* ignore */
      }
    }
    if (
      decision.move &&
      isInferenceRequest &&
      ctx.regionalFailover &&
      baseIndex < candidates.length - 1
    ) {
      baseIndex += 1; // THE ONLY candidate advance in the codebase.
    }
    await sleep(retrySleepMs(attempt, decision.retryAfter));
    attempt += 1;
  }
}

/** Buffered mode: drain, decode, classify (invariant 9). */
export async function requestJson(ctx, method, path, init = {}) {
  return jsonOrThrow(await performRequest(ctx, method, path, init));
}

/** Streaming-open mode: hand back the terminal Response undrained. */
export async function requestStream(ctx, method, path, init = {}) {
  return performRequest(ctx, method, path, init);
}
