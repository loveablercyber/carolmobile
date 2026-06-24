import { query } from "../server/lib/db.js";
import { requireUser } from "../server/lib/auth.js";
import {
  baileysConfig,
  getBaileysQr,
  getBaileysStatus,
  logoutBaileysSession,
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

async function context(user) {
  if (!["admin", "professional"].includes(user.role))
    throw appError("Acesso negado.", 403);
  return {
    sessionName: String(process.env.BAILEYS_DEFAULT_INSTANCE || "carol-sol"),
    professionalId: null,
  };
}

export function normalizeStatus(data) {
  const value = String(
    data?.status ||
      data?.state ||
      data?.instance?.state ||
      data?.connectionStatus ||
      "disconnected",
  ).toLowerCase();
  if (["open", "connected", "online", "ready"].includes(value))
    return "connected";
  if (["connecting", "starting", "reconnecting"].includes(value))
    return "connecting";
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

async function saveSession(ctx, data, error = null) {
  const status = error ? "error" : normalizeStatus(data);
  const qr = qrValue(data);
  const phone =
    data?.phone_number || data?.number || data?.instance?.number || null;
  const { rows } = await query(
    `insert into public.whatsapp_sessions(professional_id,session_name,phone_number,account_name,connection_status,qr_code_data,last_connected_at,last_activity_at,last_error) values($1,$2,$3,$4,$5,$6,case when $5='connected' then now() end,now(),$7) on conflict(session_name) do update set phone_number=coalesce(excluded.phone_number,whatsapp_sessions.phone_number),account_name=coalesce(excluded.account_name,whatsapp_sessions.account_name),connection_status=excluded.connection_status,qr_code_data=excluded.qr_code_data,last_connected_at=case when excluded.connection_status='connected' then now() else whatsapp_sessions.last_connected_at end,last_activity_at=now(),last_error=excluded.last_error,updated_at=now() returning *`,
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
    error,
  };
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
    if (["connect", "qr"].includes(action)) result = await getBaileysQr();
    else if (action === "status") result = await getBaileysStatus();
    else if (action === "restart") {
      result = await resetBaileysSession();
      result.data = { ...result.data, status: "starting" };
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

async function webhook(req, res, body) {
  const secret = req.headers["x-webhook-secret"] || req.query?.secret;
  if (
    process.env.BAILEYS_WEBHOOK_SECRET &&
    secret !== process.env.BAILEYS_WEBHOOK_SECRET
  )
    throw appError("Webhook não autorizado.", 401);
  const payload = body || {};
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
