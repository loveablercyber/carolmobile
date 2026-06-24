import test from "node:test";
import assert from "node:assert/strict";
import {
  nextRetryAt,
  recurringConfig,
  renewalEligibility,
  renewalPeriod,
} from "../server/lib/recurring-rules.js";

const due = {
  auto_renew: true,
  recurring_consent_at: "2026-01-01T00:00:00Z",
  status: "active",
  renews_at: "2026-05-01",
  card_id: "card",
  external_token: "server-only-token",
  provider_customer_id: "customer",
  amount: 150,
  renewal_failures: 0,
  next_retry_at: null,
};

test("recurring charges are disabled by default and blocked outside sandbox", () => {
  assert.equal(recurringConfig({}).chargeAllowed, false);
  assert.equal(
    recurringConfig({
      SUMUP_RECURRING_ENABLED: "true",
      SUMUP_RECURRING_MODE: "sandbox",
      SUMUP_ENVIRONMENT: "sandbox",
    }).chargeAllowed,
    true,
  );
  const live = recurringConfig({
    SUMUP_RECURRING_ENABLED: "true",
    SUMUP_RECURRING_MODE: "live",
    SUMUP_ENVIRONMENT: "production",
  });
  assert.equal(live.chargeAllowed, false);
  assert.match(live.reason, /somente em sandbox/i);
});

test("renewal eligibility requires consent, due date and server token", () => {
  const now = new Date("2026-06-22T12:00:00Z");
  assert.equal(renewalEligibility(due, now), null);
  assert.match(renewalEligibility({ ...due, auto_renew: false }, now), /consentimento/i);
  assert.match(renewalEligibility({ ...due, external_token: null }, now), /Cartão/i);
  assert.match(renewalEligibility({ ...due, renews_at: "2026-07-01" }, now), /ainda não venceu/i);
  assert.match(renewalEligibility({ ...due, renewal_failures: 3 }, now), /Limite/i);
});

test("billing period and retry schedule are deterministic", () => {
  assert.equal(renewalPeriod("2026-06-22T00:00:00Z"), "2026-06-22");
  assert.throws(() => renewalPeriod("22/06/2026"), /inválida/i);
  const now = new Date("2026-06-22T12:00:00Z");
  assert.equal(nextRetryAt(1, now), "2026-06-23T12:00:00.000Z");
  assert.equal(nextRetryAt(2, now), "2026-06-25T12:00:00.000Z");
  assert.equal(nextRetryAt(3, now), null);
});
