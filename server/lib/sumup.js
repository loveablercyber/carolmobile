const truthy = (value) =>
  ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());

export function sumupConfig() {
  return {
    enabled: truthy(process.env.SUMUP_ENABLED),
    apiKey: process.env.SUMUP_API_KEY,
    merchantCode: process.env.SUMUP_MERCHANT_CODE,
    environment: process.env.SUMUP_ENVIRONMENT || "sandbox",
    returnUrl:
      process.env.SUMUP_RETURN_URL ||
      `${process.env.APP_URL || ""}/cliente/pagamento/retorno`,
    webhookSecret: process.env.SUMUP_WEBHOOK_SECRET,
  };
}

function configured() {
  const config = sumupConfig();
  if (!config.enabled || !config.apiKey || !config.merchantCode)
    throw Object.assign(
      new Error("A integração SumUp ainda não está configurada."),
      { status: 503 },
    );
  return config;
}

async function sumupRequest(path, options = {}) {
  const config = configured();
  const requestPayload = options.body
    ? (() => {
        try {
          return JSON.parse(options.body);
        } catch {
          return null;
        }
      })()
    : null;
  const response = await fetch(`https://api.sumup.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      data?.message ||
      data?.error_message ||
      `SumUp respondeu ${response.status}`;
    throw Object.assign(new Error(message), {
      status: response.status >= 500 ? 502 : 400,
      providerStatus: response.status,
      providerCode: data?.error_code || null,
      providerResponse: data,
      requestPayload,
    });
  }
  return { data, requestPayload };
}

export async function createSumupCheckout({
  reference,
  amount,
  description,
  returnUrl,
  customerId,
  purpose,
  useDefaultReturnUrl = true,
  hostedCheckout = false,
}) {
  const config = configured();
  const callbackUrl = returnUrl || (useDefaultReturnUrl ? config.returnUrl : "");
  const { data: checkout, requestPayload } = await sumupRequest("/v0.1/checkouts", {
    method: "POST",
    body: JSON.stringify({
      checkout_reference: reference,
      amount: Number(amount),
      currency: "BRL",
      merchant_code: config.merchantCode,
      description,
      ...(callbackUrl
        ? { return_url: callbackUrl, redirect_url: callbackUrl }
        : {}),
      ...(hostedCheckout ? { hosted_checkout: { enabled: true } } : {}),
      ...(customerId ? { customer_id: customerId } : {}),
      ...(purpose ? { purpose } : {}),
    }),
  });
  const links = Array.isArray(checkout.links) ? checkout.links : [];
  const hostedUrl =
    checkout.hosted_checkout_url ||
    checkout.checkout_url ||
    checkout.redirect_url ||
    links.find((link) =>
      ["checkout", "redirect", "hosted_checkout"].includes(link.rel),
    )?.href ||
    null;
  return { ...checkout, hostedUrl, requestPayload, rawResponse: checkout };
}

export const retrieveSumupCheckout = (id) =>
  sumupRequest(`/v0.1/checkouts/${encodeURIComponent(id)}`).then((result) => result.data);

export const processSumupCheckout = ({ checkoutId, token, customerId }) =>
  sumupRequest(`/v0.1/checkouts/${encodeURIComponent(checkoutId)}`, {
    method: "PUT",
    body: JSON.stringify({
      payment_type: "card",
      installments: 1,
      token,
      customer_id: customerId,
    }),
  }).then((result) => result.data);

export const createSumupCustomer = ({ customerId, personalDetails }) =>
  sumupRequest("/v0.1/customers", {
    method: "POST",
    body: JSON.stringify({
      customer_id: customerId,
      personal_details: personalDetails,
    }),
  }).then((result) => result.data);

export const retrieveSumupCustomer = (customerId) =>
  sumupRequest(`/v0.1/customers/${encodeURIComponent(customerId)}`).then((result) => result.data);

export const listSumupPaymentInstruments = (customerId) =>
  sumupRequest(
    `/v0.1/customers/${encodeURIComponent(customerId)}/payment-instruments`,
  ).then((result) => result.data);

export const deactivateSumupPaymentInstrument = (customerId, token) =>
  sumupRequest(
    `/v0.1/customers/${encodeURIComponent(customerId)}/payment-instruments/${encodeURIComponent(token)}`,
    { method: "DELETE" },
  ).then((result) => result.data);

export function mapSumupStatus(value) {
  const status = String(value || "").toUpperCase();
  if (["PAID", "SUCCESSFUL"].includes(status)) return "paid";
  if (["FAILED", "DECLINED"].includes(status)) return "failed";
  if (status === "CANCELLED") return "cancelled";
  if (status === "EXPIRED") return "expired";
  if (["PROCESSING", "PENDING"].includes(status)) return status.toLowerCase();
  return "awaiting_confirmation";
}
