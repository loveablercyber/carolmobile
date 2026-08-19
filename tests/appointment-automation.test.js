import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  appointmentNotificationVersion,
  dueAppointmentReminderWindows,
  generateGoogleCalendarUrl,
  normalizeAppointmentAutomationSettings,
  whatsappAppointmentIdempotencyKey,
} from "../server/lib/appointment-automation.js";

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
