import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("package manifest is configured for a public Apache-2.0 npm release", async () => {
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.name, "@lore-hex/trusted-router");
  assert.equal(pkg.version, "0.3.0");
  assert.equal(pkg.license, "Apache-2.0");
  assert.deepEqual(pkg.files, ["src", "README.md", "LICENSE"]);
  assert.deepEqual(Object.keys(pkg.exports).sort(), [".", "./attestation"]);
  assert.equal(pkg.publishConfig.access, "public");
  assert.equal(pkg.publishConfig.provenance, true);
});

test("npm dry-run package contains only release artifacts", async () => {
  const { stdout } = await execFileAsync("npm", ["pack", "--dry-run", "--json"], { cwd: root });
  const [pack] = JSON.parse(stdout);
  const paths = pack.files.map((file) => file.path).sort();
  assert.ok(paths.includes("package.json"));
  assert.ok(paths.includes("README.md"));
  assert.ok(paths.includes("LICENSE"));
  assert.ok(paths.includes("src/index.js"));
  assert.ok(paths.includes("src/index.d.ts"));
  assert.ok(paths.includes("src/attestation.js"));
  assert.ok(paths.includes("src/attestation.d.ts"));
  assert.equal(paths.some((p) => p.startsWith("test/")), false);
  assert.equal(paths.some((p) => p.includes(".private")), false);
  assert.equal(paths.some((p) => p.startsWith(".env")), false);
});
