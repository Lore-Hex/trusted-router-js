import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const runner = new URL("../scripts/mutation-check.mjs", import.meta.url).href;
for (const scenario of ["stale", "surviving", "killed", "compile error"]) {
  test(`mutation gate: ${scenario} mutation has the correct exit and restores files`, () => {
    const directory = mkdtempSync(join(tmpdir(), "tr-mutation-gate-"));
    try {
      for (const name of ["src", "dist", "test"]) mkdirSync(join(directory, name));
      const source = "export const guarded = true;\n";
      const output = "export const guarded = true; // original output\n//# sourceMappingURL=guard.js.map\n";
      writeFileSync(join(directory, "src/guard.ts"), source);
      writeFileSync(join(directory, "dist/guard.js"), output);
      writeFileSync(join(directory, "package.json"), '{"type":"module"}');
      writeFileSync(join(directory, "test/guard.test.js"), scenario === "killed"
        ? 'import assert from "node:assert/strict"; import test from "node:test"; import { guarded } from "../dist/guard.js"; test("guard", () => assert.equal(guarded, true));'
        : 'import test from "node:test"; test("guard", () => {});');
      const mutation = { name: scenario, file: "src/guard.ts", before: scenario === "stale" ? "absent pattern" : "true", after: scenario === "compile error" ? "!!!" : "false", test: "test/guard.test.js", pattern: "guard" };
      const env = { ...process.env };
      delete env.NODE_TEST_CONTEXT;
      const result = spawnSync(process.execPath, ["--input-type=module", "-e", `import { checkSourceMutation } from ${JSON.stringify(runner)}; checkSourceMutation(${JSON.stringify(mutation)});`], { cwd: directory, encoding: "utf8", env });
      assert.equal(result.status, scenario === "killed" ? 0 : 1, result.stderr);
      if (scenario === "stale") assert.match(result.stderr, /Mutation target missing/);
      if (scenario === "surviving") assert.match(result.stderr, /SURVIVED/);
      assert.equal(readFileSync(join(directory, "src/guard.ts"), "utf8"), source);
      assert.equal(readFileSync(join(directory, "dist/guard.js"), "utf8"), output);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
