/**
 * L5 — CLIENT RELIABILITY TELEMETRY: the beacon channel (§4, §5, §6.2 of
 * docs/client-telemetry.md in Lore-Hex/quill-router, contract v1).
 *
 * `TelemetryReporter` is the sink the engine's RequestRecorder (./telemetry.js)
 * hands each finished record to. It keeps a bounded buffer of sampled events
 * and EXACT per-minute counters, and delivers them as content-free batches to
 * `POST {controlBaseUrl}/client-events` — the control plane, a different
 * deployment from the inference plane, so an inference outage is reported in
 * near real time and the backlog drains on recovery.
 *
 * It is deliberately OUTSIDE the transport engine, following the
 * `fetchTrustRelease` precedent in ./trust.js: its own single-shot fetch call
 * (the global fetch captured at construction — never `performRequest`, never
 * the caller's injected fetchImpl), no retries, no failover, one POST per
 * flush. Its only worker is an unref'd timer chain started lazily on the
 * first record — never at import or construction — plus one process
 * `beforeExit` hook for a single bounded final flush. The beacon POST itself
 * is never recorded or traced. Mirrors TelemetryReporter in
 * trusted-router-py (`_telemetry.py`), the contract's reference.
 */

import { DEFAULT_CONTROL_BASE_URL, VERSION } from "./models.js";
import {
  DEFAULT_TELEMETRY_PATH,
  MAX_DURATION_MS,
  MODEL_RE,
  REQUEST_ID_RE,
  TELEMETRY_ENDPOINTS,
  TELEMETRY_ERROR_CLASSES,
  TELEMETRY_ERROR_SOURCES,
  TELEMETRY_FINAL_OUTCOMES,
  TELEMETRY_HOSTS,
  TELEMETRY_HTTP_STATUS_CLASSES,
  TELEMETRY_LATENCY_BUCKETS,
  TELEMETRY_METHODS,
  TELEMETRY_OUTCOMES,
  TELEMETRY_SAMPLE_REASONS,
  TELEMETRY_SCHEMA_VERSION,
  TELEMETRY_TIMEOUT_PHASES,
} from "./telemetry.js";
import { DEFAULT_USER_AGENT } from "./transport.js";

// §6.2 bounds. Pinned by test/telemetry-beacon.test.js.
export const TELEMETRY_FLUSH_MS = 30_000;
export const TELEMETRY_MAX_EVENTS = 1000;
export const TELEMETRY_MAX_BATCH_EVENTS = 100;
export const TELEMETRY_MAX_BATCH_COUNTERS = 200;
export const TELEMETRY_MAX_WINDOW_KEYS = 256;
export const TELEMETRY_RETENTION_MS = 86_400_000;
export const TELEMETRY_RETENTION_BYTES = 524_288;
export const TELEMETRY_BACKOFF_MIN_MS = 60_000;
export const TELEMETRY_BACKOFF_MAX_MS = 600_000;
export const TELEMETRY_MAX_BATCH_BYTES = 65_536;
export const TELEMETRY_BATCH_TRIGGER_BYTES = 60 * 1024;
export const TELEMETRY_FLUSH_EVENT_TRIGGER = 50;
export const TELEMETRY_EXIT_FLUSH_MS = 2_000;
export const TELEMETRY_FLUSH_TIMEOUT_MS = 5_000;
const WINDOW_MS = 60_000;
const MAX_RETRY_AFTER_SECONDS = 600;
const MAX_PAUSE_SECONDS = 86_400;
const MAX_AGE_MS = 86_400_000;
const MAX_COUNT = 10_000_000;
const MAX_ATTEMPTS_PER_EVENT = 16;

const SEMVER_RE =
  /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const RUNTIME_RE = /^[a-z]{1,10}\/[0-9A-Za-z.+-]{1,24}$/;
const SDK_NAMES = new Set(["tr-py", "tr-js", "tr-go", "tr-rust", "tr-java", "tr-swift"]);
const SDK_LANGS = new Set(["python", "js", "go", "rust", "java", "swift"]);
const SDK_OSES = new Set(["linux", "macos", "windows", "ios", "android", "freebsd", "other"]);
const SDK_ARCHES = new Set(["x64", "x32", "arm", "arm64", "wasm", "other"]);

const hasProcess = () => typeof process !== "undefined" && process !== null;

// ---- SDK identity (§5.1 `sdk`) --------------------------------------------

/** The process OS in the contract's closed vocabulary (py _os_enum). */
export function osEnum(platform = hasProcess() ? process.platform : "") {
  const value = String(platform ?? "").trim().toLowerCase();
  return (
    {
      darwin: "macos",
      linux: "linux",
      win32: "windows",
      windows: "windows",
      freebsd: "freebsd",
      android: "android",
    }[value] ?? "other"
  );
}

/** The process architecture in the contract's closed vocabulary (py _arch_enum). */
export function archEnum(arch = hasProcess() ? process.arch : "") {
  const value = String(arch ?? "").trim().toLowerCase();
  if (value === "x64" || value === "x86_64" || value === "amd64") return "x64";
  if (["ia32", "x32", "i386", "i486", "i586", "i686", "x86"].includes(value)) return "x32";
  if (value === "arm64" || value === "aarch64") return "arm64";
  if (value.startsWith("arm")) return "arm";
  if (value.startsWith("wasm")) return "wasm";
  return "other";
}

function runtimeToken() {
  const versions = hasProcess() ? process.versions ?? {} : {};
  let token;
  if (typeof versions.bun === "string") token = `bun/${versions.bun}`;
  else if (typeof globalThis.Deno?.version?.deno === "string") {
    token = `deno/${globalThis.Deno.version.deno}`;
  } else if (typeof versions.node === "string") token = `node/${versions.node}`;
  else token = "other/0.0.0";
  return RUNTIME_RE.test(token) ? token : "node/0.0.0";
}

/** Build the bounded SDK identity included in every telemetry batch. */
export function sdkIdentity() {
  const version =
    typeof VERSION === "string" && VERSION.length <= 32 && SEMVER_RE.test(VERSION)
      ? VERSION
      : "0.0.0";
  return {
    name: "tr-js",
    version,
    lang: "js",
    runtime: runtimeToken(),
    os: osEnum(),
    arch: archEnum(),
  };
}

/** Every field back inside the closed vocabulary, falling back per field (py _normalise_sdk_identity). */
export function normaliseSdkIdentity(identity) {
  const fallback = sdkIdentity();
  const source = identity && typeof identity === "object" ? identity : {};
  const name = SDK_NAMES.has(source.name) ? source.name : fallback.name;
  const version =
    typeof source.version === "string" &&
    source.version.length <= 32 &&
    SEMVER_RE.test(source.version)
      ? source.version
      : fallback.version;
  const lang = SDK_LANGS.has(source.lang) ? source.lang : fallback.lang;
  const runtime =
    typeof source.runtime === "string" && RUNTIME_RE.test(source.runtime)
      ? source.runtime
      : fallback.runtime;
  const os = SDK_OSES.has(source.os) ? source.os : fallback.os;
  const arch = SDK_ARCHES.has(source.arch) ? source.arch : fallback.arch;
  return { name, version, lang, runtime, os, arch };
}

// ---- wire shaping (§5.3 / §5.4): clamps, regexes, closed enums -------------

function boundedInt(value, minimum, maximum) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return minimum;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function boundedOptionalInt(value, minimum, maximum) {
  if (value === null || value === undefined) return null;
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return null;
  if (parsed < minimum || parsed > maximum) return null;
  return parsed;
}

function floatValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function utf8Length(text) {
  return new TextEncoder().encode(text).length;
}

function randomHex(bytes) {
  const buffer = new Uint8Array(bytes);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(buffer);
  } else {
    for (let index = 0; index < buffer.length; index += 1) {
      buffer[index] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A uniform draw in [0, 1) with 53 bits of entropy (py secrets.randbits(53) / 2**53). */
function secureRandom() {
  if (globalThis.crypto?.getRandomValues) {
    const words = new Uint32Array(2);
    globalThis.crypto.getRandomValues(words);
    return (words[0] * 2 ** 21 + (words[1] >>> 11)) / 2 ** 53;
  }
  return Math.random();
}

export function wireAttempt(attempt) {
  const source = attempt && typeof attempt === "object" ? attempt : {};
  const host = TELEMETRY_HOSTS.includes(source.host) ? source.host : "custom";
  const outcome = TELEMETRY_OUTCOMES.includes(source.outcome)
    ? source.outcome
    : "transport_error";
  const errorClass = TELEMETRY_ERROR_CLASSES.includes(source.error_class)
    ? source.error_class
    : null;
  const errorSource = TELEMETRY_ERROR_SOURCES.includes(source.error_source)
    ? source.error_source
    : null;
  const requestId =
    typeof source.request_id === "string" && REQUEST_ID_RE.test(source.request_id)
      ? source.request_id
      : null;
  const wire = {
    index: boundedInt(source.index, 0, 99),
    host,
    outcome,
    http_status: boundedOptionalInt(source.http_status, 100, 599),
    error_class: errorClass,
    error_source: errorSource,
    retry_after_ms: boundedOptionalInt(source.retry_after_ms, 0, MAX_DURATION_MS),
    elapsed_ms: boundedInt(source.elapsed_ms, 0, MAX_DURATION_MS),
    ttfb_ms: boundedOptionalInt(source.ttfb_ms, 0, MAX_DURATION_MS),
    request_id: requestId,
    moved: Boolean(source.moved),
  };
  // should_retry is true | false | ABSENT — never null on the wire.
  if (source.should_retry === true || source.should_retry === "true") {
    wire.should_retry = true;
  } else if (source.should_retry === false || source.should_retry === "false") {
    wire.should_retry = false;
  }
  return wire;
}

/**
 * The §5.3 ClientRequestEvent for a recorded event, or null when the record
 * cannot be made valid (no attempts, an unknown sample reason, a bad rate).
 * Only known keys survive: nothing a caller or a future field could smuggle
 * in reaches the wire.
 */
export function wireEvent(event, now) {
  const source = event && typeof event === "object" ? event : {};
  if (!Array.isArray(source.attempts)) return null;
  const attempts = source.attempts
    .slice(0, MAX_ATTEMPTS_PER_EVENT)
    .filter((item) => item && typeof item === "object")
    .map(wireAttempt);
  if (attempts.length === 0) return null;
  const completedAt = Number(source._completed_at);
  const ageMs = Number.isFinite(completedAt) ? Math.trunc(now - completedAt) : 0;
  const endpoint = TELEMETRY_ENDPOINTS.includes(source.endpoint)
    ? source.endpoint
    : "inference_other";
  if (!TELEMETRY_METHODS.includes(source.method)) return null;
  const model =
    typeof source.model === "string" && MODEL_RE.test(source.model) ? source.model : null;
  const finalOutcome = TELEMETRY_FINAL_OUTCOMES.includes(source.final_outcome)
    ? source.final_outcome
    : attempts[attempts.length - 1].outcome;
  const timeoutPhase = TELEMETRY_TIMEOUT_PHASES.includes(source.timeout_phase)
    ? source.timeout_phase
    : "none";
  if (!TELEMETRY_SAMPLE_REASONS.includes(source.sample_reason)) return null;
  const sampleRate = floatValue(source.sample_rate);
  if (sampleRate === null || sampleRate <= 0 || sampleRate > 1) return null;
  return {
    age_ms: Math.min(MAX_AGE_MS, Math.max(0, Number.isFinite(ageMs) ? ageMs : 0)),
    plane: "inference",
    endpoint,
    method: source.method,
    streaming: Boolean(source.streaming),
    provider_pinned: Boolean(source.provider_pinned),
    model,
    attempts,
    final_outcome: finalOutcome,
    final_http_status: boundedOptionalInt(source.final_http_status, 100, 599),
    total_ms: boundedInt(source.total_ms, 0, MAX_DURATION_MS),
    ttft_ms: boundedOptionalInt(source.ttft_ms, 0, MAX_DURATION_MS),
    failover_used: Boolean(source.failover_used),
    timeout_phase: timeoutPhase,
    configured_timeout_ms: boundedOptionalInt(source.configured_timeout_ms, 1, MAX_DURATION_MS),
    sample_rate: sampleRate,
    sample_reason: source.sample_reason,
  };
}

/** Coerce a 10-field counter key back into the closed vocabulary, or null (py _normalise_counter_key). */
export function normaliseCounterKey(key) {
  if (!Array.isArray(key) || key.length !== 10) return null;
  let [
    level,
    endpoint,
    streaming,
    host,
    outcome,
    errorClass,
    httpStatusClass,
    timeoutPhase,
    floorMet,
    providerPinned,
  ] = key;
  if (level !== "attempt" && level !== "request") return null;
  if (!TELEMETRY_ENDPOINTS.includes(endpoint)) endpoint = "inference_other";
  if (!TELEMETRY_HOSTS.includes(host)) host = "custom";
  if (!TELEMETRY_FINAL_OUTCOMES.includes(outcome)) return null;
  if (errorClass !== null && errorClass !== undefined && !TELEMETRY_ERROR_CLASSES.includes(errorClass)) {
    errorClass = "unknown";
  }
  if (errorClass === undefined) errorClass = null;
  if (!TELEMETRY_HTTP_STATUS_CLASSES.includes(httpStatusClass)) httpStatusClass = "none";
  if (!TELEMETRY_TIMEOUT_PHASES.includes(timeoutPhase)) timeoutPhase = "none";
  return [
    level,
    endpoint,
    Boolean(streaming),
    host,
    outcome,
    errorClass,
    httpStatusClass,
    timeoutPhase,
    Boolean(floorMet),
    Boolean(providerPinned),
  ];
}

function mergeHistogram(target, source) {
  if (!source || typeof source !== "object") return;
  for (const [bucket, count] of Object.entries(source)) {
    if (!TELEMETRY_LATENCY_BUCKETS.includes(bucket)) continue;
    target[bucket] = (target[bucket] ?? 0) + boundedInt(count, 0, MAX_COUNT);
  }
}

export function mergeCounterIncrement(target, increment) {
  const source = increment && typeof increment === "object" ? increment : {};
  for (const field of ["requests", "attempts", "failover_used", "first_attempt_success"]) {
    target[field] = (target[field] ?? 0) + boundedInt(source[field] ?? 0, 0, MAX_COUNT);
  }
  for (const field of ["total_ms_hist", "first_event_ms_hist"]) {
    if (!target[field]) target[field] = {};
    mergeHistogram(target[field], source[field] ?? {});
  }
}

/** The §5.4 ClientMinuteCounter row for one key and its merged counts. */
export function counterRow(key, counts, windowAgeMs) {
  const source = counts && typeof counts === "object" ? counts : {};
  return {
    window_start_age_ms: Math.min(MAX_AGE_MS, Math.max(0, boundedInt(windowAgeMs, 0, MAX_AGE_MS))),
    level: key[0],
    endpoint: key[1],
    streaming: key[2],
    host: key[3],
    outcome: key[4],
    error_class: key[5],
    http_status_class: key[6],
    timeout_phase: key[7],
    timeout_floor_met: key[8],
    provider_pinned: key[9],
    requests: boundedInt(source.requests, 1, MAX_COUNT),
    attempts: boundedInt(source.attempts, 0, MAX_COUNT),
    failover_used: boundedInt(source.failover_used, 0, MAX_COUNT),
    first_attempt_success: boundedInt(source.first_attempt_success, 0, MAX_COUNT),
    total_ms_hist: { ...(source.total_ms_hist ?? {}) },
    first_event_ms_hist: { ...(source.first_event_ms_hist ?? {}) },
  };
}

const keyId = (key) => JSON.stringify(key);

/** py _folded_counter_key: error_class → unknown, optionally endpoint → inference_other. */
function foldedKey(key, endpoint) {
  const values = [...key];
  values[5] = "unknown";
  if (endpoint) values[1] = "inference_other";
  return values;
}

function sampleRate(value) {
  const parsed = floatValue(value);
  if (parsed === null) return 0.01;
  return Math.min(1, Math.max(0, parsed));
}

function flushInterval(value) {
  const parsed = floatValue(value);
  if (parsed === null || parsed <= 0) return TELEMETRY_FLUSH_MS;
  return Math.min(TELEMETRY_BACKOFF_MAX_MS, parsed);
}

function writeStderr(line) {
  try {
    if (hasProcess() && process.stderr && typeof process.stderr.write === "function") {
      process.stderr.write(line);
      return;
    }
  } catch {
    /* fall through */
  }
  try {
    console.error(line.replace(/\n$/, ""));
  } catch {
    /* a trust feature, never a failure */
  }
}

/** Resolve `promise` or give up after `ms`: an awaited close must keep this deadline alive. */
function withDeadline(promise, ms) {
  return new Promise((resolve) => {
    let timer = null;
    const settle = (value) => {
      if (timer !== null) clearTimeout(timer);
      resolve(value);
    };
    timer = setTimeout(() => settle(false), Math.max(0, ms));
    Promise.resolve(promise).then(settle, () => settle(false));
  });
}

// ---- process exit hook: ONE listener, installed lazily, removed when idle ----

const LIVE_REPORTERS = new Set();
let exitHookInstalled = false;

function onBeforeExit() {
  for (const reporter of [...LIVE_REPORTERS]) reporter._flushAtExit();
}

function registerLive(reporter) {
  LIVE_REPORTERS.add(reporter);
  if (exitHookInstalled || !hasProcess() || typeof process.on !== "function") return;
  exitHookInstalled = true;
  process.on("beforeExit", onBeforeExit);
}

function unregisterLive(reporter) {
  LIVE_REPORTERS.delete(reporter);
  if (LIVE_REPORTERS.size === 0 && exitHookInstalled) {
    exitHookInstalled = false;
    process.off("beforeExit", onBeforeExit);
  }
}

/** Bounded, out-of-engine delivery sink for client reliability telemetry. */
export class TelemetryReporter {
  constructor({
    controlBaseUrl = DEFAULT_CONTROL_BASE_URL,
    apiKeyProvider = null,
    workspaceId = null,
    sdkIdentity: identity = null,
    successSampleRate = 0.01,
    flushMs = TELEMETRY_FLUSH_MS,
    fetchImpl = null,
    clock = null,
    random = null,
    debug = false,
    retentionBytes = TELEMETRY_RETENTION_BYTES,
    userAgent = DEFAULT_USER_AGENT,
    environ = hasProcess() && process.env ? process.env : {},
  } = {}) {
    this.controlBaseUrl = String(controlBaseUrl ?? DEFAULT_CONTROL_BASE_URL).replace(/\/+$/, "");
    this._apiKeyProvider = typeof apiKeyProvider === "function" ? apiKeyProvider : () => null;
    this.workspaceId = typeof workspaceId === "string" && workspaceId ? workspaceId : null;
    this._sdkIdentity = normaliseSdkIdentity(identity ?? {});
    this.successSampleRate = sampleRate(successSampleRate);
    this.flushMs = flushInterval(flushMs);
    // The reporter's OWN client (§6.2): the global fetch, captured here, never
    // the engine and never the caller's injected fetchImpl. Tests inject a
    // fake for the beacon endpoint.
    this._fetch = typeof fetchImpl === "function" ? fetchImpl : globalThis.fetch ?? null;
    this._clock = typeof clock === "function" ? clock : () => performance.now();
    this._random = typeof random === "function" ? random : secureRandom;
    this.debug = Boolean(debug) || String(environ?.TRUSTEDROUTER_TELEMETRY_DEBUG ?? "") === "1";
    this._userAgent = userAgent;
    this._retentionBytes = boundedInt(retentionBytes, 0, Number.MAX_SAFE_INTEGER);
    this._events = [];
    this._eventsSizeBytes = 0;
    this._currentWindowStart = null;
    this._currentCounters = new Map();
    this._closedWindows = [];
    this._retainedWindowBytes = 0;
    this._droppedSinceLast = 0;
    this._instanceId = randomHex(8);
    this._seq = 0;
    this._backoffMs = TELEMETRY_BACKOFF_MIN_MS;
    this._backoffUntil = 0;
    this._pausedUntil = 0;
    this._nextFlushAt = 0;
    this._urgentFlush = false;
    this._disabled = false;
    this._closed = false;
    this._workerStarted = false;
    this._timer = null;
    this._inflight = null;
    this._exitAttempted = false;
  }

  // ---- recording ---------------------------------------------------------

  _sampleReason(event) {
    if (event.final_outcome !== "ok") return ["failure", 1];
    const attempts = event.attempts;
    if ((Array.isArray(attempts) && attempts.length > 1) || Boolean(event.failover_used)) {
      return ["retried", 1];
    }
    if (boundedInt(event.total_ms, 0, MAX_DURATION_MS) > 30_000) return ["slow", 1];
    const rate = this.successSampleRate;
    const draw = Number(this._random());
    if (rate <= 0 || !(draw < rate)) return null;
    return ["random", rate];
  }

  /** Drop the oldest buffered success, else the oldest event; count it. */
  _dropBufferedEvent() {
    let index = this._events.findIndex((buffered) => buffered.final_outcome === "ok");
    if (index === -1) index = 0;
    const [dropped] = this._events.splice(index, 1);
    this._eventsSizeBytes -= boundedInt(dropped?._estimated_bytes ?? 0, 0, Number.MAX_SAFE_INTEGER);
    this._droppedSinceLast += 1;
  }

  _appendEvent(event) {
    if (this._events.length >= TELEMETRY_MAX_EVENTS) this._dropBufferedEvent();
    let estimated;
    try {
      estimated = utf8Length(JSON.stringify(event));
    } catch {
      estimated = 600;
    }
    event._estimated_bytes = estimated;
    this._events.push(event);
    this._eventsSizeBytes += estimated;
  }

  _minuteStart(now) {
    return Math.floor(Math.max(0, now) / WINDOW_MS) * WINDOW_MS;
  }

  _rollWindow(now) {
    const minuteStart = this._minuteStart(now);
    if (this._currentWindowStart === null) {
      this._currentWindowStart = minuteStart;
      return;
    }
    if (minuteStart > this._currentWindowStart) {
      this._closeCurrentWindow(now);
      this._currentWindowStart = minuteStart;
    }
  }

  _findCompatible(key, indices) {
    for (const [id, entry] of this._currentCounters) {
      if (indices.every((index) => entry.key[index] === key[index])) return id;
    }
    return null;
  }

  _refold(id, endpoint) {
    const entry = this._currentCounters.get(id);
    this._currentCounters.delete(id);
    const target = foldedKey(entry.key, endpoint);
    const merged = {};
    mergeCounterIncrement(merged, entry.counts);
    this._currentCounters.set(keyId(target), { key: target, counts: merged });
    return target;
  }

  /**
   * py _counter_target_locked, exactly: a new key past the 256-key cap folds
   * error_class → unknown (joining or re-keying a row that differs only in
   * error class), then endpoint → inference_other the same way, and as a
   * last resort lands on an arbitrary existing key — so the counts stay
   * exact, only coarser. Folding never counts as a drop.
   */
  _counterTarget(key) {
    if (
      this._currentCounters.has(keyId(key)) ||
      this._currentCounters.size < TELEMETRY_MAX_WINDOW_KEYS
    ) {
      return key;
    }
    const errorFolded = foldedKey(key, false);
    if (this._currentCounters.has(keyId(errorFolded))) return errorFolded;
    const errorCompatible = this._findCompatible(key, [0, 1, 2, 3, 4, 6, 7, 8, 9]);
    if (errorCompatible !== null) return this._refold(errorCompatible, false);
    const endpointFolded = foldedKey(key, true);
    if (this._currentCounters.has(keyId(endpointFolded))) return endpointFolded;
    const compatible = this._findCompatible(key, [0, 2, 3, 4, 6, 7, 8, 9]);
    if (compatible !== null) return this._refold(compatible, true);
    return this._currentCounters.values().next().value.key;
  }

  _mergeCounters(counters) {
    if (!Array.isArray(counters)) return;
    for (const item of counters) {
      const rawKey = Array.isArray(item) ? item[0] : undefined;
      const increment = Array.isArray(item) ? item[1] : undefined;
      if (!Array.isArray(rawKey) || !increment || typeof increment !== "object") {
        this._droppedSinceLast += 1;
        continue;
      }
      const key = normaliseCounterKey(rawKey);
      if (key === null) {
        this._droppedSinceLast += 1;
        continue;
      }
      const target = this._counterTarget(key);
      const id = keyId(target);
      let entry = this._currentCounters.get(id);
      if (!entry) {
        entry = { key: target, counts: {} };
        this._currentCounters.set(id, entry);
      }
      mergeCounterIncrement(entry.counts, increment);
    }
  }

  /** The sink method the engine's RequestRecorder calls; never throws. */
  onRequest(event, counters) {
    try {
      const now = Number(this._clock());
      const source = event && typeof event === "object" ? event : {};
      const reason = this._sampleReason(source);
      let sampled = null;
      let invalidSample = false;
      if (reason !== null) {
        const candidate = { ...source, sample_reason: reason[0], sample_rate: reason[1], _completed_at: now };
        sampled = wireEvent(candidate, now);
        if (sampled === null) invalidSample = true;
        else sampled._completed_at = now;
      }
      if (this._disabled || this._closed) return;
      this._rollWindow(now);
      this._mergeCounters(counters);
      if (invalidSample) this._droppedSinceLast += 1;
      if (sampled !== null) this._appendEvent(sampled);
      this._exitAttempted = false;
      this._startWorker(now);
      if (
        this._events.length >= TELEMETRY_FLUSH_EVENT_TRIGGER ||
        this._eventsSizeBytes +
          this._retainedWindowBytes +
          this._currentCounters.size * 400 >=
          TELEMETRY_BATCH_TRIGGER_BYTES
      ) {
        this._urgentFlush = true;
        this._wake();
      }
    } catch {
      /* telemetry never fails a request */
    }
  }

  // ---- windows -----------------------------------------------------------

  _windowSize(window) {
    const rows = [...window.rows.values()].map((entry) => counterRow(entry.key, entry.counts, 0));
    return utf8Length(JSON.stringify(rows));
  }

  _closeCurrentWindow(now) {
    if (this._currentCounters.size === 0 || this._currentWindowStart === null) return;
    const window = {
      windowStart: this._currentWindowStart,
      rows: this._currentCounters,
      sizeBytes: 0,
    };
    window.sizeBytes = this._windowSize(window);
    this._closedWindows.push(window);
    this._retainedWindowBytes += window.sizeBytes;
    this._currentCounters = new Map();
    this._currentWindowStart = this._minuteStart(now);
    this._pruneWindows(now);
  }

  _dropWindow(window) {
    this._retainedWindowBytes -= window.sizeBytes;
    this._droppedSinceLast += window.rows.size;
  }

  /** Retention: closed windows older than 24 h, then oldest-first past the byte cap. */
  _pruneWindows(now) {
    while (
      this._closedWindows.length > 0 &&
      now - this._closedWindows[0].windowStart > TELEMETRY_RETENTION_MS
    ) {
      this._dropWindow(this._closedWindows.shift());
    }
    while (this._closedWindows.length > 0 && this._retainedWindowBytes > this._retentionBytes) {
      this._dropWindow(this._closedWindows.shift());
    }
  }

  // ---- batches -----------------------------------------------------------

  _apiKey() {
    try {
      const value = this._apiKeyProvider();
      return typeof value === "string" && value ? value : null;
    } catch {
      return null;
    }
  }

  /**
   * py _select_batch_locked: close the live window so its counters are
   * deliverable, drop anything that can no longer be made valid (counted),
   * take ≤100 events and ≤200 counters oldest-first, mint the batch, and
   * trim it — events first, then counters — until it fits in 65 536 bytes.
   */
  _selectBatch(now) {
    this._rollWindow(now);
    this._closeCurrentWindow(now);
    this._pruneWindows(now);
    const eventRefs = [];
    const wireEvents = [];
    const invalid = [];
    for (const buffered of this._events) {
      const wire = wireEvent(buffered, now);
      if (wire === null) {
        invalid.push(buffered);
        continue;
      }
      eventRefs.push(buffered);
      wireEvents.push(wire);
      if (wireEvents.length >= TELEMETRY_MAX_BATCH_EVENTS) break;
    }
    if (invalid.length > 0) {
      const gone = new Set(invalid);
      this._events = this._events.filter((buffered) => !gone.has(buffered));
      this._eventsSizeBytes = this._events.reduce(
        (total, buffered) => total + boundedInt(buffered._estimated_bytes ?? 0, 0, Number.MAX_SAFE_INTEGER),
        0,
      );
      this._droppedSinceLast += invalid.length;
    }
    const counterRefs = [];
    const wireCounters = [];
    outer: for (const window of this._closedWindows) {
      const ageMs = Math.trunc(now - window.windowStart);
      for (const [id, entry] of window.rows) {
        counterRefs.push({ window, id });
        wireCounters.push(counterRow(entry.key, entry.counts, ageMs));
        if (wireCounters.length >= TELEMETRY_MAX_BATCH_COUNTERS) break outer;
      }
    }
    if (wireEvents.length === 0 && wireCounters.length === 0) return null;
    const dropped = this._droppedSinceLast;
    const batch = {
      schema_version: TELEMETRY_SCHEMA_VERSION,
      batch_id: randomHex(16),
      instance_id: this._instanceId,
      seq: this._seq,
      sent_at_ms: Date.now(),
      sdk: { ...this._sdkIdentity },
      synthetic: false,
      dropped_since_last: dropped,
      events: wireEvents,
      counters: wireCounters,
    };
    this._seq += 1;
    while (utf8Length(JSON.stringify(batch)) > TELEMETRY_MAX_BATCH_BYTES) {
      if (batch.events.length > 0) {
        batch.events.pop();
        eventRefs.pop();
      } else if (batch.counters.length > 0) {
        batch.counters.pop();
        counterRefs.pop();
      } else {
        return null;
      }
    }
    return { batch, eventRefs, counterRefs, dropped };
  }

  _removeSelected(eventRefs, counterRefs) {
    const gone = new Set(eventRefs);
    this._events = this._events.filter((buffered) => !gone.has(buffered));
    this._eventsSizeBytes = this._events.reduce(
      (total, buffered) => total + boundedInt(buffered._estimated_bytes ?? 0, 0, Number.MAX_SAFE_INTEGER),
      0,
    );
    const changed = new Set();
    for (const { window, id } of counterRefs) {
      if (window.rows.delete(id)) changed.add(window);
    }
    for (const window of changed) {
      this._retainedWindowBytes -= window.sizeBytes;
      window.sizeBytes = window.rows.size > 0 ? this._windowSize(window) : 0;
      this._retainedWindowBytes += window.sizeBytes;
    }
    this._closedWindows = this._closedWindows.filter((window) => window.rows.size > 0);
  }

  /** §4: apply a 202's `policy` ONLY when it reduces volume. */
  _applyPolicy(payload, now) {
    const policy = payload && typeof payload === "object" ? payload.policy : null;
    if (!policy || typeof policy !== "object") return;
    if (Object.hasOwn(policy, "success_sample_rate")) {
      const rate = floatValue(policy.success_sample_rate);
      if (rate !== null && rate >= 0 && rate < this.successSampleRate) {
        this.successSampleRate = rate;
      }
    }
    if (Object.hasOwn(policy, "flush_seconds")) {
      const seconds = floatValue(policy.flush_seconds);
      if (seconds !== null && seconds * 1000 > this.flushMs) {
        this.flushMs = Math.min(TELEMETRY_BACKOFF_MAX_MS, seconds * 1000);
      }
    }
    const pauseSeconds = floatValue(policy.pause_seconds);
    if (pauseSeconds !== null && pauseSeconds >= 0 && pauseSeconds <= MAX_PAUSE_SECONDS) {
      this._pausedUntil = Math.max(this._pausedUntil, now + pauseSeconds * 1000);
    }
  }

  _retryAfterSeconds(response) {
    let raw = null;
    try {
      raw = response?.headers?.get?.("retry-after") ?? null;
    } catch {
      return null;
    }
    if (raw === null || raw === undefined) return null;
    const seconds = Number(String(raw).trim());
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > MAX_RETRY_AFTER_SECONDS) {
      return null;
    }
    return seconds;
  }

  /** Exponential backoff 60 s → 10 min, floored by a Retry-After ≤ 600 s. */
  _setBackoff(now, retryAfterSeconds = null) {
    let delay = this._backoffMs;
    if (retryAfterSeconds !== null) delay = Math.max(delay, retryAfterSeconds * 1000);
    this._backoffUntil = now + Math.min(TELEMETRY_BACKOFF_MAX_MS, delay);
    this._backoffMs = Math.min(
      TELEMETRY_BACKOFF_MAX_MS,
      Math.max(TELEMETRY_BACKOFF_MIN_MS, this._backoffMs * 2),
    );
    this._wake();
  }

  /** Disable for the rest of the process and forget everything buffered. */
  _disable() {
    this._disabled = true;
    this._events = [];
    this._eventsSizeBytes = 0;
    this._currentCounters = new Map();
    this._closedWindows = [];
    this._retainedWindowBytes = 0;
    this._droppedSinceLast = 0;
    this._stopWorker();
  }

  async _handleResponse(response, { now, eventRefs, counterRefs, dropped }) {
    let killSwitch = null;
    try {
      killSwitch = response?.headers?.get?.("x-tr-telemetry") ?? null;
    } catch {
      killSwitch = null;
    }
    if (String(killSwitch ?? "").trim().toLowerCase() === "off") {
      this._disable();
      await this._discardBody(response);
      return;
    }
    const status = Number(response?.status);
    if (status === 202) {
      this._removeSelected(eventRefs, counterRefs);
      this._droppedSinceLast = Math.max(0, this._droppedSinceLast - dropped);
      this._backoffMs = TELEMETRY_BACKOFF_MIN_MS;
      this._backoffUntil = 0;
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      this._applyPolicy(payload, now);
      return;
    }
    await this._discardBody(response);
    if ([400, 401, 403, 404, 410].includes(status)) {
      this._disable();
      return;
    }
    if (status === 413) {
      // The SDK's own caps were violated — a bug, not a reason to resend.
      this._removeSelected(eventRefs, counterRefs);
      this._droppedSinceLast += eventRefs.length + counterRefs.length;
      return;
    }
    this._setBackoff(now, this._retryAfterSeconds(response));
  }

  async _discardBody(response) {
    try {
      await response?.body?.cancel?.();
    } catch {
      /* the socket is the transport's to reclaim */
    }
  }

  /**
   * ONE POST per flush, never retried: a transport failure or a retryable
   * status backs off; everything else is handled by _handleResponse.
   * Concurrent callers share the in-flight flush (py's flush lock).
   */
  _flushOnce({ timeoutMs = TELEMETRY_FLUSH_TIMEOUT_MS } = {}) {
    if (this._inflight !== null) return Promise.resolve(false);
    const run = async () => {
      const now = Number(this._clock());
      if (this._disabled || now < Math.max(this._pausedUntil, this._backoffUntil)) return false;
      const apiKey = this._apiKey();
      if (apiKey === null) return false;
      const selected = this._selectBatch(now);
      if (selected === null) return false;
      const { batch, eventRefs, counterRefs, dropped } = selected;
      const body = JSON.stringify(batch);
      if (this.debug) writeStderr(`trustedrouter telemetry batch: ${body}\n`);
      const headers = {
        authorization: `Bearer ${apiKey}`,
        "user-agent": this._userAgent,
        "content-type": "application/json",
      };
      if (this.workspaceId) headers["x-trustedrouter-workspace"] = this.workspaceId;
      let response;
      try {
        if (typeof this._fetch !== "function") throw new TypeError("fetch is unavailable");
        response = await this._fetch(`${this.controlBaseUrl}${DEFAULT_TELEMETRY_PATH}`, {
          method: "POST",
          headers,
          body,
          credentials: "omit",
          redirect: "manual",
          signal: AbortSignal.timeout(Math.max(1, boundedInt(timeoutMs, 1, MAX_DURATION_MS))),
        });
      } catch {
        this._setBackoff(Number(this._clock()));
        return false;
      }
      await this._handleResponse(response, {
        now: Number(this._clock()),
        eventRefs,
        counterRefs,
        dropped,
      });
      return Number(response?.status) === 202;
    };
    this._inflight = run()
      .catch(() => false)
      .finally(() => {
        this._inflight = null;
      });
    return this._inflight;
  }

  /** Synchronously start one flush attempt; resolves true on a 202. For deterministic tests. */
  flushNow() {
    return this._flushOnce();
  }

  // ---- worker: an unref'd timer chain, lazily started on the first record ----

  _startWorker(now) {
    if (this._workerStarted || this._disabled || this._closed) return;
    this._workerStarted = true;
    this._nextFlushAt = now + this.flushMs;
    registerLive(this);
    this._schedule();
  }

  _stopWorker() {
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this._workerStarted = false;
    unregisterLive(this);
  }

  _hasPending() {
    return (
      this._events.length > 0 ||
      this._currentCounters.size > 0 ||
      this._closedWindows.length > 0
    );
  }

  _schedule() {
    if (!this._workerStarted || this._disabled || this._closed) return;
    const now = Number(this._clock());
    const gate = Math.max(this._pausedUntil, this._backoffUntil);
    const deadline = this._urgentFlush ? Math.max(now, gate) : Math.max(this._nextFlushAt, gate);
    const delay = Math.min(TELEMETRY_BACKOFF_MAX_MS, Math.max(0, deadline - now));
    if (this._timer !== null) clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      this._timer = null;
      void this._tick();
    }, delay);
    // Never keep the process alive for telemetry.
    this._timer?.unref?.();
  }

  async _tick() {
    this._urgentFlush = false;
    try {
      await this._flushOnce();
    } catch {
      /* bounded and swallowed */
    }
    this._nextFlushAt = Number(this._clock()) + this.flushMs;
    if (this._disabled || this._closed) return;
    if (!this._hasPending()) {
      // Idle: let the chain lapse so an abandoned client can be collected;
      // the next record starts it again.
      this._stopWorker();
      return;
    }
    this._schedule();
  }

  _wake() {
    if (this._workerStarted && this._timer !== null) this._schedule();
  }

  /** The process is about to exit: one bounded attempt, never repeated for the same drain. */
  _flushAtExit() {
    if (this._exitAttempted || this._closed || this._disabled || !this._hasPending()) return;
    this._exitAttempted = true;
    void this._flushOnce({ timeoutMs: TELEMETRY_EXIT_FLUSH_MS });
  }

  /** Stop the worker and make one final bounded flush attempt (≤ timeoutMs). */
  async close({ timeoutMs = TELEMETRY_EXIT_FLUSH_MS } = {}) {
    if (this._closed) return;
    this._closed = true;
    this._stopWorker();
    const budget = Math.max(0, Number(timeoutMs) || 0);
    const started = Date.now();
    const remaining = () => Math.max(0, budget - (Date.now() - started));
    if (this._inflight !== null) await withDeadline(this._inflight, remaining());
    if (remaining() > 0) {
      await withDeadline(this._flushOnce({ timeoutMs: remaining() }), remaining());
    }
  }
}
