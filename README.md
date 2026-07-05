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

- Inference API: `https://api.trustedrouter.com/v1`
- Control API: `https://trustedrouter.com/v1`
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

## Fusion

Fan a request across a panel of models and let a judge model pick or synthesize
one answer. `fusion(...)` returns the same OpenAI-shape `chat.completion` as
`chatCompletions`. `FUSION_FREEDOM_PANEL` / `FUSION_FREEDOM_FALLBACK_JUDGES` are
the recommended most-permissive configuration.

```js
import {
  TrustedRouter,
  FUSION_FREEDOM_PANEL,
  FUSION_FREEDOM_FALLBACK_JUDGES,
} from "@lore-hex/trusted-router";

const client = new TrustedRouter({ apiKey: "sk-tr-v1-..." });

const resp = await client.fusion({
  messages: [{ role: "user", content: "explain how mRNA vaccines work" }],
  analysisModels: FUSION_FREEDOM_PANEL,   // the panel
  // omit selectionStrategy to use synthesize_non_refusals
  fallbackJudges: FUSION_FREEDOM_FALLBACK_JUDGES, // tried in order if a judge refuses/fails
});

console.log(resp.choices[0].message.content);
```

Or attach `fusionTool(...)` to any chat call yourself. `preset: "quality"` or
`"budget"` picks a built-in panel.

## Browser sign-in / delegated keys

Browser apps should not ask users to paste a full TrustedRouter key. Use
the OAuth/PKCE delegation flow to mint a limited inference key for your app,
then store that delegated key in browser storage.

```js
import { TrustedRouter } from "@lore-hex/trusted-router";

const tr = new TrustedRouter();

// Sign-in button handler.
const auth = await tr.createOAuthAuthorization({
  callbackUrl: `${location.origin}/auth/callback`,
  keyLabel: "Lore Web",
  limit: "5",
  usageLimitType: "monthly",
});

sessionStorage.setItem("tr_oauth", JSON.stringify({
  state: auth.state,
  codeVerifier: auth.codeVerifier,
}));
location.assign(auth.url);
```

On the callback page:

```js
const params = new URLSearchParams(location.search);
const saved = JSON.parse(sessionStorage.getItem("tr_oauth") || "{}");
if (params.get("state") !== saved.state) throw new Error("OAuth state mismatch");

const { key } = await new TrustedRouter().exchangeOAuthKey({
  code: params.get("code"),
  codeVerifier: saved.codeVerifier,
});

localStorage.setItem("tr_delegated_key", key);
```

`createOAuthAuthorization(...)` generates an RFC7636 S256 PKCE verifier and
challenge locally. `exchangeOAuthKey(...)` posts only the one-time code and
verifier, and deliberately omits any existing bearer key.

## Sign in with TrustedRouter

For browser SPAs, `BrowserOAuthFlow` (from `@lore-hex/trusted-router/oauth`)
wraps the lower-level helpers above: `initiate(...)` builds the authorize URL
and stashes `{ state, codeVerifier }` in `sessionStorage`, and
`handleCallback(...)` validates `state`, exchanges the `code`, and returns the
delegated `key` + verified `identity`. Then `client.userInfo()` reads the
signed-in user.

```js
import { TrustedRouter } from "@lore-hex/trusted-router";
import { BrowserOAuthFlow } from "@lore-hex/trusted-router/oauth";

const flow = new BrowserOAuthFlow(`${location.origin}/auth/callback`, {
  client: new TrustedRouter(),
});

// sign-in button:
const { url } = await flow.initiate({ keyLabel: "My App", limit: "5" });
location.assign(url);

// on /auth/callback (reads location.search; throws on state mismatch):
const { key, identity } = await flow.handleCallback();
localStorage.setItem("tr_delegated_key", key);

// later:
const { data } = await new TrustedRouter({ apiKey: key }).userInfo();
```

Full flow, endpoints, and security notes:
[Sign in with TrustedRouter](https://github.com/Lore-Hex/quill-router/blob/main/docs/sign-in-with-trustedrouter.md).

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
`baseUrl` for a custom inference endpoint (e.g. a self-hosted gateway).
Passing both is a configuration error. Metadata, OAuth, billing, credits,
activity, and broadcast helpers use the control plane at
`DEFAULT_CONTROL_BASE_URL`; override it with `controlBaseUrl` only when you
need a custom control endpoint.

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

Regional failover applies only to inference routes. Control-plane calls retry
on the configured control host without rotating through inference regions.

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
client.models();             // OpenAI-shape catalog via the control plane
client.providers();          // provider list via the control plane
client.regions();            // deployed regions via the control plane
client.credits({ workspaceId: "ws_..." }); // prepaid balance via the control plane
client.activity({ since: "2026-01-01", limit: 50 }); // control-plane activity
client.messages({            // Anthropic shape, preserves system + content blocks
  model: "anthropic/claude-3-5-sonnet",
  messages: [{ role: "user", content: "hi" }],
  maxTokens: 512,
});
client.billingCheckout({ amount: 25, paymentMethod: "stablecoin", idempotencyKey: "..." });
```

`client.embeddings(...)` uses the attested inference plane. Embedding model
catalog routes such as `/embeddings/models` are control-plane metadata.

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
npm test             # node --test
```

CI runs lint + tests on every push to main and PR.
