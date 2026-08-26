/**
 * Offline verification for signed inference receipts (wire format v1).
 *
 * The implementation deliberately works on bytes throughout the signature and
 * hash checks. JSON is parsed only after a small grammar scanner has rejected
 * duplicate object members, which JSON.parse alone cannot report.
 */

import { receiptVerificationDependencies } from "./internal/receipt-dependencies.js";

const RECEIPT_TYPE = "inference-receipt+jws";
const KEY_COMMITMENT_DOMAIN = new TextEncoder().encode(
  "inference-receipt-key-v1\u0000",
);
const B64URL_RE = /^[A-Za-z0-9_-]*$/;
const NONCE_RE = /^[A-Za-z0-9_-]{1,88}$/;
const encoder = new TextEncoder();
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export class ReceiptVerificationError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class ReceiptStructureError extends ReceiptVerificationError {}
export class ReceiptHeaderError extends ReceiptVerificationError {}
export class ReceiptSignatureError extends ReceiptVerificationError {}
export class ReceiptClaimsError extends ReceiptVerificationError {}
export class ReceiptTimeError extends ReceiptClaimsError {}
export class ReceiptNonceError extends ReceiptClaimsError {}
export class ReceiptUpstreamError extends ReceiptClaimsError {}
export class ReceiptHashError extends ReceiptVerificationError {}
export class ReceiptAttestationError extends ReceiptVerificationError {}
export class MissingAttestationError extends ReceiptAttestationError {}
export class UnsupportedAttestationError extends ReceiptAttestationError {}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function repr(value) {
  if (value === undefined) return "undefined";
  return JSON.stringify(value);
}

function asciiFromBytes(bytes, check) {
  for (const byte of bytes) {
    if (byte > 0x7f) {
      throw new ReceiptStructureError(`${check} check failed: receipt bytes must be ASCII`);
    }
  }
  let result = "";
  const size = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += size) {
    result += String.fromCharCode(...bytes.subarray(offset, offset + size));
  }
  return result;
}

function bytesFrom(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}

/** Validate JSON grammar and reject duplicate members at every object depth. */
function scanJson(text) {
  let offset = 0;

  function fail(message = `unexpected token at position ${offset}`) {
    throw new SyntaxError(message);
  }

  function whitespace() {
    while (/\s/.test(text[offset] ?? "") && /[\u0009\u000a\u000d\u0020]/.test(text[offset])) {
      offset += 1;
    }
  }

  function stringToken() {
    if (text[offset] !== '"') fail();
    const start = offset++;
    while (offset < text.length) {
      const code = text.charCodeAt(offset);
      if (code === 0x22) {
        offset += 1;
        return text.slice(start, offset);
      }
      if (code === 0x5c) {
        offset += 1;
        if (offset >= text.length) fail("unterminated string");
        const escaped = text[offset];
        if ('"\\/bfnrt'.includes(escaped)) {
          offset += 1;
          continue;
        }
        if (escaped === "u" && /^[0-9a-fA-F]{4}$/.test(text.slice(offset + 1, offset + 5))) {
          offset += 5;
          continue;
        }
        fail("invalid string escape");
      }
      if (code <= 0x1f) fail("unescaped control character in string");
      offset += 1;
    }
    fail("unterminated string");
  }

  function object() {
    offset += 1;
    whitespace();
    const keys = new Set();
    if (text[offset] === "}") {
      offset += 1;
      return;
    }
    while (offset < text.length) {
      const token = stringToken();
      const key = JSON.parse(token);
      if (keys.has(key)) throw new SyntaxError(`duplicate JSON member ${repr(key)}`);
      keys.add(key);
      whitespace();
      if (text[offset] !== ":") fail();
      offset += 1;
      value();
      whitespace();
      if (text[offset] === "}") {
        offset += 1;
        return;
      }
      if (text[offset] !== ",") fail();
      offset += 1;
      whitespace();
    }
    fail("unterminated object");
  }

  function array() {
    offset += 1;
    whitespace();
    if (text[offset] === "]") {
      offset += 1;
      return;
    }
    while (offset < text.length) {
      value();
      whitespace();
      if (text[offset] === "]") {
        offset += 1;
        return;
      }
      if (text[offset] !== ",") fail();
      offset += 1;
      whitespace();
    }
    fail("unterminated array");
  }

  function value() {
    whitespace();
    const char = text[offset];
    if (char === "{") return object();
    if (char === "[") return array();
    if (char === '"') {
      stringToken();
      return;
    }
    for (const literal of ["true", "false", "null"]) {
      if (text.startsWith(literal, offset)) {
        offset += literal.length;
        return;
      }
    }
    const number = text.slice(offset).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (number) {
      offset += number[0].length;
      return;
    }
    fail();
  }

  value();
  whitespace();
  if (offset !== text.length) fail(`unexpected token at position ${offset}`);
}

function loadJson(data, check) {
  try {
    const text = typeof data === "string" ? data : utf8Decoder.decode(data);
    scanJson(text);
    return JSON.parse(text);
  } catch (error) {
    throw new ReceiptStructureError(
      `${check} check failed: invalid JSON: ${error.message}`,
      { cause: error },
    );
  }
}

function b64urlDecode(value, check, { allowEmpty = false } = {}) {
  if (
    typeof value !== "string" ||
    (!value && !allowEmpty) ||
    !B64URL_RE.test(value) ||
    value.length % 4 === 1
  ) {
    throw new ReceiptStructureError(`${check} check failed: invalid base64url encoding`);
  }
  try {
    const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
    const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch (error) {
    throw new ReceiptStructureError(
      `${check} check failed: invalid base64url encoding`,
      { cause: error },
    );
  }
}

function b64urlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(bytes) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle?.digest) {
    throw new ReceiptSignatureError(
      "WebCrypto check failed: globalThis.crypto.subtle is required (Node.js 20+)",
    );
  }
  return new Uint8Array(await subtle.digest("SHA-256", bytes));
}

function equalBytes(left, right) {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function equalStrings(left, right) {
  return equalBytes(encoder.encode(String(left)), encoder.encode(String(right)));
}

function structuralEqual(left, right) {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, i) => structuralEqual(value, right[i]));
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length &&
      leftKeys.every((key) => hasOwn(right, key) && structuralEqual(left[key], right[key]));
  }
  return false;
}

function parseEnvelope(receipt) {
  let flattenedValue = null;
  if (typeof receipt === "string" || bytesFrom(receipt) !== null) {
    let text;
    if (typeof receipt === "string") {
      text = receipt;
    } else {
      const bytes = bytesFrom(receipt);
      if (!bytes) {
        throw new ReceiptStructureError(
          "JWS structure check failed: receipt must be compact string/bytes or flattened JWS",
        );
      }
      text = asciiFromBytes(bytes, "JWS structure");
    }
    text = text.trim();
    if (text.startsWith("{")) {
      const decoded = loadJson(text, "JWS structure");
      if (!isRecord(decoded)) {
        throw new ReceiptStructureError(
          "JWS structure check failed: flattened JWS must be a JSON object",
        );
      }
      flattenedValue = decoded;
    } else {
      const parts = text.split(".");
      if (parts.length !== 3 || parts.some((part) => !part)) {
        throw new ReceiptStructureError(
          `JWS structure check failed: compact JWS must have 3 non-empty segments, got ${parts.length}`,
        );
      }
      return {
        protected: parts[0], payload: parts[1], signature: parts[2],
        flattened: false, flattenedValue: null,
      };
    }
  } else if (isRecord(receipt)) {
    flattenedValue = receipt;
  } else {
    throw new ReceiptStructureError(
      "JWS structure check failed: receipt must be compact string/bytes or flattened JWS",
    );
  }

  if (hasOwn(flattenedValue, "header")) {
    throw new ReceiptStructureError(
      "JWS structure check failed: unprotected flattened headers are not allowed",
    );
  }
  const values = ["protected", "payload", "signature"].map((name) => flattenedValue[name]);
  if (values.some((value) => typeof value !== "string" || !value)) {
    throw new ReceiptStructureError(
      "JWS structure check failed: flattened JWS requires non-empty string protected, payload, and signature members",
    );
  }
  return {
    protected: values[0], payload: values[1], signature: values[2],
    flattened: true, flattenedValue,
  };
}

async function parseHeader(envelope) {
  const raw = b64urlDecode(envelope.protected, "protected header");
  const header = loadJson(raw, "protected header");
  if (!isRecord(header)) {
    throw new ReceiptHeaderError("protected header check failed: header must be a JSON object");
  }
  if (header.alg !== "EdDSA") {
    throw new ReceiptHeaderError(
      `protected header alg check failed: expected 'EdDSA', got ${repr(header.alg)}`,
    );
  }
  if (header.typ !== RECEIPT_TYPE) {
    throw new ReceiptHeaderError(
      `protected header typ check failed: expected ${repr(RECEIPT_TYPE)}, got ${repr(header.typ)}`,
    );
  }
  const jwk = header.jwk;
  if (!isRecord(jwk)) {
    throw new ReceiptHeaderError("protected header jwk check failed: jwk must be an object");
  }
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || hasOwn(jwk, "d")) {
    throw new ReceiptHeaderError(
      "protected header jwk check failed: expected a public OKP/Ed25519 JWK",
    );
  }
  if (typeof jwk.x !== "string") {
    throw new ReceiptHeaderError("protected header jwk.x check failed: x must be a string");
  }
  let publicKey;
  try {
    publicKey = b64urlDecode(jwk.x, "protected header jwk.x");
  } catch (error) {
    throw new ReceiptHeaderError(error.message, { cause: error });
  }
  if (publicKey.length !== 32) {
    throw new ReceiptHeaderError(
      `protected header jwk.x check failed: Ed25519 public key is ${publicKey.length} bytes, expected 32`,
    );
  }
  const expectedKid = b64urlEncode(await sha256(publicKey));
  if (typeof header.kid !== "string" || !equalStrings(header.kid, expectedKid)) {
    throw new ReceiptHeaderError(
      "protected header kid check failed: kid does not equal b64url(sha256(jwk.x))",
    );
  }
  return { header, publicKey };
}

function ed25519Unavailable(error) {
  const message = String(error?.message ?? error).toLowerCase();
  return error?.name === "NotSupportedError" ||
    message.includes("not supported") ||
    message.includes("unsupported") ||
    message.includes("unrecognized name");
}

async function verifySignature(envelope, publicKey) {
  const payload = b64urlDecode(envelope.payload, "JWS payload");
  let signature;
  try {
    signature = b64urlDecode(envelope.signature, "JWS signature");
  } catch (error) {
    throw new ReceiptSignatureError(error.message, { cause: error });
  }
  const subtle = globalThis.crypto?.subtle;
  if (!subtle?.importKey || !subtle?.verify) {
    throw new ReceiptSignatureError(
      "Ed25519 signature check failed: WebCrypto Ed25519 requires Node.js 20+",
    );
  }
  try {
    const key = await subtle.importKey(
      "raw",
      publicKey,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const signingInput = encoder.encode(`${envelope.protected}.${envelope.payload}`);
    const valid = await subtle.verify("Ed25519", key, signature, signingInput);
    if (!valid) throw new ReceiptSignatureError("Ed25519 signature check failed");
  } catch (error) {
    if (error instanceof ReceiptSignatureError) throw error;
    if (ed25519Unavailable(error)) {
      throw new ReceiptSignatureError(
        "Ed25519 signature check failed: WebCrypto Ed25519 requires Node.js 20+",
        { cause: error },
      );
    }
    throw new ReceiptSignatureError("Ed25519 signature check failed", { cause: error });
  }
  return payload;
}

function requiredMapping(claims, name, ErrorType = ReceiptClaimsError) {
  const value = claims[name];
  if (!isRecord(value)) {
    throw new ErrorType(`${name} claim check failed: required object is missing or invalid`);
  }
  return value;
}

function requiredString(claims, name, family = "claims") {
  const value = claims[name];
  if (typeof value !== "string" || !value) {
    throw new ReceiptClaimsError(
      `${family} ${name} check failed: required string is missing or empty`,
    );
  }
  return value;
}

function optionalString(claims, name, family = "claims") {
  if (!hasOwn(claims, name)) return null;
  const value = claims[name];
  if (typeof value !== "string" || !value) {
    throw new ReceiptClaimsError(
      `${family} ${name} check failed: value must be a non-empty string`,
    );
  }
  return value;
}

function integer(value, check, ErrorType) {
  if (!Number.isSafeInteger(value)) {
    throw new ErrorType(`${check} check failed: expected an integer`);
  }
  return value;
}

function digestClaim(record, name, response) {
  if (record.alg !== "sha256") {
    throw new ReceiptHashError(
      `${name}.alg check failed: expected 'sha256', got ${repr(record.alg)}`,
    );
  }
  if (typeof record.hash !== "string") {
    throw new ReceiptHashError(`${name}.hash check failed: required string is missing`);
  }
  let digest;
  try {
    digest = b64urlDecode(record.hash, `${name}.hash`);
  } catch (error) {
    throw new ReceiptHashError(error.message, { cause: error });
  }
  if (digest.length !== 32) {
    throw new ReceiptHashError(`${name}.hash check failed: SHA-256 digest must be 32 bytes`);
  }
  const allowed = response
    ? new Set(["body", "sse-data-v1", "sse-events-v1"])
    : new Set(["body"]);
  if (!allowed.has(record.of)) {
    throw new ReceiptHashError(
      `${name}.of check failed: unsupported hash domain ${repr(record.of)}`,
    );
  }
  let events = null;
  if (response && record.of !== "body") {
    if (!Number.isSafeInteger(record.events) || record.events < 0) {
      throw new ReceiptHashError(
        `${name}.events check failed: streaming receipts require a non-negative integer`,
      );
    }
    events = record.events;
  } else if (record.events !== undefined && record.events !== null) {
    throw new ReceiptHashError(`${name}.events check failed: body receipts must omit events`);
  }
  return Object.freeze({ alg: record.alg, hash: record.hash, of: record.of, events });
}

function bodyBytes(value, check) {
  const bytes = bytesFrom(value);
  if (!bytes) throw new ReceiptHashError(`${check} check failed: exact body bytes are required`);
  return bytes;
}

function findSequence(data, sequence, start) {
  outer: for (let index = start; index <= data.length - sequence.length; index += 1) {
    for (let inner = 0; inner < sequence.length; inner += 1) {
      if (data[index + inner] !== sequence[inner]) continue outer;
    }
    return index;
  }
  return -1;
}

const LF_EVENT_END = new Uint8Array([0x0a, 0x0a]);
const CRLF_EVENT_END = new Uint8Array([0x0d, 0x0a, 0x0d, 0x0a]);

function nextSseEvent(data, offset) {
  const lf = findSequence(data, LF_EVENT_END, offset);
  const crlf = findSequence(data, CRLF_EVENT_END, offset);
  if (lf < 0 && crlf < 0) return null;
  const end = lf >= 0 && (crlf < 0 || lf < crlf) ? lf + 2 : crlf + 4;
  return [data.subarray(offset, end), end];
}

function startsWith(bytes, prefix) {
  return bytes.length >= prefix.length && prefix.every((byte, i) => bytes[i] === byte);
}

function endsWith(bytes, suffix) {
  const start = bytes.length - suffix.length;
  return start >= 0 && suffix.every((byte, i) => bytes[start + i] === byte);
}

const DATA_PREFIX = encoder.encode("data:");
const EVENT_PREFIX = encoder.encode("event:");
const DONE = encoder.encode("[DONE]");

function decodeSseEvent(raw) {
  let body;
  if (endsWith(raw, CRLF_EVENT_END)) body = raw.subarray(0, raw.length - 4);
  else if (endsWith(raw, LF_EVENT_END)) body = raw.subarray(0, raw.length - 2);
  else throw new ReceiptHashError("response stream framing check failed: incomplete SSE event");

  let name = new Uint8Array();
  let payload = new Uint8Array();
  let sawName = false;
  let sawData = false;
  let lineStart = 0;
  for (let index = 0; index <= body.length; index += 1) {
    if (index < body.length && body[index] !== 0x0a) continue;
    let line = body.subarray(lineStart, index);
    lineStart = index + 1;
    if (line.length > 0 && line[line.length - 1] === 0x0d) {
      line = line.subarray(0, line.length - 1);
    }
    if (startsWith(line, DATA_PREFIX)) {
      if (sawData) {
        throw new ReceiptHashError(
          "response stream framing check failed: SSE event has multiple data fields",
        );
      }
      sawData = true;
      payload = line.subarray(DATA_PREFIX.length);
      if (payload[0] === 0x20) payload = payload.subarray(1);
    } else if (startsWith(line, EVENT_PREFIX)) {
      if (sawName) {
        throw new ReceiptHashError(
          "response stream framing check failed: SSE event has multiple event fields",
        );
      }
      sawName = true;
      name = line.subarray(EVENT_PREFIX.length);
      if (name[0] === 0x20) name = name.subarray(1);
    } else {
      throw new ReceiptHashError(
        "response stream framing check failed: SSE event contains an unsupported field",
      );
    }
  }
  if (!sawData) {
    throw new ReceiptHashError("response stream framing check failed: SSE event has no data field");
  }
  return { name, payload, done: equalBytes(payload, DONE) };
}

function embeddedReceipt(payload) {
  let decoded;
  try {
    decoded = loadJson(payload, "response stream event JSON");
  } catch {
    return null;
  }
  if (!isRecord(decoded) || !hasOwn(decoded, "inference_receipt")) return null;
  const receipt = decoded.inference_receipt;
  if (!isRecord(receipt)) {
    throw new ReceiptHashError(
      "response stream receipt position check failed: inference_receipt must be a flattened JWS object",
    );
  }
  return receipt;
}

function concatBytes(chunks, total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)) {
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

async function streamDigest(stream, domain, expectedReceipt) {
  const preimage = [];
  let total = 0;
  let events = 0;
  let offset = 0;
  let sawDone = false;
  let sawReceipt = false;
  while (offset < stream.length) {
    const found = nextSseEvent(stream, offset);
    if (!found) {
      throw new ReceiptHashError(
        "response stream framing check failed: stream has an incomplete SSE tail",
      );
    }
    const [raw, nextOffset] = found;
    offset = nextOffset;
    const event = decodeSseEvent(raw);
    if (sawDone) {
      throw new ReceiptHashError(
        "response stream receipt position check failed: data event follows [DONE]",
      );
    }
    if (event.done) {
      sawDone = true;
      continue;
    }
    const embedded = embeddedReceipt(event.payload);
    if (embedded !== null) {
      if (sawReceipt) {
        throw new ReceiptHashError(
          "response stream receipt position check failed: multiple receipt events",
        );
      }
      if (expectedReceipt === null || !structuralEqual(embedded, expectedReceipt)) {
        throw new ReceiptHashError(
          "response stream receipt position check failed: embedded receipt does not match the verified flattened JWS",
        );
      }
      sawReceipt = true;
      continue;
    }
    if (sawReceipt) {
      throw new ReceiptHashError(
        "response stream receipt position check failed: receipt is not the last data event before [DONE]",
      );
    }
    if (domain === "sse-data-v1") {
      if (event.name.length > 0) {
        throw new ReceiptHashError(
          "response stream hash check failed: sse-data-v1 events must be unnamed",
        );
      }
    } else if (domain === "sse-events-v1") {
      preimage.push(event.name, new Uint8Array([0x0a]));
      total += event.name.length + 1;
    } else {
      throw new ReceiptHashError(
        `response stream hash check failed: unsupported domain ${repr(domain)}`,
      );
    }
    preimage.push(event.payload, new Uint8Array([0x0a]));
    total += event.payload.length + 1;
    events += 1;
  }
  if (!sawReceipt) {
    throw new ReceiptHashError(
      "response stream receipt position check failed: receipt event is missing",
    );
  }
  if (!sawDone) {
    throw new ReceiptHashError(
      "response stream receipt position check failed: receipt is not followed by [DONE]",
    );
  }
  return { digest: await sha256(concatBytes(preimage, total)), events };
}

async function verifyGcpAttestation(attestation, commitment) {
  const policy = await receiptVerificationDependencies.policyFromTrustRelease();
  await receiptVerificationDependencies.verifyGatewayAttestation(
    encoder.encode(attestation),
    { policy, nonceHex: [...commitment].map((byte) => byte.toString(16).padStart(2, "0")).join("") },
  );
}

async function attestationStatus(envelope, header, publicKey, requireAttestation) {
  if (!envelope.flattened) {
    if (requireAttestation) {
      throw new MissingAttestationError(
        "attestation check failed: compact receipts omit attestation evidence; obtain the pinned document or explicitly pass requireAttestation: false",
      );
    }
    return "unverified_by_this_sdk";
  }
  const kind = header.att_kind;
  const attestation = header.att;
  if (kind === "aws-nitro-cose" || kind === "azure-maa-jwt") {
    throw new UnsupportedAttestationError(
      `attestation kind check failed: ${repr(kind)} is not supported by this SDK`,
    );
  }
  if (kind !== "gcp-cs-jwt") {
    if (kind === undefined || kind === null) {
      throw new MissingAttestationError(
        "attestation check failed: flattened receipt has no att_kind",
      );
    }
    throw new UnsupportedAttestationError(
      `attestation kind check failed: unsupported att_kind ${repr(kind)}`,
    );
  }
  if (typeof attestation !== "string" || !attestation) {
    throw new MissingAttestationError(
      "attestation check failed: flattened receipt has no embedded att",
    );
  }
  const commitment = await sha256(concatBytes([KEY_COMMITMENT_DOMAIN, publicKey]));
  try {
    await verifyGcpAttestation(attestation, commitment);
  } catch (error) {
    if (error instanceof ReceiptVerificationError) throw error;
    throw new ReceiptAttestationError(`GCP attestation check failed: ${error.message}`, {
      cause: error,
    });
  }
  return "verified";
}

/** Verify a compact or flattened inference receipt and return its v1 claims. */
export async function verifyReceipt(receipt, {
  requestBody = null,
  responseBody = null,
  responseStream = null,
  expectedNonce = null,
  maxAgeSeconds = null,
  now = null,
  requireAttestation = true,
} = {}) {
  const envelope = parseEnvelope(receipt);
  const { header, publicKey } = await parseHeader(envelope);
  const payloadBytes = await verifySignature(envelope, publicKey);
  const payload = loadJson(payloadBytes, "receipt claims");
  if (!isRecord(payload)) {
    throw new ReceiptClaimsError("rv claim check failed: receipt claims must be a JSON object");
  }

  if (!Number.isSafeInteger(payload.rv) || payload.rv !== 1) {
    throw new ReceiptClaimsError(
      `rv claim check failed: expected integer 1, got ${repr(payload.rv)}`,
    );
  }

  const iat = integer(payload.iat, "iat claim", ReceiptTimeError);
  let checkedNow;
  if (now === null || now === undefined) checkedNow = Date.now() / 1000;
  else if (typeof now === "number") checkedNow = now;
  else throw new ReceiptTimeError("iat check failed: now must be Unix seconds");
  if (iat > checkedNow + 60) {
    throw new ReceiptTimeError(
      `iat future-skew check failed: iat=${iat} is more than 60 seconds after now=${checkedNow}`,
    );
  }
  if (maxAgeSeconds !== null && maxAgeSeconds !== undefined) {
    if (typeof maxAgeSeconds !== "number" || maxAgeSeconds < 0) {
      throw new ReceiptTimeError(
        "iat max-age check failed: maxAgeSeconds must be non-negative",
      );
    }
    if (checkedNow - iat > maxAgeSeconds) {
      throw new ReceiptTimeError(
        `iat max-age check failed: receipt age ${checkedNow - iat}s exceeds ${maxAgeSeconds}s`,
      );
    }
  }

  const nonce = payload.nonce;
  if (hasOwn(payload, "nonce") && (typeof nonce !== "string" || !NONCE_RE.test(nonce))) {
    throw new ReceiptNonceError(
      "nonce claim check failed: nonce must contain 1-88 base64url characters",
    );
  }
  if (expectedNonce !== null && expectedNonce !== undefined && typeof expectedNonce !== "string") {
    throw new ReceiptNonceError("nonce match check failed: expectedNonce must be a string");
  }
  if (
    expectedNonce !== null && expectedNonce !== undefined &&
    (typeof nonce !== "string" || !equalStrings(nonce, expectedNonce))
  ) {
    throw new ReceiptNonceError(
      `nonce match check failed: expected ${repr(expectedNonce)}, got ${repr(nonce)}`,
    );
  }

  const upstreamRaw = requiredMapping(payload, "upstream", ReceiptUpstreamError);
  const tier = upstreamRaw.tier;
  let verifiedAt;
  let verificationExpiresAt;
  if (tier === "tee-verified") {
    verifiedAt = integer(
      upstreamRaw.verified_at,
      "upstream.verified_at",
      ReceiptUpstreamError,
    );
    verificationExpiresAt = integer(
      upstreamRaw.verification_expires_at,
      "upstream.verification_expires_at",
      ReceiptUpstreamError,
    );
    if (!(verifiedAt <= iat && iat < verificationExpiresAt)) {
      throw new ReceiptUpstreamError(
        "tee-verified window check failed: expected verified_at <= iat < verification_expires_at",
      );
    }
  } else if (tier === "tls-webpki") {
    verifiedAt = null;
    verificationExpiresAt = null;
  } else {
    throw new ReceiptUpstreamError(
      `upstream.tier check failed: unsupported tier ${repr(tier)}`,
    );
  }

  const attestationStatusValue = await attestationStatus(
    envelope,
    header,
    publicKey,
    requireAttestation,
  );

  const req = digestClaim(
    requiredMapping(payload, "req", ReceiptHashError),
    "req",
    false,
  );
  if (requestBody !== null && requestBody !== undefined) {
    const actual = await sha256(bodyBytes(requestBody, "request body hash"));
    if (!equalBytes(actual, b64urlDecode(req.hash, "req.hash"))) {
      throw new ReceiptHashError("request body hash check failed: req.hash does not match");
    }
  }

  const resp = digestClaim(
    requiredMapping(payload, "resp", ReceiptHashError),
    "resp",
    true,
  );
  if (
    responseBody !== null && responseBody !== undefined &&
    responseStream !== null && responseStream !== undefined
  ) {
    throw new ReceiptHashError(
      "response hash check failed: provide responseBody or responseStream, not both",
    );
  }
  const expectedResponseDigest = b64urlDecode(resp.hash, "resp.hash");
  if (responseBody !== null && responseBody !== undefined) {
    if (resp.of !== "body") {
      throw new ReceiptHashError(
        `response body hash check failed: resp.of is ${repr(resp.of)}, expected 'body'`,
      );
    }
    const actual = await sha256(bodyBytes(responseBody, "response body hash"));
    if (!equalBytes(actual, expectedResponseDigest)) {
      throw new ReceiptHashError("response body hash check failed: resp.hash does not match");
    }
  } else if (responseStream !== null && responseStream !== undefined) {
    if (resp.of !== "sse-data-v1" && resp.of !== "sse-events-v1") {
      throw new ReceiptHashError(
        `response stream hash check failed: resp.of is ${repr(resp.of)}, expected an SSE domain`,
      );
    }
    const stream = bodyBytes(responseStream, "response stream hash");
    const actual = await streamDigest(stream, resp.of, envelope.flattenedValue);
    if (!equalBytes(actual.digest, expectedResponseDigest)) {
      throw new ReceiptHashError(
        "response stream hash check failed: resp.hash does not match",
      );
    }
    if (actual.events !== resp.events) {
      throw new ReceiptHashError(
        `response stream events check failed: counted ${actual.events}, receipt claims ${resp.events}`,
      );
    }
  }

  const iss = requiredString(payload, "iss");
  const jti = requiredString(payload, "jti");
  const gen = optionalString(payload, "gen");
  const route = requiredString(payload, "route");
  if (route !== "chat.completions" && route !== "responses") {
    throw new ReceiptClaimsError(
      `route claim check failed: unsupported route ${repr(route)}`,
    );
  }
  const modelRaw = requiredMapping(payload, "model");
  const model = Object.freeze({
    requested: requiredString(modelRaw, "requested", "model"),
    selected: requiredString(modelRaw, "selected", "model"),
    provider: requiredString(modelRaw, "provider", "model"),
    endpoint: requiredString(modelRaw, "endpoint", "model"),
  });
  const policy = optionalString(upstreamRaw, "policy", "upstream");
  if (tier === "tee-verified" && policy === null) {
    throw new ReceiptUpstreamError(
      "upstream.policy check failed: tee-verified receipts require a policy",
    );
  }
  const certSha256 = optionalString(upstreamRaw, "cert_sha256", "upstream");
  const upstream = Object.freeze({
    tier,
    policy,
    verifiedAt,
    verificationExpiresAt,
    certSha256,
  });
  const attSha256 = optionalString(payload, "att_sha256");
  if (attSha256 !== null) {
    let attDigest;
    try {
      attDigest = b64urlDecode(attSha256, "att_sha256 claim");
    } catch (error) {
      throw new ReceiptClaimsError(error.message, { cause: error });
    }
    if (attDigest.length !== 32) {
      throw new ReceiptClaimsError(
        "att_sha256 claim check failed: SHA-256 digest must be 32 bytes",
      );
    }
  }
  if (!envelope.flattened && attSha256 === null) {
    throw new ReceiptClaimsError(
      "att_sha256 claim check failed: compact receipts must pin an attestation document",
    );
  }

  return Object.freeze({
    rv: payload.rv,
    iss,
    iat,
    jti,
    gen,
    nonce: nonce ?? null,
    route,
    req,
    resp,
    model,
    upstream,
    attSha256,
    attestationStatus: attestationStatusValue,
    attestation: attestationStatusValue,
  });
}

/** Capture exact SSE wire chunks while exposing the embedded flattened JWS. */
export class ReceiptCapture {
  constructor(source) {
    if (source?.[Symbol.asyncIterator]) this._source = source[Symbol.asyncIterator]();
    else if (source?.[Symbol.iterator]) this._source = source[Symbol.iterator]();
    else throw new TypeError("ReceiptCapture source must be an async iterable of raw bytes");
    this._chunks = [];
    this._length = 0;
    this._receipt = null;
  }

  [Symbol.asyncIterator]() {
    return this;
  }

  async next() {
    const result = await this._source.next();
    if (result.done) return { done: true, value: undefined };
    const chunk = result.value;
    if (!(chunk instanceof Uint8Array)) {
      throw new TypeError("ReceiptCapture source must yield Uint8Array or Buffer chunks");
    }
    const saved = new Uint8Array(chunk);
    this._chunks.push(saved);
    this._length += saved.length;
    this._refreshReceipt();
    return { done: false, value: chunk };
  }

  async return(value) {
    if (typeof this._source.return === "function") await this._source.return(value);
    return { done: true, value };
  }

  get receipt() {
    return this._receipt;
  }

  get capturedBytes() {
    return concatBytes(this._chunks, this._length);
  }

  _refreshReceipt() {
    const data = this.capturedBytes;
    let offset = 0;
    while (offset < data.length) {
      const found = nextSseEvent(data, offset);
      if (!found) return;
      const [raw, nextOffset] = found;
      offset = nextOffset;
      try {
        const event = decodeSseEvent(raw);
        const embedded = embeddedReceipt(event.payload);
        if (embedded !== null) this._receipt = { ...embedded };
      } catch (error) {
        if (!(error instanceof ReceiptVerificationError)) throw error;
      }
    }
  }

  async verify(options = {}) {
    if (this._receipt === null) this._refreshReceipt();
    if (this._receipt === null) {
      throw new ReceiptStructureError(
        "receipt capture check failed: no flattened receipt event has been captured",
      );
    }
    if (hasOwn(options, "responseStream")) {
      throw new TypeError("ReceiptCapture.verify supplies responseStream from captured bytes");
    }
    return verifyReceipt(this._receipt, {
      ...options,
      responseStream: this.capturedBytes,
    });
  }
}
