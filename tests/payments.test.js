import test from "node:test";
import assert from "node:assert/strict";
import {
  createSumupCheckout,
  mapSumupStatus,
  sumupConfig,
} from "../server/lib/sumup.js";
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
  assert.equal(config.merchantCode, "TEST-MERCHANT");
  assert.equal(config.environment, "sandbox");
  assert.equal(config.returnUrl, "http://localhost:5173/return");

  // Test with enabled=false
  process.env.SUMUP_ENABLED = "false";
  const configDisabled = sumupConfig();
  assert.equal(configDisabled.enabled, false);
});

test("uses the explicitly configured merchant without automatic account switching", async () => {
  process.env.SUMUP_ENABLED = "true";
  process.env.SUMUP_API_KEY = "sup_sk_secret";
  process.env.SUMUP_MERCHANT_CODE = "mu97c6dc";
  process.env.SUMUP_RETURN_URL = "https://agenda.example/return";
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    return new Response(
      JSON.stringify({
        id: "checkout-1",
        status: "PENDING",
        hosted_checkout_url: "https://checkout.sumup.com/pay/checkout-1",
      }),
      { status: 201, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    await createSumupCheckout({
      reference: "payment-1",
      amount: 10,
      description: "Teste",
      hostedCheckout: true,
    });
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(requests.length, 1);
  const checkoutBody = JSON.parse(requests[0].options.body);
  assert.equal(checkoutBody.merchant_code, "MU97C6DC");
});

test("requires an explicit merchant code instead of selecting a linked account", async () => {
  process.env.SUMUP_ENABLED = "true";
  process.env.SUMUP_API_KEY = "sup_sk_membership_secret";
  delete process.env.SUMUP_MERCHANT_CODE;
  process.env.SUMUP_RETURN_URL = "https://agenda.example/return";
  const originalFetch = global.fetch;
  let fetchCalled = false;
  global.fetch = async () => {
    fetchCalled = true;
    throw new Error("fetch should not be called");
  };

  try {
    await assert.rejects(
      createSumupCheckout({
        reference: "payment-membership",
        amount: 10,
        description: "Teste membership",
        hostedCheckout: true,
      }),
      (error) => {
        assert.equal(error.code, "SUMUP_NOT_CONFIGURED");
        assert.match(error.message, /SUMUP_MERCHANT_CODE/);
        return true;
      },
    );
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(fetchCalled, false);
});

test("returns an actionable error when SumUp rejects the authenticated merchant", async () => {
  process.env.SUMUP_ENABLED = "true";
  process.env.SUMUP_API_KEY = "sup_sk_rejected_merchant";
  process.env.SUMUP_MERCHANT_CODE = "MU97C6DC";
  process.env.SUMUP_RETURN_URL = "https://agenda.example/return";
  const originalFetch = global.fetch;
  global.fetch = async () => {
    return new Response(
      JSON.stringify({
        error_code: "INVALID",
        message: "Validation error",
        param: "merchant_code",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    await assert.rejects(
      createSumupCheckout({
        reference: "payment-rejected-merchant",
        amount: 10,
        description: "Teste merchant rejeitado",
        hostedCheckout: true,
      }),
      (error) => {
        assert.equal(error.code, "SUMUP_MERCHANT_REJECTED");
        assert.equal(error.providerParam, "merchant_code");
        assert.match(error.message, /Pagamentos Online/);
        return true;
      },
    );
  } finally {
    global.fetch = originalFetch;
  }
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
