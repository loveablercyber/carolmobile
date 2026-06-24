import { createHash } from "node:crypto";
import { sendBaileysTextMessage } from "./baileys-client.js";

const truthy = (value) =>
  ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());

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
  const result = await sendBaileysTextMessage({ number: to, text });
  return {
    sent: true,
    provider: "baileys",
    messageId: result.data?.messageId || null,
    number: result.data?.number || String(to).replace(/\D/g, ""),
  };
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
}) {
  const prettyDate = new Date(date).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  });
  const text = `Olá, ${clientName}! Seu agendamento de ${service} com ${professional} foi reservado para ${prettyDate}. — Carol Sol`;
  const professionalText = `Novo pedido Carol Sol: ${clientName} solicitou ${service} para ${prettyDate}. Acesse sua agenda para confirmar.`;
  return Promise.allSettled([
    sendEmail({
      to: email,
      subject: "Agendamento Carol Sol confirmado",
      html: `<div style="font-family:Arial,sans-serif;color:#181511"><h1>Seu horário está reservado ✨</h1><p>${text}</p><p>Em caso de dúvida, responda esta mensagem.</p></div>`,
    }),
    sendWhatsApp({ to: phone, text }),
    sendEmail({
      to: professionalEmail,
      subject: "Novo agendamento recebido — Carol Sol",
      html: `<div style="font-family:Arial,sans-serif;color:#181511"><h1>Novo pedido de atendimento</h1><p>${professionalText}</p></div>`,
    }),
    sendWhatsApp({ to: professionalPhone, text: professionalText }),
    process.env.ADMIN_NOTIFICATION_EMAIL
      ? sendEmail({
          to: process.env.ADMIN_NOTIFICATION_EMAIL,
          subject: "Novo agendamento — Carol Sol",
          html: `<p>${clientName} reservou ${service} para ${prettyDate} com ${professional}.</p>`,
        })
      : Promise.resolve({ skipped: true }),
  ]);
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
  const asset = parseCloudinaryAssetUrl(value);
  if (!asset || asset.deliveryType !== "upload") return false;
  if (resourceTypes.length && !resourceTypes.includes(asset.resourceType))
    return false;
  return cloudinaryProviders().some(
    (provider) => provider.cloudName === asset.cloudName,
  );
}

export async function deleteFromCloudinary(url) {
  try {
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
