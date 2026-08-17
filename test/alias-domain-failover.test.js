import assert from "node:assert/strict";
import test from "node:test";

import { ALIAS_API_BASE_URLS, DEFAULT_API_BASE_URL, TrustedRouter } from "../src/index.js";

// The domain is a single point of failure above the whole deployment. These
// prove a client reaches a second domain when the first stops answering — which
// it could not do before, because the candidate list had a single entry and
// every advance is guarded by `baseIndex < requestBaseUrls.length - 1`.

function clientWithFetch(fetchImpl, options = {}) {
  return new TrustedRouter({ apiKey: "sk-test", fetchImpl, maxRetries: 3, ...options });
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
  const sdk = clientWithFetch(async (url, init) => {
    const host = new URL(url).host;
    seen.push({ host, clientHeader: init.headers.get("x-tr-client") });
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
  }, { telemetry: true });

  assert.deepEqual(await sdk.request("GET", "/models"), { ok: true });
  const hosts = seen.map(({ host }) => host);
  assert.ok(hosts.includes("api.allyrouter.com"), `never reached an alias: ${hosts}`);
  // The telemetry header channel must describe the move: the alias attempt
  // says what happened on the apex and that the candidate index advanced.
  assert.equal(seen[0].clientHeader, "v=1;a=0;s=0");
  const alias = seen.find(({ host }) => host === "api.allyrouter.com");
  assert.match(
    alias.clientHeader,
    /^v=1;a=1;po=http_error;pc=none;ph=apex;pm=\d{1,7};sm=\d{1,7};s=0;fo=1$/,
  );
  assert.ok(alias.clientHeader.length <= 160);
});

test("a 500 does NOT move to another domain", async () => {
  // A 500 means a server received and processed the request. Inference is not
  // idempotent. The caller is not charged twice (authorization is idempotent
  // per Idempotency-Key, settlement is exactly-once) but the work would run
  // again, costing TrustedRouter a second upstream generation.
  const seen = [];
  const sdk = clientWithFetch(async (url, init) => {
    seen.push({ host: new URL(url).host, header: init.headers.get("x-tr-client") });
    return new Response(JSON.stringify({ error: "boom" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }, { telemetry: true });

  await assert.rejects(() => sdk.request("GET", "/models"));
  const hosts = seen.map(({ host }) => host);
  assert.deepEqual([...new Set(hosts)], ["api.trustedrouter.com"], `leaked: ${hosts}`);
  // Every in-place retry says so on the wire: previous attempt http_error
  // on the apex, candidate index never advanced (fo=0).
  assert.equal(seen[0].header, "v=1;a=0;s=0");
  seen.slice(1).forEach(({ header }, index) => {
    assert.match(
      header,
      new RegExp(`^v=1;a=${index + 1};po=http_error;pc=none;ph=apex;pm=\\d{1,7};sm=\\d{1,7};s=0;fo=0$`),
    );
  });
});
