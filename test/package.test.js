import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  assert.equal(Object.hasOwn(pkg, "dependencies"), false);
  assert.deepEqual(pkg.bin, { trustedrouter: "./dist/cli.js" });
  assert.deepEqual(pkg.files, ["dist", "src", "README.md", "LICENSE"]);
  assert.deepEqual(Object.keys(pkg.exports).sort(), [
    ".",
    "./attestation",
    "./oauth",
    "./package.json",
    "./receipts",
    "./session",
  ]);
  assert.equal(pkg.main, "dist/index.js");
  assert.equal(pkg.types, "dist/index.d.ts");
  for (const [subpath, entry] of Object.entries(pkg.exports)) {
    if (subpath === "./package.json") {
      assert.equal(entry, "./package.json");
      continue;
    }
    assert.equal(Object.keys(entry)[0], "types");
    const name = subpath === "." ? "index" : subpath.slice(2);
    assert.deepEqual(entry, { types: `./dist/${name}.d.ts`, import: `./dist/${name}.js` });
  }
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
const root = await import("./dist/index.js");
if (typeof root.TrustedRouter !== "function") throw new Error("missing TrustedRouter");
if (typeof root.verifyReceipt !== "function") throw new Error("missing verifyReceipt");
if (typeof root.MissingBindingError !== "function") throw new Error("missing MissingBindingError");
if (typeof root.ReceiptIssuerError !== "function") throw new Error("missing ReceiptIssuerError");
if ("verifyGatewaySession" in root) throw new Error("session verifier is exported from root");
`;
  await execFileAsync(process.execPath, ["--input-type=module", "-e", script], { cwd: root });
});

test("the packaged bin entrypoint resolves and reports the package version", async () => {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [path.join(root, "dist/cli.js"), "--version"],
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
  assert.ok(paths.includes("dist/index.js"));
  assert.ok(paths.includes("dist/index.d.ts"));
  assert.ok(paths.includes("dist/attestation.js"));
  assert.ok(paths.includes("dist/attestation.d.ts"));
  assert.ok(paths.includes("dist/oauth.js"));
  assert.ok(paths.includes("dist/oauth.d.ts"));
  assert.ok(paths.includes("dist/receipts.js"));
  assert.ok(paths.includes("dist/receipts.d.ts"));
  assert.ok(paths.includes("dist/session.js"));
  assert.ok(paths.includes("dist/session.d.ts"));
  assert.ok(paths.includes("dist/cli.js"));
  assert.ok(paths.includes("dist/cli/main.js"));
  assert.equal(pack.files.find((file) => file.path === "dist/cli.js").mode, 0o755);
  assert.ok(paths.every((p) => p.startsWith("dist/") || (p.startsWith("src/") && p.endsWith(".ts")) || ["package.json", "README.md", "LICENSE"].includes(p)));
  assert.ok(paths.includes("src/index.ts"));
  assert.ok(paths.includes("dist/index.d.ts.map"));
  assert.equal(paths.some((p) => p.startsWith("test/")), false);
  assert.equal(paths.some((p) => p.includes(".private")), false);
  assert.equal(paths.some((p) => p.startsWith(".env")), false);
});

test("packed consumer resolves declarations to shipped source and tree-shakes VERSION", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "trusted-router-consumer-"));
  const env = npmEnvironment(path.join(tempDir, "npm-cache"));
  try {
    const { stdout } = await execFileAsync("npm", ["pack", "--json", "--pack-destination", tempDir], { cwd: root, env });
    const [pack] = JSON.parse(stdout);
    await writeFile(path.join(tempDir, "package.json"), '{"private":true,"type":"module"}\n');
    await execFileAsync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--offline", path.join(tempDir, pack.filename)], { cwd: tempDir, env });
    const installed = path.join(tempDir, "node_modules/@lore-hex/trusted-router");
    await writeFile(path.join(tempDir, "consumer.ts"), 'import { VERSION } from "@lore-hex/trusted-router"; console.log(VERSION);\n');
    await writeFile(path.join(tempDir, "tsconfig.json"), JSON.stringify({
      compilerOptions: { module: "NodeNext", strict: true, noEmit: true, target: "ES2022", typeRoots: [path.join(root, "node_modules/@types")] },
      files: ["consumer.ts"],
    }));
    const { stdout: trace } = await execFileAsync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "--traceResolution"], { cwd: tempDir });
    assert.match(trace, /successfully resolved to '.*trusted-router\/dist\/index\.d\.ts'/);
    // Follow the same sourceMappingURL -> sources chain editors use for definitions.
    for (const file of pack.files.filter(({ path: name }) => /^dist\/.*\.(?:d\.ts|js)$/.test(name))) {
      const generated = path.join(installed, file.path);
      const contents = await readFile(generated, "utf8");
      const mapName = contents.match(/\/\/# sourceMappingURL=(.+)/)?.[1];
      assert.ok(mapName, `missing sourceMappingURL: ${file.path}`);
      const mapPath = path.resolve(path.dirname(generated), mapName);
      const map = JSON.parse(await readFile(mapPath, "utf8"));
      assert.equal(map.sources.length, 1, file.path);
      for (const source of map.sources) {
        const resolved = path.resolve(path.dirname(mapPath), map.sourceRoot ?? "", source);
        assert.ok(resolved.startsWith(`${installed}/src/`), `${file.path}: ${source}`);
        assert.equal(path.relative(installed, resolved), file.path.replace(/^dist\//, "src/").replace(/\.(?:d\.ts|js)$/, ".ts"));
        assert.equal(await readFile(resolved, "utf8"), await readFile(path.join(root, path.relative(installed, resolved)), "utf8"));
      }
    }
    const { stdout: metadata } = await execFileAsync(process.execPath, ["--input-type=module", "-e", 'import pkg from "@lore-hex/trusted-router/package.json" with { type: "json" }; console.log(pkg.version)'], { cwd: tempDir });
    assert.equal(metadata.trim(), "0.8.0");

    const { build } = await import("esbuild");
    const bundle = async () => build({ entryPoints: [path.join(tempDir, "consumer.ts")], bundle: true, platform: "browser", format: "esm", write: false, metafile: true });
    const result = await bundle();
    const included = Object.values(result.metafile.outputs).flatMap((output) => Object.entries(output.inputs).filter(([, value]) => value.bytesInOutput > 0).map(([name]) => name));
    assert.equal(included.some((name) => /internal\/(transport|telemetry|beacon)\.js$/.test(name)), false, included.join("\n"));
    assert.doesNotMatch(result.outputFiles[0].text, /userAgent|TELEMETRY_|client-events/);
    await writeFile(path.join(tempDir, "bin-smoke.js"), 'import "./node_modules/@lore-hex/trusted-router/dist/cli.js";\n');
    const cliBundle = await build({ entryPoints: [path.join(tempDir, "bin-smoke.js")], bundle: true, platform: "node", format: "esm", write: false });
    assert.match(cliBundle.outputFiles[0].text, /process\.exitCode = exitCode/);
    // Negative control: the metadata is load-bearing, not a vacuous bundle check.
    const manifestPath = path.join(installed, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    await writeFile(manifestPath, JSON.stringify({ ...manifest, sideEffects: true }));
    const unshaken = await bundle();
    assert.match(unshaken.outputFiles[0].text, /function userAgent\(/);
    assert.match(unshaken.outputFiles[0].text, /TELEMETRY_/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
