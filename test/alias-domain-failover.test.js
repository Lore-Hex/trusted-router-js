import assert from "node:assert/strict";
import test from "node:test";

import { ALIAS_API_BASE_URLS, DEFAULT_API_BASE_URL, TrustedRouter } from "../src/index.js";

// The domain is a single point of failure above the whole deployment. These
// prove a client reaches a second domain when the first stops answering — which
// it could not do before, because the candidate list had a single entry and
// every advance is guarded by `baseIndex < requestBaseUrls.length - 1`.

function clientWithFetch(fetchImpl) {
  return new TrustedRouter({ apiKey: "sk-test", fetchImpl, maxRetries: 3 });
}

test("the default candidate list has more than one entry", () => {
  const sdk = clientWithFetch(async () => new Response("{}", { status: 200 }));
  assert.ok(sdk.baseUrls.length > 1, `failover cannot engage: ${JSON.stringify(sdk.baseUrls)}`);
  assert.equal(sdk.baseUrls[0], DEFAULT_API_BASE_URL);
  for (const alias of ALIAS_API_BASE_URLS) assert.ok(sdk.baseUrls.includes(alias));
});

test("a custom baseUrl is never redirected to a public alias", () => {
  const sdk = new TrustedRouter({
    apiKey: "sk-test",
    baseUrl: "https://my.internal/v1",
    fetchImpl: async () => new Response("{}", { status: 200 }),
  });
  assert.deepEqual(sdk.baseUrls, ["https://my.internal/v1"]);
});

test("a dead primary domain reaches an alias", async () => {
  const seen = [];
  const sdk = clientWithFetch(async (url) => {
    const host = new URL(url).host;
    seen.push(host);
    // A connection-level failure: nothing was written, so no server saw it and
    // moving domains cannot double-execute anything.
    if (host === "api.trustedrouter.com") throw new TypeError("fetch failed");
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const result = await sdk.request("GET", "/models");
  assert.deepEqual(result, { ok: true });
  assert.equal(seen[0], "api.trustedrouter.com", "primary must be tried first");
  assert.ok(seen.includes("api.allyrouter.com"), `never reached an alias: ${seen}`);
});

test("a 503 from the primary reaches an alias", async () => {
  const seen = [];
  const sdk = clientWithFetch(async (url) => {
    const host = new URL(url).host;
    seen.push(host);
    if (host === "api.trustedrouter.com") {
      return new Response(JSON.stringify({ error: "down" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  assert.deepEqual(await sdk.request("GET", "/models"), { ok: true });
  assert.ok(seen.includes("api.allyrouter.com"), `never reached an alias: ${seen}`);
});

test("a 500 does NOT move to another domain", async () => {
  // A 500 means a server received and processed the request. Inference is not
  // idempotent, so retrying it on another domain risks charging twice.
  const seen = [];
  const sdk = clientWithFetch(async (url) => {
    seen.push(new URL(url).host);
    return new Response(JSON.stringify({ error: "boom" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  });

  await assert.rejects(() => sdk.request("GET", "/models"));
  assert.deepEqual([...new Set(seen)], ["api.trustedrouter.com"], `leaked: ${seen}`);
});
