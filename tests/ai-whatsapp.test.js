import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRuntimePrompt,
  defaultAiSettings,
  normalizeAiFlowSettingsInput,
  normalizeAiServiceSettingsInput,
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

test("normalizes AI service settings using real service fallbacks", () => {
  const service = {
    id: "52000000-0000-0000-0000-000000000001",
    name: "Aplicação Fita Adesiva",
    description: "Aplicação premium personalizada.",
    active: true,
    base_price: 950,
    duration_minutes: 210,
    deposit_amount: 190,
  };

  const normalized = normalizeAiServiceSettingsInput(
    {
      serviceId: service.id,
      active: "true",
      commercialName: "Mega Hair Fita Premium",
      initialPrice: "980,50",
      estimatedDurationMinutes: "999",
      requiresDeposit: "true",
      depositType: "amount",
      depositValue: "200",
      allowAutoQuote: "true",
      allowAutoBooking: "false",
      priorityOrder: "0",
    },
    service,
  );

  assert.equal(normalized.serviceId, service.id);
  assert.equal(normalized.active, true);
  assert.equal(normalized.commercialName, "Mega Hair Fita Premium");
  assert.equal(normalized.initialPrice, 980.5);
  assert.equal(normalized.estimatedDurationMinutes, 720);
  assert.equal(normalized.requiresDeposit, true);
  assert.equal(normalized.depositValue, 200);
  assert.equal(normalized.allowAutoQuote, true);
  assert.equal(normalized.allowAutoBooking, false);
  assert.equal(normalized.priorityOrder, 1);
});

test("rejects enabling AI for inactive or malformed service", () => {
  assert.throws(
    () =>
      normalizeAiServiceSettingsInput(
        { serviceId: "not-a-uuid", active: true },
        { active: true },
      ),
    /Serviço inválido/,
  );

  assert.throws(
    () =>
      normalizeAiServiceSettingsInput(
        {
          serviceId: "52000000-0000-4000-8000-000000000001",
          active: true,
        },
        {
          id: "52000000-0000-4000-8000-000000000001",
          active: false,
          name: "Serviço inativo",
        },
      ),
    /serviço inativo/i,
  );
});

test("normalizes AI automation flow settings", () => {
  const normalized = normalizeAiFlowSettingsInput(
    {
      flowKey: "consulta_valores",
      enabled: "true",
      requiresHumanApproval: "false",
      triggerDelayMinutes: "9999",
    },
    {
      flow_key: "consulta_valores",
      enabled: false,
      requires_human_approval: true,
      trigger_delay_minutes: 10,
    },
  );

  assert.equal(normalized.flowKey, "consulta_valores");
  assert.equal(normalized.enabled, true);
  assert.equal(normalized.requiresHumanApproval, false);
  assert.equal(normalized.triggerDelayMinutes, 1440);
});

test("rejects malformed AI automation flow key", () => {
  assert.throws(
    () => normalizeAiFlowSettingsInput({ flowKey: "../consulta", enabled: true }),
    /Fluxo inv/i,
  );
});
