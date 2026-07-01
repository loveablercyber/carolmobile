import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { getGeminiKeys } from "../server/lib/gemini-client.js";
import { generateGroqText, getGroqKeys } from "../server/lib/groq-client.js";
import { pool } from "../server/lib/db.js";
import { processIncomingWhatsAppWebhook } from "../server/lib/whatsapp-ai-engine.js";
import { invalidateAiSettingsCache } from "../server/lib/ai-whatsapp.js";

// Save original objects
const originalQuery = pool.query;
const originalConnect = pool.connect;
const originalFetch = globalThis.fetch;

const envBackup = {};

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

test("processIncomingWhatsAppWebhook responds with simple greeting template immediately", async () => {
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
    if (text.includes("whatsapp_conversations") && text.includes("select")) {
      return { rowCount: 1, rows: [{ id: "conv-456", status: "ai", ai_enabled: true }] };
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
  assert.equal(result.reason, "greeting_template");
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
      return { rowCount: 1, rows: [{ id: "conv-456", status: "ai", ai_enabled: true }] };
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

    if (url.includes("api.openai.com/v1/responses")) {
      openAiCalled = true;
      return new Response(JSON.stringify({
        id: "resp_test",
        output: [{ type: "message", content: [{ type: "output_text", text: "Resposta inteligente da OpenAI." }] }],
        usage: { input_tokens: 10, output_tokens: 5 }
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

test("processIncomingWhatsAppWebhook ignores legacy provider settings and still uses OpenAI", async () => {
  let geminiCalled = false;
  let groqCalled = false;
  let openAiCalled = false;

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
      return { rowCount: 1, rows: [{ id: "conv-456", status: "ai", ai_enabled: true }] };
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

    if (url.includes("api.openai.com/v1/responses")) {
      openAiCalled = true;
      return new Response(JSON.stringify({
        output: [{ type: "message", content: [{ type: "output_text", text: "Resposta OpenAI." }] }]
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
    text: "Qual valor?",
    isFromMe: false,
    messageId: "msg-cb-bypass-1",
  };

  const result = await processIncomingWhatsAppWebhook(payload);
  assert.equal(result.ok, true);
  assert.equal(result.replied, true);
  assert.equal(result.reason, "openai_reply");
  assert.equal(openAiCalled, true);
  assert.equal(geminiCalled, false);
  assert.equal(groqCalled, false);
});
