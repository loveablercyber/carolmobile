import { handleError, send } from "../server/lib/http.js";
import {
  aiWhatsappMigrationStatus,
  applyAiWhatsappMigration,
} from "../server/lib/ai-whatsapp.js";
import {
  applyCardTokenizationMigration,
  applyRecurringBillingMigration,
  cardTokenizationMigrationStatus,
  recurringMigrationStatus,
} from "../server/lib/recurring-migration.js";

function authorized(req) {
  const expected = process.env.CRON_SECRET;
  return expected && req.headers.authorization === `Bearer ${expected}`;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET" && req.method !== "POST")
      return send(res, 405, { error: "Método não permitido." });
    if (!authorized(req)) return send(res, 401, { error: "Não autorizado." });
    if (
      req.query?.resource !== "recurring-billing" &&
      req.query?.resource !== "card-tokenization" &&
      req.query?.resource !== "ai-whatsapp"
    )
      return send(res, 404, { error: "Migração não encontrada." });
    if (req.query?.resource === "ai-whatsapp") {
      if (req.method === "GET")
        return send(res, 200, {
          ok: true,
          migration: await aiWhatsappMigrationStatus(),
        });
      const result = await applyAiWhatsappMigration();
      return send(res, 200, {
        ok: true,
        ...result,
        migration: await aiWhatsappMigrationStatus(),
      });
    }
    if (req.query?.resource === "card-tokenization") {
      if (req.method === "GET")
        return send(res, 200, {
          ok: true,
          migration: await cardTokenizationMigrationStatus(),
        });
      const result = await applyCardTokenizationMigration();
      return send(res, 200, {
        ok: true,
        ...result,
        migration: await cardTokenizationMigrationStatus(),
      });
    }
    if (req.method === "GET")
      return send(res, 200, {
        ok: true,
        migration: await recurringMigrationStatus(),
      });
    const result = await applyRecurringBillingMigration();
    return send(res, 200, {
      ok: true,
      ...result,
      migration: await recurringMigrationStatus(),
    });
  } catch (error) {
    console.error("Admin migration error", {
      resource: req.query?.resource,
      status: error.status || 500,
      message: error.message,
    });
    return handleError(res, error);
  }
}
