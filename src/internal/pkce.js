/**
 * Browser OAuth / PKCE helpers.
 *
 * Web Crypto only — no Node built-ins — so every module reachable from the
 * root barrel stays browser-safe (typeof-guarded btoa/Buffer fallback).
 */

export function randomOAuthState({ byteLength = 16 } = {}) {
  return randomBase64Url(byteLength);
}

export async function createOAuthPkcePair({ codeVerifier = null } = {}) {
  const verifier = codeVerifier ?? randomBase64Url(32);
  return {
    codeVerifier: verifier,
    codeChallenge: await sha256Base64Url(verifier),
    codeChallengeMethod: "S256",
  };
}

export function randomBase64Url(byteLength) {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("Web Crypto getRandomValues is required");
  }
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return base64UrlEncodeBytes(bytes);
}

export async function sha256Base64Url(text) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto subtle digest is required");
  }
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return base64UrlEncodeBytes(new Uint8Array(digest));
}

export function base64UrlEncodeBytes(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded =
    typeof btoa === "function"
      ? btoa(binary)
      : Buffer.from(binary, "binary").toString("base64");
  return encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function callbackUrlWithState(callbackUrl, state) {
  const url = new URL(callbackUrl);
  url.searchParams.set("state", state);
  return url.toString();
}
