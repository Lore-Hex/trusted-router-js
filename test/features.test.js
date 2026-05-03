/**
 * Coverage for the v0.3 feature set added to the JS SDK:
 *   typed errors, retries, region shortcut, per-call extras
 *   (extraHeaders/idempotencyKey/timeout/apiKey/workspaceId),
 *   messages, User-Agent header, raw stream.
 *
 * No real network — every test wires a mock `fetchImpl` that records
 * the inbound request shape and returns a canned Response.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTO_MODEL,
  AuthenticationError,
  BadRequestError,
  DEFAULT_API_BASE_URL,
  EndpointNotSupportedError,
  InternalError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  REGION_HOSTS,
  TrustedRouter,
  TrustedRouterError,
  collectCompletion,
  regionBaseUrl,
} from "../src/index.js";

function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function sseResponse(body) {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

// ---- region shortcut ---------------------------------------------------

test("regionBaseUrl returns the right URL for known regions", () => {
  assert.equal(regionBaseUrl("europe-west4"), "https://api-europe-west4.quillrouter.com/v1");
  assert.equal(regionBaseUrl("us-central1"), "https://api.quillrouter.com/v1");
});

test("regionBaseUrl throws on unknown region", () => {
  assert.throws(() => regionBaseUrl("mars"), /unknown TrustedRouter region/);
});

test("REGION_HOSTS is frozen — callers can't mutate it", () => {
  assert.throws(() => { REGION_HOSTS["mars"] = "x"; }, TypeError);
});

test("constructor: region= sets baseUrl + region", () => {
  const c = new TrustedRouter({ region: "europe-west4", fetchImpl: async () => new Response() });
  assert.equal(c.baseUrl, "https://api-europe-west4.quillrouter.com/v1");
  assert.equal(c.region, "europe-west4");
});

test("constructor: passing both region and baseUrl is an error", () => {
  assert.throws(
    () => new TrustedRouter({ region: "us-central1", baseUrl: "https://x/v1", fetchImpl: async () => new Response() }),
    /OR baseUrl/,
  );
});

test("constructor: defaults to apex when neither region nor baseUrl given", () => {
  const c = new TrustedRouter({ fetchImpl: async () => new Response() });
  assert.equal(c.baseUrl, DEFAULT_API_BASE_URL);
  assert.equal(c.region, null);
});

// ---- typed errors ------------------------------------------------------

const errorCases = [
  [400, BadRequestError],
  [401, AuthenticationError],
  [403, PermissionDeniedError],
  [404, NotFoundError],
  [422, BadRequestError],
  [429, RateLimitError],
  [501, EndpointNotSupportedError],
  [500, InternalError],
  [503, InternalError],
];

for (const [status, ErrCls] of errorCases) {
  test(`status ${status} maps to ${ErrCls.name}`, async () => {
    const c = new TrustedRouter({
      apiKey: "k",
      fetchImpl: async () => jsonResponse(status, { error: { message: "boom" } }),
      maxRetries: 0,
    });
    await assert.rejects(c.models(), (err) => {
      assert.ok(err instanceof ErrCls, `expected ${ErrCls.name}, got ${err.constructor.name}`);
      assert.ok(err instanceof TrustedRouterError, "must inherit TrustedRouterError");
      assert.equal(err.statusCode, status);
      return true;
    });
  });
}

test("RateLimitError carries retryAfter from Retry-After header", async () => {
  const c = new TrustedRouter({
    apiKey: "k",
    fetchImpl: async () => jsonResponse(429, { error: { message: "slow" } }, { "retry-after": "7" }),
    maxRetries: 0,
  });
  await assert.rejects(c.models(), (err) => {
    assert.ok(err instanceof RateLimitError);
    assert.equal(err.retryAfter, 7);
    return true;
  });
});

test("RateLimitError without Retry-After header has retryAfter null", async () => {
  const c = new TrustedRouter({
    apiKey: "k",
    fetchImpl: async () => jsonResponse(429, { error: { message: "slow" } }),
    maxRetries: 0,
  });
  await assert.rejects(c.models(), (err) => {
    assert.equal(err.retryAfter, null);
    return true;
  });
});

test("non-JSON 5xx body still produces a typed InternalError", async () => {
  const c = new TrustedRouter({
    apiKey: "k",
    fetchImpl: async () => new Response("<html>down</html>", { status: 502 }),
    maxRetries: 0,
  });
  await assert.rejects(c.models(), (err) => {
    assert.ok(err instanceof InternalError);
    assert.equal(err.statusCode, 502);
    return true;
  });
});

// ---- retry middleware --------------------------------------------------

test("request retries on 429 then succeeds", async () => {
  let calls = 0;
  const c = new TrustedRouter({
    apiKey: "k",
    fetchImpl: async () => {
      calls++;
      if (calls < 3) return jsonResponse(429, { error: { message: "x" } }, { "retry-after": "0" });
      return jsonResponse(200, { data: ["ok"] });
    },
    maxRetries: 3,
  });
  const out = await c.models();
  assert.deepEqual(out, { data: ["ok"] });
  assert.equal(calls, 3);
});

test("request retries on 503 then gives up", async () => {
  let calls = 0;
  const c = new TrustedRouter({
    apiKey: "k",
    fetchImpl: async () => {
      calls++;
      return jsonResponse(503, { error: { message: "down" } }, { "retry-after": "0" });
    },
    maxRetries: 2,
  });
  await assert.rejects(c.models(), InternalError);
  assert.equal(calls, 3); // 1 initial + 2 retries
});

test("maxRetries=0 disables retry loop entirely", async () => {
  let calls = 0;
  const c = new TrustedRouter({
    apiKey: "k",
    fetchImpl: async () => {
      calls++;
      return jsonResponse(503, { error: { message: "x" } });
    },
    maxRetries: 0,
  });
  await assert.rejects(c.models(), InternalError);
  assert.equal(calls, 1);
});

test("4xx errors other than 429 are not retried", async () => {
  let calls = 0;
  const c = new TrustedRouter({
    apiKey: "k",
    fetchImpl: async () => {
      calls++;
      return jsonResponse(401, { error: { message: "x" } });
    },
    maxRetries: 5,
  });
  await assert.rejects(c.models(), AuthenticationError);
  assert.equal(calls, 1);
});

// ---- per-call extras ---------------------------------------------------

test("extraHeaders propagate to chat request", async () => {
  let seen;
  const c = new TrustedRouter({
    apiKey: "k",
    fetchImpl: async (_url, init) => {
      seen = new Headers(init.headers);
      return sseResponse(
        'data: {"choices":[{"delta":{"content":"x"},"finish_reason":"stop"}]}\n\n' +
        'data: [DONE]\n\n',
      );
    },
    maxRetries: 0,
  });
  await c.chatCompletions({
    messages: [{ role: "user", content: "hi" }],
    extraHeaders: { "x-trace-id": "abc-123" },
  });
  assert.equal(seen.get("x-trace-id"), "abc-123");
});

test("idempotencyKey is sent on billingCheckout", async () => {
  let seen;
  const c = new TrustedRouter({
    apiKey: "k",
    fetchImpl: async (_url, init) => {
      seen = new Headers(init.headers);
      return jsonResponse(200, { data: { ok: true } });
    },
  });
  await c.billingCheckout({ amount: 25, idempotencyKey: "key-123" });
  assert.equal(seen.get("idempotency-key"), "key-123");
});

test("per-call apiKey overrides instance key without mutation", async () => {
  const seenAuth = [];
  const c = new TrustedRouter({
    apiKey: "instance-key",
    fetchImpl: async (_url, init) => {
      seenAuth.push(new Headers(init.headers).get("authorization"));
      return jsonResponse(200, { data: [] });
    },
  });
  await c.request("GET", "/regions", { apiKey: "override-key" });
  await c.request("GET", "/regions");
  assert.deepEqual(seenAuth, ["Bearer override-key", "Bearer instance-key"]);
  assert.equal(c.apiKey, "instance-key", "instance key must be untouched");
});

test("per-call timeout aborts via AbortController", async () => {
  const c = new TrustedRouter({
    apiKey: "k",
    fetchImpl: async (_url, init) => {
      // Wait until the signal aborts, then throw.
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    },
    maxRetries: 0,
  });
  await assert.rejects(
    c.request("GET", "/models", { timeout: 5 }),
    (err) => err.name === "AbortError",
  );
});

// ---- embeddings + messages --------------------------------------------

test("embeddings: only sends provided optional fields", async () => {
  const bodies = [];
  const c = new TrustedRouter({
    apiKey: "k",
    fetchImpl: async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return jsonResponse(200, { data: [{ embedding: [0.1] }] });
    },
  });
  await c.embeddings({ model: "text-embed", input: "hello" });
  await c.embeddings({
    model: "text-embed",
    input: ["a", "b"],
    encodingFormat: "base64",
    dimensions: 512,
    user: "u_42",
  });
  assert.deepEqual(bodies[0], { model: "text-embed", input: "hello" });
  assert.deepEqual(bodies[1], {
    model: "text-embed",
    input: ["a", "b"],
    encoding_format: "base64",
    dimensions: 512,
    user: "u_42",
  });
});

test("embeddings: hosted 501 maps to EndpointNotSupportedError", async () => {
  const c = new TrustedRouter({
    apiKey: "k",
    fetchImpl: async () => jsonResponse(501, {
      error: { message: "Endpoint is not supported", type: "endpoint_not_supported" },
    }),
    maxRetries: 0,
  });

  await assert.rejects(
    c.embeddings({ model: "openai/gpt-4o-mini", input: "hello" }),
    EndpointNotSupportedError,
  );
});

test("messages: sends Anthropic-shape body", async () => {
  let body;
  const c = new TrustedRouter({
    apiKey: "k",
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return jsonResponse(200, { id: "msg_x" });
    },
  });
  await c.messages({
    model: "anthropic/claude-3-5-sonnet",
    messages: [{ role: "user", content: "hello" }],
    maxTokens: 64,
    system: "be helpful",
  });
  assert.equal(body.model, "anthropic/claude-3-5-sonnet");
  assert.equal(body.max_tokens, 64);
  assert.equal(body.system, "be helpful");
});

// ---- User-Agent --------------------------------------------------------

test("User-Agent header is sent on every request", async () => {
  const seenUAs = [];
  const c = new TrustedRouter({
    apiKey: "k",
    fetchImpl: async (_url, init) => {
      seenUAs.push(new Headers(init.headers).get("user-agent"));
      return jsonResponse(200, { data: [] });
    },
  });
  await c.models();
  await c.providers();
  for (const ua of seenUAs) {
    assert.ok(ua?.startsWith("trusted-router-js/"), `bad UA: ${ua}`);
  }
});

// ---- raw stream pass-through ------------------------------------------

test("chatCompletionsRawStream yields underlying SSE bytes verbatim", async () => {
  const body = 'data: {"x":1}\n\ndata: [DONE]\n\n';
  const c = new TrustedRouter({
    apiKey: "k",
    fetchImpl: async () => new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }),
    maxRetries: 0,
  });
  const collected = [];
  for await (const chunk of c.chatCompletionsRawStream({
    model: AUTO_MODEL,
    messages: [{ role: "user", content: "hi" }],
  })) {
    collected.push(chunk);
  }
  const assembled = new TextDecoder().decode(
    new Uint8Array(collected.flatMap((c) => Array.from(c))),
  );
  assert.match(assembled, /\[DONE\]/);
});

test("chatCompletionsRawStream raises typed error on 429", async () => {
  const c = new TrustedRouter({
    apiKey: "k",
    fetchImpl: async () => jsonResponse(429, { error: { message: "slow" } }, { "retry-after": "3" }),
    maxRetries: 0,
  });
  await assert.rejects(
    (async () => {
      for await (const _ of c.chatCompletionsRawStream({
        model: AUTO_MODEL, messages: [{ role: "user", content: "x" }],
      })) { void _; }
    })(),
    (err) => err instanceof RateLimitError && err.retryAfter === 3,
  );
});

// ---- collectCompletion -------------------------------------------------

test("collectCompletion: empty list yields minimal envelope", () => {
  const out = collectCompletion([]);
  assert.equal(out.object, "chat.completion");
  assert.equal(out.choices[0].message.content, "");
  assert.equal(out.choices[0].finish_reason, "stop");
});

test("collectCompletion: concatenates content deltas, propagates last id+model", () => {
  const out = collectCompletion([
    { id: "first", model: "a", choices: [{ delta: { content: "hel" } }] },
    { id: "mid", model: "b", choices: [{ delta: { content: "lo " } }] },
    { id: "last", model: "c", choices: [{ delta: { content: "world" }, finish_reason: "stop" }] },
  ]);
  assert.equal(out.id, "last");
  assert.equal(out.model, "c");
  assert.equal(out.choices[0].message.content, "hello world");
  assert.equal(out.choices[0].finish_reason, "stop");
});

test("collectCompletion: ignores chunks with no choices and non-string content", () => {
  const out = collectCompletion([
    { choices: [] },
    { /* no choices */ },
    { choices: [{ delta: { content: null } }] },
    { choices: [{ delta: { content: "ok" }, finish_reason: "length" }] },
  ]);
  assert.equal(out.choices[0].message.content, "ok");
  assert.equal(out.choices[0].finish_reason, "length");
});

// ---- Anthropic + Anthropic chat path: ensure stream= true is set ------

test("chat path body includes stream:true", async () => {
  let body;
  const c = new TrustedRouter({
    apiKey: "k",
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return sseResponse(
        'data: {"choices":[{"delta":{"content":"x"},"finish_reason":"stop"}]}\n\n' +
        "data: [DONE]\n\n",
      );
    },
    maxRetries: 0,
  });
  await c.chatCompletions({ messages: [{ role: "user", content: "x" }] });
  assert.equal(body.stream, true);
  assert.equal(body.model, AUTO_MODEL);
});
