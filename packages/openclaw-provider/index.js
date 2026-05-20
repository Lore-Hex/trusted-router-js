import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createProviderApiKeyAuthMethod } from "openclaw/plugin-sdk/provider-auth-api-key";
import {
  DEFAULT_CONTEXT_TOKENS,
  buildProviderReplayFamilyHooks,
} from "openclaw/plugin-sdk/provider-model-shared";
import { applyAgentDefaultModelPrimary } from "openclaw/plugin-sdk/provider-onboard";
import { buildProviderStreamFamilyHooks } from "openclaw/plugin-sdk/provider-stream";

const PROVIDER_ID = "trustedrouter";
const TRUSTEDROUTER_BASE_URL = "https://api.quillrouter.com/v1";
const TRUSTEDROUTER_LEGACY_BASE_URL = "https://api.trustedrouter.com/v1";
const TRUSTEDROUTER_DEFAULT_MODEL_REF = "trustedrouter/auto";
const TRUSTEDROUTER_DEFAULT_MAX_TOKENS = 8192;
const TRUSTEDROUTER_DEFAULT_COST = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl ?? "")
    .trim()
    .replace(/\/+$/, "");
}

function normalizeTrustedRouterBaseUrl(baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) return undefined;
  if (normalized === TRUSTEDROUTER_BASE_URL || normalized === TRUSTEDROUTER_LEGACY_BASE_URL) {
    return TRUSTEDROUTER_BASE_URL;
  }
  return undefined;
}

function normalizeModelId(modelId) {
  const normalized = String(modelId ?? "").trim();
  return normalized || TRUSTEDROUTER_DEFAULT_MODEL_REF;
}

function applyTrustedRouterConfig(cfg) {
  const models = { ...cfg.agents?.defaults?.models };
  models[TRUSTEDROUTER_DEFAULT_MODEL_REF] = {
    ...models[TRUSTEDROUTER_DEFAULT_MODEL_REF],
    alias: models[TRUSTEDROUTER_DEFAULT_MODEL_REF]?.alias ?? "TrustedRouter.com",
  };

  return applyAgentDefaultModelPrimary(
    {
      ...cfg,
      agents: {
        ...cfg.agents,
        defaults: {
          ...cfg.agents?.defaults,
          models,
        },
      },
    },
    TRUSTEDROUTER_DEFAULT_MODEL_REF,
  );
}

function buildTrustedRouterProvider(apiKey) {
  return {
    baseUrl: TRUSTEDROUTER_BASE_URL,
    api: "openai-completions",
    ...(apiKey ? { apiKey } : {}),
    models: [
      {
        id: TRUSTEDROUTER_DEFAULT_MODEL_REF,
        name: "TrustedRouter Auto",
        reasoning: false,
        input: ["text"],
        cost: TRUSTEDROUTER_DEFAULT_COST,
        contextWindow: DEFAULT_CONTEXT_TOKENS,
        maxTokens: TRUSTEDROUTER_DEFAULT_MAX_TOKENS,
      },
    ],
  };
}

function buildDynamicTrustedRouterModel(ctx) {
  const modelId = normalizeModelId(ctx.modelId);
  return {
    id: modelId,
    name: modelId === TRUSTEDROUTER_DEFAULT_MODEL_REF ? "TrustedRouter Auto" : modelId,
    provider: PROVIDER_ID,
    api: "openai-completions",
    baseUrl: TRUSTEDROUTER_BASE_URL,
    reasoning: false,
    input: ["text"],
    cost: TRUSTEDROUTER_DEFAULT_COST,
    contextWindow: DEFAULT_CONTEXT_TOKENS,
    maxTokens: TRUSTEDROUTER_DEFAULT_MAX_TOKENS,
  };
}

function normalizeTrustedRouterResolvedModel(model) {
  const normalizedBaseUrl = normalizeTrustedRouterBaseUrl(model.baseUrl);
  if (!normalizedBaseUrl || normalizedBaseUrl === model.baseUrl) {
    return undefined;
  }
  return {
    ...model,
    baseUrl: normalizedBaseUrl,
  };
}

export default definePluginEntry({
  id: PROVIDER_ID,
  name: "TrustedRouter.com Provider",
  description: "TrustedRouter.com end-to-end encrypted OpenRouter-compatible LLM router.",
  register(api) {
    api.registerProvider({
      id: PROVIDER_ID,
      label: "TrustedRouter.com",
      docsPath: "https://trustedrouter.com",
      envVars: ["TRUSTEDROUTER_API_KEY"],
      auth: [
        createProviderApiKeyAuthMethod({
          providerId: PROVIDER_ID,
          methodId: "api-key",
          label: "TrustedRouter.com API key",
          hint: "End-to-end encrypted OpenRouter-compatible API key",
          optionKey: "trustedrouterApiKey",
          flagName: "--trustedrouter-api-key",
          envVar: "TRUSTEDROUTER_API_KEY",
          promptMessage: "Enter TrustedRouter.com API key",
          defaultModel: TRUSTEDROUTER_DEFAULT_MODEL_REF,
          expectedProviders: [PROVIDER_ID],
          applyConfig: applyTrustedRouterConfig,
          wizard: {
            choiceId: "trustedrouter-api-key",
            choiceLabel: "TrustedRouter.com API key",
            choiceHint: "End-to-end encrypted OpenRouter-compatible router",
            groupId: "openrouter",
            groupLabel: "OpenRouter-compatible routers",
            groupHint: "API key",
            onboardingScopes: ["text-inference"],
          },
        }),
      ],
      catalog: {
        order: "simple",
        run: async (ctx) => {
          const apiKey = ctx.resolveProviderApiKey(PROVIDER_ID).apiKey;
          if (!apiKey) return null;
          return {
            provider: buildTrustedRouterProvider(apiKey),
          };
        },
      },
      staticCatalog: {
        order: "simple",
        run: async () => ({
          provider: buildTrustedRouterProvider(),
        }),
      },
      resolveDynamicModel: buildDynamicTrustedRouterModel,
      normalizeConfig: ({ providerConfig }) => {
        const normalizedBaseUrl = normalizeTrustedRouterBaseUrl(providerConfig.baseUrl);
        return normalizedBaseUrl && normalizedBaseUrl !== providerConfig.baseUrl
          ? { ...providerConfig, baseUrl: normalizedBaseUrl }
          : undefined;
      },
      normalizeResolvedModel: ({ model }) => normalizeTrustedRouterResolvedModel(model),
      normalizeTransport: ({ api, baseUrl }) => {
        const normalizedBaseUrl = normalizeTrustedRouterBaseUrl(baseUrl);
        return normalizedBaseUrl && normalizedBaseUrl !== baseUrl
          ? {
              api,
              baseUrl: normalizedBaseUrl,
            }
          : undefined;
      },
      ...buildProviderReplayFamilyHooks({ family: "passthrough-gemini" }),
      ...buildProviderStreamFamilyHooks("openrouter-thinking"),
      resolveReasoningOutputMode: () => "native",
      isModernModelRef: () => true,
    });

    api.registerModelCatalogProvider({
      provider: PROVIDER_ID,
      kinds: ["text"],
      liveCatalog: async (ctx) => {
        const apiKey = ctx.resolveProviderApiKey(PROVIDER_ID).apiKey;
        if (!apiKey) return null;
        return [
          {
            kind: "text",
            provider: PROVIDER_ID,
            model: TRUSTEDROUTER_DEFAULT_MODEL_REF,
            label: "TrustedRouter Auto",
            source: "static",
            default: true,
            authEnvVars: ["TRUSTEDROUTER_API_KEY"],
            docsPath: "https://trustedrouter.com",
          },
        ];
      },
    });
  },
});
