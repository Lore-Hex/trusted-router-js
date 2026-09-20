// Run after npm run build. Each mutation is restored even when its check throws.
// These are runtime regression checks: esbuild permits the old unsafe TS assertions.
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { buildSync } from "esbuild";

const cases = [];
function mutation(name, file, before, after, test, pattern = "Boundary audit") {
  cases.push({ name, file: `src/${file}`, before, after, test: `test/${test}.test.js`, pattern });
}
const deep = "deep-hardening";
mutation("header own lookup and HeadersInit", "internal/transport.ts",
  /export function readHeader\(headers: HeaderSource, name: string\): unknown \{[\s\S]*?\n\}/,
  'export function readHeader(headers: HeaderSource, name: string): unknown { return (headers as { get?: (name: string) => unknown } | null | undefined)?.get?.(name) ?? (headers as Record<string, unknown> | null | undefined)?.[name] ?? null; }',
  "headers");
mutation("telemetry tuple headers", "internal/telemetry.ts", "    return readHeader(headers, name);",
  '    if (typeof (headers as { get?: unknown }).get === "function") return (headers as Headers).get(name);\n    for (const [key, value] of Object.entries(headers)) if (key.toLowerCase() === name.toLowerCase()) return value;', "telemetry-record");
mutation("error attribution records", "internal/errors.ts",
  '    const record = isRecord(payload) ? payload : {};\n    const detail = isRecord(record.error) ? record.error : record;',
  '    const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};\n    const detail = record.error && typeof record.error === "object" ? record.error as Record<string, unknown> : record;', deep);
mutation("error message records", "internal/errors.ts", 'if (isRecord(payload)) {\n    if (isRecord(payload.error))',
  'if (payload && typeof payload === "object") {\n    if ((payload as Record<string, unknown>).error && typeof (payload as Record<string, unknown>).error === "object")', deep);
mutation("trust release record", "internal/trust.ts", "return requireRecord(await jsonOrThrow(", "return (await jsonOrThrow(", deep);
mutation("request record", "client.ts", "return requireRecord(await requestJson(this, method, path, init));", "return await requestJson(this, method, path, init) as Record<string, unknown>;", deep);
mutation("status record", "client.ts", "return requireRecord(await jsonOrThrow(", "return (await jsonOrThrow(", deep);
for (const [name, fn] of [["responses shape", "responseObject"], ["token shape", "responseTokens"], ["userinfo shape", "userInfo"], ["OAuth shape", "keyExchange"]]) {
  mutation(name, "client.ts", `return ${fn}(await this.`, "return (await this.", deep);
}
mutation("chat chunk shape", "client.ts", "yield chatChunk(chunk);", "yield chunk;", deep);
mutation("SSE event array shape", "internal/sse.ts",
  '  if (Array.isArray(payload)) throw protocolError("TrustedRouter SSE event must not be an array", payload);', "", deep);
mutation("SSE usage record", "internal/sse.ts", "if (isRecord(c?.usage))", 'if (c?.usage && typeof c.usage === "object")', deep);
mutation("SSE choice record", "internal/sse.ts", "if (!isRecord(choice)) continue;", 'if (!choice || typeof choice !== "object") continue;', deep);
mutation("SSE tool record", "internal/sse.ts", "if (!isRecord(call)) return;", 'if (!call || typeof call !== "object") return;', deep);
mutation("SSE tool function record", "internal/sse.ts", "if (isRecord(call.function))", 'if (call.function && typeof call.function === "object")', deep);
for (const [name, before, after] of [
  ["envelope", "setOwn(envelope, key, value);", "envelope[key] = value;"],
  ["choice", "setOwn(state.choiceExtras, key, value);", "state.choiceExtras[key] = value;"],
  ["message", "setOwn(state.messageExtras, key, value);", "state.messageExtras[key] = value;"],
  ["tool", "setOwn(slot, key, item);", "slot[key] = item;"],
  ["tool function", "setOwn(slot.function, key, item);", "slot.function[key] = item;"],
  ["function call", "setOwn(state.functionCall, key, item);", "state.functionCall[key] = item;"],
  ["synth", "else for (const [key, value] of Object.entries(synthChunk)) setOwn(synthDetails, key, value);", "else Object.assign(synthDetails, synthChunk);"],
]) mutation(`SSE ${name} prototype key`, "internal/sse.ts", before, after, deep, `Boundary audit: completion ${name} copies`);
mutation("JWT record boundary", "attestation.ts",
  '  if (!isRecord(header) || !isRecord(payload)) {\n    throw new AttestationVerificationError("JWT header and claims must be objects");\n  }', "", "attestation");
mutation("fetched JWKS keys", "attestation.ts", "!isRecord(data) || !Array.isArray(data.keys) || !data.keys.every(isRecord)", '!data || !Array.isArray((data as { keys?: unknown }).keys)', "attestation");
mutation("supplied JWKS keys", "attestation.ts",
  '  if (!isRecord(jwks) || !Array.isArray(jwks.keys) || !jwks.keys.every(isRecord)) {\n    throw new AttestationVerificationError("JWKS keys must be objects");\n  }', "", "attestation");
mutation("RSA JWK fields", "attestation.ts",
  '  if (typeof jwk.n !== "string" || typeof jwk.e !== "string") {\n    throw new AttestationVerificationError("RSA JWK n and e must be strings");\n  }', "", "attestation");
mutation("JWT nested container", "attestation.ts",
  '  if (!isRecord(claims.submods) || !isRecord(claims.submods.container)) {\n    throw new AttestationVerificationError("JWT submods.container must be an object");\n  }\n  const submods = claims.submods.container;',
  '  const submods = ((claims.submods || {}) as Record<string, unknown>).container || {};', "attestation");
mutation("JWT nonce array", "attestation.ts", '  if (!Array.isArray(nonces)) throw new AttestationVerificationError("JWT nonces must be a string or array");', "", "attestation");
for (const [name, before, after] of [
  ["identity", "isRecord(identity) ? identity : {}", 'identity && typeof identity === "object" ? identity : {}'],
  ["attempt", "isRecord(attempt) ? attempt : {}", 'attempt && typeof attempt === "object" ? attempt : {}'],
  ["event", "isRecord(event) ? event : {}", 'event && typeof event === "object" ? event : {}'],
  ["event attempts", ".filter(isRecord)", '.filter((item) => item && typeof item === "object")'],
  ["increment", "isRecord(increment) ? increment : {}", 'increment && typeof increment === "object" ? increment : {}'],
  ["histogram", "if (!isRecord(source)) return;", 'if (!source || typeof source !== "object") return;'],
  ["counter row", "isRecord(counts) ? counts : {}", 'counts && typeof counts === "object" ? counts : {}'],
  ["counter input", "!isRecord(increment)", '!increment || typeof increment !== "object"'],
  ["request", "isRecord(event) ? event : {}", 'event && typeof event === "object" ? event : {}'],
  ["policy envelope", "isRecord(payload) ? payload.policy : null", 'payload && typeof payload === "object" ? payload.policy : null'],
  ["policy", "if (!isRecord(policy)) return;", 'if (!policy || typeof policy !== "object") return;'],
]) mutation(`beacon ${name} record`, "internal/beacon.ts", before, after, "telemetry-beacon", `Boundary audit: beacon ${name} rejects`);
mutation("CLI attestation record", "cli/main.ts", 'isRecord(value) && Object.hasOwn(value, "rawClaims")', 'value && typeof value === "object" && "rawClaims" in value', "cli");

mutation("transport pre-send error record", "internal/transport.ts", '(isRecord(link) ? link.code : undefined)', '(link as { code?: unknown } | null | undefined)?.code', deep);
mutation("transport cancellation error record", "internal/transport.ts", '(isRecord(link) ? link.name : undefined)', '(link as { name?: unknown } | null | undefined)?.name', deep);
mutation("transport message record", "internal/transport.ts", '    errorText(error);', '    error && typeof (error as { message?: unknown }).message === "string" ? (error as { message: string }).message : String(error);', deep);
mutation("telemetry cause record", "internal/telemetry.ts", 'isRecord(current) ? current.cause : undefined', '(current as { cause?: unknown }).cause', "telemetry-record");
mutation("telemetry classifier records", "internal/telemetry.ts", 'isRecord(item) && typeof item.', 'item && typeof item.', "telemetry-record");
mutation("telemetry timeout record", "internal/telemetry.ts", '(isRecord(error) ? error.name : undefined)', '(error as { name?: unknown } | null | undefined)?.name', "telemetry-record");

function compile(file) {
  buildSync({ entryPoints: [file], outfile: file.replace(/^src\//, "dist/").replace(/\.ts$/, ".js"), format: "esm", platform: "node", target: "node20", logLevel: "silent" });
}
const report = [];
for (const c of cases) {
  const original = readFileSync(c.file, "utf8");
  // Mutate every occurrence of the same boundary (message paths and event entry points).
  const mutant = typeof c.before === "string" ? original.split(c.before).join(c.after) : original.replace(c.before, c.after);
  if (mutant === original) throw new Error(`Mutation target missing: ${c.name}`);
  try {
    writeFileSync(c.file, mutant);
    compile(c.file);
    const run = spawnSync(process.execPath, ["--test", `--test-name-pattern=${c.pattern}`, c.test], { encoding: "utf8" });
    const failed = /\nnot ok /m.test(run.stdout);
    const killed = run.status !== 0 && failed;
    const failures = [...run.stdout.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1]);
    report.push({ name: c.name, file: c.file, killed, failures });
    console.log(`${killed ? "KILLED" : "SURVIVED"}: ${c.name}`);
    if (!killed) console.log(run.stdout.slice(-1200), run.stderr);
  } finally {
    writeFileSync(c.file, original);
    compile(c.file);
  }
}
const mutantFile = "src/__wave_b_mutant.ts";
for (const [name, source] of [
  ["lint prototype literal", 'export function regression(key: string) { return ({ linux: "linux" })[key as "linux"]; }\n'],
  ["lint JSON.parse assertion", 'interface SomeType { value: string }\nexport function regression(text: string) { return JSON.parse(text) as SomeType; }\n'],
]) {
  try {
    writeFileSync(mutantFile, source);
    const run = spawnSync("npm", ["run", "lint"], { encoding: "utf8" });
    const killed = run.status !== 0 && /no-restricted-syntax|boundaries\/no-assert-any/.test(run.stdout);
    report.push({ name, file: mutantFile, killed, failures: [run.stdout.match(/error\s+.+/g)?.join("; ") ?? run.stderr] });
    console.log(`${killed ? "KILLED" : "SURVIVED"}: ${name}`);
  } finally { unlinkSync(mutantFile); }
}
writeFileSync("docs/boundary-audit-2026-09-mutations.md", "# Boundary audit mutation results\n\nEach source mutation was transpiled, its focused tests run, and the original source/output restored in a finally block. Both lint mutants ran `npm run lint`.\n\n| Mutation | Source | Result | Failing regression / rule |\n|---|---|---|---|\n" + report.map((r) => `| ${r.name} | ${r.file} | ${r.killed ? "killed" : "SURVIVED"} | ${r.failures.join("; ").replaceAll("|", "\\|")} |`).join("\n") + "\n");
if (report.some((r) => !r.killed)) process.exitCode = 1;
