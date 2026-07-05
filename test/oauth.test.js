import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_CONTROL_BASE_URL,
  TrustedRouter,
} from "../src/index.js";
import { BrowserOAuthError, BrowserOAuthFlow } from "../src/oauth.js";

const CALLBACK_URL = "https://app.example/auth/callback";

function fakeStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

test("BrowserOAuthFlow.initiate returns a url and stashes state + verifier", async () => {
  const storage = fakeStorage();
  const client = new TrustedRouter({ fetchImpl: async () => new Response() });
  const flow = new BrowserOAuthFlow(CALLBACK_URL, { client, storage });

  const { url, state } = await flow.initiate({
    keyLabel: "My App",
    limit: "5",
    usageLimitType: "monthly",
  });

  const parsed = new URL(url);
  assert.equal(
    parsed.toString().startsWith(`${DEFAULT_CONTROL_BASE_URL}/auth?`),
    true,
  );
  assert.equal(parsed.searchParams.get("key_label"), "My App");
  assert.equal(parsed.searchParams.get("limit"), "5");
  assert.equal(parsed.searchParams.get("usage_limit_type"), "monthly");
  assert.equal(parsed.searchParams.get("code_challenge_method"), "S256");
  assert.ok(parsed.searchParams.get("code_challenge"));

  // callback_url carries the embedded state.
  const callbackUrl = new URL(parsed.searchParams.get("callback_url"));
  assert.equal(callbackUrl.origin, "https://app.example");
  assert.equal(callbackUrl.searchParams.get("state"), state);

  const stored = JSON.parse(storage.getItem("_tr_oauth"));
  assert.equal(stored.state, state);
  assert.ok(typeof stored.codeVerifier === "string" && stored.codeVerifier.length > 0);
});

test("BrowserOAuthFlow.handleCallback validates state and exchanges the code", async () => {
  const storage = fakeStorage();
  let exchangeBody;
  const client = new TrustedRouter({
    apiKey: "existing-key",
    fetchImpl: async (url, init) => {
      exchangeBody = { url, method: init.method, body: JSON.parse(init.body) };
      return new Response(
        JSON.stringify({
          key: "sk-tr-v1-delegated",
          user_id: "user_1",
          identity: { sub: "user_1", email: "p@example.com", email_verified: true },
          data: { name: "My App" },
        }),
        { headers: { "content-type": "application/json" } },
      );
    },
  });
  const flow = new BrowserOAuthFlow(CALLBACK_URL, { client, storage });

  const { state } = await flow.initiate({ keyLabel: "My App" });
  const verifier = JSON.parse(storage.getItem("_tr_oauth")).codeVerifier;

  const params = new URLSearchParams({
    code: "auth_code-example",
    user_id: "user_1",
    state,
  });
  const result = await flow.handleCallback(params);

  assert.deepEqual(result, {
    key: "sk-tr-v1-delegated",
    user_id: "user_1",
    identity: { sub: "user_1", email: "p@example.com", email_verified: true },
  });
  assert.equal(exchangeBody.url, `${DEFAULT_CONTROL_BASE_URL}/auth/keys`);
  assert.equal(exchangeBody.method, "POST");
  assert.deepEqual(exchangeBody.body, {
    code: "auth_code-example",
    code_verifier: verifier,
  });
  // storage cleared after a successful exchange.
  assert.equal(storage.getItem("_tr_oauth"), null);
});

test("BrowserOAuthFlow.handleCallback rejects a mismatched state", async () => {
  const storage = fakeStorage();
  const client = new TrustedRouter({
    fetchImpl: async () => {
      throw new Error("exchange should not be called on state mismatch");
    },
  });
  const flow = new BrowserOAuthFlow(CALLBACK_URL, { client, storage });

  await flow.initiate({ keyLabel: "My App" });

  const params = new URLSearchParams({ code: "c", state: "not-the-state" });
  await assert.rejects(flow.handleCallback(params), (error) => {
    assert.ok(error instanceof BrowserOAuthError);
    assert.match(error.message, /state mismatch/);
    return true;
  });
});

test("BrowserOAuthFlow.handleCallback requires a prior initiate()", async () => {
  const storage = fakeStorage();
  const client = new TrustedRouter({ fetchImpl: async () => new Response() });
  const flow = new BrowserOAuthFlow(CALLBACK_URL, { client, storage });

  const params = new URLSearchParams({ code: "c", state: "s" });
  await assert.rejects(flow.handleCallback(params), (error) => {
    assert.ok(error instanceof BrowserOAuthError);
    assert.match(error.message, /no pending OAuth flow/);
    return true;
  });
});

test("BrowserOAuthFlow constructor validates its arguments", () => {
  const client = new TrustedRouter({ fetchImpl: async () => new Response() });
  assert.throws(() => new BrowserOAuthFlow("", { client }), BrowserOAuthError);
  assert.throws(() => new BrowserOAuthFlow(CALLBACK_URL, {}), BrowserOAuthError);
});
