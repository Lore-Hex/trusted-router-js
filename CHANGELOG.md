# Changelog

## Unreleased

- Typed inference and control-plane mutation methods now mint one stable
  `Idempotency-Key` per logical call and reuse it for every attempt. Generic
  `request()` / `rawRequest()` calls remain deliberately unkeyed; callers must
  provide `idempotencyKey` to authorize ordinary status retries or replay after
  an ambiguous write.
- Fixed buffered Synth completions to preserve every ordered observability
  event and derive panel, judge-attempt, selected-judge, final-attempt, and
  summary metadata instead of overwriting `trustedrouter` on each chunk.
- API behavior change: `fetchAttestationAgain()` now verifies the follow-up
  document and returns `GatewayAttestation`; it no longer returns an unverified
  raw `Uint8Array`.
- Internal restructure onto the harmonized cross-SDK architecture: policy
  kernel, candidate set, transport engine, attempt assembly, stream codec,
  error taxonomy, orchestration builders, and client facade now live in
  `src/internal/*` behind the unchanged `src/index.js` barrel. Public API and
  import paths are byte-identical.
- INTENDED behavior change: the streaming-open path (`rawRequest`,
  `chatCompletionsChunks`, `chatCompletionsRawStream`, `responsesEvents`,
  `responsesRawStream`) now shares the buffered path's full retry semantics.
  Previously it retried only 502/503/504, ignored `x-should-retry: true`,
  skipped 429 backoff, and `regionalFailover: false` disabled ALL streaming
  retries. Now: the `x-should-retry` verdict wins in both directions, 429 and
  5xx are retried with jittered backoff honoring `retry-after(-ms)`, and a
  pinned client retries in place. Retries still happen only before any body
  bytes are surfaced; a broken open stream propagates and never reconnects.

## 0.4.0

- Changed the default inference base URL to `https://api.trustedrouter.com/v1`.
- Added `DEFAULT_CONTROL_BASE_URL` and the `controlBaseUrl` client option for metadata, OAuth, billing, credits, activity, and broadcast routes.
- Routed inference methods and control methods to their respective planes while keeping regional failover inference-only.
- Regional failover now re-requests `api.trustedrouter.com` (global LB); per-region hostnames and region pinning options were removed.
