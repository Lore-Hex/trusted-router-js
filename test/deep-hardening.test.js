import assert from "node:assert/strict";
import test from "node:test";

import {
  InternalError,
  TrustedRouter,
  TrustedRouterError,
  collectCompletion,
} from "../dist/index.js";

// Not about telemetry: keep this file hermetic. Without the opt-out, the
// default-on beacon reporter would be created on the first inference call
// and its own fetch would reach the real control plane at process exit.
// The telemetry suites inject sinks and fake beacon endpoints instead.
process.env.TRUSTEDROUTER_TELEMETRY = "0";

function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function chatSse(content = "ok", { finishReason = "stop", model = "model-a" } = {}) {
  return new Response(
    `data: ${JSON.stringify({
      id: "chat-1",
      model,
      choices: [{
        index: 0,
        delta: { role: "assistant", content },
        finish_reason: finishReason,
      }],
    })}\n\ndata: [DONE]\n\n`,
    { headers: { "content-type": "text/event-stream" } },
  );
}

test("malformed chat SSE is a protocol error, not a partial success", async () => {
  const client = new TrustedRouter({
    baseUrl: "https://gateway.example/v1",
    fetchImpl: async () => new Response(
      'data: {"choices":[{"index":0,"delta":{"content":"partial"}}]}\n\n' +
      "data: {not-json}\n\n",
      { headers: { "content-type": "text/event-stream" } },
    ),
  });

  await assert.rejects(
    client.chatCompletions({ messages: [{ role: "user", content: "hi" }] }),
    (error) => error instanceof InternalError && /Malformed JSON/.test(error.message),
  );
});

test("chat SSE that ends without [DONE] is a protocol error", async () => {
  const client = new TrustedRouter({
    baseUrl: "https://gateway.example/v1",
    fetchImpl: async () => new Response(
      'data: {"choices":[{"index":0,"delta":{"content":"partial"}}]}\n\n',
      { headers: { "content-type": "text/event-stream" } },
    ),
  });

  await assert.rejects(
    client.chatCompletions({ messages: [{ role: "user", content: "hi" }] }),
    (error) => error instanceof InternalError && /before data: \[DONE\]/.test(error.message),
  );
});

test("chat collection does not invent a finish reason", async () => {
  const client = new TrustedRouter({
    baseUrl: "https://gateway.example/v1",
    fetchImpl: async () => chatSse("ok", { finishReason: null }),
  });

  const completion = await client.chatCompletions({
    messages: [{ role: "user", content: "hi" }],
  });
  assert.equal(completion.choices[0].finish_reason, null);
});

test("high-level chat mints one stable idempotency key across a 503 retry", async () => {
  const keys = [];
  let calls = 0;
  const previousRandom = Math.random;
  Math.random = () => 0;
  const client = new TrustedRouter({
    baseUrl: "https://gateway.example/v1",
    maxRetries: 1,
    fetchImpl: async (_url, init) => {
      keys.push(new Headers(init.headers).get("idempotency-key"));
      calls += 1;
      if (calls === 1) return jsonResponse(503, { error: { message: "retry" } });
      return chatSse();
    },
  });

  try {
    const completion = await client.chatCompletions({
      messages: [{ role: "user", content: "hi" }],
    });
    assert.equal(completion.choices[0].message.content, "ok");
  } finally {
    Math.random = previousRandom;
  }
  assert.equal(keys.length, 2);
  assert.match(keys[0], /^tr-req-/);
  assert.equal(keys[1], keys[0]);
});

test("generic unkeyed POST does not retry an ambiguous post-send disconnect", async () => {
  let calls = 0;
  const client = new TrustedRouter({
    baseUrl: "https://gateway.example/v1",
    maxRetries: 2,
    fetchImpl: async () => {
      calls += 1;
      throw new TypeError("fetch failed", {
        cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }),
      });
    },
  });

  await assert.rejects(
    client.request("POST", "/mutate", { body: { value: 1 } }),
    InternalError,
  );
  assert.equal(calls, 1);
});

test("generic unkeyed POST may retry a definite pre-connect failure", async () => {
  let calls = 0;
  const previousRandom = Math.random;
  Math.random = () => 0;
  const client = new TrustedRouter({
    baseUrl: "https://gateway.example/v1",
    maxRetries: 1,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        throw new TypeError("fetch failed", {
          cause: Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }),
        });
      }
      return jsonResponse(200, { ok: true });
    },
  });

  try {
    assert.deepEqual(
      await client.request("POST", "/mutate", { body: { value: 1 } }),
      { ok: true },
    );
  } finally {
    Math.random = previousRandom;
  }
  assert.equal(calls, 2);
});

test("OAuth exchange strips ambient authorization and browser credentials", async () => {
  let seen = null;
  const client = new TrustedRouter({
    apiKey: "instance-secret",
    controlBaseUrl: "https://control.example/v1",
    headers: {
      Authorization: "Bearer ambient-secret",
      "Proxy-Authorization": "Basic proxy-secret",
      Cookie: "session=secret",
      "Idempotency-Key": "stale-key",
      "X-Api-Key": "ambient-api-key",
      "X-TR-Client": "stale-telemetry",
      "X-TrustedRouter-Workspace": "stale-workspace",
    },
    fetchImpl: async (_url, init) => {
      seen = init;
      return jsonResponse(200, { key: "delegated", data: {} });
    },
  });

  assert.deepEqual(await client.exchangeOAuthKey({ code: "oauth-code" }), {
    key: "delegated",
    data: {},
  });
  const headers = new Headers(seen.headers);
  assert.equal(headers.has("authorization"), false);
  assert.equal(headers.has("proxy-authorization"), false);
  assert.equal(headers.has("cookie"), false);
  assert.equal(headers.has("idempotency-key"), false);
  assert.equal(headers.has("x-api-key"), false);
  assert.equal(headers.has("x-tr-client"), false);
  assert.equal(headers.has("x-trustedrouter-workspace"), false);
  assert.equal(seen.credentials, "omit");
  assert.equal(seen.redirect, "manual");
});

test("redirects are surfaced instead of forwarding bearer credentials cross-origin", async () => {
  let calls = 0;
  let seen = null;
  const client = new TrustedRouter({
    apiKey: "secret",
    baseUrl: "https://gateway.example/v1",
    maxRetries: 0,
    fetchImpl: async (_url, init) => {
      calls += 1;
      seen = init;
      return new Response(null, {
        status: 302,
        headers: { location: "https://attacker.example/capture" },
      });
    },
  });

  await assert.rejects(
    client.request("GET", "/models"),
    (error) => error instanceof TrustedRouterError && error.statusCode === 302,
  );
  assert.equal(calls, 1);
  assert.equal(seen.redirect, "manual");
});

test("the SDK timeout remains active while the success body is read", async () => {
  let bodyDelivered = false;
  const client = new TrustedRouter({
    baseUrl: "https://gateway.example/v1",
    fetchImpl: async (_url, init) => new Response(new ReadableStream({
      start(controller) {
        const timer = setTimeout(() => {
          bodyDelivered = true;
          controller.enqueue(new TextEncoder().encode('{"ok":true}'));
          controller.close();
        }, 1_000);
        const onAbort = () => {
          clearTimeout(timer);
          controller.error(init.signal.reason);
        };
        if (init.signal.aborted) onAbort();
        else init.signal.addEventListener("abort", onAbort, { once: true });
      },
    }), { headers: { "content-type": "application/json" } }),
  });

  const started = Date.now();
  await assert.rejects(
    client.responses({ model: "m", input: "hi", timeout: 25 }),
    (error) => error?.name === "AbortError",
  );
  assert.ok(Date.now() - started < 500);
  assert.equal(bodyDelivered, false);
});

test("the SDK timeout cancels retry backoff before another attempt", async () => {
  let calls = 0;
  const client = new TrustedRouter({
    baseUrl: "https://gateway.example/v1",
    maxRetries: 2,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse(503, { error: { message: "busy" } }, { "retry-after": "1" });
    },
  });

  const started = Date.now();
  await assert.rejects(
    client.embeddings({ model: "m", input: "hi", timeout: 25 }),
    (error) => error?.name === "AbortError",
  );
  assert.ok(Date.now() - started < 500);
  assert.equal(calls, 1);
});

test("the SDK timeout cancels waiting for regional-affinity probes", async () => {
  let inferenceCalls = 0;
  const client = new TrustedRouter({
    regionalAffinity: true,
    regionProbeTimeout: 1_000,
    fetchImpl: async (url, init) => {
      if (new URL(url).pathname === "/health") {
        return new Promise((_resolve, reject) => {
          const onAbort = () => reject(init.signal.reason);
          if (init.signal.aborted) onAbort();
          else init.signal.addEventListener("abort", onAbort, { once: true });
        });
      }
      inferenceCalls += 1;
      return jsonResponse(200, { data: [] });
    },
  });

  const started = Date.now();
  await assert.rejects(
    client.embeddings({ model: "m", input: "hi", timeout: 25 }),
    (error) => error?.name === "AbortError",
  );
  assert.ok(Date.now() - started < 500);
  assert.equal(inferenceCalls, 0);
});

test("retryable diagnostic body faults consume one attempt and retry", async () => {
  let calls = 0;
  let diagnosticCancelled = false;
  const previousRandom = Math.random;
  Math.random = () => 0;
  const client = new TrustedRouter({
    baseUrl: "https://gateway.example/v1",
    maxRetries: 1,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(new ReadableStream({
          pull() {
            // A retry implementation that drains this body would stall.
            return new Promise(() => {});
          },
          cancel() {
            diagnosticCancelled = true;
          },
        }), { status: 503 });
      }
      return jsonResponse(200, { ok: true });
    },
  });

  try {
    assert.deepEqual(await client.embeddings({
      model: "m",
      input: "hi",
      idempotencyKey: "stable-key",
    }), { ok: true });
  } finally {
    Math.random = previousRandom;
  }
  assert.equal(calls, 2);
  assert.equal(diagnosticCancelled, true);
});

test("completion collection preserves model-specific fields and all choices", () => {
  const completion = collectCompletion([
    {
      id: "chat-1",
      model: "provider/model",
      system_fingerprint: "fp-1",
      choices: [
        {
          index: 1,
          delta: { role: "assistant", content: "B", reasoning: "think-" },
          logprobs: { content: [] },
        },
        {
          index: 0,
          delta: { role: "assistant", refusal: "cannot " },
        },
      ],
    },
    {
      model: "provider/model",
      choices: [
        { index: 1, delta: { content: "!", reasoning: "more" }, finish_reason: "stop" },
        { index: 0, delta: { refusal: "help" }, finish_reason: "content_filter" },
      ],
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
    },
  ]);

  assert.equal(completion.model, "provider/model");
  assert.equal(completion.system_fingerprint, "fp-1");
  assert.deepEqual(completion.choices.map((choice) => choice.index), [0, 1]);
  assert.equal(completion.choices[0].message.refusal, "cannot help");
  assert.equal(completion.choices[0].finish_reason, "content_filter");
  assert.equal(completion.choices[1].message.content, "B!");
  assert.equal(completion.choices[1].message.reasoning, "think-more");
  assert.deepEqual(completion.choices[1].logprobs, { content: [] });
  assert.equal(completion.usage.total_tokens, 5);
});

test("completion collection aggregates ordered Synth events and summary metadata", () => {
  const panelDone = {
    event: "panel.done",
    stage: "panel",
    index: 0,
    model: "panel/top-level",
    detail: { output: "candidate", model: "panel/detail" },
  };
  const firstJudgeDone = {
    event: "judge.done",
    stage: "judge",
    index: 0,
    model: "judge/a",
    detail: { score: 0.7 },
  };
  const secondJudgeDone = {
    event: "judge.done",
    stage: "judge",
    index: 1,
    model: "judge/b",
    detail: { score: 0.9 },
  };
  const finalDone = {
    event: "final.done",
    stage: "final",
    index: 0,
    model: "final/model",
    detail: { output: "answer" },
  };

  const completion = collectCompletion([
    {
      trustedrouter: {
        request_id: "req-synth-1",
        route: { gateway: "panel-route" },
        synth: panelDone,
      },
      choices: [],
    },
    { trustedrouter: { synth: firstJudgeDone }, choices: [] },
    { trustedrouter: { synth: secondJudgeDone }, choices: [] },
    { trustedrouter: { synth: finalDone }, choices: [] },
    {
      trustedrouter: {
        trace_id: "trace-synth-1",
        route: { gateway: "final-route" },
        synth: {
          summary: { winner: "final/model", panel_size: 1 },
          total_latency_ms: 42,
        },
      },
      choices: [],
    },
    {
      id: "chat-synth",
      model: "trustedrouter/synth",
      choices: [{ index: 0, delta: { content: "done" }, finish_reason: "stop" }],
    },
  ]);

  assert.deepEqual(completion.trustedrouter, {
    request_id: "req-synth-1",
    route: { gateway: "final-route" },
    trace_id: "trace-synth-1",
    synth: {
      summary: { winner: "final/model", panel_size: 1 },
      total_latency_ms: 42,
      events: [panelDone, firstJudgeDone, secondJudgeDone, finalDone],
      panel: [{ output: "candidate", model: "panel/detail", stage: "panel", index: 0 }],
      judge_attempts: [
        { score: 0.7, stage: "judge", index: 0, model: "judge/a" },
        { score: 0.9, stage: "judge", index: 1, model: "judge/b" },
      ],
      judge: { score: 0.9, stage: "judge", index: 1, model: "judge/b" },
      final_attempts: [
        { output: "answer", stage: "final", index: 0, model: "final/model" },
      ],
    },
  });
  assert.equal(completion.choices[0].message.content, "done");
});

// Boundary audit: exercise public wire boundaries rather than trusting return-type assertions.
for (const [name, invoke, payload] of [
  ["request record", (client) => client.request("GET", "/models"), []],
  ["status record", (client) => client.status(), 7],
  ["trust record", (client) => client.trustRelease(), []],
  ["responses shape", (client) => client.responses({ input: "hello" }), { id: 7, object: "response" }],
  ["token shape", (client) => client.responsesInputTokens({ input: "hello" }), { input_tokens: [] }],
  ["userinfo shape", (client) => client.userInfo(), { data: [] }],
  ["OAuth shape", (client) => client.exchangeOAuthKey({ code: "code" }), { key: [], data: {} }],
]) {
  test(`Boundary audit: ${name}`, async () => {
    const client = new TrustedRouter({ fetchImpl: async () => jsonResponse(200, payload) });
    await assert.rejects(invoke(client), TypeError);
  });
}

test("Boundary audit: chat chunk shape is checked before yielding", async () => {
  const client = new TrustedRouter({
    fetchImpl: async () => new Response('data: {"choices":[{"delta":{"role":7}}]}\n\ndata: [DONE]\n\n'),
  });
  await assert.rejects(async () => {
    for await (const chunk of client.chatCompletionsChunks({ messages: [] })) void chunk;
  }, /Malformed chat completion chunk/);
});

test("Boundary audit: response SSE arrays cannot become object events", async () => {
  for (const prefix of ["", "event: response.output\n"]) {
    const client = new TrustedRouter({
      fetchImpl: async () => new Response(`${prefix}data: []\n\ndata: [DONE]\n\n`),
    });
    await assert.rejects(async () => {
      for await (const event of client.responsesEvents({ input: "hello" })) void event;
    }, /must not be an array/);
  }
});

test("Boundary audit: error records exclude arrays", async () => {
  const { errorMessage } = await import("../dist/internal/errors.js");
  const array = Object.assign([], { layer: "bad", message: "bad" });
  assert.equal(new TrustedRouterError(500, "error", array).layer, null);
  assert.equal(new TrustedRouterError(500, "error", { error: array, layer: "outer" }).layer, "outer");
  assert.equal(errorMessage(array), undefined);
  assert.equal(errorMessage({ error: array, message: "outer" }), "outer");
});

test("Boundary audit: completion record shapes exclude arrays", () => {
  assert.throws(() => collectCompletion([{ choices: [[]] }]), /no choices/);
  const completion = collectCompletion([{ usage: [], choices: [{ delta: {
    tool_calls: [[], { index: 1, function: ["bad"] }],
  } }] }]);
  assert.equal(Object.hasOwn(completion, "usage"), false);
  assert.equal(completion.choices[0].message.tool_calls.length, 1);
  assert.equal(Object.hasOwn(completion.choices[0].message.tool_calls[0].function, "0"), false);
});

for (const [name, path] of [
  ["envelope", []], ["choice", ["choices", 0]], ["message", ["choices", 0, "message"]],
  ["tool", ["choices", 0, "message", "tool_calls", 0]],
  ["tool function", ["choices", 0, "message", "tool_calls", 0, "function"]],
  ["function call", ["choices", 0, "message", "function_call"]],
  ["synth", ["trustedrouter", "synth"]],
]) {
  test(`Boundary audit: completion ${name} copies prototype keys as data`, () => {
    const keys = JSON.parse('{"__proto__":{"polluted":true},"constructor":"wire","toString":"wire","hasOwnProperty":"wire"}');
    const c = { choices: [{ delta: {} }] };
    const destination = {
      envelope: c,
      choice: c.choices[0],
      message: c.choices[0].delta,
      tool: (c.choices[0].delta.tool_calls = [{}])[0],
      "tool function": (c.choices[0].delta.tool_calls[0].function = {}),
      "function call": (c.choices[0].delta.function_call = {}),
      synth: (c.trustedrouter = { synth: {} }).synth,
    };
    // Own data properties, including __proto__, must survive aggregation unchanged.
    for (const [key, value] of Object.entries(keys)) Object.defineProperty(destination[name], key, { value, enumerable: true });
    let result = collectCompletion([c]);
    for (const key of path) result = result[key];
    assert.equal(Object.getPrototypeOf(result), Object.prototype);
    for (const key of Object.keys(keys)) {
      assert.equal(Object.hasOwn(result, key), true, key);
      assert.deepEqual(result[key], keys[key]);
    }
    assert.equal(result.polluted, undefined);
  });
}

test("Boundary audit: malformed error arrays cannot authorize replay", async () => {
  let calls = 0;
  const client = new TrustedRouter({
    baseUrl: "https://gateway.example/v1", maxRetries: 1,
    fetchImpl: async () => { calls++; throw Object.assign([], { code: "ENOTFOUND" }); },
  });
  await assert.rejects(client.rawRequest("POST", "/embeddings", { body: { input: "hello" } }), InternalError);
  assert.equal(calls, 1);
});

test("Boundary audit: malformed error arrays cannot impersonate cancellation", async () => {
  const client = new TrustedRouter({
    maxRetries: 0, fetchImpl: async () => { throw Object.assign([], { name: "AbortError" }); },
  });
  await assert.rejects(client.request("GET", "/models"), InternalError);
});

test("Boundary audit: transport messages narrow error records", async () => {
  const { transportError } = await import("../dist/internal/transport.js");
  assert.equal(transportError(Object.assign([], { message: "injected" })).message, "TrustedRouter endpoint unavailable: ");
  assert.equal(transportError({ message: "real" }).message, "TrustedRouter endpoint unavailable: real");
});
