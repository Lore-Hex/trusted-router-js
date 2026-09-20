# Consumer DX (2026-09) — verification record

Work tree only, Node v20.20.2. No runtime dependencies added. No source modules,
remaining source assertions, public API type tests, parity tests, or fixtures changed.
`engines.node` remains `>=20`. No `packageManager` field: CI uses the committed
npm lockfile through `npm ci`, but the repository has no policy pinning an npm
version (release publishing explicitly installs npm@latest).

**Change inventory (file:line)**

| Location | Change |
|---|---|
| `tsconfig.build.json:13` | Emit declaration maps. |
| `package.json:32` | Export package metadata. All six conditional exports retain `types` first. |
| `package.json:36` | Ship `src` alongside `dist`, README, LICENSE and automatic package.json. |
| `package.json:58` | Add `npm run test:mutations`. |
| `package.json:87` | Declare only the CLI executable (built and source paths) side-effectful. |
| `.github/workflows/ci.yml:23` | Run mutation gate after `npm test` on every PR. |
| `eslint.config.mjs:27` | Explain why strict-boolean-expressions stays off; retain unsafe-*, no-assert-any, and computed-literal lookup restrictions. |
| `scripts/mutation-check.mjs:82` | Expose the source mutation runner for isolated subprocess checks; reject stale targets and survivors; restore exact original source and JS output in finally, preserving map directives. |
| `scripts/mutation-check.mjs:108` | Use an isolated lint-mutant directory, check the specific expected rule, clean up in finally, report 50/50, and avoid rewriting the historical audit record. |
| `test/mutation-check.test.js:9` | Four isolated subprocess tests: stale, surviving, killed and compile-error mutations; verify exit status and exact restoration. |
| `test/package.test.js:29` | Update manifest assertions for sources and metadata export; assert condition ordering. |
| `test/package.test.js:143` | Restrict pack contents and require source/declaration-map artifacts. |
| `test/package.test.js:151` | Install a real tarball offline into a scratch consumer, compile with traceResolution, follow all 40 maps, import package metadata, and bundle VERSION and the CLI side-effect import. |
| `test/cli.test.js:610` | Six command × global-option matrices, plain/JSON outputs and 503 failure envelopes. |
| `test/cli.test.js:652` | Model alias and plain streaming request/output test. |
| `test/cli.test.js:664` | Invalid retries and unexpected operand errors. |
| `test/cli.test.js:680` | Verify/session failure envelopes and follow-up socket cleanup. |
| `scripts/consumer-dx-mutations.mjs:1` | Reproducible 27-case consumer-DX negative-control runner; restores every mutation in finally. |
| `docs/consumer-dx-2026-09.md:1` | This inventory, coverage/side-effect tables, verification results, and complete pack listing. |

**Command × option coverage, before → after**

Coverage is through `runCli` imported from `dist/cli/main.js`; the package suite
also executes `dist/cli.js` and the installed npm bin. Before: 34 CLI tests.
After: 44 CLI tests, all passing. “Yes” means asserted invocation, not a coverage
percentage. Every parseArgs table entry and short alias is exercised.

| Command | `--json` | `--retries` | `--help` / `-h` | `--version` / `-V` with command | Non-zero paths |
|---|---|---|---|---|---|
| chat | JSONL only → JSONL + complete envelope | 4 → 0 and 4 | long only → both | absent → both | input/usage/auth → also API 503 envelope |
| models | yes → yes | absent → zero + invalid values | long only → both | absent → both | usage/API/auth/permission/runtime → also positional rejection |
| providers | yes → yes | absent → zero | absent → both | absent → both | absent → API 503 + positional rejection |
| regions | yes → yes | absent → zero | absent → both | absent → both | absent → API 503 + positional rejection |
| trust | yes → yes | absent → zero | absent → both | absent → both | absent → API 503 + positional rejection |
| attest | raw/verify/session → unchanged + raw exit assertion | absent → zero | absent → both | absent → both | connect-ip usage → also API 503, positional, verify/session errors |

| Command | Command-specific option | Before | After |
|---|---|---|---|
| chat | `--model` / `-m` | long flag request + empty-model error | both aliases; exact request asserted |
| chat | `--max-tokens` | 321 request + zero rejected | also minimum 1 in streaming request |
| chat | `--stream` | JSONL deltas and done envelope | also exact plain text with final newline |
| attest | `--verify` | verified JSON envelope, policy and signature delegation | also exit 1 + exact failure envelope |
| attest | `--session` | verified JSON envelope, follow-up and socket cleanup | also failed follow-up exit 1 + cleanup |
| attest | `--connect-ip` | passed to verifier; missing-session/blank rejected | retained |
| models/providers/regions/trust | no command-specific options | JSON success tested | also exact pretty plain output |
| global, no command | `--help`, `--json --help`, `--version`, `--json --version` | help/version shapes tested | retained; short forms also tested with every command |

**Side-effect audit — all 20 source modules**

The array form is necessary because importing the executable invokes the CLI.
Other modules only define code or allocate private constants; none registers
globals, mutates prototypes, initiates I/O or starts a timer at import time.

| Module and evidence | Import-time work | Verdict |
|---|---|---|
| `src/cli.ts:5` | Runs CLI from argv and assigns process.exitCode | Side effect; preserve both `dist/cli.js` and `src/cli.ts` |
| `src/cli/main.ts:70` | Exit constants, local option sets and help strings | Safe to omit when unused |
| `src/index.ts:28` | Public exports/type declarations | Safe to omit when unused |
| `src/client.ts:76` | Frozen local default objects; env/fetch reads occur in constructor | Safe to omit when unused |
| `src/attestation.ts:83` | String constants and image regex | Safe to omit when unused |
| `src/oauth.ts:54` | Storage key constant; storage/location access is deferred to calls | Safe to omit when unused |
| `src/receipts.ts:102` | Private encoders, decoder, regexes and byte arrays | Safe to omit when unused |
| `src/session.ts:62` | Private WeakMap and null runtime cache; Node imports deferred | Safe to omit when unused |
| `src/internal/beacon.ts:103` | Constants/sets; private reporter set at 489; exit hook registered only by registerLive at 495 | Safe to omit when unused |
| `src/internal/errors.ts:1` | Error class/function definitions | Safe to omit when unused |
| `src/internal/models.ts:15` | Constants/frozen arrays and class definition | Safe to omit when unused |
| `src/internal/orchestration.ts:158` | Private model sets and function definitions | Safe to omit when unused |
| `src/internal/pkce.ts:1` | Function definitions; crypto used on calls | Safe to omit when unused |
| `src/internal/receipt-dependencies.ts:7` | Local function-reference object | Safe to omit when unused |
| `src/internal/records.ts:1` | Function definitions | Safe to omit when unused |
| `src/internal/sse.ts:1` | Imports and function definitions | Safe to omit when unused |
| `src/internal/telemetry.ts:32` | Frozen vocabularies, maps, sets, private NullSink and WeakMap | Safe to omit when unused |
| `src/internal/transport.ts:398` | DEFAULT_USER_AGENT snapshots process.versions.node; local method set | Pure runtime-version read, no env reads or observable mutation; safe to omit when unused |
| `src/internal/trust.ts:38` | Function alias | Safe to omit when unused |
| `src/internal/wire.ts:5` | Local validator closures | Safe to omit when unused |

The scratch-consumer esbuild smoke imports only VERSION. Its output contains no
transport, telemetry or beacon contributions (metafile bytesInOutput checked),
and no userAgent/TELEMETRY_/client-events code. Changing metadata to true retains
`function userAgent` and `TELEMETRY_` code. A separate side-effect-only import
proves the CLI executable survives bundling; replacing the array with false
fails that assertion. No runtime source changes or pure annotations were needed.

**Verification**

| Check | Result |
|---|---|
| `npm run build` | Passed on Node 20.20.2 |
| `npm run lint` | Passed; no new any or source assertions |
| `npm run check` | Passed, including unchanged `test/types/public-api.test-d.ts` and six declaration-sync tests |
| `npm test` | 580 tests: 575 passed, five sandbox-blocked TLS tests; no skips |
| `npm run lint:package` | Passed publint and attw esm-only, including package.json export |
| `npm run test:mutations` | 48 source + two lint mutants killed; stale/survivor/restoration controls also tested |
| `node scripts/consumer-dx-mutations.mjs` | 27/27 killed; see individual results below |
| `npm pack --dry-run --json` | 103 files; only dist, src, README, LICENSE and package.json |
| Scratch consumer | Tarball installed offline, strict NodeNext tsc trace resolves root declarations; all 20 declaration maps and 20 JS maps resolve to corresponding shipped source with matching contents |
| SDK conformance | Sandbox-blocked before first check: `PermissionError: [Errno 1] Operation not permitted` while binding `127.0.0.1`; 0 checks executed, expected 25/25 cannot be claimed |
| Protected files | Public API test, source modules, parity tests/fixtures and historical audit mutation record unchanged |

The five TLS failures are at `test/session.test.js:207`, `:294`, `:375`, `:509`
and `:587`, all with `listen EPERM: operation not permitted 127.0.0.1`.
The exact requested conformance executable was invoked against this checkout;
it failed in `FaultServer` before reaching the JavaScript adapter.

The normal `&&` verification chain stopped on the five TLS failures; package
lint was then run separately and passed. Standalone npm pack/package lint use
`npm_config_cache=/private/tmp/tr-consumer-dx-npm-cache` because the sandbox cannot
write the default ~/.npm cache. No dependency or lockfile changes were needed.

The consumer uses a real tsconfig and the repository's already-installed Node
type definitions through typeRoots; it fetches no registry dependencies. All
40 source mappings are followed explicitly (tsc resolution alone does not
follow declaration maps). Root maps use `../src/...`; nested maps use
`../../src/...`. Missing, empty, escaped and wrong-module maps are rejected.

**Fails-without-fix evidence**

The boundary-audit runner retains all 48 recorded source mutations and two lint mutants
from `docs/boundary-audit-2026-09-mutations.md`; all 50 were killed again in 12.84 seconds. SHA-256 comparisons confirmed that source,
built output, fixtures, the public API type test and the historical mutation record
were unchanged after the run. Each
source mutation restores the original source and exact built JS bytes in finally,
including the original sourceMappingURL. The historical record is not regenerated
on every CI run. The consumer-DX controls below are reproducible with
`node scripts/consumer-dx-mutations.mjs` after building, without concurrent tests.

| Mutation | Observed failure | Result |
|---|---|---|
| Remove declarationMap and rebuild | Installed declaration lacks sourceMappingURL; consumer cannot follow to source | killed |
| Omit src from files | Map target absent in installed package | killed |
| Set sideEffects true | VERSION bundle includes transport/telemetry contributions | killed |
| Set sideEffects false | Side-effect-only CLI import erased | killed |
| Remove package.json export | Installed metadata import rejected | killed |
| Move types condition after import | Manifest ordering assertion fails | killed |
| Add scripts to files | Pack allowlist assertion fails | killed |
| Empty JS map sources | Map must name one source | killed |
| JS map points to src/client.ts instead of src/index.ts | Corresponding-module assertion fails | killed |
| JS map points outside shipped src | Shipped source containment assertion fails | killed |
| Empty declaration map sources | Map must name one source | killed |
| Declaration map points to src/client.ts instead of src/index.ts | Corresponding-module assertion fails | killed |
| Declaration map points outside shipped src | Shipped source containment assertion fails | killed |
| chat global-option test: expect exit 1 instead of 0 | Focused CLI test assertion fails | killed |
| models global-option test: expect exit 1 instead of 0 | Focused CLI test assertion fails | killed |
| providers global-option test: expect exit 1 instead of 0 | Focused CLI test assertion fails | killed |
| regions global-option test: expect exit 1 instead of 0 | Focused CLI test assertion fails | killed |
| trust global-option test: expect exit 1 instead of 0 | Focused CLI test assertion fails | killed |
| attest global-option test: expect exit 1 instead of 0 | Focused CLI test assertion fails | killed |
| chat alias/plain-stream test: expect exit 1 instead of 0 | Focused CLI test assertion fails | killed |
| invalid numeric/operand test: expect exit 0 instead of 2 | Focused CLI test assertion fails | killed |
| attest verify failure test: expect exit 0 instead of 1 | Focused CLI test assertion fails | killed |
| attest session failure test: expect exit 0 instead of 1 | Focused CLI test assertion fails | killed |
| Delete stale-pattern rejection | Subprocess no longer reports missing mutation target | killed |
| Delete survivor rejection | Surviving subprocess exits 0 | killed |
| Delete source restoration | Fixture source remains mutated | killed |
| Delete output restoration | Fixture JS remains mutated | killed |

**Complete npm pack dry-run listing**

103 files: 80 dist files, 20 src files, and three root files. Tarball size
306,625 bytes; unpacked size 1,244,058 bytes. The executable retains mode 0755.
No test/, scripts/, docs/, configs or lockfile is shipped.

```text
LICENSE
README.md
dist/attestation.d.ts
dist/attestation.d.ts.map
dist/attestation.js
dist/attestation.js.map
dist/cli.d.ts
dist/cli.d.ts.map
dist/cli.js
dist/cli.js.map
dist/cli/main.d.ts
dist/cli/main.d.ts.map
dist/cli/main.js
dist/cli/main.js.map
dist/client.d.ts
dist/client.d.ts.map
dist/client.js
dist/client.js.map
dist/index.d.ts
dist/index.d.ts.map
dist/index.js
dist/index.js.map
dist/internal/beacon.d.ts
dist/internal/beacon.d.ts.map
dist/internal/beacon.js
dist/internal/beacon.js.map
dist/internal/errors.d.ts
dist/internal/errors.d.ts.map
dist/internal/errors.js
dist/internal/errors.js.map
dist/internal/models.d.ts
dist/internal/models.d.ts.map
dist/internal/models.js
dist/internal/models.js.map
dist/internal/orchestration.d.ts
dist/internal/orchestration.d.ts.map
dist/internal/orchestration.js
dist/internal/orchestration.js.map
dist/internal/pkce.d.ts
dist/internal/pkce.d.ts.map
dist/internal/pkce.js
dist/internal/pkce.js.map
dist/internal/receipt-dependencies.d.ts
dist/internal/receipt-dependencies.d.ts.map
dist/internal/receipt-dependencies.js
dist/internal/receipt-dependencies.js.map
dist/internal/records.d.ts
dist/internal/records.d.ts.map
dist/internal/records.js
dist/internal/records.js.map
dist/internal/sse.d.ts
dist/internal/sse.d.ts.map
dist/internal/sse.js
dist/internal/sse.js.map
dist/internal/telemetry.d.ts
dist/internal/telemetry.d.ts.map
dist/internal/telemetry.js
dist/internal/telemetry.js.map
dist/internal/transport.d.ts
dist/internal/transport.d.ts.map
dist/internal/transport.js
dist/internal/transport.js.map
dist/internal/trust.d.ts
dist/internal/trust.d.ts.map
dist/internal/trust.js
dist/internal/trust.js.map
dist/internal/wire.d.ts
dist/internal/wire.d.ts.map
dist/internal/wire.js
dist/internal/wire.js.map
dist/oauth.d.ts
dist/oauth.d.ts.map
dist/oauth.js
dist/oauth.js.map
dist/receipts.d.ts
dist/receipts.d.ts.map
dist/receipts.js
dist/receipts.js.map
dist/session.d.ts
dist/session.d.ts.map
dist/session.js
dist/session.js.map
package.json
src/attestation.ts
src/cli.ts
src/cli/main.ts
src/client.ts
src/index.ts
src/internal/beacon.ts
src/internal/errors.ts
src/internal/models.ts
src/internal/orchestration.ts
src/internal/pkce.ts
src/internal/receipt-dependencies.ts
src/internal/records.ts
src/internal/sse.ts
src/internal/telemetry.ts
src/internal/transport.ts
src/internal/trust.ts
src/internal/wire.ts
src/oauth.ts
src/receipts.ts
src/session.ts
```
