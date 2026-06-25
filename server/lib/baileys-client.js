const DEFAULT_TIMEOUT_MS = 20_000;

export class BaileysClientError extends Error {
  constructor(message, { status = 502, code = "BAILEYS_ERROR", providerStatus = null } = {}) {
    super(message);
    this.name = "BaileysClientError";
    this.status = status;
    this.code = code;
    this.providerStatus = providerStatus;
    this.expose = true;
  }
}

export function baileysConfig() {
  const baseUrl = String(process.env.BAILEYS_API_URL || "")
    .trim()
    .replace(/\/+$/, "");
  const apiKey = String(process.env.BAILEYS_API_KEY || "").trim();
  return { baseUrl, apiKey, configured: Boolean(baseUrl && apiKey) };
}

function friendlyProviderError(response, data) {
  const providerMessage = String(data?.message || data?.error || "").trim();
  if (response.status === 401)
    return new BaileysClientError(
      "A credencial do servidor WhatsApp foi recusada.",
      { code: "BAILEYS_UNAUTHORIZED", providerStatus: 401 },
    );
  if (response.status === 503)
    return new BaileysClientError(
      providerMessage || "O WhatsApp ainda não está pronto. Escaneie o QR Code e tente novamente.",
      { status: 503, code: "BAILEYS_UNAVAILABLE", providerStatus: 503 },
    );
  return new BaileysClientError(
    providerMessage || `O servidor WhatsApp respondeu ${response.status}.`,
    { code: "BAILEYS_PROVIDER_ERROR", providerStatus: response.status },
  );
}

async function request(path, { method = "GET", body } = {}) {
  const config = baileysConfig();
  if (!config.configured)
    throw new BaileysClientError(
      "O servidor do WhatsApp ainda não está configurado.",
      { status: 503, code: "BAILEYS_NOT_CONFIGURED" },
    );
  let response;
  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    console.error("Baileys network error", {
      path,
      message: error.message,
    });
    throw new BaileysClientError(
      "Não foi possível conectar ao servidor do WhatsApp.",
      { status: 503, code: "BAILEYS_NETWORK_ERROR" },
    );
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw friendlyProviderError(response, data);
  return { ok: true, status: String(data.status || "unknown"), data };
}

export function normalizeBaileysNumber(value) {
  const number = String(value || "").replace(/\D/g, "");
  if (!/^55\d{10,11}$/.test(number))
    throw new BaileysClientError(
      "Informe o telefone com 55, DDD e número.",
      { status: 400, code: "BAILEYS_INVALID_NUMBER" },
    );
  return number;
}

export async function getBaileysStatus() {
  return request("/api/status");
}

export async function sendBaileysTextMessage({ number, text }) {
  const normalizedNumber = normalizeBaileysNumber(number);
  const message = String(text || "").trim();
  if (!message)
    throw new BaileysClientError("Informe a mensagem de texto.", {
      status: 400,
      code: "BAILEYS_EMPTY_MESSAGE",
    });
  const status = await getBaileysStatus();
  if (String(status.status).toLowerCase() !== "ready")
    throw new BaileysClientError(
      "O WhatsApp ainda não está conectado. Escaneie o QR Code e aguarde o status ready.",
      { status: 503, code: "BAILEYS_NOT_READY" },
    );
  return request("/api/send-text", {
    method: "POST",
    body: { number: normalizedNumber, text: message },
  });
}

export async function resetBaileysSession() {
  return request("/api/reset-session", { method: "POST" });
}

export async function getBaileysQr() {
  return request("/api/qr");
}

export async function requestBaileysPairingCode({ number }) {
  const normalizedNumber = normalizeBaileysNumber(number);
  return request("/api/pairing-code", {
    method: "POST",
    body: { number: normalizedNumber },
  });
}

export async function logoutBaileysSession() {
  return request("/api/logout", { method: "POST" });
}
