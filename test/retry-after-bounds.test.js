/**
 * Property tests for the Retry-After bound.
 *
 * Retry-After arrives from whatever answered the socket — the gateway, a
 * proxy, an alias domain — so it is untrusted input, and it was applied as an
 * *uncapped* floor on the backoff sleep. The law:
 *
 *     for every attempt a and every header map H over arbitrary strings,
 *         parseRetryAfter(H)   is null, or finite and in [0, MAX_RETRY_AFTER_SECONDS]
 *         retrySleepMs(a, ...) is finite and in [0, max(30_000, MAX*1000)] ms
 *
 * Non-finite values were already rejected here (Number("inf") is NaN), but
 * finite-and-absurd ones were accepted silently:
 *
 *     Retry-After: 100000  -> 1e8 ms, 27.8 hours per attempt
 *     Retry-After: 1e300   -> 1e303 ms, which Node then clamps to 1 ms with a
 *                             TimeoutOverflowWarning — a hot retry loop
 *                             dressed as a long wait
 *
 * The acceptance-set test is the cross-SDK half. trusted-router-py used to
 * accept "inf" where this SDK rejected it, so identical network weather hung
 * Python and let JS proceed; both now reject exactly {NaN, ±Infinity,
 * negatives}. A divergence here means the two SDKs behave differently on the
 * same response, which is near-undiagnosable from logs.
 *
 * This package ships with no dependencies and no devDependencies, so the tests
 * drive a small seeded generator rather than pulling in fast-check. The seed
 * is fixed, so a failure reproduces exactly; RUNS= raises the search locally.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_RETRY_AFTER_SECONDS,
  parseRetryAfter,
  retrySleepMs,
} from "../src/internal/transport.js";

const RUNS = Number(process.env.RUNS || 400);
const SLEEP_CEILING_MS = Math.max(30_000, MAX_RETRY_AFTER_SECONDS * 1000);

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (r, xs) => xs[Math.floor(r() * xs.length)];

// Weighted toward the shapes that broke it, with random text mixed in.
const INTERESTING = [
  "inf", "-inf", "Infinity", "-Infinity", "NaN", "nan",
  "1e300", "1e309", "100000", "86400", "-5", "0", "0.001",
  "  30  ", "30s", "1_000", "0x10", "", "   ",
  "Wed, 21 Oct 2015 07:28:00 GMT", "9007199254740993",
];

function headerValue(r) {
  if (r() < 0.7) return pick(r, INTERESTING);
  const len = Math.floor(r() * 8);
  const alphabet = "0123456789.eE+- ";
  let out = "";
  for (let i = 0; i < len; i += 1) out += alphabet[Math.floor(r() * alphabet.length)];
  return out;
}

function headerMap(r) {
  const h = {};
  if (r() < 0.6) h["retry-after"] = headerValue(r);
  if (r() < 0.6) h["retry-after-ms"] = headerValue(r);
  return h;
}

test("property: a parsed hint is null or finite and bounded", () => {
  const r = rng(0x5eed);
  for (let i = 0; i < RUNS; i += 1) {
    const h = headerMap(r);
    const parsed = parseRetryAfter(h);
    if (parsed === null) continue;
    assert.ok(Number.isFinite(parsed), `non-finite hint ${parsed} from ${JSON.stringify(h)}`);
    assert.ok(
      parsed >= 0 && parsed <= MAX_RETRY_AFTER_SECONDS,
      `unbounded hint ${parsed} from ${JSON.stringify(h)}`,
    );
  }
});

test("property: the sleep that reaches setTimeout is finite and bounded", () => {
  const r = rng(0xc0ffee);
  for (let i = 0; i < RUNS; i += 1) {
    const h = headerMap(r);
    // Attempt is quantified too: the jitter base is exponential in it, so it
    // is its own overflow path independent of the header.
    const attempt = Math.floor(r() * 2000);
    const delay = retrySleepMs(attempt, parseRetryAfter(h));
    assert.ok(Number.isFinite(delay), `non-finite sleep ${delay} from ${JSON.stringify(h)}`);
    assert.ok(
      delay >= 0 && delay <= SLEEP_CEILING_MS,
      `unbounded sleep ${delay} from ${JSON.stringify(h)} at attempt ${attempt}`,
    );
  }
});

test("property: retrySleepMs re-clamps a hint handed to it directly", () => {
  const r = rng(0xfeed);
  const values = [Infinity, -Infinity, NaN, 1e300, 1e9, 100000, -5, 0, 30, null, undefined];
  for (let i = 0; i < RUNS; i += 1) {
    const delay = retrySleepMs(Math.floor(r() * 10), pick(r, values));
    assert.ok(Number.isFinite(delay), `non-finite sleep ${delay}`);
    assert.ok(delay >= 0 && delay <= SLEEP_CEILING_MS, `unbounded sleep ${delay}`);
  }
});

test("property: rejection is exactly NaN, +/-Infinity and negatives", () => {
  // Stated over the header layer, since that is where the two SDKs must agree.
  for (const value of ["inf", "Infinity", "-Infinity", "NaN", "nan", "-5", "-0.001"]) {
    assert.equal(
      parseRetryAfter({ "retry-after": value }),
      null,
      `expected ${value} to be rejected`,
    );
  }
  for (const [value, expected] of [["0", 0], ["1", 1], ["30", 30], ["59.5", 59.5]]) {
    assert.equal(parseRetryAfter({ "retry-after": value }), expected);
  }
});

test("hints within the bound are honoured exactly", () => {
  const r = rng(0xabcd);
  for (let i = 0; i < RUNS; i += 1) {
    const seconds = Math.round(r() * MAX_RETRY_AFTER_SECONDS * 1000) / 1000;
    assert.equal(parseRetryAfter({ "retry-after": String(seconds) }), seconds);
    assert.ok(retrySleepMs(0, seconds) >= seconds * 1000 - 1e-6);
  }
});

test("the headers that used to park a caller are clamped", () => {
  assert.equal(parseRetryAfter({ "retry-after": "100000" }), MAX_RETRY_AFTER_SECONDS);
  assert.equal(parseRetryAfter({ "retry-after": "1e300" }), MAX_RETRY_AFTER_SECONDS);
  assert.equal(parseRetryAfter({ "retry-after-ms": "1e300" }), MAX_RETRY_AFTER_SECONDS);
  // Below the 2^31 ms mark that Node silently clamps to 1 ms, so the delay the
  // caller observes is the delay we intended.
  assert.ok(SLEEP_CEILING_MS < 2 ** 31 - 1);
});

test("a junk retry-after-ms still falls through to a usable retry-after", () => {
  for (const junk of ["inf", "NaN", "-5", "abc"]) {
    assert.equal(parseRetryAfter({ "retry-after-ms": junk, "retry-after": "7" }), 7);
  }
});

test("retry-after-ms wins over retry-after when both are usable", () => {
  assert.equal(parseRetryAfter({ "retry-after-ms": "1500", "retry-after": "7" }), 1.5);
});
