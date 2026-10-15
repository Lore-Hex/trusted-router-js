/**
 * The credential-free metadata GETs — trust release, status, attestation —
 * must stay CORS "simple" requests in a browser.
 *
 * trust.trustedrouter.com is GitHub Pages: it allows CORS on GET but answers
 * every OPTIONS preflight with 405, and that cannot be configured. A request
 * header outside the CORS safelist, such as `user-agent`, makes the browser
 * preflight, so the fetch fails before it is sent. Node applies no CORS and
 * keeps the SDK identity on those requests.
 *
 * "Browser" here means a runtime without Node's `process` global, which is how
 * the SDK tells the two apart.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { policyFromTrustRelease } from "../dist/attestation.js";
import { TrustedRouter, fetchTrustRelease, VERSION } from "../dist/index.js";

process.env.TRUSTEDROUTER_TELEMETRY = "0";

// Fetch's CORS-safelisted request-header names. content-type is safelisted
// only for three values and is never needed on a GET, so it is left out.
const SAFELISTED = new Set(["accept", "accept-language", "content-language"]);

const RELEASE = { image_digest: `sha256:${"a".repeat(64)}`, image_reference: "registry.example/gateway:release" };

// Like a browser's native fetch, it refuses to run as a method of another
// object ("Illegal invocation").
function recordingFetch(calls) {
  return async function fetch(url, init = {}) {
    if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
    calls.push({ url: String(url), method: init.method ?? "GET", headers: [...new Headers(init.headers)] });
    if (String(url).endsWith("/attestation") || String(url).includes("/attestation?")) {
      return new Response("header.payload.signature");
    }
    if (String(url).endsWith("/models")) return Response.json({ data: [] });
    return Response.json(String(url).includes("status") ? { status: "ok" } : RELEASE);
  };
}

/** Run `fn` with Node's `process` global absent, as in a browser or worker. */
async function withoutProcess(fn) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "process");
  Object.defineProperty(globalThis, "process", { value: undefined, configurable: true, writable: true });
  try {
    return await fn();
  } finally {
    Object.defineProperty(globalThis, "process", descriptor);
  }
}

/** Every metadata GET the SDK makes, through each public entry point. */
async function metadataGets(fetchImpl) {
  const client = new TrustedRouter({ fetchImpl, maxRetries: 0 });
  await fetchTrustRelease({ fetchImpl });
  await client.trustRelease();
  await policyFromTrustRelease({ fetchImpl });
  await client.status();
  await client.attestation();
  await client.attestation({ nonceHex: "ab".repeat(32) });
}

test("browser: trust release, status and attestation GETs send only CORS-safelisted headers", async () => {
  const calls = [];
  await withoutProcess(() => metadataGets(recordingFetch(calls)));
  assert.deepEqual(calls.map(({ url }) => new URL(url).host), [
    "trust.trustedrouter.com",
    "trust.trustedrouter.com",
    "trust.trustedrouter.com",
    "status.trustedrouter.com",
    "api.trustedrouter.com",
    "api.trustedrouter.com",
  ]);
  for (const { url, method, headers } of calls) {
    assert.equal(method, "GET", url);
    const unsafe = headers.map(([name]) => name).filter((name) => !SAFELISTED.has(name));
    assert.deepEqual(unsafe, [], `${url} would be preflighted`);
  }
});

test("node: the same GETs still identify the SDK", async () => {
  const calls = [];
  await metadataGets(recordingFetch(calls));
  assert.equal(calls.length, 6);
  for (const { url, headers } of calls) {
    assert.deepEqual(headers, [["user-agent", `trusted-router-js/${VERSION} node/${process.versions.node}`]], url);
  }
});

test("browser: the client calls fetchImpl without a receiver, as native fetch requires", async () => {
  const calls = [];
  const client = new TrustedRouter({ apiKey: "k", fetchImpl: recordingFetch(calls), maxRetries: 0 });
  await client.status();
  await client.attestation();
  await client.trustRelease();
  await client.models();
  assert.deepEqual(calls.map(({ url }) => new URL(url).pathname), [
    "/status.json",
    "/attestation",
    "/trust/gcp-release.json",
    "/v1/models",
  ]);
});
