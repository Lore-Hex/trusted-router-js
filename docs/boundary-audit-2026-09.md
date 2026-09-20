# Boundary audit (2026-09): defect classes at external-data boundaries

The inventory was recorded before source edits; verdicts below are finalized after verification. Locations refer to the merged-main baseline, so they remain stable despite inserted imports/helpers. Repeated accesses at one logical boundary are grouped. Mutation-by-mutation evidence is in [boundary-audit-2026-09-mutations.md](boundary-audit-2026-09-mutations.md).

| Class | Baseline site(s) | Verdict | Reason / remediation |
|---|---|---|---|
| 1,2,3 | src/internal/transport.ts:123–124 | fixed | Header reader: normalize HeadersInit; guard record reads and callable get. |
| 2 | src/internal/transport.ts:228,235,781 | fixed | Narrow replay-code, error-message, and cancellation-name projections; malformed error arrays cannot authorize replay/cancellation. |
| 2 | src/internal/transport.ts:674–689 | already-safe | Existing null/array guards narrowed model/provider records; replaced equivalent guards with shared isRecord. |
| 2 | src/internal/transport.ts:914 | already-safe | serializeBody constructs JSON strings or passes native body objects; fetch retains falsy-value coercion (inline invariant). |
| 3 | src/internal/transport.ts:409–425 | already-safe | Wave A mergeHeaders normalizes every source through Headers. |
| 1 | src/cli/main.ts:209,551 | already-safe | Both command tables use Object.hasOwn before argv lookup. |
| 1,2 | src/cli/main.ts:247–262 | already-safe | Serializer excludes null, handles arrays separately, enumerates own keys; replace assertions with narrowing. |
| 2 | src/cli/main.ts:187,314 | already-safe | parseArgs throws Error (existing invariant); Number.isInteger accepts only numbers. Replaced assertions with explicit narrowing. |
| 4 | src/cli/main.ts:401 | fixed | Use record guard for attestation projection. |
| 1 | src/internal/beacon.ts:136–148 | already-safe | Wave A osEnum uses switch, no prototype lookup. |
| 2 | src/internal/beacon.ts:165–166 | already-safe | Runtime extension checked for string before use; document invariant. |
| 2,4 | src/internal/beacon.ts:191–205,262–271,306–347,392–412,696,720,895–909 | fixed | Reject arrays at record boundaries; retain enum membership validation. |
| 1,2 | src/internal/beacon.ts:365–388,394–395 | already-safe | Tuple fields normalized against closed vocabularies; histogram key checked against fixed bucket vocabulary. |
| 2 | src/internal/beacon.ts:308,693–695 | already-safe | Array.isArray precedes array use; assertions retain unknown elements and do not narrow array contents. |
| 2,3 | src/internal/telemetry.ts:519–521 | fixed | Route header reads through transport normalization helper. |
| 2 | src/internal/telemetry.ts:376,498–501,839 | fixed | Narrow error chain links before property access. |
| 4 | src/internal/telemetry.ts:559 | intentionally-unchanged | Response identity is an opaque WeakMap key, not a JSON record. |
| 2 | src/internal/telemetry.ts:647,1084 | already-safe | Event eligibility checks method against closed vocabulary; document invariant. |
| 2,4 | src/internal/errors.ts:32–35,113–118 | fixed | Use record guard for payload and nested error; explicit string conversion for messages. |
| 2 | src/internal/errors.ts:137,158 | already-safe | Existing comment names Error constructor coercion invariant; now expressed directly with String. |
| 2 | src/internal/trust.ts:28–34 | fixed | Validate fetched trust release is a record. |
| 2 | src/client.ts:195,624 | fixed | Validate request/status JSON record boundary. |
| 2 | src/client.ts:283,470,500,556,673,749 | fixed | Validate public typed wire response fields instead of Promise/iterator assertions. |
| 2 | src/client.ts:219,235,268,287,308,348,454,485,515,544,574,637,651,688,718,738 | already-safe | SDK-constructed defaults/request options; replace object literal assertions to meet lint. |
| 2 | src/client.ts:323,530; src/internal/sse.ts:98,138 | already-safe | Node 20 fetch body implements byte async iteration; retain byte iteration and cancellation semantics with local invariant comments. |
| 2 | src/attestation.ts:306,313,369,411,436,575 | already-safe | Segment count, built-in Error failures, integer test, and hardware allowlist are existing runtime invariants; now narrowed explicitly. |
| 2 | src/attestation.ts:363 | fixed | Validate RSA n/e strings before constructing the typed JWK. |
| 2,4 | src/attestation.ts:349 | fixed | Validate supplied JWKS and every key record before the find callback accesses kid. |
| 2,4 | src/attestation.ts:331–335,391–392,466–468,505,522,542 | fixed | Validate JWKS keys, JWT header/claims, container, and nonce arrays. |
| 2 | src/attestation.ts:621; src/receipts.ts:341 | already-safe | WebCrypto rejects unsupported backing buffers; existing comment names invariant. |
| 2,4 | src/internal/sse.ts:204–213 | already-safe | Chat JSON rejects null/arrays before projections; now uses shared guard. Error strings, records, and arrays remain explicit failure signals (no array object projection). |
| 2,4 | src/internal/sse.ts:240–246 | fixed | Reject array event bodies before an event-name wrapper can turn them into records; keep scalar event wrapping. |
| 2,4 | src/internal/sse.ts:278–283,448–463 | fixed | Exclude array usage, choices, tool calls, and tool-function records. |
| 2,4 | src/internal/sse.ts:306–309,386–397,437,472–476 | already-safe | Existing record checks exclude null/arrays; replace equivalent checks with shared helper. String concatenation now states the existing coercion explicitly. |
| 1 | src/internal/sse.ts:275,302,326,402,460,465,476 | fixed | External-key writes can invoke __proto__ setter; use own data properties. |
| 1 | src/internal/sse.ts:319,343–344,352,354,440 | already-safe | SDK-fixed field names; own guards on event copy. Standardize own checks. |
| 1 | src/internal/orchestration.ts:191–194,228–231 | already-safe | Fixed SDK key tables and Object.hasOwn guard; writes use fixed gateway keys. |
| 1 | src/receipts.ts:366,529,537,548 | already-safe | Structural comparison checks own keys; claim accessors use fixed internal claim names. |
| 2,4 | src/receipts.ts:132,1212 | already-safe | Existing record helper excludes null/arrays; nonce validated as string before assertion. |
| 1,4 | src/oauth.ts:195,201,208 | already-safe | Stored JSON rejects null/arrays; fixed state/verifier keys. Standardize shared guard and own checks. |
| 2 | src/internal/models.ts:124,127,128,130 | already-safe | Each normalized enum value checked against literal allowlist before assertion; membership checks are the runtime narrowing invariant. |
| 2 | src/session.ts:102,165,176,226,291 | already-safe | TLS native API checked before use; policy snapshot SDK-constructed; error projection will be narrowed. |
| 1 | src/internal/pkce.ts; src/index.ts; src/cli.ts; src/internal/receipt-dependencies.ts | already-safe | No external-key plain-object lookups or unvalidated JSON assertions. |

| 1 | src/internal/beacon.ts:402,405–406 | already-safe | field comes from SDK literal tuples, never external data; histogram bucket is separately allowlisted. |
| 1 | src/internal/transport.ts:524 | already-safe | Native Response reader names come from the SDK BODY_READERS literal tuple; inherited prototype methods are intentional. |
| 1 | src/receipts.ts:1234–1235 | intentionally-unchanged | Protocol lookup uses SDK-fixed well-known iterator symbols, not an external string. Inherited iterator methods must work. |
| 1 | src/attestation.ts:288; src/internal/beacon.ts:245,323,651; src/internal/sse.ts:281; src/internal/telemetry.ts:263,309,311,705–709,724,915,969,995,1072; src/internal/transport.ts:892,898 | already-safe | Array/typed-array indices (loop ordinals, bounded attempt slots, selected candidates), not plain-object dispatch. |
| 1 | src/receipts.ts:176,182,193,214,224,228,232,242,249,253,262,315,348,360,680,699,704,723,726 | already-safe | Parser string offsets and byte/array indices, not plain-object lookups. |
| 1 | src/cli/main.ts:216–220,414,450 | already-safe | Literal SDK option keys, not externally selected lookup keys. |
| 3 | src/client.ts:599,754; src/internal/orchestration.ts:197,234; src/internal/sse.ts:273,300,309,393,404,406,459,463,474; src/internal/beacon.ts:393 | already-safe | Enumerated records are payload/metadata/counter objects, not HeadersInit. |
| 4 | src/cli/main.ts:247–262 | intentionally-unchanged | General serializer intentionally supports arrays and native toJSON objects; null is rejected before object access and arrays handled separately. |

## Final implementation and gate

- Shared `src/internal/records.ts`: `isRecord`, `ownProperty`, safe `setOwn`, record boundary and error-message helpers. Public wire schemas live in `src/internal/wire.ts`.
- ESLint 9 plus the typescript-eslint parser/plugin, dev dependencies only, flat config with `project: "./tsconfig.json"`. No runtime dependencies. `npm run lint` scans src/test, excludes dist, and precedes checks/tests in CI and release validation.
- Error rules: no-explicit-any; no-unsafe-assignment/member-access/call/return/argument; no-unnecessary-type-assertion; consistent-type-assertions (`as`, objectLiteralTypeAssertions: never); switch-exhaustiveness-check; no-floating-promises; no-misused-promises; the requested object-literal computed-member selector.
- `strict-boolean-expressions` was tried: 89 errors. Left off to avoid mass churn, as requested.
- Tests use syntax-only no-explicit-any and the object-literal selector; no type-aware unsafe rules. Frozen fixtures and consumer type tests are unchanged.
- The ordinary unsafe rules do not catch `JSON.parse(text) as SomeType`. The added typed `boundaries/no-assert-any` rule rejects assertions from any to a narrower type; containment as unknown is allowed. [typescript-eslint assertion rules](https://typescript-eslint.io/rules/no-unsafe-type-assertion/) document the broader narrowing problem. This narrow rule deliberately avoids forbidding validated enum/platform assertions.
- This is not general taint analysis: the literal selector does not prove that every named Record lookup is guarded. Runtime validators and focused regressions cover those boundaries.
- Inline eslint disables: **none**.
- One existing credential-stripping test mock gained `data: {}` to match the existing required OAuth response type; its security assertions were preserved.

## Verification

Node **20.20.2**, using the requested PATH. npm used a writable temporary cache (`npm_config_cache=/tmp/boundary-audit-npm-cache`) because the sandbox cannot write the default cache. Cached registry tarballs supplied the dev tooling after registry DNS failed; no cache paths are committed to package metadata.

| Command / invariant | Result |
|---|---|
| `npm ci` | passed |
| `npm run build` | passed |
| `npm run lint` | passed, zero errors, no inline disables |
| `npm run check` | passed, including unchanged consumer type test and six declaration checks |
| `npm test` | 558 tests: 553 passed, five sandbox-blocked TLS tests, zero skips |
| `npm run lint:package` | passed (publint and attw esm-only) |
| `git diff main --stat -- test/types test/fixtures` | empty |
| `git diff --check` | passed |
| Runtime dependencies | zero |
| New focused tests | 42, in the existing test files |
| Runtime mutation checks | 48 / 48 failed their focused regression tests, then restored |
| Mandatory lint mutation checks | 2 / 2 failed `npm run lint`, then removed |
| Git commits | none; work tree only |

The five TLS failures all report `listen EPERM: operation not permitted 127.0.0.1`:

1. Rejecting an untrusted TLS certificate with global Node TLS verification disabled.
2. Rejecting a socket that EOFs after a complete attestation response.
3. Binding attestation to the live TLS exporter.
4. Preserving bytes after attestation Content-Length.
5. Rejecting Connection: close attestation responses.

The mutation runner is `node scripts/mutation-check.mjs` (after a build). [Every mutation and its failing test/rule](boundary-audit-2026-09-mutations.md) is recorded separately. Runtime cases transpile the reverted source so obsolete unsafe TS assertions cannot stop the behavioral test from executing; each source and built module is restored in `finally`. Final build/check/test/package validation ran after restoration.

## Full grep inventory

Every source file was searched for assertions, object checks, computed access, membership checks, and object enumeration. The candidate listing includes array/string indexing, declarations and comments, which are outside these four defect classes; verdicts for actionable groups are above.

```text
src/attestation.ts:5:  * as a Confidential Space workload; its `/attestation` endpoint mints
src/attestation.ts:16:  * Uses the WebCrypto SubtleCrypto API — no native deps. Runs in
src/attestation.ts:99:  * Both image checks in `verifyGatewayAttestation` are guarded on a non-empty
src/attestation.ts:156:       : (imageDigest ? [imageDigest] : []),
src/attestation.ts:160:       : (imageReference ? [imageReference] : []),
src/attestation.ts:164:     // A truncated body, an error page that happens to parse as JSON, or a
src/attestation.ts:182:  *   nonceHex       The same nonce sent in the /attestation request (optional)
src/attestation.ts:220:  * hardware, and image-policy checks as verifyGatewayAttestation(), but omits
src/attestation.ts:222:  * somewhere in the token's eat_nonce values.
src/attestation.ts:238:   if (typeof keyCommitmentHex !== "string" || !/^[0-9a-fA-F]{64}$/.test(keyCommitmentHex)) {
src/attestation.ts:257: const IMAGE_DIGEST = /^sha256:[0-9a-f]{64}$/;
src/attestation.ts:258: const IMAGE_PATH_COMPONENT = "[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*";
src/attestation.ts:261:   "^(?:[a-z0-9]+(?:[.-][a-z0-9]+)*(?::[0-9]+)?/)?" +
src/attestation.ts:263:   "(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})?(?:@sha256:[0-9a-f]{64})?$",
src/attestation.ts:279:   // Array.from validates even holes in a caller-supplied sparse array.
src/attestation.ts:280:   return Array.from(values, (entry, index) => readImagePin(entry, `${field}[${index}]`, pattern));
src/attestation.ts:288:   for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
src/attestation.ts:306:   const [hB64, pB64, sB64] = parts as [string, string, string];
src/attestation.ts:313:     throw new AttestationVerificationError(`invalid JWT encoding: ${(err as { message: unknown }).message}`);
src/attestation.ts:331:   if (!data || !Array.isArray((data as { keys?: unknown }).keys)) {
src/attestation.ts:335:   return data as Jwks;
src/attestation.ts:352:       `no JWK with kid=${JSON.stringify(header.kid)} in JWKS — gateway key may have rotated`,
src/attestation.ts:356:     throw new AttestationVerificationError("expected RSA key in JWKS");
src/attestation.ts:363:       { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true } as JsonWebKey,
src/attestation.ts:366:       ["verify"],
src/attestation.ts:369:     throw new AttestationVerificationError(`failed to import JWK: ${(err as { message: unknown }).message}`);
src/attestation.ts:391:   await verifyRs256(jwks, header as Record<string, unknown>, signingInput, signature);
src/attestation.ts:392:   return payload as Record<string, unknown>;
src/attestation.ts:411:   if ((claims.exp as number) <= now) {
src/attestation.ts:436:   if (!["GCP_AMD_SEV", "GCP_AMD_SEV_ES", "GCP_INTEL_TDX"].includes(claims.hwmodel as string)) {
src/attestation.ts:443:     audList = [claims.aud];
src/attestation.ts:451:       `audience ${JSON.stringify(policy.audience)} not in JWT aud ${JSON.stringify(audList)}`,
src/attestation.ts:456:     // Defence in depth for hand-built policies: both image checks below are
src/attestation.ts:466:   const submods = ((claims.submods || {}) as Record<string, unknown>).container || {};
src/attestation.ts:467:   const imageDigest = (submods as Record<string, unknown>).image_digest ?? "";
src/attestation.ts:468:   const imageReference = (submods as Record<string, unknown>).image_reference ?? "";
src/attestation.ts:475:     : (policy.imageDigest ? [policy.imageDigest] : []);
src/attestation.ts:484:     : (policy.imageReference ? [policy.imageReference] : []);
src/attestation.ts:495:   if (typeof nonces === "string") nonces = [nonces];
src/attestation.ts:501:         ? [eatNonces]
src/attestation.ts:505:       noncePresent = hasNonce(nonces as Iterable<unknown>, nonceHex);
src/attestation.ts:509:         `nonce ${JSON.stringify(nonceHex)} not present in JWT nonces ${JSON.stringify(nonces)}`,
src/attestation.ts:522:     if (!hasNonce(nonces as Iterable<unknown>, exporterHex)) {
src/attestation.ts:524:         "TLS exporter not present in JWT nonces",
src/attestation.ts:542:       || (tlsCertDer ? findCertInNonces(nonces as Iterable<unknown>, await sha256Hex(tlsCertDer)) : null);
src/attestation.ts:575:     expiresAt: claims.exp as number,
src/attestation.ts:621:   const buf = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
src/cli/main.ts:61: type CliValues = ParsedCliArgs["values"];
src/cli/main.ts:75: const GLOBAL_OPTIONS = new Set(["help", "json", "retries", "version"]);
src/cli/main.ts:77:   chat: new Set(["max-tokens", "model", "stream"]),
src/cli/main.ts:82:   attest: new Set(["connect-ip", "session", "verify"]),
src/cli/main.ts:88:   trustedrouter [--json] [--retries N] <command> [options]
src/cli/main.ts:91:   chat [PROMPT|-]       Run a chat completion. Reads stdin when omitted or '-'.
src/cli/main.ts:114:   chat: `Usage: trustedrouter chat [PROMPT|-] [options]
src/cli/main.ts:126:   models: "Usage: trustedrouter models [--json]\n\nList the model catalog.\n",
src/cli/main.ts:127:   providers: "Usage: trustedrouter providers [--json]\n\nList providers.\n",
src/cli/main.ts:128:   regions: "Usage: trustedrouter regions [--json]\n\nList deployed regions.\n",
src/cli/main.ts:129:   trust: "Usage: trustedrouter trust [--json]\n\nShow the published trust release.\n",
src/cli/main.ts:130:   attest: `Usage: trustedrouter attest [options]
src/cli/main.ts:187:     throw new CliUsageError((error as Error).message);
src/cli/main.ts:192:   const command = positionals[0] ?? null;
src/cli/main.ts:209:   const allowed = Object.hasOwn(COMMAND_OPTIONS, command) ? COMMAND_OPTIONS[command] : undefined;
src/cli/main.ts:211:   for (const name of Object.keys(values)) {
src/cli/main.ts:216:   if (command === "attest" && values["connect-ip"] !== undefined) {
src/cli/main.ts:217:     const connectIp = String(values["connect-ip"]).trim();
src/cli/main.ts:220:     values["connect-ip"] = connectIp;
src/cli/main.ts:247:   if (value === null || typeof value !== "object") return value;
src/cli/main.ts:248:   if (typeof (value as Record<string, unknown>).toJSON === "function") {
src/cli/main.ts:249:     return stableJsonValue((value as { toJSON(): unknown }).toJSON(), ancestors);
src/cli/main.ts:260:     normalized = Object.create(null) as Record<string, unknown>;
src/cli/main.ts:261:     for (const key of Object.keys(value).sort()) {
src/cli/main.ts:262:       normalized[key] = stableJsonValue((value as Record<string, unknown>)[key], ancestors);
src/cli/main.ts:287:     .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
src/cli/main.ts:288:     .replace(/[^a-zA-Z0-9]+/g, "_")
src/cli/main.ts:314:   if (Number.isInteger(statusCode)) detail.status_code = statusCode as number;
src/cli/main.ts:345:   if (operands.includes("-") && !(operands.length === 1 && operands[0] === "-")) {
src/cli/main.ts:348:   if (operands.length > 0 && operands[0] !== "-") {
src/cli/main.ts:392:   const content = response?.choices?.[0]?.message?.content;
src/cli/main.ts:401:   if (value && typeof value === "object" && "rawClaims" in value) {
src/cli/main.ts:414:   const maxTokens = integerOption(values["max-tokens"] ?? "200", "--max-tokens", {
src/cli/main.ts:420:     messages: [{ role: "user", content: prompt }],
src/cli/main.ts:450:         connectIp: values["connect-ip"] ?? null,
src/cli/main.ts:551:         write(stdout, COMMAND_HELP[command]);
src/client.ts:6:  * `_controlRequest` pinning `_baseUrls: [controlBaseUrl]`, whose length-1
src/client.ts:9:  * references — those live only in ./internal/transport.js.
src/client.ts:12:  * single-shot metadata fetches that stay outside the engine by design — as
src/client.ts:14:  * creates lazily on the first inference call and flushes in `close()`.
src/client.ts:48:   baseUrls as inferenceBaseUrls,
src/client.ts:195:     return requestJson(this, method, path, init) as Promise<Record<string, unknown>>;
src/client.ts:212:       !["GET", "HEAD", "OPTIONS", "TRACE"].includes(String(method).toUpperCase())
src/client.ts:218:       _baseUrls: [this.controlBaseUrl],
src/client.ts:219:     } as RequestOptions);
src/client.ts:235:   }: ChatRequest = {} as ChatRequest): Promise<ChatCompletion> {
src/client.ts:256:   /** Yield each parsed `chat.completion.chunk` as a plain object. */
src/client.ts:268:   }: ChatRequest = {} as ChatRequest) {
src/client.ts:283:     yield* iterSseChunks(response) as AsyncIterable<ChatCompletionChunk>;
src/client.ts:287:   async *chatCompletionsText(opts: ChatRequest = {} as ChatRequest): AsyncIterable<string> {
src/client.ts:289:       const text = chunk?.choices?.[0]?.delta?.content;
src/client.ts:308:   }: ChatRequest = {} as ChatRequest) {
src/client.ts:323:     for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
src/client.ts:333:    * an OpenAI-shape chat.completion, same as `chatCompletions`. Pass
src/client.ts:348:   }: FusionRequest = {} as FusionRequest): Promise<ChatCompletion> {
src/client.ts:454:   }: ResponsesRequest = {} as ResponsesRequest): Promise<ResponseObject> {
src/client.ts:470:     }) as unknown as Promise<ResponseObject>;
src/client.ts:485:   }: ResponsesRequest = {} as ResponsesRequest) {
src/client.ts:500:     yield* iterSseEvents(response) as AsyncIterable<Record<string, unknown>>;
src/client.ts:515:   }: ResponsesRequest = {} as ResponsesRequest) {
src/client.ts:530:     for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
src/client.ts:544:   }: ResponsesRequest = {} as ResponsesRequest): Promise<ResponseInputTokens> {
src/client.ts:556:     }) as unknown as Promise<ResponseInputTokens>;
src/client.ts:574:   }: BroadcastDestinationRequest = {} as BroadcastDestinationRequest): Promise<Record<string, unknown>> {
src/client.ts:599:         Object.entries(patch).filter(([, value]) => value !== undefined),
src/client.ts:624:     ) as Promise<Record<string, unknown>>;
src/client.ts:637:   }: BillingCheckoutRequest = {} as BillingCheckoutRequest): Promise<Record<string, unknown>> {
src/client.ts:651:   stablecoinCheckout({ amount, ...params }: Omit<BillingCheckoutRequest, "paymentMethod"> = {} as Omit<BillingCheckoutRequest, "paymentMethod">) {
src/client.ts:673:     return this._controlRequest("GET", "/auth/userinfo") as unknown as Promise<UserInfoResponse>;
src/client.ts:688:   }: OAuthAuthorizeUrlOptions = {} as OAuthAuthorizeUrlOptions): string {
src/client.ts:718:   }: CreateOAuthAuthorizationOptions = {} as CreateOAuthAuthorizationOptions): Promise<OAuthAuthorization> {
src/client.ts:738:   }: OAuthKeyExchangeRequest = {} as OAuthKeyExchangeRequest): Promise<OAuthKeyExchangeResponse> {
src/client.ts:749:     }) as unknown as Promise<OAuthKeyExchangeResponse>;
src/client.ts:754:     for (const [key, value] of Object.entries(params)) {
src/client.ts:765:   /** Fetch the gateway attestation JWT as raw bytes (Uint8Array). */
src/index.ts:5:  * the Python SDK's surface so multi-language teams stay in sync: typed
src/index.ts:20:  * Attestation verification (`verifyGatewayAttestation`) lives in
src/index.ts:21:  * ./attestation.js. TLS session pinning lives in the Node-only
src/index.ts:249:   /** Per-region health-probe timeout in milliseconds. Default: 1500. */
src/index.ts:264:    * as diagnostic events; failures, retries, and slow calls are always
src/index.ts:275:   /** Per-call timeout in milliseconds (uses AbortController). */
src/index.ts:305:   [extra: string]: unknown;
src/index.ts:313:   [extra: string]: unknown;
src/index.ts:329:   [extra: string]: unknown;
src/index.ts:347:       [extra: string]: unknown;
src/index.ts:351:   [extra: string]: unknown;
src/index.ts:391:   [extra: string]: unknown;
src/index.ts:396:   [extra: string]: unknown;
src/index.ts:416:   [extra: string]: unknown;
src/index.ts:427:   [extra: string]: unknown;
src/index.ts:438:   [extra: string]: unknown;
src/index.ts:444:   [extra: string]: unknown;
src/index.ts:529:   [extra: string]: unknown;
src/internal/beacon.ts:3:  * docs/client-telemetry.md in Lore-Hex/quill-router, contract v1).
src/internal/beacon.ts:7:  * and EXACT per-minute counters, and delivers them as content-free batches to
src/internal/beacon.ts:9:  * deployment from the inference plane, so an inference outage is reported in
src/internal/beacon.ts:13:  * `fetchTrustRelease` precedent in ./trust.js: its own single-shot fetch call
src/internal/beacon.ts:19:  * is never recorded or traced. Mirrors TelemetryReporter in
src/internal/beacon.ts:48:   "attempt" | "request", typeof TELEMETRY_ENDPOINTS[number], boolean,
src/internal/beacon.ts:49:   typeof TELEMETRY_HOSTS[number], typeof TELEMETRY_FINAL_OUTCOMES[number],
src/internal/beacon.ts:50:   typeof TELEMETRY_ERROR_CLASSES[number] | null,
src/internal/beacon.ts:51:   typeof TELEMETRY_HTTP_STATUS_CLASSES[number], typeof TELEMETRY_TIMEOUT_PHASES[number],
src/internal/beacon.ts:54: type Histogram = Partial<Record<typeof TELEMETRY_LATENCY_BUCKETS[number], number>>;
src/internal/beacon.ts:55: type CounterCounts = Partial<TelemetryCounter[1]>;
src/internal/beacon.ts:65:   host: typeof TELEMETRY_HOSTS[number];
src/internal/beacon.ts:66:   outcome: typeof TELEMETRY_OUTCOMES[number];
src/internal/beacon.ts:68:   error_class: typeof TELEMETRY_ERROR_CLASSES[number] | null;
src/internal/beacon.ts:69:   error_source: typeof TELEMETRY_ERROR_SOURCES[number] | null;
src/internal/beacon.ts:79:   sample_reason: typeof TELEMETRY_SAMPLE_REASONS[number];
src/internal/beacon.ts:124:   /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
src/internal/beacon.ts:125: const RUNTIME_RE = /^[a-z]{1,10}\/[0-9A-Za-z.+-]{1,24}$/;
src/internal/beacon.ts:126: const SDK_NAMES = new Set(["tr-py", "tr-js", "tr-go", "tr-rust", "tr-java", "tr-swift"]);
src/internal/beacon.ts:127: const SDK_LANGS = new Set(["python", "js", "go", "rust", "java", "swift"]);
src/internal/beacon.ts:128: const SDK_OSES = new Set(["linux", "macos", "windows", "ios", "android", "freebsd", "other"]);
src/internal/beacon.ts:129: const SDK_ARCHES = new Set(["x64", "x32", "arm", "arm64", "wasm", "other"]);
src/internal/beacon.ts:135: /** The process OS in the contract's closed vocabulary (py _os_enum). */
src/internal/beacon.ts:150: /** The process architecture in the contract's closed vocabulary (py _arch_enum). */
src/internal/beacon.ts:154:   if (["ia32", "x32", "i386", "i486", "i586", "i686", "x86"].includes(value)) return "x32";
src/internal/beacon.ts:165:   else if (typeof (globalThis as DenoGlobal).Deno?.version?.deno === "string") {
src/internal/beacon.ts:166:     token = `deno/${(globalThis as DenoGlobal).Deno!.version!.deno}`;
src/internal/beacon.ts:172: /** Build the bounded SDK identity included in every telemetry batch. */
src/internal/beacon.ts:191:   const source: JsonObject = identity && typeof identity === "object" ? identity as JsonObject : {};
src/internal/beacon.ts:192:   const name = (SDK_NAMES as ReadonlySet<unknown>).has(source.name) ? source.name as string : fallback.name;
src/internal/beacon.ts:199:   const lang = (SDK_LANGS as ReadonlySet<unknown>).has(source.lang) ? source.lang as string : fallback.lang;
src/internal/beacon.ts:204:   const os = (SDK_OSES as ReadonlySet<unknown>).has(source.os) ? source.os as string : fallback.os;
src/internal/beacon.ts:205:   const arch = (SDK_ARCHES as ReadonlySet<unknown>).has(source.arch) ? source.arch as string : fallback.arch;
src/internal/beacon.ts:245:       buffer[index] = Math.floor(Math.random() * 256);
src/internal/beacon.ts:251: /** A uniform draw in [0, 1) with 53 bits of entropy (py secrets.randbits(53) / 2**53). */
src/internal/beacon.ts:256:     return (words[0]! * 2 ** 21 + (words[1]! >>> 11)) / 2 ** 53;
src/internal/beacon.ts:262:   const source: JsonObject = attempt && typeof attempt === "object" ? attempt as JsonObject : {};
src/internal/beacon.ts:263:   const host = (TELEMETRY_HOSTS as readonly unknown[]).includes(source.host) ? source.host as typeof TELEMETRY_HOSTS[number] : "custom";
src/internal/beacon.ts:264:   const outcome = (TELEMETRY_OUTCOMES as readonly unknown[]).includes(source.outcome)
src/internal/beacon.ts:265:     ? source.outcome as typeof TELEMETRY_OUTCOMES[number]
src/internal/beacon.ts:267:   const errorClass = (TELEMETRY_ERROR_CLASSES as readonly unknown[]).includes(source.error_class)
src/internal/beacon.ts:268:     ? source.error_class as typeof TELEMETRY_ERROR_CLASSES[number]
src/internal/beacon.ts:270:   const errorSource = (TELEMETRY_ERROR_SOURCES as readonly unknown[]).includes(source.error_source)
src/internal/beacon.ts:271:     ? source.error_source as typeof TELEMETRY_ERROR_SOURCES[number]
src/internal/beacon.ts:303:  * in reaches the wire.
src/internal/beacon.ts:306:   const source: JsonObject = event && typeof event === "object" ? event as JsonObject : {};
src/internal/beacon.ts:308:   const attempts = (source.attempts as unknown[])
src/internal/beacon.ts:310:     .filter((item) => item && typeof item === "object")
src/internal/beacon.ts:315:   const endpoint = (TELEMETRY_ENDPOINTS as readonly unknown[]).includes(source.endpoint)
src/internal/beacon.ts:316:     ? source.endpoint as typeof TELEMETRY_ENDPOINTS[number]
src/internal/beacon.ts:318:   if (!(TELEMETRY_METHODS as readonly unknown[]).includes(source.method)) return null;
src/internal/beacon.ts:321:   const finalOutcome = (TELEMETRY_FINAL_OUTCOMES as readonly unknown[]).includes(source.final_outcome)
src/internal/beacon.ts:322:     ? source.final_outcome as typeof TELEMETRY_FINAL_OUTCOMES[number]
src/internal/beacon.ts:323:     : attempts[attempts.length - 1]!.outcome;
src/internal/beacon.ts:324:   const timeoutPhase = (TELEMETRY_TIMEOUT_PHASES as readonly unknown[]).includes(source.timeout_phase)
src/internal/beacon.ts:325:     ? source.timeout_phase as typeof TELEMETRY_TIMEOUT_PHASES[number]
src/internal/beacon.ts:327:   if (!(TELEMETRY_SAMPLE_REASONS as readonly unknown[]).includes(source.sample_reason)) return null;
src/internal/beacon.ts:334:     method: source.method as typeof TELEMETRY_METHODS[number],
src/internal/beacon.ts:347:     sample_reason: source.sample_reason as typeof TELEMETRY_SAMPLE_REASONS[number],
src/internal/beacon.ts:365:   ] = key as unknown[];
src/internal/beacon.ts:367:   if (!(TELEMETRY_ENDPOINTS as readonly unknown[]).includes(endpoint)) endpoint = "inference_other";
src/internal/beacon.ts:368:   if (!(TELEMETRY_HOSTS as readonly unknown[]).includes(host)) host = "custom";
src/internal/beacon.ts:369:   if (!(TELEMETRY_FINAL_OUTCOMES as readonly unknown[]).includes(outcome)) return null;
src/internal/beacon.ts:370:   if (errorClass !== null && errorClass !== undefined && !(TELEMETRY_ERROR_CLASSES as readonly unknown[]).includes(errorClass)) {
src/internal/beacon.ts:374:   if (!(TELEMETRY_HTTP_STATUS_CLASSES as readonly unknown[]).includes(httpStatusClass)) httpStatusClass = "none";
src/internal/beacon.ts:375:   if (!(TELEMETRY_TIMEOUT_PHASES as readonly unknown[]).includes(timeoutPhase)) timeoutPhase = "none";
src/internal/beacon.ts:388:   ] as CounterKey;
src/internal/beacon.ts:392:   if (!source || typeof source !== "object") return;
src/internal/beacon.ts:393:   for (const [bucket, count] of Object.entries(source as JsonObject)) {
src/internal/beacon.ts:394:     if (!(TELEMETRY_LATENCY_BUCKETS as readonly unknown[]).includes(bucket)) continue;
src/internal/beacon.ts:395:     target[bucket as keyof Histogram] = (target[bucket as keyof Histogram] ?? 0) + boundedInt(count, 0, MAX_COUNT);
src/internal/beacon.ts:400:   const source: JsonObject = increment && typeof increment === "object" ? increment as JsonObject : {};
src/internal/beacon.ts:401:   for (const field of ["requests", "attempts", "failover_used", "first_attempt_success"] as const) {
src/internal/beacon.ts:402:     target[field] = (target[field] ?? 0) + boundedInt(source[field] ?? 0, 0, MAX_COUNT);
src/internal/beacon.ts:404:   for (const field of ["total_ms_hist", "first_event_ms_hist"] as const) {
src/internal/beacon.ts:405:     if (!target[field]) target[field] = {};
src/internal/beacon.ts:406:     mergeHistogram(target[field], source[field] ?? {});
src/internal/beacon.ts:412:   const source = counts && typeof counts === "object" ? counts : {};
src/internal/beacon.ts:415:     level: key[0],
src/internal/beacon.ts:416:     endpoint: key[1],
src/internal/beacon.ts:417:     streaming: key[2],
src/internal/beacon.ts:418:     host: key[3],
src/internal/beacon.ts:419:     outcome: key[4],
src/internal/beacon.ts:420:     error_class: key[5],
src/internal/beacon.ts:421:     http_status_class: key[6],
src/internal/beacon.ts:422:     timeout_phase: key[7],
src/internal/beacon.ts:423:     timeout_floor_met: key[8],
src/internal/beacon.ts:424:     provider_pinned: key[9],
src/internal/beacon.ts:438:   const values: CounterKey = [...key];
src/internal/beacon.ts:439:   values[5] = "unknown";
src/internal/beacon.ts:440:   if (endpoint) values[1] = "inference_other";
src/internal/beacon.ts:491:   for (const reporter of [...LIVE_REPORTERS]) reporter._flushAtExit();
src/internal/beacon.ts:598:   _sampleReason(event: JsonObject): [typeof TELEMETRY_SAMPLE_REASONS[number], number] | null {
src/internal/beacon.ts:599:     if (event.final_outcome !== "ok") return ["failure", 1];
src/internal/beacon.ts:602:       return ["retried", 1];
src/internal/beacon.ts:604:     if (boundedInt(event.total_ms, 0, MAX_DURATION_MS) > 30_000) return ["slow", 1];
src/internal/beacon.ts:608:     return ["random", rate];
src/internal/beacon.ts:615:     const [dropped] = this._events.splice(index, 1);
src/internal/beacon.ts:650:     for (const [id, entry] of this._currentCounters) {
src/internal/beacon.ts:651:       if (indices.every((index) => entry.key[index] === key[index])) return id;
src/internal/beacon.ts:668:    * error_class → unknown (joining or re-keying a row that differs only in
src/internal/beacon.ts:669:    * error class), then endpoint → inference_other the same way, and as a
src/internal/beacon.ts:671:    * exact, only coarser. Folding never counts as a drop.
src/internal/beacon.ts:682:     const errorCompatible = this._findCompatible(key, [0, 1, 2, 3, 4, 6, 7, 8, 9]);
src/internal/beacon.ts:686:     const compatible = this._findCompatible(key, [0, 2, 3, 4, 6, 7, 8, 9]);
src/internal/beacon.ts:693:     for (const item of counters as unknown[]) {
src/internal/beacon.ts:694:       const rawKey = Array.isArray(item) ? (item as unknown[])[0] : undefined;
src/internal/beacon.ts:695:       const increment = Array.isArray(item) ? (item as unknown[])[1] : undefined;
src/internal/beacon.ts:696:       if (!Array.isArray(rawKey) || !increment || typeof increment !== "object") {
src/internal/beacon.ts:720:       const source: JsonObject = event && typeof event === "object" ? event as JsonObject : {};
src/internal/beacon.ts:725:         const candidate = { ...source, sample_reason: reason[0], sample_rate: reason[1], _completed_at: now };
src/internal/beacon.ts:755:     const rows = [...window.rows.values()].map((entry) => counterRow(entry.key, entry.counts, 0));
src/internal/beacon.ts:783:       now - this._closedWindows[0]!.windowStart > TELEMETRY_RETENTION_MS
src/internal/beacon.ts:807:    * trim it — events first, then counters — until it fits in 65 536 bytes.
src/internal/beacon.ts:839:       for (const [id, entry] of window.rows) {
src/internal/beacon.ts:895:     const policy = payload && typeof payload === "object" ? (payload as JsonObject).policy : null;
src/internal/beacon.ts:896:     if (!policy || typeof policy !== "object") return;
src/internal/beacon.ts:898:       const rate = floatValue((policy as JsonObject).success_sample_rate);
src/internal/beacon.ts:904:       const seconds = floatValue((policy as JsonObject).flush_seconds);
src/internal/beacon.ts:909:     const pauseSeconds = floatValue((policy as JsonObject).pause_seconds);
src/internal/beacon.ts:984:     if ([400, 401, 403, 404, 410].includes(status)) {
src/internal/beacon.ts:1008:    * Concurrent callers share the in-flight flush (py's flush lock).
src/internal/beacon.ts:1027:       if (this.workspaceId) headers["x-trustedrouter-workspace"] = this.workspaceId;
src/internal/errors.ts:5:  * decode/raise helpers. This is the single copy in the SDK: oauth /
src/internal/errors.ts:32:     const detail = ((payload as { error?: unknown } | null | undefined)?.error &&
src/internal/errors.ts:33:       typeof (payload as { error: unknown }).error === "object"
src/internal/errors.ts:34:       ? (payload as { error: object }).error
src/internal/errors.ts:35:       : (payload && typeof payload === "object" ? payload : {})) as Record<string, unknown>;
src/internal/errors.ts:113:   if (payload && typeof payload === "object") {
src/internal/errors.ts:114:     if ((payload as Record<string, unknown>).error && typeof (payload as Record<string, unknown>).error === "object") {
src/internal/errors.ts:115:       return ((payload as Record<string, unknown>).error as Record<string, unknown>).message ||
src/internal/errors.ts:116:         ((payload as Record<string, unknown>).error as Record<string, unknown>).type;
src/internal/errors.ts:118:     return (payload as Record<string, unknown>).message;
src/internal/errors.ts:137:       (errorMessage(payload) || response.statusText || "TrustedRouter error") as string,
src/internal/errors.ts:158:     (errorMessage(payload) || response.statusText || "TrustedRouter error") as string,
src/internal/models.ts:81:   declare sort?: NonNullable<ProviderPreferencesOptions["sort"]>;
src/internal/models.ts:84:   declare data_collection?: NonNullable<ProviderPreferencesOptions["dataCollection"]>;
src/internal/models.ts:85:   declare min_privacy?: NonNullable<ProviderPreferencesOptions["minPrivacy"]>;
src/internal/models.ts:87:   declare usage?: NonNullable<ProviderPreferencesOptions["usage"]>;
src/internal/models.ts:90:   [key: string]: unknown;
src/internal/models.ts:106:     if (sort !== null && !["price", "latency", "throughput"].includes(String(sort).toLowerCase())) {
src/internal/models.ts:109:     if (dataCollection !== null && !["allow", "deny"].includes(String(dataCollection).toLowerCase())) {
src/internal/models.ts:112:     if (minPrivacy !== null && !["any", "no_store", "zdr", "confidential", "e2e", "e2ee"].includes(String(minPrivacy).toLowerCase())) {
src/internal/models.ts:118:     if (usage !== null && !["credits", "byok"].includes(String(usage).toLowerCase())) {
src/internal/models.ts:121:     if (order !== null) this.order = [...order];
src/internal/models.ts:122:     if (only !== null) this.only = [...only];
src/internal/models.ts:123:     if (ignore !== null) this.ignore = [...ignore];
src/internal/models.ts:124:     if (sort !== null) this.sort = String(sort).toLowerCase() as NonNullable<ProviderPreferencesOptions["sort"]>;
src/internal/models.ts:127:     if (dataCollection !== null) this.data_collection = String(dataCollection).toLowerCase() as NonNullable<ProviderPreferencesOptions["dataCollection"]>;
src/internal/models.ts:128:     if (minPrivacy !== null) this.min_privacy = String(minPrivacy).toLowerCase() as NonNullable<ProviderPreferencesOptions["minPrivacy"]>;
src/internal/models.ts:130:     if (usage !== null) this.usage = String(usage).toLowerCase() as NonNullable<ProviderPreferencesOptions["usage"]>;
src/internal/models.ts:131:     if (quantizations !== null) this.quantizations = [...quantizations];
src/internal/models.ts:159:     params.set("provider[jurisdiction]", providerJurisdiction);
src/internal/models.ts:162:     params.set("provider[region]", providerRegion);
src/internal/orchestration.ts:158: export const ADVISOR_MODELS = Object.freeze(new Set([ADVISOR_MODEL]));
src/internal/orchestration.ts:176:   const tools = [...(bodyParams.tools ?? [])];
src/internal/orchestration.ts:180:   for (const [sdkKey, gatewayKey] of [
src/internal/orchestration.ts:181:     ["depth", "depth"],
src/internal/orchestration.ts:182:     ["workerModels", "worker_models"],
src/internal/orchestration.ts:183:     ["advisorModels", "advisor_models"],
src/internal/orchestration.ts:184:     ["maxGetAdviceCalls", "max_get_advice_calls"],
src/internal/orchestration.ts:185:     ["advisorMaxTokens", "advisor_max_tokens"],
src/internal/orchestration.ts:186:     ["workerTimeoutMs", "worker_timeout_ms"],
src/internal/orchestration.ts:187:     ["advisorTimeoutMs", "advisor_timeout_ms"],
src/internal/orchestration.ts:188:     ["autoInitialAdvice", "auto_initial_advice"],
src/internal/orchestration.ts:189:   ] as const) {
src/internal/orchestration.ts:191:       if (bodyParams[sdkKey] !== null && bodyParams[sdkKey] !== undefined) {
src/internal/orchestration.ts:192:         advisor[gatewayKey] = bodyParams[sdkKey];
src/internal/orchestration.ts:194:       delete bodyParams[sdkKey];
src/internal/orchestration.ts:197:   if (Object.keys(advisor).length > 0) {
src/internal/orchestration.ts:202:   for (const [sdkKey, gatewayKey] of [
src/internal/orchestration.ts:203:     ["analysisModels", "analysis_models"],
src/internal/orchestration.ts:204:     ["judgeModel", "model"],
src/internal/orchestration.ts:205:     ["selectionStrategy", "selection_strategy"],
src/internal/orchestration.ts:206:     ["fallbackJudges", "fallback_judges"],
src/internal/orchestration.ts:207:     ["fallbackFinalModels", "fallback_final_models"],
src/internal/orchestration.ts:208:     ["maxCompletionTokens", "max_completion_tokens"],
src/internal/orchestration.ts:209:     ["maxToolCalls", "max_tool_calls"],
src/internal/orchestration.ts:210:     ["preset", "preset"],
src/internal/orchestration.ts:211:     ["panelPrompt", "panel_prompt"],
src/internal/orchestration.ts:212:     ["synthesisPrompt", "synthesis_prompt"],
src/internal/orchestration.ts:213:     ["finalPrompt", "final_prompt"],
src/internal/orchestration.ts:214:     ["selectorModels", "selector_models"],
src/internal/orchestration.ts:215:     ["selectorModel", "selector_model"],
src/internal/orchestration.ts:216:     ["selectorPrompt", "selector_prompt"],
src/internal/orchestration.ts:217:     ["mapperModels", "mapper_models"],
src/internal/orchestration.ts:218:     ["mapperModel", "mapper_model"],
src/internal/orchestration.ts:219:     ["mapperPrompt", "mapper_prompt"],
src/internal/orchestration.ts:220:     ["parallelModels", "parallel_models"],
src/internal/orchestration.ts:221:     ["parallelModel", "parallel_model"],
src/internal/orchestration.ts:222:     ["parallelPrompt", "parallel_prompt"],
src/internal/orchestration.ts:223:     ["reducerModels", "reducer_models"],
src/internal/orchestration.ts:224:     ["reducerModel", "reducer_model"],
src/internal/orchestration.ts:225:     ["reducerPrompt", "reducer_prompt"],
src/internal/orchestration.ts:226:   ] as const) {
src/internal/orchestration.ts:228:       if (bodyParams[sdkKey] !== null && bodyParams[sdkKey] !== undefined) {
src/internal/orchestration.ts:229:         fusion[gatewayKey] = bodyParams[sdkKey];
src/internal/orchestration.ts:231:       delete bodyParams[sdkKey];
src/internal/orchestration.ts:234:   if (Object.keys(fusion).length > 0) {
src/internal/sse.ts:24:   // Non-string argument deltas are copied as-is; a later string uses JS += coercion.
src/internal/sse.ts:66:  * not return (no recorder) decodes exactly as before.
src/internal/sse.ts:98:   for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array<ArrayBuffer>>) {
src/internal/sse.ts:104:       if (data === "[DONE]") {
src/internal/sse.ts:109:         throw protocolError("TrustedRouter SSE emitted data after [DONE]");
src/internal/sse.ts:118:     if (data === "[DONE]") {
src/internal/sse.ts:123:       throw protocolError("TrustedRouter SSE emitted data after [DONE]");
src/internal/sse.ts:129:     throw protocolError("TrustedRouter SSE stream ended before data: [DONE]");
src/internal/sse.ts:138:   for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array<ArrayBuffer>>) {
src/internal/sse.ts:144:         if (frame.some((item) => sseData(item) === "[DONE]")) {
src/internal/sse.ts:150:           throw protocolError("TrustedRouter SSE emitted data after [DONE]");
src/internal/sse.ts:163:       if (frame.some((item) => sseData(item) === "[DONE]")) {
src/internal/sse.ts:169:         throw protocolError("TrustedRouter SSE emitted data after [DONE]");
src/internal/sse.ts:178:   if (frame.some((item) => sseData(item) === "[DONE]")) {
src/internal/sse.ts:182:       throw protocolError("TrustedRouter SSE emitted data after [DONE]");
src/internal/sse.ts:188:     throw protocolError("TrustedRouter SSE stream ended before data: [DONE]");
src/internal/sse.ts:195:   if (!data || data === "[DONE]") return null;
src/internal/sse.ts:200:     throw protocolError("Malformed JSON in TrustedRouter SSE data frame", {
src/internal/sse.ts:204:   if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
src/internal/sse.ts:210:   if (typeof (payload as JsonObject).error === "string" || ((payload as JsonObject).error && typeof (payload as JsonObject).error === "object")) {
src/internal/sse.ts:213:   return payload as JsonObject;
src/internal/sse.ts:228:   if (!data || data === "[DONE]") return null;
src/internal/sse.ts:233:     throw protocolError("Malformed JSON in TrustedRouter SSE event", {
src/internal/sse.ts:240:     typeof payload === "object" &&
src/internal/sse.ts:245:   return payload && typeof payload === "object"
src/internal/sse.ts:246:     ? payload as JsonObject | unknown[]
src/internal/sse.ts:256: // wire fields as unknown. This overload adds no runtime validation.
src/internal/sse.ts:273:     for (const [key, value] of Object.entries(c ?? {})) {
src/internal/sse.ts:274:       if (!["choices", "usage", "trustedrouter", "object"].includes(key)) {
src/internal/sse.ts:275:         envelope[key] = value;
src/internal/sse.ts:278:     if (c?.usage && typeof c.usage === "object") usage = c.usage;
src/internal/sse.ts:281:       const choice = c.choices[ordinal] as JsonObject | null | undefined;
src/internal/sse.ts:282:       if (!choice || typeof choice !== "object") continue;
src/internal/sse.ts:283:       const index = Number.isInteger(choice.index) ? choice.index as number : ordinal;
src/internal/sse.ts:300:       for (const [key, value] of Object.entries(choice)) {
src/internal/sse.ts:301:         if (!["index", "delta", "finish_reason"].includes(key)) {
src/internal/sse.ts:302:           state.choiceExtras[key] = value;
src/internal/sse.ts:306:       if (!delta || typeof delta !== "object" || Array.isArray(delta)) {
src/internal/sse.ts:309:       for (const [key, value] of Object.entries(delta as JsonObject)) {
src/internal/sse.ts:319:             state.messageExtras[key] = value;
src/internal/sse.ts:326:           state.messageExtras[key] = value;
src/internal/sse.ts:338:   const choices = [...choicesByIndex.keys()].sort((a, b) => a - b).map((index) => {
src/internal/sse.ts:343:       if (parts?.length) message[field] = parts.join("");
src/internal/sse.ts:344:       else if (state.seenDeltaFields.has(field) && !(field in message)) message[field] = null;
src/internal/sse.ts:347:       message.tool_calls = [...state.toolCalls.keys()]
src/internal/sse.ts:352:     if (!("content" in message)) {
src/internal/sse.ts:354:           ["reasoning", "reasoning_content", "refusal"].some((field) => field in message)
src/internal/sse.ts:386:     if (!trusted || typeof trusted !== "object" || Array.isArray(trusted)) continue;
src/internal/sse.ts:393:       ...Object.fromEntries(Object.entries(trusted as JsonObject).filter(([key]) => key !== "synth")),
src/internal/sse.ts:396:     const synth = (trusted as JsonObject).synth;
src/internal/sse.ts:397:     if (!synth || typeof synth !== "object" || Array.isArray(synth)) continue;
src/internal/sse.ts:404:   const hasSynth = synthEvents.length > 0 || Object.keys(synthDetails).length > 0;
src/internal/sse.ts:406:     return Object.keys(trustedRouterDetails).length ? trustedRouterDetails : null;
src/internal/sse.ts:437:   if (!detail || typeof detail !== "object" || Array.isArray(detail)) return null;
src/internal/sse.ts:439:   for (const key of ["stage", "index", "model"]) {
src/internal/sse.ts:440:     if (Object.hasOwn(event, key) && !Object.hasOwn(result, key)) result[key] = event[key];
src/internal/sse.ts:447:   (value as unknown[]).forEach((call, ordinal) => {
src/internal/sse.ts:448:     if (!call || typeof call !== "object") return;
src/internal/sse.ts:449:     const index = Number.isInteger((call as JsonObject).index) ? (call as JsonObject).index as number : ordinal;
src/internal/sse.ts:459:     for (const [key, item] of Object.entries(call as JsonObject)) {
src/internal/sse.ts:460:       if (!["index", "function"].includes(key)) slot[key] = item;
src/internal/sse.ts:462:     if ((call as JsonObject).function && typeof (call as JsonObject).function === "object") {
src/internal/sse.ts:463:       for (const [key, item] of Object.entries((call as JsonObject).function as JsonObject)) {
src/internal/sse.ts:464:         if (key === "arguments" && typeof item === "string") (slot.function.arguments as string) += item;
src/internal/sse.ts:465:         else if (item !== null && item !== undefined) slot.function[key] = item;
src/internal/sse.ts:472:   if (!value || typeof value !== "object" || Array.isArray(value)) return;
src/internal/sse.ts:474:   for (const [key, item] of Object.entries(value as JsonObject)) {
src/internal/sse.ts:475:     if (key === "arguments" && typeof item === "string") (state.functionCall.arguments as string) += item;
src/internal/sse.ts:476:     else if (item !== null && item !== undefined) state.functionCall[key] = item;
src/internal/telemetry.ts:3:  * docs/client-telemetry.md in Lore-Hex/quill-router).
src/internal/telemetry.ts:6:  * there is no free text anywhere. The only emitter is THE engine loop in
src/internal/telemetry.ts:17:  * a malformed header. Mirrors RequestRecorder in trusted-router-py
src/internal/telemetry.ts:41: ] as const);
src/internal/telemetry.ts:53: ] as const);
src/internal/telemetry.ts:61: ] as const);
src/internal/telemetry.ts:65: ] as const);
src/internal/telemetry.ts:81: ] as const);
src/internal/telemetry.ts:88: ] as const);
src/internal/telemetry.ts:102: ] as const);
src/internal/telemetry.ts:109: ] as const);
src/internal/telemetry.ts:110: export const TELEMETRY_ERROR_SOURCES = Object.freeze(["router", "provider", "unknown"] as const);
src/internal/telemetry.ts:116: ] as const);
src/internal/telemetry.ts:120: export const TELEMETRY_METHODS = Object.freeze(["GET", "POST"] as const);
src/internal/telemetry.ts:122: export type TelemetryHost = typeof TELEMETRY_HOSTS[number];
src/internal/telemetry.ts:123: export type TelemetryEndpoint = typeof TELEMETRY_ENDPOINTS[number];
src/internal/telemetry.ts:124: export type TelemetryOutcome = typeof TELEMETRY_OUTCOMES[number];
src/internal/telemetry.ts:125: export type TelemetryErrorClass = typeof TELEMETRY_ERROR_CLASSES[number];
src/internal/telemetry.ts:126: export type TelemetryTimeoutPhase = typeof TELEMETRY_TIMEOUT_PHASES[number];
src/internal/telemetry.ts:127: export type TelemetryLatencyBucket = typeof TELEMETRY_LATENCY_BUCKETS[number];
src/internal/telemetry.ts:128: type TelemetryStatusClass = typeof TELEMETRY_HTTP_STATUS_CLASSES[number];
src/internal/telemetry.ts:136:   errorSource: typeof TELEMETRY_ERROR_SOURCES[number] | null;
src/internal/telemetry.ts:149:   method: typeof TELEMETRY_METHODS[number];
src/internal/telemetry.ts:153:   attempts: ReturnType<RequestRecorder["_attemptRecord"]>[];
src/internal/telemetry.ts:176: export type TelemetryCounter = [CounterKey, CounterIncrement];
src/internal/telemetry.ts:198: export const MODEL_RE = /^[A-Za-z0-9._:/~@-]{1,128}$/;
src/internal/telemetry.ts:199: export const REQUEST_ID_RE = /^rlog_[0-9a-f]{32}$/;
src/internal/telemetry.ts:202: const HEADER_VALUE_RE = /^[a-z0-9_]{1,24}$/;
src/internal/telemetry.ts:211:   ["connect_timeout", "connect"],
src/internal/telemetry.ts:212:   ["read_timeout", "first_byte"],
src/internal/telemetry.ts:213:   ["write_timeout", "first_byte"],
src/internal/telemetry.ts:214:   ["pool_timeout", "none"],
src/internal/telemetry.ts:220: // vocabulary serializes as po=none with pc=none.
src/internal/telemetry.ts:227: const LATENCY_UPPER_BOUNDS = [100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600, 51200, 102400];
src/internal/telemetry.ts:229:   ["connect", 10_000],
src/internal/telemetry.ts:230:   ["first_byte", 60_000],
src/internal/telemetry.ts:231:   ["idle", 30_000],
src/internal/telemetry.ts:247:   const [scheme, host] = pair.split("//");
src/internal/telemetry.ts:259:   if (pair === schemeHost(ALIAS_API_BASE_URLS[0])) return "ally";
src/internal/telemetry.ts:260:   if (pair === schemeHost(ALIAS_API_BASE_URLS[1])) return "uptime";
src/internal/telemetry.ts:261:   const regions = ["us_central1", "us_east4", "europe_west4"] as const;
src/internal/telemetry.ts:263:     if (pair === schemeHost(REGION_BASE_URLS[index])) return regions[index]!;
src/internal/telemetry.ts:272:   ["/chat/completions", "chat_completions"],
src/internal/telemetry.ts:273:   ["/messages", "messages"],
src/internal/telemetry.ts:274:   ["/responses", "responses"],
src/internal/telemetry.ts:275:   ["/embeddings", "embeddings"],
src/internal/telemetry.ts:277: const PREFIX_ENDPOINTS: [string, TelemetryEndpoint][] = [
src/internal/telemetry.ts:278:   ["/images", "images"],
src/internal/telemetry.ts:279:   ["/videos", "videos"],
src/internal/telemetry.ts:280:   ["/models", "models"],
src/internal/telemetry.ts:281:   ["/fusion", "fusion"],
src/internal/telemetry.ts:293:   const cut = clean.search(/[?#]/);
src/internal/telemetry.ts:299:   for (const [prefix, endpoint] of PREFIX_ENDPOINTS) {
src/internal/telemetry.ts:305: /** The LatencyBucket (upper-bound-exclusive, ms) a duration falls in. */
src/internal/telemetry.ts:309:     if (value < LATENCY_UPPER_BOUNDS[index]!) return TELEMETRY_LATENCY_BUCKETS[index]!;
src/internal/telemetry.ts:311:   return TELEMETRY_LATENCY_BUCKETS[TELEMETRY_LATENCY_BUCKETS.length - 1]!;
src/internal/telemetry.ts:337:  * resolve_telemetry_enabled in trusted-router-py so the SDKs cannot drift.
src/internal/telemetry.ts:349:   if (["0", "false", "off", "no"].includes(configured)) return false;
src/internal/telemetry.ts:350:   if (["1", "true", "on", "yes"].includes(configured)) return true;
src/internal/telemetry.ts:358:  * Node's fetch reports the real failure as the `cause` of a generic
src/internal/telemetry.ts:361:  * cancellation check (transport.js) so there is ONE chain walker in the SDK.
src/internal/telemetry.ts:376:     current = (current as { cause?: unknown }).cause;
src/internal/telemetry.ts:402: const SOCKET_PROTOCOL_MESSAGES = new Set(["bad response", "bad upgrade"]);
src/internal/telemetry.ts:403: const SOCKET_CONNECT_MESSAGES = new Set(["bad connect"]);
src/internal/telemetry.ts:414: // Highest-priority class wins across the whole `cause` chain, in the same
src/internal/telemetry.ts:415: // order as the Python classifier: timeouts, then TLS/DNS/socket phases, then
src/internal/telemetry.ts:417: // as the `cause` of `TypeError: fetch failed` (verified against Node 20
src/internal/telemetry.ts:427: const ERROR_CLASSIFIERS: [TelemetryErrorClass, (code: string, name: string, message: string, syscall: string) => boolean][] = [
src/internal/telemetry.ts:457:   ["dns", (code) => code === "ENOTFOUND" || code === "EAI_AGAIN"],
src/internal/telemetry.ts:458:   ["connect_refused", (code) => code === "ECONNREFUSED"],
src/internal/telemetry.ts:467:       ["EHOSTUNREACH", "ENETUNREACH", "EADDRNOTAVAIL", "ECONNABORTED", "EHOSTDOWN"].includes(
src/internal/telemetry.ts:484:   ["io_error", (code) => code === "EPIPE" || code === "ERR_STREAM_PREMATURE_CLOSE"],
src/internal/telemetry.ts:496:     for (const [errorClass, matches] of ERROR_CLASSIFIERS) {
src/internal/telemetry.ts:498:         const code = typeof (item as { code?: unknown } | null | undefined)?.code === "string" ? (item as { code: string }).code : "";
src/internal/telemetry.ts:499:         const name = typeof (item as { name?: unknown } | null | undefined)?.name === "string" ? (item as { name: string }).name : "";
src/internal/telemetry.ts:500:         const message = typeof (item as { message?: unknown } | null | undefined)?.message === "string" ? (item as { message: string }).message : "";
src/internal/telemetry.ts:501:         const syscall = typeof (item as { syscall?: unknown } | null | undefined)?.syscall === "string" ? (item as { syscall: string }).syscall : "";
src/internal/telemetry.ts:519:     if (typeof (headers as { get?: (name: string) => unknown }).get === "function") return (headers as { get: (name: string) => unknown }).get(name) ?? null;
src/internal/telemetry.ts:521:     for (const [key, value] of Object.entries(headers)) {
src/internal/telemetry.ts:559:     if (response !== null && typeof response === "object") {
src/internal/telemetry.ts:598:  * Record the per-attempt facts of one logical inference call as the engine
src/internal/telemetry.ts:601:  * the sink. Mirrors RequestRecorder in trusted-router-py: beginAttempt /
src/internal/telemetry.ts:647:       (TELEMETRY_METHODS as readonly string[]).includes(this.method);
src/internal/telemetry.ts:695:    * newest attempt is ever serialised in the header (and the beacon event
src/internal/telemetry.ts:700:    * attempt rides in a parallel array.
src/internal/telemetry.ts:705:       this.attempts[attempt.index] = attempt;
src/internal/telemetry.ts:706:       this._attemptPhases[attempt.index] = phase;
src/internal/telemetry.ts:708:       this.attempts[this.attempts.length - 1] = attempt;
src/internal/telemetry.ts:709:       this._attemptPhases[this.attempts.length - 1] = phase;
src/internal/telemetry.ts:724:     return index < this.attempts.length ? this.attempts[index] : null;
src/internal/telemetry.ts:753:       row = [key, { requests: 0, attempts: 0, failover_used: 0, first_attempt_success: 0 }];
src/internal/telemetry.ts:756:     row[1].requests += 1;
src/internal/telemetry.ts:757:     row[1].attempts += 1;
src/internal/telemetry.ts:758:     row[1].failover_used += attempt.moved ? 1 : 0;
src/internal/telemetry.ts:767:    * with the contract's per-attempt response facts — `x-should-retry` as
src/internal/telemetry.ts:768:    * observed, the bounded Retry-After hint (seconds, as the engine parsed
src/internal/telemetry.ts:839:         TIMEOUT_ERROR_CLASSES.has(errorClass) || (error as { name?: unknown } | null | undefined)?.name === "TimeoutError";
src/internal/telemetry.ts:915:       this.attempts[this.attempts.length - 1]!.moved = true;
src/internal/telemetry.ts:969:         previous ? this._attemptPhases[index] ?? "none" : "none",
src/internal/telemetry.ts:977:    * The `x-tr-client` value for the attempt begun last, in the contract's
src/internal/telemetry.ts:978:    * exact key order: v,a[,po,pc,ph,pm,sm],s[,fo]. Returns null — send
src/internal/telemetry.ts:980:    * (values are ^[a-z0-9_]{1,24}$, whole header <= 160 bytes).
src/internal/telemetry.ts:993:       const values = ["v=1", `a=${this._currentIndex}`];
src/internal/telemetry.ts:995:         const previous = this.attempts[this.attempts.length - 1];
src/internal/telemetry.ts:1072:     const final = this._currentAttempt ?? attempts[attempts.length - 1]!;
src/internal/telemetry.ts:1084:       method: this.method as TelemetryEvent["method"],
src/internal/telemetry.ts:1115:       first_attempt_success: attempts[0]!.outcome === "ok" ? 1 : 0,
src/internal/telemetry.ts:1116:       total_ms_hist: { [latencyBucket(totalMs)]: 1 },
src/internal/telemetry.ts:1120:       requestIncrement.first_event_ms_hist = { [latencyBucket(firstEventMs)]: 1 };
src/internal/telemetry.ts:1122:     const counters: TelemetryCounter[] = [[requestKey, requestIncrement], ...this._attemptCounterRows.values()];
src/internal/transport.ts:6:  * in the codebase where a base-URL candidate index advances and the ONLY
src/internal/transport.ts:8:  * zero sleeps, zero index references. (The abort timer in fetchWithTimeout
src/internal/transport.ts:13:  * INVARIANTS (cross-SDK, keep in sync with ARCHITECTURE):
src/internal/transport.ts:21:  *        domain" and its streaming twin in test/should-retry-header.test.js.
src/internal/transport.ts:28:  *  (4) x-should-retry overrides both predicates in both directions: explicit
src/internal/transport.ts:46:  *      still retries in place.
src/internal/transport.ts:47:  *      — test/should-retry-header.test.js "a pinned client still retries in
src/internal/transport.ts:124:   return (headers as { get?: (name: string) => unknown } | null | undefined)?.get?.(name) ?? (headers as Record<string, unknown> | null | undefined)?.[name] ?? null;
src/internal/transport.ts:131:  * in front of it, an alias domain — so it is untrusted input, and it was being
src/internal/transport.ts:132:  * applied as an *uncapped* floor on the sleep. Non-finite values were already
src/internal/transport.ts:136:  * TimeoutOverflowWarning — a hot retry loop dressed as a long wait.
src/internal/transport.ts:139:  * a caller would rather have the error. Matches MAX_RETRY_AFTER_SECONDS in
src/internal/transport.ts:144: /** Clamp a parsed hint into [0, MAX_RETRY_AFTER_SECONDS], or reject it.
src/internal/transport.ts:208: // concrete request is enforced separately in the engine because it depends on
src/internal/transport.ts:214: const REPLAY_SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS", "TRACE"]);
src/internal/transport.ts:228:     if (safeCodes.has((link as { code?: unknown } | null | undefined)?.code)) return true;
src/internal/transport.ts:235:     error && typeof (error as { message?: unknown }).message === "string" ? (error as { message: string }).message : String(error);
src/internal/transport.ts:245:   // retry-after as a floor — bounded, so a hostile or broken hint cannot
src/internal/transport.ts:277:   // advance in performRequest is guarded by
src/internal/transport.ts:286:   if (primary !== DEFAULT_API_BASE_URL.replace(/\/+$/, "")) return [primary];
src/internal/transport.ts:287:   return [...new Set([primary, ...ALIAS_API_BASE_URLS.map((u) => u.replace(/\/+$/, ""))])];
src/internal/transport.ts:291:   return [...new Set([...REGION_BASE_URLS, primaryBaseUrl.replace(/\/+$/, "")])];
src/internal/transport.ts:369:   return [...new Set([winner, ctx.baseUrl, ...candidates, ...baseUrls(ctx.baseUrl)])];
src/internal/transport.ts:378:   // the SDK was invisible in the reliability data.
src/internal/transport.ts:411:   for (const [name, value] of new Headers(init ?? undefined)) out.set(name, value);
src/internal/transport.ts:453: const BODY_READERS = ["arrayBuffer", "blob", "bytes", "formData", "json", "text"] as const;
src/internal/transport.ts:456:  * Re-expose `response.body` as a stream that reports when it settles.
src/internal/transport.ts:461:  * Locking eagerly would have broken that, and every reader in BODY_READERS
src/internal/transport.ts:506:  * Instruments the Response in place rather than rebuilding it, so `url`,
src/internal/transport.ts:518:       // 204/HEAD, or a runtime that does not expose the body as a web stream:
src/internal/transport.ts:524:       const read: ((...args: unknown[]) => unknown) | undefined = response[name];
src/internal/transport.ts:584:  * LIFETIME. `fetch` resolves as soon as the response HEADERS arrive; the body
src/internal/transport.ts:597:  * here: on Node 20 — the floor in `engines` — a source signal retains every
src/internal/transport.ts:603:  * an SDK timeout surfaces as an AbortError and is never mistaken for the
src/internal/transport.ts:604:  * caller's reason nor recorded as a host fact.
src/internal/transport.ts:674:     typeof body === "object" &&
src/internal/transport.ts:676:     typeof (body as Record<string, unknown>).model === "string"
src/internal/transport.ts:677:     ? (body as { model: string }).model
src/internal/transport.ts:684:     body !== null && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>).provider : null;
src/internal/transport.ts:687:       typeof provider === "object" &&
src/internal/transport.ts:689:       (provider as Record<string, unknown>).allow_fallbacks === false,
src/internal/transport.ts:721:  * `_telemetryNow()` as the recorder clock).
src/internal/transport.ts:724:  * (the control plane passes `[controlBaseUrl]`, so a length-1 list makes the
src/internal/transport.ts:754:   // `signal.aborted` test is too coarse in the other direction: a genuine host
src/internal/transport.ts:763:   // and written to the wire as po=transport_error;ph=... against two
src/internal/transport.ts:781:         if ((link as { name?: unknown } | null | undefined)?.name === "AbortError") return { error, caller: false };
src/internal/transport.ts:841:   // mid-body become known. Plain passthrough when neither is in play.
src/internal/transport.ts:846:     let pendingSettlement: [BodySettlement, unknown] | null = null;
src/internal/transport.ts:868:           const [kind, error] = pendingSettlement;
src/internal/transport.ts:875:         if (decoderActive) pendingSettlement = [kind, error];
src/internal/transport.ts:892:     const url = `${candidates[baseIndex]}/${String(path).replace(/^\/+/, "")}`;
src/internal/transport.ts:898:       recorder.beginAttempt(candidates[baseIndex]!);
src/internal/transport.ts:914:         body: requestBody as BodyInit | null,
src/internal/transport.ts:958:         // A retryable status that is not safe to replay is surfaced as-is
src/internal/transport.ts:985:       baseIndex += 1; // THE ONLY candidate advance in the codebase.
src/internal/trust.ts:5:  * Lives in its own internal module so src/attestation.js can import it
src/internal/trust.ts:34:   ) as Promise<Record<string, unknown>>;
src/oauth.ts:7:  * `state` and the PKCE `codeVerifier` in sessionStorage across the
src/oauth.ts:14:  *   location.assign(url); // user approves in TrustedRouter, redirects back
src/oauth.ts:80:    * @param {Storage} [options.storage] - storage backend; defaults to
src/oauth.ts:82:    * @param {string} [options.storageKey] - sessionStorage key to use.
src/oauth.ts:107:    * @param {object} [opts] - forwarded to createOAuthAuthorization
src/oauth.ts:130:    * @param {URLSearchParams|string|null} [searchParams] - the callback
src/oauth.ts:140:         throw new BrowserOAuthError("missing state in OAuth callback");
src/oauth.ts:148:     if (!code) throw new BrowserOAuthError("missing code in OAuth callback");
src/oauth.ts:195:     if (typeof stored !== "object" || stored === null || Array.isArray(stored)) {
src/oauth.ts:201:     const codeVerifier = "codeVerifier" in stored ? stored.codeVerifier : undefined;
src/oauth.ts:208:     if ("state" in stored) {
src/receipts.ts:19:   [key: string]: unknown;
src/receipts.ts:68:   /** Exact GCP CS JWT bytes pinned by att_sha256 or embedded in a flattened receipt. */
src/receipts.ts:105: const B64URL_RE = /^[A-Za-z0-9_-]*$/;
src/receipts.ts:106: const NONCE_RE = /^[A-Za-z0-9_-]{1,88}$/;
src/receipts.ts:132:   return value !== null && typeof value === "object" && !Array.isArray(value);
src/receipts.ts:176:     while (/\s/.test(text[offset] ?? "") && /[\u0009\u000a\u000d\u0020]/.test(text[offset]!)) {
src/receipts.ts:182:     if (text[offset] !== '"') fail();
src/receipts.ts:193:         const escaped = text[offset]!;
src/receipts.ts:198:         if (escaped === "u" && /^[0-9a-fA-F]{4}$/.test(text.slice(offset + 1, offset + 5))) {
src/receipts.ts:204:       if (code <= 0x1f) fail("unescaped control character in string");
src/receipts.ts:214:     if (text[offset] === "}") {
src/receipts.ts:224:       if (text[offset] !== ":") fail();
src/receipts.ts:228:       if (text[offset] === "}") {
src/receipts.ts:232:       if (text[offset] !== ",") fail();
src/receipts.ts:242:     if (text[offset] === "]") {
src/receipts.ts:249:       if (text[offset] === "]") {
src/receipts.ts:253:       if (text[offset] !== ",") fail();
src/receipts.ts:262:     const char = text[offset];
src/receipts.ts:269:     for (const literal of ["true", "false", "null"]) {
src/receipts.ts:275:     const number = text.slice(offset).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
src/receipts.ts:277:       offset += number[0].length;
src/receipts.ts:315:       bytes[index] = binary.charCodeAt(index);
src/receipts.ts:341:   return new Uint8Array(await subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
src/receipts.ts:348:     difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
src/receipts.ts:360:     return left.length === right.length && left.every((value, i) => structuralEqual(value, right[i]));
src/receipts.ts:363:     const leftKeys = Object.keys(left);
src/receipts.ts:364:     const rightKeys = Object.keys(right);
src/receipts.ts:366:       leftKeys.every((key) => hasOwn(right, key) && structuralEqual(left[key], right[key]));
src/receipts.ts:403:         protected: parts[0]!, payload: parts[1]!, signature: parts[2]!,
src/receipts.ts:510:       ["verify"],
src/receipts.ts:529:   const value = claims[name];
src/receipts.ts:537:   const value = claims[name];
src/receipts.ts:548:   const value = claims[name];
src/receipts.ts:632: function digestClaim(record: Record<string, unknown>, name: string, response: false): ReceiptClaims["req"];
src/receipts.ts:680:       if (data[index + inner] !== sequence[inner]) continue outer;
src/receipts.ts:687: const LF_EVENT_END = new Uint8Array([0x0a, 0x0a]);
src/receipts.ts:688: const CRLF_EVENT_END = new Uint8Array([0x0d, 0x0a, 0x0d, 0x0a]);
src/receipts.ts:690: function nextSseEvent(data: Uint8Array, offset: number): [Uint8Array, number] | null {
src/receipts.ts:695:   return [data.subarray(offset, end), end];
src/receipts.ts:699:   return bytes.length >= prefix.length && prefix.every((byte, i) => bytes[i] === byte);
src/receipts.ts:704:   return start >= 0 && suffix.every((byte, i) => bytes[start + i] === byte);
src/receipts.ts:709: const DONE = encoder.encode("[DONE]");
src/receipts.ts:723:     if (index < body.length && body[index] !== 0x0a) continue;
src/receipts.ts:726:     if (line.length > 0 && line[line.length - 1] === 0x0d) {
src/receipts.ts:737:       if (payload[0] === 0x20) payload = payload.subarray(1);
src/receipts.ts:746:       if (name[0] === 0x20) name = name.subarray(1);
src/receipts.ts:800:     const [raw, nextOffset] = found;
src/receipts.ts:805:         "response stream receipt position check failed: data event follows [DONE]",
src/receipts.ts:829:         "response stream receipt position check failed: receipt is not the last data event before [DONE]",
src/receipts.ts:839:       preimage.push(event.name, new Uint8Array([0x0a]));
src/receipts.ts:846:     preimage.push(event.payload, new Uint8Array([0x0a]));
src/receipts.ts:857:       "response stream receipt position check failed: receipt is not followed by [DONE]",
src/receipts.ts:869:       keyCommitmentHex: [...commitment]
src/receipts.ts:946:   const commitment = await sha256(concatBytes([KEY_COMMITMENT_DOMAIN, publicKey]));
src/receipts.ts:968:  * bytes as `attestation` to check the pinned digest and verify the receipt-key
src/receipts.ts:1212:     nonce: (nonce as string | undefined) ?? null,
src/receipts.ts:1234:     if (iterable?.[Symbol.asyncIterator]) this._source = iterable[Symbol.asyncIterator]!();
src/receipts.ts:1235:     else if (iterable?.[Symbol.iterator]) this._source = iterable[Symbol.iterator]!();
src/receipts.ts:1243:   [Symbol.asyncIterator](): AsyncIterableIterator<Uint8Array> {
src/receipts.ts:1280:       const [raw, nextOffset] = found;
src/session.ts:27:   ca?: import("node:tls").ConnectionOptions["ca"] | null;
src/session.ts:37: type Jwks = NonNullable<VerifyGatewaySessionOptions["jwks"]>;
src/session.ts:40: // snapshotPolicy explicitly preserves absent array properties as undefined.
src/session.ts:92:     ALPNProtocols: ["http/1.1"],
src/session.ts:102:     const exporter = (socket.exportKeyingMaterial as ExportKeyingMaterial)(EXPORTER_LENGTH, EXPORTER_LABEL);
src/session.ts:165:   const followupExporter = (session.socket.exportKeyingMaterial as ExportKeyingMaterial)(
src/session.ts:176:     policy: meta.policy as AttestationPolicy,
src/session.ts:189:       ? [...policy.imageDigests]
src/session.ts:192:       ? [...policy.imageReferences]
src/session.ts:209:     const [{ randomBytes }, { connect }] = await Promise.all([
src/session.ts:226:     throw new AttestationVerificationError(`invalid baseUrl: ${(err as { message: unknown }).message}`);
src/session.ts:291:     (socket as TLSSocket & { writableDestroyed?: boolean }).writableDestroyed === true
src/session.ts:404:       buffer = Buffer.concat([buffer, chunk]);
src/session.ts:428:   const statusMatch = /^HTTP\/1\.([01]) ([0-9]{3})(?: .*)?$/.exec(lines[0] || "");
src/session.ts:432:   const httpMinor = statusMatch[1];
src/session.ts:433:   const statusCode = Number(statusMatch[2]);
```

## Wire-contract correction (found by the SDK conformance gate on PR #39)

The first cut of the `/auth/keys` guard required a `data` record because the hand-written
`OAuthKeyExchangeResponse` type declared one. The wire never guaranteed it: the conformance
harness (scenario `oauth-no-credentials`) answers `{key, user_id}` and the Python reference SDK
requires only `key`. The same guard family would also have rejected the control plane's legacy
userinfo answer `{data: {sub: null, workspace_id}}`. Rule adopted: a boundary guard requires the
fields the SDK consumes (and the wire guarantees), passes the rest through, and the declared type
is corrected to match the producer — never the other way round. The producers' literal payloads
now live in `test/wire-fixtures.test.js`; the local check is
`tr-conformance --sdk javascript --sdk-root javascript=<checkout>` from trusted-router-sdk-conformance.
