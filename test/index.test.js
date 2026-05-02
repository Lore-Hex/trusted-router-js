import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_API_BASE_URL, TrustedRouter, TrustedRouterError } from "../src/index.js";

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
