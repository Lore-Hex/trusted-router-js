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
import { RequestRecorder, errorChain } from "./telemetry.js";

// ---- L1: policy kernel (pure, no I/O, no clock) -------------------------

export function readHeader(headers, name) {
  return headers?.get?.(name) ?? headers?.[name] ?? null;
}

/**
 * Ceiling on a server-supplied Retry-After floor.
 *
 * Retry-After arrives from whatever answered the socket — the gateway, a proxy
 * in front of it, an alias domain — so it is untrusted input, and it was being
 * applied as an *uncapped* floor on the sleep. Non-finite values were already
 * rejected here, but finite-and-absurd ones were accepted silently:
 * `Retry-After: 100000` parks a caller for 27.8 hours per attempt, and
 * `1e300` produced a delay Node then clamped to 1 ms with a
 * TimeoutOverflowWarning — a hot retry loop dressed as a long wait.
 *
 * 60 s is above any hint a healthy gateway sends and far below the point where
 * a caller would rather have the error. Matches MAX_RETRY_AFTER_SECONDS in
 * trusted-router-py so both SDKs accept the same header language.
 */
export const MAX_RETRY_AFTER_SECONDS = 60;

/** Clamp a parsed hint into [0, MAX_RETRY_AFTER_SECONDS], or reject it.
 *  Rejects exactly {NaN, ±Infinity, negatives} — the set the Python SDK
 *  rejects — so the two cannot drift on acceptance. */
function boundedRetryAfter(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(seconds, MAX_RETRY_AFTER_SECONDS);
}

export function parseRetryAfter(headers) {
  // retry-after-ms wins when both are present: it is the more precise of the
  // two, and a server that sends it means the sub-second value.
  const rawMs = readHeader(headers, "retry-after-ms");
  if (rawMs) {
    const bounded = boundedRetryAfter(Number(String(rawMs).trim()) / 1000);
    if (bounded !== null) return bounded;
  }
  const raw = readHeader(headers, "retry-after");
  if (!raw) return null;
  return boundedRetryAfter(Number(String(raw).trim()));
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
  // retry-after as a floor — bounded, so a hostile or broken hint cannot
  // park the caller.
  const baseMs = Math.min(30_000, 500 * 2 ** attempt);
  const jittered = Math.random() * baseMs;
  const floor = (boundedRetryAfter(retryAfterSeconds ?? 0) ?? 0) * 1000;
  // Re-clamp rather than trusting the caller: retrySleepMs is exported and
  // called directly, so the bound belongs on the value that reaches setTimeout.
  return Math.min(Math.max(jittered, floor), Math.max(30_000, MAX_RETRY_AFTER_SECONDS * 1000));
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
  // Exactly the grammar the enclave parses (client telemetry contract v1):
  // trusted-router-js/SEMVER with an optional runtime/version token. The old
  // trailing platform word made the whole value unparseable server-side, so
  // the SDK was invisible in the reliability data.
  const runtime =
    typeof process !== "undefined" && process.versions?.node
      ? ` node/${process.versions.node}`
      : "";
  return `trusted-router-js/${VERSION}${runtime}`;
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
  // x-tr-client is reserved for the engine (client telemetry contract v1).
  // Strip it from every caller source — constructor headers, per-call
  // headers, extraHeaders — so nothing can ride the reserved name past the
  // opt-out / custom-host / control-plane suppression rules; performRequest
  // adds a validated value per eligible attempt.
  out.delete("x-tr-client");
  return out;
}

// The Response readers that buffer the whole body. Each one settling means
// the body is finished, so the caller's cancellation has nothing left to cut.
const BODY_READERS = ["arrayBuffer", "blob", "bytes", "formData", "json", "text"];

/**
 * Re-expose `response.body` as a stream that reports when it settles.
 *
 * The source is locked on the first READ, never on construction: on a plain
 * Response, reading `.body` does not disturb or lock anything, so
 * `response.body` followed by `response.text()` is legal and must stay legal.
 * Locking eagerly would have broken that, and every reader in BODY_READERS
 * with it.
 */
function watchedBody(stream, onSettled) {
  let reader = null;
  return new ReadableStream({
    async pull(controller) {
      try {
        if (reader === null) reader = stream.getReader();
        const { done, value } = await reader.read();
        if (done) {
          onSettled();
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        // Includes the caller's abort reason arriving mid-stream, which is
        // the whole point of keeping the relay alive this long. Also covers a
        // source already consumed through one of the buffered readers.
        onSettled();
        controller.error(error);
      }
    },
    cancel(reason) {
      onSettled();
      return reader === null ? stream.cancel(reason) : reader.cancel(reason);
    },
  });
}

/**
 * Run `onSettled` once the response body is finished — fully read through any
 * buffered reader, or read/cancelled/errored through `response.body`.
 *
 * Instruments the Response in place rather than rebuilding it, so `url`,
 * `type`, `redirected` and object identity survive for the caller who
 * receives it from `rawRequest`. A Response-like that refuses the
 * instrumentation settles immediately instead of failing the request.
 *
 * A `clone()` is deliberately not instrumented: its body is a tee of this
 * one, and the relay is released when THIS response's body settles.
 */
function releaseWhenBodySettles(response, onSettled) {
  try {
    const stream = response?.body ?? null;
    if (stream === null || typeof stream.getReader !== "function") {
      // 204/HEAD, or a runtime that does not expose the body as a web stream:
      // there is no post-headers read left to cancel.
      onSettled();
      return response;
    }
    for (const name of BODY_READERS) {
      const read = response[name];
      if (typeof read !== "function") continue;
      Object.defineProperty(response, name, {
        configurable: true,
        writable: true,
        value(...args) {
          let pending;
          try {
            pending = read.apply(this, args);
          } catch (error) {
            onSettled();
            throw error;
          }
          return Promise.resolve(pending).then(
            (value) => {
              onSettled();
              return value;
            },
            (error) => {
              onSettled();
              throw error;
            },
          );
        },
      });
    }
    let watched = null;
    Object.defineProperty(response, "body", {
      configurable: true,
      get() {
        // Runs on the caller's stack, outside the try below, so it carries its
        // own: reading `response.body` must never start throwing.
        if (watched === null) {
          try {
            watched = watchedBody(stream, onSettled);
          } catch {
            onSettled();
            watched = stream;
          }
        }
        return watched;
      },
    });
  } catch {
    onSettled();
  }
  return response;
}

/**
 * One fetch under BOTH deadlines — the caller's `signal` and the SDK's
 * `timeout` — with the caller's cancellation reaching the RESPONSE BODY, not
 * merely the fetch call.
 *
 * The timeout controller must not REPLACE init.signal (that silently dropped
 * the caller's cancellation for the documented `signal` + `timeout`
 * combination), so the caller's abort is relayed into it with its REASON
 * forwarded verbatim — which is also what keeps the rejection identity-equal
 * to `callerSignal.reason` for the engine's cancellation check below.
 *
 * LIFETIME. `fetch` resolves as soon as the response HEADERS arrive; the body
 * is read afterwards, by `jsonOrThrow` for buffered calls and by the SSE codec
 * for streaming ones. Releasing the relay when the fetch promise settled left
 * a cancellation raised during the body read with nothing listening: the
 * request ran to completion and returned its payload with the caller's signal
 * already aborted. So the relay is tied to the BODY — released when the body
 * settles, when there is no body, or when the fetch itself rejects — and
 * `{ once: true }` plus an idempotent release means neither a retry, a
 * cancellation, nor an early failure can leave a listener on a caller signal
 * that outlives the call. (Real undici keeps its own abort listener until
 * end-of-body, so the abort does cut a streaming body once it is delivered.)
 *
 * `AbortSignal.any` expresses this composition natively but is not usable
 * here: on Node 20 — the floor in `engines` — a source signal retains every
 * dependent signal ever composed from it, with no way to detach one (measured:
 * 300k composites against one caller signal held ~590 MB across a forced GC).
 * A caller reusing one signal would pay that per attempt.
 *
 * The timeout keeps its existing scope and shape: it bounds reaching the
 * headers, is cleared once fetch resolves, and still aborts BARE, so an SDK
 * timeout surfaces as an AbortError and is never mistaken for the caller's
 * reason nor recorded as a host fact.
 */
export async function fetchWithTimeout(ctx, url, init, timeoutMs) {
  const callerSignal = init.signal ?? null;
  if (!timeoutMs) {
    // No SDK deadline: the caller's signal goes to fetch untouched and already
    // covers the body read.
    return ctx.fetch(url, init);
  }
  const controller = new AbortController();
  if (callerSignal === null) {
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await ctx.fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
  const relayAbort = () => controller.abort(callerSignal.reason);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      callerSignal.removeEventListener("abort", relayAbort);
    } catch {
      /* nothing to detach from; never fail a request over teardown */
    }
  };
  if (callerSignal.aborted) relayAbort();
  else callerSignal.addEventListener("abort", relayAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await ctx.fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    clearTimeout(timer);
    release();
    throw error;
  }
  clearTimeout(timer);
  return releaseWhenBodySettles(response, release);
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
    _streaming = false,
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
  // Is this rejection the caller cancelling, rather than a fact about the
  // host? Decided CAUSALLY, not by the signal's state at catch time: the
  // rejection must BE the caller's abort reason. `error.name` alone cannot
  // tell — only a bare `controller.abort()` yields an AbortError, while
  // `AbortSignal.timeout()` rejects with a TimeoutError and
  // `controller.abort(reason)` with the caller's own object — but a mere
  // `signal.aborted` test is too coarse in the other direction: a genuine host
  // failure that races a late abort is still a true fact about the host, and
  // reclassifying it would hide a real failure and skip the retry. Identity
  // holds through fetchWithTimeout, which relays the reason verbatim.
  const callerSignal = rest.signal ?? null;
  // Read CAUSALLY down the `cause` chain, the way classifyTransportError
  // reads it (same walker), because the identity is routinely not at the top:
  // a transport that rethrows `new TypeError("...", { cause: signal.reason })`
  // — the shape Node's own fetch uses for every failure it reports — was
  // taken for a host failure, so the client's own cancellation was RETRIED
  // and written to the wire as po=transport_error;ph=... against two
  // TrustedRouter hosts, corrupting the reliability signal this channel
  // exists to collect. Returns the error to surface, or null for "not a
  // cancellation"; never throws, so a hostile `cause` getter cannot fail a
  // request.
  const callerCancellation = (error) => {
    try {
      for (const link of errorChain(error)) {
        if (
          callerSignal !== null &&
          callerSignal.aborted === true &&
          link === callerSignal.reason
        ) {
          // The caller's reason propagates unwrapped, whatever wrapped it.
          return { error: callerSignal.reason };
        }
        // A bare `controller.abort()` and the SDK's own timeout both land
        // here; neither carries a reason to unwrap, so the throw stands.
        if (link?.name === "AbortError") return { error };
      }
    } catch {
      /* an unreadable chain is not a cancellation */
    }
    return null;
  };
  // Telemetry header channel (contract v1): ONE recorder per logical call,
  // engine-owned, so this loop stays the single emit point. Control-plane
  // calls (pinned _baseUrls) and opted-out clients never construct one; a
  // custom current host makes headerValue() return null. The recorder's
  // methods swallow their own failures — telemetry never fails a request.
  const recorder =
    isInferenceRequest && ctx.telemetryEnabled === true
      ? new RequestRecorder({ streaming: _streaming === true, now: ctx._telemetryNow })
      : null;
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
    // The base Headers never carries x-tr-client (buildHeaders strips it);
    // an eligible attempt gets its own clone so a fetch implementation that
    // retains a previous attempt's headers never sees them mutate.
    let attemptHeaders = requestHeaders;
    if (recorder) {
      recorder.beginAttempt(candidates[baseIndex]);
      const clientHeader = recorder.headerValue();
      attemptHeaders = new Headers(requestHeaders);
      if (clientHeader) attemptHeaders.set("x-tr-client", clientHeader);
    }
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
          headers: attemptHeaders,
          body: requestBody,
          ...rest,
        },
        timeout,
      );
    } catch (error) {
      // A caller cancellation is terminal and is NOT a fact about the host:
      // recording one would put a false po=/pc=/ph= claim on the wire and burn
      // a failover candidate on a retry the dead signal must fail.
      const cancelled = callerCancellation(error);
      if (cancelled !== null) throw cancelled.error;
      // Record with the live error object BEFORE transportError() flattens
      // the failure to a message string — after that only the string is left.
      recorder?.onTransportError(error);
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
      recorder?.onResponse(response.status);
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
      recorder?.onMoved();
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
  return performRequest(ctx, method, path, { ...init, _streaming: true });
}
