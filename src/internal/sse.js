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

export async function* iterSseChunks(response) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      const parsed = parseSseLine(line);
      if (parsed !== null) yield parsed;
    }
  }
  buffer += decoder.decode();
  for (const line of buffer.split(/\r?\n/)) {
    const parsed = parseSseLine(line);
    if (parsed !== null) yield parsed;
  }
}

export async function* iterSseEvents(response) {
  const decoder = new TextDecoder();
  let buffer = "";
  let frame = [];
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (line === "") {
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
      const parsed = parseSseFrame(frame);
      frame = [];
      if (parsed !== null) yield parsed;
    } else if (line) {
      frame.push(line);
    }
  }
  const parsed = parseSseFrame(frame);
  if (parsed !== null) yield parsed;
}

export function parseSseLine(line) {
  if (!line.startsWith("data:")) return null;
  const data = line.slice(5).trim();
  if (!data || data === "[DONE]") return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
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
  } catch {
    payload = { data };
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
    return {
      id: "",
      object: "chat.completion",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "" },
          finish_reason: "stop",
        },
      ],
    };
  }
  const parts = [];
  let finishReason = null;
  let role = "assistant";
  let usage = null;
  const toolCalls = new Map();
  for (const c of chunks) {
    if (c?.usage && typeof c.usage === "object") usage = c.usage;
    const choice = c?.choices?.[0];
    if (!choice) continue;
    const delta = choice.delta ?? {};
    if (typeof delta.role === "string") role = delta.role;
    const content = delta.content;
    if (typeof content === "string") parts.push(content);
    for (const call of delta.tool_calls ?? []) {
      if (!call || typeof call !== "object") continue;
      const index = call.index ?? 0;
      let slot = toolCalls.get(index);
      if (!slot) {
        slot = {
          index,
          type: "function",
          function: { name: "", arguments: "" },
        };
        toolCalls.set(index, slot);
      }
      if (call.id) slot.id = call.id;
      if (call.type) slot.type = call.type;
      if (call.function && typeof call.function === "object") {
        if (call.function.name) slot.function.name = call.function.name;
        if (typeof call.function.arguments === "string") {
          slot.function.arguments += call.function.arguments;
        }
      }
    }
    if (choice.finish_reason) finishReason = choice.finish_reason;
  }
  const last = chunks[chunks.length - 1];
  const content = parts.join("");
  const message = {
    role,
    content: content || (toolCalls.size ? null : ""),
  };
  if (toolCalls.size) {
    message.tool_calls = [...toolCalls.keys()]
      .sort((a, b) => a - b)
      .map((index) => toolCalls.get(index));
  }
  const result = {
    id: last?.id ?? "",
    object: "chat.completion",
    created: last?.created ?? 0,
    model: last?.model ?? "",
    choices: [
      {
        index: 0,
        message,
        finish_reason: finishReason ?? "stop",
      },
    ],
  };
  if (usage !== null) result.usage = usage;
  return result;
}
