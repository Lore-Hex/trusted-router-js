/**
 * Coverage for the TrustedRouter Socrates helper and advisor tool builder.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  ADVISOR_MODEL,
  SOCRATES_MODEL,
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

test("socrates(): posts trustedrouter/socrates-1.0 with advisor tool", async () => {
  let body;
  const c = new TrustedRouter({
    apiKey: "k",
    maxRetries: 0,
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return sseResponse(DONE);
    },
  });
  const result = await c.socrates({
    messages: [{ role: "user", content: "review this migration" }],
    depth: 2,
    advisorModels: [ADVISOR_MODEL],
    maxGetAdviceCalls: 1,
  });

  assert.equal(body.model, SOCRATES_MODEL);
  assert.equal(body.stream, true);
  assert.equal(body.tools.length, 1);
  assert.equal(body.tools[0].type, "trustedrouter:advisor");
  assert.deepEqual(body.tools[0].parameters, {
    depth: 2,
    advisor_models: [ADVISOR_MODEL],
    max_get_advice_calls: 1,
  });
  assert.equal(result.choices[0].message.content, "ok");
});

test("socrates(): preserves caller tools before advisor config", async () => {
  let body;
  const c = new TrustedRouter({
    apiKey: "k",
    maxRetries: 0,
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return sseResponse(DONE);
    },
  });
  await c.socrates({
    messages: [{ role: "user", content: "hi" }],
    tools: [{ type: "function", function: { name: "lookup" } }],
  });

  assert.equal(body.tools.length, 2);
  assert.equal(body.tools[0].function.name, "lookup");
  assert.equal(body.tools[1].type, "trustedrouter:advisor");
});
