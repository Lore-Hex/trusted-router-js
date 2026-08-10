/**
 * L7 — ORCHESTRATION BUILDERS.
 *
 * fusion/advisor/selector/mapreduce/subagent tool builders, the
 * camelCase→snake_case option-lifting tables, and request-body shapers.
 *
 * Wire schemas here are pinned by the cross-SDK parity tests
 * (test/fusion.test.js, test/socrates.test.js, test/parity-contract.test.js)
 * and must not change.
 */

import { ADVISOR_MODEL } from "./models.js";

/**
 * Build a `trustedrouter:fusion` tool spec. Fan a request across a panel of
 * models and have a judge model pick or synthesize one answer. Omit a field to
 * let the gateway default it (selectionStrategy defaults to
 * "synthesize_non_refusals").
 */
export function fusionTool({
  enabled = null,
  analysisModels = null,
  model = null, // judge / synthesis model
  selectionStrategy = null,
  fallbackJudges = null,
  fallbackFinalModels = null,
  maxCompletionTokens = null,
  maxToolCalls = null,
  preset = null,
  panelPrompt = null,
  synthesisPrompt = null,
} = {}) {
  const parameters = {};
  if (enabled !== null) parameters.enabled = enabled;
  if (preset !== null) parameters.preset = preset;
  if (analysisModels !== null) parameters.analysis_models = analysisModels;
  if (model !== null) parameters.model = model;
  if (selectionStrategy !== null) parameters.selection_strategy = selectionStrategy;
  if (fallbackJudges !== null) parameters.fallback_judges = fallbackJudges;
  if (fallbackFinalModels !== null) parameters.fallback_final_models = fallbackFinalModels;
  if (maxCompletionTokens !== null) parameters.max_completion_tokens = maxCompletionTokens;
  if (maxToolCalls !== null) parameters.max_tool_calls = maxToolCalls;
  if (panelPrompt !== null) parameters.panel_prompt = panelPrompt;
  if (synthesisPrompt !== null) parameters.synthesis_prompt = synthesisPrompt;
  return { type: "trustedrouter:fusion", parameters };
}

/**
 * Build a `trustedrouter:advisor` tool spec. Most callers should pass these
 * options directly to `chatCompletions({ model, ... })`; the SDK lifts them
 * into this gateway config and gives the worker model a private
 * `_trustedrouter_get_advice` tool.
 */
export function advisorTool({
  enabled = null,
  depth = null,
  workerModels = null,
  advisorModels = null,
  maxGetAdviceCalls = null,
  advisorMaxTokens = null,
  workerTimeoutMs = null,
  advisorTimeoutMs = null,
  autoInitialAdvice = null,
} = {}) {
  const parameters = {};
  if (enabled !== null) parameters.enabled = enabled;
  if (depth !== null) parameters.depth = depth;
  if (workerModels !== null) parameters.worker_models = workerModels;
  if (advisorModels !== null) parameters.advisor_models = advisorModels;
  if (maxGetAdviceCalls !== null) {
    parameters.max_get_advice_calls = maxGetAdviceCalls;
  }
  if (advisorMaxTokens !== null) parameters.advisor_max_tokens = advisorMaxTokens;
  if (workerTimeoutMs !== null) parameters.worker_timeout_ms = workerTimeoutMs;
  if (advisorTimeoutMs !== null) parameters.advisor_timeout_ms = advisorTimeoutMs;
  if (autoInitialAdvice !== null) parameters.auto_initial_advice = autoInitialAdvice;
  return { type: "trustedrouter:advisor", parameters };
}

/** Build a `trustedrouter:selector` tool spec. */
export function selectorTool({
  enabled = null,
  analysisModels = null,
  selectorModels = null,
  selectorPrompt = null,
  maxCompletionTokens = null,
} = {}) {
  const parameters = {};
  if (enabled !== null) parameters.enabled = enabled;
  if (analysisModels !== null) parameters.analysis_models = analysisModels;
  if (selectorModels !== null) parameters.selector_models = selectorModels;
  if (selectorPrompt !== null) parameters.selector_prompt = selectorPrompt;
  if (maxCompletionTokens !== null) parameters.max_completion_tokens = maxCompletionTokens;
  return { type: "trustedrouter:selector", parameters };
}

/** Build a `trustedrouter:mapreduce` tool spec. */
export function mapReduceTool({
  enabled = null,
  mapperModels = null,
  parallelModels = null,
  reducerModels = null,
  maxParts = null,
  mapperPrompt = null,
  parallelPrompt = null,
  reducerPrompt = null,
  maxCompletionTokens = null,
} = {}) {
  const parameters = {};
  if (enabled !== null) parameters.enabled = enabled;
  if (mapperModels !== null) parameters.mapper_models = mapperModels;
  if (parallelModels !== null) parameters.parallel_models = parallelModels;
  if (reducerModels !== null) parameters.reducer_models = reducerModels;
  if (maxParts !== null) parameters.max_parts = maxParts;
  if (mapperPrompt !== null) parameters.mapper_prompt = mapperPrompt;
  if (parallelPrompt !== null) parameters.parallel_prompt = parallelPrompt;
  if (reducerPrompt !== null) parameters.reducer_prompt = reducerPrompt;
  if (maxCompletionTokens !== null) parameters.max_completion_tokens = maxCompletionTokens;
  return { type: "trustedrouter:mapreduce", parameters };
}

/** Build a `trustedrouter:subagent` tool spec. */
export function subagentTool({
  enabled = null,
  controllerModel = null,
  model = null,
  instructions = null,
  depth = null,
  maxSubagentCalls = null,
  maxCompletionTokens = null,
  temperature = null,
  reasoning = null,
  tools = null,
} = {}) {
  const parameters = {};
  if (enabled !== null) parameters.enabled = enabled;
  if (controllerModel !== null) parameters.controller_model = controllerModel;
  if (model !== null) parameters.model = model;
  if (instructions !== null) parameters.instructions = instructions;
  if (depth !== null) parameters.depth = depth;
  if (maxSubagentCalls !== null) parameters.max_subagent_calls = maxSubagentCalls;
  if (maxCompletionTokens !== null) parameters.max_completion_tokens = maxCompletionTokens;
  if (temperature !== null) parameters.temperature = temperature;
  if (reasoning !== null) parameters.reasoning = reasoning;
  if (tools !== null) parameters.tools = tools;
  return { type: "trustedrouter:subagent", parameters };
}

export const ADVISOR_MODELS = Object.freeze(new Set([ADVISOR_MODEL]));
export const FUSION_PRIMITIVE_MODELS = Object.freeze(
  new Set([
    "trustedrouter/fusion",
    "trustedrouter/fusion-code",
    "trustedrouter/synth",
    "trustedrouter/synth-code",
    "trustedrouter/selector",
    "trustedrouter/mapreduce",
  ]),
);

export function chatCompletionBody({ model, messages, params }) {
  const bodyParams = { ...params };
  const tools = [...(bodyParams.tools ?? [])];
  delete bodyParams.tools;

  const advisor = {};
  for (const [sdkKey, gatewayKey] of [
    ["depth", "depth"],
    ["workerModels", "worker_models"],
    ["advisorModels", "advisor_models"],
    ["maxGetAdviceCalls", "max_get_advice_calls"],
    ["advisorMaxTokens", "advisor_max_tokens"],
    ["workerTimeoutMs", "worker_timeout_ms"],
    ["advisorTimeoutMs", "advisor_timeout_ms"],
    ["autoInitialAdvice", "auto_initial_advice"],
  ]) {
    if (Object.hasOwn(bodyParams, sdkKey)) {
      if (bodyParams[sdkKey] !== null && bodyParams[sdkKey] !== undefined) {
        advisor[gatewayKey] = bodyParams[sdkKey];
      }
      delete bodyParams[sdkKey];
    }
  }
  if (Object.keys(advisor).length > 0) {
    tools.push({ type: "trustedrouter:advisor", parameters: advisor });
  }

  const fusion = {};
  for (const [sdkKey, gatewayKey] of [
    ["analysisModels", "analysis_models"],
    ["judgeModel", "model"],
    ["selectionStrategy", "selection_strategy"],
    ["fallbackJudges", "fallback_judges"],
    ["fallbackFinalModels", "fallback_final_models"],
    ["maxCompletionTokens", "max_completion_tokens"],
    ["maxToolCalls", "max_tool_calls"],
    ["preset", "preset"],
    ["panelPrompt", "panel_prompt"],
    ["synthesisPrompt", "synthesis_prompt"],
    ["finalPrompt", "final_prompt"],
    ["selectorModels", "selector_models"],
    ["selectorModel", "selector_model"],
    ["selectorPrompt", "selector_prompt"],
    ["mapperModels", "mapper_models"],
    ["mapperModel", "mapper_model"],
    ["mapperPrompt", "mapper_prompt"],
    ["parallelModels", "parallel_models"],
    ["parallelModel", "parallel_model"],
    ["parallelPrompt", "parallel_prompt"],
    ["reducerModels", "reducer_models"],
    ["reducerModel", "reducer_model"],
    ["reducerPrompt", "reducer_prompt"],
  ]) {
    if (Object.hasOwn(bodyParams, sdkKey)) {
      if (bodyParams[sdkKey] !== null && bodyParams[sdkKey] !== undefined) {
        fusion[gatewayKey] = bodyParams[sdkKey];
      }
      delete bodyParams[sdkKey];
    }
  }
  if (Object.keys(fusion).length > 0) {
    tools.push({ type: "trustedrouter:fusion", parameters: fusion });
  }

  const normalizedModel = String(model || "").trim().toLowerCase();
  const out = { model, messages, stream: true, ...bodyParams };
  if (
    tools.length > 0 ||
    ADVISOR_MODELS.has(normalizedModel) ||
    FUSION_PRIMITIVE_MODELS.has(normalizedModel)
  ) {
    if (tools.length > 0) out.tools = tools;
  }
  return out;
}

export function responsesBody({ model, input, instructions, stream, params }) {
  const body = { model, input, ...params, stream };
  delete body.apiKey;
  delete body.extraHeaders;
  delete body.idempotencyKey;
  delete body.timeout;
  delete body.workspaceId;
  if (instructions !== null && instructions !== undefined) {
    body.instructions = instructions;
  }
  return body;
}

export function broadcastDestinationBody({
  type,
  name,
  endpoint,
  enabled,
  includeContent,
  method,
  headers,
  apiKey,
}) {
  const body = {
    type,
    name,
    enabled,
    include_content: includeContent,
    method,
  };
  if (endpoint !== null && endpoint !== undefined) body.endpoint = endpoint;
  if (headers !== null && headers !== undefined) body.headers = headers;
  if (apiKey !== null && apiKey !== undefined) body.api_key = apiKey;
  return body;
}
