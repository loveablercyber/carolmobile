import test from "node:test";
import assert from "node:assert/strict";
import {
  appointmentRange,
  appointmentStatuses,
  canUpdateAppointmentStatus,
} from "../server/lib/appointment-rules.js";

test("accepts a valid agenda interval", () => {
  assert.deepEqual(
    appointmentRange({ dateFrom: "2026-06-22", dateTo: "2026-06-23" }),
    {
      range: { dateFrom: "2026-06-22", dateTo: "2026-06-23" },
      error: "",
    },
  );
});

test("rejects incomplete, impossible, reversed and oversized intervals", () => {
  const invalidCases = [
    { dateFrom: "2026-06-22" },
    { dateFrom: "2026-02-30", dateTo: "2026-03-01" },
    { dateFrom: "2026-06-23", dateTo: "2026-06-22" },
    { dateFrom: "2026-01-01", dateTo: "2026-05-01" },
  ];
  for (const query of invalidCases) {
    const result = appointmentRange(query);
    assert.equal(result.range, null);
    assert.ok(result.error);
  }
});

test("keeps the unfiltered appointments contract", () => {
  assert.deepEqual(appointmentRange({}), { range: null, error: "" });
});

test("professional and admin may persist every supported status", () => {
  for (const status of appointmentStatuses) {
    assert.equal(canUpdateAppointmentStatus("professional", status), true);
    assert.equal(canUpdateAppointmentStatus("admin", status), true);
  }
});

test("client status permissions remain restricted", () => {
  for (const status of appointmentStatuses) {
    assert.equal(
      canUpdateAppointmentStatus("client", status),
      ["cancelled", "rescheduled"].includes(status),
    );
  }
  assert.equal(canUpdateAppointmentStatus("client", "invalid"), false);
});
