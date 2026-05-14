# TrustedRouter JavaScript SDK

[![npm version](https://img.shields.io/npm/v/@lore-hex/trusted-router?logo=npm)](https://www.npmjs.com/package/@lore-hex/trusted-router)
[![npm downloads](https://img.shields.io/npm/dm/@lore-hex/trusted-router?logo=npm)](https://www.npmjs.com/package/@lore-hex/trusted-router)
[![CI](https://github.com/Lore-Hex/trusted-router-js/actions/workflows/ci.yml/badge.svg)](https://github.com/Lore-Hex/trusted-router-js/actions/workflows/ci.yml)
[![TypeScript types](https://img.shields.io/badge/types-included-3178c6?logo=typescript&logoColor=white)](https://www.npmjs.com/package/@lore-hex/trusted-router)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Verifiable trust](https://img.shields.io/badge/trust-attested-16a34a)](https://trust.trustedrouter.com)

OpenAI-compatible JS/TS client for [TrustedRouter](https://trustedrouter.com) —
the hosted, attested LLM router that lets you point one OpenAI-shaped client
at every provider (Anthropic, OpenAI, Google Vertex, Gemini, DeepSeek,
Mistral, Cerebras) and *prove* the prompt path doesn't log.

- Gateway: `https://api.quillrouter.com/v1`
- Trust release: `https://trust.trustedrouter.com`
- Source: `https://github.com/Lore-Hex/trusted-router-js`
- License: Apache-2.0

```bash
npm install @lore-hex/trusted-router
```

Runs on Node 20+, Deno, Bun, and modern browsers — no native deps. The
attestation verifier uses the WebCrypto SubtleCrypto API.

## Quick start

```js
import { TrustedRouter, AUTO_MODEL } from "@lore-hex/trusted-router";

const client = new TrustedRouter({ apiKey: "sk-tr-v1-..." });

const resp = await client.chatCompletions({
  model: AUTO_MODEL,                  // "trustedrouter/auto" — multi-provider failover
  messages: [{ role: "user", content: "hello" }],
});

console.log(resp.choices[0].message.content);
```

`chatCompletions(...)` defaults to `AUTO_MODEL` when `model` is omitted.

## Streaming

```js
for await (const token of client.chatCompletionsText({
  messages: [{ role: "user", content: "Write a haiku" }],
})) {
  process.stdout.write(token);
}
```

`chatCompletionsChunks(...)` yields the raw OpenAI `chat.completion.chunk`
objects (with `finish_reason`, `model`, `id`) when you need more than just
the text delta. `chatCompletionsRawStream(...)` yields the underlying SSE
bytes — useful if you're writing an HTTP relay that doesn't want to parse.

## Region pinning

The gateway is deployed in `us-central1` (the apex) and `europe-west4`. Pin
to a specific region with one option:

```js
const client = new TrustedRouter({ apiKey: "sk-tr-v1-...", region: "europe-west4" });
```

The full list lives in `REGION_HOSTS`. Pass `region` for known regions, or
`baseUrl` for a custom endpoint (e.g. a self-hosted gateway). Passing both
is a configuration error.

## Typed errors

Every HTTP failure throws a typed subclass of `TrustedRouterError` so callers
can discriminate without inspecting status codes:

```js
import {
  TrustedRouter, RateLimitError, AuthenticationError,
  BadRequestError, EndpointNotSupportedError, InternalError,
} from "@lore-hex/trusted-router";

try {
  await client.chatCompletions({ messages: [...] });
} catch (err) {
  if (err instanceof RateLimitError) {
    await sleep((err.retryAfter ?? 5) * 1000);
  } else if (err instanceof AuthenticationError) {
    refreshKey();
  } else if (err instanceof BadRequestError) {
    console.warn("bad request:", err.message);
  } else if (err instanceof EndpointNotSupportedError) {
    disableOptionalFeature();
  } else if (err instanceof InternalError) {
    // auto-retried; still failing
  } else {
    throw err;
  }
}
```

All subclasses inherit `TrustedRouterError`.

## Automatic retries

By default the client retries `429` and `5xx` responses up to **2 times**
with exponential backoff + jitter (capped at 30s, honors `Retry-After`).
Disable with `maxRetries: 0`:

```js
const client = new TrustedRouter({ apiKey: "...", maxRetries: 0 });
```

## Per-call extras

Every chat method (and `request()` for ad-hoc paths) accepts:

| Option | Purpose |
|---|---|
| `apiKey` | Override the instance bearer for this call only (threadsafe) |
| `extraHeaders` | Object of headers to merge in (trace IDs, custom routing) |
| `workspaceId` | Sets `X-TrustedRouter-Workspace` for workspace-scoped management calls |
| `idempotencyKey` | Adds `Idempotency-Key:` so the gateway dedupes retries — **strongly recommended for billing** |
| `timeout` | Per-call timeout in milliseconds (uses `AbortController`) |

```js
await client.billingCheckout({
  amount: 25,
  paymentMethod: "stablecoin",
  idempotencyKey: `checkout-${userId}-${orderId}`, // never double-charge
});
```

## Attestation verification (the differentiator)

Every TrustedRouter response is generated inside a Google Confidential Space
workload. The gateway's `/attestation` endpoint mints a Google-signed JWT
that commits to the workload image digest, image reference, your nonce, and
the TLS leaf cert SHA-256. Verifying it proves the prompt path you're about
to use is the exact build the trust page advertises:

```js
import { TrustedRouter } from "@lore-hex/trusted-router";
import {
  verifyGatewayAttestation, policyFromTrustRelease,
} from "@lore-hex/trusted-router/attestation";

const client = new TrustedRouter({ apiKey: "sk-tr-v1-..." });
const policy = await policyFromTrustRelease();   // pulls live trust release

const nonce = crypto.randomUUID().replace(/-/g, "");
const jwt = await client.attestation();           // raw JWT bytes (Uint8Array)

const attestation = await verifyGatewayAttestation(jwt, {
  policy,
  nonceHex: nonce,
  // Optionally pass the live TLS cert DER bytes for extra binding.
});

console.log("verified gateway:", attestation.imageDigest);
```

`verifyGatewayAttestation()` throws `AttestationVerificationError` on any
failure — bad signature, expired JWT, wrong issuer, audience mismatch,
image_digest mismatch, image_reference mismatch, missing nonce echo, or
TLS cert mismatch. Never returns falsey for a failed verification.

## Bring your own fetch

Pass `fetchImpl` for custom transports (proxies, retries you manage,
observability hooks):

```js
const client = new TrustedRouter({
  apiKey: "...",
  fetchImpl: async (url, init) => myInstrumentedFetch(url, init),
});
```

## Other endpoints

```js
client.models();             // OpenAI-shape catalog
client.providers();          // provider list
client.regions();            // deployed regions
client.credits({ workspaceId: "ws_..." }); // current prepaid balance for a workspace
client.activity({ since: "2026-01-01", limit: 50 });
client.messages({            // Anthropic shape, preserves system + content blocks
  model: "anthropic/claude-3-5-sonnet",
  messages: [{ role: "user", content: "hi" }],
  maxTokens: 512,
});
client.billingCheckout({ amount: 25, paymentMethod: "stablecoin", idempotencyKey: "..." });
```

`client.embeddings(...)` is present for API compatibility, but the hosted
TrustedRouter route currently throws `EndpointNotSupportedError` instead of
returning fake vectors. Use `client.models()` / `/embeddings/models` to inspect
the future embedding catalog.

For routes the SDK doesn't wrap, drop down to `client.request(...)`:

```js
await client.request("GET", "/some/new/route", {
  extraHeaders: { "x-trace": "abc" },
});
```

## Contributing

```bash
npm install
npm run check        # syntax check
npm test             # node --test, ~60 tests
```

CI runs lint + tests on every push to main and PR.
