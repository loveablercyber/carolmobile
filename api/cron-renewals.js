import { handleError, send } from "../server/lib/http.js";
import { runRecurringRenewals } from "../server/lib/recurring-billing.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET" && req.method !== "POST")
      return send(res, 405, { error: "Método não permitido." });
    const expected = process.env.CRON_SECRET;
    if (!expected || req.headers.authorization !== `Bearer ${expected}`)
      return send(res, 401, { error: "Não autorizado." });
    const execute =
      req.method === "POST" &&
      (req.query?.execute === "1" ||
        req.headers["x-recurring-execute"] === "true");
    const result = await runRecurringRenewals({
      limit: process.env.RECURRING_BATCH_LIMIT || 5,
      execute,
    });
    return send(res, 200, { ok: true, ...result });
  } catch (error) {
    console.error("Recurring cron error", {
      status: error.status || 500,
      message: error.message,
    });
    return handleError(res, error);
  }
}
