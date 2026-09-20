# Changelog

## 0.9.0 — 2026-09-20

### Added

- Offline signed inference receipt verification: `verifyReceipt()` accepts a
  compact or flattened JWS and fails closed with typed errors — structure
  (duplicate JSON members rejected at every depth), header, Ed25519 signature
  via WebCrypto (Node 20+), `rv`/`iat` (60 s future skew, optional max age),
  nonce, tee-verified claims, and both captured-stream hash domains.
  `ReceiptCapture` preserves exact wire bytes from a streaming response so the
  hash is recomputed over what the client actually received. GCP attestation
  chains verify through the existing gateway verifier with the receipt-key
  commitment checked by nonce set membership; other attestation kinds throw
  `UnsupportedAttestationError` rather than skipping. The enclave-generated
  parity fixtures are byte-identical across all six SDKs.
- Receipt-key attestation binding mode: compact receipts verify fully when the
  caller supplies the attestation document pinned by `att_sha256`; flattened
  receipts must match their embedded document. The live-gateway path and its
  TLS-channel requirements are unchanged.
- `CompanyAffiliation` declarations on `OAuthIdentity` and userinfo, preserved
  at runtime and enforced by a compiler fixture in CI.
- The package now ships TypeScript declaration maps and `src/`, so
  go-to-definition in a consumer's editor lands in readable source; a
  `./package.json` export; `sideEffects` declared so a `VERSION`-only import
  tree-shakes to a few hundred bytes.

### Changed

- **Receipt verification fails closed by default**: request and response
  bindings are required unless `requireBindings: false` is passed explicitly,
  the issuer must be pinned to a canonical HTTPS origin, and the receipt's
  `iss` is never followed. `VerifyReceiptOptions` is a discriminated union
  that makes the binding requirement a type error to omit.
- The SDK is now authored in TypeScript and published from `dist/` with
  generated declarations. Runtime behaviour, the ESM-only exports map, the
  CLI, and the zero-dependency policy are unchanged; the hand-written
  declarations are gone.
- Boundary audit: every value that enters from the wire, storage, argv, or
  env is validated before use and prototype keys behave as unknown. Public
  types were corrected where they contradicted the producer:
  `OAuthKeyExchangeResponse.data` is optional (minimal exchange responses omit
  it) and `UserInfoData.sub` is `string | null` (legacy ownerless keys). The
  key exchange requires only `key`; unknown fields pass through.
- Fixed four latent defects the port surfaced: telemetry OS classification
  matched prototype keys; CLI command lookup honoured inherited properties;
  `defaultHeaders` given as a `Headers` instance or tuple array were dropped
  or mis-merged; attestation image pins from trust material were accepted
  without shape validation (now fail-closed, validated against production
  trust records).
- `ReceiptCapture` validates the embedded receipt envelope before exposing
  it, and restored browser OAuth state is validated before use.

### Internal

- Type-aware ESLint gate, a 50-mutation fails-without-fix gate, CLI coverage
  of every command and option, and a packed-consumer test run in CI.

## 0.8.0 — 2026-08-24

- Added the official `trustedrouter` CLI to the npm package. It delegates to
  the SDK for chat, catalog, trust-release, and attestation operations instead
  of maintaining a second HTTP transport. The CLI supports stdin prompts,
  plain streaming, deterministic JSON/JSONL output, machine-stable exit-code
  families, raw and verified attestation, and G6 TLS-session verification.

## 0.7.0 — 2026-08-22

- Added the `/v1/client-events` beacon channel (client telemetry contract v1
  §4, §5, §6.2–§6.4), completing the telemetry work begun in 0.6.0. A
  `TelemetryReporter` batches sampled request events and exact per-minute
  counters and posts them with its **own** `fetch` — never the engine's and
  never a caller-supplied `fetchImpl` — using `credentials: "omit"` and
  `redirect: "manual"`. Buffers are bounded and drop the oldest success
  first; counter keys fold (error class, then endpoint, then an existing key)
  rather than growing without limit; batches are trimmed to the byte cap.
  The server's response governs the client: a volume-reducing policy is
  honoured, 400/401/403/404/410 disables the reporter for the process, 413
  drops the batch, and backoff runs 60 s to 10 min honouring `Retry-After`.
  New client option `telemetrySampleRate` (default 0.01) and `close()` for a
  bounded final flush; `TRUSTEDROUTER_TELEMETRY_DEBUG=1` echoes each batch.
- The opt-out precedence from 0.6.0 governs both channels unchanged, prompt
  and completion content is never recorded, and telemetry can never fail a
  request. Still zero dependencies and zero devDependencies.

## 0.6.0 — 2026-08-21

- Added the `x-tr-client` header channel (client telemetry contract v1). On
  every inference attempt against a TrustedRouter host, the single engine
  loop sends a content-free reliability header carrying the attempt index
  and stream flag and, on retries, the outcome, error class and host of the
  immediately preceding attempt — closed enums and clamped integers only,
  never free text. Control-plane calls and custom base URLs never carry it,
  a caller-supplied `x-tr-client` is stripped rather than forwarded, an
  out-of-grammar value sends nothing, and telemetry can never fail a
  request. Opt-out precedence: the new `telemetry` client option, then
  `TRUSTEDROUTER_TELEMETRY`, then `DO_NOT_TRACK`, then on only for known
  TrustedRouter base and control hosts. New exports:
  `TELEMETRY_SCHEMA_VERSION`, `DEFAULT_TELEMETRY_PATH`, the `TELEMETRY_*`
  vocabulary constants, and `resolveTelemetryEnabled()`. The beacon channel
  is deliberately not implemented yet.
- Visible User-Agent change: the header is now `trusted-router-js/<version>`,
  followed by ` node/<node-version>` on Node (other runtimes send no runtime
  token) — the grammar the enclave parses (contract §3.1). 0.5.0 on Node sent
  `trusted-router-js/0.4.0 node/<version> <platform>`: a stale `VERSION`
  constant plus a trailing platform word that made the whole value
  unparseable server-side. `VERSION` now tracks `package.json`, enforced by
  `test/parity-contract.test.js`.
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
- `timeout` is now one deadline for the whole logical call — the regional
  probes, every attempt and its backoff, and reading the response body —
  instead of a per-attempt bound on reaching the response headers.
- Every SDK request now refuses to follow redirects (`redirect: "manual"`);
  a caller-supplied `redirect` option is ignored, and `RequestOptions` no
  longer types `method` / `redirect` overrides.
- Attestation: `policyFromTrustRelease()` and verification fail closed on a
  policy that pins no image identity — the check is the new
  `pinsImageIdentity()` export of `@lore-hex/trusted-router/attestation` —
  and accept the published `accepted_image_digests` /
  `accepted_image_references` rollout lists (`imageDigests` /
  `imageReferences` on the policy).
- `collectCompletion()` now merges every choice by index, concatenates
  `reasoning` / `reasoning_content` / `refusal` deltas, merges
  `function_call` deltas, preserves unknown envelope and choice fields, and
  reports the stream's own `finish_reason` (`null` if none was sent) instead
  of inventing `"stop"`; an empty stream, or one with no choices, raises
  `InternalError` (502) instead of yielding a synthetic empty completion.
- Cross-SDK hardening from the review round: a caller's own cancellation
  (`signal`, including `AbortSignal.timeout()` and `abort(reason)`, alone or
  combined with `timeout`) is terminal — never retried, never recorded as a
  host failure, honored while the response body is still streaming, and
  surfaced as the caller's own reason; the status, attestation,
  trust-release, OAuth key-exchange and regional health-probe fetches omit
  ambient credentials; `fetchAttestationAgain()` re-verifies against the
  session's pinned policy, TLS exporter and leaf certificate (and the
  caller-supplied JWKS, if one was given; otherwise the JWKS is fetched
  again); SSE streams must terminate with `data: [DONE]` — a stream that
  ends without it, or emits data after it, raises `InternalError` (502)
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
