import { handleError, send } from "../server/lib/http.js";
import {
  prepareRecurringSandboxCandidate,
  recurringSandboxOverview,
} from "../server/lib/recurring-sandbox-scenario.js";

function authorized(req) {
  const expected = process.env.CRON_SECRET;
  return expected && req.headers.authorization === `Bearer ${expected}`;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET" && req.method !== "POST")
      return send(res, 405, { error: "Método não permitido." });
    if (!authorized(req)) return send(res, 401, { error: "Não autorizado." });
    if (req.method === "GET")
      return send(res, 200, { ok: true, ...(await recurringSandboxOverview()) });
    const body =
      typeof req.body === "string" && req.body
        ? JSON.parse(req.body)
        : req.body || {};
    if (body.action !== "prepare")
      return send(res, 400, { error: "Ação inválida." });
    return send(res, 200, {
      ok: true,
      result: await prepareRecurringSandboxCandidate(),
      overview: await recurringSandboxOverview(),
    });
  } catch (error) {
    console.error("Recurring sandbox scenario error", {
      method: req.method,
      status: error.status || 500,
      message: error.message,
    });
    return handleError(res, error);
  }
}
