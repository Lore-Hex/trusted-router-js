import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CONFIDENTIAL_MODEL,
  DEFAULT_TELEMETRY_PATH,
  E2E_MODEL,
  InternalError,
  MAP_REDUCE_MODEL,
  ProviderPreferences,
  SELECTOR_MODEL,
  SUBAGENT_MODEL,
  SYNTH_MODEL,
  TELEMETRY_ENDPOINTS,
  TELEMETRY_ERROR_CLASSES,
  TELEMETRY_FINAL_OUTCOMES,
  TELEMETRY_HOSTS,
  TELEMETRY_OUTCOMES,
  TELEMETRY_SCHEMA_VERSION,
  US_MODEL,
  VERSION,
  ZDR_MODEL,
  advisorTool,
  fusionTool,
  mapReduceTool,
  selectorTool,
  subagentTool,
} from "../src/index.js";
import { DEFAULT_USER_AGENT } from "../src/internal/transport.js";

test("exports stable routing and orchestration aliases", () => {
  assert.equal(ZDR_MODEL, "trustedrouter/zdr");
  assert.equal(E2E_MODEL, "trustedrouter/e2e");
  assert.equal(CONFIDENTIAL_MODEL, "trustedrouter/confidential");
  assert.equal(US_MODEL, "trustedrouter/us");
  assert.equal(SYNTH_MODEL, "trustedrouter/synth");
  assert.equal(SELECTOR_MODEL, "trustedrouter/selector");
  assert.equal(MAP_REDUCE_MODEL, "trustedrouter/mapreduce");
  assert.equal(SUBAGENT_MODEL, "trustedrouter/subagent");
});

test("all atomic orchestration builders use gateway-native schemas", () => {
  assert.deepEqual(fusionTool({ enabled: false }), {
    type: "trustedrouter:fusion",
    parameters: { enabled: false },
  });
  assert.deepEqual(advisorTool({
    enabled: true,
    workerTimeoutMs: 45_000,
    autoInitialAdvice: true,
  }), {
    type: "trustedrouter:advisor",
    parameters: {
      enabled: true,
      worker_timeout_ms: 45_000,
      auto_initial_advice: true,
    },
  });
  assert.deepEqual(selectorTool({
    enabled: true,
    analysisModels: ["panel/a", "panel/b"],
    selectorModels: ["selector/a"],
    selectorPrompt: "pick verbatim",
    maxCompletionTokens: 128,
  }), {
    type: "trustedrouter:selector",
    parameters: {
      enabled: true,
      analysis_models: ["panel/a", "panel/b"],
      selector_models: ["selector/a"],
      selector_prompt: "pick verbatim",
      max_completion_tokens: 128,
    },
  });
  assert.deepEqual(mapReduceTool({
    enabled: true,
    mapperModels: ["mapper/a"],
    parallelModels: ["worker/a"],
    reducerModels: ["reducer/a"],
    maxParts: 8,
    mapperPrompt: "split",
    parallelPrompt: "solve",
    reducerPrompt: "merge",
    maxCompletionTokens: 256,
  }), {
    type: "trustedrouter:mapreduce",
    parameters: {
      enabled: true,
      mapper_models: ["mapper/a"],
      parallel_models: ["worker/a"],
      reducer_models: ["reducer/a"],
      max_parts: 8,
      mapper_prompt: "split",
      parallel_prompt: "solve",
      reducer_prompt: "merge",
      max_completion_tokens: 256,
    },
  });
  assert.deepEqual(subagentTool({
    enabled: true,
    controllerModel: "controller/a",
    model: "worker/a",
    instructions: "delegate",
    depth: 2,
    maxSubagentCalls: 3,
    maxCompletionTokens: 512,
    temperature: 0.2,
    reasoning: { effort: "high" },
    tools: [{ type: "function", function: { name: "lookup" } }],
  }), {
    type: "trustedrouter:subagent",
    parameters: {
      enabled: true,
      controller_model: "controller/a",
      model: "worker/a",
      instructions: "delegate",
      depth: 2,
      max_subagent_calls: 3,
      max_completion_tokens: 512,
      temperature: 0.2,
      reasoning: { effort: "high" },
      tools: [{ type: "function", function: { name: "lookup" } }],
    },
  });
});

test("provider preferences are exact, composable, and validated", () => {
  assert.deepEqual({ ...ProviderPreferences.zdr() }, {
    min_privacy: "zdr",
    data_collection: "deny",
  });
  assert.deepEqual({ ...ProviderPreferences.confidential() }, {
    data_collection: "deny",
    min_privacy: "confidential",
  });
  assert.deepEqual({ ...ProviderPreferences.usOnly() }, { jurisdiction: "us" });
  assert.deepEqual({ ...new ProviderPreferences({
    usage: "credits",
    quantizations: ["fp8"],
    maxPrice: { prompt: 1.25, completion: 4.5 },
  }) }, {
    usage: "credits",
    quantizations: ["fp8"],
    max_price: { prompt: 1.25, completion: 4.5 },
  });
  assert.throws(() => new ProviderPreferences({ minPrivacy: "probably" }), TypeError);
  assert.throws(() => new ProviderPreferences({ jurisdiction: "eu" }), TypeError);
  assert.throws(() => new ProviderPreferences({ usage: "free" }), TypeError);
});

test("telemetry parity constants pin the contract v1 vocabulary", () => {
  // These values are shared with every other TrustedRouter SDK and with the
  // server's ClickHouse schema. They pin the vocabulary for the future
  // beacon channel too — do not change them without a coordinated release.
  assert.equal(TELEMETRY_SCHEMA_VERSION, 1);
  assert.equal(DEFAULT_TELEMETRY_PATH, "/client-events");
  assert.deepEqual(
    [...TELEMETRY_HOSTS],
    ["apex", "ally", "uptime", "us_central1", "us_east4", "europe_west4", "control", "custom"],
  );
  assert.deepEqual(
    [...TELEMETRY_ENDPOINTS],
    [
      "chat_completions",
      "messages",
      "responses",
      "embeddings",
      "images",
      "videos",
      "models",
      "fusion",
      "control_other",
      "inference_other",
    ],
  );
  assert.deepEqual(
    [...TELEMETRY_OUTCOMES],
    ["ok", "http_error", "transport_error", "timeout", "stream_broken", "aborted"],
  );
  assert.deepEqual(
    [...TELEMETRY_FINAL_OUTCOMES],
    [...TELEMETRY_OUTCOMES, "exhausted"],
  );
  assert.deepEqual(
    [...TELEMETRY_ERROR_CLASSES],
    [
      "dns",
      "tls",
      "connect_refused",
      "connect_timeout",
      "connect_error",
      "read_timeout",
      "write_timeout",
      "pool_timeout",
      "protocol_error",
      "reset",
      "io_error",
      "proxy_error",
      "stream_stalled",
      "unknown",
    ],
  );
});

test("VERSION matches package.json and User-Agent matches the contract grammar", async () => {
  const pkg = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(VERSION, pkg.version);
  assert.match(
    DEFAULT_USER_AGENT,
    /^trusted-router-js\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?( [a-z]{1,10}\/[0-9A-Za-z.+-]{1,24})?$/,
  );
});

test("errors expose attribution and retain the raw payload", () => {
  const payload = { error: {
    message: "upstream unavailable",
    layer: "provider",
    source: "upstream",
    provider: "example",
    request_id: "req_123",
    future_field: { kept: true },
  } };
  const error = new InternalError(502, "upstream unavailable", payload);
  assert.equal(error.layer, "provider");
  assert.equal(error.source, "upstream");
  assert.equal(error.provider, "example");
  assert.equal(error.requestId, "req_123");
  assert.equal(error.payload, payload);
});
