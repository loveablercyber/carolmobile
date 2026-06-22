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
    });
  }
  return data;
}

export async function createSumupCheckout({
  reference,
  amount,
  description,
  returnUrl,
}) {
  const config = configured();
  const checkout = await sumupRequest("/v0.1/checkouts", {
    method: "POST",
    body: JSON.stringify({
      checkout_reference: reference,
      amount: Number(amount),
      currency: "BRL",
      merchant_code: config.merchantCode,
      description,
      return_url: returnUrl || config.returnUrl,
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
  return { ...checkout, hostedUrl };
}

export const retrieveSumupCheckout = (id) =>
  sumupRequest(`/v0.1/checkouts/${encodeURIComponent(id)}`);

export function mapSumupStatus(value) {
  const status = String(value || "").toUpperCase();
  if (["PAID", "SUCCESSFUL"].includes(status)) return "paid";
  if (["FAILED", "DECLINED"].includes(status)) return "failed";
  if (status === "CANCELLED") return "cancelled";
  if (status === "EXPIRED") return "expired";
  if (["PROCESSING", "PENDING"].includes(status)) return status.toLowerCase();
  return "awaiting_confirmation";
}
