/**
 * L5 — CLIENT RELIABILITY TELEMETRY: recording (contract v1 of
 * docs/client-telemetry.md in Lore-Hex/quill-router).
 *
 * Everything that leaves the process is a closed enum or a clamped integer;
 * there is no free text anywhere. The only emitter is THE engine loop in
 * ./transport.js (`performRequest`), which owns one RequestRecorder per
 * logical inference call, sets/clears `x-tr-client` per attempt (the header
 * channel, §3) and hands the finished record — one event plus its exact
 * per-minute counter increments — to a sink (the beacon channel, §4/§5,
 * delivered by ./beacon.js `TelemetryReporter`). Control-plane calls never
 * construct a recorder; custom base URLs never carry the header; opting out
 * suppresses BOTH channels while User-Agent stays.
 *
 * Telemetry may never fail a request: every public method here swallows its
 * own failures, and an out-of-grammar header value sends NOTHING rather than
 * a malformed header. Mirrors RequestRecorder in trusted-router-py
 * (`_telemetry.py`), which is the reference implementation of the contract.
 */

import {
  ALIAS_API_BASE_URLS,
  DEFAULT_API_BASE_URL,
  DEFAULT_CONTROL_BASE_URL,
  REGION_BASE_URLS,
} from "./models.js";

export const TELEMETRY_SCHEMA_VERSION = 1;
export const DEFAULT_TELEMETRY_PATH = "/client-events";
export const TELEMETRY_HOSTS = Object.freeze([
  "apex",
  "ally",
  "uptime",
  "us_central1",
  "us_east4",
  "europe_west4",
  "control",
  "custom",
]);
export const TELEMETRY_ENDPOINTS = Object.freeze([
  "chat_completions",
  "messages",
  "responses",
  "embeddings",
  "images",
  "videos",
  "models",
  "fusion",
  "control_other",
  "inference_other",
]);
export const TELEMETRY_OUTCOMES = Object.freeze([
  "ok",
  "http_error",
  "transport_error",
  "timeout",
  "stream_broken",
  "aborted",
]);
export const TELEMETRY_FINAL_OUTCOMES = Object.freeze([
  ...TELEMETRY_OUTCOMES,
  "exhausted",
]);
export const TELEMETRY_ERROR_CLASSES = Object.freeze([
  "dns",
  "tls",
  "connect_refused",
  "connect_timeout",
  "connect_error",
  "read_timeout",
  "write_timeout",
  "pool_timeout",
  "protocol_error",
  "reset",
  "io_error",
  "proxy_error",
  "stream_stalled",
  "unknown",
]);
export const TELEMETRY_TIMEOUT_PHASES = Object.freeze([
  "none",
  "connect",
  "first_byte",
  "idle",
  "total",
]);
export const TELEMETRY_LATENCY_BUCKETS = Object.freeze([
  "lt100",
  "lt200",
  "lt400",
  "lt800",
  "lt1600",
  "lt3200",
  "lt6400",
  "lt12800",
  "lt25600",
  "lt51200",
  "lt102400",
  "ge102400",
]);
export const TELEMETRY_HTTP_STATUS_CLASSES = Object.freeze([
  "none",
  "2xx",
  "4xx",
  "429",
  "5xx",
]);
export const TELEMETRY_ERROR_SOURCES = Object.freeze(["router", "provider", "unknown"]);
export const TELEMETRY_SAMPLE_REASONS = Object.freeze([
  "failure",
  "retried",
  "slow",
  "random",
]);
// The beacon schema module (client_events_schema.py) allows only GET|POST for
// ClientRequestEvent.method; §5.3's PUT|PATCH|DELETE is a doc bug (modules
// win). Other methods are never recorded, like py's `_recordable` gate.
export const TELEMETRY_METHODS = Object.freeze(["GET", "POST"]);

export const MAX_DURATION_MS = 3_600_000;
export const MODEL_RE = /^[A-Za-z0-9._:/~@-]{1,128}$/;
export const REQUEST_ID_RE = /^rlog_[0-9a-f]{32}$/;

const MAX_ATTEMPT_INDEX = 99;
const HEADER_VALUE_RE = /^[a-z0-9_]{1,24}$/;
const TIMEOUT_ERROR_CLASSES = new Set([
  "connect_timeout",
  "read_timeout",
  "write_timeout",
  "pool_timeout",
]);
// The timeout phase each timeout class belongs to (py classify_transport_error).
const TIMEOUT_PHASES = new Map([
  ["connect_timeout", "connect"],
  ["read_timeout", "first_byte"],
  ["write_timeout", "first_byte"],
  ["pool_timeout", "none"],
]);
// §3.2's po vocabulary is none|http_error|transport_error|timeout|
// stream_broken — NOT the full Outcome enum. A retry can follow an `ok`
// attempt (a sub-400 response labelled x-should-retry: true), and po=ok
// would make the enclave drop the whole header; anything outside the po
// vocabulary serializes as po=none with pc=none.
const HEADER_PREVIOUS_OUTCOMES = new Set([
  "http_error",
  "transport_error",
  "timeout",
  "stream_broken",
]);
const LATENCY_UPPER_BOUNDS = [100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600, 51200, 102400];
const TIMEOUT_FLOORS_MS = new Map([
  ["connect", 10_000],
  ["first_byte", 60_000],
  ["idle", 30_000],
]);

function schemeHost(url) {
  try {
    const parsed = new URL(String(url));
    if (!parsed.protocol || !parsed.hostname) return null;
    return `${parsed.protocol.slice(0, -1).toLowerCase()}//${parsed.hostname.toLowerCase()}`;
  } catch {
    return null;
  }
}

function isControlHost(url) {
  const pair = schemeHost(url);
  if (pair === null) return false;
  const [scheme, host] = pair.split("//");
  return (
    scheme === "https" &&
    (host === "trustedrouter.com" || host.endsWith(".trustedrouter.com"))
  );
}

/** Map a base URL to the closed telemetry host vocabulary. */
export function hostEnum(baseUrl) {
  const pair = schemeHost(baseUrl);
  if (pair === null) return "custom";
  if (pair === schemeHost(DEFAULT_API_BASE_URL)) return "apex";
  if (pair === schemeHost(ALIAS_API_BASE_URLS[0])) return "ally";
  if (pair === schemeHost(ALIAS_API_BASE_URLS[1])) return "uptime";
  const regions = ["us_central1", "us_east4", "europe_west4"];
  for (let index = 0; index < REGION_BASE_URLS.length; index += 1) {
    if (pair === schemeHost(REGION_BASE_URLS[index])) return regions[index];
  }
  if (pair === schemeHost(DEFAULT_CONTROL_BASE_URL) || isControlHost(baseUrl)) {
    return "control";
  }
  return "custom";
}

const EXACT_ENDPOINTS = new Map([
  ["/chat/completions", "chat_completions"],
  ["/messages", "messages"],
  ["/responses", "responses"],
  ["/embeddings", "embeddings"],
]);
const PREFIX_ENDPOINTS = [
  ["/images", "images"],
  ["/videos", "videos"],
  ["/models", "models"],
  ["/fusion", "fusion"],
];

/**
 * Map an inference path to the closed telemetry endpoint vocabulary (py
 * endpoint_enum). The query string is ignored; leading slashes are
 * normalised the way the engine builds the URL (`${base}/${path}` with the
 * leading slashes stripped), so "chat/completions" and "/chat/completions"
 * describe the same request.
 */
export function endpointEnum(path) {
  let clean = String(path ?? "");
  const cut = clean.search(/[?#]/);
  if (cut !== -1) clean = clean.slice(0, cut);
  clean = `/${clean.replace(/^\/+/, "")}`;
  clean = clean.replace(/\/+$/, "") || "/";
  const exact = EXACT_ENDPOINTS.get(clean);
  if (exact !== undefined) return exact;
  for (const [prefix, endpoint] of PREFIX_ENDPOINTS) {
    if (clean === prefix || clean.startsWith(`${prefix}/`)) return endpoint;
  }
  return "inference_other";
}

/** The LatencyBucket (upper-bound-exclusive, ms) a duration falls in. */
export function latencyBucket(ms) {
  const value = Math.max(0, Math.trunc(Number(ms)) || 0);
  for (let index = 0; index < LATENCY_UPPER_BOUNDS.length; index += 1) {
    if (value < LATENCY_UPPER_BOUNDS[index]) return TELEMETRY_LATENCY_BUCKETS[index];
  }
  return TELEMETRY_LATENCY_BUCKETS[TELEMETRY_LATENCY_BUCKETS.length - 1];
}

/** The HttpStatusClass of a status (429 is its own class; null → none). */
export function statusClass(status) {
  if (status === null || status === undefined) return "none";
  const code = Number(status);
  if (code >= 200 && code <= 299) return "2xx";
  if (code === 429) return "429";
  if (code >= 400 && code <= 499) return "4xx";
  if (code >= 500 && code <= 599) return "5xx";
  return "none";
}

/** §5.4 timeout_floor_met: configured connect ≥10 s / first-byte ≥60 s / idle ≥30 s. */
export function timeoutFloorMet(phase, configuredMs) {
  if (configuredMs === null || configuredMs === undefined) return false;
  const floor = TIMEOUT_FLOORS_MS.get(phase);
  return floor !== undefined && Number(configuredMs) >= floor;
}

/**
 * Resolve the opt-out precedence without reading process state implicitly:
 * explicit constructor option > TRUSTEDROUTER_TELEMETRY > DO_NOT_TRACK >
 * default-on only when the inference base is a known TrustedRouter host AND
 * the control plane is https trustedrouter.com (or a subdomain). Mirrors
 * resolve_telemetry_enabled in trusted-router-py so the SDKs cannot drift.
 * One answer for both channels: opting out disables the header AND the beacon.
 */
export function resolveTelemetryEnabled(
  explicit,
  { baseUrl, controlBaseUrl, environ },
) {
  if (explicit !== null && explicit !== undefined) return Boolean(explicit);
  const env = environ ?? {};
  const configured = String(env.TRUSTEDROUTER_TELEMETRY ?? "")
    .trim()
    .toLowerCase();
  if (["0", "false", "off", "no"].includes(configured)) return false;
  if (["1", "true", "on", "yes"].includes(configured)) return true;
  if (String(env.DO_NOT_TRACK ?? "").trim() === "1") return false;
  return hostEnum(baseUrl) !== "custom" && isControlHost(controlBaseUrl);
}

/**
 * The error and its `cause` ancestors, newest first — cycle-safe and bounded.
 *
 * Node's fetch reports the real failure as the `cause` of a generic
 * `TypeError: fetch failed`, so every predicate that asks "what actually went
 * wrong here" has to look past the top-level object. Shared with the engine's
 * cancellation check (transport.js) so there is ONE chain walker in the SDK.
 */
export function errorChain(error) {
  const chain = [];
  const seen = new Set();
  let current = error;
  while (
    current !== null &&
    current !== undefined &&
    chain.length < 6 &&
    !seen.has(current)
  ) {
    chain.push(current);
    seen.add(current);
    current = current.cause;
  }
  return chain;
}

const TLS_CODES = new Set([
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "CERT_REVOKED",
  "CERT_SIGNATURE_FAILURE",
  "CERT_UNTRUSTED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "HOSTNAME_MISMATCH",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);

// undici raises SocketError (code UND_ERR_SOCKET) for several unrelated
// phases, distinguished only by its message: verified against Node 20.20.2's
// embedded undici, the set is "bad response" / "bad upgrade" (a malformed or
// unusable response — a protocol failure), "bad connect" (a failed CONNECT
// tunnel — the connect phase), and "other side closed" / "closed" (a genuine
// peer reset). Mapping the whole code to `reset` would serialise a false
// closed-enum fact for the first three.
const SOCKET_PROTOCOL_MESSAGES = new Set(["bad response", "bad upgrade"]);
const SOCKET_CONNECT_MESSAGES = new Set(["bad connect"]);
const isSocketError = (code, name) =>
  code === "UND_ERR_SOCKET" || name === "SocketError";
const socketPhase = (code, name, message) => {
  if (!isSocketError(code, name)) return null;
  const normalized = message.trim().toLowerCase();
  if (SOCKET_PROTOCOL_MESSAGES.has(normalized)) return "protocol_error";
  if (SOCKET_CONNECT_MESSAGES.has(normalized)) return "connect_error";
  return "reset";
};

// Highest-priority class wins across the whole `cause` chain, in the same
// order as the Python classifier: timeouts, then TLS/DNS/socket phases, then
// protocol, IO, and proxy, then unknown. Node's fetch wraps the real failure
// as the `cause` of `TypeError: fetch failed` (verified against Node 20
// undici for ENOTFOUND, ECONNREFUSED, ECONNRESET,
// DEPTH_ZERO_SELF_SIGNED_CERT, ERR_SSL_WRONG_VERSION_NUMBER, HPE_*,
// UND_ERR_HEADERS_OVERFLOW, UND_ERR_SOCKET's message set, and
// UND_ERR_CONNECT_TIMEOUT). A system ETIMEDOUT is split on `syscall`:
// read/write map to the matching timeout class, anything else is the
// connect phase. `pool_timeout` stays vocabulary-only here — no supported
// JS transport emits a distinguishable pool-acquire timeout — and a bare
// `TypeError: fetch failed` with no identifiable cause is `unknown` by
// design rather than a guess.
const ERROR_CLASSIFIERS = [
  [
    "connect_timeout",
    (code, name, _message, syscall) =>
      code === "UND_ERR_CONNECT_TIMEOUT" ||
      name === "ConnectTimeoutError" ||
      (code === "ETIMEDOUT" && syscall !== "read" && syscall !== "write"),
  ],
  [
    "read_timeout",
    (code, name, _message, syscall) =>
      code === "UND_ERR_HEADERS_TIMEOUT" ||
      code === "UND_ERR_BODY_TIMEOUT" ||
      name === "HeadersTimeoutError" ||
      name === "BodyTimeoutError" ||
      (code === "ETIMEDOUT" && syscall === "read"),
  ],
  [
    "write_timeout",
    (code, _name, _message, syscall) =>
      code === "ETIMEDOUT" && syscall === "write",
  ],
  [
    "tls",
    (code, _name, message) =>
      TLS_CODES.has(code) ||
      code.startsWith("ERR_TLS_") ||
      code.startsWith("ERR_SSL_") ||
      (code === "EPROTO" && /\b(ssl|tls|certificate|handshake)\b/i.test(message)),
  ],
  ["dns", (code) => code === "ENOTFOUND" || code === "EAI_AGAIN"],
  ["connect_refused", (code) => code === "ECONNREFUSED"],
  [
    "reset",
    (code, name, message) =>
      code === "ECONNRESET" || socketPhase(code, name, message) === "reset",
  ],
  [
    "connect_error",
    (code, name, message) =>
      ["EHOSTUNREACH", "ENETUNREACH", "EADDRNOTAVAIL", "ECONNABORTED", "EHOSTDOWN"].includes(
        code,
      ) || socketPhase(code, name, message) === "connect_error",
  ],
  [
    "protocol_error",
    (code, name, message) =>
      code.startsWith("HPE_") ||
      name === "HTTPParserError" ||
      code.startsWith("ERR_HTTP2_") ||
      code === "EPROTO" ||
      code === "UND_ERR_REQ_CONTENT_LENGTH_MISMATCH" ||
      code === "UND_ERR_RES_CONTENT_LENGTH_MISMATCH" ||
      code === "UND_ERR_HEADERS_OVERFLOW" ||
      name === "HeadersOverflowError" ||
      socketPhase(code, name, message) === "protocol_error",
  ],
  ["io_error", (code) => code === "EPIPE" || code === "ERR_STREAM_PREMATURE_CLOSE"],
  [
    "proxy_error",
    (code, name) =>
      code === "UND_ERR_PRX_TLS" || name === "SecureProxyConnectionError",
  ],
];

/** Classify a transport error into the closed ErrorClass vocabulary. */
export function classifyTransportError(error) {
  try {
    const chain = errorChain(error);
    for (const [errorClass, matches] of ERROR_CLASSIFIERS) {
      for (const item of chain) {
        const code = typeof item?.code === "string" ? item.code : "";
        const name = typeof item?.name === "string" ? item.name : "";
        const message = typeof item?.message === "string" ? item.message : "";
        const syscall = typeof item?.syscall === "string" ? item.syscall : "";
        if (matches(code, name, message, syscall)) return errorClass;
      }
    }
  } catch {
    /* telemetry never fails a request */
  }
  return "unknown";
}

function durationMs(start, end) {
  return Math.min(MAX_DURATION_MS, Math.max(0, Math.trunc(end - start)));
}

/** Case-insensitive header read over a Headers object or a plain record. */
function readHeaderValue(headers, name) {
  if (headers === null || headers === undefined) return null;
  try {
    if (typeof headers.get === "function") return headers.get(name) ?? null;
    const wanted = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
      if (String(key).toLowerCase() === wanted) return value ?? null;
    }
  } catch {
    /* telemetry never fails a request */
  }
  return null;
}

/** The sink that receives finished records; the beacon reporter implements it. */
export class NullSink {
  onRequest(_event, _counters) {}
}

/** In-memory sink for tests and telemetry debug tooling (py RecordingSink). */
export class RecordingSink {
  constructor() {
    this.events = [];
    this.counters = [];
  }

  onRequest(event, counters) {
    this.events.push(event);
    this.counters.push(...counters);
  }
}

const NULL_SINK = new NullSink();

// The engine associates the terminal Response with its recorder so the SSE
// codec (./sse.js) can report the first decoded event — the only place TTFT
// is observable (§6.1) — without changing the codec's public signatures.
const RECORDERS = new WeakMap();

export function attachRecorder(response, recorder, streamLifecycle = null) {
  try {
    if (response !== null && typeof response === "object") {
      RECORDERS.set(response, { recorder, streamLifecycle });
    }
  } catch {
    /* telemetry never fails a request */
  }
}

export function recorderFor(response) {
  try {
    return RECORDERS.get(response)?.recorder ?? null;
  } catch {
    return null;
  }
}

/**
 * Tell the response-body watcher that an SSE decoder now owns the stream.
 * Raw body EOF can happen one pull ahead of the decoder yielding its final
 * item; deferring settlement until the decoder unwinds keeps TTFT and an
 * early consumer return observable without changing the public stream API.
 */
export function beginRecorderStream(response) {
  try {
    RECORDERS.get(response)?.streamLifecycle?.begin?.();
  } catch {
    /* telemetry never fails a request */
  }
}

export function endRecorderStream(response) {
  try {
    RECORDERS.get(response)?.streamLifecycle?.end?.();
  } catch {
    /* telemetry never fails a request */
  }
}

/**
 * Record the per-attempt facts of one logical inference call as the engine
 * loop drives it, assemble the per-attempt `x-tr-client` value, and on
 * finish() derive the §5.3 event plus the exact §5.4 counter increments for
 * the sink. Mirrors RequestRecorder in trusted-router-py: beginAttempt /
 * onResponse / onTransportError / onMoved / onFirstEvent / onAborted /
 * headerValue / finish. The injectable clock (ms, monotonic) exists for
 * deterministic tests, like the Python reporter's.
 */
export class RequestRecorder {
  constructor({
    sink = null,
    endpoint = "inference_other",
    method = "POST",
    streaming = false,
    providerPinned = false,
    model = null,
    configuredTimeoutMs = null,
    now = null,
  } = {}) {
    this.sink = sink ?? NULL_SINK;
    this.endpoint = endpoint;
    this.method = String(method ?? "").toUpperCase();
    this._recordable =
      TELEMETRY_ENDPOINTS.includes(this.endpoint) &&
      TELEMETRY_METHODS.includes(this.method);
    this.streaming = Boolean(streaming);
    this.providerPinned = Boolean(providerPinned);
    this.model = typeof model === "string" && MODEL_RE.test(model) ? model : null;
    const configured = Number(configuredTimeoutMs);
    this.configuredTimeoutMs =
      Number.isFinite(configured) && configured > 0
        ? Math.min(MAX_DURATION_MS, Math.max(1, Math.trunc(configured)))
        : null;
    this._now = typeof now === "function" ? now : () => performance.now();
    this.attempts = [];
    this._attemptPhases = [];
    this.failoverUsed = false;
    this.ttftMs = null;
    // The true number of attempts begun, tracked separately from
    // `attempts.length` so the stored history can stay bounded (see
    // _storeAttempt) without the attempt index ever rewinding.
    this._attemptCount = 0;
    this._currentAttempt = null;
    this._currentPhase = "none";
    this._committedAttemptIndex = -1;
    this._attemptCounterRows = new Map();
    this._firstErrorClass = null;
    this._firstStarted = null;
    this._attemptStarted = null;
    this._currentHost = null;
    this._currentIndex = null;
    this._bodyStarted = false;
    this._finished = false;
  }

  beginAttempt(baseUrl) {
    try {
      this._commitCurrentAttempt();
      const started = this._now();
      if (this._firstStarted === null) this._firstStarted = started;
      this._attemptStarted = started;
      this._currentHost = hostEnum(baseUrl);
      this._currentIndex = Math.max(this._attemptCount, this.attempts.length);
      this._currentAttempt = null;
      this._currentPhase = "none";
    } catch {
      /* telemetry never fails a request */
    }
  }

  /**
   * Keep the history BOUNDED: `maxRetries` is caller-configured and only the
   * newest attempt is ever serialised in the header (and the beacon event
   * carries at most 16), so past the contract's 0..99 range — where
   * headerValue() already suppresses the header outright — the tail slot is
   * overwritten instead of the array growing. Telemetry must not turn the
   * engine's O(1) memory into O(maxRetries). The timeout phase of each
   * attempt rides in a parallel array.
   */
  _storeAttempt(attempt, phase = "none") {
    this._attemptCount = Math.max(this._attemptCount, attempt.index + 1);
    if (attempt.index < this.attempts.length) {
      this.attempts[attempt.index] = attempt;
      this._attemptPhases[attempt.index] = phase;
    } else if (this.attempts.length > MAX_ATTEMPT_INDEX) {
      this.attempts[this.attempts.length - 1] = attempt;
      this._attemptPhases[this.attempts.length - 1] = phase;
    } else {
      this.attempts.push(attempt);
      this._attemptPhases.push(phase);
    }
    this._currentAttempt = attempt;
    this._currentPhase = phase;
  }

  _index() {
    return this._currentIndex ?? this.attempts.length;
  }

  _previous(index) {
    if (this._currentAttempt?.index === index) return this._currentAttempt;
    return index < this.attempts.length ? this.attempts[index] : null;
  }

  /**
   * Aggregate a completed attempt before its bounded history slot can be
   * reused. This preserves exact attempt counters and the real attempt count
   * even when a caller configures more than 100 retries, without making the
   * logical request consume O(maxRetries) memory.
   */
  _commitCurrentAttempt() {
    const attempt = this._currentAttempt;
    if (attempt === null || attempt.index <= this._committedAttemptIndex) return;
    const phase = this._currentPhase ?? "none";
    const attemptTimeoutMs = this._configuredTimeoutMs(phase);
    const key = [
      "attempt",
      this.endpoint,
      this.streaming,
      attempt.host,
      attempt.outcome,
      attempt.errorClass ?? null,
      statusClass(attempt.httpStatus),
      phase,
      timeoutFloorMet(phase, attemptTimeoutMs),
      this.providerPinned,
    ];
    const id = JSON.stringify(key);
    let row = this._attemptCounterRows.get(id);
    if (row === undefined) {
      row = [key, { requests: 0, attempts: 0, failover_used: 0, first_attempt_success: 0 }];
      this._attemptCounterRows.set(id, row);
    }
    row[1].requests += 1;
    row[1].attempts += 1;
    row[1].failover_used += attempt.moved ? 1 : 0;
    if (this._firstErrorClass === null && attempt.errorClass != null) {
      this._firstErrorClass = attempt.errorClass;
    }
    this._committedAttemptIndex = attempt.index;
  }

  /**
   * Headers received: the attempt's outcome is ok (sub-400) or http_error,
   * with the contract's per-attempt response facts — `x-should-retry` as
   * observed, the bounded Retry-After hint (seconds, as the engine parsed
   * it), and the enclave's `x-request-id` (the client↔server join key,
   * §3.3). `error_source` is never populated, exactly like the Python
   * reference: the engine never reads an error body.
   */
  onResponse(statusCode, headers = null, retryAfterSeconds = null) {
    try {
      if (this._attemptStarted === null || this._currentHost === null) return;
      const elapsedMs = durationMs(this._attemptStarted, this._now());
      const rawShouldRetry = readHeaderValue(headers, "x-should-retry");
      const normalizedShouldRetry =
        rawShouldRetry === null ? null : String(rawShouldRetry).trim().toLowerCase();
      const shouldRetry =
        normalizedShouldRetry === "true" || normalizedShouldRetry === "false"
          ? normalizedShouldRetry
          : "absent";
      const rawRequestId = readHeaderValue(headers, "x-request-id");
      const requestId =
        typeof rawRequestId === "string" && REQUEST_ID_RE.test(rawRequestId)
          ? rawRequestId
          : null;
      const retryAfter = Number(retryAfterSeconds);
      const retryAfterMs =
        retryAfterSeconds !== null &&
        retryAfterSeconds !== undefined &&
        Number.isFinite(retryAfter) &&
        retryAfter >= 0
          ? Math.min(MAX_DURATION_MS, Math.trunc(retryAfter * 1000))
          : null;
      this._storeAttempt(
        {
          index: this._index(),
          host: this._currentHost,
          outcome: statusCode < 400 ? "ok" : "http_error",
          httpStatus: statusCode,
          errorClass: null,
          errorSource: null,
          shouldRetry,
          retryAfterMs,
          elapsedMs,
          ttfbMs: elapsedMs,
          requestId,
          moved: false,
        },
        "none",
      );
    } catch {
      /* telemetry never fails a request */
    }
  }

  /**
   * The transport failed. Timeout failures record outcome `timeout`,
   * everything else `transport_error` — or `stream_broken` once body bytes
   * had been surfaced — mirroring the Python reference, where any
   * httpx.TimeoutException yields "timeout" independent of the error class.
   * A DOM TimeoutError (a caller's AbortSignal.timeout firing) is a timeout
   * the client observed even though its exact class is unknowable. (The
   * contract DOC's §3.2 retry example shows po=transport_error for a connect
   * timeout; that contradicts the reference modules, and the contract's own
   * header says the modules win.) `responseOpened` keeps the status and
   * time-to-first-byte of an attempt whose headers had already arrived;
   * `bodyStarted` defaults to what the engine and codec reported through
   * onBodyStarted / onFirstEvent.
   */
  onTransportError(error, { responseOpened = false, bodyStarted = this._bodyStarted } = {}) {
    try {
      if (this._attemptStarted === null || this._currentHost === null) return;
      let errorClass = classifyTransportError(error);
      let phase = TIMEOUT_PHASES.get(errorClass) ?? "none";
      const isTimeout =
        TIMEOUT_ERROR_CLASSES.has(errorClass) || error?.name === "TimeoutError";
      let outcome;
      if (isTimeout) {
        outcome = "timeout";
        if (bodyStarted) {
          phase = "idle";
          if (errorClass === "read_timeout") errorClass = "stream_stalled";
        }
      } else if (bodyStarted) {
        outcome = "stream_broken";
      } else {
        outcome = "transport_error";
      }
      const index = this._index();
      const previous = this._previous(index);
      this._storeAttempt(
        {
          index,
          host: this._currentHost,
          outcome,
          httpStatus: responseOpened && previous ? previous.httpStatus : null,
          errorClass,
          errorSource: previous ? previous.errorSource ?? null : null,
          shouldRetry: previous ? previous.shouldRetry ?? "absent" : "absent",
          retryAfterMs: previous ? previous.retryAfterMs ?? null : null,
          elapsedMs: durationMs(this._attemptStarted, this._now()),
          ttfbMs: responseOpened && previous ? previous.ttfbMs ?? null : null,
          requestId: previous ? previous.requestId ?? null : null,
          moved: false,
        },
        phase,
      );
    } catch {
      /* telemetry never fails a request */
    }
  }

  /**
   * The SDK's own `timeout` option fired: a total deadline the client
   * configured and observed. The contract's `total` timeout phase exists for
   * exactly this (the Python reference has no total deadline, so its phases
   * stop at `idle`); phase `total` is excluded from the availability
   * denominator (§8), so this never blames a host. The class is unknowable
   * — the deadline covered every phase at once — hence `unknown`, the same
   * class the header channel gives a caller's TimeoutError.
   */
  onDeadline() {
    try {
      if (this._attemptStarted === null || this._currentHost === null) return;
      const index = this._index();
      const previous = this._previous(index);
      this._storeAttempt(
        {
          index,
          host: this._currentHost,
          outcome: "timeout",
          httpStatus: previous ? previous.httpStatus ?? null : null,
          errorClass: "unknown",
          errorSource: previous ? previous.errorSource ?? null : null,
          shouldRetry: previous ? previous.shouldRetry ?? "absent" : "absent",
          retryAfterMs: previous ? previous.retryAfterMs ?? null : null,
          elapsedMs: durationMs(this._attemptStarted, this._now()),
          ttfbMs: previous ? previous.ttfbMs ?? null : null,
          requestId: previous ? previous.requestId ?? null : null,
          moved: false,
        },
        "total",
      );
    } catch {
      /* telemetry never fails a request */
    }
  }

  onMoved() {
    try {
      if (this.attempts.length === 0) return;
      this.attempts[this.attempts.length - 1].moved = true;
      if (this._currentAttempt !== null) this._currentAttempt.moved = true;
      this.failoverUsed = true;
    } catch {
      /* telemetry never fails a request */
    }
  }

  /** Body bytes reached the consumer (reported by the engine's body watcher). */
  onBodyStarted() {
    this._bodyStarted = true;
  }

  /**
   * The first decoded SSE event reached the consumer: TTFT, measured from
   * the FIRST attempt's start like the Python reference. Reported by
   * ./sse.js — the only place a first event is observable (§6.1).
   */
  onFirstEvent() {
    try {
      this._bodyStarted = true;
      if (this.ttftMs === null && this._firstStarted !== null) {
        this.ttftMs = durationMs(this._firstStarted, this._now());
      }
    } catch {
      /* telemetry never fails a request */
    }
  }

  /**
   * The caller cancelled (signal abort, or the stream consumer stopped
   * reading): the current attempt becomes `aborted`, keeping every fact the
   * attempt had already established. Never a fact about the host.
   */
  onAborted() {
    try {
      if (this._attemptStarted === null || this._currentHost === null) return;
      const index = this._index();
      const previous = this._previous(index);
      this._storeAttempt(
        {
          index,
          host: this._currentHost,
          outcome: "aborted",
          httpStatus: previous ? previous.httpStatus ?? null : null,
          errorClass: previous ? previous.errorClass ?? null : null,
          errorSource: previous ? previous.errorSource ?? null : null,
          shouldRetry: previous ? previous.shouldRetry ?? "absent" : "absent",
          retryAfterMs: previous ? previous.retryAfterMs ?? null : null,
          elapsedMs: durationMs(this._attemptStarted, this._now()),
          ttfbMs: previous ? previous.ttfbMs ?? null : null,
          requestId: previous ? previous.requestId ?? null : null,
          moved: previous ? Boolean(previous.moved) : false,
        },
        previous ? this._attemptPhases[index] ?? "none" : "none",
      );
    } catch {
      /* telemetry never fails a request */
    }
  }

  /**
   * The `x-tr-client` value for the attempt begun last, in the contract's
   * exact key order: v,a[,po,pc,ph,pm,sm],s[,fo]. Returns null — send
   * nothing — for custom hosts and for any value that leaves the grammar
   * (values are ^[a-z0-9_]{1,24}$, whole header <= 160 bytes).
   */
  headerValue() {
    try {
      if (
        this._currentHost === "custom" ||
        this._currentIndex === null ||
        this._currentIndex > MAX_ATTEMPT_INDEX
      ) {
        // Past a=99 the attempt index leaves the contract's 0..99 range:
        // send nothing rather than a header the enclave will drop anyway.
        return null;
      }
      const values = ["v=1", `a=${this._currentIndex}`];
      if (this._currentIndex) {
        const previous = this.attempts[this.attempts.length - 1];
        if (!previous) return null;
        const firstStarted =
          this._firstStarted ?? this._attemptStarted ?? this._now();
        const sinceFirstMs = durationMs(
          firstStarted,
          this._attemptStarted ?? this._now(),
        );
        const previousOutcome = HEADER_PREVIOUS_OUTCOMES.has(previous.outcome)
          ? previous.outcome
          : "none";
        const previousClass =
          previousOutcome === "none" ? "none" : previous.errorClass ?? "none";
        values.push(
          `po=${previousOutcome}`,
          `pc=${previousClass}`,
          `ph=${previous.host}`,
          `pm=${previous.elapsedMs}`,
          `sm=${sinceFirstMs}`,
        );
      }
      values.push(`s=${this.streaming ? 1 : 0}`);
      if (this._currentIndex) values.push(`fo=${this.failoverUsed ? 1 : 0}`);
      const header = values.join(";");
      if (header.length > 160) return null;
      for (const part of values) {
        if (!HEADER_VALUE_RE.test(part.slice(part.indexOf("=") + 1))) {
          return null;
        }
      }
      return header;
    } catch {
      return null;
    }
  }

  /** The SDK timeout (ms) that governed a phase, or null (py _configured_timeout_ms). */
  _configuredTimeoutMs(phase) {
    // The JS `timeout` option is a TOTAL deadline; the SDK configures no
    // connect / first-byte / idle timeout of its own (undici's defaults are
    // the transport's, not the SDK's), so only the `total` phase has a
    // configured value. Reporting null for the others keeps
    // timeout_floor_met false — conservative, never blaming a host.
    return phase === "total" ? this.configuredTimeoutMs : null;
  }

  _attemptRecord(attempt) {
    return {
      index: attempt.index,
      host: attempt.host,
      outcome: attempt.outcome,
      http_status: attempt.httpStatus ?? null,
      error_class: attempt.errorClass ?? null,
      error_source: attempt.errorSource ?? null,
      should_retry: attempt.shouldRetry ?? "absent",
      retry_after_ms: attempt.retryAfterMs ?? null,
      elapsed_ms: attempt.elapsedMs,
      ttfb_ms: attempt.ttfbMs ?? null,
      request_id: attempt.requestId ?? null,
      moved: Boolean(attempt.moved),
    };
  }

  /**
   * Derive the §5.3 event and the exact §5.4 counter increments — one
   * request-level row plus one attempt-level row per attempt — exactly like
   * the Python reference's `_finish`: `exhausted` qualifies the final
   * outcome only when retries were spent and the last one still failed, and
   * the COUNTER outcome is always the final attempt's own outcome (the
   * schema module's Outcome, never `exhausted`).
   */
  _finish(exhausted) {
    if (!this._recordable || this.attempts.length === 0 || this._firstStarted === null) {
      return;
    }
    this._commitCurrentAttempt();
    const attempts = this.attempts;
    const final = this._currentAttempt ?? attempts[attempts.length - 1];
    const finalOutcome =
      exhausted && this._attemptCount > 1 && final.outcome !== "ok"
        ? "exhausted"
        : final.outcome;
    const timeoutPhase = this._currentPhase ?? "none";
    const configuredTimeoutMs = this._configuredTimeoutMs(timeoutPhase);
    const totalMs = durationMs(this._firstStarted, this._now());
    const event = {
      age_ms: 0,
      plane: "inference",
      endpoint: this.endpoint,
      method: this.method,
      streaming: this.streaming,
      provider_pinned: this.providerPinned,
      model: this.model,
      attempts: attempts.map((attempt) => this._attemptRecord(attempt)),
      final_outcome: finalOutcome,
      final_http_status: final.httpStatus ?? null,
      total_ms: totalMs,
      ttft_ms: this.ttftMs,
      failover_used: this.failoverUsed,
      timeout_phase: timeoutPhase,
      configured_timeout_ms: configuredTimeoutMs,
    };
    const counterOutcome = finalOutcome === "exhausted" ? final.outcome : finalOutcome;
    const firstErrorClass = this._firstErrorClass;
    const requestKey = [
      "request",
      this.endpoint,
      this.streaming,
      final.host,
      counterOutcome,
      firstErrorClass,
      statusClass(final.httpStatus),
      timeoutPhase,
      timeoutFloorMet(timeoutPhase, configuredTimeoutMs),
      this.providerPinned,
    ];
    const requestIncrement = {
      requests: 1,
      attempts: this._attemptCount,
      failover_used: this.failoverUsed ? 1 : 0,
      first_attempt_success: attempts[0].outcome === "ok" ? 1 : 0,
      total_ms_hist: { [latencyBucket(totalMs)]: 1 },
    };
    const firstEventMs = this.ttftMs !== null ? this.ttftMs : final.ttfbMs ?? null;
    if (firstEventMs !== null) {
      requestIncrement.first_event_ms_hist = { [latencyBucket(firstEventMs)]: 1 };
    }
    const counters = [[requestKey, requestIncrement], ...this._attemptCounterRows.values()];
    this.sink.onRequest(event, counters);
  }

  /** Emit the finished record once; idempotent, and never throws. */
  finish({ exhausted = false } = {}) {
    if (this._finished) return;
    this._finished = true;
    try {
      this._finish(Boolean(exhausted));
    } catch {
      /* telemetry never fails a request */
    }
  }
}
