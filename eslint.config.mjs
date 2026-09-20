import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import ts from "typescript";

// The unsafe-* rules allow `JSON.parse(text) as T`: the assertion hides `any`.
// Reject assertions whose source is any; assigning to unknown remains safe.
const boundaryRules = {
  rules: {
    "no-assert-any": {
      meta: { type: "problem", schema: [], messages: { unsafe: "Narrow external data at runtime; an assertion must not hide any. Assign it to unknown first." } },
      create(context) {
        const services = context.sourceCode.parserServices;
        const checker = services.program.getTypeChecker();
        return {
          TSAsExpression(node) {
            const source = checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(node.expression));
            const target = checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(node.typeAnnotation));
            if ((source.flags & ts.TypeFlags.Any) && !(target.flags & ts.TypeFlags.Unknown)) {
              context.report({ node, messageId: "unsafe" });
            }
          },
        };
      },
    },
  },
};
// strict-boolean-expressions stays off (89 sites); unsafe-*, no-assert-any, and the computed-lookup selector cover the audited classes.
const rules = Object.fromEntries([
  "no-explicit-any", "no-unsafe-assignment", "no-unsafe-member-access", "no-unsafe-call",
  "no-unsafe-return", "no-unsafe-argument", "no-unnecessary-type-assertion",
  "switch-exhaustiveness-check", "no-floating-promises", "no-misused-promises",
].map((name) => [`@typescript-eslint/${name}`, "error"]));
const restricted = ["error", {
  selector: "MemberExpression[computed=true][object.type='ObjectExpression']",
  message: "Use ownProperty from src/internal/records.ts (or a Map) for data-keyed lookups.",
}];
export default [
  { ignores: ["dist/**", "node_modules/**"] },
  {
    files: ["src/**/*.ts"],
    languageOptions: { parser: tsParser, parserOptions: { project: "./tsconfig.json", tsconfigRootDir: import.meta.dirname } },
    plugins: { "@typescript-eslint": tsPlugin, boundaries: boundaryRules },
    rules: {
      ...rules,
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "as", objectLiteralTypeAssertions: "never" }],
      "no-restricted-syntax": restricted,
      "boundaries/no-assert-any": "error",
    },
  },
  {
    files: ["test/**/*.js", "test/**/*.ts"],
    languageOptions: { parser: tsParser },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: { "@typescript-eslint/no-explicit-any": "error", "no-restricted-syntax": restricted },
  },
];
