import { query } from "../server/lib/db.js";
import { requireUser } from "../server/lib/auth.js";
import {
  baileysConfig,
  ensureBaileysReady,
  getBaileysQr,
  getBaileysStatus,
  logoutBaileysSession,
  requestBaileysPairingCode,
  resetBaileysSession,
  sendBaileysTextMessage,
} from "../server/lib/baileys-client.js";
import {
  appError,
  getBody,
  handleError,
  methodNotAllowed,
  send,
} from "../server/lib/http.js";
import {
  isMessageWebhookPayload,
  processIncomingWhatsAppWebhook,
} from "../server/lib/whatsapp-ai-engine.js";

const QR_POLL_ATTEMPTS = 6;
const QR_POLL_DELAY_MS = 1200;

async function context(user) {
  if (!["admin", "professional"].includes(user.role))
    throw appError("Acesso negado.", 403);
  return {
    sessionName: String(process.env.BAILEYS_DEFAULT_INSTANCE || "carol-sol"),
    professionalId: null,
  };
}

export function normalizeStatus(data) {
  const rawStatus =
    data?.status ||
      data?.state ||
      data?.instance?.state ||
      data?.connectionStatus;
  const value = String(rawStatus || "disconnected").toLowerCase();
  if (
    qrValue(data) &&
    (!rawStatus || ["unknown", "qr", "qrcode", "awaiting_scan"].includes(value))
  )
    return "qrcode";
  if (["open", "connected", "online", "ready"].includes(value))
    return "connected";
  if (["connecting", "starting", "reconnecting"].includes(value))
    return "connecting";
  if (["pairing", "pairing_code", "pairing-code"].includes(value))
    return "pairing_code";
  if (["qr", "qrcode", "awaiting_scan"].includes(value)) return "qrcode";
  if (
    ["close", "closed", "disconnected", "offline", "logged_out"].includes(
      value,
    )
  )
    return "disconnected";
  return value;
}
export function qrValue(data) {
  return (
    data?.qr_code_data ||
    data?.qrCode ||
    data?.qrcode?.base64 ||
    data?.base64 ||
    data?.qr ||
    data?.code ||
    null
  );
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mergeProviderData(...payloads) {
  const merged = Object.assign({}, ...payloads.filter(Boolean));
  if (payloads.some((payload) => qrValue(payload))) {
    const status = normalizeStatus(merged);
    if (!["connected"].includes(status)) merged.status = "qrcode";
  }
  return merged;
}

function maskPhoneLike(value) {
  const text = String(value || "");
  return text.replace(/\d(?=\d{4})/g, "•");
}

function providerDiagnostics(data) {
  if (!data) return null;
  const webhook = data.webhook || null;
  return {
    engine: data.engine || null,
    status: normalizeStatus(data),
    hasQr: Boolean(data.hasQr || qrValue(data)),
    accountName: data.account_name || data.name || null,
    accountNumber: data.phone_number ? maskPhoneLike(data.phone_number) : null,
    lastReadyAt: data.lastReadyAt || null,
    lastSessionSavedAt: data.lastSessionSavedAt || null,
    lastQrGeneratedAt: data.lastQrGeneratedAt || null,
    lastDisconnectReason: data.lastDisconnectReason || null,
    lastDisconnectAt: data.lastDisconnectAt || null,
    webhook: webhook
      ? {
          configured: Boolean(webhook.configured),
          usingFallback: Boolean(webhook.usingFallback),
          target: webhook.target || null,
          lastIncomingMessageAt: webhook.lastIncomingMessageAt || null,
          lastIncomingFrom: webhook.lastIncomingFrom
            ? maskPhoneLike(webhook.lastIncomingFrom)
            : null,
          lastIncomingFromMe: webhook.lastIncomingFromMe ?? null,
          lastIncomingHasText: webhook.lastIncomingHasText ?? null,
          lastWebhookAttemptAt: webhook.lastWebhookAttemptAt || null,
          lastWebhookTarget: webhook.lastWebhookTarget || null,
          lastWebhookStatus: webhook.lastWebhookStatus || null,
          lastWebhookError: webhook.lastWebhookError || null,
          lastUpsertCount: webhook.lastUpsertCount ?? null,
          lastUpsertType: webhook.lastUpsertType || null,
          recentEvents: Array.isArray(webhook.recentEvents)
            ? webhook.recentEvents.slice(0, 10).map((event) => ({
                ...event,
                from: event.from ? maskPhoneLike(event.from) : null,
                participant: event.participant
                  ? maskPhoneLike(event.participant)
                  : null,
                phone: event.phone ? maskPhoneLike(event.phone) : null,
              }))
            : [],
        }
      : null,
  };
}

async function saveSession(ctx, data, error = null) {
  const status = error ? "error" : normalizeStatus(data);
  const qr = qrValue(data);
  const phone =
    data?.phone_number || data?.number || data?.instance?.number || null;
  const { rows } = await query(
    `insert into public.whatsapp_sessions(professional_id,session_name,phone_number,account_name,connection_status,qr_code_data,last_connected_at,last_activity_at,last_error) values($1,$2,$3,$4,$5,$6,case when $5='connected' then now() end,now(),$7) on conflict(session_name) do update set phone_number=coalesce(excluded.phone_number,whatsapp_sessions.phone_number),account_name=coalesce(excluded.account_name,whatsapp_sessions.account_name),connection_status=excluded.connection_status,qr_code_data=case when excluded.connection_status in ('connected','disconnected') then null else coalesce(excluded.qr_code_data,whatsapp_sessions.qr_code_data) end,last_connected_at=case when excluded.connection_status='connected' then now() else whatsapp_sessions.last_connected_at end,last_activity_at=now(),last_error=excluded.last_error,updated_at=now() returning *`,
    [
      ctx.professionalId,
      ctx.sessionName,
      phone,
      data?.account_name || data?.name || null,
      status,
      qr,
      error,
    ],
  );
  return rows[0];
}

async function getPanel(user) {
  const ctx = await context(user);
  const config = baileysConfig();
  let live = null;
  let error = null;
  if (config.configured)
    try {
      live = (await getBaileysStatus()).data;
      if (["connecting", "qrcode", "pairing_code"].includes(normalizeStatus(live))) {
        try {
          const qr = (await getBaileysQr()).data;
          if (qrValue(qr)) live = mergeProviderData(live, qr);
        } catch (qrError) {
          console.error("WhatsApp QR refresh error", {
            message: qrError.message,
          });
        }
      }
    } catch (e) {
      error = e.message;
    }
  const session = live
    ? await saveSession(ctx, live)
    : error
      ? await saveSession(ctx, {}, error)
      : (
          await query(
            "select * from public.whatsapp_sessions where session_name=$1",
            [ctx.sessionName],
          )
        ).rows[0] || null;
  return {
    configured: config.configured,
    enabled: ["1", "true", "yes", "on"].includes(
      String(process.env.BAILEYS_ENABLED || "").toLowerCase(),
    ),
    session: session || {
      session_name: ctx.sessionName,
      connection_status: "disconnected",
    },
    liveStatus: live ? normalizeStatus(live) : null,
    provider: providerDiagnostics(live),
    error,
  };
}

async function readQrOrStatus(current = null) {
  let statusData = current;
  try {
    const freshStatus = (await getBaileysStatus()).data;
    statusData = statusData
      ? mergeProviderData(statusData, freshStatus)
      : freshStatus;
  } catch (error) {
    if (!statusData) throw error;
    console.error("WhatsApp status refresh error", { message: error.message });
  }
  if (normalizeStatus(statusData) === "connected") return statusData;

  try {
    const qrData = (await getBaileysQr()).data;
    if (qrValue(qrData)) return mergeProviderData(statusData, qrData);
    return mergeProviderData(statusData, qrData);
  } catch (error) {
    console.error("WhatsApp QR read error", { message: error.message });
    return statusData;
  }
}

async function startBaileysQr({ resetFirst = false } = {}) {
  let latest = null;

  if (!resetFirst) {
    latest = await readQrOrStatus();
    if (normalizeStatus(latest) === "connected" || qrValue(latest)) return latest;
  }

  latest = mergeProviderData(await resetBaileysSession().then((result) => result.data));
  if (!latest.status || normalizeStatus(latest) === "disconnected")
    latest = { ...latest, status: "starting" };

  for (let attempt = 0; attempt < QR_POLL_ATTEMPTS; attempt += 1) {
    await wait(QR_POLL_DELAY_MS);
    latest = await readQrOrStatus(latest);
    if (normalizeStatus(latest) === "connected" || qrValue(latest)) return latest;
  }

  return latest;
}

async function action(user, body) {
  const ctx = await context(user);
  const action = String(body.action || "");
  if (action === "test") {
    if (!body.phone) throw appError("Informe o telefone para o teste.");
    const result = await sendBaileysTextMessage({
      number: body.phone,
      text: "Mensagem de teste da Carol Sol. Integração WhatsApp funcionando.",
    });
    return { ok: true, result: result.data };
  }
  try {
    let result;
    if (["connect", "qr"].includes(action)) {
      result = { data: await startBaileysQr({ resetFirst: false }) };
    }
    else if (action === "status") result = await getBaileysStatus();
    else if (action === "keepalive") {
      const health = await ensureBaileysReady({
        source: "panel_keepalive",
        reconnect: true,
        forceReconnect: body.forceReconnect === true,
      });
      return {
        ok: true,
        session: await saveSession(ctx, health.data || { status: health.status }),
        provider: health,
      };
    }
    else if (action === "pairing_code") {
      if (!body.phone) throw appError("Informe o telefone para gerar o código.");
      result = await requestBaileysPairingCode({ number: body.phone });
    }
    else if (action === "restart") {
      result = { data: await startBaileysQr({ resetFirst: true }) };
    } else if (action === "disconnect") {
      result = await logoutBaileysSession();
      result.data = { ...result.data, status: "logged_out", qr: null };
    } else throw appError("Ação inválida.");
    const data = result.data;
    return { ok: true, session: await saveSession(ctx, data), provider: data };
  } catch (error) {
    await saveSession(ctx, {}, error.message);
    throw error;
  }
}

async function keepalive(req, res, body) {
  const expected = process.env.BAILEYS_KEEPALIVE_SECRET || process.env.CRON_SECRET;
  const authorization = String(req.headers.authorization || "");
  const provided =
    (authorization.startsWith("Bearer ") ? authorization.slice(7) : "") ||
    req.headers["x-keepalive-secret"] ||
    req.headers["x-cron-secret"] ||
    req.query?.secret;

  if (!expected || provided !== expected) throw appError("Keepalive nao autorizado.", 401);

  const ctx = {
    sessionName: String(process.env.BAILEYS_DEFAULT_INSTANCE || "carol-sol"),
    professionalId: null,
  };

  try {
    const result = await ensureBaileysReady({
      source: "whatsapp_keepalive",
      reconnect: true,
      forceReconnect: req.query?.force === "1" || body.forceReconnect === true,
    });
    const session = await saveSession(ctx, result.data || { status: result.status });
    return send(res, 200, { ok: true, data: { ...result, session } });
  } catch (error) {
    await saveSession(ctx, {}, error.message).catch(() => {});
    throw error;
  }
}

async function webhook(req, res, body) {
  const secret = req.headers["x-webhook-secret"] || req.query?.secret;
  if (
    process.env.BAILEYS_WEBHOOK_SECRET &&
    secret !== process.env.BAILEYS_WEBHOOK_SECRET
  )
    throw appError("Webhook não autorizado.", 401);
  const payload = body || {};
  if (isMessageWebhookPayload(payload)) {
    const result = await processIncomingWhatsAppWebhook(payload);
    return send(res, 200, { ok: true, ...result });
  }
  const sessionName =
    payload.session_name ||
    payload.instance ||
    payload.session ||
    String(process.env.BAILEYS_DEFAULT_INSTANCE || "carol-sol");
  const existing = await query(
    "select professional_id from public.whatsapp_sessions where session_name=$1",
    [sessionName],
  );
  await saveSession(
    { sessionName, professionalId: existing.rows[0]?.professional_id || null },
    payload,
  );
  return send(res, 200, { ok: true });
}

export default async function handler(req, res) {
  try {
    const resource = req.query?.resource || "panel";
    const body = getBody(req);
    if (resource === "webhook" && req.method === "POST")
      return await webhook(req, res, body);
    if (resource === "keepalive" && ["GET", "POST"].includes(req.method))
      return await keepalive(req, res, body);
    const user = await requireUser(req, ["admin", "professional"]);
    if (req.method === "GET")
      return send(res, 200, { data: await getPanel(user) });
    if (req.method === "POST")
      return send(res, 200, { data: await action(user, body) });
    return methodNotAllowed(res, ["GET", "POST"]);
  } catch (error) {
    return handleError(res, error);
  }
}
