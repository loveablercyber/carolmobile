import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  aiWhatsappTables,
  buildRuntimePrompt,
  defaultAiSettings,
  normalizeAiFlowSettingsInput,
  normalizeAiServiceSettingsInput,
  normalizeAiSettingsInput,
} from "../server/lib/ai-whatsapp.js";

test("static AI WhatsApp migration includes runtime hardening tables and router columns", () => {
  const migration = readFileSync(
    new URL("../database/neon-ai-whatsapp.sql", import.meta.url),
    "utf8",
  );
  const adminScript = readFileSync(
    new URL("../scripts/neon-admin.mjs", import.meta.url),
    "utf8",
  );
  const providerMigration = readFileSync(
    new URL("../database/neon-gemini-groq-only.sql", import.meta.url),
    "utf8",
  );
  const humanResumeMigration = readFileSync(
    new URL("../database/neon-ai-human-auto-resume.sql", import.meta.url),
    "utf8",
  );
  for (const table of [
    "whatsapp_incoming_queue",
    "ai_request_logs",
    "knowledge_articles",
    "marketing_promotions",
  ]) {
    assert.ok(aiWhatsappTables.includes(table));
    assert.match(
      migration,
      new RegExp(`create table if not exists public\\.${table}\\b`, "i"),
    );
    assert.match(adminScript, new RegExp(`"${table}"`));
  }
  for (const column of [
    "primary_provider",
    "fallback_provider",
    "grouping_window_ms",
    "circuit_breaker_cooldown_seconds",
    "gemini_circuit_breaker_until",
    "groq_circuit_breaker_until",
    "auto_resume_after_human_enabled",
    "human_response_timeout_minutes",
  ]) {
    assert.match(
      migration,
      new RegExp(`add column if not exists ${column}\\b`, "i"),
    );
  }
  assert.match(migration, /provider text not null default 'gemini'/i);
  assert.match(migration, /model text not null default 'gemini-3\.5-flash-lite'/i);
  assert.match(providerMigration, /set status='ai', ai_enabled=true/i);
  assert.match(providerMigration, /drop column if exists openai_api_key/i);
  assert.match(adminScript, /015_gemini_groq_only/i);
  assert.match(adminScript, /016_ai_human_auto_resume/i);
  assert.match(humanResumeMigration, /human_takeover_at/i);
});

test("automatic message limit is scoped to the current AI session", () => {
  const engine = readFileSync(
    new URL("../server/lib/whatsapp-ai-engine.js", import.meta.url),
    "utf8",
  );
  const api = readFileSync(
    new URL("../api/ai-whatsapp.js", import.meta.url),
    "utf8",
  );

  assert.match(engine, /greatest\([\s\S]*resumed_at from latest_resume[\s\S]*session_started_at from public\.whatsapp_conversations/i);
  assert.match(engine, /idleExpired[\s\S]*set session_started_at=\$2/i);
  assert.match(engine, /status='ai',ai_enabled=true[\s\S]{0,140}session_started_at=now\(\)/i);
  assert.match(api, /status='ai',ai_enabled=true[\s\S]{0,140}session_started_at=now\(\)/i);
});

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
      autoResumeAfterHumanEnabled: "true",
      humanResponseTimeoutMinutes: "30",
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
  assert.equal(normalized.autoResumeAfterHumanEnabled, true);
  assert.equal(normalized.humanResponseTimeoutMinutes, 30);
  assert.equal(normalized.aiStartTime, "08:30");
  assert.equal(normalized.aiEndTime, "18:00");
  assert.equal(normalized.primaryProvider, "gemini");
  assert.equal(normalized.primaryModel, normalized.model);
  assert.equal(normalized.fallbackProvider, "groq");
  assert.equal(normalized.fallbackEnabled, true);
});

test("preserves the configured fallback model independently from the primary model", () => {
  const normalized = normalizeAiSettingsInput({
    ...defaultAiSettings(),
    model: "primary-model",
    primaryModel: "primary-model",
    fallbackModel: "fallback-model",
  });
  assert.equal(normalized.primaryModel, "primary-model");
  assert.equal(normalized.fallbackModel, "fallback-model");
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
  assert.match(prompt, /Um número só representa a opção definida pelo estado atual do backend/);
  assert.match(prompt, /Diferencie conhecimento educativo de oferta comercial/i);
  assert.match(prompt, /realização pelo salão precisa ser confirmada/i);
  assert.doesNotMatch(prompt, /Se o usuário digitar a opção "3"/);
  assert.doesNotMatch(prompt, /GEMINI_API_KEY/i);
  assert.doesNotMatch(prompt, /apiKey/i);
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
