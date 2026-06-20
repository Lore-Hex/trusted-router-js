/**
 * Coverage for the TrustedRouter Fusion helper: the `fusionTool()` builder
 * and the client `fusion(...)` method. No real network — a mock fetchImpl
 * records the request body and we assert the fusion tool shape.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_FUSION_TIMEOUT_MS,
  FUSION_FREEDOM_FALLBACK_JUDGES,
  FUSION_FREEDOM_PANEL,
  FUSION_MODEL,
  TrustedRouter,
  fusionTool,
} from "../src/index.js";

function sseResponse(body) {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

const DONE =
  'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n' +
  "data: [DONE]\n\n";

test("fusionTool: only sets provided fields, snake_cases keys", () => {
  const tool = fusionTool({
    analysisModels: ["a", "b"],
    model: "~zai/glm-latest",
    selectionStrategy: "first_non_refusal",
    fallbackJudges: ["j1", "j2"],
    maxCompletionTokens: 2048,
  });
  assert.equal(tool.type, "trustedrouter:fusion");
  assert.deepEqual(tool.parameters, {
    analysis_models: ["a", "b"],
    model: "~zai/glm-latest",
    selection_strategy: "first_non_refusal",
    fallback_judges: ["j1", "j2"],
    max_completion_tokens: 2048,
  });
});

test("fusionTool: omits everything when no options given", () => {
  assert.deepEqual(fusionTool().parameters, {});
});

test("fusion presets use gateway latest aliases, not stale exact IDs", () => {
  assert.deepEqual(FUSION_FREEDOM_PANEL.slice(0, 5), [
    "minimax/minimax-m3",
    "~kimi/latest",
    "~zai/glm-latest",
    "google/gemma-4-31b-it",
    "deepseek/deepseek-v4-flash",
  ]);
  assert.equal(FUSION_FREEDOM_FALLBACK_JUDGES[0], "minimax/minimax-m3");
  assert.ok(FUSION_FREEDOM_PANEL.includes("~kimi/latest"));
  assert.ok(FUSION_FREEDOM_FALLBACK_JUDGES.includes("~zai/glm-latest"));
  assert.ok(!FUSION_FREEDOM_PANEL.includes("z-ai/glm-5.1"));
  assert.ok(!FUSION_FREEDOM_FALLBACK_JUDGES.includes("z-ai/glm-5.1"));
});

test("fusionTool: passes preset, fallbackFinalModels, maxToolCalls", () => {
  const tool = fusionTool({
    preset: "quality",
    fallbackFinalModels: ["f1"],
    maxToolCalls: 4,
  });
  assert.deepEqual(tool.parameters, {
    preset: "quality",
    fallback_final_models: ["f1"],
    max_tool_calls: 4,
  });
});

test("fusion(): posts trustedrouter/fusion with the fusion tool", async () => {
  let body;
  const c = new TrustedRouter({
    apiKey: "k",
    maxRetries: 0,
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return sseResponse(DONE);
    },
  });
  const result = await c.fusion({
    messages: [{ role: "user", content: "explain mRNA vaccines" }],
    analysisModels: FUSION_FREEDOM_PANEL,
    model: "~zai/glm-latest",
    selectionStrategy: "first_non_refusal",
    fallbackJudges: FUSION_FREEDOM_FALLBACK_JUDGES,
    maxCompletionTokens: 2048,
  });

  assert.equal(body.model, FUSION_MODEL);
  assert.equal(body.stream, true);
  assert.equal(body.tools.length, 1);
  const params = body.tools[0].parameters;
  assert.equal(body.tools[0].type, "trustedrouter:fusion");
  assert.deepEqual(params.analysis_models, [...FUSION_FREEDOM_PANEL]);
  assert.equal(params.model, "~zai/glm-latest");
  assert.equal(params.selection_strategy, "first_non_refusal");
  assert.deepEqual(params.fallback_judges, [...FUSION_FREEDOM_FALLBACK_JUDGES]);
  assert.equal(params.max_completion_tokens, 2048);
  // the judge model must NOT leak into the top-level body model
  assert.equal(result.choices[0].message.content, "ok");
});

test("fusion(): freedom panel defers fuser and strategy to gateway defaults", async () => {
  let body;
  const c = new TrustedRouter({
    apiKey: "k",
    maxRetries: 0,
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return sseResponse(DONE);
    },
  });

  await c.fusion({
    messages: [{ role: "user", content: "hi" }],
    analysisModels: FUSION_FREEDOM_PANEL,
  });

  const params = body.tools[0].parameters;
  assert.deepEqual(params, { analysis_models: [...FUSION_FREEDOM_PANEL] });
  assert.equal(params.analysis_models[0], "minimax/minimax-m3");
  assert.equal(Object.hasOwn(params, "model"), false);
  assert.equal(Object.hasOwn(params, "selection_strategy"), false);
  assert.equal(Object.hasOwn(params, "fallback_final_models"), false);
});

test("fusion(): forwards passthrough params (maxTokens/temperature)", async () => {
  let body;
  const c = new TrustedRouter({
    apiKey: "k",
    maxRetries: 0,
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return sseResponse(DONE);
    },
  });
  await c.fusion({
    messages: [{ role: "user", content: "hi" }],
    max_tokens: 512,
    temperature: 0,
  });
  assert.equal(body.model, FUSION_MODEL);
  assert.equal(body.max_tokens, 512);
  assert.equal(body.temperature, 0);
});

test("fusion(): caller tools come first, fusion tool is not overwritten", async () => {
  let body;
  const c = new TrustedRouter({
    apiKey: "k",
    maxRetries: 0,
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return sseResponse(DONE);
    },
  });
  const callerTool = {
    type: "function",
    function: { name: "lookup", parameters: {} },
  };
  await c.fusion({
    messages: [{ role: "user", content: "hi" }],
    tools: [callerTool],
    analysisModels: FUSION_FREEDOM_PANEL,
  });
  // both the caller tool AND the fusion tool survive
  assert.equal(body.tools.length, 2);
  assert.deepEqual(body.tools[0], callerTool);
  assert.equal(body.tools[1].type, "trustedrouter:fusion");
});

test("fusion(): defaults the per-call timeout to the 600s fusion budget", async () => {
  let seenTimeout;
  const c = new TrustedRouter({
    apiKey: "k",
    maxRetries: 0,
    fetchImpl: async () => sseResponse(DONE),
  });
  const original = c._fetchWithTimeout.bind(c);
  c._fetchWithTimeout = (url, init, timeoutMs) => {
    seenTimeout = timeoutMs;
    return original(url, init, timeoutMs);
  };
  await c.fusion({ messages: [{ role: "user", content: "hi" }] });
  assert.equal(seenTimeout, DEFAULT_FUSION_TIMEOUT_MS);
});

test("fusion(): an explicit timeout overrides the fusion default", async () => {
  let seenTimeout;
  const c = new TrustedRouter({
    apiKey: "k",
    maxRetries: 0,
    fetchImpl: async () => sseResponse(DONE),
  });
  const original = c._fetchWithTimeout.bind(c);
  c._fetchWithTimeout = (url, init, timeoutMs) => {
    seenTimeout = timeoutMs;
    return original(url, init, timeoutMs);
  };
  await c.fusion({ messages: [{ role: "user", content: "hi" }], timeout: 1234 });
  assert.equal(seenTimeout, 1234);
});
