import assert from "node:assert/strict";
import test from "node:test";

import { TrustedRouter } from "../src/index.js";

// The gateway's x-should-retry verdict overrides our status heuristics. A
// status code cannot say whether a provider already ran: a 502 from "could not
// reach the provider" and a 502 from "the generation succeeded and then
// settlement failed" are indistinguishable here, and only the second is
// dangerous to re-send.

function clientWithFetch(fetchImpl, extra = {}) {
  return new TrustedRouter({ apiKey: "sk-test", fetchImpl, maxRetries: 3, ...extra });
}

function json(body, status, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("a labelled spent 502 is not retried, and does not move domains", async () => {
  const seen = [];
  const sdk = clientWithFetch(async (url) => {
    seen.push(new URL(url).host);
    return json({ error: { message: "settlement failed" } }, 502, {
      "x-should-retry": "false",
    });
  });

  await assert.rejects(() => sdk.request("GET", "/models"));
  assert.equal(seen.length, 1, `sent ${seen.length} times: ${seen.join(", ")}`);
  assert.deepEqual([...new Set(seen)], ["api.trustedrouter.com"]);
});

test("an unlabelled 502 still fails over, so older gateways are unaffected", async () => {
  const seen = [];
  const sdk = clientWithFetch(async (url) => {
    const host = new URL(url).host;
    seen.push(host);
    if (host === "api.trustedrouter.com") return json({ error: "unavailable" }, 502);
    return json({ ok: true }, 200);
  });

  assert.deepEqual(await sdk.request("GET", "/models"), { ok: true });
  assert.ok(seen.includes("api.allyrouter.com"), `lost failover: ${seen.join(", ")}`);
});

test("a labelled-retryable 400 is retried even though the status says otherwise", async () => {
  let calls = 0;
  const sdk = clientWithFetch(async () => {
    calls += 1;
    if (calls === 1) {
      return json({ error: "transient" }, 400, { "x-should-retry": "true" });
    }
    return json({ ok: true }, 200);
  });

  assert.deepEqual(await sdk.request("GET", "/models"), { ok: true });
  assert.equal(calls, 2, "server said retry and we did not");
});

// regionalFailover used to answer two questions at once: turning it off also
// stopped retrying 502/503/504 entirely. It now governs only WHERE a retry goes.
test("a pinned client still retries in place", async () => {
  const seen = [];
  let calls = 0;
  const sdk = clientWithFetch(
    async (url) => {
      seen.push(new URL(url).host);
      calls += 1;
      if (calls === 1) return json({ error: "draining" }, 503);
      return json({ ok: true }, 200);
    },
    { regionalFailover: false },
  );

  assert.deepEqual(await sdk.request("GET", "/models"), { ok: true });
  assert.equal(calls, 2, "a pinned client should still retry a 503");
  assert.deepEqual([...new Set(seen)], ["api.trustedrouter.com"], "but must not move host");
});

test("retry-after-ms is honored and beats retry-after", async () => {
  const delays = [];
  const sdk = new TrustedRouter({
    apiKey: "sk-test",
    maxRetries: 1,
    fetchImpl: async () => {
      delays.push(Date.now());
      return json({ error: "slow down" }, 429, {
        "retry-after-ms": "10",
        "retry-after": "30",
      });
    },
  });

  const started = Date.now();
  await assert.rejects(() => sdk.request("GET", "/models"));
  // 30s would blow the test timeout; 10ms cannot. That gap is the assertion.
  assert.ok(Date.now() - started < 5000, "retry-after-ms did not win over retry-after");
  assert.equal(delays.length, 2);
});
