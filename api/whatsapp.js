import { query } from "../server/lib/db.js";
import { requireUser } from "../server/lib/auth.js";
import { sendWhatsApp } from "../server/lib/integrations.js";
import {
  appError,
  getBody,
  handleError,
  methodNotAllowed,
  send,
} from "../server/lib/http.js";

const baseUrl = () =>
  String(
    process.env.BAILEYS_API_BASE_URL || process.env.BAILEYS_API_URL || "",
  ).replace(/\/$/, "");
const configured = () =>
  Boolean(
    baseUrl() && (process.env.BAILEYS_API_KEY || process.env.BAILEYS_API_TOKEN),
  );
const headers = () => {
  const h = { "Content-Type": "application/json" };
  if (process.env.BAILEYS_API_KEY) {
    h["x-api-key"] = process.env.BAILEYS_API_KEY;
    h.apikey = process.env.BAILEYS_API_KEY;
  }
  if (process.env.BAILEYS_API_TOKEN)
    h.Authorization = `Bearer ${process.env.BAILEYS_API_TOKEN}`;
  return h;
};

async function context(user) {
  if (user.role === "admin")
    return {
      sessionName: String(process.env.BAILEYS_DEFAULT_INSTANCE || "carol-sol"),
      professionalId: null,
    };
  if (user.role === "professional") {
    const { rows } = await query(
      "select id from public.professionals where profile_id=$1",
      [user.id],
    );
    if (!rows[0]) throw appError("Profissional não encontrada.", 404);
    return {
      sessionName: `carol-sol-${String(rows[0].id).slice(0, 8)}`,
      professionalId: rows[0].id,
    };
  }
  throw appError("Acesso negado.", 403);
}

async function providerCall(attempts) {
  if (!configured())
    throw appError("O servidor do WhatsApp ainda não está configurado.", 503);
  let lastError = "Endpoint não encontrado.";
  for (const attempt of attempts) {
    try {
      const response = await fetch(`${baseUrl()}${attempt.path}`, {
        method: attempt.method || "GET",
        headers: headers(),
        body: attempt.body ? JSON.stringify(attempt.body) : undefined,
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) return data;
      lastError =
        data.message || data.error || `WhatsApp respondeu ${response.status}`;
      if (![404, 405].includes(response.status)) break;
    } catch (error) {
      lastError = error.message;
    }
  }
  throw appError(lastError, 502);
}

function normalizeStatus(data) {
  const value = String(
    data?.status ||
      data?.state ||
      data?.instance?.state ||
      data?.connectionStatus ||
      "disconnected",
  ).toLowerCase();
  if (["open", "connected", "online"].includes(value)) return "connected";
  if (["connecting", "starting"].includes(value)) return "connecting";
  if (["close", "closed", "disconnected", "offline"].includes(value))
    return "disconnected";
  return value;
}
function qrValue(data) {
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
  let live = null;
  let error = null;
  if (configured())
    try {
      live = await providerCall([
        { path: `/sessions/${encodeURIComponent(ctx.sessionName)}/status` },
        {
          path: `/instance/connectionState/${encodeURIComponent(ctx.sessionName)}`,
        },
      ]);
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
    configured: configured(),
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
    const result = await sendWhatsApp({
      to: body.phone,
      text: "Mensagem de teste da Carol Sol. Integração WhatsApp funcionando.",
    });
    return { ok: true, result };
  }
  const calls = {
    connect: [
      {
        method: "POST",
        path: `/sessions/${encodeURIComponent(ctx.sessionName)}/connect`,
        body: {},
      },
      {
        method: "GET",
        path: `/instance/connect/${encodeURIComponent(ctx.sessionName)}`,
      },
    ],
    qr: [
      { path: `/sessions/${encodeURIComponent(ctx.sessionName)}/qr` },
      {
        method: "GET",
        path: `/instance/connect/${encodeURIComponent(ctx.sessionName)}`,
      },
    ],
    disconnect: [
      {
        method: "POST",
        path: `/sessions/${encodeURIComponent(ctx.sessionName)}/disconnect`,
        body: {},
      },
      {
        method: "DELETE",
        path: `/instance/logout/${encodeURIComponent(ctx.sessionName)}`,
      },
    ],
    restart: [
      {
        method: "POST",
        path: `/sessions/${encodeURIComponent(ctx.sessionName)}/restart`,
        body: {},
      },
      {
        method: "PUT",
        path: `/instance/restart/${encodeURIComponent(ctx.sessionName)}`,
      },
    ],
    status: [
      { path: `/sessions/${encodeURIComponent(ctx.sessionName)}/status` },
      {
        path: `/instance/connectionState/${encodeURIComponent(ctx.sessionName)}`,
      },
    ],
  };
  if (!calls[action]) throw appError("Ação inválida.");
  try {
    const data = await providerCall(calls[action]);
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
  const sessionName = body.session_name || body.instance || body.session;
  if (!sessionName) throw appError("Sessão não informada.");
  const existing = await query(
    "select professional_id from public.whatsapp_sessions where session_name=$1",
    [sessionName],
  );
  await saveSession(
    { sessionName, professionalId: existing.rows[0]?.professional_id || null },
    body,
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
