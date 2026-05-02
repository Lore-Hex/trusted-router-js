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
      calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
      if (url.endsWith("/regions")) {
        return new Response(JSON.stringify({ data: [{ id: "us-central1" }, { id: "europe-west4" }] }));
      }
      if (url.endsWith("/providers")) {
        return new Response(JSON.stringify({ data: [{ id: "vertex" }] }));
      }
      return new Response(JSON.stringify({ ok: true }));
    },
  });

  assert.equal(AUTO_MODEL, "trustedrouter/auto");
  await client.chatCompletions({ messages: [{ role: "user", content: "hello" }] });
  assert.equal(calls[0].body.model, AUTO_MODEL);
  assert.equal((await client.regions()).data[1].id, "europe-west4");
  assert.equal((await client.providers()).data[0].id, "vertex");
});

test("stablecoin checkout and auth helpers send expected API bodies", async () => {
  const calls = [];
  const client = new TrustedRouter({
    apiKey: "session",
    fetchImpl: async (url, init) => {
      calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined });
      return new Response(JSON.stringify({ data: { ok: true } }));
    },
  });

  await client.stablecoinCheckout({ amount: 25, workspaceId: "ws_1" });
  await client.walletChallenge("0x0000000000000000000000000000000000000001");
  await client.walletVerify({ address: "0x1", message: "m", signature: "sig" });

  assert.deepEqual(calls[0], {
    url: `${DEFAULT_API_BASE_URL}/billing/checkout`,
    method: "POST",
    body: { amount: 25, payment_method: "stablecoin", workspace_id: "ws_1" },
  });
  assert.equal(calls[1].url, `${DEFAULT_API_BASE_URL}/auth/wallet/challenge`);
  assert.deepEqual(calls[2], {
    url: `${DEFAULT_API_BASE_URL}/auth/wallet/verify`,
    method: "POST",
    body: { address: "0x1", message: "m", signature: "sig" },
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
