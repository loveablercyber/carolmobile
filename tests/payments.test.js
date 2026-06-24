import test from "node:test";
import assert from "node:assert/strict";
import { mapSumupStatus, sumupConfig } from "../server/lib/sumup.js";
import {
  receiptSubmissionError,
  resolveProviderTransition,
  resolveReceiptReview,
} from "../server/lib/payment-rules.js";

test("maps SumUp status correctly to internal status names", () => {
  const cases = [
    { input: "PAID", expected: "paid" },
    { input: "SUCCESSFUL", expected: "paid" },
    { input: "FAILED", expected: "failed" },
    { input: "DECLINED", expected: "failed" },
    { input: "CANCELLED", expected: "cancelled" },
    { input: "EXPIRED", expected: "expired" },
    { input: "PROCESSING", expected: "processing" },
    { input: "PENDING", expected: "pending" },
    { input: "SOME_UNKNOWN_STATUS", expected: "awaiting_confirmation" },
    { input: "", expected: "awaiting_confirmation" },
    { input: null, expected: "awaiting_confirmation" },
  ];

  for (const { input, expected } of cases) {
    assert.equal(mapSumupStatus(input), expected);
  }
});

test("reads SumUp configuration and respects enabled flags", () => {
  // Test with enabled=true
  process.env.SUMUP_ENABLED = "true";
  process.env.SUMUP_API_KEY = "test-api-key";
  process.env.SUMUP_MERCHANT_CODE = "test-merchant";
  process.env.SUMUP_ENVIRONMENT = "sandbox";
  process.env.SUMUP_RETURN_URL = "http://localhost:5173/return";

  const config = sumupConfig();
  assert.equal(config.enabled, true);
  assert.equal(config.apiKey, "test-api-key");
  assert.equal(config.merchantCode, "test-merchant");
  assert.equal(config.environment, "sandbox");
  assert.equal(config.returnUrl, "http://localhost:5173/return");

  // Test with enabled=false
  process.env.SUMUP_ENABLED = "false";
  const configDisabled = sumupConfig();
  assert.equal(configDisabled.enabled, false);
});

test("does not regress a paid payment on delayed provider updates", () => {
  assert.deepEqual(resolveProviderTransition("paid", "pending"), {
    status: "paid",
    changed: false,
    ignored: true,
  });
  assert.deepEqual(resolveProviderTransition("pending", "paid"), {
    status: "paid",
    changed: true,
    ignored: false,
  });
  assert.equal(resolveProviderTransition("pending", "pending").changed, false);
});

test("validates receipt submission permissions and payment state", () => {
  const valid = {
    role: "client",
    provider: "pix_manual",
    paymentStatus: "pending",
    url: "https://res.cloudinary.com/demo/image/upload/receipt.jpg",
  };
  assert.equal(receiptSubmissionError(valid), null);
  assert.match(
    receiptSubmissionError({ ...valid, role: "professional" }),
    /Apenas a cliente/,
  );
  assert.match(
    receiptSubmissionError({ ...valid, provider: "sumup" }),
    /Pix manual/,
  );
  assert.match(
    receiptSubmissionError({ ...valid, hasActiveReceipt: true }),
    /já existe/i,
  );
  assert.match(
    receiptSubmissionError({ ...valid, url: "javascript:alert(1)" }),
    /URL/,
  );
});

test("receipt review is idempotent and rejects opposite terminal actions", () => {
  assert.deepEqual(resolveReceiptReview("under_review", "approve"), {
    status: "approved",
    changed: true,
  });
  assert.deepEqual(resolveReceiptReview("approved", "approve"), {
    status: "approved",
    changed: false,
  });
  assert.match(resolveReceiptReview("approved", "reject").error, /analisado/);
  assert.match(resolveReceiptReview("under_review", "invalid").error, /inválida/);
});
