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
  if (!config.enabled || !config.apiKey)
    throw Object.assign(
      new Error("A integração SumUp ainda não está configurada."),
      { status: 503 },
    );
  return config;
}

const MERCHANT_CODE_PATTERN = /^[A-Z0-9]{8}$/;
let merchantCodePromise = null;
let merchantCodeApiKey = "";

const normalizeMerchantCode = (value) =>
  typeof value === "string" ? value.trim().toUpperCase() : "";

function findMerchantCode(value, depth = 0) {
  if (!value || depth > 5) return "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findMerchantCode(item, depth + 1);
      if (found) return found;
    }
    return "";
  }
  if (typeof value !== "object") return "";
  for (const key of ["merchant_code", "merchantCode"]) {
    const candidate = normalizeMerchantCode(value[key]);
    if (MERCHANT_CODE_PATTERN.test(candidate)) return candidate;
  }
  for (const nested of Object.values(value)) {
    const found = findMerchantCode(nested, depth + 1);
    if (found) return found;
  }
  return "";
}

function findMembershipMerchantCodes(value) {
  if (!value || typeof value !== "object") return [];
  const items = Array.isArray(value.items) ? value.items : [];
  const codes = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const resource = item.resource && typeof item.resource === "object"
      ? item.resource
      : {};
    const type = String(item.type || resource.type || "").toLowerCase();
    const status = String(item.status || "accepted").toLowerCase();
    if (type !== "merchant" || !["accepted", ""].includes(status)) continue;
    const candidate = normalizeMerchantCode(item.resource_id || resource.id);
    if (MERCHANT_CODE_PATTERN.test(candidate) && !codes.includes(candidate)) {
      codes.push(candidate);
    }
  }
  return codes;
}

async function fetchMerchantCode(path, config) {
  const response = await fetch(`https://api.sumup.com${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
  });
  if (response.status === 401) {
    throw new Error("SUMUP_API_KEY recusada pela SumUp. Gere e configure uma nova chave secreta.");
  }
  if (!response.ok) return "";
  return findMerchantCode(await response.json());
}

async function fetchMembershipMerchantCodes(config) {
  const response = await fetch(
    "https://api.sumup.com/v0.1/memberships?kind=merchant&status=accepted&limit=25",
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
    },
  );
  if (response.status === 401) {
    throw new Error("SUMUP_API_KEY recusada pela SumUp. Gere e configure uma nova chave secreta.");
  }
  if (!response.ok) return [];
  return findMembershipMerchantCodes(await response.json());
}

async function validateConfiguredMerchantCode(code, config) {
  if (!MERCHANT_CODE_PATTERN.test(code)) return false;
  const response = await fetch(
    `https://api.sumup.com/v1/merchants/${encodeURIComponent(code)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
    },
  );
  if (response.status === 401) {
    throw new Error("SUMUP_API_KEY recusada pela SumUp. Gere e configure uma nova chave secreta.");
  }
  if (!response.ok) return false;
  return findMerchantCode(await response.json()) === code;
}

async function resolveMerchantCode() {
  const currentConfig = configured();
  if (merchantCodeApiKey !== currentConfig.apiKey) {
    merchantCodePromise = null;
    merchantCodeApiKey = currentConfig.apiKey;
  }
  if (merchantCodePromise) return merchantCodePromise;
  merchantCodePromise = (async () => {
    const config = currentConfig;
    const configuredCode = normalizeMerchantCode(config.merchantCode);
    try {
      const profileCode = await fetchMerchantCode("/v0.1/me", config);
      if (profileCode) {
        if (configuredCode && profileCode !== configuredCode) {
          console.warn(
            "[SumUp] SUMUP_MERCHANT_CODE does not match SUMUP_API_KEY; using the API profile.",
          );
        }
        return profileCode;
      }

      const membershipCodes = await fetchMembershipMerchantCodes(config);
      if (configuredCode && membershipCodes.includes(configuredCode)) {
        return configuredCode;
      }
      if (membershipCodes.length === 1) {
        if (configuredCode && membershipCodes[0] !== configuredCode) {
          console.warn(
            "[SumUp] SUMUP_MERCHANT_CODE does not match the API-key membership; using the authorized merchant.",
          );
        }
        return membershipCodes[0];
      }
      if (membershipCodes.length > 1) {
        throw new Error(
          "A chave possui mais de uma conta comercial. Configure SUMUP_MERCHANT_CODE com uma das contas vinculadas.",
        );
      }
      if (
        MERCHANT_CODE_PATTERN.test(configuredCode) &&
        (await validateConfiguredMerchantCode(configuredCode, config))
      ) {
        return configuredCode;
      }
    } catch (error) {
      console.warn("[SumUp] Merchant profile lookup unavailable.", error);
      if (
        error?.message?.includes("mais de uma conta comercial") ||
        error?.message?.includes("SUMUP_API_KEY recusada")
      ) {
        throw error;
      }
    }
    throw Object.assign(
      new Error(
        "A SumUp autenticou a chave, mas não informou uma conta comercial autorizada. Gere uma nova chave secreta dentro da conta comercial correta.",
      ),
      { status: 503 },
    );
  })();
  try {
    return await merchantCodePromise;
  } catch (error) {
    merchantCodePromise = null;
    throw error;
  }
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
    if (data?.param === "merchant_code") {
      merchantCodePromise = null;
    }
    const safeMessage =
      data?.param === "merchant_code"
        ? "A SumUp não reconheceu uma conta comercial autorizada para esta chave. Gere a chave secreta dentro da conta comercial que receberá o pagamento."
        : message;
    throw Object.assign(new Error(safeMessage), {
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
  const merchantCode = await resolveMerchantCode();
  const callbackUrl = returnUrl || (useDefaultReturnUrl ? config.returnUrl : "");
  const { data: checkout, requestPayload } = await sumupRequest("/v0.1/checkouts", {
    method: "POST",
    body: JSON.stringify({
      checkout_reference: reference,
      amount: Number(amount),
      currency: "BRL",
      merchant_code: merchantCode,
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

export const deactivateSumupCheckout = (id) =>
  sumupRequest(`/v0.1/checkouts/${encodeURIComponent(id)}`, {
    method: "DELETE",
  }).then((result) => result.data);

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
