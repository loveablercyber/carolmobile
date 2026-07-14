import { createHash, createHmac } from "node:crypto";
import { unlink } from "node:fs/promises";
import { join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { sendBaileysTextMessage } from "./baileys-client.js";
import { query } from "./db.js";

const truthy = (value) =>
  ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());

const uploadsRoot = process.env.UPLOAD_DIR || fileURLToPath(new URL("../../uploads", import.meta.url));

function cleanFolder(value, fallback = "carol-sol") {
  return String(value || fallback)
    .replace(/[^a-zA-Z0-9/_-]/g, "-")
    .replace(/^\/+|\/+$/g, "");
}

export function cloudinaryProviders() {
  let parsed;
  try {
    parsed = JSON.parse(process.env.CLOUDINARY_PROVIDERS_JSON || "[]");
  } catch {
    parsed = [];
  }
  for (let i = 0; i < 2 && typeof parsed === "string"; i++) {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      break;
    }
  }
  if (!parsed || typeof parsed !== "object") parsed = [];
  const source = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.providers)
      ? parsed.providers
      : Object.entries(parsed).map(([name, config]) => ({
          name,
          ...(typeof config === "object" && config ? config : {}),
        }));
  return source
    .map((provider) => ({
      name:
        provider.name ||
        provider.label ||
        provider.cloud_name ||
        provider.cloudName,
      cloudName: provider.cloud_name || provider.cloudName || provider.cloud,
      apiKey: provider.api_key || provider.apiKey || provider.key,
      apiSecret: provider.api_secret || provider.apiSecret || provider.secret,
    }))
    .filter(
      (provider) => provider.cloudName && provider.apiKey && provider.apiSecret,
    );
}

export function cloudinaryProviderForRotation(
  rotationValue,
  providers = cloudinaryProviders(),
) {
  if (!providers.length) throw new Error("Cloudinary não configurado.");
  const rotation = BigInt(String(rotationValue || "1"));
  const index = Number((rotation - 1n) % BigInt(providers.length));
  return providers[index < 0 ? index + providers.length : index];
}

export function createCloudinaryUploadSignature(
  provider,
  {
    timestamp = Math.floor(Date.now() / 1000),
    folder = process.env.CLOUDINARY_DEFAULT_FOLDER || "carol-sol",
  } = {},
) {
  if (!provider?.cloudName || !provider?.apiKey || !provider?.apiSecret)
    throw new Error("Provedor Cloudinary inválido.");
  const signature = createHash("sha1")
    .update(`folder=${folder}&timestamp=${timestamp}${provider.apiSecret}`)
    .digest("hex");
  return {
    cloudName: provider.cloudName,
    apiKey: provider.apiKey,
    timestamp,
    folder,
    signature,
    provider: provider.name,
  };
}

export function minioConfig() {
  const endpoint = process.env.MINIO_ENDPOINT || process.env.S3_ENDPOINT || "";
  const bucket = process.env.MINIO_BUCKET || process.env.S3_BUCKET || "";
  const accessKey = process.env.MINIO_ACCESS_KEY || process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || "";
  const secretKey = process.env.MINIO_SECRET_KEY || process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || "";
  const region = process.env.MINIO_REGION || process.env.S3_REGION || process.env.AWS_REGION || "us-east-1";
  const publicUrl = process.env.MINIO_PUBLIC_URL || process.env.S3_PUBLIC_URL || endpoint;
  return {
    endpoint: String(endpoint).replace(/\/+$/, ""),
    publicUrl: String(publicUrl || endpoint).replace(/\/+$/, ""),
    bucket: String(bucket),
    accessKey: String(accessKey),
    secretKey: String(secretKey),
    region: String(region),
    baseFolder: cleanFolder(process.env.MINIO_UPLOAD_FOLDER || process.env.S3_UPLOAD_FOLDER || process.env.LOCAL_UPLOAD_FOLDER),
    pathStyle: !["0", "false", "no"].includes(String(process.env.MINIO_FORCE_PATH_STYLE || "true").toLowerCase()),
  };
}

export function isMinioConfigured() {
  const cfg = minioConfig();
  return Boolean(cfg.endpoint && cfg.bucket && cfg.accessKey && cfg.secretKey);
}

function hmac(key, value, encoding) {
  return createHmac("sha256", key).update(value).digest(encoding);
}

function s3SigningKey(secretKey, dateStamp, region) {
  const kDate = hmac(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, "s3");
  return hmac(kService, "aws4_request");
}

function encodeObjectKey(key) {
  return String(key || "")
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function minioRequestUrl(cfg, objectKey) {
  const base = new URL(cfg.endpoint);
  const encodedKey = encodeObjectKey(objectKey);
  if (cfg.pathStyle) {
    base.pathname = `${base.pathname.replace(/\/+$/, "")}/${encodeURIComponent(cfg.bucket)}/${encodedKey}`;
    return base;
  }
  base.hostname = `${cfg.bucket}.${base.hostname}`;
  base.pathname = `${base.pathname.replace(/\/+$/, "")}/${encodedKey}`;
  return base;
}

function minioPublicUrl(cfg, objectKey) {
  const base = new URL(cfg.publicUrl || cfg.endpoint);
  const encodedKey = encodeObjectKey(objectKey);
  if (cfg.pathStyle) {
    base.pathname = `${base.pathname.replace(/\/+$/, "")}/${encodeURIComponent(cfg.bucket)}/${encodedKey}`;
  } else {
    base.hostname = `${cfg.bucket}.${base.hostname}`;
    base.pathname = `${base.pathname.replace(/\/+$/, "")}/${encodedKey}`;
  }
  return base.toString();
}

async function signedMinioFetch(method, objectKey, { body, contentType } = {}) {
  const cfg = minioConfig();
  if (!isMinioConfigured()) throw new Error("MinIO nao configurado.");
  const url = minioRequestUrl(cfg, objectKey);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payload = body ? Buffer.from(body) : Buffer.alloc(0);
  const payloadHash = createHash("sha256").update(payload).digest("hex");
  const headers = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (contentType) headers["content-type"] = contentType;
  const sortedKeys = Object.keys(headers).sort();
  const canonicalHeaders = sortedKeys.map((key) => `${key}:${headers[key]}\n`).join("");
  const signedHeaders = sortedKeys.join(";");
  const canonicalRequest = [
    method,
    url.pathname,
    url.searchParams.toString(),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");
  const signature = hmac(s3SigningKey(cfg.secretKey, dateStamp, cfg.region), stringToSign, "hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${cfg.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return fetch(url, { method, headers, body: payload.length ? payload : undefined });
}

export async function uploadBufferToMinio({ key, buffer, contentType }) {
  const response = await signedMinioFetch("PUT", key, {
    body: buffer,
    contentType: contentType || "application/octet-stream",
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`MinIO respondeu ${response.status}${text ? `: ${text.slice(0, 160)}` : ""}`);
  }
  return {
    url: minioPublicUrl(minioConfig(), key),
    publicId: key,
    provider: "minio",
  };
}

export async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFICATION_EMAIL_FROM;
  if (!apiKey || !from || !to) return { skipped: true };
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  if (!response.ok) throw new Error(`Resend respondeu ${response.status}`);
  return response.json();
}

export async function sendWhatsApp({ to, text }) {
  if (
    !truthy(process.env.BAILEYS_ENABLED) ||
    !process.env.BAILEYS_API_URL ||
    !to
  )
    return { skipped: true };
  let number = String(to).replace(/\D/g, "");
  if ((number.length === 10 || number.length === 11) && !number.startsWith("55")) {
    number = "55" + number;
  }
  const result = await sendBaileysTextMessage({ number, text });
  return {
    sent: true,
    provider: "baileys",
    messageId: result.data?.messageId || null,
    number: result.data?.number || number,
  };
}

export async function getMessageTemplate(name, defaults) {
  try {
    const { rows } = await query("select public_config from public.integration_settings where provider='message_templates'");
    return rows[0]?.public_config?.[name] || defaults;
  } catch {
    return defaults;
  }
}

export async function notifyAppointment({
  email,
  phone,
  clientName,
  service,
  date,
  professional,
  professionalEmail,
  professionalPhone,
  clientNotificationId,
  professionalNotificationId,
  notes = "",
  value = 0,
}) {
  const prettyDate = new Date(date).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  });
  const formattedVal = Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const confirmationTemplate = await getMessageTemplate(
    'confirmation',
    [
      "Olá, {name}.",
      "",
      "Seu agendamento foi registrado.",
      "",
      "Serviço: {service}",
      "Profissional: {professional}",
      "Data/Horário: {date}",
      "Valor: {value}",
      "",
      "Em breve você receberá as orientações.",
    ].join("\n"),
  );
  const text = confirmationTemplate
    .replace('{name}', clientName)
    .replace('{service}', service)
    .replace('{professional}', professional)
    .replace('{date}', prettyDate)
    .replace('{value}', formattedVal);

  const professionalText = `Novo agendamento recebido! 📅\n\n*Cliente:* ${clientName}\n*Telefone:* ${phone || 'Não informado'}\n*Serviço:* ${service}\n*Data/Horário:* ${prettyDate}\n*Valor:* ${formattedVal}\n*Observações:* ${notes || 'Nenhuma'}\n\nPor favor, acesse seu painel profissional para acompanhar.`;

  let wantsEmail = true;
  let wantsWhatsapp = true;
  try {
    if (phone || email) {
      const { rows } = await query(
        `select coalesce(email, true) as wants_email, coalesce(whatsapp, true) as wants_whatsapp
         from public.notification_preferences
         where profile_id = (select id from public.profiles where phone = $1 or lower(email) = lower($2) limit 1)`,
        [phone || "", email || ""]
      );
      if (rows[0]) {
        wantsEmail = rows[0].wants_email;
        wantsWhatsapp = rows[0].wants_whatsapp;
      }
    }
  } catch (err) {
    console.error("Failed to fetch client preferences:", err.message);
  }

  let profWantsEmail = true;
  let profWantsWhatsapp = true;
  try {
    if (professionalPhone || professionalEmail) {
      const { rows } = await query(
        `select coalesce(email, true) as wants_email, coalesce(whatsapp, true) as wants_whatsapp
         from public.notification_preferences
         where profile_id = (select id from public.profiles where phone = $1 or lower(email) = lower($2) limit 1)`,
        [professionalPhone || "", professionalEmail || ""]
      );
      if (rows[0]) {
        profWantsEmail = rows[0].wants_email;
        profWantsWhatsapp = rows[0].wants_whatsapp;
      }
    }
  } catch (err) {
    console.error("Failed to fetch professional preferences:", err.message);
  }

  const deliveries = [];

  if (email && wantsEmail) {
    deliveries.push((async () => {
      try {
        const res = await sendEmail({
          to: email,
          subject: "Agendamento Carol Sol confirmado",
          html: `<div style="font-family:Arial,sans-serif;color:#181511"><h1>Seu horário está reservado ✨</h1><p>${text}</p><p>Em caso de dúvida, responda esta mensagem.</p></div>`,
        });
        if (clientNotificationId) {
          await query(`insert into public.notification_delivery_logs(notification_id, channel, recipient, status, provider_reference) values($1, 'email', $2, 'delivered', $3)`, [clientNotificationId, email, res.id || 'resend-ok']);
        }
      } catch (err) {
        if (clientNotificationId) {
          await query(`insert into public.notification_delivery_logs(notification_id, channel, recipient, status, error_message) values($1, 'email', $2, 'failed', $3)`, [clientNotificationId, email, err.message]);
        }
      }
    })());
  }

  if (phone && wantsWhatsapp) {
    deliveries.push((async () => {
      try {
        const res = await sendWhatsApp({ to: phone, text });
        if (clientNotificationId) {
          await query(`insert into public.notification_delivery_logs(notification_id, channel, recipient, status, provider_reference) values($1, 'whatsapp', $2, 'delivered', $3)`, [clientNotificationId, phone, res.messageId || 'baileys-ok']);
        }
      } catch (err) {
        if (clientNotificationId) {
          await query(`insert into public.notification_delivery_logs(notification_id, channel, recipient, status, error_message) values($1, 'whatsapp', $2, 'failed', $3)`, [clientNotificationId, phone, err.message]);
        }
      }
    })());
  }

  if (professionalEmail && profWantsEmail) {
    deliveries.push((async () => {
      try {
        const res = await sendEmail({
          to: professionalEmail,
          subject: "Novo agendamento recebido — Carol Sol",
          html: `<div style="font-family:Arial,sans-serif;color:#181511"><h1>Novo pedido de atendimento</h1><p>${professionalText}</p></div>`,
        });
        if (professionalNotificationId) {
          await query(`insert into public.notification_delivery_logs(notification_id, channel, recipient, status, provider_reference) values($1, 'email', $2, 'delivered', $3)`, [professionalNotificationId, professionalEmail, res.id || 'resend-ok']);
        }
      } catch (err) {
        if (professionalNotificationId) {
          await query(`insert into public.notification_delivery_logs(notification_id, channel, recipient, status, error_message) values($1, 'email', $2, 'failed', $3)`, [professionalNotificationId, professionalEmail, err.message]);
        }
      }
    })());
  }

  if (professionalPhone && profWantsWhatsapp) {
    deliveries.push((async () => {
      try {
        const res = await sendWhatsApp({ to: professionalPhone, text: professionalText });
        if (professionalNotificationId) {
          await query(`insert into public.notification_delivery_logs(notification_id, channel, recipient, status, provider_reference) values($1, 'whatsapp', $2, 'delivered', $3)`, [professionalNotificationId, professionalPhone, res.messageId || 'baileys-ok']);
        }
      } catch (err) {
        if (professionalNotificationId) {
          await query(`insert into public.notification_delivery_logs(notification_id, channel, recipient, status, error_message) values($1, 'whatsapp', $2, 'failed', $3)`, [professionalNotificationId, professionalPhone, err.message]);
        }
      }
    })());
  }

  if (process.env.ADMIN_NOTIFICATION_EMAIL) {
    deliveries.push(
      sendEmail({
        to: process.env.ADMIN_NOTIFICATION_EMAIL,
        subject: "Novo agendamento — Carol Sol",
        html: `<p>${clientName} reservou ${service} para ${prettyDate} com ${professional}.</p>`,
      }).catch(err => console.error("Admin notification email error:", err.message))
    );
  }

  return Promise.allSettled(deliveries);
}

export function parseCloudinaryAssetUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== "res.cloudinary.com"
    )
      return null;
    const parts = parsed.pathname.split("/").filter(Boolean);
    const cloudName = parts[0] || "";
    const resourceIndex = parts.findIndex(
      (part, index) =>
        index > 0 &&
        ["image", "video", "raw"].includes(part) &&
        parts[index + 1],
    );
    if (!cloudName || resourceIndex === -1) return null;
    const resourceType = parts[resourceIndex];
    const deliveryType = parts[resourceIndex + 1];
    const assetParts = parts.slice(resourceIndex + 2);
    const versionIndex = assetParts.findIndex((part) => /^v\d+$/.test(part));
    const publicParts = assetParts.slice(
      versionIndex >= 0 ? versionIndex + 1 : 0,
    );
    if (!publicParts.length) return null;
    let publicId = decodeURIComponent(publicParts.join("/"));
    if (resourceType !== "raw") publicId = publicId.replace(/\.[^/.]+$/, "");
    if (!publicId) return null;
    return { cloudName, resourceType, deliveryType, publicId };
  } catch {
    return null;
  }
}

export function extractPublicId(url) {
  return parseCloudinaryAssetUrl(url)?.publicId || null;
}

export function isConfiguredCloudinaryUrl(value, resourceTypes = []) {
  if (isConfiguredLocalUploadUrl(value, resourceTypes)) return true;
  if (isConfiguredMinioUrl(value, resourceTypes)) return true;
  const asset = parseCloudinaryAssetUrl(value);
  if (!asset || asset.deliveryType !== "upload") return false;
  if (resourceTypes.length && !resourceTypes.includes(asset.resourceType))
    return false;
  return cloudinaryProviders().some(
    (provider) => provider.cloudName === asset.cloudName,
  );
}

function minioObjectKeyFromUrl(value) {
  if (!isMinioConfigured()) return null;
  const raw = String(value || "");
  let parsed;
  try {
    parsed = new URL(raw, process.env.APP_URL || "http://localhost");
  } catch {
    return null;
  }
  for (const baseValue of [minioConfig().publicUrl, minioConfig().endpoint].filter(Boolean)) {
    try {
      const base = new URL(baseValue);
      if (parsed.protocol !== base.protocol || parsed.host !== base.host) continue;
      const prefix = minioConfig().pathStyle
        ? `${base.pathname.replace(/\/+$/, "")}/${minioConfig().bucket}/`
        : `${base.pathname.replace(/\/+$/, "")}/`;
      if (!parsed.pathname.startsWith(prefix)) continue;
      const key = decodeURIComponent(parsed.pathname.slice(prefix.length));
      return key && !key.includes("..") ? key : null;
    } catch {
      continue;
    }
  }
  return null;
}

export function isConfiguredMinioUrl(value, resourceTypes = []) {
  const key = minioObjectKeyFromUrl(value);
  if (!key) return false;
  if (resourceTypes.length && !resourceTypes.includes(localResourceType(key)))
    return false;
  return true;
}

function localUploadPath(value) {
  const raw = String(value || "");
  let pathname = raw;
  try {
    const parsed = new URL(raw, process.env.APP_URL || "http://localhost");
    pathname = parsed.pathname;
  } catch {
    pathname = raw;
  }
  if (!pathname.startsWith("/uploads/")) return null;
  const relative = normalize(pathname.replace(/^\/uploads\/?/, ""))
    .replace(/^(\.\.(\\|\/|$))+/, "")
    .replace(/^[/\\]+/, "");
  if (!relative) return null;
  return relative;
}

function localResourceType(value) {
  const ext = String(value || "").split("?")[0].split(".").pop()?.toLowerCase() || "";
  if (["jpg", "jpeg", "png", "gif", "webp", "avif"].includes(ext)) return "image";
  if (["mp4", "webm", "mov"].includes(ext)) return "video";
  return "raw";
}

export function isConfiguredLocalUploadUrl(value, resourceTypes = []) {
  if (!truthy(process.env.LOCAL_UPLOAD_ENABLED)) return false;
  if (!localUploadPath(value)) return false;
  if (resourceTypes.length && !resourceTypes.includes(localResourceType(value)))
    return false;
  return true;
}

export async function deleteFromCloudinary(url) {
  try {
    const localPath = localUploadPath(url);
    if (localPath && truthy(process.env.LOCAL_UPLOAD_ENABLED)) {
      const target = join(uploadsRoot, ...localPath.split(/[\\/]+/));
      await unlink(target).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
      return { success: true, provider: "local" };
    }
    const minioKey = minioObjectKeyFromUrl(url);
    if (minioKey) {
      const response = await signedMinioFetch("DELETE", minioKey);
      if (!response.ok && response.status !== 404) {
        return { success: false, provider: "minio", status: response.status };
      }
      return { success: true, provider: "minio" };
    }
    const asset = parseCloudinaryAssetUrl(url);
    if (!asset) return { skipped: true, reason: "URL inválida ou sem upload" };
    const providers = cloudinaryProviders();
    if (!providers.length) return { skipped: true, reason: "Cloudinary não configurado" };
    const provider = providers.find((item) => item.cloudName === asset.cloudName);
    if (!provider)
      return {
        skipped: true,
        reason: "Conta Cloudinary da URL não configurada",
      };
    const timestamp = Math.floor(Date.now() / 1000);
    const typePart =
      asset.deliveryType === "upload" ? "" : `&type=${asset.deliveryType}`;
    const signatureStr = `public_id=${asset.publicId}&timestamp=${timestamp}${typePart}${provider.apiSecret}`;
    const signature = createHash("sha1").update(signatureStr).digest("hex");
    const body = new URLSearchParams({
      public_id: asset.publicId,
      timestamp: String(timestamp),
      api_key: provider.apiKey,
      signature,
    });
    if (asset.deliveryType !== "upload") body.set("type", asset.deliveryType);
    const response = await fetch(`https://api.cloudinary.com/v1_1/${provider.cloudName}/${asset.resourceType}/destroy`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!response.ok) {
      console.error(`Cloudinary destroy failed: status ${response.status}`);
      return { success: false, status: response.status };
    }

    const result = await response.json();
    return { success: true, result };
  } catch (err) {
    console.error("Cloudinary delete error", err);
    return { success: false, error: err.message };
  }
}
