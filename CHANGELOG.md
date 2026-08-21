# Changelog

## 0.6.0 — 2026-08-21

- Added the `x-tr-client` header channel (client telemetry contract v1). On
  every inference attempt against a TrustedRouter host, the single engine
  loop sends a content-free reliability header describing the immediately
  preceding attempt (attempt index, outcome, error class, host) — closed
  enums and clamped integers only, never free text. Control-plane calls and
  custom base URLs never carry it, a caller-supplied `x-tr-client` is
  stripped rather than forwarded, an out-of-grammar value sends nothing, and
  telemetry can never fail a request. Opt-out precedence: the new `telemetry`
  client option, then `TRUSTEDROUTER_TELEMETRY`, then `DO_NOT_TRACK`, then on
  only for known TrustedRouter base and control hosts. New exports:
  `TELEMETRY_SCHEMA_VERSION`, `DEFAULT_TELEMETRY_PATH`, the `TELEMETRY_*`
  vocabulary constants, and `resolveTelemetryEnabled()`. The beacon channel
  is deliberately not implemented yet.
- Visible User-Agent change: the header is now exactly
  `trusted-router-js/<version> node/<node-version>`, the grammar the enclave
  parses (contract §3.1). 0.5.0 sent `trusted-router-js/0.4.0 node/<version>
  <platform>` — a stale `VERSION` constant plus a trailing platform word that
  made the whole value unparseable server-side. `VERSION` now tracks
  `package.json`, enforced by `test/parity-contract.test.js`.
- Failover now actually reaches the alias domains: for the default base URL,
  connection failures and 502/503/504 move on to `api.allyrouter.com` and
  `api.uptimerouter.com` (exported as `ALIAS_API_BASE_URLS`). A custom
  `baseUrl` is never rewritten, and a 500 is still retried in place.
- Honors the gateway's `x-should-retry` verdict in both directions, splits
  `regionalFailover` (which now guards only host advancement) from whether a
  status or transport failure is retried at all, and parses `retry-after-ms`
  ahead of `retry-after`.
- `Retry-After` is bounded to 60 seconds so one header can neither park a
  caller for hours nor overflow into a hot retry loop.
- Attestation: `policyFromTrustRelease()` and verification fail closed on a
  policy that pins no image identity, and accept the published
  `accepted_image_digests` / `accepted_image_references` rollout lists
  (`imageDigests` / `imageReferences` on the policy).
- Cross-SDK hardening from the review round: a caller's own cancellation
  (`signal`, including `AbortSignal.timeout()` and `abort(reason)`, alone or
  combined with `timeout`) is terminal — never retried, never recorded as a
  host failure, honored while the response body is still streaming, and
  surfaced as the caller's own reason; the status, attestation,
  trust-release, OAuth key-exchange and regional health-probe fetches omit
  ambient credentials and do not follow redirects, and `RequestOptions` no
  longer accepts `method` / `redirect` overrides; `fetchAttestationAgain()`
  re-verifies against a snapshot of the session's pinned policy, JWKS and
  TLS exporter; SSE streams must terminate with `data: [DONE]` — a stream
  that ends without it, or emits data after it, raises `InternalError` (502)
  instead of completing silently; typed chunk and message shapes gained
  `reasoning`, `reasoning_content`, `refusal`, `function_call` and
  `logprobs` fields.
- Repository: added `SECURITY.md` (private vulnerability reporting, 72-hour
  acknowledgement), `CODEOWNERS`, and the cross-SDK conformance workflow as a
  pull-request gate.
- Typed inference and control-plane mutation methods now mint one stable
  `Idempotency-Key` per logical call and reuse it for every attempt. Generic
  `request()` / `rawRequest()` calls remain deliberately unkeyed; callers must
  provide `idempotencyKey` to authorize ordinary status retries or replay after
  an ambiguous write.
- Fixed buffered Synth completions to merge non-Synth `trustedrouter` envelope
  fields, preserve every ordered observability event, and derive panel,
  judge-attempt, selected-judge, final-attempt, and summary metadata instead of
  overwriting `trustedrouter` on each chunk.
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
