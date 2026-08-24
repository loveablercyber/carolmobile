import { generateOpenAiText, openAiPublicStatus } from "./openai-client.js";
import { generateGeminiText, geminiPublicStatus } from "./gemini-client.js";
import { generateGroqText, groqPublicStatus } from "./groq-client.js";

export const AI_PROVIDER_DEFAULT_MODELS = Object.freeze({
  openai: "gpt-5.4-mini",
  gemini: "gemini-3.5-flash-lite",
  groq: "openai/gpt-oss-20b",
});

const PROVIDERS = Object.freeze(["openai", "gemini", "groq"]);

export function normalizeAiProvider(value) {
  const provider = String(value || "openai").toLowerCase().trim();
  if (provider === "grok") return "groq";
  return PROVIDERS.includes(provider) ? provider : "openai";
}

function providerEnvironmentStatus(provider) {
  if (provider === "gemini") return geminiPublicStatus();
  if (provider === "groq") return groqPublicStatus();
  return openAiPublicStatus();
}

function panelProviderConfig(provider, settings = {}) {
  if (provider === "gemini") {
    return {
      enabled: Boolean(settings.geminiEnabled),
      apiKey: settings.geminiApiKey || null,
    };
  }
  if (provider === "groq") {
    return {
      enabled: Boolean(settings.groqEnabled),
      apiKey: settings.groqApiKey || null,
    };
  }
  return {
    enabled: Boolean(settings.openaiEnabled),
    apiKey: settings.openaiApiKey || null,
  };
}

export function aiProviderRuntime(providerValue, settings = {}) {
  const provider = normalizeAiProvider(providerValue);
  const environment = providerEnvironmentStatus(provider);
  const panel = panelProviderConfig(provider, settings);
  const environmentConfigured = Boolean(environment.configured);
  const panelConfigured = Boolean(panel.apiKey);

  return {
    provider,
    enabled: Boolean(environment.enabled || panel.enabled),
    configured: Boolean(environmentConfigured || panelConfigured),
    defaultModel: environment.model || AI_PROVIDER_DEFAULT_MODELS[provider],
    apiKey: panel.apiKey,
    keyCount: Number(environment.keyCount || 0) + (panelConfigured ? 1 : 0),
    source:
      environmentConfigured && panelConfigured
        ? "environment_and_panel"
        : panelConfigured
          ? "panel"
          : environmentConfigured
            ? "environment"
            : "none",
  };
}

export function aiProvidersPublicStatus(settings = {}) {
  return Object.fromEntries(
    PROVIDERS.map((provider) => {
      const runtime = aiProviderRuntime(provider, settings);
      return [
        provider,
        {
          provider,
          configured: runtime.configured,
          enabled: runtime.enabled,
          model: runtime.defaultModel,
          keyCount: runtime.keyCount,
          source: runtime.source,
        },
      ];
    }),
  );
}

export async function generateAiProviderText({ provider, ...input }) {
  const normalized = normalizeAiProvider(provider);
  if (normalized === "gemini") return generateGeminiText(input);
  if (normalized === "groq") return generateGroqText(input);
  return generateOpenAiText(input);
}

export function buildAiProviderCandidates(settings = {}) {
  const primaryProvider = normalizeAiProvider(
    settings.primaryProvider || settings.provider || "openai",
  );
  const candidates = [
    {
      provider: primaryProvider,
      model: settings.primaryModel || settings.model || "",
      isFallback: false,
    },
  ];

  if (!settings.fallbackEnabled) return candidates;

  const addCandidate = (providerValue, model = "") => {
    const provider = normalizeAiProvider(providerValue);
    if (candidates.some((item) => item.provider === provider)) return;
    candidates.push({ provider, model, isFallback: true });
  };

  addCandidate(settings.fallbackProvider || primaryProvider, settings.fallbackModel || "");
  for (const provider of PROVIDERS) addCandidate(provider);
  return candidates;
}

export function shouldRetryAiProviderError(error) {
  const status = Number(error?.status || 0);
  if (status >= 400 && status < 500) return false;
  return true;
}
