import assert from "node:assert/strict";
import test from "node:test";

import {
  EXIT_AUTH,
  EXIT_ERROR,
  EXIT_SUCCESS,
  EXIT_USAGE,
  runCli,
} from "../dist/cli/main.js";
import {
  AuthenticationError,
  InternalError,
  PermissionDeniedError,
} from "../dist/index.js";

const API_KEY_ENV = { TRUSTEDROUTER_API_KEY: "sk-tr-test" };

function inputStream(input = "", { isTTY = true } = {}) {
  const stream = {
    async *[Symbol.asyncIterator]() {
      if (input.length > 0) yield Buffer.from(input);
    },
  };
  if (isTTY !== null) stream.isTTY = isTTY;
  return stream;
}

function outputStream() {
  const chunks = [];
  return {
    write(chunk) {
      chunks.push(String(chunk));
      return true;
    },
    text() {
      return chunks.join("");
    },
  };
}

function fakeClient(overrides = {}) {
  return {
    apiKey: null,
    baseUrl: "https://api.trustedrouter.com/v1",
    fetch: async () => {
      throw new Error("unexpected fetch");
    },
    async close() {},
    async chatCompletions() {
      return {
        id: "gen_test",
        object: "chat.completion",
        choices: [{ index: 0, message: { role: "assistant", content: "hello" } }],
      };
    },
    async *chatCompletionsText() {
      yield "hel";
      yield "lo";
    },
    async models() {
      return { data: [{ id: "trustedrouter/auto" }] };
    },
    async providers() {
      return { data: [{ slug: "openai" }] };
    },
    async regions() {
      return { data: [{ id: "us-central1" }] };
    },
    async trustRelease() {
      return { image_digest: "sha256:test" };
    },
    async attestation() {
      return new TextEncoder().encode("header.payload.signature");
    },
    ...overrides,
  };
}

async function invoke(args, {
  client = fakeClient(),
  env = {},
  input = "",
  isTTY = true,
  dependencies = {},
} = {}) {
  const stdout = outputStream();
  const stderr = outputStream();
  const clientOptions = [];
  const code = await runCli(args, {
    env,
    stdin: inputStream(input, { isTTY }),
    stdout,
    stderr,
    dependencies: {
      clientFactory(options) {
        clientOptions.push(options);
        client.apiKey = options.apiKey;
        return client;
      },
      ...dependencies,
    },
  });
  return {
    code,
    stdout: stdout.text(),
    stderr: stderr.text(),
    clientOptions,
  };
}

test("help, version, and no-command behavior follow the shared contract", async () => {
  let constructed = 0;
  const dependencies = { clientFactory: () => { constructed += 1; } };
  for (const args of [["--help"], ["--json", "--help"], ["chat", "--help"]]) {
    const help = await invoke(args, { dependencies });
    assert.equal(help.code, EXIT_SUCCESS);
    assert.match(help.stdout, /Usage: trustedrouter|Usage:\n  trustedrouter/);
    assert.equal(help.stderr, "");
  }

  const missing = await invoke([], { dependencies });
  assert.equal(missing.code, EXIT_USAGE);
  assert.equal(missing.stdout, "");
  assert.match(missing.stderr, /a command is required/);

  const missingJson = await invoke(["--json"], { dependencies });
  assert.equal(missingJson.code, EXIT_USAGE);
  assert.deepEqual(JSON.parse(missingJson.stderr), {
    ok: false,
    error: { type: "usage_error", message: "a command is required" },
  });

  const removedHelpCommand = await invoke(["help"], { dependencies });
  assert.equal(removedHelpCommand.code, EXIT_USAGE);

  const version = await invoke(["--json", "--version"], { dependencies });
  assert.equal(version.code, EXIT_SUCCESS);
  assert.deepEqual(JSON.parse(version.stdout), {
    ok: true,
    command: "version",
    data: { version: "0.8.0" },
  });
  const plainVersion = await invoke(["--version"], { dependencies });
  assert.equal(plainVersion.stdout, "trustedrouter 0.8.0\n");
  assert.equal(constructed, 0);
});

test("chat sends the expected SDK request and prints only completion text", async () => {
  let request = null;
  let closed = 0;
  const client = fakeClient({
    async chatCompletions(value) {
      request = value;
      return {
        id: "gen_1",
        object: "chat.completion",
        choices: [{ index: 0, message: { role: "assistant", content: "answer" } }],
      };
    },
    async close() {
      closed += 1;
    },
  });
  const result = await invoke([
    "--retries", "4", "chat", "why", "now?", "--model", "trustedrouter/zdr",
    "--max-tokens", "321",
  ], { client, env: API_KEY_ENV });

  assert.equal(result.code, EXIT_SUCCESS);
  assert.equal(result.stdout, "answer\n");
  assert.equal(result.stderr, "");
  assert.deepEqual(request, {
    model: "trustedrouter/zdr",
    messages: [{ role: "user", content: "why now?" }],
    max_tokens: 321,
  });
  assert.equal(result.clientOptions[0].maxRetries, 4);
  assert.equal(result.clientOptions[0].apiKey, "sk-tr-test");
  assert.equal(closed, 1);
});

test("chat reads explicit and implicit stdin", async () => {
  const prompts = [];
  const client = fakeClient({
    async chatCompletions(request) {
      prompts.push(request.messages[0].content);
      return {
        choices: [{ index: 0, message: { role: "assistant", content: "ok" } }],
      };
    },
  });
  const explicit = await invoke(["chat", "-"], {
    client,
    env: API_KEY_ENV,
    input: "\ufeff  from stdin\n",
    isTTY: false,
  });
  const implicit = await invoke(["chat"], {
    client,
    env: API_KEY_ENV,
    input: "piped prompt\n",
    // Node leaves `isTTY` undefined for a pipe rather than setting it false.
    isTTY: null,
  });
  assert.equal(explicit.code, EXIT_SUCCESS);
  assert.equal(implicit.code, EXIT_SUCCESS);
  assert.deepEqual(prompts, ["\ufeff  from stdin\n", "piped prompt\n"]);
});

test("chat bounds stdin by bytes and rejects malformed UTF-8 before the request", async () => {
  const limit = 8 * 1024 * 1024;
  const promptLengths = [];
  const client = fakeClient({
    async chatCompletions(request) {
      promptLengths.push(request.messages[0].content.length);
      return { choices: [{ message: { content: "ok" } }] };
    },
  });

  const boundary = await invoke(["chat", "-"], {
    client,
    env: API_KEY_ENV,
    input: "x".repeat(limit),
    isTTY: false,
  });
  assert.equal(boundary.code, EXIT_SUCCESS);

  const oversized = await invoke(["chat", "-", "--json"], {
    client,
    env: API_KEY_ENV,
    input: "x".repeat(limit + 1),
    isTTY: false,
  });
  assert.equal(oversized.code, EXIT_USAGE);
  assert.equal(JSON.parse(oversized.stderr).error.type, "input_error");
  assert.match(JSON.parse(oversized.stderr).error.message, /exceeds 8388608 bytes/);

  const malformed = await invoke(["chat", "-", "--json"], {
    client,
    env: API_KEY_ENV,
    input: Buffer.from([0xff]),
    isTTY: false,
  });
  assert.equal(malformed.code, EXIT_USAGE);
  assert.deepEqual(JSON.parse(malformed.stderr), {
    ok: false,
    error: { type: "input_error", message: "stdin prompt must be valid UTF-8" },
  });
  assert.deepEqual(promptLengths, [limit]);
});

test("chat rejects empty or ambiguous stdin with an input exit", async () => {
  const tty = await invoke(["--json", "chat"], { env: API_KEY_ENV });
  assert.equal(tty.code, EXIT_USAGE);
  assert.deepEqual(JSON.parse(tty.stderr), {
    ok: false,
    error: {
      type: "input_error",
      message: "empty prompt; provide text, use '-', or pipe stdin",
    },
  });

  const mixed = await invoke(["chat", "hello", "-"], { env: API_KEY_ENV });
  assert.equal(mixed.code, EXIT_USAGE);
  assert.match(mixed.stderr, /must be the only prompt argument/);
});

test("chat requires the documented environment key and returns exit 3", async () => {
  const result = await invoke(["--json", "chat", "hello"]);
  assert.equal(result.code, EXIT_AUTH);
  assert.deepEqual(JSON.parse(result.stderr), {
    ok: false,
    error: {
      type: "authentication_error",
      message: "no API key found; set TRUSTEDROUTER_API_KEY (or TR_API_KEY)",
    },
  });
  assert.equal(result.stdout, "");
});

test("chat validates prompt, model, and max tokens before authentication", async () => {
  const cases = [
    { args: ["--json", "chat"], expected: "input_error" },
    { args: ["--json", "chat", "hello", "--model", ""], expected: "usage_error" },
    { args: ["--json", "chat", "hello", "--max-tokens", "0"], expected: "usage_error" },
  ];
  for (const { args, expected } of cases) {
    const result = await invoke(args);
    assert.equal(result.code, EXIT_USAGE);
    assert.equal(JSON.parse(result.stderr).error.type, expected);
  }
});

test("a literal --json prompt after -- does not switch error output modes", async () => {
  const plain = await invoke(["chat", "--", "--json"]);
  assert.equal(plain.code, EXIT_AUTH);
  assert.match(plain.stderr, /^error:/);

  const json = await invoke(["--json", "chat", "--", "--json"]);
  assert.equal(json.code, EXIT_AUTH);
  assert.equal(JSON.parse(json.stderr).error.type, "authentication_error");
});

test("client configuration honors primary and legacy environment overrides", async () => {
  const primary = await invoke(["--retries", "4", "chat", "hello"], {
    env: {
      TRUSTEDROUTER_API_KEY: "primary-key",
      TR_API_KEY: "legacy-key",
      TRUSTEDROUTER_BASE_URL: "https://inference.example/v1",
      TR_BASE_URL: "https://legacy.example/v1",
      TRUSTEDROUTER_CONTROL_BASE_URL: "https://control.example/v1",
      TRUSTEDROUTER_WORKSPACE_ID: "ws_agent",
    },
  });
  assert.deepEqual(primary.clientOptions, [{
    apiKey: "primary-key",
    maxRetries: 4,
    baseUrl: "https://inference.example/v1",
    controlBaseUrl: "https://control.example/v1",
    workspaceId: "ws_agent",
  }]);

  const legacy = await invoke(["chat", "hello"], {
    env: {
      TR_API_KEY: "legacy-key",
      TR_BASE_URL: "https://legacy.example/v1",
    },
  });
  assert.equal(legacy.clientOptions[0].apiKey, "legacy-key");
  assert.equal(legacy.clientOptions[0].baseUrl, "https://legacy.example/v1");
});

test("streaming JSON is deterministic JSONL with a terminal record", async () => {
  const client = fakeClient({
    async *chatCompletionsText() {
      yield "one";
      yield "two";
    },
  });
  const result = await invoke(["chat", "hello", "--stream", "--json"], {
    client,
    env: API_KEY_ENV,
  });
  assert.equal(result.code, EXIT_SUCCESS);
  assert.equal(result.stdout, [
    '{"command":"chat.delta","data":{"text":"one"},"ok":true}',
    '{"command":"chat.delta","data":{"text":"two"},"ok":true}',
    '{"command":"chat.done","data":null,"ok":true}',
    "",
  ].join("\n"));
  assert.deepEqual(result.stdout.trimEnd().split("\n").map(JSON.parse), [
    { ok: true, command: "chat.delta", data: { text: "one" } },
    { ok: true, command: "chat.delta", data: { text: "two" } },
    { ok: true, command: "chat.done", data: null },
  ]);
});

test("catalog and trust commands use their SDK methods and stable envelopes", async () => {
  const cases = [
    ["models", { data: [{ id: "trustedrouter/auto" }] }],
    ["providers", { data: [{ slug: "openai" }] }],
    ["regions", { data: [{ id: "us-central1" }] }],
    ["trust", { image_digest: "sha256:test" }],
  ];
  for (const [command, data] of cases) {
    const result = await invoke([command, "--json"]);
    assert.equal(result.code, EXIT_SUCCESS, command);
    assert.match(result.stdout, /^\{"command":/);
    assert.deepEqual(JSON.parse(result.stdout), { ok: true, command, data });
    assert.equal(result.stderr, "");
  }
});

test("stable JSON recursively sorts and preserves special object keys", async () => {
  const data = JSON.parse('{"z":1,"__proto__":"kept","a":{"z":2,"a":1}}');
  const result = await invoke(["models", "--json"], {
    client: fakeClient({ async models() { return data; } }),
  });
  assert.equal(
    result.stdout,
    '{"command":"models","data":{"__proto__":"kept","a":{"a":1,"z":2},' +
      '"z":1},"ok":true}\n',
  );
});

test("raw attestation supports byte-exact plain output and a JSON envelope", async () => {
  const plain = await invoke(["attest"]);
  assert.equal(plain.code, EXIT_SUCCESS);
  assert.equal(plain.stdout, "header.payload.signature");

  const json = await invoke(["attest", "--json"]);
  assert.deepEqual(JSON.parse(json.stdout), {
    ok: true,
    command: "attest",
    data: { document: "header.payload.signature" },
  });
});

test("attest --verify delegates policy and signature checks", async () => {
  const calls = [];
  const verified = {
    imageDigest: "sha256:verified",
    certSha256: "abc",
    rawClaims: { dbgstat: "disabled-since-boot" },
  };
  const result = await invoke(["attest", "--verify", "--json"], {
    dependencies: {
      async policyFromTrustRelease({ release }) {
        calls.push(["policy", release]);
        return { audience: "quill-cloud", imageDigest: "sha256:test" };
      },
      async verifyGatewayAttestation(document, options) {
        calls.push(["verify", new TextDecoder().decode(document), options.policy]);
        return verified;
      },
    },
  });
  assert.equal(result.code, EXIT_SUCCESS);
  assert.deepEqual(JSON.parse(result.stdout), {
    ok: true,
    command: "attest.verify",
    data: verified,
  });
  assert.deepEqual(calls[0], ["policy", { image_digest: "sha256:test" }]);
  assert.deepEqual(calls[1], [
    "verify",
    "header.payload.signature",
    { audience: "quill-cloud", imageDigest: "sha256:test" },
  ]);
});

test("attest --session delegates G6 verification, follows up, and closes the socket", async () => {
  let destroyed = 0;
  let sessionOptions = null;
  const attestation = { imageDigest: "sha256:first", rawClaims: {} };
  const followup = { imageDigest: "sha256:again", rawClaims: {} };
  const session = {
    attestation,
    exporter: Uint8Array.from([0x01, 0xab]),
    socket: { destroy() { destroyed += 1; } },
  };
  const result = await invoke([
    "--json", "attest", "--session", "--connect-ip", "203.0.113.5",
  ], {
    dependencies: {
      async policyFromTrustRelease() {
        return { audience: "quill-cloud", imageDigest: "sha256:test" };
      },
      async verifyGatewaySession(options) {
        sessionOptions = options;
        return session;
      },
      async fetchAttestationAgain(received) {
        assert.equal(received, session);
        return followup;
      },
    },
  });
  assert.equal(result.code, EXIT_SUCCESS);
  assert.equal(sessionOptions.baseUrl, "https://api.trustedrouter.com/v1");
  assert.equal(sessionOptions.connectIp, "203.0.113.5");
  assert.equal(destroyed, 1);
  assert.deepEqual(JSON.parse(result.stdout), {
    ok: true,
    command: "attest.session",
    data: { attestation, followup, exporter: "01ab" },
  });
});

test("invalid options return exit 2 without constructing a client", async () => {
  let constructed = 0;
  const result = await invoke(["models", "--stream", "--json"], {
    dependencies: { clientFactory() { constructed += 1; } },
  });
  assert.equal(result.code, EXIT_USAGE);
  assert.deepEqual(JSON.parse(result.stderr), {
    ok: false,
    error: {
      type: "usage_error",
      message: "--stream is not valid for models",
    },
  });
  assert.equal(constructed, 0);

  for (const args of [
    ["attest", "--connect-ip", "203.0.113.5", "--json"],
    ["attest", "--session", "--connect-ip", "", "--json"],
    ["attest", "--session", "--connect-ip", "   ", "--json"],
  ]) {
    const invalidConnectIp = await invoke(args, {
      dependencies: { clientFactory() { constructed += 1; } },
    });
    assert.equal(invalidConnectIp.code, EXIT_USAGE);
    assert.equal(JSON.parse(invalidConnectIp.stderr).error.type, "usage_error");
  }
  assert.equal(constructed, 0);
});

test("API errors expose a stable JSON shape and exit family", async () => {
  const serverError = new InternalError(503, "gateway unavailable", {
    error: { request_id: "req_123" },
  });
  const result = await invoke(["models", "--json"], {
    client: fakeClient({ async models() { throw serverError; } }),
  });
  assert.equal(result.code, EXIT_ERROR);
  assert.equal(
    result.stderr,
    '{"error":{"message":"gateway unavailable","request_id":"req_123",' +
      '"status_code":503,"type":"internal_error"},"ok":false}\n',
  );
  assert.deepEqual(JSON.parse(result.stderr), {
    ok: false,
    error: {
      type: "internal_error",
      message: "gateway unavailable",
      status_code: 503,
      request_id: "req_123",
    },
  });

  const authError = new AuthenticationError(401, "invalid key", {});
  const auth = await invoke(["models", "--json"], {
    client: fakeClient({ async models() { throw authError; } }),
  });
  assert.equal(auth.code, EXIT_AUTH);

  const permissionError = new PermissionDeniedError(403, "permission denied", {});
  const permission = await invoke(["models", "--json"], {
    client: fakeClient({ async models() { throw permissionError; } }),
  });
  assert.equal(permission.code, EXIT_AUTH);
  assert.equal(JSON.parse(permission.stderr).error.type, "permission_denied_error");

  const runtime = await invoke(["models", "--json"], {
    client: fakeClient({ async models() { throw new TypeError("unexpected bug"); } }),
  });
  assert.equal(runtime.code, EXIT_ERROR);
  assert.deepEqual(JSON.parse(runtime.stderr), {
    ok: false,
    error: { type: "runtime_error", message: "unexpected bug" },
  });
});
