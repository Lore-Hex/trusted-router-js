// Run after build, with no concurrent build/test commands: temporary mutations
// are restored in finally. The historical 48+2 audit remains test:mutations.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

function run(args) {
  return spawnSync(process.execPath, args, { encoding: "utf8" });
}
function build() {
  const result = run(["scripts/build.mjs"]);
  assert.equal(result.status, 0, result.stderr);
}
let killed = 0;
function check(name, file, replace, test, pattern, rebuild = false) {
  const original = readFileSync(file, "utf8");
  const changed = replace(original);
  assert.notEqual(changed, original, `Stale mutation: ${name}`);
  try {
    writeFileSync(file, changed);
    if (rebuild) build();
    const result = run(["--test", `--test-name-pattern=${pattern}`, test]);
    assert.notEqual(result.status, 0, `SURVIVED: ${name}`);
    assert.match(result.stdout, /\nnot ok /, `${name}: expected assertion failure, not infrastructure failure\n${result.stderr}`);
    console.log(`KILLED: ${name}`);
    killed += 1;
  } finally {
    writeFileSync(file, original);
    if (rebuild) build();
  }
}
const consumer = "packed consumer";
const packageTest = "test/package.test.js";
const json = (edit) => (source) => {
  const value = JSON.parse(source);
  edit(value);
  return JSON.stringify(value, null, 2) + "\n";
};
check("remove declarationMap", "tsconfig.build.json", json((config) => { delete config.compilerOptions.declarationMap; }), packageTest, consumer, true);
check("omit shipped source", "package.json", json((pkg) => { pkg.files = pkg.files.filter((file) => file !== "src"); }), packageTest, consumer);
check("sideEffects true retains transport/telemetry", "package.json", json((pkg) => { pkg.sideEffects = true; }), packageTest, consumer);
check("sideEffects false erases executable side effect", "package.json", json((pkg) => { pkg.sideEffects = false; }), packageTest, consumer);
check("metadata export missing", "package.json", json((pkg) => { delete pkg.exports["./package.json"]; }), packageTest, consumer);
check("types condition ordered last", "package.json", json((pkg) => { pkg.exports["."] = { import: "./dist/index.js", types: "./dist/index.d.ts" }; }), packageTest, "package manifest");
check("scripts leaked into package", "package.json", json((pkg) => { pkg.files.push("scripts"); }), packageTest, "npm dry-run");
for (const extension of ["js", "d.ts"]) {
  check(`${extension} map has no sources`, `dist/index.${extension}.map`, json((map) => { map.sources = []; }), packageTest, consumer);
  check(`${extension} map points at the wrong shipped module`, `dist/index.${extension}.map`, json((map) => { map.sources = ["../src/client.ts"]; }), packageTest, consumer);
  check(`${extension} map points outside shipped source`, `dist/index.${extension}.map`, json((map) => { map.sources = ["../missing.ts"]; }), packageTest, consumer);
}

// Invert an exit assertion independently for each newly added CLI test.
const cliFile = "test/cli.test.js";
for (const command of ["chat", "models", "providers", "regions", "trust", "attest"]) {
  check(`${command} CLI matrix wrong exit`, cliFile, (source) => source.replace(
    'assert.equal(result.code, EXIT_SUCCESS);\n    assert.deepEqual(JSON.parse(result.stdout), { ok: true, command, data });',
    'assert.equal(result.code, EXIT_ERROR);\n    assert.deepEqual(JSON.parse(result.stdout), { ok: true, command, data });',
  ), cliFile, `CLI coverage: ${command} global options`);
}
for (const [name, marker, before, after] of [
  ["chat alias/stream wrong exit", 'test("CLI coverage: chat model alias', "EXIT_SUCCESS", "EXIT_ERROR"],
  ["numeric/operands wrong exit", 'test("CLI coverage: invalid numeric', "EXIT_USAGE", "EXIT_SUCCESS"],
  ["attest verify wrong exit", 'for (const mode of ["verify", "session"])', "EXIT_ERROR", "EXIT_SUCCESS"],
  ["attest session wrong exit", 'for (const mode of ["verify", "session"])', "EXIT_ERROR", "EXIT_SUCCESS"],
]) {
  const pattern = name.startsWith("attest") ? `CLI coverage: attest ${name.split(" ")[1]} verification failure` : name.startsWith("chat") ? "CLI coverage: chat model alias" : "CLI coverage: invalid numeric";
  check(name, cliFile, (source) => {
    const start = source.indexOf(marker);
    assert.ok(start >= 0);
    return source.slice(0, start) + source.slice(start).replace(`assert.equal(result.code, ${before})`, `assert.equal(result.code, ${after})`);
  }, cliFile, pattern);
}
const runnerFile = "scripts/mutation-check.mjs";
for (const [name, before, pattern] of [
  ["stale-pattern guard removed", '  if (mutant === original) throw new Error(`Mutation target missing: ${c.name}`);', "stale"],
  ["survivor guard removed", '    if (!killed) throw new Error(`SURVIVED: ${c.name}\\n${run.stdout.slice(-1200)}\\n${run.stderr}`);', "surviving"],
  ["source restoration removed", '    writeFileSync(c.file, original);', "killed"],
  ["output restoration removed", '    writeFileSync(output, originalOutput);', "killed"],
]) {
  check(name, runnerFile, (source) => source.replace(before, ""), "test/mutation-check.test.js", `mutation gate: ${pattern}`);
}
console.log(`${killed}/${killed} consumer DX mutations killed`);
