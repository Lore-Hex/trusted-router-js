import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

import { TrustedRouter } from "../src/index.js";
import {
  TELEMETRY_BACKOFF_MAX_MS,
  TELEMETRY_BACKOFF_MIN_MS,
  TELEMETRY_MAX_BATCH_BYTES,
  TELEMETRY_MAX_EVENTS,
  TELEMETRY_MAX_WINDOW_KEYS,
  TelemetryReporter,
  normaliseSdkIdentity,
  sdkIdentity,
} from "../src/internal/beacon.js";
import {
  DEFAULT_TELEMETRY_PATH,
  RecordingSink,
  TELEMETRY_ENDPOINTS,
  TELEMETRY_ERROR_CLASSES,
  TELEMETRY_SCHEMA_VERSION,
} from "../src/internal/telemetry.js";

// The beacon channel (contract v1 §4/§5/§6.2). Reporter tests mirror
// trusted-router-py's test_telemetry_reporter.py one for one, with an
// injected clock (ms), an injected fetch for the BEACON endpoint, and — where
// the engine is involved — a SEPARATE injected fetch for the engine, so the
// tests can prove the two never meet.

const SDK = {
  name: "tr-js",
  version: "0.5.0",
  lang: "js",
  runtime: "node/20.20.2",
  os: "macos",
  arch: "arm64",
};
const REQUEST_ID = "rlog_0123456789abcdef0123456789abcdef";
const BEACON_URL = "https://trustedrouter.com/v1/client-events";

class Clock {
  constructor(value = 0) {
    this.value = value;
    this.now = () => this.value;
  }

  advance(ms) {
    this.value += ms;
  }
}

/** mulberry32: a tiny seeded PRNG, so sampling tests are exact, not flaky. */
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function attempt(overrides = {}) {
  return {
    index: 0,
    host: "apex",
    outcome: "ok",
    http_status: 200,
    error_class: null,
    error_source: null,
    should_retry: "absent",
    retry_after_ms: null,
    elapsed_ms: 25,
    ttfb_ms: 20,
    request_id: REQUEST_ID,
    moved: false,
    ...overrides,
  };
}

function event(overrides = {}) {
  return {
    age_ms: 0,
    plane: "inference",
    endpoint: "responses",
    method: "POST",
    streaming: false,
    provider_pinned: false,
    model: "model/a",
    attempts: [attempt()],
    final_outcome: "ok",
    final_http_status: 200,
    total_ms: 25,
    ttft_ms: null,
    failover_used: false,
    timeout_phase: "none",
    configured_timeout_ms: 120_000,
    ...overrides,
  };
}

function counterKey(overrides = {}) {
  return Object.values({
    level: "request",
    endpoint: "responses",
    streaming: false,
    host: "apex",
    outcome: "ok",
    error_class: null,
    http_status_class: "2xx",
    timeout_phase: "none",
    timeout_floor_met: false,
    provider_pinned: false,
    ...overrides,
  });
}

function counterIncrement(overrides = {}) {
  return {
    requests: 1,
    attempts: 1,
    failover_used: 0,
    first_attempt_success: 1,
    total_ms_hist: { lt100: 1 },
    first_event_ms_hist: { lt100: 1 },
    ...overrides,
  };
}

function record(reporter, overrides = {}, key = counterKey()) {
  reporter.onRequest(event(overrides), [[key, counterIncrement()]]);
}

function accepted(policy = {}, headers = {}) {
  return new Response(
    JSON.stringify({ data: { accepted_events: 0, accepted_counters: 0, dropped: 0 }, policy }),
    { status: 202, headers: { "content-type": "application/json", ...headers } },
  );
}

/** A fake beacon endpoint: records every POST (parsed) and answers via `handler(n, call)`. */
function fakeBeacon(handler = () => accepted()) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const call = { url, init, body: JSON.parse(init.body) };
    calls.push(call);
    return handler(calls.length, call);
  };
  return { calls, fetchImpl };
}

function reporterFactory(t) {
  const made = [];
  t.after(async () => {
    for (const reporter of made) await reporter.close({ timeoutMs: 50 });
  });
  return (options = {}) => {
    const reporter = new TelemetryReporter({
      controlBaseUrl: "https://trustedrouter.com/v1",
      apiKeyProvider: () => null,
      sdkIdentity: { ...SDK },
      environ: {},
      ...options,
    });
    made.push(reporter);
    return reporter;
  };
}

// ---- sampling and bounds ----------------------------------------------------

test("sampling keeps failures, retries, slow calls and sampled random successes", (t) => {
  const make = reporterFactory(t);
  const reporter = make({ successSampleRate: 0 });
  reporter.onRequest(event({ final_outcome: "http_error", attempts: [attempt({ outcome: "http_error" })] }), []);
  reporter.onRequest(event({ attempts: [attempt(), attempt({ index: 1 })] }), []);
  reporter.onRequest(event({ failover_used: true }), []);
  reporter.onRequest(event({ total_ms: 30_001 }), []);
  reporter.onRequest(event(), []);
  assert.deepEqual(
    reporter._events.map((item) => item.sample_reason),
    ["failure", "retried", "retried", "slow"],
  );
  assert.ok(reporter._events.every((item) => item.sample_rate === 1));

  const sampled = make({ successSampleRate: 1 });
  sampled.onRequest(event(), []);
  assert.equal(sampled._events[0].sample_reason, "random");
  assert.equal(sampled._events[0].sample_rate, 1);

  // A seeded draw below the rate keeps the event; at or above drops it.
  const draws = [0.2, 0.5, 0.49, 0.99, 0.0];
  let index = 0;
  const seeded = make({ successSampleRate: 0.5, random: () => draws[index++] });
  for (let n = 0; n < draws.length; n += 1) seeded.onRequest(event(), []);
  assert.equal(seeded._events.length, 3);
  assert.ok(seeded._events.every((item) => item.sample_rate === 0.5));
});

test("successes are sampled with an injected PRNG through the real engine; failures always land", async (t) => {
  const make = reporterFactory(t);
  const rate = 0.25;
  const reporter = make({
    successSampleRate: rate,
    random: mulberry32(7),
    apiKeyProvider: () => "sk-test",
  });
  let calls = 0;
  const sdk = new TrustedRouter({
    apiKey: "sk-test",
    fetchImpl: async () => {
      calls += 1;
      return calls % 10 === 0
        ? new Response("{}", { status: 400 })
        : new Response("{}", { status: 200 });
    },
    maxRetries: 0,
    telemetry: true,
    _telemetrySink: reporter,
  });
  const total = 40;
  for (let n = 0; n < total; n += 1) {
    await sdk.request("POST", "/embeddings", { body: { model: "m", input: "x" } }).catch(() => {});
  }
  const failures = total / 10;
  const expectedDraw = mulberry32(7);
  let expectedSampled = 0;
  for (let n = 0; n < total - failures; n += 1) if (expectedDraw() < rate) expectedSampled += 1;
  assert.ok(expectedSampled > 0 && expectedSampled < total - failures, `seed gives ${expectedSampled}`);
  const reasons = reporter._events.map((item) => item.sample_reason);
  assert.equal(reasons.filter((reason) => reason === "failure").length, failures);
  assert.equal(reasons.filter((reason) => reason === "random").length, expectedSampled);
  assert.ok(
    reporter._events
      .filter((item) => item.sample_reason === "random")
      .every((item) => item.sample_rate === rate),
  );
  // Counters are exact regardless of sampling: every call is counted.
  const requests = [...reporter._currentCounters.values()]
    .filter((entry) => entry.key[0] === "request")
    .reduce((sum, entry) => sum + entry.counts.requests, 0);
  assert.equal(requests, total);
});

test("bounded events drop the oldest success before the oldest failure, counting every drop", (t) => {
  const make = reporterFactory(t);
  const reporter = make({ successSampleRate: 1 });
  reporter.onRequest(event({ final_outcome: "http_error", model: "failure" }), []);
  for (let index = 0; index < TELEMETRY_MAX_EVENTS - 1; index += 1) {
    reporter.onRequest(event({ model: `ok-${index}` }), []);
  }
  reporter.onRequest(event({ final_outcome: "http_error", model: "new-failure" }), []);
  assert.equal(reporter._events.length, TELEMETRY_MAX_EVENTS);
  assert.equal(reporter._events[0].model, "failure");
  assert.ok(reporter._events.every((item) => item.model !== "ok-0"));
  assert.equal(reporter._events.at(-1).model, "new-failure");
  assert.equal(reporter._droppedSinceLast, 1);

  const failures = make({ successSampleRate: 0 });
  for (let index = 0; index <= TELEMETRY_MAX_EVENTS; index += 1) {
    failures.onRequest(event({ final_outcome: "http_error", model: `failure-${index}` }), []);
  }
  assert.equal(failures._events.length, TELEMETRY_MAX_EVENTS);
  assert.equal(failures._events[0].model, "failure-1");
  assert.equal(failures._droppedSinceLast, 1);
});

// ---- exact counters ----------------------------------------------------------

test("counters fold at 256 keys and close when the minute changes", (t) => {
  const make = reporterFactory(t);
  const clock = new Clock(1);
  const reporter = make({ clock: clock.now, successSampleRate: 0 });
  const combinations = [];
  for (const endpoint of TELEMETRY_ENDPOINTS) {
    for (const errorClass of TELEMETRY_ERROR_CLASSES) {
      for (const status of ["none", "2xx", "4xx", "429", "5xx"]) {
        combinations.push({ endpoint, error_class: errorClass, http_status_class: status });
      }
    }
  }
  for (const overrides of combinations.slice(0, TELEMETRY_MAX_WINDOW_KEYS + 1)) {
    reporter.onRequest(event(), [[counterKey(overrides), counterIncrement()]]);
  }
  assert.equal(reporter._currentCounters.size, TELEMETRY_MAX_WINDOW_KEYS);
  const requests = [...reporter._currentCounters.values()].reduce(
    (sum, entry) => sum + entry.counts.requests,
    0,
  );
  assert.equal(requests, TELEMETRY_MAX_WINDOW_KEYS + 1, "folding never loses a request");
  assert.ok(
    [...reporter._currentCounters.values()].some(
      (entry) => entry.key[5] === "unknown" && entry.counts.requests > 1,
    ),
  );
  assert.equal(reporter._droppedSinceLast, 0, "folding is never a drop");

  clock.advance(60_000);
  reporter.onRequest(event(), [[counterKey(), counterIncrement()]]);
  assert.equal(reporter._closedWindows[0].windowStart, 0);
  assert.equal(reporter._currentWindowStart, 60_000);
  assert.equal(reporter._currentCounters.size, 1);
});

test("the fold ladder is exact: error class, then endpoint, then any existing key", (t) => {
  const make = reporterFactory(t);
  const reporter = make({ successSampleRate: 0 });
  const fill = (overridesList) => {
    for (const overrides of overridesList) {
      reporter.onRequest(event(), [[counterKey(overrides), counterIncrement()]]);
    }
  };
  // 256 distinct keys that all share everything except error_class/endpoint
  // pairs: 10 endpoints × 14 classes = 140, plus 116 more varied by status.
  const base = [];
  for (const endpoint of TELEMETRY_ENDPOINTS) {
    for (const errorClass of TELEMETRY_ERROR_CLASSES) {
      base.push({ endpoint, error_class: errorClass });
    }
  }
  for (const endpoint of TELEMETRY_ENDPOINTS) {
    for (const errorClass of TELEMETRY_ERROR_CLASSES.slice(0, 12)) {
      base.push({ endpoint, error_class: errorClass, http_status_class: "5xx" });
      if (base.length === TELEMETRY_MAX_WINDOW_KEYS) break;
    }
    if (base.length === TELEMETRY_MAX_WINDOW_KEYS) break;
  }
  fill(base);
  assert.equal(reporter._currentCounters.size, TELEMETRY_MAX_WINDOW_KEYS);
  const rows = () => [...reporter._currentCounters.values()];
  const find = (predicate) => rows().find((entry) => predicate(entry.key));

  // Step 1 — a new key whose error-class fold already exists joins it: the
  // "unknown" row for (responses, 5xx) exists? No: 5xx rows cover classes
  // 0..11 only, so "unknown" (index 13) is absent — the first compatible
  // existing row (differs only in error_class) is RE-KEYED to unknown and
  // the new key merges into it.
  const before = find((key) => key[1] === "responses" && key[6] === "5xx");
  assert.ok(before);
  fill([{ endpoint: "responses", error_class: "stream_stalled", http_status_class: "5xx" }]);
  assert.equal(reporter._currentCounters.size, TELEMETRY_MAX_WINDOW_KEYS);
  const folded = find((key) => key[1] === "responses" && key[6] === "5xx" && key[5] === "unknown");
  assert.ok(folded, "the compatible row was re-keyed to error_class unknown");
  assert.equal(folded.counts.requests, 2);
  assert.equal(
    rows().filter((entry) => entry.key[1] === "responses" && entry.key[6] === "5xx").length,
    12,
    "one row was re-keyed, none added",
  );

  // Step 2 — with the unknown row present, the same fold is a plain join.
  fill([{ endpoint: "responses", error_class: "unknown", http_status_class: "5xx" }]);
  assert.equal(folded.counts.requests, 3);

  // Step 3 — no error-compatible row at all (a brand-new status class):
  // endpoint fold re-keys the first row compatible on everything but
  // endpoint and error class to (inference_other, unknown).
  fill([{ endpoint: "responses", error_class: "dns", http_status_class: "429" }]);
  assert.equal(reporter._currentCounters.size, TELEMETRY_MAX_WINDOW_KEYS);
  const endpointFolded = find((key) => key[6] === "429");
  assert.equal(endpointFolded, undefined, "a 429 row has nowhere to fold but an existing key");
  const total = rows().reduce((sum, entry) => sum + entry.counts.requests, 0);
  assert.equal(total, TELEMETRY_MAX_WINDOW_KEYS + 3, "the last-resort fold still counts exactly");
  assert.equal(rows()[0].counts.requests >= 2, true, "it landed on the first existing key");
  assert.equal(reporter._droppedSinceLast, 0);
});

test("the real engine produces exact counters for a scripted sequence, delivered with their window age", async (t) => {
  const make = reporterFactory(t);
  const clock = new Clock(1_000);
  const { calls, fetchImpl } = fakeBeacon();
  const reporter = make({
    clock: clock.now,
    apiKeyProvider: () => "sk-test",
    fetchImpl,
    successSampleRate: 0,
  });
  const engineUrls = [];
  let embeddingsCalls = 0;
  const sdk = new TrustedRouter({
    apiKey: "sk-test",
    fetchImpl: async (url) => {
      engineUrls.push(String(url));
      const { host, pathname } = new URL(url);
      if (pathname.endsWith("/embeddings")) {
        embeddingsCalls += 1;
        if (embeddingsCalls === 1 && host === "api.trustedrouter.com") {
          return new Response("{}", { status: 503 });
        }
        if (embeddingsCalls === 3) return new Response("{}", { status: 400 });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    maxRetries: 1,
    telemetry: true,
    _telemetrySink: reporter,
  });
  sdk._telemetryNow = () => 0;
  await sdk.request("GET", "/models");
  await sdk.embeddings({ model: "m", input: "x" }); // 503 on apex, then ok on ally
  await sdk.request("GET", "/models");
  await assert.rejects(sdk.embeddings({ model: "m", input: "x" })); // 400
  assert.ok(engineUrls.every((url) => !url.includes("/client-events")));

  clock.advance(90_000);
  assert.equal(await reporter.flushNow(), true);
  assert.equal(calls.length, 1);
  const batch = calls[0].body;
  assert.equal(batch.events.length, 2, "the failure and retried call are events; ok-first-attempt calls were not sampled");
  const rows = batch.counters
    .map(({ window_start_age_ms, ...row }) => {
      assert.equal(window_start_age_ms, 91_000);
      return row;
    })
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const row = (level, endpoint, host, outcome, statusClass, counts) => ({
    level,
    endpoint,
    streaming: false,
    host,
    outcome,
    error_class: null,
    http_status_class: statusClass,
    timeout_phase: "none",
    timeout_floor_met: false,
    provider_pinned: false,
    ...counts,
  });
  const expected = [
    row("request", "models", "apex", "ok", "2xx", {
      requests: 2, attempts: 2, failover_used: 0, first_attempt_success: 2,
      total_ms_hist: { lt100: 2 }, first_event_ms_hist: { lt100: 2 },
    }),
    row("attempt", "models", "apex", "ok", "2xx", {
      requests: 2, attempts: 2, failover_used: 0, first_attempt_success: 0,
      total_ms_hist: {}, first_event_ms_hist: {},
    }),
    row("request", "embeddings", "ally", "ok", "2xx", {
      requests: 1, attempts: 2, failover_used: 1, first_attempt_success: 0,
      total_ms_hist: { lt100: 1 }, first_event_ms_hist: { lt100: 1 },
    }),
    row("attempt", "embeddings", "apex", "http_error", "5xx", {
      requests: 1, attempts: 1, failover_used: 1, first_attempt_success: 0,
      total_ms_hist: {}, first_event_ms_hist: {},
    }),
    row("attempt", "embeddings", "ally", "ok", "2xx", {
      requests: 1, attempts: 1, failover_used: 0, first_attempt_success: 0,
      total_ms_hist: {}, first_event_ms_hist: {},
    }),
    row("request", "embeddings", "apex", "http_error", "4xx", {
      requests: 1, attempts: 1, failover_used: 0, first_attempt_success: 0,
      total_ms_hist: { lt100: 1 }, first_event_ms_hist: { lt100: 1 },
    }),
    row("attempt", "embeddings", "apex", "http_error", "4xx", {
      requests: 1, attempts: 1, failover_used: 0, first_attempt_success: 0,
      total_ms_hist: {}, first_event_ms_hist: {},
    }),
  ].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  assert.deepEqual(rows, expected);
  assert.equal(reporter._closedWindows.length, 0, "delivered counters are gone");
  assert.equal(reporter._events.length, 0);
});

// ---- delivery, retention, responses -------------------------------------------

test("a failed flush retains counters, then delivers them with their age", async (t) => {
  const make = reporterFactory(t);
  const clock = new Clock();
  const statuses = [503, 202];
  const { calls, fetchImpl } = fakeBeacon((n) =>
    statuses[n - 1] === 202 ? accepted() : new Response("", { status: 503 }),
  );
  const reporter = make({
    clock: clock.now,
    apiKeyProvider: () => "sk-test",
    fetchImpl,
    successSampleRate: 0,
  });
  record(reporter);
  assert.equal(await reporter.flushNow(), false);
  assert.equal(reporter._closedWindows.length, 1);
  assert.equal(reporter._retainedWindowBytes > 0, true);

  clock.advance(120_000);
  assert.equal(await reporter.flushNow(), true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.counters[0].window_start_age_ms, 120_000);
  assert.equal(calls[1].body.seq, 1);
  assert.equal(calls[0].body.seq, 0);
  assert.equal(calls[0].body.instance_id, calls[1].body.instance_id);
  assert.notEqual(calls[0].body.batch_id, calls[1].body.batch_id);
  assert.equal(reporter._closedWindows.length, 0);
  assert.equal(reporter._retainedWindowBytes, 0);
});

test("retention drops expired and byte-capped windows oldest first", (t) => {
  const make = reporterFactory(t);
  const clock = new Clock();
  const reporter = make({ clock: clock.now, successSampleRate: 0, retentionBytes: 700 });
  for (let index = 0; index < 4; index += 1) {
    reporter.onRequest(event(), [[counterKey(), counterIncrement()]]);
    clock.advance(60_000);
  }
  reporter.onRequest(event(), []);
  const starts = reporter._closedWindows.map((window) => window.windowStart);
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
  assert.ok(starts.length > 0 && starts[0] > 0, "the oldest window went first");
  assert.ok(reporter._retainedWindowBytes <= 700);
  assert.ok(reporter._droppedSinceLast > 0, "a dropped window counts its rows");

  clock.advance(86_400_001);
  reporter._pruneWindows(clock.now());
  assert.equal(reporter._closedWindows.length, 0);
  assert.equal(reporter._retainedWindowBytes, 0);
});

test("the wire is bounded, content-free, schema-shaped and uses the reporter's own client", async (t) => {
  const make = reporterFactory(t);
  const injected = "private prompt text that must not leave";
  const { calls, fetchImpl } = fakeBeacon();
  const reporter = make({
    apiKeyProvider: () => "sk-tr-test",
    workspaceId: "ws_test",
    fetchImpl,
    successSampleRate: 1,
  });
  record(reporter, {
    model: injected,
    prompt: injected,
    messages: [{ role: "user", content: injected }],
    attempts: [attempt({ should_retry: "true", request_id: REQUEST_ID })],
  });
  assert.equal(await reporter.flushNow(), true);
  assert.equal(calls.length, 1);
  const { url, init, body } = calls[0];
  assert.equal(url, BEACON_URL);
  assert.equal(init.method, "POST");
  assert.equal(init.headers.authorization, "Bearer sk-tr-test");
  assert.equal(init.headers["x-trustedrouter-workspace"], "ws_test");
  assert.equal(init.headers["content-type"], "application/json");
  assert.match(init.headers["user-agent"], /^trusted-router-js\//);
  assert.equal(init.credentials, "omit");
  assert.equal(init.redirect, "manual");
  assert.ok(init.signal instanceof AbortSignal);
  assert.deepEqual(Object.keys(body), [
    "schema_version",
    "batch_id",
    "instance_id",
    "seq",
    "sent_at_ms",
    "sdk",
    "synthetic",
    "dropped_since_last",
    "events",
    "counters",
  ]);
  assert.equal(body.schema_version, TELEMETRY_SCHEMA_VERSION);
  assert.match(body.batch_id, /^[0-9a-f]{32}$/);
  assert.match(body.instance_id, /^[0-9a-f]{16}$/);
  assert.equal(body.seq, 0);
  assert.equal(typeof body.sent_at_ms, "number");
  assert.equal(body.synthetic, false);
  assert.deepEqual(body.sdk, SDK);
  assert.deepEqual(Object.keys(body.events[0]), [
    "age_ms",
    "plane",
    "endpoint",
    "method",
    "streaming",
    "provider_pinned",
    "model",
    "attempts",
    "final_outcome",
    "final_http_status",
    "total_ms",
    "ttft_ms",
    "failover_used",
    "timeout_phase",
    "configured_timeout_ms",
    "sample_rate",
    "sample_reason",
  ]);
  assert.deepEqual(Object.keys(body.events[0].attempts[0]), [
    "index",
    "host",
    "outcome",
    "http_status",
    "error_class",
    "error_source",
    "retry_after_ms",
    "elapsed_ms",
    "ttfb_ms",
    "request_id",
    "moved",
    "should_retry",
  ]);
  assert.deepEqual(Object.keys(body.counters[0]), [
    "window_start_age_ms",
    "level",
    "endpoint",
    "streaming",
    "host",
    "outcome",
    "error_class",
    "http_status_class",
    "timeout_phase",
    "timeout_floor_met",
    "provider_pinned",
    "requests",
    "attempts",
    "failover_used",
    "first_attempt_success",
    "total_ms_hist",
    "first_event_ms_hist",
  ]);
  assert.equal(body.events[0].model, null, "an out-of-grammar model is null");
  assert.equal(body.events[0].attempts[0].should_retry, true);
  assert.equal(body.events[0].attempts[0].request_id, REQUEST_ID);
  assert.equal(body.events[0].sample_reason, "random");
  const encoded = JSON.stringify(body);
  assert.ok(!encoded.includes(injected));
  assert.ok(!encoded.includes("prompt"));
  assert.ok(!encoded.includes("messages"));
  assert.ok(Buffer.byteLength(init.body, "utf8") <= TELEMETRY_MAX_BATCH_BYTES);
});

test("should_retry is absent unless observed, and a 16-attempt cap applies on the wire", async (t) => {
  const make = reporterFactory(t);
  const { calls, fetchImpl } = fakeBeacon();
  const reporter = make({ apiKeyProvider: () => "sk-test", fetchImpl, successSampleRate: 0 });
  const attempts = [];
  for (let index = 0; index < 20; index += 1) attempts.push(attempt({ index, outcome: "http_error", http_status: 503 }));
  attempts[0].should_retry = "false";
  record(reporter, { final_outcome: "exhausted", attempts });
  assert.equal(await reporter.flushNow(), true);
  const wire = calls[0].body.events[0];
  assert.equal(wire.attempts.length, 16);
  assert.equal(wire.attempts[0].should_retry, false);
  assert.equal("should_retry" in wire.attempts[1], false);
  assert.equal(wire.final_outcome, "exhausted");
});

test("policy only reduces volume, and a pause defers delivery", async (t) => {
  const make = reporterFactory(t);
  const clock = new Clock();
  const { calls, fetchImpl } = fakeBeacon((n) =>
    accepted(
      n === 1
        ? { success_sample_rate: 0.005, flush_seconds: 60, pause_seconds: 120 }
        : { success_sample_rate: 0.5, flush_seconds: 1, pause_seconds: 0 },
    ),
  );
  const reporter = make({
    clock: clock.now,
    apiKeyProvider: () => "sk-test",
    fetchImpl,
    successSampleRate: 0.01,
  });
  record(reporter, { final_outcome: "http_error" });
  assert.equal(await reporter.flushNow(), true);
  assert.equal(reporter.successSampleRate, 0.005);
  assert.equal(reporter.flushMs, 60_000);

  record(reporter, { final_outcome: "http_error" });
  assert.equal(await reporter.flushNow(), false, "paused");
  assert.equal(calls.length, 1);
  clock.advance(120_000);
  assert.equal(await reporter.flushNow(), true);
  assert.equal(reporter.successSampleRate, 0.005, "a higher rate is ignored");
  assert.equal(reporter.flushMs, 60_000, "a shorter interval is ignored");

  // Out-of-range pauses and absurd intervals are ignored / capped.
  reporter._applyPolicy({ policy: { pause_seconds: 86_401, flush_seconds: 100_000 } }, clock.now());
  assert.equal(reporter._pausedUntil, 120_000);
  assert.equal(reporter.flushMs, TELEMETRY_BACKOFF_MAX_MS);
  reporter._applyPolicy({ policy: { success_sample_rate: -1 } }, clock.now());
  assert.equal(reporter.successSampleRate, 0.005);
  reporter._applyPolicy({ policy: { success_sample_rate: 0 } }, clock.now());
  assert.equal(reporter.successSampleRate, 0);
});

for (const status of [400, 401, 403, 404, 410]) {
  test(`a ${status} disables telemetry for the process and clears the buffers`, async (t) => {
    const make = reporterFactory(t);
    const { calls, fetchImpl } = fakeBeacon(() => new Response("", { status }));
    const reporter = make({ apiKeyProvider: () => "sk-test", fetchImpl });
    record(reporter, { final_outcome: "http_error" });
    assert.equal(await reporter.flushNow(), false);
    assert.equal(reporter._disabled, true);
    record(reporter, { final_outcome: "http_error" });
    assert.equal(await reporter.flushNow(), false);
    assert.equal(calls.length, 1, "never a second POST");
    assert.equal(reporter._events.length, 0);
    assert.equal(reporter._closedWindows.length, 0);
    assert.equal(reporter._currentCounters.size, 0);
    assert.equal(reporter._workerStarted, false, "the worker is gone");
    assert.equal(reporter._timer, null);
  });
}

test("413 drops the batch and counts the drops; the next batch reports them", async (t) => {
  const make = reporterFactory(t);
  const { calls, fetchImpl } = fakeBeacon((n) =>
    n === 1 ? new Response("", { status: 413 }) : accepted(),
  );
  const reporter = make({ apiKeyProvider: () => "sk-test", fetchImpl, successSampleRate: 0 });
  record(reporter, { final_outcome: "http_error" });
  record(reporter, { final_outcome: "http_error" });
  assert.equal(await reporter.flushNow(), false);
  assert.equal(reporter._events.length, 0);
  assert.equal(reporter._droppedSinceLast, 2 + 1, "two events and one counter row");
  assert.equal(reporter._disabled, false);
  record(reporter, { final_outcome: "http_error" });
  assert.equal(await reporter.flushNow(), true);
  assert.equal(calls[1].body.dropped_since_last, 3);
  assert.equal(reporter._droppedSinceLast, 0, "acknowledged drops are cleared");
});

test("x-tr-telemetry: off disables on any status, and a 429 backs off honouring Retry-After", async (t) => {
  const make = reporterFactory(t);
  const clock = new Clock();
  const { calls, fetchImpl } = fakeBeacon((n) =>
    n === 1 ? new Response("", { status: 429, headers: { "retry-after": "120" } }) : accepted(),
  );
  const reporter = make({ clock: clock.now, apiKeyProvider: () => "sk-test", fetchImpl });
  record(reporter, { final_outcome: "http_error" });
  assert.equal(await reporter.flushNow(), false);
  assert.equal(reporter._events.length, 1, "nothing lost");
  clock.advance(119_000);
  assert.equal(await reporter.flushNow(), false);
  assert.equal(calls.length, 1);
  clock.advance(1_000);
  assert.equal(await reporter.flushNow(), true);
  assert.equal(calls.length, 2);
  assert.equal(reporter._backoffMs, TELEMETRY_BACKOFF_MIN_MS, "a 202 resets the backoff");

  const off = make({
    apiKeyProvider: () => "sk-test",
    fetchImpl: async () => accepted({}, { "x-tr-telemetry": "OFF" }),
  });
  record(off, { final_outcome: "http_error" });
  assert.equal(await off.flushNow(), true);
  assert.equal(off._disabled, true);
  assert.equal(off._events.length, 0);
});

test("backoff doubles from 60 s to 10 min, caps Retry-After at 600 s, and is never a retry", async (t) => {
  const make = reporterFactory(t);
  const clock = new Clock();
  const retryAfter = [null, "601", "300", null, null];
  const { calls, fetchImpl } = fakeBeacon((n) =>
    new Response("", {
      status: 503,
      headers: retryAfter[n - 1] === null ? {} : { "retry-after": retryAfter[n - 1] },
    }),
  );
  const reporter = make({ clock: clock.now, apiKeyProvider: () => "sk-test", fetchImpl });
  record(reporter, { final_outcome: "http_error" });
  const expectedDelays = [60_000, 120_000, 300_000, 480_000, 600_000];
  for (const delay of expectedDelays) {
    assert.equal(await reporter.flushNow(), false);
    assert.equal(reporter._backoffUntil - clock.now(), delay);
    clock.advance(delay - 1);
    assert.equal(await reporter.flushNow(), false, "still backing off");
    clock.advance(1);
  }
  assert.equal(calls.length, expectedDelays.length, "exactly one POST per flush window");
  assert.equal(reporter._backoffMs, TELEMETRY_BACKOFF_MAX_MS);
});

test("a transport failure backs off 60 s, and debug echoes the exact batch to stderr", async (t) => {
  const make = reporterFactory(t);
  const clock = new Clock();
  let posted = null;
  let calls = 0;
  const reporter = make({
    clock: clock.now,
    apiKeyProvider: () => "sk-test",
    fetchImpl: async (url, init) => {
      calls += 1;
      if (calls === 1) throw new TypeError("fetch failed");
      posted = init.body;
      return accepted();
    },
    debug: true,
  });
  const lines = [];
  const write = process.stderr.write;
  process.stderr.write = (chunk) => {
    lines.push(String(chunk));
    return true;
  };
  try {
    record(reporter, { final_outcome: "transport_error" });
    assert.equal(await reporter.flushNow(), false);
    clock.advance(59_000);
    assert.equal(await reporter.flushNow(), false);
    clock.advance(1_000);
    assert.equal(await reporter.flushNow(), true);
  } finally {
    process.stderr.write = write;
  }
  assert.equal(lines.length, 2);
  for (const line of lines) assert.match(line, /^trustedrouter telemetry batch: \{"schema_version":1,/);
  assert.equal(lines[1], `trustedrouter telemetry batch: ${posted}\n`, "the echo IS the body sent");

  // The env var is the documented switch.
  const viaEnv = make({ environ: { TRUSTEDROUTER_TELEMETRY_DEBUG: "1" } });
  assert.equal(viaEnv.debug, true);
  assert.equal(make({ environ: { TRUSTEDROUTER_TELEMETRY_DEBUG: "0" } }).debug, false);
});

test("the backlog drains in successive ≤100/≤200 batches and a 65 537-byte batch never leaves", async (t) => {
  const make = reporterFactory(t);
  const { calls, fetchImpl } = fakeBeacon();
  const reporter = make({ apiKeyProvider: () => "sk-test", fetchImpl, successSampleRate: 0 });
  const longModel = "m".repeat(128);
  for (let index = 0; index < 150; index += 1) {
    record(reporter, {
      final_outcome: "http_error",
      model: longModel,
      attempts: [attempt({ outcome: "http_error" }), attempt({ index: 1, outcome: "http_error" })],
    });
  }
  assert.equal(reporter._events.length, 150);
  assert.equal(await reporter.flushNow(), true);
  const first = calls[0];
  assert.ok(Buffer.byteLength(first.init.body, "utf8") <= TELEMETRY_MAX_BATCH_BYTES);
  assert.ok(first.body.events.length < 100, `trimmed to fit: ${first.body.events.length}`);
  assert.equal(first.body.dropped_since_last, 0, "trimming is not dropping");
  const sentSoFar = first.body.events.length;
  assert.equal(reporter._events.length, 150 - sentSoFar, "the rest stays buffered");
  assert.equal(await reporter.flushNow(), true);
  assert.equal(calls[1].body.seq, 1);
  assert.ok(calls[1].body.events.length <= 100);
  let total = sentSoFar + calls[1].body.events.length;
  while (reporter._events.length > 0) {
    assert.equal(await reporter.flushNow(), true);
    total += calls.at(-1).body.events.length;
  }
  assert.equal(total, 150, "every event was delivered exactly once");
  for (const call of calls) {
    assert.ok(Buffer.byteLength(call.init.body, "utf8") <= TELEMETRY_MAX_BATCH_BYTES);
    assert.ok(call.body.counters.length <= 200);
  }
});

test("a 202 with a malformed body is still a delivery; a missing key never POSTs", async (t) => {
  const make = reporterFactory(t);
  const { calls, fetchImpl } = fakeBeacon(() => new Response("not json", { status: 202 }));
  const reporter = make({ apiKeyProvider: () => "sk-test", fetchImpl });
  record(reporter, { final_outcome: "http_error" });
  assert.equal(await reporter.flushNow(), true);
  assert.equal(reporter._events.length, 0);

  const keyless = make({ fetchImpl });
  record(keyless, { final_outcome: "http_error" });
  assert.equal(await keyless.flushNow(), false);
  assert.equal(calls.length, 1);
  assert.equal(keyless._events.length, 1, "kept until a key exists");
});

// ---- lifecycle ----------------------------------------------------------------

test("the worker is lazy, unref'd, single, and close is bounded", async (t) => {
  const make = reporterFactory(t);
  let aborted = 0;
  const hanging = (url, init) =>
    new Promise((resolve, reject) => {
      init.signal.addEventListener(
        "abort",
        () => {
          aborted += 1;
          reject(init.signal.reason);
        },
        { once: true },
      );
    });
  const reporter = make({ apiKeyProvider: () => "sk-test", fetchImpl: hanging });
  assert.equal(reporter._workerStarted, false, "never started at construction");
  assert.equal(reporter._timer, null);
  record(reporter, { final_outcome: "http_error" });
  assert.equal(reporter._workerStarted, true, "started on the first record");
  assert.notEqual(reporter._timer, null);
  assert.equal(reporter._timer.hasRef(), false, "never keeps the process alive");
  const timer = reporter._timer;
  record(reporter, { final_outcome: "http_error" });
  assert.equal(reporter._timer, timer, "one worker, not one per record");

  const started = Date.now();
  await reporter.close({ timeoutMs: 300 });
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 1_000, `close took ${elapsed} ms`);
  assert.equal(reporter._closed, true);
  assert.equal(reporter._timer, null);
  assert.equal(reporter._workerStarted, false);
  record(reporter, { final_outcome: "http_error" });
  assert.equal(reporter._events.length, 2, "a closed reporter records nothing new");
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(aborted, 1, "the final flush was one bounded attempt");
});

test("the worker flushes on its own schedule and lapses when idle", async (t) => {
  const make = reporterFactory(t);
  const { calls, fetchImpl } = fakeBeacon();
  const reporter = make({ apiKeyProvider: () => "sk-test", fetchImpl, flushMs: 30 });
  record(reporter, { final_outcome: "http_error" });
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(calls.length, 1, "flushed by the worker, not by a test call");
  assert.equal(reporter._workerStarted, false, "idle: the chain lapsed");
  assert.equal(reporter._timer, null);
  record(reporter, { final_outcome: "http_error" });
  assert.equal(reporter._workerStarted, true, "and restarts on the next record");
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(calls.length, 2);
});

test("50 events or 60 KB trigger an urgent flush ahead of the interval", async (t) => {
  const make = reporterFactory(t);
  const { calls, fetchImpl } = fakeBeacon();
  const reporter = make({ apiKeyProvider: () => "sk-test", fetchImpl, successSampleRate: 0 });
  for (let index = 0; index < 49; index += 1) record(reporter, { final_outcome: "http_error" });
  assert.equal(reporter._urgentFlush, false);
  record(reporter, { final_outcome: "http_error" });
  assert.equal(reporter._urgentFlush, true);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(calls.length, 1, "flushed well before the 30 s interval");
  assert.equal(calls[0].body.events.length, 50);
});

test("sdkIdentity uses only the contract vocabulary and normalisation falls back per field", () => {
  const identity = sdkIdentity();
  assert.equal(identity.name, "tr-js");
  assert.equal(identity.lang, "js");
  assert.match(identity.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:[-+].+)?$/);
  assert.ok(identity.version.length <= 32);
  assert.match(identity.runtime, /^[a-z]{1,10}\/[0-9A-Za-z.+-]{1,24}$/);
  assert.ok(["linux", "macos", "windows", "ios", "android", "freebsd", "other"].includes(identity.os));
  assert.ok(["x64", "x32", "arm", "arm64", "wasm", "other"].includes(identity.arch));
  assert.deepEqual(Object.keys(identity), ["name", "version", "lang", "runtime", "os", "arch"]);

  const normalised = normaliseSdkIdentity({
    name: "tr-nope",
    version: "1.2",
    lang: "js",
    runtime: "Node 20",
    os: "plan9",
    arch: "riscv",
  });
  assert.equal(normalised.name, identity.name);
  assert.equal(normalised.version, identity.version);
  assert.equal(normalised.lang, "js");
  assert.equal(normalised.runtime, identity.runtime);
  assert.equal(normalised.os, identity.os);
  assert.equal(normalised.arch, identity.arch);
  assert.deepEqual(normaliseSdkIdentity(SDK), SDK);
  assert.deepEqual(normaliseSdkIdentity(null), identity);
});

// ---- the facade and the engine ---------------------------------------------------

test("the engine's own fake transport sees zero /client-events calls; the beacon has its own client", async (t) => {
  const make = reporterFactory(t);
  const beacon = fakeBeacon();
  const reporter = make({ apiKeyProvider: () => "sk-test", fetchImpl: beacon.fetchImpl });
  const engineCalls = [];
  const sdk = new TrustedRouter({
    apiKey: "sk-test",
    fetchImpl: async (url, init) => {
      engineCalls.push({ url: String(url), method: init.method });
      return new Response("{}", { status: 500 });
    },
    maxRetries: 0,
    telemetry: true,
    _telemetrySink: reporter,
  });
  await assert.rejects(sdk.request("POST", "/embeddings", { body: { model: "m", input: "x" } }));
  assert.equal(await reporter.flushNow(), true);
  assert.equal(engineCalls.length, 1);
  assert.ok(engineCalls.every(({ url }) => !url.includes("/client-events")));
  assert.equal(beacon.calls.length, 1);
  assert.equal(beacon.calls[0].url, BEACON_URL);
  assert.equal(beacon.calls[0].url.endsWith(DEFAULT_TELEMETRY_PATH), true);
  assert.equal(beacon.calls[0].body.events[0].final_outcome, "http_error");
  assert.equal(beacon.calls[0].body.events[0].attempts[0].http_status, 500);
});

test("the facade creates the reporter on the first inference call and close() flushes it", async (t) => {
  const beacon = fakeBeacon();
  const sdk = new TrustedRouter({
    apiKey: "sk-test",
    workspaceId: "ws_1",
    fetchImpl: async () => new Response("{}", { status: 500 }),
    maxRetries: 0,
    telemetry: true,
    telemetrySampleRate: 0.5,
  });
  assert.equal(sdk._telemetrySink, null, "nothing at construction");
  await sdk.models().catch(() => {});
  assert.equal(sdk._telemetrySink, null, "nothing for the control plane");
  await assert.rejects(sdk.request("POST", "/embeddings", { body: { model: "m", input: "x" } }));
  const reporter = sdk._telemetrySink;
  assert.ok(reporter instanceof TelemetryReporter);
  t.after(() => reporter.close({ timeoutMs: 50 }));
  assert.equal(reporter.successSampleRate, 0.5);
  assert.equal(reporter.workspaceId, "ws_1");
  assert.equal(reporter.controlBaseUrl, "https://trustedrouter.com/v1");
  assert.equal(sdk._ownsTelemetryReporter, true);
  // Swap in the fake endpoint for the final flush (the real one is the
  // global fetch captured at construction — never the engine's fetchImpl).
  reporter._fetch = beacon.fetchImpl;
  await sdk.close();
  assert.equal(beacon.calls.length, 1);
  assert.equal(beacon.calls[0].init.headers.authorization, "Bearer sk-test");
  assert.equal(beacon.calls[0].init.headers["x-trustedrouter-workspace"], "ws_1");
  assert.equal(reporter._closed, true);
  await sdk.close();
  assert.equal(beacon.calls.length, 1, "close is idempotent");

  // An injected sink is the caller's: close() leaves it alone.
  const sink = new RecordingSink();
  const injected = new TrustedRouter({
    apiKey: "sk-test",
    fetchImpl: async () => new Response("{}", { status: 200 }),
    telemetry: true,
    _telemetrySink: sink,
  });
  await injected.request("POST", "/embeddings", { body: { model: "m", input: "x" } });
  assert.equal(injected._ownsTelemetryReporter, false);
  await injected.close();
  assert.equal(sink.events.length, 1);
});

test("opt-out precedence leaves no worker at all", async () => {
  const saved = { ...process.env };
  const noReporter = async (options, env) => {
    for (const key of ["TRUSTEDROUTER_TELEMETRY", "DO_NOT_TRACK"]) delete process.env[key];
    Object.assign(process.env, env);
    const sdk = new TrustedRouter({
      apiKey: "sk-test",
      fetchImpl: async () => new Response("{}", { status: 500 }),
      maxRetries: 0,
      ...options,
    });
    await sdk.request("POST", "/embeddings", { body: { model: "m", input: "x" } }).catch(() => {});
    assert.equal(sdk.telemetryEnabled, false, JSON.stringify({ options, env }));
    assert.equal(sdk._telemetrySink, null, JSON.stringify({ options, env }));
  };
  try {
    await noReporter({ telemetry: false }, { TRUSTEDROUTER_TELEMETRY: "1" });
    await noReporter({}, { TRUSTEDROUTER_TELEMETRY: "off" });
    await noReporter({}, { DO_NOT_TRACK: "1" });
    await noReporter({ baseUrl: "https://my.internal/v1" }, {});
    await noReporter({ controlBaseUrl: "https://control.my.internal/v1" }, {});
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});

// ---- process exit ------------------------------------------------------------

const EXIT_SCRIPT = `
  const { TrustedRouter } = await import(process.env.JS_SDK_INDEX);
  const { TelemetryReporter } = await import(process.env.JS_SDK_BEACON);
  const mode = process.env.JS_BEACON_MODE;
  const reporter = new TelemetryReporter({
    controlBaseUrl: "https://trustedrouter.com/v1",
    apiKeyProvider: () => "sk-test",
    environ: {},
    fetchImpl: (url, init) => new Promise((resolve, reject) => {
      process.stdout.write("POST " + url + "\\n");
      if (mode === "fast") {
        resolve(new Response("{}", { status: 202 }));
        return;
      }
      // A slow endpoint that keeps the loop alive (a ref'd timer, like a
      // real socket) but honours the abort the 2 s exit budget sends.
      const timer = setTimeout(() => resolve(new Response("{}", { status: 202 })), 15_000);
      init.signal.addEventListener("abort", () => {
        clearTimeout(timer);
        process.stdout.write("ABORTED\\n");
        reject(init.signal.reason);
      }, { once: true });
    }),
  });
  const sdk = new TrustedRouter({
    apiKey: "sk-test",
    fetchImpl: async () => new Response("{}", { status: 500 }),
    maxRetries: 0,
    telemetry: true,
    _telemetrySink: reporter,
  });
  await sdk.request("POST", "/embeddings", { body: { model: "m", input: "x" } }).catch(() => {});
  process.stdout.write("DONE\\n");
`;

function runExitScript(mode) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(process.execPath, ["--input-type=module", "-e", EXIT_SCRIPT], {
      env: {
        ...process.env,
        TRUSTEDROUTER_TELEMETRY: "1",
        JS_BEACON_MODE: mode,
        JS_SDK_INDEX: new URL("../src/index.js", import.meta.url).href,
        JS_SDK_BEACON: new URL("../src/internal/beacon.js", import.meta.url).href,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr, elapsed: Date.now() - started }));
  });
}

test("the beacon flushes once on beforeExit, within 2 s, and never keeps the process alive", async () => {
  const fast = await runExitScript("fast");
  assert.equal(fast.code, 0, fast.stderr);
  assert.deepEqual(
    fast.stdout.trim().split("\n"),
    ["DONE", `POST ${BEACON_URL}`],
    "exactly one POST, after the program's own work",
  );

  const slow = await runExitScript("slow");
  assert.equal(slow.code, 0, slow.stderr);
  assert.deepEqual(slow.stdout.trim().split("\n"), ["DONE", `POST ${BEACON_URL}`, "ABORTED"]);
  assert.ok(slow.elapsed >= 1_500, `aborted too early: ${slow.elapsed} ms`);
  assert.ok(slow.elapsed < 8_000, `the exit flush must be bounded by 2 s: ${slow.elapsed} ms`);
});
