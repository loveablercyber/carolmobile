import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { pool } from "../server/lib/db.js";
import {
  findEvaluationService,
  selectBookingService,
  detectBookingGlobalCommand,
  processIncomingWhatsAppWebhook,
} from "../server/lib/whatsapp-ai-engine.js";
import { updateAiConversationStatus, invalidateAiSettingsCache, invalidateAiBaseCache } from "../server/lib/ai-whatsapp.js";

const originalQuery = pool.query;
const originalConnect = pool.connect;
const originalFetch = globalThis.fetch;

afterEach(() => {
  pool.query = originalQuery;
  pool.connect = originalConnect;
  globalThis.fetch = originalFetch;
  invalidateAiSettingsCache();
  invalidateAiBaseCache();
});

test("findEvaluationService matches exact evaluation service names and avoids description matching or fallback", () => {
  const mockServices = [
    {
      id: "srv-1",
      name: "Ponto Americano Invisível",
      commercial_name: "Ponto Americano",
      description: "Técnica de mega hair que requer avaliação prévia.",
      detailed_description: "Exige avaliação antes da aplicação.",
      active: true,
      ai_active: true,
      allow_auto_booking: true,
    },
    {
      id: "srv-eval",
      name: "Avaliação Presencial Mega Hair",
      commercial_name: "Avaliação Gratuita",
      description: "Diagnóstico completo dos fios.",
      active: true,
      ai_active: true,
      allow_auto_booking: true,
    },
  ];

  const found = findEvaluationService(mockServices);
  assert.ok(found);
  assert.equal(found.id, "srv-eval");
  assert.equal(found.name, "Avaliação Presencial Mega Hair");
});

test("findEvaluationService returns null when no evaluation service exists (no fallback to bookable[0])", () => {
  const mockServicesNoEval = [
    {
      id: "srv-1",
      name: "Manutenção de Fita Adesiva",
      commercial_name: "Manutenção Fita",
      description: "Requer avaliação prévia do salão.",
      active: true,
    },
  ];

  const found = findEvaluationService(mockServicesNoEval);
  assert.equal(found, null);
});

test("selectBookingService does not pick service with 'requer avaliação' in description as Evaluation", () => {
  const mockBase = {
    services: [
      {
        id: "srv-ponto",
        name: "Ponto Americano Invisível",
        commercial_name: "Ponto Americano",
        description: "Serviço que requer avaliação prévia.",
        detailed_description: "Descrição com palavra avaliação.",
        active: true,
        ai_active: true,
        allow_auto_booking: true,
        priority_order: 10,
      },
    ],
  };

  const selected = selectBookingService("Quero fazer uma avaliação", mockBase, {});
  // Should return null because no real evaluation service exists in mockBase
  assert.equal(selected, null);
});

test("detectBookingGlobalCommand identifies cancellation and handoff commands correctly", () => {
  assert.equal(detectBookingGlobalCommand("cancelar"), "cancel");
  assert.equal(detectBookingGlobalCommand("quero cancelar agendamento"), "cancel");
  assert.equal(detectBookingGlobalCommand("não quero mais"), "cancel");
  assert.equal(detectBookingGlobalCommand("falar com atendente"), "handoff");
  assert.equal(detectBookingGlobalCommand("chamar atendente"), "handoff");
  assert.equal(detectBookingGlobalCommand("voltar"), "back");
  assert.equal(detectBookingGlobalCommand("menu"), "main_menu");
});

test("updateAiConversationStatus correctly sets status and ai_enabled for pause_ai and resume_ai", async () => {
  const calls = [];
  pool.query = async (text, params) => {
    calls.push({ text, params });
    if (text.includes("whatsapp_conversations")) {
      return {
        rows: [
          {
            id: params[0],
            phone_number: "5514999999999",
            status: params[1],
            ai_enabled: params[2],
            last_message_at: new Date().toISOString(),
          },
        ],
      };
    }
    return { rows: [] };
  };
  pool.connect = async () => ({
    query: async (sql, params = []) => pool.query(sql, params),
    release: () => {},
  });

  const paused = await updateAiConversationStatus(
    { id: "00000000-0000-0000-0000-000000000001", role: "admin" },
    { conversationId: "00000000-0000-0000-0000-000000000002", action: "pause_ai" },
  );

  assert.equal(paused.status, "human");
  assert.equal(paused.ai_enabled, false);

  const resumed = await updateAiConversationStatus(
    { id: "00000000-0000-0000-0000-000000000001", role: "admin" },
    { conversationId: "00000000-0000-0000-0000-000000000002", action: "resume_ai" },
  );

  assert.equal(resumed.status, "ai");
  assert.equal(resumed.ai_enabled, true);
});

test("bot skips response when conversation is in human status", async () => {
  invalidateAiSettingsCache();
  invalidateAiBaseCache();
  pool.query = async (text) => {
    if (text.includes("ai_settings")) return { rows: [{ id: "set-1", business_id: "default", enabled: true }] };
    if (text.includes("whatsapp_incoming_queue")) {
      if (text.includes("select * from public.whatsapp_incoming_queue")) {
        return { rowCount: 1, rows: [{ id: "q-1", text: "Olá, preciso de ajuda" }] };
      }
      return { rowCount: 0, rows: [] };
    }
    if (text.includes("whatsapp_sessions")) return { rows: [] };
    if (text.includes("whatsapp_conversations")) {
      return {
        rows: [
          {
            id: "conv-human-1",
            phone_number: "5514999999999",
            status: "human",
            ai_enabled: false,
            booking_state: "{}",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      };
    }
    if (text.includes("insert into public.whatsapp_messages")) {
      return { rows: [{ id: "msg-human-1" }] };
    }
    return { rows: [] };
  };
  pool.connect = async () => ({
    query: async (sql, params = []) => pool.query(sql, params),
    release: () => {},
  });

  const result = await processIncomingWhatsAppWebhook({
    event: "MESSAGES_UPSERT",
    data: {
      key: { remoteJid: "5514999999999@s.whatsapp.net", fromMe: false, id: "msg-1" },
      message: { conversation: "Olá, preciso de ajuda" },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.replied, false);
  assert.equal(result.reason, "conversation_paused");
});

test("outbound echo from bot (fromMe=true matching outbox) is ignored without pausing AI", async () => {
  pool.query = async (text, params) => {
    if (text.includes("whatsapp_outbox_ids")) {
      return { rowCount: 1, rows: [{ id: "outbox-1" }] };
    }
    return { rows: [] };
  };
  pool.connect = async () => ({
    query: async (sql, params = []) => pool.query(sql, params),
    release: () => {},
  });

  const result = await processIncomingWhatsAppWebhook({
    event: "MESSAGES_UPSERT",
    data: {
      key: { remoteJid: "5514999999999@s.whatsapp.net", fromMe: true, id: "bot-msg-123" },
      message: { conversation: "Oi! Como posso te ajudar?" },
    },
  });

  assert.equal(result.ignored, true);
  assert.equal(result.reason, "bot_outbound_echo_ignored");
});

test("manual fromMe message written by human attendant pauses AI and records human takeover", async () => {
  const updates = [];
  pool.query = async (text, params) => {
    if (text.includes("whatsapp_outbox_ids")) {
      return { rowCount: 0, rows: [] }; // Not in outbox = human message
    }
    if (text.includes("whatsapp_sessions")) return { rows: [] };
    if (text.includes("whatsapp_conversations")) {
      if (text.includes("update")) updates.push({ text, params });
      return {
        rows: [
          {
            id: "conv-1",
            phone_number: "5514999999999",
            status: "human",
            ai_enabled: false,
          },
        ],
      };
    }
    if (text.includes("whatsapp_messages")) {
      return { rows: [{ id: "msg-human-1" }] };
    }
    return { rows: [] };
  };
  pool.connect = async () => ({
    query: async (sql, params = []) => pool.query(sql, params),
    release: () => {},
  });

  const result = await processIncomingWhatsAppWebhook({
    event: "MESSAGES_UPSERT",
    data: {
      key: { remoteJid: "5514999999999@s.whatsapp.net", fromMe: true, id: "human-manual-1" },
      message: { conversation: "Oi, Carol aqui! Vou dar sequencia ao seu atendimento." },
    },
  });

  assert.equal(result.ignored, true);
  assert.equal(result.reason, "human_message_recorded");
  assert.ok(updates.some((u) => u.text.includes("status='human'")));
});
