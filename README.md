# TrustedRouter JavaScript SDK

Small JavaScript client for TrustedRouter.

- API base: `https://api.quillrouter.com/v1`
- Trust page: `https://trust.trustedrouter.com`
- Control plane source: `https://github.com/Lore-Hex/quill-router`
- License: Apache-2.0

## Install

```bash
npm install @lore-hex/trusted-router
```

## Usage

```js
import { TrustedRouter } from "@lore-hex/trusted-router";

const client = new TrustedRouter({ apiKey: process.env.TRUSTEDROUTER_API_KEY });

const response = await client.chatCompletions({
  model: "trustedrouter/auto",
  messages: [{ role: "user", content: "hello" }],
});

console.log(response.choices[0].message.content);
```

The SDK intentionally uses OpenAI-compatible request and response shapes. Use
`client.request(...)` for routes that are not wrapped yet.

## Trust Metadata

```js
import { trustRelease } from "@lore-hex/trusted-router";

const release = await trustRelease();
console.log(release.image_digest);
```

Full attestation verification helpers will live here as the hosted attestation
contract stabilizes.
