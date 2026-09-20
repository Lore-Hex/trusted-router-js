import { chmod, copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);

async function entryPoints(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(entries.map(async (entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return entryPoints(path);
    return /\.(js|ts)$/.test(path) && !path.endsWith(".d.ts") ? [path] : [];
  }));
  return paths.flat().sort();
}

await rm("dist", { recursive: true, force: true });
const { outputFiles } = await build({
  entryPoints: await entryPoints("src"),
  outbase: "src",
  outdir: "dist",
  format: "esm",
  platform: "node",
  target: "node20",
  bundle: false,
  sourcemap: true,
  write: false,
});

// Own output permissions explicitly: esbuild's default writer makes shebang
// files executable itself, which would mask a missing CLI chmod below.
for (const file of outputFiles) {
  await mkdir(dirname(file.path), { recursive: true });
  await writeFile(file.path, file.contents, { mode: 0o644 });
}

const sourceShebang = (await readFile("src/cli.js", "utf8")).split("\n")[0];
const builtShebang = (await readFile("dist/cli.js", "utf8")).split("\n")[0];
if (!sourceShebang.startsWith("#!") || builtShebang !== sourceShebang) {
  throw new Error("Build did not preserve the CLI shebang");
}
await chmod("dist/cli.js", 0o755);

execFileSync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json"], {
  stdio: "inherit",
});

// hand-maintained until ported; shrink this list as modules port
const sources = new Set(await entryPoints("src"));
for (const name of []) {
  if (sources.has(`src/${name}.ts`)) {
    throw new Error(`Refusing to copy src/${name}.d.ts: src/${name}.ts generates its declaration`);
  }
  await copyFile(`src/${name}.d.ts`, `dist/${name}.d.ts`);
}
