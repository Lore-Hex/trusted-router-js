import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function npmEnvironment(cacheDir) {
  return {
    ...process.env,
    npm_config_cache: cacheDir,
    npm_config_loglevel: "error",
    npm_config_update_notifier: "false",
  };
}

test("package manifest is configured for a public Apache-2.0 npm release", async () => {
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.name, "@lore-hex/trusted-router");
  assert.equal(pkg.version, "0.8.0");
  assert.equal(pkg.license, "Apache-2.0");
  assert.deepEqual(pkg.bin, { trustedrouter: "./src/cli.js" });
  assert.deepEqual(pkg.files, ["src", "README.md", "LICENSE"]);
  assert.deepEqual(Object.keys(pkg.exports).sort(), [
    ".",
    "./attestation",
    "./oauth",
    "./receipts",
    "./session",
  ]);
  assert.equal(pkg.publishConfig.access, "public");
  assert.equal(pkg.publishConfig.provenance, true);
});

test("root import does not eagerly load the Node TLS session module", async () => {
  const loaderSource = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "node:tls") {
    throw new Error("root import eagerly loaded node:tls");
  }
  return nextResolve(specifier, context);
}
`;
  const script = `
import { register } from "node:module";
register(${JSON.stringify(`data:text/javascript,${encodeURIComponent(loaderSource)}`)}, import.meta.url);
const root = await import("./src/index.js");
if (typeof root.TrustedRouter !== "function") throw new Error("missing TrustedRouter");
if (typeof root.verifyReceipt !== "function") throw new Error("missing verifyReceipt");
if ("verifyGatewaySession" in root) throw new Error("session verifier is exported from root");
`;
  await execFileAsync(process.execPath, ["--input-type=module", "-e", script], { cwd: root });
});

test("the packaged bin entrypoint resolves and reports the package version", async () => {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [path.join(root, "src/cli.js"), "--version"],
    { cwd: root },
  );
  assert.equal(stdout, "trustedrouter 0.8.0\n");
  assert.equal(stderr, "");
});

test("npm exec infers the single trustedrouter bin from a packed package", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "trusted-router-npx-"));
  const cacheDir = path.join(tempDir, "npm-cache");
  try {
    const { stdout: packOutput } = await execFileAsync(
      "npm",
      ["pack", "--json", "--pack-destination", tempDir],
      {
        cwd: root,
        env: npmEnvironment(cacheDir),
      },
    );
    const [pack] = JSON.parse(packOutput);
    const tarball = path.join(tempDir, pack.filename);
    const { stdout, stderr } = await execFileAsync(
      "npm",
      ["exec", "--yes", "--", `file:${tarball}`, "--version"],
      {
        cwd: tempDir,
        env: npmEnvironment(cacheDir),
      },
    );
    assert.equal(stdout, "trustedrouter 0.8.0\n");
    assert.equal(stderr, "");
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("npm dry-run package contains only release artifacts", async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "trusted-router-npm-"));
  let stdout;
  try {
    ({ stdout } = await execFileAsync("npm", ["pack", "--dry-run", "--json"], {
      cwd: root,
      env: npmEnvironment(cacheDir),
    }));
  } finally {
    await rm(cacheDir, { force: true, recursive: true });
  }
  const [pack] = JSON.parse(stdout);
  const paths = pack.files.map((file) => file.path).sort();
  assert.ok(paths.includes("package.json"));
  assert.ok(paths.includes("README.md"));
  assert.ok(paths.includes("LICENSE"));
  assert.ok(paths.includes("src/index.js"));
  assert.ok(paths.includes("src/index.d.ts"));
  assert.ok(paths.includes("src/attestation.js"));
  assert.ok(paths.includes("src/attestation.d.ts"));
  assert.ok(paths.includes("src/oauth.js"));
  assert.ok(paths.includes("src/oauth.d.ts"));
  assert.ok(paths.includes("src/receipts.js"));
  assert.ok(paths.includes("src/receipts.d.ts"));
  assert.ok(paths.includes("src/session.js"));
  assert.ok(paths.includes("src/session.d.ts"));
  assert.ok(paths.includes("src/cli.js"));
  assert.ok(paths.includes("src/cli/main.js"));
  assert.equal(pack.files.find((file) => file.path === "src/cli.js").mode, 0o755);
  assert.equal(paths.some((p) => p.startsWith("test/")), false);
  assert.equal(paths.some((p) => p.includes(".private")), false);
  assert.equal(paths.some((p) => p.startsWith(".env")), false);
});
