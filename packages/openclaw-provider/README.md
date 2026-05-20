# TrustedRouter.com OpenClaw Provider

This package adds [TrustedRouter.com](https://trustedrouter.com) as an
OpenClaw model provider through ClawHub.

TrustedRouter is an end-to-end encrypted, OpenRouter-compatible LLM router. The
plugin registers the `trustedrouter` provider, uses the OpenAI-compatible chat
completions transport at `https://api.quillrouter.com/v1`, and defaults to
`trustedrouter/auto` for multi-provider routing.

## Install

After the package is published on ClawHub:

```bash
openclaw plugins install clawhub:@lore-hex/openclaw-trustedrouter-provider
```

Then configure an API key:

```bash
openclaw onboard --auth-choice trustedrouter-api-key
```

You can also set the key in the environment:

```bash
export TRUSTEDROUTER_API_KEY="sk-tr-v1-..."
```

## Provider Details

- Provider id: `trustedrouter`
- Default model: `trustedrouter/auto`
- Base URL: `https://api.quillrouter.com/v1`
- Auth env var: `TRUSTEDROUTER_API_KEY`
- Onboarding group: `OpenRouter-compatible routers`

## ClawHub Publish

Preview the package locally:

```bash
npm --prefix packages/openclaw-provider run check
npm --prefix packages/openclaw-provider run pack:dry-run
```

Publish through ClawHub from this repository:

```bash
clawhub package publish Lore-Hex/trusted-router-js \
  --source-path packages/openclaw-provider \
  --family code-plugin \
  --clawscan-note "Uses the user-configured TRUSTEDROUTER_API_KEY only to call https://api.quillrouter.com/v1 for OpenAI-compatible LLM requests."
```
