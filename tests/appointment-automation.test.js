import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  DEFAULT_BUSINESS_ADDRESS,
  appointmentChangeMessage,
  appointmentNotificationVersion,
  dueAppointmentReminderWindows,
  generateGoogleCalendarUrl,
  loadAppointmentAutomationContext,
  normalizeAppointmentAutomationSettings,
  whatsappAppointmentIdempotencyKey,
} from "../server/lib/appointment-automation.js";

test("uses the physical Bauru address when no business address is configured", async () => {
  const context = await loadAppointmentAutomationContext(async (sql) => ({
    rows: sql.includes("business_profile") ? [{ value: {} }] : [],
  }));
  assert.equal(DEFAULT_BUSINESS_ADDRESS, "Rua Castro Alves, 6-37, Bauru/SP");
  assert.equal(context.address, DEFAULT_BUSINESS_ADDRESS);
});

test("Coolify schedules reminders by default and recovers interrupted deliveries", async () => {
  const [server, cron, bot] = await Promise.all([
    readFile("server.mjs", "utf8"),
    readFile("api/cron-tasks.js", "utf8"),
    readFile("server/lib/whatsapp-ai-engine.js", "utf8"),
  ]);
  assert.match(server, /APPOINTMENT_REMINDER_SCHEDULER_ENABLED \?\? 'true'/);
  assert.match(server, /name: 'reminders',[\s\S]*everyMs: 5 \* 60 \* 1000/);
  assert.match(cron, /left join auth\.users cu/i);
  assert.match(cron, /delivery_status='processing'[\s\S]*interval '15 minutes'/);
  assert.match(cron, /req\.headers\["x-cron-secret"\] === expected/);
  assert.match(bot, /📍 Endereço:/);
  assert.match(bot, /location\.rows\[0\]\?\.address \|\| automation\.address/);
});

test("normalizes appointment automation with safe limits", () => {
  const settings = normalizeAppointmentAutomationSettings({
    bookingEnabled: false,
    reminder24hHoursBefore: 999,
    reminder2hHoursBefore: 0,
    maxDeliveryAttempts: 99,
  });
  assert.equal(settings.bookingEnabled, false);
  assert.equal(settings.reminder24hHoursBefore, 168);
  assert.equal(settings.reminder2hHoursBefore, 1);
  assert.equal(settings.maxDeliveryAttempts, 5);
  assert.equal(settings.timezone, "America/Sao_Paulo");
});

test("detects 24h and 2h reminders only inside the retry window", () => {
  const startsAt = "2026-08-20T17:00:00.000Z";
  assert.deepEqual(
    dueAppointmentReminderWindows(startsAt, {
      now: "2026-08-19T17:20:00.000Z",
      settings: { reminderRetryWindowMinutes: 90 },
    }).map((window) => window.key),
    ["24h"],
  );
  assert.deepEqual(
    dueAppointmentReminderWindows(startsAt, {
      now: "2026-08-20T15:20:00.000Z",
      settings: { reminderRetryWindowMinutes: 90 },
    }).map((window) => window.key),
    ["2h"],
  );
  assert.deepEqual(
    dueAppointmentReminderWindows(startsAt, {
      now: "2026-08-20T16:45:00.000Z",
    }),
    [],
  );
});

test("generates a complete Google Calendar template in UTC", () => {
  const url = new URL(generateGoogleCalendarUrl({
    starts_at: "2026-08-20T17:00:00.000Z",
    ends_at: "2026-08-20T18:30:00.000Z",
    service: "Avaliação",
    professional: "Carol Sol",
    booking_code: "CS-123",
  }, {
    businessName: "Carol Sol",
    timezone: "America/Sao_Paulo",
    address: "São Paulo",
  }));
  assert.equal(url.origin, "https://calendar.google.com");
  assert.equal(url.searchParams.get("dates"), "20260820T170000Z/20260820T183000Z");
  assert.equal(url.searchParams.get("ctz"), "America/Sao_Paulo");
  assert.match(url.searchParams.get("text"), /Avaliação - Carol Sol/);
  assert.match(url.searchParams.get("details"), /Duração: 90 minutos/);
  assert.equal(url.searchParams.get("location"), "São Paulo");
});

test("changes notification version when an appointment is rescheduled", () => {
  assert.notEqual(
    appointmentNotificationVersion({ updated_at: "2026-08-19T10:00:00Z" }),
    appointmentNotificationVersion({ updated_at: "2026-08-19T11:00:00Z" }),
  );
});

test("builds client messages for manual appointment status changes", () => {
  const confirmed = appointmentChangeMessage({
    status: "confirmed",
    service: "Avaliação",
    startsAt: "2026-08-20T17:00:00.000Z",
    professional: "Carol Sol",
  });
  assert.equal(confirmed.title, "Agendamento confirmado");
  assert.match(confirmed.text, /Seu agendamento foi confirmado/i);
  assert.match(confirmed.text, /20\/08\/2026, 14:00/);
  assert.match(confirmed.text, /Profissional: Carol Sol/);

  const cancelled = appointmentChangeMessage({
    status: "cancelled",
    service: "Aplicação",
    startsAt: "2026-08-20T17:00:00.000Z",
  });
  assert.equal(cancelled.title, "Agendamento cancelado");
  assert.match(cancelled.text, /foi cancelado/i);
  assert.doesNotMatch(cancelled.text, /Data\/Horário/);
});

test("builds reschedule and lifecycle messages without inventing statuses", () => {
  const rescheduled = appointmentChangeMessage({
    status: "rescheduled",
    service: "Mega Hair",
    startsAt: "2026-08-21T12:30:00.000Z",
    calendarUrl: "https://calendar.google.com/example",
  });
  assert.equal(rescheduled.title, "Agendamento reagendado");
  assert.match(rescheduled.text, /foi reagendado/i);
  assert.match(rescheduled.text, /Adicionar ao Google Calendar/);

  const completed = appointmentChangeMessage({ status: "completed", service: "Mega Hair" });
  assert.match(completed.text, /atendimento foi concluído/i);
  assert.doesNotMatch(completed.text, /Invalid Date/);
});

test("keeps repeated confirmations idempotent and permits a later second booking", () => {
  const first = whatsappAppointmentIdempotencyKey("conversation-1");
  assert.equal(first, whatsappAppointmentIdempotencyKey("conversation-1"));
  assert.notEqual(first, whatsappAppointmentIdempotencyKey("conversation-1", "appointment-1"));
});

test("appointment automation migration is additive and indexed", async () => {
  const sql = await readFile("database/neon-appointment-automation.sql", "utf8");
  assert.match(sql, /add column if not exists idempotency_key text/i);
  assert.match(sql, /appointments_idempotency_key_unique/i);
  assert.match(sql, /add column if not exists delivery_status text/i);
  assert.match(sql, /appointment_automation/i);
  assert.doesNotMatch(sql, /drop\s+(table|column)/i);
});
