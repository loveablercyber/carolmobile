import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import {
  BaileysClientError,
  buildEvolutionWebhookUrl,
  ensureBaileysReady,
  getBaileysQr,
  getBaileysStatus,
  logoutBaileysSession,
  normalizeBaileysStatusValue,
  normalizeBaileysNumber,
  requestBaileysPairingCode,
  resetBaileysSession,
  sendBaileysTextMessage,
} from "../server/lib/baileys-client.js";

const originalFetch = globalThis.fetch;
const originalUrl = process.env.BAILEYS_API_URL;
const originalKey = process.env.BAILEYS_API_KEY;
const originalEnabled = process.env.BAILEYS_ENABLED;
const originalAutoReconnect = process.env.BAILEYS_AUTO_RECONNECT;
const originalProvider = process.env.BAILEYS_PROVIDER;
const originalInstance = process.env.BAILEYS_DEFAULT_INSTANCE;
const originalAppUrl = process.env.APP_URL;
const originalWebhookSecret = process.env.BAILEYS_WEBHOOK_SECRET;
const originalAutoConfigureWebhook = process.env.BAILEYS_AUTO_CONFIGURE_WEBHOOK;

function configure() {
  process.env.BAILEYS_API_URL = "https://whatsapp.example.test/";
  process.env.BAILEYS_API_KEY = "server-secret";
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalUrl === undefined) delete process.env.BAILEYS_API_URL;
  else process.env.BAILEYS_API_URL = originalUrl;
  if (originalKey === undefined) delete process.env.BAILEYS_API_KEY;
  else process.env.BAILEYS_API_KEY = originalKey;
  if (originalEnabled === undefined) delete process.env.BAILEYS_ENABLED;
  else process.env.BAILEYS_ENABLED = originalEnabled;
  if (originalAutoReconnect === undefined) delete process.env.BAILEYS_AUTO_RECONNECT;
  else process.env.BAILEYS_AUTO_RECONNECT = originalAutoReconnect;
  if (originalProvider === undefined) delete process.env.BAILEYS_PROVIDER;
  else process.env.BAILEYS_PROVIDER = originalProvider;
  if (originalInstance === undefined) delete process.env.BAILEYS_DEFAULT_INSTANCE;
  else process.env.BAILEYS_DEFAULT_INSTANCE = originalInstance;
  if (originalAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = originalAppUrl;
  if (originalWebhookSecret === undefined) delete process.env.BAILEYS_WEBHOOK_SECRET;
  else process.env.BAILEYS_WEBHOOK_SECRET = originalWebhookSecret;
  if (originalAutoConfigureWebhook === undefined) delete process.env.BAILEYS_AUTO_CONFIGURE_WEBHOOK;
  else process.env.BAILEYS_AUTO_CONFIGURE_WEBHOOK = originalAutoConfigureWebhook;
});

test("reads Baileys status with x-api-key only on the server", async () => {
  configure();
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://whatsapp.example.test/api/status");
    assert.equal(options.headers["x-api-key"], "server-secret");
    assert.equal(options.headers.Authorization, undefined);
    return new Response(
      JSON.stringify({ success: true, engine: "baileys", status: "ready" }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const result = await getBaileysStatus();
  assert.equal(result.ok, true);
  assert.equal(result.status, "ready");
});

test("normalizes QR payloads without explicit status", () => {
  assert.equal(normalizeBaileysStatusValue({ qrCode: "data2" }), "qrcode");
  assert.equal(normalizeBaileysStatusValue({ status: "unknown", qr: "data5" }), "qrcode");
});

test("blocks text sending until the external API is ready", async () => {
  configure();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ success: true, status: "qr" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  await assert.rejects(
    sendBaileysTextMessage({ number: "5514999999999", text: "Teste" }),
    (error) => error instanceof BaileysClientError && error.code === "BAILEYS_NOT_READY",
  );
  assert.equal(calls, 1);
});

test("sends normalized text after confirming ready status", async () => {
  configure();
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    const data = calls.length === 1
      ? { success: true, status: "ready" }
      : { success: true, number: "5514999999999", messageId: "message-1" };
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const result = await sendBaileysTextMessage({
    number: "+55 (14) 99999-9999",
    text: " Olá! ",
  });
  assert.equal(calls[1].url, "https://whatsapp.example.test/api/send-text");
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    number: "5514999999999",
    text: "Olá!",
  });
  assert.equal(result.data.messageId, "message-1");
});

test("keepalive restarts a disconnected Baileys session once", async () => {
  configure();
  process.env.BAILEYS_ENABLED = "true";
  const paths = [];
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    paths.push(path);
    const data = path === "/api/status"
      ? { success: true, status: "disconnected" }
      : { success: true, status: "starting" };
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await ensureBaileysReady({ source: "test_keepalive" });

  assert.equal(result.reconnected, true);
  assert.equal(result.beforeStatus, "disconnected");
  assert.equal(result.status, "starting");
  assert.deepEqual(paths, ["/api/status", "/api/reset-session"]);
});

test("builds Evolution webhook URL from APP_URL and secret", () => {
  process.env.APP_URL = "https://agenda.carolsol.com.br/";
  process.env.BAILEYS_WEBHOOK_SECRET = "secret with spaces";

  const url = new URL(buildEvolutionWebhookUrl());

  assert.equal(url.origin, "https://agenda.carolsol.com.br");
  assert.equal(url.pathname, "/api/whatsapp");
  assert.equal(url.searchParams.get("resource"), "webhook");
  assert.equal(url.searchParams.get("secret"), "secret with spaces");
});

test("ready Evolution keepalive configures the webhook target", async () => {
  configure();
  process.env.BAILEYS_PROVIDER = "evolution";
  process.env.BAILEYS_DEFAULT_INSTANCE = "carolsol";
  process.env.APP_URL = "https://agenda.carolsol.com.br";
  process.env.BAILEYS_WEBHOOK_SECRET = "webhook-secret";

  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    const path = new URL(url).pathname;
    const data = path.includes("/connectionState/")
      ? { instance: { state: "open" } }
      : { success: true, status: "configured" };
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await ensureBaileysReady({ source: "test_keepalive" });

  assert.equal(result.ready, true);
  assert.equal(calls[0].url, "https://whatsapp.example.test/instance/connectionState/carolsol");
  assert.equal(calls[1].url, "https://whatsapp.example.test/webhook/set/carolsol");
  assert.equal(calls[1].options.method, "POST");
  const body = JSON.parse(calls[1].options.body);
  assert.equal(body.enabled, true);
  assert.equal(
    body.url,
    "https://agenda.carolsol.com.br/api/whatsapp?resource=webhook&secret=webhook-secret",
  );
  assert.deepEqual(body.events, ["MESSAGES_UPSERT", "CONNECTION_UPDATE", "QRCODE_UPDATED"]);
});

test("keepalive does not restart a QR pairing state without force", async () => {
  configure();
  process.env.BAILEYS_ENABLED = "true";
  const paths = [];
  globalThis.fetch = async (url) => {
    paths.push(new URL(url).pathname);
    return new Response(JSON.stringify({ success: true, status: "qrcode" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await ensureBaileysReady({ source: "test_keepalive" });

  assert.equal(result.reconnected, false);
  assert.equal(result.skipped, true);
  assert.equal(result.status, "qrcode");
  assert.deepEqual(paths, ["/api/status"]);
});

test("maps protected session endpoints without exposing credentials", async () => {
  configure();
  const paths = [];
  globalThis.fetch = async (url) => {
    paths.push(new URL(url).pathname);
    return new Response(JSON.stringify({ success: true, status: "starting" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  await resetBaileysSession();
  await getBaileysQr();
  await logoutBaileysSession();
  assert.deepEqual(paths, ["/api/reset-session", "/api/qr", "/api/logout"]);
});

test("requests pairing code with normalized phone number", async () => {
  configure();
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(
      JSON.stringify({ success: true, status: "pairing_code", pairingCode: "123-456" }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const result = await requestBaileysPairingCode({
    number: "+55 (14) 99999-9999",
  });
  assert.equal(calls[0].url, "https://whatsapp.example.test/api/pairing-code");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    number: "5514999999999",
  });
  assert.equal(result.data.pairingCode, "123-456");
});

test("returns friendly errors for invalid numbers and rejected credentials", async () => {
  assert.throws(
    () => normalizeBaileysNumber("14999999999"),
    (error) => error.code === "BAILEYS_INVALID_NUMBER" && error.status === 400,
  );
  configure();
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: "invalid key" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  await assert.rejects(
    getBaileysStatus(),
    (error) =>
      error.code === "BAILEYS_UNAUTHORIZED" && error.providerStatus === 401,
  );
});

test("preserves pairing rate-limit errors from the WhatsApp provider", async () => {
  configure();
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        code: "PAIRING_RATE_LIMITED",
        error: "O WhatsApp bloqueou temporariamente novas tentativas. Aguarde 30 minutos.",
      }),
      { status: 429, headers: { "content-type": "application/json" } },
    );

  await assert.rejects(
    requestBaileysPairingCode({ number: "5514999999999" }),
    (error) =>
      error.code === "BAILEYS_RATE_LIMITED" &&
      error.status === 429 &&
      error.providerStatus === 429 &&
      /Aguarde 30 minutos/.test(error.message),
  );
});

test("sends text message skipping ready status check", async () => {
  configure();
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ success: true, number: "5514999999999", messageId: "message-2" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const result = await sendBaileysTextMessage({
    number: "5514999999999",
    text: "Olá!",
    skipStatusCheck: true,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://whatsapp.example.test/api/send-text");
  assert.equal(result.data.messageId, "message-2");
});
