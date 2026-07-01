import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLocalIntentResponse,
  buildGeminiConversationMessage,
  isMessageWebhookPayload,
  isWithinAiHours,
  keywordInText,
  normalizeIncomingWhatsappPayload,
  summarizeAiCommercialContext,
} from "../server/lib/whatsapp-ai-engine.js";

test("normalizes Baileys inbound webhook payload safely", () => {
  const normalized = normalizeIncomingWhatsappPayload({
    from: "5514996405496@s.whatsapp.net",
    text: "Oi, quero atendimento",
    isFromMe: false,
    timestamp: 1710000000,
    raw: { key: { id: "ABC123" } },
  });

  assert.equal(normalized.phoneNumber, "5514996405496");
  assert.equal(normalized.text, "Oi, quero atendimento");
  assert.equal(normalized.isFromMe, false);
  assert.equal(normalized.isGroup, false);
  assert.equal(normalized.messageId, "ABC123");
  assert.equal(isMessageWebhookPayload(normalized.raw), true);
});

test("extracts text from raw Baileys message when text field is absent", () => {
  const normalized = normalizeIncomingWhatsappPayload({
    raw: {
      key: {
        id: "RAW1",
        remoteJid: "5511999999999@s.whatsapp.net",
        fromMe: false,
      },
      message: {
        extendedTextMessage: { text: "Quais serviços vocês têm?" },
      },
    },
  });

  assert.equal(normalized.phoneNumber, "5511999999999");
  assert.equal(normalized.text, "Quais serviços vocês têm?");
  assert.equal(normalized.messageId, "RAW1");
});

test("uses explicit phone when Baileys remote JID is a LID", () => {
  const normalized = normalizeIncomingWhatsappPayload({
    from: "123456789012345@lid",
    phone: "5514996405496",
    text: "Teste privado",
    isFromMe: false,
    messageId: "LID1",
  });

  assert.equal(normalized.from, "123456789012345@lid");
  assert.equal(normalized.phoneNumber, "5514996405496");
  assert.equal(normalized.isGroup, false);
  assert.equal(normalized.messageId, "LID1");
});

test("extracts phone from raw.key.remoteJidAlt when remoteJid is a LID and phone is absent", () => {
  const normalized = normalizeIncomingWhatsappPayload({
    from: "123456789012345@lid",
    text: "Teste LID",
    isFromMe: false,
    messageId: "LID2",
    raw: {
      key: {
        id: "LID2",
        remoteJid: "123456789012345@lid",
        remoteJidAlt: "5514996405496@s.whatsapp.net",
        fromMe: false
      }
    }
  });

  assert.equal(normalized.from, "123456789012345@lid");
  assert.equal(normalized.phoneNumber, "5514996405496");
  assert.equal(normalized.isGroup, false);
  assert.equal(normalized.messageId, "LID2");
});

test("detects keywords ignoring accents and casing", () => {
  assert.equal(keywordInText("Quero falar com ATENDENTE agora", "atendente"), true);
  assert.equal(keywordInText("Pode voltar ao bot por favor?", "voltar ao bot"), true);
  assert.equal(keywordInText("Sem palavra especial", "atendente"), false);
});

test("checks AI service hours in Sao Paulo timezone", () => {
  const settings = {
    allow24h: false,
    aiStartTime: "09:00",
    aiEndTime: "18:00",
    timezone: "America/Sao_Paulo",
  };

  assert.equal(isWithinAiHours(settings, new Date("2026-06-24T15:00:00.000Z")), true);
  assert.equal(isWithinAiHours(settings, new Date("2026-06-24T23:00:00.000Z")), false);
  assert.equal(isWithinAiHours({ ...settings, allow24h: true }, new Date("2026-06-24T23:00:00.000Z")), true);
});

test("summarizes only real AI-enabled commercial data", () => {
  const context = summarizeAiCommercialContext({
    services: [
      {
        name: "Fita",
        commercial_name: "Mega Hair Fita",
        active: true,
        ai_active: true,
        base_price: 950,
        duration_minutes: 210,
      },
      {
        name: "Serviço interno",
        active: true,
        ai_active: false,
        base_price: 1,
      },
    ],
    plans: [{ name: "Gold", active: true, price: 599, billing_cycle: "monthly" }],
    coupons: [{ code: "CAROL15", active: true, description: "15% em produtos" }],
  });

  assert.match(context, /Mega Hair Fita/);
  assert.match(context, /R\$ 950\.00/);
  assert.match(context, /Gold/);
  assert.match(context, /CAROL15/);
  assert.doesNotMatch(context, /Serviço interno/);
});

test("builds Gemini message without leaking sensitive environment names", () => {
  const prompt = buildGeminiConversationMessage({
    incomingText: "Tem horário amanhã?",
    knownClient: true,
    commercialContext: "Serviços: nenhum serviço foi liberado.",
    history: [{ sender_type: "client", body: "Oi" }],
  });

  assert.match(prompt, /não crie agendamento/i);
  assert.match(prompt, /Cliente já cadastrada: sim/);
  assert.doesNotMatch(prompt, /GEMINI_API_KEY/i);
  assert.doesNotMatch(prompt, /BAILEYS_API_KEY/i);
});

test("builds local response for today's availability without promising schedule", () => {
  const response = buildLocalIntentResponse("Tem horário disponível pra hj?", {});

  assert.match(response, /horário de hoje/i);
  assert.match(response, /não vou prometer disponibilidade/i);
  assert.match(response, /agenda real/i);
  assert.match(response, /manhã, tarde ou noite/i);
});

test("routes fibra russa questions to the AI provider instead of a fixed local reply", () => {
  const response = buildLocalIntentResponse("Você faz aplicação de fibra russa?", {
    services: [
      {
        name: "Aplicação Fibra Russa",
        commercial_name: "Fibra Russa",
        active: true,
        ai_active: true,
      },
    ],
  });

  assert.equal(response, null);
});
