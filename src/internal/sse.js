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

import { InternalError } from "./errors.js";

function protocolError(message, payload = null) {
  return new InternalError(502, message, payload);
}

function sseData(line) {
  if (!line.startsWith("data:")) return null;
  return line.slice(5).trim();
}

export async function* iterSseChunks(response) {
  const decoder = new TextDecoder();
  let buffer = "";
  let sawDone = false;
  for await (const chunk of response.body) {
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

export async function* iterSseEvents(response) {
  const decoder = new TextDecoder();
  let buffer = "";
  let frame = [];
  let sawDone = false;
  for await (const chunk of response.body) {
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

export function parseSseLine(line) {
  const data = sseData(line);
  if (data === null) return null;
  if (!data || data === "[DONE]") return null;
  let payload;
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
  if (typeof payload.error === "string" || (payload.error && typeof payload.error === "object")) {
    throw protocolError("TrustedRouter SSE stream reported an error", payload);
  }
  return payload;
}

export function parseSseFrame(lines) {
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
  let payload;
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
    ? payload
    : { event, data: payload };
}

/**
 * Roll a list of chat.completion.chunk frames into a single
 * chat.completion dict. Mirrors the Python `_collect_completion`
 * helper so the two SDKs produce identical aggregated output.
 */
export function collectCompletion(chunks) {
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
  const envelope = {};
  const choicesByIndex = new Map();
  for (const c of chunks) {
    for (const [key, value] of Object.entries(c ?? {})) {
      if (!["choices", "usage", "trustedrouter", "object"].includes(key)) {
        envelope[key] = value;
      }
    }
    if (c?.usage && typeof c.usage === "object") usage = c.usage;
    if (!Array.isArray(c?.choices)) continue;
    for (let ordinal = 0; ordinal < c.choices.length; ordinal += 1) {
      const choice = c.choices[ordinal];
      if (!choice || typeof choice !== "object") continue;
      const index = Number.isInteger(choice.index) ? choice.index : ordinal;
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
      for (const [key, value] of Object.entries(delta)) {
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
    const state = choicesByIndex.get(index);
    const message = { role: state.role, ...state.messageExtras };
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

  const result = {
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

function collectTrustedRouterMetadata(chunks) {
  let trustedRouterDetails = {};
  const synthEvents = [];
  const synthDetails = {};

  for (const chunk of chunks) {
    const trusted = chunk?.trustedrouter;
    if (!trusted || typeof trusted !== "object" || Array.isArray(trusted)) continue;

    // Synth needs structural aggregation, but every sibling is ordinary
    // envelope metadata. Preserve those fields across chunks with the same
    // last-frame-wins rule used by the completion envelope itself.
    trustedRouterDetails = {
      ...trustedRouterDetails,
      ...Object.fromEntries(Object.entries(trusted).filter(([key]) => key !== "synth")),
    };

    const synth = trusted.synth;
    if (!synth || typeof synth !== "object" || Array.isArray(synth)) continue;

    const synthChunk = { ...synth };
    if (Object.hasOwn(synthChunk, "event")) synthEvents.push(synthChunk);
    else Object.assign(synthDetails, synthChunk);
  }

  const hasSynth = synthEvents.length > 0 || Object.keys(synthDetails).length > 0;
  if (!hasSynth) {
    return Object.keys(trustedRouterDetails).length ? trustedRouterDetails : null;
  }

  const synth = { ...synthDetails };
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

function trustedRouterSynthEventDetail(event) {
  const detail = event.detail;
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return null;
  const result = { ...detail };
  for (const key of ["stage", "index", "model"]) {
    if (Object.hasOwn(event, key) && !Object.hasOwn(result, key)) result[key] = event[key];
  }
  return result;
}

function mergeToolCallDeltas(toolCalls, value) {
  if (!Array.isArray(value)) return;
  value.forEach((call, ordinal) => {
    if (!call || typeof call !== "object") return;
    const index = Number.isInteger(call.index) ? call.index : ordinal;
    let slot = toolCalls.get(index);
    if (!slot) {
      slot = {
        index,
        type: "function",
        function: { name: "", arguments: "" },
      };
      toolCalls.set(index, slot);
    }
    for (const [key, item] of Object.entries(call)) {
      if (!["index", "function"].includes(key)) slot[key] = item;
    }
    if (call.function && typeof call.function === "object") {
      for (const [key, item] of Object.entries(call.function)) {
        if (key === "arguments" && typeof item === "string") slot.function.arguments += item;
        else if (item !== null && item !== undefined) slot.function[key] = item;
      }
    }
  });
}

function mergeFunctionCallDelta(state, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  state.sawFunctionCall = true;
  for (const [key, item] of Object.entries(value)) {
    if (key === "arguments" && typeof item === "string") state.functionCall.arguments += item;
    else if (item !== null && item !== undefined) state.functionCall[key] = item;
  }
}
