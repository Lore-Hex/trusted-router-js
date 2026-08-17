/**
 * L5 — CLIENT RELIABILITY TELEMETRY (header channel, contract v1 of
 * docs/client-telemetry.md in Lore-Hex/quill-router).
 *
 * Everything on the wire is a closed enum or a clamped integer; there is no
 * free text anywhere. The only emitter is THE engine loop in ./transport.js
 * (`performRequest`), which owns one RequestRecorder per logical inference
 * call and sets/clears `x-tr-client` per attempt. Control-plane calls and
 * custom base URLs never carry the header; opting out suppresses the header
 * while User-Agent stays.
 *
 * Telemetry may never fail a request: every public method here swallows its
 * own failures, and an out-of-grammar header value sends NOTHING rather than
 * a malformed header. The beacon channel is deliberately NOT implemented in
 * this SDK yet — the contract sequences beacons Python-first, so the enum
 * constants below are exported now purely to pin the vocabulary for that
 * later PR (test/parity-contract.test.js).
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

const MAX_DURATION_MS = 3_600_000;
const MAX_ATTEMPT_INDEX = 99;
const HEADER_VALUE_RE = /^[a-z0-9_]{1,24}$/;
const TIMEOUT_ERROR_CLASSES = new Set([
  "connect_timeout",
  "read_timeout",
  "write_timeout",
  "pool_timeout",
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

/**
 * Resolve the opt-out precedence without reading process state implicitly:
 * explicit constructor option > TRUSTEDROUTER_TELEMETRY > DO_NOT_TRACK >
 * default-on only when the inference base is a known TrustedRouter host AND
 * the control plane is https trustedrouter.com (or a subdomain). Mirrors
 * resolve_telemetry_enabled in trusted-router-py so the SDKs cannot drift.
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

function errorChain(error) {
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

// Highest-priority class wins across the whole `cause` chain, in the same
// order as the Python classifier: timeouts, then TLS/DNS/socket phases, then
// protocol, IO, and proxy, then unknown. Node's fetch wraps the real failure
// as the `cause` of `TypeError: fetch failed` (verified against Node 20
// undici for ENOTFOUND, ECONNREFUSED, ECONNRESET,
// DEPTH_ZERO_SELF_SIGNED_CERT, ERR_SSL_WRONG_VERSION_NUMBER, HPE_*, and
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
    (code, name) =>
      code === "ECONNRESET" || code === "UND_ERR_SOCKET" || name === "SocketError",
  ],
  [
    "connect_error",
    (code) =>
      ["EHOSTUNREACH", "ENETUNREACH", "EADDRNOTAVAIL", "ECONNABORTED", "EHOSTDOWN"].includes(
        code,
      ),
  ],
  [
    "protocol_error",
    (code, name) =>
      code.startsWith("HPE_") ||
      name === "HTTPParserError" ||
      code.startsWith("ERR_HTTP2_") ||
      code === "EPROTO" ||
      code === "UND_ERR_REQ_CONTENT_LENGTH_MISMATCH" ||
      code === "UND_ERR_RES_CONTENT_LENGTH_MISMATCH",
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

/**
 * Record the per-attempt facts of one logical inference call as the engine
 * loop drives it, and assemble the per-attempt `x-tr-client` value. Mirrors
 * RequestRecorder in trusted-router-py: beginAttempt / onResponse /
 * onTransportError / onMoved / headerValue. The injectable clock (ms,
 * monotonic) exists for deterministic tests, like the Python reporter's.
 */
export class RequestRecorder {
  constructor({ streaming = false, now = null } = {}) {
    this.streaming = Boolean(streaming);
    this._now = typeof now === "function" ? now : () => performance.now();
    this.attempts = [];
    this.failoverUsed = false;
    this._firstStarted = null;
    this._attemptStarted = null;
    this._currentHost = null;
    this._currentIndex = null;
  }

  beginAttempt(baseUrl) {
    try {
      const started = this._now();
      if (this._firstStarted === null) this._firstStarted = started;
      this._attemptStarted = started;
      this._currentHost = hostEnum(baseUrl);
      this._currentIndex = this.attempts.length;
    } catch {
      /* telemetry never fails a request */
    }
  }

  _storeAttempt(attempt) {
    if (attempt.index < this.attempts.length) {
      this.attempts[attempt.index] = attempt;
    } else {
      this.attempts.push(attempt);
    }
  }

  onResponse(statusCode) {
    try {
      if (this._attemptStarted === null || this._currentHost === null) return;
      this._storeAttempt({
        index: this._currentIndex ?? this.attempts.length,
        host: this._currentHost,
        outcome: statusCode < 400 ? "ok" : "http_error",
        httpStatus: statusCode,
        errorClass: null,
        elapsedMs: durationMs(this._attemptStarted, this._now()),
        moved: false,
      });
    } catch {
      /* telemetry never fails a request */
    }
  }

  onTransportError(error) {
    try {
      if (this._attemptStarted === null || this._currentHost === null) return;
      // Timeout failures record outcome `timeout`, everything else
      // `transport_error` — mirroring the Python reference, where any
      // httpx.TimeoutException yields "timeout" independent of the error
      // class. A DOM TimeoutError (a caller's AbortSignal.timeout firing)
      // is a timeout the client observed even though its exact class is
      // unknowable. (The contract DOC's §3.2 retry example shows
      // po=transport_error for a connect timeout; that contradicts the
      // reference modules, and the contract's own header says the modules
      // win.) Body-started failures never re-enter this engine's loop
      // (invariant 6), so stream_broken stays unreachable until the beacon
      // channel lands.
      const errorClass = classifyTransportError(error);
      const isTimeout =
        TIMEOUT_ERROR_CLASSES.has(errorClass) || error?.name === "TimeoutError";
      this._storeAttempt({
        index: this._currentIndex ?? this.attempts.length,
        host: this._currentHost,
        outcome: isTimeout ? "timeout" : "transport_error",
        httpStatus: null,
        errorClass,
        elapsedMs: durationMs(this._attemptStarted, this._now()),
        moved: false,
      });
    } catch {
      /* telemetry never fails a request */
    }
  }

  onMoved() {
    try {
      if (this.attempts.length === 0) return;
      this.attempts[this.attempts.length - 1].moved = true;
      this.failoverUsed = true;
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
}
