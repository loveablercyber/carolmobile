import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import {
  BaileysClientError,
  getBaileysQr,
  getBaileysStatus,
  logoutBaileysSession,
  normalizeBaileysNumber,
  requestBaileysPairingCode,
  resetBaileysSession,
  sendBaileysTextMessage,
} from "../server/lib/baileys-client.js";

const originalFetch = globalThis.fetch;
const originalUrl = process.env.BAILEYS_API_URL;
const originalKey = process.env.BAILEYS_API_KEY;

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
