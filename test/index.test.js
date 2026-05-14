import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTO_MODEL,
  DEFAULT_API_BASE_URL,
  TrustedRouter,
  TrustedRouterError,
} from "../src/index.js";

test("normalizes base URL and sends bearer token", async () => {
  const calls = [];
  const client = new TrustedRouter({
    apiKey: "sk-tr-test",
    baseUrl: `${DEFAULT_API_BASE_URL}/`,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  assert.equal(client.baseUrl, DEFAULT_API_BASE_URL);
  assert.deepEqual(await client.models(), { data: [] });
  assert.equal(calls[0].url, `${DEFAULT_API_BASE_URL}/models`);
  assert.equal(calls[0].init.headers.get("authorization"), "Bearer sk-tr-test");
});

test("sends default and per-call workspace selectors", async () => {
  const seen = [];
  const client = new TrustedRouter({
    apiKey: "sk-tr-test",
    workspaceId: "ws_default",
    fetchImpl: async (_url, init) => {
      seen.push(init.headers.get("x-trustedrouter-workspace"));
      return new Response(JSON.stringify({ data: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  await client.credits();
  await client.credits({ workspaceId: "ws_override" });

  assert.deepEqual(seen, ["ws_default", "ws_override"]);
});

test("raises TrustedRouterError for OpenRouter-shaped errors", async () => {
  const client = new TrustedRouter({
    fetchImpl: async () =>
      new Response(JSON.stringify({ error: { message: "bad key" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
  });

  await assert.rejects(client.models(), (error) => {
    assert.ok(error instanceof TrustedRouterError);
    assert.equal(error.statusCode, 401);
    assert.equal(error.message, "bad key");
    return true;
  });
});

test("defaults chat to trustedrouter auto and exposes region/provider helpers", async () => {
  const calls = [];
  const client = new TrustedRouter({
    apiKey: "sk-tr-test",
    fetchImpl: async (url, init) => {
      calls.push({
        url,
        init,
        body: init.body ? JSON.parse(init.body) : undefined,
      });
      if (url.endsWith("/regions")) {
        return new Response(
          JSON.stringify({
            data: [{ id: "us-central1" }, { id: "europe-west4" }],
          }),
        );
      }
      if (url.endsWith("/providers")) {
        return new Response(JSON.stringify({ data: [{ id: "vertex" }] }));
      }
      return new Response(JSON.stringify({ ok: true }));
    },
  });

  assert.equal(AUTO_MODEL, "trustedrouter/auto");
  await client.chatCompletions({
    messages: [{ role: "user", content: "hello" }],
  });
  assert.equal(calls[0].body.model, AUTO_MODEL);
  assert.equal((await client.regions()).data[1].id, "europe-west4");
  assert.equal((await client.providers()).data[0].id, "vertex");
});

test("stablecoin checkout and auth helpers send expected API bodies", async () => {
  const calls = [];
  const client = new TrustedRouter({
    apiKey: "session",
    fetchImpl: async (url, init) => {
      calls.push({
        url,
        method: init.method,
        body: init.body ? JSON.parse(init.body) : undefined,
      });
      return new Response(JSON.stringify({ data: { ok: true } }));
    },
  });

  await client.stablecoinCheckout({ amount: 25, workspaceId: "ws_1" });
  await client.authSession();
  await client.logout();

  assert.deepEqual(calls[0], {
    url: `${DEFAULT_API_BASE_URL}/billing/checkout`,
    method: "POST",
    body: { amount: 25, payment_method: "stablecoin", workspace_id: "ws_1" },
  });
  assert.equal(calls[1].url, `${DEFAULT_API_BASE_URL}/auth/session`);
  assert.deepEqual(calls[2], {
    url: `${DEFAULT_API_BASE_URL}/auth/logout`,
    method: "POST",
    body: undefined,
  });
});

test("chatCompletionsText yields parsed SSE text deltas", async () => {
  const client = new TrustedRouter({
    apiKey: "sk-tr-test",
    fetchImpl: async () =>
      new Response(
        [
          'data: {"choices":[{"delta":{"content":"hel"}}]}',
          "",
          'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}]}',
          "",
          "data: [DONE]",
          "",
        ].join("\n"),
        { headers: { "content-type": "text/event-stream" } },
      ),
  });

  const tokens = [];
  for await (const token of client.chatCompletionsText({
    messages: [{ role: "user", content: "hi" }],
  })) {
    tokens.push(token);
  }
  assert.deepEqual(tokens, ["hel", "lo"]);
});

test("request fails over to regional endpoint on 503", async () => {
  const hosts = [];
  const client = new TrustedRouter({
    apiKey: "sk-tr-test",
    maxRetries: 1,
    regionalFailover: true,
    failoverRegions: ["europe-west4"],
    fetchImpl: async (url) => {
      hosts.push(new URL(url).host);
      if (hosts.length === 1) {
        return new Response(JSON.stringify({ error: { message: "down" } }), {
          status: 503,
          headers: { "content-type": "application/json", "retry-after": "0" },
        });
      }
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  assert.deepEqual(await client.models(), { data: [] });
  assert.deepEqual(hosts, [
    "api.quillrouter.com",
    "api-europe-west4.quillrouter.com",
  ]);
});

test("streaming rawRequest fails over before returning error response", async () => {
  const hosts = [];
  const idempotencyKeys = [];
  const client = new TrustedRouter({
    apiKey: "sk-tr-test",
    maxRetries: 1,
    regionalFailover: true,
    failoverRegions: ["europe-west4"],
    fetchImpl: async (url, init) => {
      hosts.push(new URL(url).host);
      idempotencyKeys.push(new Headers(init.headers).get("idempotency-key"));
      if (hosts.length === 1) {
        return new Response("regional gateway unavailable", { status: 503 });
      }
      return new Response(
        'data: {"choices":[{"delta":{"content":"OK"}}]}\n\n',
        {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        },
      );
    },
  });

  const tokens = [];
  for await (const token of client.chatCompletionsText({
    messages: [{ role: "user", content: "hi" }],
  })) {
    tokens.push(token);
  }

  assert.deepEqual(tokens, ["OK"]);
  assert.deepEqual(hosts, [
    "api.quillrouter.com",
    "api-europe-west4.quillrouter.com",
  ]);
  assert.match(idempotencyKeys[0], /^tr-req-/);
  assert.deepEqual(idempotencyKeys, [idempotencyKeys[0], idempotencyKeys[0]]);
});
