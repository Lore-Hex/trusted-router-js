import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Deliberately dependency-free: recognize the declaration forms used by this SDK.
// Mask comments and strings together so URL literals cannot become line comments.
function declaredValueExports(source) {
  const code = source.replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g,
    (match) => match.replace(/[^\n]/g, " "),
  );
  const values = new Set();
  const localValues = new Set();
  const typeOnly = new Set();
  for (const match of code.matchAll(/(?:^|\n)\s*(export\s+)?(?:declare\s+)?(function|class|const|let|interface|type|enum)\s+([\w$]+)/g)) {
    const [, exported, kind, name] = match;
    if (["interface", "type", "enum"].includes(kind)) {
      typeOnly.add(name);
    } else {
      localValues.add(name);
      if (exported) values.add(name);
    }
  }
  for (const match of code.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
    for (const entry of match[1].split(",")) {
      const specifier = entry.trim();
      if (!specifier || /^type\s/.test(specifier)) continue;
      const parts = specifier.match(/^([\w$]+)(?:\s+as\s+([\w$]+))?$/);
      assert.ok(parts, `Unsupported declaration export specifier: ${specifier}`);
      const [, local, exported = local] = parts;
      if (!typeOnly.has(local) || localValues.has(local)) values.add(exported);
    }
  }
  return [...values].sort();
}

test("declaration parser distinguishes values, aliases, and type-only exports", () => {
  assert.deepEqual(declaredValueExports(`
    // export const commented: string;
    /* export function hidden(): void; */
    export declare const url: "https://example.com/export";
    export declare function fn(): void;
    export declare class Widget {}
    export declare let mutable: number;
    export interface Shape {}
    export type Name = string;
    export declare enum Kind { Example }
    interface LocalShape {}
    declare function local(): void;
    export { local as alias, fn, LocalShape, Shape as ShapeAlias, Kind, type Name };
    export { remote as renamed } from "./other.js";
    export type { RemoteType } from "./other.js";
  `), ["Widget", "alias", "fn", "mutable", "renamed", "url"]);
});

for (const name of ["index", "attestation", "session", "receipts", "oauth"]) {
  test(`${name}: runtime and declared value exports match`, async () => {
    const moduleUrl = new URL(`../src/${name}.js`, import.meta.url);
    const declarationUrl = new URL(`../src/${name}.d.ts`, import.meta.url);
    const runtime = Object.keys(await import(moduleUrl.href)).sort();
    const declared = declaredValueExports(await readFile(declarationUrl, "utf8"));
    const undeclared = runtime.filter((name) => !declared.includes(name));
    const missing = declared.filter((name) => !runtime.includes(name));
    assert.deepEqual({ undeclared, missing }, { undeclared: [], missing: [] },
      `${name} export mismatch:\n` +
      `  Runtime exports missing declarations: ${JSON.stringify(undeclared)}\n` +
      `  Declared values missing at runtime: ${JSON.stringify(missing)}`);
  });
}
