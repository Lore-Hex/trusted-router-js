// Literal wire fixtures for the control-plane auth boundaries. Each payload is copied from the
// producer, not invented: the SDK conformance harness (scenarios/20-oauth-no-credentials.json)
// and the control plane's routes/oauth_keys.py, routes/auth.py, verification.py. The wire guards
// in src/internal/wire.ts must accept every shape a producer actually sends and reject only
// shapes that break what the SDK consumes.
import test from "node:test";
import assert from "node:assert/strict";
import { TrustedRouter } from "../dist/index.js";

const jsonResponse = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});
const clientFor = (payload) => new TrustedRouter({ apiKey: "k", fetchImpl: async () => jsonResponse(200, payload) });

// identity_payload(user, workspace_id) — verification.py
const PROD_IDENTITY = {
  sub: "user_01HZX",
  email: "person@example.com",
  email_verified: true,
  phone_verified: false,
  identity_verified: true,
  verification_level: "identity",
  wallet_address: null,
  workspace_id: "ws_01HZX",
  created_at: "2026-08-27T00:00:00Z",
};

test("wire fixture: conformance oauth-no-credentials exchange body {key, user_id} is accepted verbatim", async () => {
  const payload = { key: "tr-delegated-conformance", user_id: "user-conformance" };
  assert.deepEqual(await clientFor(payload).exchangeOAuthKey({ code: "conformance-code" }), payload);
});

test("wire fixture: control-plane exchange body {key, user_id, identity, data} passes through", async () => {
  const payload = {
    key: "sk-tr-v1-delegated",
    user_id: "user_01HZX",
    identity: PROD_IDENTITY,
    data: { id: "key_01", name: "Lore Web", limit: null, usage: 0 },
  };
  assert.deepEqual(await clientFor(payload).exchangeOAuthKey({ code: "code" }), payload);
});

test("wire fixture: control-plane exchange with identity null passes through", async () => {
  const payload = { key: "sk-tr-v1-delegated", user_id: "user_01HZX", identity: null, data: {} };
  assert.deepEqual(await clientFor(payload).exchangeOAuthKey({ code: "code" }), payload);
});

test("wire fixture: exchange rejects only what breaks the consumed field", async () => {
  for (const payload of [{}, { key: 7 }, { key: null, user_id: "u" }, { key: "k", identity: [] }, { key: "k", identity: { sub: 7 } }, { key: "k", data: [] }]) {
    await assert.rejects(clientFor(payload).exchangeOAuthKey({ code: "code" }), /Malformed OAuth key response/);
  }
  // A non-object body is refused one layer earlier, by the request-level record check.
  await assert.rejects(clientFor(["k"]).exchangeOAuthKey({ code: "code" }), TypeError);
});

test("wire fixture: userinfo {data: identity_payload} passes through", async () => {
  const payload = { data: PROD_IDENTITY };
  assert.deepEqual(await clientFor(payload).userInfo(), payload);
});

test("wire fixture: userinfo legacy ownerless-key body {data: {sub: null, workspace_id}} is accepted", async () => {
  const payload = { data: { sub: null, workspace_id: "ws_01HZX" } };
  assert.deepEqual(await clientFor(payload).userInfo(), payload);
});

test("wire fixture: userinfo rejects non-record data and non-string subjects", async () => {
  for (const payload of [{}, { data: [] }, { data: null }, { data: { sub: 7 } }, { data: { sub: "u", email: 7 } }]) {
    await assert.rejects(clientFor(payload).userInfo(), /Malformed user info response/);
  }
});
