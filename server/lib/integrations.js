import { createHash } from "node:crypto";

const truthy = (value) =>
  ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());

function asList(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed;
  } catch {}
  return String(value)
    .split(/[,;|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function hashIndex(value, length) {
  if (length <= 1) return 0;
  const hash = createHash("sha256")
    .update(String(value || Date.now()))
    .digest();
  return hash.readUInt32BE(0) % length;
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

export function createCloudinarySignature(key) {
  const providers = cloudinaryProviders();
  if (!providers.length) throw new Error("Cloudinary não configurado.");
  const provider = providers[hashIndex(key, providers.length)];
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = process.env.CLOUDINARY_DEFAULT_FOLDER || "carol-sol";
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
  const instances = asList(process.env.BAILEYS_DEFAULT_INSTANCE);
  const apiKeys = asList(process.env.BAILEYS_API_KEY);
  const tokens = asList(process.env.BAILEYS_API_TOKEN);
  const size = Math.max(instances.length, apiKeys.length, tokens.length, 1);
  const index = hashIndex(to, size);
  const instance =
    instances[index % Math.max(instances.length, 1)] ||
    instances[0] ||
    "default";
  const apiKey = apiKeys[index % Math.max(apiKeys.length, 1)] || apiKeys[0];
  const token = tokens[index % Math.max(tokens.length, 1)] || tokens[0];
  const base = process.env.BAILEYS_API_URL.replace(/\/$/, "");
  const headers = { "Content-Type": "application/json" };
  if (apiKey) {
    headers.apikey = apiKey;
    headers["x-api-key"] = apiKey;
  }
  if (token) headers.Authorization = `Bearer ${token}`;
  const number = String(to).replace(/\D/g, "");
  const attempts = [
    {
      url: `${base}/message/sendText/${encodeURIComponent(instance)}`,
      body: { number, text },
    },
    {
      url: `${base}/api/send-message`,
      body: { instance, phone: number, message: text },
    },
  ];
  let lastStatus = 0;
  for (const attempt of attempts) {
    const response = await fetch(attempt.url, {
      method: "POST",
      headers,
      body: JSON.stringify(attempt.body),
    });
    lastStatus = response.status;
    if (response.ok) return { sent: true, instance };
    if (![404, 405].includes(response.status)) break;
  }
  throw new Error(`BAILEYS respondeu ${lastStatus}`);
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
