import test from "node:test";
import assert from "node:assert/strict";
import { pool } from "../server/lib/db.js";
import { notifyAppointmentChange } from "../server/lib/integrations.js";

const originalQuery = pool.query;
const originalFetch = globalThis.fetch;
const originalEnv = {
  BAILEYS_ENABLED: process.env.BAILEYS_ENABLED,
  BAILEYS_API_URL: process.env.BAILEYS_API_URL,
  BAILEYS_API_KEY: process.env.BAILEYS_API_KEY,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  NOTIFICATION_EMAIL_FROM: process.env.NOTIFICATION_EMAIL_FROM,
};

test.afterEach(() => {
  pool.query = originalQuery;
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("does not send appointment updates when the client disabled external channels", async () => {
  let fetchCalls = 0;
  let deliveryCancelled = false;
  pool.query = async (sql) => {
    if (sql.includes("from public.profiles p")) {
      return { rowCount: 1, rows: [{ wants_email: false, wants_whatsapp: false }] };
    }
    if (sql.includes("set delivery_status='cancelled'")) deliveryCancelled = true;
    return { rowCount: 1, rows: [] };
  };
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({ success: true }));
  };

  const result = await notifyAppointmentChange({
    notificationId: "11111111-1111-4111-8111-111111111111",
    profileId: "22222222-2222-4222-8222-222222222222",
    phone: "5511999999999",
    email: "cliente@example.test",
    title: "Agendamento confirmado",
    text: "Seu agendamento foi confirmado.",
  });

  assert.equal(result.results.length, 0);
  assert.equal(fetchCalls, 0);
  assert.equal(deliveryCancelled, true);
});

test("sends a single WhatsApp update and records its delivery when enabled", async () => {
  const requestedUrls = [];
  let deliveryLogged = false;
  let notificationMarkedSent = false;
  pool.query = async (sql) => {
    if (sql.includes("from public.profiles p")) {
      return { rowCount: 1, rows: [{ wants_email: false, wants_whatsapp: true }] };
    }
    if (sql.includes("insert into public.notification_delivery_logs")) deliveryLogged = true;
    if (sql.includes("set delivery_status=$2")) notificationMarkedSent = true;
    return { rowCount: 1, rows: [] };
  };
  process.env.BAILEYS_ENABLED = "true";
  process.env.BAILEYS_API_URL = "https://baileys.example.test";
  process.env.BAILEYS_API_KEY = "test-key";
  delete process.env.RESEND_API_KEY;
  delete process.env.NOTIFICATION_EMAIL_FROM;
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    if (String(url).endsWith("/api/status")) {
      return new Response(JSON.stringify({ success: true, status: "ready" }));
    }
    return new Response(JSON.stringify({ success: true, messageId: "status-change-1" }));
  };

  const result = await notifyAppointmentChange({
    notificationId: "33333333-3333-4333-8333-333333333333",
    profileId: "44444444-4444-4444-8444-444444444444",
    phone: "5511999999999",
    email: "cliente@example.test",
    title: "Agendamento confirmado",
    text: "Seu agendamento foi confirmado.",
  });

  assert.equal(result.results.length, 1);
  assert.equal(requestedUrls.filter((url) => url.endsWith("/api/send-text")).length, 1);
  assert.equal(deliveryLogged, true);
  assert.equal(notificationMarkedSent, true);
});
