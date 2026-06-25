import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRuntimePrompt,
  defaultAiSettings,
  normalizeAiSettingsInput,
} from "../server/lib/ai-whatsapp.js";
import { geminiPublicStatus } from "../server/lib/gemini-client.js";

test("normalizes AI WhatsApp settings and preserves explicit false values", () => {
  const base = defaultAiSettings();
  const normalized = normalizeAiSettingsInput(
    {
      ...base,
      enabled: "false",
      allow24h: "false",
      allowAutoBooking: "true",
      maxAutoMessages: "200",
      maxIdleMinutes: "1",
      aiStartTime: "08:30",
      aiEndTime: "18:00",
    },
    base,
  );

  assert.equal(normalized.enabled, false);
  assert.equal(normalized.allow24h, false);
  assert.equal(normalized.allowAutoBooking, true);
  assert.equal(normalized.maxAutoMessages, 80);
  assert.equal(normalized.maxIdleMinutes, 5);
  assert.equal(normalized.aiStartTime, "08:30");
  assert.equal(normalized.aiEndTime, "18:00");
});

test("rejects invalid AI WhatsApp personality and short prompt", () => {
  assert.throws(
    () =>
      normalizeAiSettingsInput({
        ...defaultAiSettings(),
        personalityMode: "modo_inexistente",
      }),
    /Modo de humor inválido/,
  );

  assert.throws(
    () =>
      normalizeAiSettingsInput({
        ...defaultAiSettings(),
        systemPrompt: "curto",
      }),
    /pelo menos 80 caracteres/,
  );
});

test("builds runtime prompt with anti-hallucination rules and no secrets", () => {
  const prompt = buildRuntimePrompt(defaultAiSettings());

  assert.match(prompt, /Nunca inventar preços/);
  assert.match(prompt, /ferramentas reais do backend/);
  assert.doesNotMatch(prompt, /GEMINI_API_KEY/i);
  assert.doesNotMatch(prompt, /apiKey/i);
});

test("Gemini public status never exposes API key", () => {
  const previousKey = process.env.GEMINI_API_KEY;
  const previousEnabled = process.env.GEMINI_ENABLED;
  const previousModel = process.env.GEMINI_MODEL;

  process.env.GEMINI_API_KEY = "secret-test-key";
  process.env.GEMINI_ENABLED = "true";
  process.env.GEMINI_MODEL = "gemini-test-model";

  try {
    const status = geminiPublicStatus();
    assert.equal(status.configured, true);
    assert.equal(status.enabled, true);
    assert.equal(status.model, "gemini-test-model");
    assert.equal("apiKey" in status, false);
    assert.equal(JSON.stringify(status).includes("secret-test-key"), false);
  } finally {
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
    if (previousEnabled === undefined) delete process.env.GEMINI_ENABLED;
    else process.env.GEMINI_ENABLED = previousEnabled;
    if (previousModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = previousModel;
  }
});
