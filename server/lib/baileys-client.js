const DEFAULT_TIMEOUT_MS = 20_000;
const RECONNECT_COOLDOWN_MS = Number.parseInt(
  process.env.BAILEYS_RECONNECT_COOLDOWN_MS || "120000",
  10,
);

let lastReconnectAttemptAt = 0;

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
  const provider = String(process.env.BAILEYS_PROVIDER || "wrapper").trim().toLowerCase();
  const instance = String(process.env.BAILEYS_DEFAULT_INSTANCE || "carol-sol").trim();
  return { baseUrl, apiKey, provider, instance, configured: Boolean(baseUrl && apiKey) };
}

export function buildEvolutionWebhookUrl() {
  const appUrl = String(process.env.APP_URL || "").trim().replace(/\/+$/, "");
  const secret = String(process.env.BAILEYS_WEBHOOK_SECRET || "").trim();
  if (!appUrl || !secret) return "";
  const url = new URL(`${appUrl}/api/whatsapp`);
  url.searchParams.set("resource", "webhook");
  url.searchParams.set("secret", secret);
  return url.toString();
}

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

function falsey(value) {
  return ["0", "false", "no", "off"].includes(String(value || "").toLowerCase());
}

export function normalizeBaileysStatusValue(data) {
  const rawStatus =
    data?.status ||
      data?.state ||
      data?.instance?.state ||
      data?.connectionStatus;
  const value = String(rawStatus || "disconnected").toLowerCase();
  const hasQr = Boolean(
    data?.qr_code_data ||
      data?.qrCode ||
      data?.qrcode?.base64 ||
      data?.base64 ||
      data?.qr ||
      data?.code,
  );
  if (hasQr && (!rawStatus || ["unknown", "qr", "qrcode", "awaiting_scan"].includes(value)))
    return "qrcode";
  return value;
}

export function isBaileysReadyStatus(value) {
  return ["ready", "open", "connected", "online"].includes(String(value || "").toLowerCase());
}

function shouldAutoReconnect() {
  if (falsey(process.env.BAILEYS_AUTO_RECONNECT)) return false;
  if (truthy(process.env.BAILEYS_AUTO_RECONNECT)) return true;
  return !falsey(process.env.BAILEYS_ENABLED);
}

function reconnectAllowed(status, forceReconnect) {
  if (forceReconnect) return true;
  return !["qr", "qrcode", "awaiting_scan", "pairing", "pairing_code", "pairing-code", "logged_out"].includes(status);
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
  if (response.status === 429)
    return new BaileysClientError(
      providerMessage || "O WhatsApp limitou novas tentativas. Aguarde antes de gerar outro código.",
      { status: 429, code: "BAILEYS_RATE_LIMITED", providerStatus: 429 },
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
  if (config.provider === "evolution") {
    return requestEvolution(config, path, { method, body });
  }
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

function evolutionRequestOptions(path, { method = "GET", body } = {}, config) {
  const instance = encodeURIComponent(config.instance);
  if (path === "/api/status") {
    return { path: `/instance/connectionState/${instance}`, method: "GET" };
  }
  if (path === "/api/reset-session") {
    return { path: `/instance/restart/${instance}`, method: "POST" };
  }
  if (path === "/api/qr") {
    return { path: `/instance/connect/${instance}`, method: "GET" };
  }
  if (path === "/api/logout") {
    return { path: `/instance/logout/${instance}`, method: "DELETE" };
  }
  if (path === "/api/send-text") {
    return {
      path: `/message/sendText/${instance}`,
      method: "POST",
      body: {
        number: body?.number,
        text: body?.text,
      },
    };
  }
  if (path === "/api/pairing-code") {
    return { path: `/instance/connect/${instance}`, method: "GET" };
  }
  if (path === "/api/presence") {
    return {
      skip: true,
      data: { status: "skipped", reason: "presence_not_required" },
    };
  }
  if (path === "/api/webhook") {
    return {
      path: `/webhook/set/${instance}`,
      method: "POST",
      body: {
        webhook: {
          enabled: true,
          url: body?.url,
          byEvents: false,
          base64: false,
          events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE", "QRCODE_UPDATED"],
        },
      },
    };
  }
  return { path, method, body };
}

async function requestEvolution(config, path, options = {}) {
  const mapped = evolutionRequestOptions(path, options, config);
  if (mapped.skip) {
    return { ok: true, status: "skipped", data: mapped.data };
  }
  let response;
  try {
    response = await fetch(`${config.baseUrl}${mapped.path}`, {
      method: mapped.method,
      headers: {
        "Content-Type": "application/json",
        apikey: config.apiKey,
        "x-api-key": config.apiKey,
      },
      body: mapped.body ? JSON.stringify(mapped.body) : undefined,
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    console.error("Evolution network error", {
      path: mapped.path,
      message: error.message,
    });
    throw new BaileysClientError(
      "Nao foi possivel conectar ao servidor do WhatsApp.",
      { status: 503, code: "BAILEYS_NETWORK_ERROR" },
    );
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw friendlyProviderError(response, data);
  const status = data?.instance?.state || data?.status || data?.connectionStatus || "unknown";
  return { ok: true, status: String(status), data };
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

export async function configureBaileysWebhook() {
  const config = baileysConfig();
  if (config.provider !== "evolution") {
    return { ok: true, skipped: true, reason: "provider_not_evolution" };
  }
  if (falsey(process.env.BAILEYS_AUTO_CONFIGURE_WEBHOOK)) {
    return { ok: true, skipped: true, reason: "disabled" };
  }
  const webhookUrl = buildEvolutionWebhookUrl();
  if (!webhookUrl) {
    return { ok: true, skipped: true, reason: "missing_app_url_or_secret" };
  }
  return request("/api/webhook", {
    method: "POST",
    body: { url: webhookUrl },
  });
}

export async function ensureBaileysReady({
  source = "healthcheck",
  reconnect = true,
  forceReconnect = false,
} = {}) {
  const statusResult = await getBaileysStatus();
  const beforeStatus = normalizeBaileysStatusValue(statusResult.data);
  let webhookResult = null;

  async function tryConfigureWebhook() {
    try {
      webhookResult = await configureBaileysWebhook();
    } catch (error) {
      webhookResult = {
        ok: false,
        code: error.code || "BAILEYS_WEBHOOK_CONFIG_FAILED",
        message: error.message,
      };
      console.error("Evolution webhook auto-config failed", {
        code: webhookResult.code,
        message: webhookResult.message,
      });
    }
  }

  if (isBaileysReadyStatus(beforeStatus)) {
    await tryConfigureWebhook();
    return {
      ok: true,
      ready: true,
      status: beforeStatus,
      beforeStatus,
      reconnected: false,
      webhook: webhookResult,
      source,
      data: statusResult.data,
    };
  }

  if (!reconnect || !shouldAutoReconnect() || !reconnectAllowed(beforeStatus, forceReconnect)) {
    return {
      ok: true,
      ready: false,
      status: beforeStatus,
      beforeStatus,
      reconnected: false,
      skipped: true,
      webhook: webhookResult,
      source,
      data: statusResult.data,
    };
  }

  const now = Date.now();
  const cooldownMs = Number.isFinite(RECONNECT_COOLDOWN_MS)
    ? Math.max(0, RECONNECT_COOLDOWN_MS)
    : 120000;

  if (!forceReconnect && lastReconnectAttemptAt && now - lastReconnectAttemptAt < cooldownMs) {
    return {
      ok: true,
      ready: false,
      status: beforeStatus,
      beforeStatus,
      reconnected: false,
      skipped: true,
      cooldownMs,
      webhook: webhookResult,
      source,
      data: statusResult.data,
    };
  }

  lastReconnectAttemptAt = now;
  const restartResult = await resetBaileysSession();
  const afterStatus = normalizeBaileysStatusValue(restartResult.data);
  if (isBaileysReadyStatus(afterStatus)) await tryConfigureWebhook();

  return {
    ok: true,
    ready: isBaileysReadyStatus(afterStatus),
    status: afterStatus,
    beforeStatus,
    reconnected: true,
    webhook: webhookResult,
    source,
    data: restartResult.data,
  };
}

export async function sendBaileysTextMessage({ number, text, skipStatusCheck = false }) {
  const normalizedNumber = normalizeBaileysNumber(number);
  const message = String(text || "").trim();
  if (!message)
    throw new BaileysClientError("Informe a mensagem de texto.", {
      status: 400,
      code: "BAILEYS_EMPTY_MESSAGE",
    });
  if (!skipStatusCheck) {
    const status = await ensureBaileysReady({ source: "send-text", reconnect: true });
    if (!status.ready)
      throw new BaileysClientError(
        "O WhatsApp ainda não está conectado. Escaneie o QR Code e aguarde o status ready.",
        { status: 503, code: "BAILEYS_NOT_READY" },
      );
  }
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

export async function sendBaileysPresence({ number, presence = "composing" }) {
  const normalizedNumber = normalizeBaileysNumber(number);
  return request("/api/presence", {
    method: "POST",
    body: { number: normalizedNumber, presence },
  }).catch((err) => {
    console.error("Failed to send presence state", err.message);
    return null;
  });
}
