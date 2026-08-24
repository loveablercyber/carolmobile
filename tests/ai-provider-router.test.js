import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import {
  AI_PROVIDER_DEFAULT_MODELS,
  aiProviderRuntime,
  aiProvidersPublicStatus,
  buildAiProviderCandidates,
  normalizeAiProvider,
  shouldRetryAiProviderError,
} from "../server/lib/ai-provider-router.js";

const AI_ENV_KEYS = [
  "GEMINI_ENABLED",
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "GROQ_ENABLED",
  "GROQ_API_KEY",
  "GROQ_MODEL",
];
const originalEnv = {};

beforeEach(() => {
  for (const key of AI_ENV_KEYS) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of AI_ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

test("uses current production defaults for each AI provider", () => {
  const status = aiProvidersPublicStatus();
  assert.equal(status.gemini.model, "gemini-3.5-flash-lite");
  assert.equal(status.groq.model, "openai/gpt-oss-20b");
});

test("recognizes provider configuration stored in the admin panel", () => {
  const runtime = aiProviderRuntime("groq", {
    groqEnabled: true,
    groqApiKey: "panel-secret",
  });

  assert.equal(runtime.enabled, true);
  assert.equal(runtime.configured, true);
  assert.equal(runtime.apiKey, "panel-secret");
  assert.equal(runtime.source, "panel");
});

test("fallback candidates include every distinct provider", () => {
  const candidates = buildAiProviderCandidates({
    primaryProvider: "gemini",
    primaryModel: "gemini-3.5-flash-lite",
    fallbackEnabled: true,
    fallbackProvider: "groq",
    fallbackModel: "openai/gpt-oss-20b",
  });

  assert.deepEqual(
    candidates.map((candidate) => candidate.provider),
    ["gemini", "groq"],
  );
  assert.deepEqual(
    candidates.map((candidate) => candidate.isFallback),
    [false, true],
  );
});

test("normalizes Grok typo and rejects unknown providers safely", () => {
  assert.equal(normalizeAiProvider("grok"), "groq");
  assert.equal(normalizeAiProvider("openai"), "gemini");
  assert.equal(normalizeAiProvider("unknown"), "gemini");
});

test("does not retry permanent provider errors before falling back", () => {
  assert.equal(shouldRetryAiProviderError({ status: 400 }), false);
  assert.equal(shouldRetryAiProviderError({ status: 401 }), false);
  assert.equal(shouldRetryAiProviderError({ status: 429 }), false);
  assert.equal(shouldRetryAiProviderError({ status: 503 }), true);
  assert.equal(shouldRetryAiProviderError({ code: "NETWORK_ERROR" }), true);
});
