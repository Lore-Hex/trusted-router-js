/**
 * L5 — STREAM CODEC.
 *
 * SSE frame/line parsing, typed chunk/event iteration, and
 * stream→completion collection. Pure functions over an opened Response.
 *
 * No retry logic may EVER live here. Retries happen only before any body
 * bytes are surfaced (see ./transport.js); once a Response reaches this
 * module it is final — a broken open stream propagates, never reconnects.
 */

import type { ChatCompletion, ChatCompletionChunk } from "../index.js";

import { InternalError } from "./errors.js";
import {
  beginRecorderStream,
  endRecorderStream,
  recorderFor,
} from "./telemetry.js";

// JSON fields remain unknown until the existing codec checks narrow them.
type JsonObject = Record<string, unknown>;
interface FunctionCall extends JsonObject {
  // Non-string argument deltas are copied as-is; a later string uses JS += coercion.
  arguments: unknown;
}
export interface CollectedCompletion extends JsonObject {
  id: unknown;
  object: "chat.completion";
  created: unknown;
  model: unknown;
  choices: Array<{ index: number; message: JsonObject; finish_reason: unknown }>;
  usage?: object;
  trustedrouter?: JsonObject;
}
interface ToolCall extends JsonObject {
  index: number;
  function: FunctionCall;
}
interface ChoiceState {
  index: number;
  role: string;
  parts: Map<string, string[]>;
  seenDeltaFields: Set<string>;
  messageExtras: JsonObject;
  choiceExtras: JsonObject;
  toolCalls: Map<number, ToolCall>;
  functionCall: FunctionCall;
  sawFunctionCall: boolean;
  finishReason: unknown;
}

function protocolError(message: string, payload: unknown = null) {
  return new InternalError(502, message, payload);
}

function sseData(line: string) {
  if (!line.startsWith("data:")) return null;
  return line.slice(5).trim();
}

/**
 * Delegate to a decoder and report its FIRST decoded event to the telemetry
 * recorder the engine attached to this Response — the one place TTFT is
 * observable (client telemetry contract v1 §6.1). A Response the engine did
 * not return (no recorder) decodes exactly as before.
 */
async function* observeFirstEvent<T>(response: Response, events: AsyncIterable<T>) {
  let first = true;
  beginRecorderStream(response);
  try {
    for await (const item of events) {
      if (first) {
        first = false;
        recorderFor(response)?.onFirstEvent();
      }
      yield item;
    }
  } finally {
    endRecorderStream(response);
  }
}

export function iterSseChunks(response: Response) {
  return observeFirstEvent(response, decodeSseChunks(response));
}

export function iterSseEvents(response: Response) {
  return observeFirstEvent(response, decodeSseEvents(response));
}

// Node 20 response bodies are async iterable; the configured DOM library omits
// that protocol. Keep the original null-body failure and byte views unchanged.
async function* decodeSseChunks(response: Response) {
  const decoder = new TextDecoder();
  let buffer = "";
  let sawDone = false;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array<ArrayBuffer>>) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      const data = sseData(line);
      if (data === "[DONE]") {
        sawDone = true;
        continue;
      }
      if (sawDone && data) {
        throw protocolError("TrustedRouter SSE emitted data after [DONE]");
      }
      const parsed = parseSseLine(line);
      if (parsed !== null) yield parsed;
    }
  }
  buffer += decoder.decode();
  for (const line of buffer.split(/\r?\n/)) {
    const data = sseData(line);
    if (data === "[DONE]") {
      sawDone = true;
      continue;
    }
    if (sawDone && data) {
      throw protocolError("TrustedRouter SSE emitted data after [DONE]");
    }
    const parsed = parseSseLine(line);
    if (parsed !== null) yield parsed;
  }
  if (!sawDone) {
    throw protocolError("TrustedRouter SSE stream ended before data: [DONE]");
  }
}

async function* decodeSseEvents(response: Response) {
  const decoder = new TextDecoder();
  let buffer = "";
  let frame: string[] = [];
  let sawDone = false;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array<ArrayBuffer>>) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (line === "") {
        if (frame.some((item) => sseData(item) === "[DONE]")) {
          sawDone = true;
          frame = [];
          continue;
        }
        if (sawDone && frame.some((item) => Boolean(sseData(item)))) {
          throw protocolError("TrustedRouter SSE emitted data after [DONE]");
        }
        const parsed = parseSseFrame(frame);
        frame = [];
        if (parsed !== null) yield parsed;
      } else {
        frame.push(line);
      }
    }
  }
  buffer += decoder.decode();
  for (const line of buffer.split(/\r?\n/)) {
    if (line === "") {
      if (frame.some((item) => sseData(item) === "[DONE]")) {
        sawDone = true;
        frame = [];
        continue;
      }
      if (sawDone && frame.some((item) => Boolean(sseData(item)))) {
        throw protocolError("TrustedRouter SSE emitted data after [DONE]");
      }
      const parsed = parseSseFrame(frame);
      frame = [];
      if (parsed !== null) yield parsed;
    } else if (line) {
      frame.push(line);
    }
  }
  if (frame.some((item) => sseData(item) === "[DONE]")) {
    sawDone = true;
  } else {
    if (sawDone && frame.some((item) => Boolean(sseData(item)))) {
      throw protocolError("TrustedRouter SSE emitted data after [DONE]");
    }
    const parsed = parseSseFrame(frame);
    if (parsed !== null) yield parsed;
  }
  if (!sawDone) {
    throw protocolError("TrustedRouter SSE stream ended before data: [DONE]");
  }
}

export function parseSseLine(line: string): JsonObject | null {
  const data = sseData(line);
  if (data === null) return null;
  if (!data || data === "[DONE]") return null;
  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch (error) {
    throw protocolError("Malformed JSON in TrustedRouter SSE data frame", {
      cause: String(error),
    });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw protocolError(
      "TrustedRouter SSE data frame must contain a JSON object",
      payload,
    );
  }
  if (typeof (payload as JsonObject).error === "string" || ((payload as JsonObject).error && typeof (payload as JsonObject).error === "object")) {
    throw protocolError("TrustedRouter SSE stream reported an error", payload);
  }
  return payload as JsonObject;
}

export function parseSseFrame(lines: string[]): JsonObject | unknown[] | null {
  if (!lines.length) return null;
  let event = null;
  const dataParts = [];
  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataParts.push(line.slice(5).trim());
    }
  }
  const data = dataParts.join("\n").trim();
  if (!data || data === "[DONE]") return null;
  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch (error) {
    throw protocolError("Malformed JSON in TrustedRouter SSE event", {
      cause: String(error),
    });
  }
  if (
    event &&
    payload &&
    typeof payload === "object" &&
    !Object.hasOwn(payload, "event")
  ) {
    return { event, ...payload };
  }
  return payload && typeof payload === "object"
    ? payload as JsonObject | unknown[]
    : { event, data: payload };
}

/**
 * Roll a list of chat.completion.chunk frames into a single
 * chat.completion dict. Mirrors the Python `_collect_completion`
 * helper so the two SDKs produce identical aggregated output.
 */
// Keep the shipped public contract while the implementation tracks unchecked
// wire fields as unknown. This overload adds no runtime validation.
export function collectCompletion(chunks: ChatCompletionChunk[]): ChatCompletion;
export function collectCompletion(chunks: Array<JsonObject | null | undefined>): CollectedCompletion | ChatCompletion {
  if (chunks.length === 0) {
    throw protocolError("TrustedRouter returned an empty completion stream");
  }
  const concatenatedFields = new Set([
    "content",
    "reasoning",
    "reasoning_content",
    "refusal",
  ]);
  let usage = null;
  const trustedrouter = collectTrustedRouterMetadata(chunks);
  const envelope: JsonObject = {};
  const choicesByIndex = new Map<number, ChoiceState>();
  for (const c of chunks) {
    for (const [key, value] of Object.entries(c ?? {})) {
      if (!["choices", "usage", "trustedrouter", "object"].includes(key)) {
        envelope[key] = value;
      }
    }
    if (c?.usage && typeof c.usage === "object") usage = c.usage;
    if (!Array.isArray(c?.choices)) continue;
    for (let ordinal = 0; ordinal < c.choices.length; ordinal += 1) {
      const choice = c.choices[ordinal] as JsonObject | null | undefined;
      if (!choice || typeof choice !== "object") continue;
      const index = Number.isInteger(choice.index) ? choice.index as number : ordinal;
      let state = choicesByIndex.get(index);
      if (!state) {
        state = {
          index,
          role: "assistant",
          parts: new Map(),
          seenDeltaFields: new Set(),
          messageExtras: {},
          choiceExtras: {},
          toolCalls: new Map(),
          functionCall: { name: "", arguments: "" },
          sawFunctionCall: false,
          finishReason: null,
        };
        choicesByIndex.set(index, state);
      }
      for (const [key, value] of Object.entries(choice)) {
        if (!["index", "delta", "finish_reason"].includes(key)) {
          state.choiceExtras[key] = value;
        }
      }
      const delta = choice.delta ?? {};
      if (!delta || typeof delta !== "object" || Array.isArray(delta)) {
        throw protocolError("TrustedRouter completion choice delta must be an object", choice);
      }
      for (const [key, value] of Object.entries(delta as JsonObject)) {
        state.seenDeltaFields.add(key);
        if (key === "role" && typeof value === "string") {
          state.role = value;
        } else if (concatenatedFields.has(key)) {
          if (typeof value === "string") {
            const parts = state.parts.get(key) ?? [];
            parts.push(value);
            state.parts.set(key, parts);
          } else if (value !== null) {
            state.messageExtras[key] = value;
          }
        } else if (key === "tool_calls") {
          mergeToolCallDeltas(state.toolCalls, value);
        } else if (key === "function_call") {
          mergeFunctionCallDelta(state, value);
        } else {
          state.messageExtras[key] = value;
        }
      }
      if (choice.finish_reason !== null && choice.finish_reason !== undefined) {
        state.finishReason = choice.finish_reason;
      }
    }
  }
  if (choicesByIndex.size === 0) {
    throw protocolError("TrustedRouter completion stream contained no choices");
  }

  const choices = [...choicesByIndex.keys()].sort((a, b) => a - b).map((index) => {
    const state = choicesByIndex.get(index)!;
    const message: JsonObject = { role: state.role, ...state.messageExtras };
    for (const field of concatenatedFields) {
      const parts = state.parts.get(field);
      if (parts?.length) message[field] = parts.join("");
      else if (state.seenDeltaFields.has(field) && !(field in message)) message[field] = null;
    }
    if (state.toolCalls.size) {
      message.tool_calls = [...state.toolCalls.keys()]
        .sort((a, b) => a - b)
        .map((toolIndex) => state.toolCalls.get(toolIndex));
    }
    if (state.sawFunctionCall) message.function_call = state.functionCall;
    if (!("content" in message)) {
      message.content = state.toolCalls.size || state.sawFunctionCall ||
          ["reasoning", "reasoning_content", "refusal"].some((field) => field in message)
        ? null
        : "";
    }
    return {
      ...state.choiceExtras,
      index,
      message,
      finish_reason: state.finishReason,
    };
  });

  const result: CollectedCompletion = {
    ...envelope,
    id: envelope.id ?? "",
    object: "chat.completion",
    created: envelope.created ?? 0,
    model: envelope.model ?? "",
    choices,
  };
  if (usage !== null) result.usage = usage;
  if (trustedrouter !== null) result.trustedrouter = trustedrouter;
  return result;
}

function collectTrustedRouterMetadata(chunks: Array<JsonObject | null | undefined>) {
  let trustedRouterDetails: JsonObject = {};
  const synthEvents: JsonObject[] = [];
  const synthDetails: JsonObject = {};

  for (const chunk of chunks) {
    const trusted = chunk?.trustedrouter;
    if (!trusted || typeof trusted !== "object" || Array.isArray(trusted)) continue;

    // Synth needs structural aggregation, but every sibling is ordinary
    // envelope metadata. Preserve those fields across chunks with the same
    // last-frame-wins rule used by the completion envelope itself.
    trustedRouterDetails = {
      ...trustedRouterDetails,
      ...Object.fromEntries(Object.entries(trusted as JsonObject).filter(([key]) => key !== "synth")),
    };

    const synth = (trusted as JsonObject).synth;
    if (!synth || typeof synth !== "object" || Array.isArray(synth)) continue;

    const synthChunk: JsonObject = { ...synth };
    if (Object.hasOwn(synthChunk, "event")) synthEvents.push(synthChunk);
    else Object.assign(synthDetails, synthChunk);
  }

  const hasSynth = synthEvents.length > 0 || Object.keys(synthDetails).length > 0;
  if (!hasSynth) {
    return Object.keys(trustedRouterDetails).length ? trustedRouterDetails : null;
  }

  const synth: JsonObject = { ...synthDetails };
  if (synthEvents.length) synth.events = synthEvents;

  const panel = [];
  const judgeAttempts = [];
  const finalAttempts = [];
  for (const event of synthEvents) {
    const detail = trustedRouterSynthEventDetail(event);
    if (detail === null) continue;
    if (event.event === "panel.done") panel.push(detail);
    else if (event.event === "judge.done") judgeAttempts.push(detail);
    else if (event.event === "final.done") finalAttempts.push(detail);
  }

  if (panel.length && !Object.hasOwn(synth, "panel")) synth.panel = panel;
  if (judgeAttempts.length) {
    if (!Object.hasOwn(synth, "judge_attempts")) synth.judge_attempts = judgeAttempts;
    if (!Object.hasOwn(synth, "judge")) synth.judge = judgeAttempts.at(-1);
  }
  if (finalAttempts.length && !Object.hasOwn(synth, "final_attempts")) {
    synth.final_attempts = finalAttempts;
  }

  return { ...trustedRouterDetails, synth };
}

function trustedRouterSynthEventDetail(event: JsonObject) {
  const detail = event.detail;
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return null;
  const result: JsonObject = { ...detail };
  for (const key of ["stage", "index", "model"]) {
    if (Object.hasOwn(event, key) && !Object.hasOwn(result, key)) result[key] = event[key];
  }
  return result;
}

function mergeToolCallDeltas(toolCalls: Map<number, ToolCall>, value: unknown) {
  if (!Array.isArray(value)) return;
  (value as unknown[]).forEach((call, ordinal) => {
    if (!call || typeof call !== "object") return;
    const index = Number.isInteger((call as JsonObject).index) ? (call as JsonObject).index as number : ordinal;
    let slot = toolCalls.get(index);
    if (!slot) {
      slot = {
        index,
        type: "function",
        function: { name: "", arguments: "" },
      };
      toolCalls.set(index, slot);
    }
    for (const [key, item] of Object.entries(call as JsonObject)) {
      if (!["index", "function"].includes(key)) slot[key] = item;
    }
    if ((call as JsonObject).function && typeof (call as JsonObject).function === "object") {
      for (const [key, item] of Object.entries((call as JsonObject).function as JsonObject)) {
        if (key === "arguments" && typeof item === "string") (slot.function.arguments as string) += item;
        else if (item !== null && item !== undefined) slot.function[key] = item;
      }
    }
  });
}

function mergeFunctionCallDelta(state: ChoiceState, value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  state.sawFunctionCall = true;
  for (const [key, item] of Object.entries(value as JsonObject)) {
    if (key === "arguments" && typeof item === "string") (state.functionCall.arguments as string) += item;
    else if (item !== null && item !== undefined) state.functionCall[key] = item;
  }
}
