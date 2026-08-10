/**
 * TrustedRouter JavaScript SDK — public barrel (L9).
 *
 * OpenAI-compatible client for https://api.trustedrouter.com/v1. Mirrors
 * the Python SDK's surface so multi-language teams stay in sync: typed
 * errors, automatic retries with backoff, apex load-balancer failover,
 * per-call extras (extraHeaders/idempotencyKey/timeout/apiKey/workspaceId),
 * and messages/activity wrappers.
 *
 * This file is a pure re-export shim over src/client.js and src/internal/*;
 * every name importable before the internal restructure keeps working.
 * Implementation layers: internal/transport.js (policy kernel + candidate
 * set + THE retry/failover engine + attempt assembly), internal/sse.js
 * (stream codec), internal/errors.js (error taxonomy), internal/models.js +
 * internal/orchestration.js (constants and tool builders), internal/pkce.js
 * (browser OAuth), internal/trust.js (trust-release fetch).
 *
 * Attestation verification (`verifyGatewayAttestation`) lives in
 * ./attestation.js. TLS session pinning lives in the Node-only
 * @lore-hex/trusted-router/session subpath so browser root imports do not
 * pull Node built-ins.
 */

export { TrustedRouter } from "./client.js";
export {
  AuthenticationError,
  BadRequestError,
  EndpointNotSupportedError,
  InternalError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  TrustedRouterError,
} from "./internal/errors.js";
export {
  ADVISOR_MODEL,
  ALIAS_API_BASE_URLS,
  ATHENA_MODEL,
  AUTO_MODEL,
  CONFIDENTIAL_MODEL,
  DEFAULT_API_BASE_URL,
  DEFAULT_CONTROL_BASE_URL,
  DEFAULT_REGION_PROBE_TIMEOUT_MS,
  DEFAULT_STATUS_URL,
  DEFAULT_TRUST_RELEASE_URL,
  E2E_MODEL,
  EU_MODEL,
  FAST_MODEL,
  FUSION_FREEDOM_FALLBACK_JUDGES,
  FUSION_FREEDOM_PANEL,
  FUSION_MODEL,
  MAP_REDUCE_MODEL,
  PROMETHEUS_MODEL,
  ProviderPreferences,
  REGION_BASE_URLS,
  SELECTOR_MODEL,
  SOCRATES_MODEL,
  SUBAGENT_MODEL,
  SYNTH_MODEL,
  US_MODEL,
  VERSION,
  ZDR_MODEL,
  ZEUS_MODEL,
} from "./internal/models.js";
export {
  advisorTool,
  fusionTool,
  mapReduceTool,
  selectorTool,
  subagentTool,
} from "./internal/orchestration.js";
export { createOAuthPkcePair, randomOAuthState } from "./internal/pkce.js";
export { collectCompletion } from "./internal/sse.js";
export { fetchTrustRelease, trustRelease } from "./internal/trust.js";
