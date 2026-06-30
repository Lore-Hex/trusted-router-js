/**
 * Coverage for direct advisor orchestration options and tool building.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  ADVISOR_MODEL,
  TrustedRouter,
  advisorTool,
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

test("advisorTool: only sets provided fields, snake_cases keys", () => {
  const tool = advisorTool({
    depth: 2,
    workerModels: ["cerebras/gpt-oss-120b"],
    advisorModels: [ADVISOR_MODEL],
    maxGetAdviceCalls: 1,
    advisorMaxTokens: 4096,
    advisorTimeoutMs: 90000,
  });
  assert.equal(tool.type, "trustedrouter:advisor");
  assert.deepEqual(tool.parameters, {
    depth: 2,
    worker_models: ["cerebras/gpt-oss-120b"],
    advisor_models: [ADVISOR_MODEL],
    max_get_advice_calls: 1,
    advisor_max_tokens: 4096,
    advisor_timeout_ms: 90000,
  });
});

test("advisorTool: omits everything when no options given", () => {
  assert.deepEqual(advisorTool().parameters, {});
});

test("chatCompletions(): direct socrates model lifts advisor options into tool", async () => {
  let body;
  const c = new TrustedRouter({
    apiKey: "k",
    maxRetries: 0,
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return sseResponse(DONE);
    },
  });
  const result = await c.chatCompletions({
    model: "trustedrouter/socrates-1.0",
    messages: [{ role: "user", content: "review this migration" }],
    depth: 2,
    advisorModels: ["anthropic/claude-opus-4.8"],
    maxGetAdviceCalls: 1,
  });

  assert.equal(body.model, "trustedrouter/socrates-1.0");
  assert.equal(body.stream, true);
  assert.equal(body.tools.length, 1);
  assert.equal(body.tools[0].type, "trustedrouter:advisor");
  assert.deepEqual(body.tools[0].parameters, {
    depth: 2,
    advisor_models: ["anthropic/claude-opus-4.8"],
    max_get_advice_calls: 1,
  });
  assert.equal(result.choices[0].message.content, "ok");
});

test("chatCompletions(): lifts direct advisor options into tool config", async () => {
  let body;
  const c = new TrustedRouter({
    apiKey: "k",
    maxRetries: 0,
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return sseResponse(DONE);
    },
  });
  const result = await c.chatCompletions({
    model: ADVISOR_MODEL,
    messages: [{ role: "user", content: "review this migration" }],
    workerModels: ["moonshotai/kimi-k2.7-code"],
    advisorModels: ["z-ai/glm-5.2"],
    maxGetAdviceCalls: 1,
  });

  assert.equal(body.model, ADVISOR_MODEL);
  assert.deepEqual(body.tools, [
    {
      type: "trustedrouter:advisor",
      parameters: {
        worker_models: ["moonshotai/kimi-k2.7-code"],
        advisor_models: ["z-ai/glm-5.2"],
        max_get_advice_calls: 1,
      },
    },
  ]);
  assert.equal(body.workerModels, undefined);
  assert.equal(body.advisorModels, undefined);
  assert.equal(body.maxGetAdviceCalls, undefined);
  assert.equal(result.choices[0].message.content, "ok");
});

test("chatCompletions(): lifts direct synth options into fusion tool config", async () => {
  let body;
  const c = new TrustedRouter({
    apiKey: "k",
    maxRetries: 0,
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return sseResponse(DONE);
    },
  });
  await c.chatCompletions({
    model: "trustedrouter/synth",
    messages: [{ role: "user", content: "compare" }],
    analysisModels: ["moonshotai/kimi-k2.7-code", "z-ai/glm-5.2"],
    judgeModel: "moonshotai/kimi-k2.7-code",
    fallbackFinalModels: ["z-ai/glm-5.2"],
  });

  assert.deepEqual(body.tools, [
    {
      type: "trustedrouter:fusion",
      parameters: {
        analysis_models: ["moonshotai/kimi-k2.7-code", "z-ai/glm-5.2"],
        model: "moonshotai/kimi-k2.7-code",
        fallback_final_models: ["z-ai/glm-5.2"],
      },
    },
  ]);
  assert.equal(body.analysisModels, undefined);
  assert.equal(body.judgeModel, undefined);
});

test("chatCompletions(): direct socrates model preserves caller tools before advisor config", async () => {
  let body;
  const c = new TrustedRouter({
    apiKey: "k",
    maxRetries: 0,
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return sseResponse(DONE);
    },
  });
  await c.chatCompletions({
    model: "trustedrouter/socrates-1.0",
    messages: [{ role: "user", content: "hi" }],
    tools: [{ type: "function", function: { name: "lookup" } }],
    workerModels: ["cerebras/gpt-oss-120b"],
  });

  assert.equal(body.tools.length, 2);
  assert.equal(body.tools[0].function.name, "lookup");
  assert.equal(body.tools[1].type, "trustedrouter:advisor");
});
