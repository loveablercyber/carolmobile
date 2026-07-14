import { query } from "../server/lib/db.js";
import { cloudinaryProviders, isMinioConfigured } from "../server/lib/integrations.js";
import { handleError, send } from "../server/lib/http.js";

const truthy = (value) =>
  ["1", "true", "yes", "on", "sim"].includes(String(value || "").toLowerCase());

export default async function handler(req, res) {
  try {
    const { rows } = await query("select now() as now");
    return send(res, 200, {
      ok: true,
      brand: "Carol Sol",
      database: Boolean(rows[0]?.now),
      integrations: {
        resend: Boolean(
          process.env.RESEND_API_KEY && process.env.NOTIFICATION_EMAIL_FROM,
        ),
        baileys: Boolean(
          process.env.BAILEYS_ENABLED &&
            process.env.BAILEYS_API_URL &&
            process.env.BAILEYS_API_KEY,
        ),
        cloudinary: Boolean(cloudinaryProviders().length || isMinioConfigured() || truthy(process.env.LOCAL_UPLOAD_ENABLED)),
        storage: isMinioConfigured()
          ? "minio"
          : truthy(process.env.LOCAL_UPLOAD_ENABLED)
            ? "local"
            : cloudinaryProviders().length
              ? "cloudinary"
              : "none",
        sumup: Boolean(
          process.env.SUMUP_ENABLED &&
            process.env.SUMUP_API_KEY &&
            process.env.SUMUP_MERCHANT_CODE,
        ),
        notifications: Boolean(process.env.ADMIN_NOTIFICATION_EMAIL),
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
}
