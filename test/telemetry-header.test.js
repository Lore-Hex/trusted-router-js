import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_API_BASE_URL, TrustedRouter } from "../src/index.js";
import {
  RequestRecorder,
  classifyTransportError,
  hostEnum,
  resolveTelemetryEnabled,
} from "../src/internal/telemetry.js";

// Engine-path tests drive the REAL loop (performRequest via the client's
// request/rawRequest/facade methods) with an injected fetch; nothing here
// re-derives header bytes. Recorder/classifier boundary cases that the
// engine cannot cheaply reach (attempt index 100, corrupted state, the
// doc's serializer vector, the classifier matrix) are unit-tested against
// the real implementation directly and labeled as such.

async function withEnv(overrides, fn) {
  const saved = {};
  for (const [key, value] of Object.entries(overrides)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const scrubbed = { TRUSTEDROUTER_TELEMETRY: undefined, DO_NOT_TRACK: undefined };

function okJson(body = { ok: true }) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function sseResponse() {
  return new Response(
    'data: {"id":"c1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n',
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

function clientWithFetch(fetchImpl, options = {}) {
  return new TrustedRouter({ apiKey: "sk-test", fetchImpl, maxRetries: 3, ...options });
}

function assertHeaderGrammar(header) {
  assert.ok(Buffer.byteLength(header, "utf8") <= 160, `over 160 bytes: ${header}`);
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    assert.ok(eq > 0, `not key=value: ${part}`);
    assert.match(part.slice(0, eq), /^(v|a|po|pc|ph|pm|sm|s|fo)$/);
    assert.match(part.slice(eq + 1), /^[a-z0-9_]{1,24}$/);
  }
}

test("attempt 0 sends exactly v=1;a=0;s=0 on a buffered inference request", async () => {
  await withEnv(scrubbed, async () => {
    const headers = [];
    const sdk = clientWithFetch(async (url, init) => {
      headers.push(init.headers.get("x-tr-client"));
      return okJson();
    });
    await sdk.request("POST", "/embeddings", { body: { model: "m", input: "x" } });
    assert.deepEqual(headers, ["v=1;a=0;s=0"]);
    assertHeaderGrammar(headers[0]);
  });
});

test("attempt 0 sends exactly v=1;a=0;s=1 on a streaming inference request", async () => {
  await withEnv(scrubbed, async () => {
    const headers = [];
    const sdk = clientWithFetch(async (url, init) => {
      headers.push(init.headers.get("x-tr-client"));
      return sseResponse();
    });
    const chunks = [];
    for await (const chunk of sdk.chatCompletionsChunks({
      messages: [{ role: "user", content: "hi" }],
    })) {
      chunks.push(chunk);
    }
    assert.deepEqual(headers, ["v=1;a=0;s=1"]);
    assertHeaderGrammar(headers[0]);
    assert.equal(chunks.length, 1);
  });
});

test("a retry after a connect timeout carries po=timeout with the exact class and clocks", async () => {
  // The scenario of the doc's §3.2 retry example, driven through the real
  // engine: a connect timeout on the apex that moved to an alias. The
  // deterministic clock pins pm=10012 and sm=10530; the undici-shaped cause
  // pins pc=connect_timeout through the real classifier. Timeout-class
  // failures record outcome `timeout` per the Python reference modules —
  // which the contract says win over the doc's literal example (that shows
  // po=transport_error; see the serializer vector below).
  await withEnv(scrubbed, async () => {
    const headers = [];
    const clock = [0, 10_012, 10_530];
    let clockIndex = 0;
    let call = 0;
    const sdk = clientWithFetch(async (url, init) => {
      headers.push(init.headers.get("x-tr-client"));
      call += 1;
      if (call === 1) {
        const cause = Object.assign(new Error("Connect Timeout Error"), {
          code: "UND_ERR_CONNECT_TIMEOUT",
        });
        throw new TypeError("fetch failed", { cause });
      }
      return sseResponse();
    });
    sdk._telemetryNow = () => {
      const value = clock[Math.min(clockIndex, clock.length - 1)];
      clockIndex += 1;
      return value;
    };
    const response = await sdk.rawRequest("POST", "/chat/completions", {
      headers: { accept: "text/event-stream" },
      body: { model: "m", messages: [] },
    });
    assert.equal(response.status, 200);
    assert.equal(headers[0], "v=1;a=0;s=1");
    assert.equal(
      headers[1],
      "v=1;a=1;po=timeout;pc=connect_timeout;ph=apex;pm=10012;sm=10530;s=1;fo=1",
    );
    assertHeaderGrammar(headers[1]);
  });
});

test("a retry after a non-timeout transport failure carries po=transport_error", async () => {
  await withEnv(scrubbed, async () => {
    const headers = [];
    let call = 0;
    const sdk = clientWithFetch(async (url, init) => {
      headers.push(init.headers.get("x-tr-client"));
      call += 1;
      if (call === 1) {
        const cause = Object.assign(new Error("read ECONNRESET"), {
          code: "ECONNRESET",
        });
        throw new TypeError("fetch failed", { cause });
      }
      return okJson();
    });
    assert.deepEqual(
      await sdk.request("POST", "/embeddings", { body: { model: "m", input: "x" } }),
      { ok: true },
    );
    assert.match(
      headers[1],
      /^v=1;a=1;po=transport_error;pc=reset;ph=apex;pm=\d{1,7};sm=\d{1,7};s=0;fo=1$/,
    );
  });
});

test("a caller TimeoutError (AbortSignal.timeout) records po=timeout with pc=unknown", async () => {
  await withEnv(scrubbed, async () => {
    const headers = [];
    let call = 0;
    const sdk = clientWithFetch(async (url, init) => {
      headers.push(init.headers.get("x-tr-client"));
      call += 1;
      if (call === 1) {
        throw new DOMException("The operation timed out.", "TimeoutError");
      }
      return okJson();
    });
    await sdk.request("POST", "/embeddings", { body: { model: "m", input: "x" } });
    // A timeout the client observed, of unknowable class: outcome timeout,
    // class unknown — mirroring the Python reference's split between the
    // two. (AbortError stays terminal and untouched.)
    assert.match(
      headers[1],
      /^v=1;a=1;po=timeout;pc=unknown;ph=apex;pm=\d{1,7};sm=\d{1,7};s=0;fo=1$/,
    );
  });
});

test("a caller-supplied x-tr-client never bypasses suppression", async () => {
  await withEnv(scrubbed, async () => {
    // Opted out + constructor headers: stripped.
    const seen1 = [];
    const sdk1 = clientWithFetch(
      async (url, init) => {
        seen1.push(init.headers.get("x-tr-client"));
        return okJson();
      },
      { telemetry: false, headers: { "x-tr-client": "v=1;a=0;s=0" } },
    );
    await sdk1.request("POST", "/embeddings", { body: { model: "m", input: "x" } });
    assert.deepEqual(seen1, [null]);

    // Custom base (telemetry defaults off) + extraHeaders: stripped.
    const seen2 = [];
    const sdk2 = new TrustedRouter({
      apiKey: "sk-test",
      baseUrl: "https://my.internal/v1",
      fetchImpl: async (url, init) => {
        seen2.push(init.headers.get("x-tr-client"));
        return okJson();
      },
    });
    await sdk2.request("POST", "/embeddings", {
      body: { model: "m", input: "x" },
      extraHeaders: { "x-tr-client": "not even grammatical !!" },
    });
    assert.deepEqual(seen2, [null]);

    // Control-plane call + per-call headers: stripped.
    const seen3 = [];
    const sdk3 = clientWithFetch(
      async (url, init) => {
        seen3.push(init.headers.get("x-tr-client"));
        return okJson({ data: [] });
      },
      { telemetry: true },
    );
    await sdk3._controlRequest("GET", "/models", {
      headers: { "x-tr-client": "forged" },
    });
    assert.deepEqual(seen3, [null]);

    // Telemetry on: the engine's validated value wins over a forged one.
    const seen4 = [];
    const sdk4 = clientWithFetch(async (url, init) => {
      seen4.push(init.headers.get("x-tr-client"));
      return okJson();
    });
    await sdk4.request("POST", "/embeddings", {
      body: { model: "m", input: "x" },
      headers: { "x-tr-client": "forged" },
    });
    assert.deepEqual(seen4, ["v=1;a=0;s=0"]);
  });
});

test("retry attempts never mutate a Headers object already handed to fetch", async () => {
  await withEnv(scrubbed, async () => {
    const retained = [];
    let call = 0;
    const sdk = clientWithFetch(async (url, init) => {
      retained.push(init.headers);
      call += 1;
      if (call === 1) return new Response("{}", { status: 503 });
      return okJson();
    });
    await sdk.request("GET", "/models");
    assert.equal(retained.length, 2);
    assert.notEqual(retained[0], retained[1]);
    // The first attempt's object still says a=0 after the retry completed.
    assert.equal(retained[0].get("x-tr-client"), "v=1;a=0;s=0");
    assert.match(retained[1].get("x-tr-client"), /^v=1;a=1;po=http_error/);
  });
});

test("serializer vector: the doc's §3.2 example string, byte-for-byte", () => {
  // The contract DOC's literal retry example. Its po=transport_error for a
  // connect timeout contradicts the reference modules (which yield
  // po=timeout, asserted on the engine path above) and the contract says
  // the modules win — so this is pinned purely as a SERIALIZER vector: key
  // order, formatting, and grammar of the doc's exact bytes.
  const recorder = new RequestRecorder({ streaming: true, now: () => 10_530 });
  recorder.beginAttempt("https://api.trustedrouter.com/v1");
  recorder._firstStarted = 0;
  recorder.attempts.push({
    index: 0,
    host: "apex",
    outcome: "transport_error",
    httpStatus: null,
    errorClass: "connect_timeout",
    elapsedMs: 10_012,
    moved: true,
  });
  recorder.failoverUsed = true;
  recorder._currentIndex = 1;
  assert.equal(
    recorder.headerValue(),
    "v=1;a=1;po=transport_error;pc=connect_timeout;ph=apex;pm=10012;sm=10530;s=1;fo=1",
  );
});

test("an attempt index past 99 sends no header at all", () => {
  const recorder = new RequestRecorder({ streaming: false, now: () => 0 });
  const error = Object.assign(new Error("boom"), { code: "ECONNRESET" });
  for (let i = 0; i <= 99; i += 1) {
    recorder.beginAttempt("https://api.trustedrouter.com/v1");
    recorder.onTransportError(error);
  }
  assert.equal(recorder.attempts.length, 100);
  recorder.beginAttempt("https://api.trustedrouter.com/v1");
  // a=100 would leave the contract's 0..99 range; the enclave would drop
  // it server-side, so the SDK must not emit it in the first place.
  assert.equal(recorder.headerValue(), null);
});

test("a custom base URL never carries x-tr-client, even when telemetry is forced on", async () => {
  const captured = [];
  const sdk = new TrustedRouter({
    apiKey: "sk-test",
    baseUrl: "https://my.internal/v1",
    fetchImpl: async (url, init) => {
      captured.push(init.headers.has("x-tr-client"));
      return okJson();
    },
    telemetry: true,
  });
  await sdk.request("POST", "/embeddings", { body: { model: "m", input: "x" } });
  assert.deepEqual(captured, [false]);
});

test("control-plane calls carry no x-tr-client and never touch a recorder", async () => {
  const captured = [];
  let clockCalls = 0;
  const sdk = clientWithFetch(
    async (url, init) => {
      captured.push(init.headers.has("x-tr-client"));
      return okJson({ data: [] });
    },
    { telemetry: true },
  );
  // The recorder is the only consumer of the injected clock, so zero calls
  // proves no recorder was constructed or driven for the control plane.
  sdk._telemetryNow = () => {
    clockCalls += 1;
    return 0;
  };
  await sdk.models();
  assert.deepEqual(captured, [false]);
  assert.equal(clockCalls, 0);
});

test("opt-out precedence: explicit beats env, env beats DO_NOT_TRACK, default needs TR hosts", () => {
  const apex = DEFAULT_API_BASE_URL;
  const control = "https://trustedrouter.com/v1";
  const at = (explicit, environ, baseUrl = apex, controlBaseUrl = control) =>
    resolveTelemetryEnabled(explicit, { baseUrl, controlBaseUrl, environ });

  assert.equal(at(false, { TRUSTEDROUTER_TELEMETRY: "1" }), false);
  assert.equal(at(true, { TRUSTEDROUTER_TELEMETRY: "0" }), true);
  assert.equal(at(true, { DO_NOT_TRACK: "1" }), true);
  for (const off of ["0", "false", "off", "no"]) {
    assert.equal(at(null, { TRUSTEDROUTER_TELEMETRY: off }), false);
  }
  for (const on of ["1", "true", "on", "yes"]) {
    assert.equal(at(null, { TRUSTEDROUTER_TELEMETRY: on }), true);
    assert.equal(at(null, { TRUSTEDROUTER_TELEMETRY: on, DO_NOT_TRACK: "1" }), true);
  }
  assert.equal(at(null, { DO_NOT_TRACK: "1" }), false);
  assert.equal(at(null, {}), true);
  // Default-on only for known TrustedRouter hosts…
  assert.equal(at(null, {}, "https://my.internal/v1"), false);
  assert.equal(at(null, {}, "https://api.allyrouter.com/v1"), true);
  assert.equal(at(null, {}, "https://api-us-east4.quillrouter.com/v1"), true);
  // A control host as the inference base also defaults on: the rule is
  // hostEnum(base) !== "custom", deliberately mirroring trusted-router-py's
  // resolve_telemetry_enabled so the two SDKs cannot drift.
  assert.equal(at(null, {}, "https://trustedrouter.com/v1"), true);
  // …AND an https trustedrouter.com control plane.
  assert.equal(at(null, {}, apex, "https://control.my.internal/v1"), false);
  assert.equal(at(null, {}, apex, "http://trustedrouter.com/v1"), false);
  assert.equal(at(null, {}, apex, "https://eu.trustedrouter.com/v1"), true);
});

test("opted-out clients send no x-tr-client while User-Agent stays", async () => {
  const cases = [
    [{ TRUSTEDROUTER_TELEMETRY: "1", DO_NOT_TRACK: undefined }, { telemetry: false }],
    [{ TRUSTEDROUTER_TELEMETRY: "0", DO_NOT_TRACK: undefined }, {}],
    [{ TRUSTEDROUTER_TELEMETRY: undefined, DO_NOT_TRACK: "1" }, {}],
  ];
  for (const [env, options] of cases) {
    await withEnv(env, async () => {
      const captured = [];
      const sdk = clientWithFetch(async (url, init) => {
        captured.push({
          telemetry: init.headers.has("x-tr-client"),
          userAgent: init.headers.get("user-agent"),
        });
        return okJson();
      }, options);
      await sdk.request("POST", "/embeddings", { body: { model: "m", input: "x" } });
      assert.equal(captured[0].telemetry, false, JSON.stringify({ env, options }));
      assert.match(captured[0].userAgent, /^trusted-router-js\//);
    });
  }
});

test("hostEnum maps the closed vocabulary and nothing else", () => {
  assert.equal(hostEnum("https://api.trustedrouter.com/v1"), "apex");
  assert.equal(hostEnum("https://api.allyrouter.com/v1"), "ally");
  assert.equal(hostEnum("https://api.uptimerouter.com/v1"), "uptime");
  assert.equal(hostEnum("https://api-us-central1.quillrouter.com/v1"), "us_central1");
  assert.equal(hostEnum("https://api-us-east4.quillrouter.com/v1"), "us_east4");
  assert.equal(hostEnum("https://api-europe-west4.quillrouter.com/v1"), "europe_west4");
  assert.equal(hostEnum("https://trustedrouter.com/v1"), "control");
  assert.equal(hostEnum("https://eu.trustedrouter.com/v1"), "control");
  assert.equal(hostEnum("https://my.internal/v1"), "custom");
  assert.equal(hostEnum("http://api.trustedrouter.com/v1"), "custom");
  assert.equal(hostEnum("not a url"), "custom");
});

test("transport errors classify from real undici shapes before flattening", () => {
  const fetchFailed = (props) =>
    new TypeError("fetch failed", { cause: Object.assign(new Error("x"), props) });

  assert.equal(classifyTransportError(fetchFailed({ code: "ENOTFOUND" })), "dns");
  assert.equal(classifyTransportError(fetchFailed({ code: "EAI_AGAIN" })), "dns");
  assert.equal(
    classifyTransportError(fetchFailed({ code: "DEPTH_ZERO_SELF_SIGNED_CERT" })),
    "tls",
  );
  assert.equal(classifyTransportError(fetchFailed({ code: "CERT_HAS_EXPIRED" })), "tls");
  assert.equal(
    classifyTransportError(fetchFailed({ code: "ERR_SSL_WRONG_VERSION_NUMBER" })),
    "tls",
  );
  assert.equal(
    classifyTransportError(fetchFailed({ code: "ERR_TLS_CERT_ALTNAME_INVALID" })),
    "tls",
  );
  assert.equal(
    classifyTransportError(fetchFailed({ code: "ECONNREFUSED" })),
    "connect_refused",
  );
  assert.equal(
    classifyTransportError(fetchFailed({ code: "UND_ERR_CONNECT_TIMEOUT" })),
    "connect_timeout",
  );
  assert.equal(classifyTransportError(fetchFailed({ code: "ETIMEDOUT" })), "connect_timeout");
  assert.equal(
    classifyTransportError(fetchFailed({ code: "UND_ERR_HEADERS_TIMEOUT" })),
    "read_timeout",
  );
  assert.equal(
    classifyTransportError(fetchFailed({ code: "UND_ERR_BODY_TIMEOUT" })),
    "read_timeout",
  );
  assert.equal(classifyTransportError(fetchFailed({ code: "ECONNRESET" })), "reset");
  assert.equal(classifyTransportError(fetchFailed({ code: "UND_ERR_SOCKET" })), "reset");
  assert.equal(classifyTransportError(fetchFailed({ code: "EHOSTUNREACH" })), "connect_error");
  assert.equal(
    classifyTransportError(fetchFailed({ code: "HPE_INVALID_CONSTANT" })),
    "protocol_error",
  );
  assert.equal(classifyTransportError(fetchFailed({ code: "EPIPE" })), "io_error");
  // The EPROTO split: TLS handshake noise classifies as tls, the rest as
  // protocol_error.
  assert.equal(
    classifyTransportError(
      fetchFailed({
        code: "EPROTO",
        message: "error:0A00010B:SSL routines:ssl3_get_record:wrong version number",
      }),
    ),
    "tls",
  );
  assert.equal(classifyTransportError(fetchFailed({ code: "EPROTO" })), "protocol_error");
  // Timeout family outranks a co-present reset, matching the Python order.
  const nested = new TypeError("fetch failed", {
    cause: Object.assign(new Error("reset"), {
      code: "ECONNRESET",
      cause: Object.assign(new Error("ct"), { code: "UND_ERR_CONNECT_TIMEOUT" }),
    }),
  });
  assert.equal(classifyTransportError(nested), "connect_timeout");
  // Unknown, cyclic, and bare errors never throw.
  assert.equal(classifyTransportError(new TypeError("fetch failed")), "unknown");
  assert.equal(classifyTransportError(new Error("mystery")), "unknown");
  const cyclic = new Error("a");
  cyclic.cause = cyclic;
  assert.equal(classifyTransportError(cyclic), "unknown");
  assert.equal(classifyTransportError(undefined), "unknown");
});

test("an out-of-grammar value drops the whole header and the request still succeeds", async () => {
  // A NaN clock poisons pm/sm on the retry attempt; the guard must send
  // NOTHING (not a malformed header) and must never throw into the request.
  const captured = [];
  let call = 0;
  const sdk = clientWithFetch(
    async (url, init) => {
      captured.push(init.headers.get("x-tr-client"));
      call += 1;
      if (call === 1) return new Response("{}", { status: 503 });
      return okJson();
    },
    { telemetry: true },
  );
  sdk._telemetryNow = () => NaN;
  assert.deepEqual(await sdk.request("GET", "/models"), { ok: true });
  assert.equal(captured[0], "v=1;a=0;s=0");
  assert.equal(captured[1], null);
});

test("headerValue never throws on corrupted recorder state", () => {
  const recorder = new RequestRecorder({ streaming: true, now: () => 0 });
  recorder.beginAttempt("https://api.trustedrouter.com/v1");
  recorder.onResponse(503);
  recorder.onMoved();
  recorder.beginAttempt("https://api.allyrouter.com/v1");
  // Simulate vocabulary drift: an outcome that escapes the value grammar.
  recorder.attempts[0].outcome = "HTTP-503!";
  assert.equal(recorder.headerValue(), null);
});
