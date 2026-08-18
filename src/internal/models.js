/**
 * L7 (data) — model-alias constants, default endpoint URLs, provider
 * routing preferences, and the /models catalog path builder.
 *
 * Wire schemas here are pinned by the cross-SDK parity tests
 * (test/parity-contract.test.js, test/fusion.test.js) and must not change.
 */

// Feeds the User-Agent string. package.json is the single source of truth;
// test/parity-contract.test.js pins this constant to it so they cannot drift
// again (a runtime read of package.json would drag Node built-ins into the
// browser-safe root import, so the test is the enforcement point).
export const VERSION = "0.5.0";
export const DEFAULT_API_BASE_URL = "https://api.trustedrouter.com/v1";
export const DEFAULT_CONTROL_BASE_URL = "https://trustedrouter.com/v1";
export const DEFAULT_TRUST_RELEASE_URL =
  "https://trust.trustedrouter.com/trust/gcp-release.json";
export const DEFAULT_STATUS_URL =
  "https://status.trustedrouter.com/status.json";
export const DEFAULT_REGION_PROBE_TIMEOUT_MS = 1500;
export const REGION_BASE_URLS = Object.freeze([
  "https://api-us-central1.quillrouter.com/v1",
  "https://api-us-east4.quillrouter.com/v1",
  "https://api-europe-west4.quillrouter.com/v1",
]);

// Exact aliases of the primary API, on separate domains served by separate DNS
// providers (trustedrouter.com from Google Cloud DNS, these two from Route 53).
// They resolve to the same attested enclaves.
//
// The domain is a single point of failure sitting above the whole deployment: a
// zone that stops answering, a registrar lock, or a stale resolver record takes
// the API down however many clouds are behind it.
export const ALIAS_API_BASE_URLS = Object.freeze([
  "https://api.allyrouter.com/v1",
  "https://api.uptimerouter.com/v1",
]);
export const AUTO_MODEL = "trustedrouter/auto";
export const FAST_MODEL = "trustedrouter/fast";
export const ZDR_MODEL = "trustedrouter/zdr";
export const E2E_MODEL = "trustedrouter/e2e";
export const CONFIDENTIAL_MODEL = "trustedrouter/confidential";
export const EU_MODEL = "trustedrouter/eu";
export const US_MODEL = "trustedrouter/us";
export const FUSION_MODEL = "trustedrouter/fusion";
export const SYNTH_MODEL = "trustedrouter/synth";
export const ADVISOR_MODEL = "trustedrouter/advisor";
export const SELECTOR_MODEL = "trustedrouter/selector";
export const MAP_REDUCE_MODEL = "trustedrouter/mapreduce";
export const SUBAGENT_MODEL = "trustedrouter/subagent";
export const SOCRATES_MODEL = "trustedrouter/socrates-1.1";
export const PROMETHEUS_MODEL = "trustedrouter/prometheus-2.0";
export const ZEUS_MODEL = "trustedrouter/zeus-1.0";
export const ATHENA_MODEL = "trustedrouter/athena";

// Recommended panel + judge fallback chain for maximum willingness to answer.
// Use gateway-supported latest aliases where possible so examples survive
// provider deprecations without requiring an SDK release.
export const FUSION_FREEDOM_PANEL = Object.freeze([
  "minimax/minimax-m3",
  "~kimi/latest",
  "~zai/glm-latest",
  "google/gemma-4-31b-it",
  "deepseek/deepseek-v4-flash",
]);
export const FUSION_FREEDOM_FALLBACK_JUDGES = Object.freeze([
  "minimax/minimax-m3",
  "~zai/glm-latest",
  "~kimi/latest",
  "deepseek/deepseek-v4-flash",
  "google/gemma-4-31b-it",
]);

/** Typed, JSON-serializable provider routing preferences. */
export class ProviderPreferences {
  constructor({
    order = null,
    only = null,
    ignore = null,
    sort = null,
    allowFallbacks = null,
    requireParameters = null,
    dataCollection = null,
    minPrivacy = null,
    jurisdiction = null,
    usage = null,
    quantizations = null,
    maxPrice = null,
  } = {}) {
    if (sort !== null && !["price", "latency", "throughput"].includes(String(sort).toLowerCase())) {
      throw new TypeError("sort must be price, latency, or throughput");
    }
    if (dataCollection !== null && !["allow", "deny"].includes(String(dataCollection).toLowerCase())) {
      throw new TypeError("dataCollection must be allow or deny");
    }
    if (minPrivacy !== null && !["any", "no_store", "zdr", "confidential", "e2e", "e2ee"].includes(String(minPrivacy).toLowerCase())) {
      throw new TypeError("unsupported minPrivacy");
    }
    if (jurisdiction !== null && String(jurisdiction).toLowerCase() !== "us") {
      throw new TypeError("jurisdiction currently supports only us");
    }
    if (usage !== null && !["credits", "byok"].includes(String(usage).toLowerCase())) {
      throw new TypeError("usage must be credits or byok");
    }
    if (order !== null) this.order = [...order];
    if (only !== null) this.only = [...only];
    if (ignore !== null) this.ignore = [...ignore];
    if (sort !== null) this.sort = String(sort).toLowerCase();
    if (allowFallbacks !== null) this.allow_fallbacks = Boolean(allowFallbacks);
    if (requireParameters !== null) this.require_parameters = Boolean(requireParameters);
    if (dataCollection !== null) this.data_collection = String(dataCollection).toLowerCase();
    if (minPrivacy !== null) this.min_privacy = String(minPrivacy).toLowerCase();
    if (jurisdiction !== null) this.jurisdiction = "us";
    if (usage !== null) this.usage = String(usage).toLowerCase();
    if (quantizations !== null) this.quantizations = [...quantizations];
    if (maxPrice !== null) this.max_price = { ...maxPrice };
  }

  static zdr() {
    return new ProviderPreferences({ minPrivacy: "zdr", dataCollection: "deny" });
  }

  static confidential() {
    return new ProviderPreferences({ minPrivacy: "confidential", dataCollection: "deny" });
  }

  static usOnly() {
    return new ProviderPreferences({ jurisdiction: "us" });
  }

}

export function modelsPath({
  openWeights = null,
  providerJurisdiction = null,
  providerRegion = null,
} = {}) {
  const params = new URLSearchParams();
  if (openWeights !== null && openWeights !== undefined) {
    params.set("open_weights", openWeights ? "true" : "false");
  }
  if (providerJurisdiction) {
    params.set("provider[jurisdiction]", providerJurisdiction);
  }
  if (providerRegion) {
    params.set("provider[region]", providerRegion);
  }
  const qs = params.toString();
  return qs ? `/models?${qs}` : "/models";
}
