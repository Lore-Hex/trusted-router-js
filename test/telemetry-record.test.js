import assert from "node:assert/strict";
import test from "node:test";

import { TrustedRouter } from "../src/index.js";
import {
  RecordingSink,
  RequestRecorder,
  endpointEnum,
  latencyBucket,
  statusClass,
  timeoutFloorMet,
} from "../src/internal/telemetry.js";

// The beacon's RECORD: every test here drives the REAL engine (performRequest
// via the client's request/rawRequest/facade methods) with an injected fetch
// and an in-memory sink, and asserts the finished §5.3 event and the exact
// §5.4 counter increments the recorder hands the sink. Nothing here touches
// the network, and the engine's fake never sees a beacon (the reporter is
// covered in test/telemetry-beacon.test.js).

const REQUEST_ID = "rlog_0123456789abcdef0123456789abcdef";
const FIRST_FRAME =
  'data: {"id":"c1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"hi"}}]}\n\n';
const SECOND_FRAME =
  'data: {"id":"c1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":" there"}}]}\n\n';
const DONE_FRAME = "data: [DONE]\n\n";
const encoder = new TextEncoder();

function okJson(body = { ok: true }, headers = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

function sseResponse(frames = [FIRST_FRAME, DONE_FRAME], headers = {}) {
  return new Response(frames.join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream", ...headers },
  });
}

/** A 200 whose body delivers `frames` and then fails with `error`. */
function brokenBodyResponse(frames, error) {
  let index = 0;
  const body = new ReadableStream({
    async pull(controller) {
      if (index < frames.length) {
        controller.enqueue(encoder.encode(frames[index++]));
        return;
      }
      // Make this a genuine mid-body failure: Web Streams discard queued
      // chunks when error() is called synchronously in start().
      await new Promise((resolve) => setTimeout(resolve, 1));
      controller.error(error);
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function clientWith(fetchImpl, options = {}) {
  const sink = new RecordingSink();
  const sdk = new TrustedRouter({
    apiKey: "sk-test",
    fetchImpl,
    maxRetries: 1,
    telemetry: true,
    _telemetrySink: sink,
    ...options,
  });
  return { sdk, sink };
}

/** A recorder clock that returns the scripted values in call order. */
function scriptedClock(values) {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)];
    index += 1;
    return value;
  };
}

const resetError = () =>
  new TypeError("fetch failed", {
    cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }),
  });

test("a streamed call records ttft from the first decoded event and exact counters", async () => {
  const { sdk, sink } = clientWith(async () =>
    sseResponse(undefined, { "x-request-id": REQUEST_ID }),
  );
  // Clock reads, in order: beginAttempt, onResponse (headers at 40 ms), the
  // codec's first event (130 ms), finish (500 ms).
  sdk._telemetryNow = scriptedClock([0, 40, 130, 500]);
  const chunks = [];
  for await (const chunk of sdk.chatCompletionsChunks({
    messages: [{ role: "user", content: "the private prompt" }],
  })) {
    chunks.push(chunk);
  }
  assert.equal(chunks.length, 1);
  assert.equal(sink.events.length, 1);
  assert.deepEqual(sink.events[0], {
    age_ms: 0,
    plane: "inference",
    endpoint: "chat_completions",
    method: "POST",
    streaming: true,
    provider_pinned: false,
    model: "trustedrouter/auto",
    attempts: [
      {
        index: 0,
        host: "apex",
        outcome: "ok",
        http_status: 200,
        error_class: null,
        error_source: null,
        should_retry: "absent",
        retry_after_ms: null,
        elapsed_ms: 40,
        ttfb_ms: 40,
        request_id: REQUEST_ID,
        moved: false,
      },
    ],
    final_outcome: "ok",
    final_http_status: 200,
    total_ms: 500,
    ttft_ms: 130,
    failover_used: false,
    timeout_phase: "none",
    configured_timeout_ms: null,
  });
  assert.deepEqual(sink.counters, [
    [
      ["request", "chat_completions", true, "apex", "ok", null, "2xx", "none", false, false],
      {
        requests: 1,
        attempts: 1,
        failover_used: 0,
        first_attempt_success: 1,
        total_ms_hist: { lt800: 1 },
        first_event_ms_hist: { lt200: 1 },
      },
    ],
    [
      ["attempt", "chat_completions", true, "apex", "ok", null, "2xx", "none", false, false],
      { requests: 1, attempts: 1, failover_used: 0, first_attempt_success: 0 },
    ],
  ]);
  // Content-free by construction: the prompt is nowhere in the record.
  assert.ok(!JSON.stringify([sink.events, sink.counters]).includes("private prompt"));
});

test("responsesEvents reports ttft through the event decoder too", async () => {
  const { sdk, sink } = clientWith(async () =>
    sseResponse(['event: response.created\ndata: {"type":"response.created"}\n\n', DONE_FRAME]),
  );
  sdk._telemetryNow = scriptedClock([0, 10, 75, 90]);
  const events = [];
  for await (const event of sdk.responsesEvents({ input: "hi" })) events.push(event);
  assert.equal(events.length, 1);
  assert.equal(sink.events[0].endpoint, "responses");
  assert.equal(sink.events[0].ttft_ms, 75);
  assert.equal(sink.events[0].streaming, true);
});

test("a stream that breaks mid-body records stream_broken, keeping the status and ttft", async () => {
  const reset = resetError();
  const { sdk, sink } = clientWith(async () => brokenBodyResponse([FIRST_FRAME], reset));
  const chunks = [];
  await assert.rejects(
    async () => {
      for await (const chunk of sdk.chatCompletionsChunks({ messages: [] })) chunks.push(chunk);
    },
    (error) => error === reset,
  );
  assert.equal(chunks.length, 1, "the bytes before the break are still surfaced");
  assert.equal(sink.events.length, 1);
  const event = sink.events[0];
  assert.equal(event.final_outcome, "stream_broken");
  assert.equal(event.final_http_status, 200);
  assert.notEqual(event.ttft_ms, null);
  assert.equal(event.attempts.length, 1, "a broken open stream never reconnects");
  assert.equal(event.attempts[0].outcome, "stream_broken");
  assert.equal(event.attempts[0].error_class, "reset");
  assert.equal(event.attempts[0].http_status, 200);
  assert.equal(event.timeout_phase, "none");
  assert.deepEqual(
    sink.counters.map(([key]) => key),
    [
      ["request", "chat_completions", true, "apex", "stream_broken", "reset", "2xx", "none", false, false],
      ["attempt", "chat_completions", true, "apex", "stream_broken", "reset", "2xx", "none", false, false],
    ],
  );
});

test("a body that fails before any event is a transport_error with the status kept", async () => {
  const reset = resetError();
  const { sdk, sink } = clientWith(async () => brokenBodyResponse([], reset));
  await assert.rejects(async () => {
    for await (const chunk of sdk.chatCompletionsChunks({ messages: [] })) void chunk;
  });
  const event = sink.events[0];
  assert.equal(event.final_outcome, "transport_error");
  assert.equal(event.attempts[0].http_status, 200);
  assert.equal(event.attempts[0].ttfb_ms !== null, true);
  assert.equal(event.ttft_ms, null);
});

test("a read timeout after the first event is a stalled stream: timeout, idle, stream_stalled", async () => {
  const stalled = new TypeError("fetch failed", {
    cause: Object.assign(new Error("Body Timeout Error"), { code: "UND_ERR_BODY_TIMEOUT" }),
  });
  const { sdk, sink } = clientWith(async () => brokenBodyResponse([FIRST_FRAME], stalled));
  await assert.rejects(async () => {
    for await (const chunk of sdk.chatCompletionsChunks({ messages: [] })) void chunk;
  });
  const event = sink.events[0];
  assert.equal(event.final_outcome, "timeout");
  assert.equal(event.timeout_phase, "idle");
  assert.equal(event.attempts[0].error_class, "stream_stalled");
  assert.equal(sink.counters[0][0][7], "idle");
  // No SDK idle timeout is configured, so the floor cannot be met.
  assert.equal(sink.counters[0][0][8], false);
});

test("a consumer that stops reading an open stream records aborted", async () => {
  const { sdk, sink } = clientWith(async () => sseResponse([FIRST_FRAME, SECOND_FRAME, DONE_FRAME]));
  for await (const chunk of sdk.chatCompletionsChunks({ messages: [] })) {
    assert.ok(chunk);
    break;
  }
  assert.equal(sink.events.length, 1);
  const event = sink.events[0];
  assert.equal(event.final_outcome, "aborted");
  assert.equal(event.attempts[0].outcome, "aborted");
  assert.equal(event.attempts[0].http_status, 200);
  assert.equal(event.attempts[0].error_class, null);
  assert.equal(sink.counters[0][0][4], "aborted");
});

test("a caller abort mid-stream records aborted with the caller's facts intact", async () => {
  const controller = new AbortController();
  const reason = new Error("caller stopped mid-stream");
  const { sdk, sink } = clientWith(async (url, init) => {
    const signal = init.signal;
    const body = new ReadableStream({
      start(streamController) {
        streamController.enqueue(encoder.encode(FIRST_FRAME));
        signal?.addEventListener("abort", () => streamController.error(signal.reason), {
          once: true,
        });
      },
    });
    return new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream", "x-request-id": REQUEST_ID },
    });
  });
  const chunks = [];
  let thrown = null;
  try {
    for await (const chunk of sdk.chatCompletionsChunks({
      messages: [],
      signal: controller.signal,
    })) {
      chunks.push(chunk);
      controller.abort(reason);
    }
  } catch (error) {
    thrown = error;
  }
  assert.equal(thrown, reason);
  assert.equal(chunks.length, 1);
  const event = sink.events[0];
  assert.equal(event.final_outcome, "aborted");
  assert.equal(event.attempts[0].request_id, REQUEST_ID);
  assert.equal(event.attempts[0].http_status, 200);
  assert.notEqual(event.ttft_ms, null);
});

test("a caller cancellation before any response is aborted, never a host fact", async () => {
  const controller = new AbortController();
  const reason = new Error("caller stopped");
  const { sdk, sink } = clientWith(
    (url, init) =>
      new Promise((resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
        setTimeout(() => controller.abort(reason), 5);
      }),
  );
  await assert.rejects(
    sdk.request("POST", "/embeddings", { body: { model: "m", input: "x" }, signal: controller.signal }),
    (error) => error === reason,
  );
  assert.equal(sink.events.length, 1);
  const event = sink.events[0];
  assert.equal(event.final_outcome, "aborted");
  assert.equal(event.attempts.length, 1);
  assert.deepEqual(
    event.attempts[0],
    {
      index: 0,
      host: "apex",
      outcome: "aborted",
      http_status: null,
      error_class: null,
      error_source: null,
      should_retry: "absent",
      retry_after_ms: null,
      elapsed_ms: event.attempts[0].elapsed_ms,
      ttfb_ms: null,
      request_id: null,
      moved: false,
    },
  );
  assert.equal(sink.counters[0][0][4], "aborted");
});

test("the SDK timeout option records a total-phase timeout with the configured deadline", async () => {
  const { sdk, sink } = clientWith(
    (url, init) =>
      new Promise((resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      }),
  );
  await assert.rejects(
    sdk.request("POST", "/embeddings", { body: { model: "m", input: "x" }, timeout: 40 }),
    (error) => error.name === "AbortError",
  );
  assert.equal(sink.events.length, 1);
  const event = sink.events[0];
  assert.equal(event.final_outcome, "timeout");
  assert.equal(event.timeout_phase, "total");
  assert.equal(event.configured_timeout_ms, 40);
  assert.equal(event.attempts.length, 1);
  assert.equal(event.attempts[0].outcome, "timeout");
  assert.equal(event.attempts[0].error_class, "unknown");
  assert.equal(event.attempts[0].http_status, null);
  assert.deepEqual(sink.counters[0][0], [
    "request", "embeddings", false, "apex", "timeout", "unknown", "none", "total", false, false,
  ]);
});

test("the SDK timeout firing mid-body keeps the status and is still the total phase", async () => {
  const { sdk, sink } = clientWith(async (url, init) => {
    const signal = init.signal;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(FIRST_FRAME));
        signal?.addEventListener("abort", () => controller.error(signal.reason), { once: true });
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  });
  await assert.rejects(async () => {
    for await (const chunk of sdk.chatCompletionsChunks({ messages: [], timeout: 40 })) void chunk;
  }, (error) => error.name === "AbortError");
  const event = sink.events[0];
  assert.equal(event.final_outcome, "timeout");
  assert.equal(event.timeout_phase, "total");
  assert.equal(event.attempts[0].http_status, 200);
  assert.notEqual(event.ttft_ms, null);
});

test("spent retries qualify the final outcome as exhausted; counters keep the attempt's own outcome", async () => {
  let calls = 0;
  const { sdk, sink } = clientWith(async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: { message: "down" } }), {
      status: 503,
      headers: { "content-type": "application/json", "x-request-id": REQUEST_ID },
    });
  });
  await assert.rejects(sdk.request("GET", "/models"));
  assert.equal(calls, 2);
  assert.equal(sink.events.length, 1);
  const event = sink.events[0];
  assert.equal(event.final_outcome, "exhausted");
  assert.equal(event.final_http_status, 503);
  assert.equal(event.failover_used, true);
  assert.equal(event.attempts.length, 2);
  assert.equal(event.attempts[0].moved, true);
  assert.equal(event.attempts[0].host, "apex");
  assert.equal(event.attempts[1].host, "ally");
  assert.equal(event.attempts[1].request_id, REQUEST_ID);
  assert.deepEqual(sink.counters, [
    [
      ["request", "models", false, "ally", "http_error", null, "5xx", "none", false, false],
      {
        requests: 1,
        attempts: 2,
        failover_used: 1,
        first_attempt_success: 0,
        total_ms_hist: sink.counters[0][1].total_ms_hist,
        first_event_ms_hist: sink.counters[0][1].first_event_ms_hist,
      },
    ],
    [
      ["attempt", "models", false, "apex", "http_error", null, "5xx", "none", false, false],
      { requests: 1, attempts: 1, failover_used: 1, first_attempt_success: 0 },
    ],
    [
      ["attempt", "models", false, "ally", "http_error", null, "5xx", "none", false, false],
      { requests: 1, attempts: 1, failover_used: 0, first_attempt_success: 0 },
    ],
  ]);
});

test("spent transport retries are exhausted too, with the first error class on the request row", async () => {
  const { sdk, sink } = clientWith(async () => {
    throw resetError();
  });
  await assert.rejects(sdk.request("GET", "/models"));
  const event = sink.events[0];
  assert.equal(event.final_outcome, "exhausted");
  assert.equal(event.final_http_status, null);
  assert.equal(event.attempts.length, 2);
  assert.deepEqual(
    event.attempts.map((attempt) => [attempt.host, attempt.outcome, attempt.error_class]),
    [["apex", "transport_error", "reset"], ["ally", "transport_error", "reset"]],
  );
  assert.deepEqual(sink.counters[0][0], [
    "request", "models", false, "ally", "transport_error", "reset", "none", "none", false, false,
  ]);
});

test("a single terminal failure is never exhausted", async () => {
  const { sdk, sink } = clientWith(async () => new Response("{}", { status: 400 }));
  await assert.rejects(sdk.request("GET", "/models"));
  assert.equal(sink.events[0].final_outcome, "http_error");
  assert.equal(sink.events[0].attempts.length, 1);

  // A non-replayable POST (no idempotency key) after a post-send failure is
  // surfaced without a retry: one attempt, transport_error, not exhausted.
  const { sdk: unkeyed, sink: unkeyedSink } = clientWith(async () => {
    throw resetError();
  });
  await assert.rejects(unkeyed.request("POST", "/embeddings", { body: { model: "m", input: "x" } }));
  assert.equal(unkeyedSink.events[0].final_outcome, "transport_error");
  assert.equal(unkeyedSink.events[0].attempts.length, 1);
});

test("per-attempt response facts: should_retry, retry_after_ms, request_id, provider_pinned, model", async () => {
  let calls = 0;
  const { sdk, sink } = clientWith(async () => {
    calls += 1;
    if (calls === 1) {
      return new Response("{}", {
        status: 503,
        headers: { "x-should-retry": "true", "retry-after": "0.25" },
      });
    }
    return okJson({ ok: true }, { "x-request-id": REQUEST_ID, "x-should-retry": "nonsense" });
  });
  assert.deepEqual(
    await sdk.request("POST", "/chat/completions", {
      body: { model: "model/a", messages: [], provider: { allow_fallbacks: false } },
      idempotencyKey: "caller-key",
    }),
    { ok: true },
  );
  const event = sink.events[0];
  assert.equal(event.provider_pinned, true);
  assert.equal(event.model, "model/a");
  assert.equal(event.final_outcome, "ok");
  assert.equal(event.attempts[0].should_retry, "true");
  assert.equal(event.attempts[0].retry_after_ms, 250);
  assert.equal(event.attempts[0].moved, true);
  assert.equal(event.attempts[1].should_retry, "absent");
  assert.equal(event.attempts[1].request_id, REQUEST_ID);
  assert.equal(event.attempts[1].retry_after_ms, null);
  assert.equal(sink.counters[0][0][9], true, "provider_pinned is part of the counter key");
  assert.equal(sink.counters[0][1].first_attempt_success, 0);
  assert.equal(sink.counters[0][1].failover_used, 1);
});

test("an out-of-grammar model and a malformed request id are null, never free text", async () => {
  const { sdk, sink } = clientWith(async () =>
    okJson({ ok: true }, { "x-request-id": "req_not-an-rlog-id" }),
  );
  await sdk.request("POST", "/embeddings", {
    body: { model: "model with spaces and ünïcode", input: "x" },
  });
  assert.equal(sink.events[0].model, null);
  assert.equal(sink.events[0].attempts[0].request_id, null);
});

test("only GET and POST are recorded; control-plane calls and custom bases default to nothing", async () => {
  const { sdk, sink } = clientWith(async () => okJson());
  await sdk.request("DELETE", "/embeddings/abc");
  await sdk.request("PATCH", "/embeddings/abc", { body: { model: "m" } });
  assert.equal(sink.events.length, 0, "schema allows only GET|POST (doc §5.3 is a bug)");
  await sdk.models();
  await sdk.credits();
  assert.equal(sink.events.length, 0, "never for control-plane calls");
  await sdk.request("GET", "/models?open_weights=true");
  assert.equal(sink.events.length, 1);
  assert.equal(sink.events[0].endpoint, "models");
  assert.equal(sink.events[0].method, "GET");

  const custom = new TrustedRouter({
    apiKey: "sk-test",
    baseUrl: "https://my.internal/v1",
    fetchImpl: async () => okJson(),
  });
  await custom.request("POST", "/embeddings", { body: { model: "m", input: "x" } });
  assert.equal(custom._telemetrySink, null, "no reporter for a custom base by default");
});

test("a custom base forced on records host custom and never the hostname", async () => {
  const { sdk, sink } = clientWith(async () => okJson(), { baseUrl: "https://my.internal/v1" });
  await sdk.request("POST", "/embeddings", { body: { model: "m", input: "x" } });
  assert.equal(sink.events.length, 1);
  assert.equal(sink.events[0].attempts[0].host, "custom");
  assert.equal(sink.counters[0][0][3], "custom");
  assert.ok(!JSON.stringify([sink.events, sink.counters]).includes("my.internal"));
});

test("opted-out and default-off clients never create a reporter or a record", async () => {
  const off = new TrustedRouter({ apiKey: "sk-test", fetchImpl: async () => okJson(), telemetry: false });
  await off.request("POST", "/embeddings", { body: { model: "m", input: "x" } });
  assert.equal(off._telemetrySink, null);
  const saved = { ...process.env };
  try {
    delete process.env.TRUSTEDROUTER_TELEMETRY;
    process.env.DO_NOT_TRACK = "1";
    const dnt = new TrustedRouter({ apiKey: "sk-test", fetchImpl: async () => okJson() });
    await dnt.request("POST", "/embeddings", { body: { model: "m", input: "x" } });
    assert.equal(dnt.telemetryEnabled, false);
    assert.equal(dnt._telemetrySink, null);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});

test("a throwing sink never fails the request", async () => {
  const sink = {
    onRequest() {
      throw new Error("sink exploded");
    },
  };
  const sdk = new TrustedRouter({
    apiKey: "sk-test",
    fetchImpl: async () => okJson(),
    telemetry: true,
    _telemetrySink: sink,
  });
  assert.deepEqual(await sdk.request("POST", "/embeddings", { body: { model: "m", input: "x" } }), {
    ok: true,
  });
});

test("the record is emitted exactly once per logical call, after the body settles", async () => {
  const { sdk, sink } = clientWith(async () => okJson({ ok: true }));
  const response = await sdk.rawRequest("POST", "/embeddings", { body: { model: "m", input: "x" } });
  assert.equal(sink.events.length, 0, "headers alone do not finish the record");
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(sink.events.length, 1);
  await assert.rejects(response.json(), TypeError);
  assert.equal(sink.events.length, 1, "a second read never emits a second record");

  // A bodiless response settles at once.
  const { sdk: head, sink: headSink } = clientWith(async () => new Response(null, { status: 204 }));
  await head.rawRequest("POST", "/embeddings", { body: { model: "m", input: "x" } });
  assert.equal(headSink.events.length, 1);
  assert.equal(headSink.events[0].final_http_status, 204);
});

test("an HTTP error body that is read to the end is http_error, not a transport failure", async () => {
  const { sdk, sink } = clientWith(async () =>
    new Response(JSON.stringify({ error: { message: "nope" } }), {
      status: 400,
      headers: { "content-type": "application/json" },
    }),
  );
  await assert.rejects(async () => {
    for await (const chunk of sdk.chatCompletionsChunks({ messages: [] })) void chunk;
  });
  assert.equal(sink.events[0].final_outcome, "http_error");
  assert.equal(sink.events[0].final_http_status, 400);
  assert.equal(sink.counters[0][0][6], "4xx");
});

// ---- unit: the closed helpers and the recorder's own guards ------------------

test("endpointEnum, latencyBucket, statusClass and timeoutFloorMet are closed", () => {
  assert.equal(endpointEnum("/chat/completions"), "chat_completions");
  assert.equal(endpointEnum("chat/completions?stream=true"), "chat_completions");
  assert.equal(endpointEnum("//messages/"), "messages");
  assert.equal(endpointEnum("/responses"), "responses");
  assert.equal(endpointEnum("/responses/input_tokens"), "inference_other");
  assert.equal(endpointEnum("/embeddings"), "embeddings");
  assert.equal(endpointEnum("/images/generations"), "images");
  assert.equal(endpointEnum("/videos"), "videos");
  assert.equal(endpointEnum("/models?open_weights=true"), "models");
  assert.equal(endpointEnum("/modelsx"), "inference_other");
  assert.equal(endpointEnum("/fusion/run"), "fusion");
  assert.equal(endpointEnum("/"), "inference_other");
  assert.equal(endpointEnum(""), "inference_other");
  assert.equal(endpointEnum(null), "inference_other");

  assert.equal(latencyBucket(0), "lt100");
  assert.equal(latencyBucket(99), "lt100");
  assert.equal(latencyBucket(100), "lt200");
  assert.equal(latencyBucket(102_399), "lt102400");
  assert.equal(latencyBucket(102_400), "ge102400");
  assert.equal(latencyBucket(-5), "lt100");
  assert.equal(latencyBucket(NaN), "lt100");

  assert.equal(statusClass(null), "none");
  assert.equal(statusClass(200), "2xx");
  assert.equal(statusClass(299), "2xx");
  assert.equal(statusClass(404), "4xx");
  assert.equal(statusClass(429), "429");
  assert.equal(statusClass(503), "5xx");
  assert.equal(statusClass(302), "none");
  assert.equal(statusClass(600), "none");

  assert.equal(timeoutFloorMet("connect", 10_000), true);
  assert.equal(timeoutFloorMet("connect", 9_999), false);
  assert.equal(timeoutFloorMet("first_byte", 60_000), true);
  assert.equal(timeoutFloorMet("idle", 30_000), true);
  assert.equal(timeoutFloorMet("total", 3_600_000), false);
  assert.equal(timeoutFloorMet("none", 3_600_000), false);
  assert.equal(timeoutFloorMet("connect", null), false);
});

test("finish is idempotent and a recorder with no attempts emits nothing", () => {
  const sink = new RecordingSink();
  const recorder = new RequestRecorder({ sink, endpoint: "embeddings", method: "POST", now: () => 0 });
  recorder.finish({ exhausted: false });
  recorder.finish({ exhausted: true });
  assert.equal(sink.events.length, 0);

  const begun = new RequestRecorder({ sink, endpoint: "embeddings", method: "POST", now: () => 0 });
  begun.beginAttempt("https://api.trustedrouter.com/v1");
  begun.finish();
  assert.equal(sink.events.length, 0, "an attempt that never concluded is not a record");

  const done = new RequestRecorder({ sink, endpoint: "embeddings", method: "POST", now: () => 0 });
  done.beginAttempt("https://api.trustedrouter.com/v1");
  done.onResponse(200);
  done.finish();
  done.finish();
  assert.equal(sink.events.length, 1);
  assert.equal(sink.counters.length, 2);
});

test("an unknown endpoint or method is never recorded, and a bad timeout is null", () => {
  const sink = new RecordingSink();
  for (const options of [
    { endpoint: "webhooks", method: "POST" },
    { endpoint: "embeddings", method: "PUT" },
  ]) {
    const recorder = new RequestRecorder({ sink, now: () => 0, ...options });
    recorder.beginAttempt("https://api.trustedrouter.com/v1");
    recorder.onResponse(200);
    recorder.finish();
  }
  assert.equal(sink.events.length, 0);
  for (const [configured, expected] of [
    [null, null],
    [0, null],
    [-1, null],
    [NaN, null],
    [0.4, 1],
    [1500.9, 1500],
    [1e12, 3_600_000],
  ]) {
    assert.equal(
      new RequestRecorder({ configuredTimeoutMs: configured }).configuredTimeoutMs,
      expected,
      `timeout ${configured}`,
    );
  }
});

test("bounded recorder history still produces exact counters past attempt index 99", () => {
  const sink = new RecordingSink();
  const recorder = new RequestRecorder({
    sink,
    endpoint: "embeddings",
    method: "POST",
    now: () => 0,
  });
  const reset = Object.assign(new Error("reset"), { code: "ECONNRESET" });
  for (let index = 0; index < 5_000; index += 1) {
    recorder.beginAttempt("https://api.trustedrouter.com/v1");
    recorder.onTransportError(reset);
  }
  recorder.finish({ exhausted: true });

  assert.ok(recorder.attempts.length <= 100);
  assert.equal(sink.events[0].final_outcome, "exhausted");
  assert.equal(sink.counters[0][1].attempts, 5_000);
  assert.deepEqual(sink.counters[1][0], [
    "attempt", "embeddings", false, "apex", "transport_error", "reset", "none", "none", false, false,
  ]);
  assert.deepEqual(sink.counters[1][1], {
    requests: 5_000,
    attempts: 5_000,
    failover_used: 0,
    first_attempt_success: 0,
  });
});
