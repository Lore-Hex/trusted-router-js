import type { ChatCompletionChunk, ResponseObject, ResponseInputTokens, UserInfoResponse, UserInfoData, OAuthKeyExchangeResponse, OAuthIdentity } from "../index.js";
import { isRecord, requireRecord } from "./records.js";

type Guard = (value: unknown) => boolean;
const string: Guard = (value) => typeof value === "string";
const number: Guard = (value) => typeof value === "number" && Number.isFinite(value);
const boolean: Guard = (value) => typeof value === "boolean";
const nullable = (guard: Guard): Guard => (value) => value === null || guard(value);
const array = (guard: Guard): Guard => (value) => Array.isArray(value) && value.every((item: unknown) => guard(item));
function optionalFields(value: Record<string, unknown>, fields: Record<string, Guard>): boolean {
  return Object.entries(fields).every(([key, guard]) => !Object.hasOwn(value, key) || guard(value[key]));
}
// Wire: the control plane's identity_payload() (quill-router verification.py) is null or a record
// whose `sub` is the user id string. Extra fields (phone_verified, identity_verified,
// verification_level, ...) pass through untouched; only the fields the declared type names are shaped.
function identityFields(value: Record<string, unknown>): boolean {
  return optionalFields(value, {
    email: nullable(string), email_verified: nullable(boolean), wallet_address: nullable(string),
    workspace_id: nullable(string), created_at: nullable(string),
    company_affiliations: array((item) => isRecord(item) &&
      ["company_name", "funding_organization", "relationship", "domain", "source_url", "checked_at", "match_method"].every((key) => string(item[key])) && nullable(number)(item.founding_year)),
  });
}
function identity(value: unknown): value is OAuthIdentity {
  return isRecord(value) && string(value.sub) && identityFields(value);
}
// Wire: GET /auth/userinfo answers legacy ownerless API keys with {data: {sub: null, workspace_id}}
// (quill-router routes/auth.py), so `sub` is nullable here and only here.
function userIdentity(value: unknown): value is UserInfoData {
  return isRecord(value) && nullable(string)(value.sub) && identityFields(value);
}
function response(value: unknown): value is ResponseObject {
  return isRecord(value) && string(value.id) && value.object === "response" && optionalFields(value, {
    created_at: number, status: string, model: nullable(string), output: array(isRecord), usage: nullable(isRecord),
  });
}
export function responseObject(value: unknown): ResponseObject {
  if (!response(value)) throw new TypeError("Malformed response object");
  return value;
}
function tokens(value: unknown): value is ResponseInputTokens {
  return isRecord(value) && number(value.input_tokens) && optionalFields(value, { total_tokens: nullable(number) });
}
export function responseTokens(value: unknown): ResponseInputTokens {
  if (!tokens(value)) throw new TypeError("Malformed input token response");
  return value;
}
function user(value: unknown): value is UserInfoResponse {
  return isRecord(value) && userIdentity(value.data);
}
export function userInfo(value: unknown): UserInfoResponse {
  if (!user(value)) throw new TypeError("Malformed user info response");
  return value;
}
// Wire: POST /auth/keys returns {key, user_id, identity | null, data} from the control plane
// (quill-router routes/oauth_keys.py); the SDK conformance harness (scenario oauth-no-credentials)
// sends only {key, user_id}. The SDK itself consumes `key`; everything else passes through, so
// `key` is the only required field. A guard must require what the SDK consumes, not what a
// hand-written type happened to declare.
function exchange(value: unknown): value is OAuthKeyExchangeResponse {
  return isRecord(value) && string(value.key) && optionalFields(value, {
    user_id: nullable(string), identity: nullable(identity), data: isRecord,
  });
}
export function keyExchange(value: unknown): OAuthKeyExchangeResponse {
  if (!exchange(value)) throw new TypeError("Malformed OAuth key response");
  return value;
}
function chunk(value: unknown): value is ChatCompletionChunk {
  return isRecord(value) && optionalFields(value, {
    id: string, object: (item) => item === "chat.completion.chunk", created: number, model: string,
  }) && array((choice) => isRecord(choice) && optionalFields(choice, {
    index: number, finish_reason: nullable(string),
    delta: (delta) => isRecord(delta) && optionalFields(delta, {
      role: string, content: nullable(string), reasoning: nullable(string), reasoning_content: nullable(string),
      refusal: nullable(string), tool_calls: Array.isArray, function_call: nullable(isRecord),
    }),
  }))(value.choices);
}
export function chatChunk(value: unknown): ChatCompletionChunk {
  if (!chunk(value)) throw new TypeError("Malformed chat completion chunk");
  return value;
}

export { requireRecord };
