import { parseArgs } from "node:util";

import {
  AUTO_MODEL,
  AuthenticationError,
  PermissionDeniedError,
  TrustedRouter,
  TrustedRouterError,
  VERSION,
} from "../index.js";
import {
  policyFromTrustRelease,
  verifyGatewayAttestation,
} from "../attestation.js";
import {
  fetchAttestationAgain,
  verifyGatewaySession,
} from "../session.js";

import type { ChatCompletion, ChatRequest, TrustedRouterOptions } from "../index.js";

interface CliInput extends AsyncIterable<string | Uint8Array> {
  isTTY?: boolean;
}

interface CliOutput {
  write(chunk: string): unknown;
}

type CliClient = Pick<TrustedRouter,
  "apiKey" | "baseUrl" | "fetch" | "chatCompletions" | "chatCompletionsText" |
  "models" | "providers" | "regions" | "trustRelease" | "attestation"
> & { close?: () => void | Promise<void> };

interface CliDependencies {
  clientFactory: (options: TrustedRouterOptions) => CliClient;
  fetchAttestationAgain: typeof fetchAttestationAgain;
  policyFromTrustRelease: typeof policyFromTrustRelease;
  verifyGatewayAttestation: typeof verifyGatewayAttestation;
  verifyGatewaySession: typeof verifyGatewaySession;
}

interface CliOptions {
  stdin?: CliInput;
  stdout?: CliOutput;
  stderr?: CliOutput;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal | null;
  dependencies?: Partial<CliDependencies>;
}

interface CommandContext {
  dependencies: CliDependencies;
  env: NodeJS.ProcessEnv;
  stdin: CliInput;
  stdout: CliOutput;
  signal: AbortSignal | null;
}

type ParsedCliArgs = ReturnType<typeof parseCliArgs>;
type CliValues = ParsedCliArgs["values"];
type CliError = Error & {
  statusCode?: unknown;
  status_code?: unknown;
  requestId?: unknown;
  request_id?: unknown;
};

export const EXIT_SUCCESS = 0;
export const EXIT_ERROR = 1;
export const EXIT_USAGE = 2;
export const EXIT_AUTH = 3;

const MAX_STDIN_BYTES = 8 * 1024 * 1024;
const GLOBAL_OPTIONS = new Set(["help", "json", "retries", "version"]);
const COMMAND_OPTIONS: Readonly<Record<string, ReadonlySet<string> | undefined>> = Object.freeze({
  chat: new Set(["max-tokens", "model", "stream"]),
  models: new Set<string>(),
  providers: new Set<string>(),
  regions: new Set<string>(),
  trust: new Set<string>(),
  attest: new Set(["connect-ip", "session", "verify"]),
});

const HELP = `TrustedRouter CLI v${VERSION}

Usage:
  trustedrouter [--json] [--retries N] <command> [options]

Commands:
  chat [PROMPT|-]       Run a chat completion. Reads stdin when omitted or '-'.
  models               List the model catalog.
  providers            List providers.
  regions              List deployed regions.
  trust                Show the published trust release.
  attest               Fetch or verify the gateway attestation.

Global options:
  --json               Emit compact, machine-readable JSON.
  --retries N          Retry count for 429/5xx responses (default: 2).
  -h, --help           Show help.
  -V, --version        Show the CLI version.

Authentication:
  Set TRUSTEDROUTER_API_KEY (or the legacy TR_API_KEY). Keys are never read
  from command-line arguments, where they could leak through shell history.

Exit codes:
  0 success; 1 API, transport, or verification failure; 2 usage or input
  error; 3 authentication or permission failure.
`;

const COMMAND_HELP: Readonly<Record<string, string | undefined>> = Object.freeze({
  chat: `Usage: trustedrouter chat [PROMPT|-] [options]

Runs one chat completion. With no PROMPT, piped stdin is read. Use '-' to read
stdin explicitly. A positional prompt and '-' cannot be combined. Stdin must
be valid UTF-8 and is capped at 8 MiB.

Options:
  -m, --model MODEL     Model id (default: ${AUTO_MODEL}).
  --max-tokens N        Maximum completion tokens (default: 200).
  --stream              Stream text. With --json, emits JSONL delta records.
  --json                Emit a completion envelope, or JSONL when streaming.
`,
  models: "Usage: trustedrouter models [--json]\n\nList the model catalog.\n",
  providers: "Usage: trustedrouter providers [--json]\n\nList providers.\n",
  regions: "Usage: trustedrouter regions [--json]\n\nList deployed regions.\n",
  trust: "Usage: trustedrouter trust [--json]\n\nShow the published trust release.\n",
  attest: `Usage: trustedrouter attest [options]

Without options, writes the raw UTF-8 attestation JWT. --verify verifies its
signature and workload identity against the published trust release. --session
performs the stronger TLS-exporter-bound G6 verification and a same-socket
follow-up challenge.

Options:
  --verify              Verify against the published trust release.
  --session             Verify the TLS-exporter-bound session and follow-up.
  --connect-ip IP       With --session, dial this IP but retain SNI/Host.
  --json                Emit a machine-readable success envelope.
`,
});

class CliUsageError extends Error {
  declare type: string;

  constructor(message: string, type = "usage_error") {
    super(message);
    this.name = "CliUsageError";
    this.type = type;
  }
}

class CliAuthenticationError extends Error {
  declare type: string;

  constructor(message: string) {
    super(message);
    this.name = "CliAuthenticationError";
    this.type = "authentication_error";
  }
}

function parseCliArgs(argv: string[]) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        json: { type: "boolean" },
        retries: { type: "string" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "V" },
        model: { type: "string", short: "m" },
        "max-tokens": { type: "string" },
        stream: { type: "boolean" },
        verify: { type: "boolean" },
        session: { type: "boolean" },
        "connect-ip": { type: "string" },
      },
    });
  } catch (error) {
    // node:util parseArgs throws Error instances; retain the original message access.
    throw new CliUsageError((error as Error).message);
  }

  const { values, positionals } = parsed;
  const retries = integerOption(values.retries ?? "2", "--retries", { min: 0 });
  const command = positionals[0] ?? null;
  const operands = positionals.slice(1);
  return { command, operands, retries, values };
}

function integerOption(value: string, label: string, { min = Number.MIN_SAFE_INTEGER }: { min?: number } = {}) {
  if (!/^-?\d+$/.test(String(value))) {
    throw new CliUsageError(`${label} must be an integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min) {
    throw new CliUsageError(`${label} must be an integer >= ${min}`);
  }
  return parsed;
}

function validateCommandOptions(command: string, values: CliValues) {
  const allowed = Object.hasOwn(COMMAND_OPTIONS, command) ? COMMAND_OPTIONS[command] : undefined;
  if (!allowed) throw new CliUsageError(`unknown command: ${command}`);
  for (const name of Object.keys(values)) {
    if (!GLOBAL_OPTIONS.has(name) && !allowed.has(name)) {
      throw new CliUsageError(`--${name} is not valid for ${command}`);
    }
  }
  if (command === "attest" && values["connect-ip"] !== undefined) {
    const connectIp = String(values["connect-ip"]).trim();
    if (!connectIp) throw new CliUsageError("--connect-ip cannot be empty");
    if (!values.session) throw new CliUsageError("--connect-ip requires --session");
    values["connect-ip"] = connectIp;
  }
}

function apiKeyFromEnvironment(env: NodeJS.ProcessEnv) {
  return env.TRUSTEDROUTER_API_KEY || env.TR_API_KEY || null;
}

function clientOptions(parsed: ParsedCliArgs, env: NodeJS.ProcessEnv): TrustedRouterOptions {
  return {
    apiKey: apiKeyFromEnvironment(env),
    maxRetries: parsed.retries,
    baseUrl: env.TRUSTEDROUTER_BASE_URL || env.TR_BASE_URL || null,
    controlBaseUrl: env.TRUSTEDROUTER_CONTROL_BASE_URL || null,
    workspaceId: env.TRUSTEDROUTER_WORKSPACE_ID || null,
  };
}

function write(stream: CliOutput, value: unknown) {
  stream.write(String(value));
}

function writeLine(stream: CliOutput, value: unknown = "") {
  write(stream, `${value}\n`);
}

function stableJsonValue(value: unknown, ancestors = new Set<object>()): unknown {
  if (value === null || typeof value !== "object") return value;
  if (typeof (value as Record<string, unknown>).toJSON === "function") {
    return stableJsonValue((value as { toJSON(): unknown }).toJSON(), ancestors);
  }
  if (ancestors.has(value)) {
    throw new TypeError("cannot serialize a circular value");
  }

  ancestors.add(value);
  let normalized: unknown[] | Record<string, unknown>;
  if (Array.isArray(value)) {
    normalized = value.map((item: unknown) => stableJsonValue(item, ancestors));
  } else {
    normalized = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(value).sort()) {
      normalized[key] = stableJsonValue((value as Record<string, unknown>)[key], ancestors);
    }
  }
  ancestors.delete(value);
  return normalized;
}

function stableJson(value: unknown, space?: number) {
  return JSON.stringify(stableJsonValue(value), null, space);
}

function writeSuccess(stdout: CliOutput, command: string, data: unknown, json: boolean) {
  if (json) {
    writeLine(stdout, stableJson({ ok: true, command, data }));
    return;
  }
  if (typeof data === "string") {
    writeLine(stdout, data);
    return;
  }
  writeLine(stdout, stableJson(data, 2));
}

function snakeCase(value: unknown) {
  return String(value || "runtime_error")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase() || "runtime_error";
}

function errorType(error: CliError) {
  if (error instanceof CliUsageError || error instanceof CliAuthenticationError) {
    return error.type;
  }
  if (error instanceof AuthenticationError || error?.statusCode === 401) {
    return "authentication_error";
  }
  if (error instanceof PermissionDeniedError || error?.statusCode === 403) {
    return "permission_denied_error";
  }
  if (error instanceof TrustedRouterError) return snakeCase(error.name);
  return "runtime_error";
}

function errorPayload(error: CliError) {
  const detail: { type: string; message: string; status_code?: number; request_id?: string } = {
    type: errorType(error),
    message: error.message || String(error),
  };
  const statusCode = error.statusCode ?? error.status_code;
  const requestId = error.requestId ?? error.request_id;
  if (Number.isInteger(statusCode)) detail.status_code = statusCode as number;
  if (typeof requestId === "string" && requestId.length > 0) {
    detail.request_id = requestId;
  }
  return { ok: false, error: detail };
}

function exitCodeFor(error: CliError) {
  if (error instanceof CliUsageError) return EXIT_USAGE;
  if (
    error instanceof CliAuthenticationError ||
    error instanceof AuthenticationError ||
    error instanceof PermissionDeniedError ||
    error?.statusCode === 401 ||
    error?.statusCode === 403
  ) {
    return EXIT_AUTH;
  }
  return EXIT_ERROR;
}

function writeError(stderr: CliOutput, error: CliError, json: boolean) {
  if (json) {
    writeLine(stderr, stableJson(errorPayload(error)));
    return;
  }
  const status = Number.isInteger(error.statusCode) ? `HTTP ${error.statusCode}: ` : "";
  writeLine(stderr, `error: ${status}${error.message || String(error)}`);
}

async function readPrompt(stdin: CliInput, operands: string[]) {
  if (operands.includes("-") && !(operands.length === 1 && operands[0] === "-")) {
    throw new CliUsageError("'-' must be the only prompt argument", "input_error");
  }
  if (operands.length > 0 && operands[0] !== "-") {
    const prompt = operands.join(" ");
    if (!prompt.trim()) throw new CliUsageError("empty prompt", "input_error");
    return prompt;
  }
  if (operands.length === 0 && stdin.isTTY === true) {
    throw new CliUsageError(
      "empty prompt; provide text, use '-', or pipe stdin",
      "input_error",
    );
  }
  let total = 0;
  const chunks = [];
  for await (const chunk of stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > MAX_STDIN_BYTES) {
      throw new CliUsageError(
        `stdin exceeds ${MAX_STDIN_BYTES} bytes`,
        "input_error",
      );
    }
    chunks.push(bytes);
  }
  let prompt;
  try {
    prompt = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
      .decode(Buffer.concat(chunks));
  } catch {
    throw new CliUsageError("stdin prompt must be valid UTF-8", "input_error");
  }
  if (!prompt.trim()) throw new CliUsageError("empty prompt on stdin", "input_error");
  return prompt;
}

function requireApiKey(client: CliClient) {
  if (!client.apiKey) {
    throw new CliAuthenticationError(
      "no API key found; set TRUSTEDROUTER_API_KEY (or TR_API_KEY)",
    );
  }
}

function completionText(response: ChatCompletion) {
  const content = response?.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : "";
}

function bytesToUtf8(value: Uint8Array) {
  return new TextDecoder().decode(value);
}

function attestationData(value: unknown) {
  if (value && typeof value === "object" && "rawClaims" in value) {
    return { ...value };
  }
  return value;
}

async function runChat({ client, operands, stdin, stdout, values, json, signal }: {
  client: CliClient; operands: string[]; stdin: CliInput; stdout: CliOutput;
  values: CliValues; json: boolean; signal: AbortSignal | null;
}) {
  const prompt = await readPrompt(stdin, operands);
  const model = values.model ?? AUTO_MODEL;
  if (!String(model).trim()) throw new CliUsageError("--model cannot be empty");
  const maxTokens = integerOption(values["max-tokens"] ?? "200", "--max-tokens", {
    min: 1,
  });
  requireApiKey(client);
  const request: ChatRequest = {
    model,
    messages: [{ role: "user", content: prompt }],
    max_tokens: maxTokens,
    ...(signal ? { signal } : {}),
  };
  if (values.stream) {
    for await (const text of client.chatCompletionsText(request)) {
      if (json) writeSuccess(stdout, "chat.delta", { text }, true);
      else write(stdout, text);
    }
    if (json) writeSuccess(stdout, "chat.done", null, true);
    else writeLine(stdout);
    return;
  }
  const response = await client.chatCompletions(request);
  if (json) writeSuccess(stdout, "chat", response, true);
  else writeSuccess(stdout, "chat", completionText(response), false);
}

async function runAttest({ client, stdout, values, json, dependencies }: {
  client: CliClient; stdout: CliOutput; values: CliValues;
  json: boolean; dependencies: CliDependencies;
}) {
  if (values.session) {
    const release = await client.trustRelease();
    const policy = await dependencies.policyFromTrustRelease({ release });
    let session = null;
    try {
      session = await dependencies.verifyGatewaySession({
        baseUrl: client.baseUrl,
        policy,
        connectIp: values["connect-ip"] ?? null,
      });
      const followup = await dependencies.fetchAttestationAgain(session);
      writeSuccess(stdout, "attest.session", {
        attestation: attestationData(session.attestation),
        followup: attestationData(followup),
        exporter: Buffer.from(session.exporter).toString("hex"),
      }, json);
    } finally {
      session?.socket?.destroy();
    }
    return;
  }

  const document = await client.attestation();
  if (!values.verify) {
    const decoded = bytesToUtf8(document);
    if (json) writeSuccess(stdout, "attest", { document: decoded }, true);
    else write(stdout, decoded);
    return;
  }
  const release = await client.trustRelease();
  const policy = await dependencies.policyFromTrustRelease({ release });
  const verified = await dependencies.verifyGatewayAttestation(document, {
    policy,
    fetchImpl: client.fetch,
  });
  writeSuccess(stdout, "attest.verify", attestationData(verified), json);
}

async function runCommand(parsed: ParsedCliArgs, context: CommandContext) {
  const { command, operands, values } = parsed;
  const { dependencies, env, stdin, stdout, signal } = context;
  const json = values.json === true;
  const client = dependencies.clientFactory(clientOptions(parsed, env));
  try {
    switch (command) {
      case "chat":
        await runChat({ client, operands, stdin, stdout, values, json, signal });
        break;
      case "models":
        writeSuccess(stdout, "models", await client.models(), json);
        break;
      case "providers":
        writeSuccess(stdout, "providers", await client.providers(), json);
        break;
      case "regions":
        writeSuccess(stdout, "regions", await client.regions(), json);
        break;
      case "trust":
        writeSuccess(stdout, "trust", await client.trustRelease(), json);
        break;
      case "attest":
        await runAttest({ client, stdout, values, json, dependencies });
        break;
      default:
        throw new CliUsageError(`unknown command: ${command}`);
    }
  } finally {
    try {
      await client.close?.();
    } catch {
      // Telemetry teardown must not replace the command's result.
    }
  }
}

function defaultDependencies(): CliDependencies {
  return {
    clientFactory: (options) => new TrustedRouter(options),
    fetchAttestationAgain,
    policyFromTrustRelease,
    verifyGatewayAttestation,
    verifyGatewaySession,
  };
}

export async function runCli(argv: string[] = [], {
  stdin = process.stdin,
  stdout = process.stdout,
  stderr = process.stderr,
  env = process.env,
  signal = null,
  dependencies: dependencyOverrides = {},
}: CliOptions = {}) {
  const optionTerminator = argv.indexOf("--");
  const optionTokens = optionTerminator === -1 ? argv : argv.slice(0, optionTerminator);
  const jsonRequested = optionTokens.includes("--json");
  try {
    const parsed = parseCliArgs(argv);
    const { command, operands, values } = parsed;

    if (values.version) {
      if (values.json) writeSuccess(stdout, "version", { version: VERSION }, true);
      else writeLine(stdout, `trustedrouter ${VERSION}`);
      return EXIT_SUCCESS;
    }
    if (values.help) {
      if (command === null) write(stdout, HELP);
      else {
        if (!Object.hasOwn(COMMAND_HELP, command)) throw new CliUsageError(`unknown command: ${command}`);
        write(stdout, COMMAND_HELP[command]);
      }
      return EXIT_SUCCESS;
    }
    if (command === null) throw new CliUsageError("a command is required");
    validateCommandOptions(command, values);
    if (command !== "chat" && operands.length > 0) {
      throw new CliUsageError(`${command} does not accept positional arguments`);
    }
    await runCommand(parsed, {
      dependencies: { ...defaultDependencies(), ...dependencyOverrides },
      env,
      stdin,
      stdout,
      signal,
    });
    return EXIT_SUCCESS;
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    writeError(stderr, normalized, jsonRequested);
    return exitCodeFor(normalized);
  }
}
