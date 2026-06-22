import test from "node:test";
import assert from "node:assert/strict";

import {
  isAvailabilityDate,
  periodFitsSchedule,
  schedulePeriod,
  scheduleSlots,
  slotsWithConflicts,
  weekdayForDate,
} from "../server/lib/availability-rules.js";

test("validates calendar dates and calculates the weekday", () => {
  assert.equal(isAvailabilityDate("2028-02-29"), true);
  assert.equal(isAvailabilityDate("2027-02-29"), false);
  assert.equal(isAvailabilityDate("22/06/2026"), false);
  assert.equal(weekdayForDate("2026-06-22"), 1);
});

test("generates service slots only inside active working windows", () => {
  assert.deepEqual(
    scheduleSlots(
      [
        { starts_at: "09:00:00", ends_at: "12:00:00", active: true },
        { starts_at: "14:00:00", ends_at: "15:00:00", active: false },
      ],
      60,
    ),
    ["09:00", "09:30", "10:00", "10:30", "11:00"],
  );
});

test("marks every slot that overlaps an appointment or block", () => {
  const slots = slotsWithConflicts(
    "2026-06-22",
    ["09:00", "09:30", "10:00"],
    60,
    [
      {
        starts_at: "2026-06-22T12:30:00.000Z",
        ends_at: "2026-06-22T13:00:00.000Z",
      },
    ],
  );
  assert.deepEqual(slots, [
    { time: "09:00", available: false },
    { time: "09:30", available: false },
    { time: "10:00", available: true },
  ]);
});

test("normalizes a future block in the Sao Paulo timezone", () => {
  const { period, error } = schedulePeriod(
    "2099-06-22T09:00:00-03:00",
    "2099-06-22T10:30:00-03:00",
  );
  assert.equal(error, "");
  assert.equal(period.date, "2099-06-22");
  assert.equal(period.startMinute, 540);
  assert.equal(period.endMinute, 630);
  assert.equal(
    periodFitsSchedule(period, [
      { starts_at: "08:00:00", ends_at: "18:00:00", active: true },
    ]),
    true,
  );
});

test("rejects past, cross-day and oversized blocks", () => {
  assert.match(
    schedulePeriod(
      "2020-01-01T09:00:00-03:00",
      "2020-01-01T10:00:00-03:00",
    ).error,
    /futuro/,
  );
  assert.match(
    schedulePeriod(
      "2099-06-22T23:30:00-03:00",
      "2099-06-23T00:30:00-03:00",
    ).error,
    /mesmo dia/,
  );
  assert.match(
    schedulePeriod(
      "2099-06-22T06:00:00-03:00",
      "2099-06-22T19:00:00-03:00",
    ).error,
    /12 horas/,
  );
});

test("rejects blocks outside the configured working window", () => {
  const { period } = schedulePeriod(
    "2099-06-22T07:30:00-03:00",
    "2099-06-22T09:30:00-03:00",
  );
  assert.equal(
    periodFitsSchedule(period, [
      { starts_at: "09:00:00", ends_at: "18:00:00", active: true },
    ]),
    false,
  );
});
