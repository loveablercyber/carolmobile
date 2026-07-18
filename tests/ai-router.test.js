import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { getGeminiKeys } from "../server/lib/gemini-client.js";
import { generateGroqText, getGroqKeys } from "../server/lib/groq-client.js";
import { pool } from "../server/lib/db.js";
import { processIncomingWhatsAppWebhook } from "../server/lib/whatsapp-ai-engine.js";
import { invalidateAiBaseCache, invalidateAiSettingsCache } from "../server/lib/ai-whatsapp.js";

// Save original objects
const originalQuery = pool.query;
const originalConnect = pool.connect;
const originalFetch = globalThis.fetch;

const envBackup = {};

function futureDateKey(days = 7) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

beforeEach(() => {
  // Backup relevant env vars
  const envKeys = [
    "GEMINI_API_KEY", "GEMINI_ENABLED", "GEMINI_MODEL",
    "GROQ_API_KEY", "GROQ_ENABLED", "GROQ_MODEL",
    "OPENAI_API_KEY", "OPENAI_ENABLED", "OPENAI_MODEL",
    "GEMINI_API_KEY_1", "GEMINI_API_KEY_2",
    "GROQ_API_KEY_1", "GROQ_API_KEY_2"
  ];
  for (const key of envKeys) {
    envBackup[key] = process.env[key];
    delete process.env[key];
  }
  invalidateAiSettingsCache();
  invalidateAiBaseCache();
});

afterEach(() => {
  // Restore env vars
  for (const [key, val] of Object.entries(envBackup)) {
    if (val === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = val;
    }
  }
  // Restore db & fetch mocks
  pool.query = originalQuery;
  pool.connect = originalConnect;
  globalThis.fetch = originalFetch;
});

test("getGeminiKeys reads comma-separated and numbered variables correctly", () => {
  process.env.GEMINI_API_KEY = "keyA, keyB,keyA"; // comma-separated and duplicates
  process.env.GEMINI_API_KEY_1 = "keyC";
  process.env.GEMINI_API_KEY_2 = "keyB"; // duplicate of keyB
  process.env.GEMINI_API_KEY_3 = "keyD";

  const keys = getGeminiKeys();
  assert.deepEqual(keys, ["keyA", "keyB", "keyC", "keyD"]);
});

test("getGroqKeys reads comma-separated and numbered variables correctly", () => {
  process.env.GROQ_API_KEY = "gkey1,gkey2";
  process.env.GROQ_API_KEY_1 = "gkey3";
  process.env.GROQ_API_KEY_5 = "gkey5"; // check sparse index

  const keys = getGroqKeys();
  assert.deepEqual(keys, ["gkey1", "gkey2", "gkey3", "gkey5"]);
});

test("generateGroqText rotates numbered keys between calls", async () => {
  process.env.GROQ_ENABLED = "true";
  process.env.GROQ_API_KEY = "gkey-primary";
  process.env.GROQ_API_KEY_1 = "gkey-secondary";
  const authorizations = [];

  globalThis.fetch = async (_url, options) => {
    authorizations.push(options.headers.Authorization);
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "Resposta Groq" } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  await generateGroqText({ systemPrompt: "Sistema", message: "Mensagem" });
  await generateGroqText({ systemPrompt: "Sistema", message: "Mensagem" });

  assert.equal(new Set(authorizations).size, 2);
});

test("processIncomingWhatsAppWebhook opens the backend service catalog on greeting", async () => {
  const mockSettings = {
    id: "settings-123",
    business_id: "default",
    enabled: true,
    welcome_message: "Olá! Bem-vindo ao Carol Sol PWA.",
    timezone: "America/Sao_Paulo",
    allow_24h: true,
    cache_enabled: true,
    max_auto_messages: 10,
    grouping_window_ms: 1, // fast execution
    allow_new_contacts: true,
    allow_existing_clients: true,
  };

  const queue = [];
  const sentTexts = [];

  pool.query = async (text, params) => {
    if (text.includes("insert into public.whatsapp_incoming_queue")) {
      queue.push({ id: "queue-id-1", phone_number: params[0], message_id: params[1], text: params[2], processed: false });
      return { rowCount: 1, rows: [{ id: "queue-id-1" }] };
    }
    if (text.includes("whatsapp_incoming_queue") && text.includes("select")) {
      if (text.includes("processed = false")) {
        const pending = queue.filter(item => item.phone_number === params[0] && !item.processed);
        return { rowCount: pending.length, rows: pending };
      }
      // duplicate check
      const isDup = queue.some(item => item.message_id === params[0]);
      return { rowCount: isDup ? 1 : 0, rows: isDup ? [{ 1: 1 }] : [] };
    }
    if (text.includes("update public.whatsapp_incoming_queue")) {
      for (const item of queue) {
        item.processed = true;
      }
      return { rowCount: queue.length, rows: [] };
    }
    if (text.includes("ai_settings") && text.includes("select")) {
      return { rowCount: 1, rows: [mockSettings] };
    }
    if (text.includes("select s.id,s.category_id") && text.includes("from public.services s")) {
      return {
        rowCount: 2,
        rows: [
          { id: "service-1", name: "Ponto Americano", active: true, show_online_booking: true, category_id: "cat-1", hair_method_id: "method-1" },
          { id: "service-2", name: "Avaliacao personalizada", active: true, show_online_booking: true, category_id: "cat-1", hair_method_id: "method-2", is_free: true },
        ],
      };
    }
    if (text.includes("from public.service_categories")) {
      return { rowCount: 1, rows: [{ id: "cat-1", name: "Mega Hair" }] };
    }
    if (text.includes("from public.hair_methods")) {
      return { rowCount: 2, rows: [{ id: "method-1", name: "Aplicacao", category_id: "cat-1" }, { id: "method-2", name: "Avaliacao", category_id: "cat-1" }] };
    }
    if (text.includes("whatsapp_conversations") && text.includes("select")) {
      return { rowCount: 1, rows: [{ id: "conv-456", status: "ai", ai_enabled: true, booking_state: JSON.stringify({ status: "booked" }) }] };
    }
    if (text.includes("whatsapp_messages") && text.includes("select") && text.includes("count")) {
      return { rowCount: 1, rows: [{ total: 0 }] };
    }
    if (text.includes("public.clients") && text.includes("select")) {
      return { rowCount: 0, rows: [] };
    }
    return { rowCount: 1, rows: [{ id: "inserted-id" }] };
  };

  pool.connect = async () => {
    return {
      query: pool.query,
      release: () => {},
    };
  };

  // Mock Baileys client text sending & status check
  globalThis.fetch = async (url, options) => {
    if (url.includes("/api/status")) {
      return new Response(JSON.stringify({ success: true, status: "ready" }));
    }
    if (url.includes("/api/send-text")) {
      sentTexts.push(JSON.parse(options.body || "{}").text || "");
      return new Response(JSON.stringify({ success: true, messageId: "baileys-msg-abc" }));
    }
    if (url.includes("/api/presence")) {
      return new Response(JSON.stringify({ success: true }));
    }
    return new Response(JSON.stringify({ success: false }));
  };

  process.env.BAILEYS_API_URL = "https://baileys.example.com";
  process.env.BAILEYS_API_KEY = "test-key";

  const payload = {
    from: "5511999999999@s.whatsapp.net",
    text: "Oi", // Simple greeting to trigger template response
    isFromMe: false,
    messageId: "msg-greeter-1",
  };

  const result = await processIncomingWhatsAppWebhook(payload);
  assert.equal(result.ok, true);
  assert.equal(result.replied, true);
  assert.equal(result.reason, "booking_initial_category_catalog");
  assert.match(sentTexts.at(-1), /Mega Hair/);
  assert.doesNotMatch(sentTexts.at(-1), /Ponto Americano/);
  assert.doesNotMatch(sentTexts.at(-1), /Avaliacao personalizada/);
});

test("processIncomingWhatsAppWebhook uses OpenAI as the only generative provider", async () => {
  let geminiCalled = false;
  let groqCalled = false;
  let openAiCalled = false;

  const mockSettings = {
    id: "settings-123",
    business_id: "default",
    enabled: true,
    welcome_message: "Olá! Bem-vindo.",
    timezone: "America/Sao_Paulo",
    allow_24h: true,
    cache_enabled: true,
    max_auto_messages: 10,
    grouping_window_ms: 1,
    primary_provider: "gemini",
    primary_model: "gemini-2.5-flash-lite",
    fallback_provider: "groq",
    fallback_model: "llama-3.1-8b-instant",
    fallback_enabled: true,
    max_retries: 0, // no retry delay for tests
    timeout_ms: 1000,
    circuit_breaker_cooldown_seconds: 60,
    allow_new_contacts: true,
    allow_existing_clients: true,
  };

  const queue = [];

  pool.query = async (text, params) => {
    if (text.includes("insert into public.whatsapp_incoming_queue")) {
      queue.push({ id: "queue-id-2", phone_number: params[0], message_id: params[1], text: params[2], processed: false });
      return { rowCount: 1, rows: [{ id: "queue-id-2" }] };
    }
    if (text.includes("whatsapp_incoming_queue") && text.includes("select")) {
      if (text.includes("processed = false")) {
        const pending = queue.filter(item => item.phone_number === params[0] && !item.processed);
        return { rowCount: pending.length, rows: pending };
      }
      const isDup = queue.some(item => item.message_id === params[0]);
      return { rowCount: isDup ? 1 : 0, rows: isDup ? [{ 1: 1 }] : [] };
    }
    if (text.includes("update public.whatsapp_incoming_queue")) {
      for (const item of queue) {
        item.processed = true;
      }
      return { rowCount: queue.length, rows: [] };
    }
    if (text.includes("ai_settings") && text.includes("select")) {
      return { rowCount: 1, rows: [mockSettings] };
    }
    if (text.includes("whatsapp_conversations") && text.includes("select")) {
      return { rowCount: 1, rows: [{ id: "conv-456", status: "ai", ai_enabled: true, booking_state: JSON.stringify({ status: "booked" }) }] };
    }
    if (text.includes("whatsapp_messages") && text.includes("select") && text.includes("count")) {
      return { rowCount: 1, rows: [{ total: 0 }] };
    }
    if (text.includes("whatsapp_messages") && text.includes("select") && text.includes("direction")) {
      return { rowCount: 0, rows: [] };
    }
    if (text.includes("public.clients") && text.includes("select")) {
      return { rowCount: 0, rows: [] };
    }
    return { rowCount: 1, rows: [{ id: "inserted-id" }] };
  };

  pool.connect = async () => {
    return {
      query: pool.query,
      release: () => {},
    };
  };

  // Mock API services: Gemini and Groq
  globalThis.fetch = async (url, options) => {
    // Baileys status/sending/presence
    if (url.includes("/api/status")) {
      return new Response(JSON.stringify({ success: true, status: "ready" }));
    }
    if (url.includes("/api/send-text")) {
      return new Response(JSON.stringify({ success: true, messageId: "baileys-msg-fallback" }));
    }
    if (url.includes("/api/presence")) {
      return new Response(JSON.stringify({ success: true }));
    }

    // Gemini API
    if (url.includes("generativelanguage.googleapis.com")) {
      geminiCalled = true;
      // Simulate 429 Rate Limit
      return new Response(JSON.stringify({
        error: { message: "Quota exceeded for model gemini-2.5-flash-lite." }
      }), { status: 429, headers: { "content-type": "application/json" } });
    }

    if (url.includes("api.groq.com")) {
      groqCalled = true;
      return new Response(JSON.stringify({ success: false }), { status: 500 });
    }

    if (url.includes("api.openai.com/v1/chat/completions")) {
      openAiCalled = true;
      return new Response(JSON.stringify({
        id: "resp_test",
        choices: [{ message: { role: "assistant", content: "Resposta inteligente da OpenAI." } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 }
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    return new Response(JSON.stringify({ success: false }));
  };

  process.env.BAILEYS_API_URL = "https://baileys.example.com";
  process.env.BAILEYS_API_KEY = "test-key";
  process.env.OPENAI_ENABLED = "true";
  process.env.OPENAI_API_KEY = "openai-key";
  process.env.OPENAI_MODEL = "gpt-5.4-mini";

  const payload = {
    from: "5511999999999@s.whatsapp.net",
    text: "Qual o valor do Mega Hair de fita adesiva?", // Non-simple text to trigger AI
    isFromMe: false,
    messageId: "msg-fallback-test-1",
  };

  const result = await processIncomingWhatsAppWebhook(payload);
  assert.equal(result.ok, true);
  assert.equal(result.replied, true);
  assert.equal(result.reason, "openai_reply");
  assert.equal(openAiCalled, true);
  assert.equal(geminiCalled, false);
  assert.equal(groqCalled, false);
});

test("processIncomingWhatsAppWebhook blocks out-of-scope questions before OpenAI", async () => {
  let openAiCalled = false;
  const sentTexts = [];
  const mockSettings = {
    id: "settings-scope",
    business_id: "default",
    enabled: true,
    welcome_message: "Olá! Bem-vindo.",
    timezone: "America/Sao_Paulo",
    allow_24h: true,
    cache_enabled: true,
    max_auto_messages: 10,
    grouping_window_ms: 1,
    allow_new_contacts: true,
    allow_existing_clients: true,
    primary_provider: "openai",
    primary_model: "gpt-5.4-mini",
    fallback_provider: "openai",
    fallback_model: "gpt-5.4-mini",
    fallback_enabled: false,
    max_retries: 0,
    timeout_ms: 1000,
  };
  const queue = [];

  pool.query = async (text, params = []) => {
    if (text.includes("insert into public.whatsapp_incoming_queue")) {
      queue.push({ id: "queue-id-scope", phone_number: params[0], message_id: params[1], text: params[2], processed: false });
      return { rowCount: 1, rows: [{ id: "queue-id-scope" }] };
    }
    if (text.includes("whatsapp_incoming_queue") && text.includes("select")) {
      if (text.includes("processed = false")) {
        const pending = queue.filter(item => item.phone_number === params[0] && !item.processed);
        return { rowCount: pending.length, rows: pending };
      }
      const isDup = queue.some(item => item.message_id === params[0]);
      return { rowCount: isDup ? 1 : 0, rows: isDup ? [{ 1: 1 }] : [] };
    }
    if (text.includes("update public.whatsapp_incoming_queue")) {
      for (const item of queue) item.processed = true;
      return { rowCount: queue.length, rows: [] };
    }
    if (text.includes("ai_settings") && text.includes("select")) return { rowCount: 1, rows: [mockSettings] };
    if (text.includes("from public.whatsapp_sessions")) return { rowCount: 1, rows: [{ id: "session-id", professional_id: null }] };
    if (text.includes("from public.whatsapp_conversations") && text.includes("where phone_number")) {
      return { rowCount: 1, rows: [{ id: "conv-scope", status: "ai", ai_enabled: true, booking_state: JSON.stringify({ status: "booked" }), client_id: null }] };
    }
    if (text.includes("select id from public.whatsapp_conversations") && text.includes("for update")) {
      return { rowCount: 1, rows: [{ id: "conv-scope" }] };
    }
    if (text.includes("insert into public.whatsapp_messages")) return { rowCount: 1, rows: [{ id: "msg-scope" }] };
    if (text.includes("update public.whatsapp_conversations")) return { rowCount: 1, rows: [] };
    if (text.includes("whatsapp_messages") && text.includes("select") && text.includes("count")) return { rowCount: 1, rows: [{ total: 0 }] };
    if (text.includes("from public.clients c") && text.includes("regexp_replace")) return { rowCount: 0, rows: [] };
    if (text.includes("select s.id,s.name") && text.includes("ai_service_settings")) return { rowCount: 0, rows: [] };
    if (text.includes("from public.ai_automation_flows") && text.includes("order by name")) return { rowCount: 0, rows: [] };
    if (text.includes("from public.knowledge_articles")) return { rowCount: 0, rows: [] };
    if (text.includes("from public.plans") || text.includes("from public.coupons") || text.includes("from public.marketing_promotions")) return { rowCount: 0, rows: [] };
    return { rowCount: 1, rows: [{ id: "generic-id" }] };
  };

  pool.connect = async () => ({ query: pool.query, release: () => {} });
  globalThis.fetch = async (url, options = {}) => {
    if (url.includes("/api/send-text")) {
      const body = JSON.parse(options.body || "{}");
      sentTexts.push(body.text || "");
      return new Response(JSON.stringify({ success: true, messageId: "baileys-scope" }));
    }
    if (url.includes("/api/presence")) return new Response(JSON.stringify({ success: true }));
    if (url.includes("api.openai.com/v1/chat/completions")) {
      openAiCalled = true;
      return new Response(JSON.stringify({ choices: [] }), { status: 200 });
    }
    return new Response(JSON.stringify({ success: true, status: "ready" }));
  };

  process.env.BAILEYS_API_URL = "https://baileys.example.com";
  process.env.BAILEYS_API_KEY = "test-key";
  process.env.OPENAI_ENABLED = "true";
  process.env.OPENAI_API_KEY = "openai-key";
  process.env.OPENAI_MODEL = "gpt-5.4-mini";

  const result = await processIncomingWhatsAppWebhook({
    from: "5511999999999@s.whatsapp.net",
    text: "Me passa uma receita de bolo",
    isFromMe: false,
    messageId: "msg-scope-guard-1",
  });

  assert.equal(result.ok, true);
  assert.equal(result.reason, "out_of_scope_guard");
  assert.equal(openAiCalled, false);
  assert.equal(sentTexts.some(text => text.includes("Mega Hair")), true);
});

test("processIncomingWhatsAppWebhook persists a booking request before replying to confirmation", async () => {
  let geminiCalled = false;
  let groqCalled = false;
  let openAiCalled = false;
  let bookingTicketCreated = false;

  // Set Circuit Breaker active until a future date
  const futureCb = new Date(Date.now() + 30000).toISOString();
  const mockSettings = {
    id: "settings-123",
    business_id: "default",
    enabled: true,
    welcome_message: "Olá!",
    timezone: "America/Sao_Paulo",
    allow_24h: true,
    cache_enabled: true,
    max_auto_messages: 10,
    grouping_window_ms: 1,
    primary_provider: "gemini",
    primary_model: "gemini-2.5-flash-lite",
    fallback_provider: "groq",
    fallback_model: "llama-3.1-8b-instant",
    fallback_enabled: true,
    max_retries: 0,
    timeout_ms: 1000,
    gemini_circuit_breaker_until: futureCb,
    allow_new_contacts: true,
    allow_existing_clients: true,
  };

  const queue = [];

  pool.query = async (text, params) => {
    if (text.includes("insert into public.whatsapp_incoming_queue")) {
      queue.push({ id: "queue-id-3", phone_number: params[0], message_id: params[1], text: params[2], processed: false });
      return { rowCount: 1, rows: [{ id: "queue-id-3" }] };
    }
    if (text.includes("whatsapp_incoming_queue") && text.includes("select")) {
      if (text.includes("processed = false")) {
        const pending = queue.filter(item => item.phone_number === params[0] && !item.processed);
        return { rowCount: pending.length, rows: pending };
      }
      const isDup = queue.some(item => item.message_id === params[0]);
      return { rowCount: isDup ? 1 : 0, rows: isDup ? [{ 1: 1 }] : [] };
    }
    if (text.includes("update public.whatsapp_incoming_queue")) {
      for (const item of queue) {
        item.processed = true;
      }
      return { rowCount: queue.length, rows: [] };
    }
    if (text.includes("ai_settings") && text.includes("select")) {
      return { rowCount: 1, rows: [mockSettings] };
    }
    if (text.includes("whatsapp_conversations") && text.includes("select")) {
      return { rowCount: 1, rows: [{ id: "conv-456", status: "ai", ai_enabled: true, booking_state: JSON.stringify({ status: "booked" }) }] };
    }
    if (text.includes("whatsapp_messages") && text.includes("select") && text.includes("count")) {
      return { rowCount: 1, rows: [{ total: 0 }] };
    }
    if (text.includes("whatsapp_messages") && text.includes("select") && text.includes("direction")) {
      return {
        rowCount: 1,
        rows: [
          {
            direction: "outbound",
            sender_type: "ai",
            body: "Resumo: aplicação na sexta à tarde. Posso registrar esta solicitação?",
          },
        ],
      };
    }
    if (text.includes("insert into public.human_handoff_tickets")) {
      bookingTicketCreated = true;
      return { rowCount: 1, rows: [{ id: "ticket-booking" }] };
    }
    if (text.includes("public.clients") && text.includes("select")) {
      return { rowCount: 0, rows: [] };
    }
    return { rowCount: 1, rows: [{ id: "inserted-id" }] };
  };

  pool.connect = async () => {
    return {
      query: pool.query,
      release: () => {},
    };
  };

  globalThis.fetch = async (url, options) => {
    if (url.includes("/api/status")) {
      return new Response(JSON.stringify({ success: true, status: "ready" }));
    }
    if (url.includes("/api/send-text")) {
      return new Response(JSON.stringify({ success: true, messageId: "baileys-msg-cb" }));
    }
    if (url.includes("/api/presence")) {
      return new Response(JSON.stringify({ success: true }));
    }

    if (url.includes("generativelanguage.googleapis.com")) {
      geminiCalled = true;
      return new Response(JSON.stringify({ text: "Should not be called" }), { status: 200 });
    }

    if (url.includes("api.groq.com")) {
      groqCalled = true;
      return new Response(JSON.stringify({ success: false }), { status: 500 });
    }

    if (url.includes("api.openai.com/v1/chat/completions")) {
      openAiCalled = true;
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: "Solicitação registrada. A equipe confirmará a disponibilidade." } }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    return new Response(JSON.stringify({ success: false }));
  };

  process.env.BAILEYS_API_URL = "https://baileys.example.com";
  process.env.BAILEYS_API_KEY = "test-key";
  process.env.OPENAI_ENABLED = "true";
  process.env.OPENAI_API_KEY = "openai-key";
  process.env.OPENAI_MODEL = "gpt-5.4-mini";

  const payload = {
    from: "5511999999999@s.whatsapp.net",
    text: "Sim, pode registrar",
    isFromMe: false,
    messageId: "msg-cb-bypass-1",
  };

  const result = await processIncomingWhatsAppWebhook(payload);
  assert.equal(result.ok, true);
  assert.equal(result.replied, true);
  assert.equal(result.reason, "openai_reply");
  assert.equal(openAiCalled, true);
  assert.equal(bookingTicketCreated, true);
  assert.equal(geminiCalled, false);
  assert.equal(groqCalled, false);
});

test("processIncomingWhatsAppWebhook creates a real appointment for confirmed WhatsApp pre-booking", async () => {
  let openAiCalled = false;
  let appointmentCreated = false;
  let paymentCreated = false;
  let conversationLinked = false;
  const sentTexts = [];
  const queue = [];
  const ids = {
    conversation: "11111111-1111-4111-8111-111111111111",
    inbound: "22222222-2222-4222-8222-222222222222",
    service: "33333333-3333-4333-8333-333333333333",
    professional: "44444444-4444-4444-8444-444444444444",
    professionalProfile: "55555555-5555-4555-8555-555555555555",
    client: "66666666-6666-4666-8666-666666666666",
    clientProfile: "77777777-7777-4777-8777-777777777777",
    location: "88888888-8888-4888-8888-888888888888",
    appointment: "99999999-9999-4999-8999-999999999999",
    payment: "abababab-abab-4bab-8bab-abababababab",
  };
  const bookingState = {
    status: "awaiting_confirmation",
    serviceId: ids.service,
    serviceName: "Avaliação personalizada",
    requestedServiceName: "Aplicação de Mega Hair",
    date: futureDateKey(),
    time: "09:00",
    professionalId: ids.professional,
    professionalName: "Renata Moura",
    clientName: "Maria Silva",
    clientEmail: "maria@example.test",
    clientPhone: "5511999999999",
    clientCpf: "12345678901",
    clientBirthDate: "1990-05-10",
    serviceValue: 80,
  };
  const mockSettings = {
    id: "settings-booking",
    business_id: "default",
    enabled: true,
    welcome_message: "Olá!",
    after_hours_message: "Fora do horário.",
    human_handoff_message: "Vou chamar a equipe.",
    closing_message: "Obrigada.",
    timezone: "America/Sao_Paulo",
    allow_24h: true,
    cache_enabled: false,
    max_auto_messages: 12,
    grouping_window_ms: 1,
    allow_new_contacts: true,
    allow_existing_clients: true,
    allow_auto_booking: true,
    require_booking_confirmation: true,
    primary_provider: "openai",
    primary_model: "gpt-5.4-mini",
    fallback_provider: "openai",
    fallback_model: "gpt-5.4-mini",
    fallback_enabled: false,
    max_retries: 0,
    timeout_ms: 1000,
  };

  pool.query = async (text, params = []) => {
    if (text.includes("insert into public.whatsapp_incoming_queue")) {
      queue.push({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", phone_number: params[0], message_id: params[1], text: params[2], processed: false });
      return { rowCount: 1, rows: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }] };
    }
    if (text.includes("whatsapp_incoming_queue") && text.includes("select")) {
      if (text.includes("processed = false")) {
        const pending = queue.filter(item => item.phone_number === params[0] && !item.processed);
        return { rowCount: pending.length, rows: pending };
      }
      const isDup = queue.some(item => item.message_id === params[0]);
      return { rowCount: isDup ? 1 : 0, rows: isDup ? [{ 1: 1 }] : [] };
    }
    if (text.includes("update public.whatsapp_incoming_queue")) {
      for (const item of queue) item.processed = true;
      return { rowCount: queue.length, rows: [] };
    }
    if (text.includes("ai_settings") && text.includes("select")) {
      return { rowCount: 1, rows: [mockSettings] };
    }
    if (text.includes("from public.whatsapp_sessions")) {
      return { rowCount: 1, rows: [{ id: "session-id", professional_id: ids.professional }] };
    }
    if (text.includes("from public.whatsapp_conversations") && text.includes("where phone_number")) {
      return {
        rowCount: 1,
        rows: [{
          id: ids.conversation,
          phone_number: "5511999999999",
          status: "ai",
          ai_enabled: true,
          booking_state: bookingState,
          client_id: null,
          appointment_id: null,
        }],
      };
    }
    if (text.includes("select id from public.whatsapp_conversations") && text.includes("for update")) {
      return { rowCount: 1, rows: [{ id: ids.conversation }] };
    }
    if (text.includes("select id,appointment_id from public.whatsapp_conversations")) {
      return { rowCount: 1, rows: [{ id: ids.conversation, appointment_id: null }] };
    }
    if (text.includes("insert into public.whatsapp_messages")) {
      return { rowCount: 1, rows: [{ id: ids.inbound }] };
    }
    if (text.includes("update public.whatsapp_conversations")) {
      if (text.includes("appointment_id=$4")) {
        conversationLinked = true;
        assert.equal(params[4], ids.payment);
      }
      return { rowCount: 1, rows: [] };
    }
    if (text.includes("from public.clients c") && text.includes("regexp_replace")) {
      return { rowCount: 0, rows: [] };
    }
    if (text.includes("select id from auth.users where lower(email)=lower($1)")) {
      return { rowCount: 0, rows: [] };
    }
    if (text.includes("insert into auth.users")) {
      return { rowCount: 1, rows: [{ id: ids.clientProfile }] };
    }
    if (text.includes("insert into public.profiles")) {
      return { rowCount: 1, rows: [{ profile_id: ids.clientProfile, full_name: "Cliente WhatsApp 9999" }] };
    }
    if (text.includes("insert into public.clients")) {
      return { rowCount: 1, rows: [{ client_id: ids.client }] };
    }
    if (text.includes("from public.services where id=$1 and active")) {
      return {
        rowCount: 1,
        rows: [{ id: ids.service, name: "Avaliação personalizada", duration_minutes: 45, base_price: 80, deposit_amount: 30, active: true }],
      };
    }
    if (text.includes("from public.professionals p") && text.includes("where p.id=$1")) {
      return {
        rowCount: 1,
        rows: [{ id: ids.professional, profile_id: ids.professionalProfile, full_name: "Renata Moura" }],
      };
    }
    if (text.includes("public.professional_availability")) {
      return { rowCount: 1, rows: [{ starts_at: "08:00", ends_at: "18:00", active: true }] };
    }
    if (text.includes("conflicts limit 1")) {
      return { rowCount: 0, rows: [] };
    }
    if (text.includes("from public.salon_locations")) {
      return { rowCount: 1, rows: [{ id: ids.location }] };
    }
    if (text.includes("select uuid_generate_v4() as id")) {
      return { rowCount: 1, rows: [{ id: ids.appointment }] };
    }
    if (text.includes("insert into public.appointments")) {
      appointmentCreated = true;
      assert.equal(params[2], ids.client);
      assert.equal(params[3], ids.professional);
      assert.equal(params[4], ids.service);
      assert.equal(params[8], "awaiting_payment");
      assert.equal(params[9].includes("Pré-agendamento criado pela IA"), true);
      assert.equal(params[9].includes("maria@example.test"), true);
      assert.equal(params[10], 80);
      const intake = JSON.parse(params[11]);
      assert.equal(intake.contact.name, "Maria Silva");
      assert.equal(intake.contact.email, "maria@example.test");
      assert.equal(intake.contact.phone, "5511999999999");
      assert.equal(intake.contact.cpf, "12345678901");
      assert.equal(intake.contact.birthDate, "1990-05-10");
      assert.equal(intake.service_value, 80);
      return { rowCount: 1, rows: [] };
    }
    if (text.includes("insert into public.payments(")) {
      paymentCreated = true;
      assert.equal(params[0], ids.appointment);
      assert.equal(params[1], ids.client);
      assert.equal(params[2], 30);
      assert.equal(params[3], 30);
      assert.equal(params[5], "Sinal do agendamento");
      return { rowCount: 1, rows: [{ id: ids.payment }] };
    }
    if (text.includes("select s.id,s.name") && text.includes("ai_service_settings")) {
      return {
        rowCount: 1,
        rows: [{
          id: ids.service,
          name: "Avaliação personalizada",
          active: true,
          ai_active: true,
          commercial_name: "Avaliação personalizada",
          allow_auto_booking: true,
          priority_order: 1,
        }],
      };
    }
    if (text.includes("from public.ai_automation_flows") && text.includes("order by name")) {
      return {
        rowCount: 2,
        rows: [
          { flow_key: "pre_agendamento", name: "Pré-agendamento", enabled: true },
          { flow_key: "verificacao_agenda", name: "Verificação de agenda", enabled: true },
        ],
      };
    }
    if (text.includes("from public.knowledge_articles")) {
      return { rowCount: 0, rows: [] };
    }
    if (text.includes("from public.plans") || text.includes("from public.coupons") || text.includes("from public.marketing_promotions")) {
      return { rowCount: 0, rows: [] };
    }
    if (text.includes("whatsapp_messages") && text.includes("select") && text.includes("count")) {
      return { rowCount: 1, rows: [{ total: 0 }] };
    }
    return { rowCount: 1, rows: [{ id: "generic-id" }] };
  };
  pool.connect = async () => ({
    query: pool.query,
    release: () => {},
  });

  globalThis.fetch = async (url, options = {}) => {
    if (url.includes("/api/send-text")) {
      const body = JSON.parse(options.body || "{}");
      sentTexts.push(body.text || "");
      return new Response(JSON.stringify({ success: true, messageId: "baileys-booking-created" }));
    }
    if (url.includes("/api/presence")) {
      return new Response(JSON.stringify({ success: true }));
    }
    if (url.includes("api.openai.com")) {
      openAiCalled = true;
      return new Response(JSON.stringify({ output: [] }), { status: 200 });
    }
    return new Response(JSON.stringify({ success: true, status: "ready" }));
  };

  process.env.BAILEYS_API_URL = "https://baileys.example.com";
  process.env.BAILEYS_API_KEY = "test-key";
  process.env.OPENAI_ENABLED = "true";
  process.env.OPENAI_API_KEY = "openai-key";
  process.env.OPENAI_MODEL = "gpt-5.4-mini";

  const result = await processIncomingWhatsAppWebhook({
    from: "5511999999999@s.whatsapp.net",
    text: "sim",
    isFromMe: false,
    messageId: "msg-booking-confirmed-1",
  });

  assert.equal(result.ok, true);
  assert.equal(result.reason, "booking_created");
  assert.equal(appointmentCreated, true);
  assert.equal(paymentCreated, true);
  assert.equal(conversationLinked, true);
  assert.equal(openAiCalled, false);
  assert.equal(sentTexts.some(text => text.includes("Fatura:")), true);
  assert.equal(sentTexts.some(text => text.includes("1) Agendar outro")), true);
  assert.equal(sentTexts.some(text => text.includes("2) Tirar uma dúvida")), true);
  assert.equal(sentTexts.some(text => text.includes("3) Falar com a equipe")), true);
});

test("processIncomingWhatsAppWebhook keeps the selected date when no slots exist", async () => {
  const sentTexts = [];
  const queue = [];
  const queriedWeekdays = [];
  const savedBookingStates = [];
  const ids = {
    conversation: "14141414-1414-4141-8141-141414141414",
    inbound: "25252525-2525-4252-8252-252525252525",
    service: "36363636-3636-4363-8363-363636363636",
    professional: "47474747-4747-4474-8474-474747474747",
  };
  const bookingState = {
    status: "awaiting_date",
    serviceId: ids.service,
    serviceName: "Avaliacao personalizada",
    requestedServiceName: "Avaliacao personalizada",
    serviceValue: 80,
    clientPhone: "5511999999999",
    dateOptions: [
      { id: 1, date: "2026-07-04", label: "Hoje (sab. 04/07)" },
      { id: 2, date: "2026-07-05", label: "Amanha (dom. 05/07)" },
      { id: 3, date: "2026-07-06", label: "Depois de amanha (seg. 06/07)" },
    ],
  };
  const mockSettings = {
    id: "settings-no-sunday-slots",
    business_id: "default",
    enabled: true,
    welcome_message: "Ola!",
    after_hours_message: "Fora do horario.",
    human_handoff_message: "Vou chamar a equipe.",
    closing_message: "Obrigada.",
    timezone: "America/Sao_Paulo",
    allow_24h: true,
    cache_enabled: false,
    max_auto_messages: 12,
    grouping_window_ms: 1,
    allow_new_contacts: true,
    allow_existing_clients: true,
    allow_auto_booking: true,
    require_booking_confirmation: true,
  };

  pool.query = async (text, params = []) => {
    if (text.includes("insert into public.whatsapp_incoming_queue")) {
      queue.push({ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", phone_number: params[0], message_id: params[1], text: params[2], processed: false });
      return { rowCount: 1, rows: [{ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" }] };
    }
    if (text.includes("whatsapp_incoming_queue") && text.includes("select")) {
      if (text.includes("processed = false")) {
        const pending = queue.filter(item => item.phone_number === params[0] && !item.processed);
        return { rowCount: pending.length, rows: pending };
      }
      const isDup = queue.some(item => item.message_id === params[0]);
      return { rowCount: isDup ? 1 : 0, rows: isDup ? [{ 1: 1 }] : [] };
    }
    if (text.includes("update public.whatsapp_incoming_queue")) {
      for (const item of queue) item.processed = true;
      return { rowCount: queue.length, rows: [] };
    }
    if (text.includes("ai_settings") && text.includes("select")) return { rowCount: 1, rows: [mockSettings] };
    if (text.includes("from public.whatsapp_sessions")) return { rowCount: 1, rows: [{ id: "session-id", professional_id: ids.professional }] };
    if (text.includes("from public.whatsapp_conversations") && text.includes("where phone_number")) {
      return {
        rowCount: 1,
        rows: [{
          id: ids.conversation,
          phone_number: "5511999999999",
          status: "ai",
          ai_enabled: true,
          last_message_preview: "Escolha a data respondendo so com o numero",
          booking_state: bookingState,
          client_id: null,
          appointment_id: null,
        }],
      };
    }
    if (text.includes("select id from public.whatsapp_conversations") && text.includes("for update")) return { rowCount: 1, rows: [{ id: ids.conversation }] };
    if (text.includes("insert into public.whatsapp_messages")) return { rowCount: 1, rows: [{ id: ids.inbound }] };
    if (text.includes("update public.whatsapp_conversations")) {
      if (text.includes("set booking_state=$2")) savedBookingStates.push(JSON.parse(params[1]));
      return { rowCount: 1, rows: [] };
    }
    if (text.includes("select s.id,s.name") && text.includes("ai_service_settings")) {
      return { rowCount: 1, rows: [{ id: ids.service, name: "Avaliacao personalizada", active: true, ai_active: true, commercial_name: "Avaliacao personalizada", base_price: 80, allow_auto_booking: true }] };
    }
    if (text.includes("from public.ai_automation_flows") && text.includes("order by name")) {
      return {
        rowCount: 2,
        rows: [
          { flow_key: "pre_agendamento", name: "Pre-agendamento", enabled: true },
          { flow_key: "verificacao_agenda", name: "Verificacao de agenda", enabled: true },
        ],
      };
    }
    if (text.includes("from public.knowledge_articles")) return { rowCount: 0, rows: [] };
    if (text.includes("from public.plans") || text.includes("from public.coupons") || text.includes("from public.marketing_promotions")) return { rowCount: 0, rows: [] };
    if (text.includes("whatsapp_messages") && text.includes("select") && text.includes("count")) return { rowCount: 1, rows: [{ total: 0 }] };
    if (text.includes("from public.clients c") && text.includes("regexp_replace")) return { rowCount: 0, rows: [] };
    if (text.includes("from public.services where id=$1 and active")) {
      return { rowCount: 1, rows: [{ id: ids.service, name: "Avaliacao personalizada", duration_minutes: 45, base_price: 80, deposit_amount: 0, active: true }] };
    }
    if (text.includes("from public.professionals p") && text.includes("order by pp.full_name")) {
      return { rowCount: 1, rows: [{ id: ids.professional, full_name: "Renata Moura" }] };
    }
    if (text.includes("public.professional_availability")) {
      queriedWeekdays.push(params[1]);
      if (params[1] === 0) return { rowCount: 0, rows: [] };
      return { rowCount: 1, rows: [{ starts_at: "09:00", ends_at: "18:00", active: true }] };
    }
    if (text.includes("from public.appointments") && text.includes("union all")) return { rowCount: 0, rows: [] };
    return { rowCount: 1, rows: [{ id: "generic-id" }] };
  };
  pool.connect = async () => ({ query: pool.query, release: () => {} });
  globalThis.fetch = async (url, options = {}) => {
    if (url.includes("/api/send-text")) {
      const body = JSON.parse(options.body || "{}");
      sentTexts.push(body.text || "");
      return new Response(JSON.stringify({ success: true, messageId: "baileys-no-sunday-slots" }));
    }
    if (url.includes("/api/presence")) return new Response(JSON.stringify({ success: true }));
    return new Response(JSON.stringify({ success: true, status: "ready" }));
  };

  process.env.BAILEYS_API_URL = "https://baileys.example.com";
  process.env.BAILEYS_API_KEY = "test-key";

  const result = await processIncomingWhatsAppWebhook({
    from: "5511999999999@s.whatsapp.net",
    text: "2",
    isFromMe: false,
    messageId: "msg-no-sunday-slots-1",
  });

  assert.equal(result.ok, true);
  assert.equal(result.reason, "booking_no_slots");
  assert.deepEqual(queriedWeekdays, [0]);
  assert.equal(savedBookingStates.at(-1).date, "");
  assert.equal(savedBookingStates.at(-1).time, "");
  assert.equal(sentTexts.some(text => text.includes("Encontrei estes hor")), false);
  assert.equal(sentTexts.some(text => text.includes("05/07")), true);
});

test("processIncomingWhatsAppWebhook requests contact data before booking confirmation", async () => {
  let appointmentCreated = false;
  const sentTexts = [];
  const queue = [];
  const ids = {
    conversation: "12121212-1212-4121-8121-121212121212",
    inbound: "23232323-2323-4232-8232-232323232323",
    service: "34343434-3434-4343-8343-343434343434",
    professional: "45454545-4545-4454-8454-454545454545",
  };
  const bookingState = {
    status: "awaiting_confirmation",
    serviceId: ids.service,
    serviceName: "Avaliação personalizada",
    requestedServiceName: "Aplicação de Mega Hair",
    serviceValue: 80,
    date: "2026-07-10",
    time: "09:00",
    professionalId: ids.professional,
    professionalName: "Renata Moura",
  };
  const mockSettings = {
    id: "settings-contact",
    business_id: "default",
    enabled: true,
    welcome_message: "Olá!",
    after_hours_message: "Fora do horário.",
    human_handoff_message: "Vou chamar a equipe.",
    closing_message: "Obrigada.",
    timezone: "America/Sao_Paulo",
    allow_24h: true,
    cache_enabled: false,
    max_auto_messages: 12,
    grouping_window_ms: 1,
    allow_new_contacts: true,
    allow_existing_clients: true,
    allow_auto_booking: true,
    require_booking_confirmation: true,
    primary_provider: "openai",
    primary_model: "gpt-5.4-mini",
    fallback_provider: "openai",
    fallback_model: "gpt-5.4-mini",
    fallback_enabled: false,
    max_retries: 0,
    timeout_ms: 1000,
  };

  pool.query = async (text, params = []) => {
    if (text.includes("insert into public.whatsapp_incoming_queue")) {
      queue.push({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", phone_number: params[0], message_id: params[1], text: params[2], processed: false });
      return { rowCount: 1, rows: [{ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }] };
    }
    if (text.includes("whatsapp_incoming_queue") && text.includes("select")) {
      if (text.includes("processed = false")) {
        const pending = queue.filter(item => item.phone_number === params[0] && !item.processed);
        return { rowCount: pending.length, rows: pending };
      }
      const isDup = queue.some(item => item.message_id === params[0]);
      return { rowCount: isDup ? 1 : 0, rows: isDup ? [{ 1: 1 }] : [] };
    }
    if (text.includes("update public.whatsapp_incoming_queue")) {
      for (const item of queue) item.processed = true;
      return { rowCount: queue.length, rows: [] };
    }
    if (text.includes("ai_settings") && text.includes("select")) return { rowCount: 1, rows: [mockSettings] };
    if (text.includes("from public.whatsapp_sessions")) return { rowCount: 1, rows: [{ id: "session-id", professional_id: ids.professional }] };
    if (text.includes("from public.whatsapp_conversations") && text.includes("where phone_number")) {
      return {
        rowCount: 1,
        rows: [{
          id: ids.conversation,
          phone_number: "5511999999999",
          status: "ai",
          ai_enabled: true,
          booking_state: bookingState,
          client_id: null,
          appointment_id: null,
        }],
      };
    }
    if (text.includes("select id from public.whatsapp_conversations") && text.includes("for update")) return { rowCount: 1, rows: [{ id: ids.conversation }] };
    if (text.includes("insert into public.whatsapp_messages")) return { rowCount: 1, rows: [{ id: ids.inbound }] };
    if (text.includes("update public.whatsapp_conversations")) return { rowCount: 1, rows: [] };
    if (text.includes("insert into public.appointments")) {
      appointmentCreated = true;
      return { rowCount: 1, rows: [] };
    }
    if (text.includes("select s.id,s.name") && text.includes("ai_service_settings")) {
      return { rowCount: 1, rows: [{ id: ids.service, name: "Avaliação personalizada", active: true, ai_active: true, commercial_name: "Avaliação personalizada", base_price: 80, allow_auto_booking: true }] };
    }
    if (text.includes("from public.ai_automation_flows") && text.includes("order by name")) {
      return {
        rowCount: 2,
        rows: [
          { flow_key: "pre_agendamento", name: "Pré-agendamento", enabled: true },
          { flow_key: "verificacao_agenda", name: "Verificação de agenda", enabled: true },
        ],
      };
    }
    if (text.includes("from public.knowledge_articles")) return { rowCount: 0, rows: [] };
    if (text.includes("from public.plans") || text.includes("from public.coupons") || text.includes("from public.marketing_promotions")) return { rowCount: 0, rows: [] };
    if (text.includes("whatsapp_messages") && text.includes("select") && text.includes("count")) return { rowCount: 1, rows: [{ total: 0 }] };
    if (text.includes("from public.clients c") && text.includes("regexp_replace")) return { rowCount: 0, rows: [] };
    return { rowCount: 1, rows: [{ id: "generic-id" }] };
  };
  pool.connect = async () => ({ query: pool.query, release: () => {} });
  globalThis.fetch = async (url, options = {}) => {
    if (url.includes("/api/send-text")) {
      const body = JSON.parse(options.body || "{}");
      sentTexts.push(body.text || "");
      return new Response(JSON.stringify({ success: true, messageId: "baileys-contact-request" }));
    }
    if (url.includes("/api/presence")) return new Response(JSON.stringify({ success: true }));
    return new Response(JSON.stringify({ success: true, status: "ready" }));
  };

  process.env.BAILEYS_API_URL = "https://baileys.example.com";
  process.env.BAILEYS_API_KEY = "test-key";
  process.env.OPENAI_ENABLED = "true";
  process.env.OPENAI_API_KEY = "openai-key";
  process.env.OPENAI_MODEL = "gpt-5.4-mini";

  const result = await processIncomingWhatsAppWebhook({
    from: "5511999999999@s.whatsapp.net",
    text: "sim",
    isFromMe: false,
    messageId: "msg-booking-contact-required-1",
  });

  assert.equal(result.ok, true);
  assert.equal(result.reason, "booking_contact_request");
  assert.equal(appointmentCreated, false);
  assert.equal(sentTexts.some(text => text.includes("Qual seu nome completo?")), true);
  assert.equal(sentTexts.some(text => text.includes("Vou usar este WhatsApp")), true);
  assert.equal(sentTexts.some(text => text.includes("R$")), true);
});

test("processIncomingWhatsAppWebhook handles post-booking option with stale confirmation state", async () => {
  let handoffCreated = false;
  const sentTexts = [];
  const queue = [];
  const ids = {
    conversation: "13131313-1313-4131-8131-131313131313",
    inbound: "24242424-2424-4242-8242-242424242424",
    appointment: "35353535-3535-4353-8353-353535353535",
  };
  const mockSettings = {
    id: "settings-stale-booked",
    business_id: "default",
    enabled: true,
    welcome_message: "Olá!",
    after_hours_message: "Fora do horário.",
    human_handoff_message: "Vou chamar a equipe.",
    closing_message: "Obrigada.",
    timezone: "America/Sao_Paulo",
    allow_24h: true,
    cache_enabled: false,
    max_auto_messages: 12,
    grouping_window_ms: 1,
    allow_new_contacts: true,
    allow_existing_clients: true,
    allow_auto_booking: true,
    require_booking_confirmation: true,
  };

  pool.query = async (text, params = []) => {
    if (text.includes("insert into public.whatsapp_incoming_queue")) {
      queue.push({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", phone_number: params[0], message_id: params[1], text: params[2], processed: false });
      return { rowCount: 1, rows: [{ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }] };
    }
    if (text.includes("whatsapp_incoming_queue") && text.includes("select")) {
      if (text.includes("processed = false")) {
        const pending = queue.filter(item => item.phone_number === params[0] && !item.processed);
        return { rowCount: pending.length, rows: pending };
      }
      const isDup = queue.some(item => item.message_id === params[0]);
      return { rowCount: isDup ? 1 : 0, rows: isDup ? [{ 1: 1 }] : [] };
    }
    if (text.includes("update public.whatsapp_incoming_queue")) {
      for (const item of queue) item.processed = true;
      return { rowCount: queue.length, rows: [] };
    }
    if (text.includes("ai_settings") && text.includes("select")) return { rowCount: 1, rows: [mockSettings] };
    if (text.includes("from public.whatsapp_sessions")) return { rowCount: 1, rows: [{ id: "session-id", professional_id: null }] };
    if (text.includes("from public.whatsapp_conversations") && text.includes("where phone_number")) {
      return {
        rowCount: 1,
        rows: [{
          id: ids.conversation,
          phone_number: "5511999999999",
          status: "ai",
          ai_enabled: true,
          last_message_preview: "Posso continuar te ajudando por aqui: 1) Agendar outro serviço 2) Tirar uma dúvida 3) Falar com a equipe",
          booking_state: {
            status: "awaiting_confirmation",
            serviceName: "Avaliação personalizada",
            date: "2026-07-10",
            time: "09:00",
          },
          client_id: null,
          appointment_id: ids.appointment,
        }],
      };
    }
    if (text.includes("select id from public.whatsapp_conversations") && text.includes("for update")) return { rowCount: 1, rows: [{ id: ids.conversation }] };
    if (text.includes("insert into public.whatsapp_messages")) return { rowCount: 1, rows: [{ id: ids.inbound }] };
    if (text.includes("insert into public.human_handoff_tickets")) {
      handoffCreated = true;
      return { rowCount: 1, rows: [{ id: "ticket-stale-option" }] };
    }
    if (text.includes("update public.whatsapp_conversations")) return { rowCount: 1, rows: [] };
    if (text.includes("select s.id,s.name") && text.includes("ai_service_settings")) return { rowCount: 0, rows: [] };
    if (text.includes("from public.ai_automation_flows") && text.includes("order by name")) return { rowCount: 0, rows: [] };
    if (text.includes("from public.knowledge_articles")) return { rowCount: 0, rows: [] };
    if (text.includes("from public.plans") || text.includes("from public.coupons") || text.includes("from public.marketing_promotions")) return { rowCount: 0, rows: [] };
    if (text.includes("whatsapp_messages") && text.includes("select") && text.includes("count")) return { rowCount: 1, rows: [{ total: 0 }] };
    if (text.includes("from public.clients c") && text.includes("regexp_replace")) return { rowCount: 0, rows: [] };
    return { rowCount: 1, rows: [{ id: "generic-id" }] };
  };
  pool.connect = async () => ({ query: pool.query, release: () => {} });
  globalThis.fetch = async (url, options = {}) => {
    if (url.includes("/api/send-text")) {
      const body = JSON.parse(options.body || "{}");
      sentTexts.push(body.text || "");
      return new Response(JSON.stringify({ success: true, messageId: "baileys-stale-option" }));
    }
    if (url.includes("/api/presence")) return new Response(JSON.stringify({ success: true }));
    return new Response(JSON.stringify({ success: true, status: "ready" }));
  };

  process.env.BAILEYS_API_URL = "https://baileys.example.com";
  process.env.BAILEYS_API_KEY = "test-key";

  const result = await processIncomingWhatsAppWebhook({
    from: "5511999999999@s.whatsapp.net",
    text: "3",
    isFromMe: false,
    messageId: "msg-stale-booked-option-3",
  });

  assert.equal(result.ok, true);
  assert.equal(result.reason, "booking_followup_handoff");
  assert.equal(handoffCreated, true);
  assert.equal(sentTexts.some(text => text.includes("Vou chamar a equipe")), true);
  assert.equal(sentTexts.some(text => text.includes("Resumo do pré-agendamento")), false);
});

test("processIncomingWhatsAppWebhook lets questions continue after a booked pre-booking", async () => {
  let openAiCalled = false;
  let alreadyCreatedSent = false;
  const sentTexts = [];
  const queue = [];
  const ids = {
    conversation: "11111111-1111-4111-8111-111111111112",
    inbound: "22222222-2222-4222-8222-222222222223",
    appointment: "99999999-9999-4999-8999-999999999998",
  };
  const bookingState = {
    status: "booked",
    appointmentId: ids.appointment,
    bookingCode: "CS-TESTE123",
  };
  const mockSettings = {
    id: "settings-booked-followup",
    business_id: "default",
    enabled: true,
    welcome_message: "Olá!",
    after_hours_message: "Fora do horário.",
    human_handoff_message: "Vou chamar a equipe.",
    closing_message: "Obrigada.",
    timezone: "America/Sao_Paulo",
    allow_24h: true,
    cache_enabled: false,
    max_auto_messages: 12,
    grouping_window_ms: 1,
    allow_new_contacts: true,
    allow_existing_clients: true,
    allow_auto_booking: true,
    require_booking_confirmation: true,
    primary_provider: "openai",
    primary_model: "gpt-5.4-mini",
    fallback_provider: "openai",
    fallback_model: "gpt-5.4-mini",
    fallback_enabled: false,
    max_retries: 0,
    timeout_ms: 1000,
  };

  pool.query = async (text, params = []) => {
    if (text.includes("insert into public.whatsapp_incoming_queue")) {
      queue.push({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", phone_number: params[0], message_id: params[1], text: params[2], processed: false });
      return { rowCount: 1, rows: [{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }] };
    }
    if (text.includes("whatsapp_incoming_queue") && text.includes("select")) {
      if (text.includes("processed = false")) {
        const pending = queue.filter(item => item.phone_number === params[0] && !item.processed);
        return { rowCount: pending.length, rows: pending };
      }
      const isDup = queue.some(item => item.message_id === params[0]);
      return { rowCount: isDup ? 1 : 0, rows: isDup ? [{ 1: 1 }] : [] };
    }
    if (text.includes("update public.whatsapp_incoming_queue")) {
      for (const item of queue) item.processed = true;
      return { rowCount: queue.length, rows: [] };
    }
    if (text.includes("ai_settings") && text.includes("select")) {
      return { rowCount: 1, rows: [mockSettings] };
    }
    if (text.includes("from public.whatsapp_sessions")) {
      return { rowCount: 1, rows: [{ id: "session-id", professional_id: null }] };
    }
    if (text.includes("from public.whatsapp_conversations") && text.includes("where phone_number")) {
      return {
        rowCount: 1,
        rows: [{
          id: ids.conversation,
          phone_number: "5511999999999",
          status: "ai",
          ai_enabled: true,
          last_message_preview: "Pronto, registrei sua solicitação de pré-agendamento.",
          booking_state: bookingState,
          client_id: null,
          appointment_id: ids.appointment,
        }],
      };
    }
    if (text.includes("select id from public.whatsapp_conversations") && text.includes("for update")) {
      return { rowCount: 1, rows: [{ id: ids.conversation }] };
    }
    if (text.includes("insert into public.whatsapp_messages")) {
      return { rowCount: 1, rows: [{ id: ids.inbound }] };
    }
    if (text.includes("update public.whatsapp_conversations")) {
      return { rowCount: 1, rows: [] };
    }
    if (text.includes("whatsapp_messages") && text.includes("select") && text.includes("count")) {
      return { rowCount: 1, rows: [{ total: 1 }] };
    }
    if (text.includes("whatsapp_messages") && text.includes("select") && text.includes("direction")) {
      return {
        rowCount: 1,
        rows: [{
          direction: "outbound",
          sender_type: "ai",
          body: "Pronto, registrei sua solicitação de pré-agendamento.",
        }],
      };
    }
    if (text.includes("from public.clients c") && text.includes("regexp_replace")) {
      return { rowCount: 0, rows: [] };
    }
    if (text.includes("select s.id,s.name") && text.includes("ai_service_settings")) {
      return { rowCount: 0, rows: [] };
    }
    if (text.includes("from public.ai_automation_flows") && text.includes("order by name")) {
      return {
        rowCount: 2,
        rows: [
          { flow_key: "pre_agendamento", name: "Pré-agendamento", enabled: true },
          { flow_key: "verificacao_agenda", name: "Verificação de agenda", enabled: true },
        ],
      };
    }
    if (text.includes("from public.knowledge_articles")) {
      return { rowCount: 0, rows: [] };
    }
    if (text.includes("from public.plans") || text.includes("from public.coupons") || text.includes("from public.marketing_promotions")) {
      return { rowCount: 0, rows: [] };
    }
    return { rowCount: 1, rows: [{ id: "generic-id" }] };
  };
  pool.connect = async () => ({
    query: pool.query,
    release: () => {},
  });

  globalThis.fetch = async (url, options = {}) => {
    if (url.includes("/api/send-text")) {
      const body = JSON.parse(options.body || "{}");
      sentTexts.push(body.text || "");
      alreadyCreatedSent ||= String(body.text || "").includes("já está registrado");
      return new Response(JSON.stringify({ success: true, messageId: "baileys-followup" }));
    }
    if (url.includes("/api/presence")) {
      return new Response(JSON.stringify({ success: true }));
    }
    if (url.includes("api.openai.com/v1/chat/completions")) {
      openAiCalled = true;
      return new Response(JSON.stringify({
        id: "resp_followup",
        choices: [{ message: { role: "assistant", content: "Pode sim. O cuidado principal é manter a manutenção em dia e pentear com delicadeza." } }],
        usage: { prompt_tokens: 12, completion_tokens: 8 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ success: true, status: "ready" }));
  };

  process.env.BAILEYS_API_URL = "https://baileys.example.com";
  process.env.BAILEYS_API_KEY = "test-key";
  process.env.OPENAI_ENABLED = "true";
  process.env.OPENAI_API_KEY = "openai-key";
  process.env.OPENAI_MODEL = "gpt-5.4-mini";

  const result = await processIncomingWhatsAppWebhook({
    from: "5511999999999@s.whatsapp.net",
    text: "quero fazer uma pergunta: quais cuidados eu preciso ter com mega hair?",
    isFromMe: false,
    messageId: "msg-booked-followup-question-1",
  });

  assert.equal(result.ok, true);
  assert.equal(result.reason, "openai_reply");
  assert.equal(openAiCalled, true);
  assert.equal(alreadyCreatedSent, false);
  assert.equal(sentTexts.some(text => text.includes("Pode sim.")), true);
});
