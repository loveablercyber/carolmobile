import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSumupInstrument,
  successfulCardSetupStatus,
  sumupCustomerReference,
} from "../server/lib/card-rules.js";

test("builds a deterministic SumUp customer reference from the client UUID", () => {
  assert.equal(
    sumupCustomerReference("123e4567-e89b-12d3-a456-426614174000"),
    "CAROLSOL-123E4567E89B12D3A456426614174000",
  );
  assert.equal(sumupCustomerReference("invalid"), null);
});

test("accepts only successful tokenization checkout statuses", () => {
  assert.equal(successfulCardSetupStatus("PAID"), true);
  assert.equal(successfulCardSetupStatus("successful"), true);
  assert.equal(successfulCardSetupStatus("PENDING"), false);
  assert.equal(successfulCardSetupStatus("FAILED"), false);
});

test("normalizes active SumUp card instruments without exposing card data", () => {
  assert.deepEqual(
    normalizeSumupInstrument({
      token: "bcfc8e5f-3b47-4cb9-854b-3b7a4cce7be3",
      active: true,
      type: "card",
      card: { last_4_digits: "0001", type: "visa" },
    }),
    {
      token: "bcfc8e5f-3b47-4cb9-854b-3b7a4cce7be3",
      lastFour: "0001",
      brand: "VISA",
    },
  );
});

test("rejects inactive, malformed or non-card payment instruments", () => {
  const valid = {
    token: "provider-token",
    active: true,
    type: "card",
    card: { last_4_digits: "1234", type: "VISA" },
  };
  assert.equal(normalizeSumupInstrument({ ...valid, active: false }), null);
  assert.equal(normalizeSumupInstrument({ ...valid, type: "bank" }), null);
  assert.equal(
    normalizeSumupInstrument({
      ...valid,
      card: { ...valid.card, last_4_digits: "12345" },
    }),
    null,
  );
});
