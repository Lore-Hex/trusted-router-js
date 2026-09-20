import assert from "node:assert/strict";
import test from "node:test";

import { TrustedRouter } from "../dist/index.js";

// Exercise the built transport through the client, without network or beacons.
async function requestHeaders(defaultHeaders = {}, options = {}) {
  let seen;
  const client = new TrustedRouter({
    apiKey: "default-key",
    workspaceId: "default-workspace",
    headers: defaultHeaders,
    telemetry: false,
    maxRetries: 0,
    fetchImpl: async (_url, init) => {
      seen = new Headers(init.headers);
      return new Response("{}", {
        headers: { "content-type": "application/json" },
      });
    },
  });
  await client.request("GET", "/models", options);
  return seen;
}

const headerShapes = [
  ["plain object", (pairs) => Object.fromEntries(pairs)],
  ["Headers instance", (pairs) => new Headers(pairs)],
  ["tuple array", (pairs) => pairs],
  ["iterable", function* (pairs) { yield* pairs; }],
];

for (const source of ["defaultHeaders", "headers", "extraHeaders"]) {
  for (const [shape, makeHeaders] of headerShapes) {
    test(`${source}: ${shape} normalizes mixed-case duplicates like fetch`, async () => {
      const input = makeHeaders([
        ["X-Trace-Id", " first "],
        ["x-trace-id", "second"],
        ["X-Other", "kept"],
      ]);
      const seen = source === "defaultHeaders"
        ? await requestHeaders(input)
        : await requestHeaders({}, { [source]: input });

      assert.equal(seen.get("X-TRACE-ID"), "first, second");
      assert.equal(seen.get("x-other"), "kept");
      assert.equal(seen.has("0"), false);
      assert.equal(seen.has("1"), false);
    });

    test(`${source}: ${shape} strips reserved headers after normalization`, async () => {
      const input = makeHeaders([
        ["X-Tr-ClIeNt", "caller-spoof"],
        ["X-Allowed", "kept"],
      ]);
      const seen = source === "defaultHeaders"
        ? await requestHeaders(input)
        : await requestHeaders({}, { [source]: input });

      assert.equal(seen.get("x-allowed"), "kept");
      assert.equal(seen.has("x-tr-client"), false);
    });
  }
}

test("header precedence: per-request headers override defaults case-insensitively", async () => {
  const seen = await requestHeaders(new Headers({ "X-Trace": "default" }), {
    headers: [["x-TRACE", "request"]],
  });
  assert.equal(seen.get("x-trace"), "request");
});

test("header precedence: extra headers override per-request headers and defaults", async () => {
  const seen = await requestHeaders({ "X-Trace": "default" }, {
    headers: { "x-trace": "request" },
    extraHeaders: new Headers({ "X-TRACE": "extra" }),
  });
  assert.equal(seen.get("x-trace"), "extra");
});

test("header precedence: explicit idempotency key and workspace override merged headers", async () => {
  const seen = await requestHeaders({ "Idempotency-Key": "default" }, {
    headers: { "Idempotency-Key": "request" },
    extraHeaders: new Headers({
      "Idempotency-Key": "extra",
      "X-Trustedrouter-Workspace": "extra-workspace",
    }),
    idempotencyKey: "explicit-key",
    workspaceId: "explicit-workspace",
  });
  assert.equal(seen.get("idempotency-key"), "explicit-key");
  assert.equal(seen.get("x-trustedrouter-workspace"), "explicit-workspace");
});

test("header precedence: merged authorization overrides the API key", async () => {
  const seen = await requestHeaders({ Authorization: "Bearer default-header" }, {
    headers: { authorization: "Bearer request-header" },
    extraHeaders: new Headers({ AUTHORIZATION: "Bearer extra-header" }),
    apiKey: "request-key",
  });
  assert.equal(seen.get("authorization"), "Bearer extra-header");
});

test("header precedence: API key supplies authorization only when absent", async () => {
  const defaults = await requestHeaders();
  assert.equal(defaults.get("authorization"), "Bearer default-key");
  const overrides = await requestHeaders({}, { apiKey: "request-key" });
  assert.equal(overrides.get("authorization"), "Bearer request-key");
});

test("null optional header sources preserve defaults", async () => {
  const seen = await requestHeaders({ "X-Trace": "default" }, {
    headers: null,
    extraHeaders: null,
  });
  assert.equal(seen.get("x-trace"), "default");
});

test("Boundary audit: header reader normalizes tuples and ignores inherited keys", async () => {
  const { readHeader } = await import("../dist/internal/transport.js");
  for (const key of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
    assert.equal(readHeader({}, key), null);
  }
  assert.equal(readHeader([["Retry-After", "1"], ["retry-after", "2"]], "retry-after"), "1, 2");
  assert.equal(readHeader(new Headers({ "Retry-After": "3" }), "retry-after"), "3");
  assert.equal(readHeader({ "Retry-After": "4" }, "retry-after"), "4");
  assert.equal(readHeader({ get: 42 }, "retry-after"), null);
});
