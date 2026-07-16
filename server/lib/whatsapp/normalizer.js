import {
  clean,
  normalizeText,
  truthy,
  extractRawText,
  firstValidPhone,
} from "./utils.js";

const EVOLUTION_MESSAGE_EVENTS = new Set([
  "messages.upsert",
  "MESSAGES_UPSERT",
]);

export function normalizeIncomingWhatsappPayload(payload = {}) {
  const dataIsArray = Array.isArray(payload.data);
  const raw = dataIsArray
    ? (payload.data[0] || {})
    : (payload.raw || payload.data || payload.message || {});

  const key = raw?.key || payload.key || {};
  const from =
    clean(
      payload.from ||
        payload.remoteJid ||
        payload.jid ||
        raw.remoteJid ||
        key.remoteJid,
    ) ||
    "";
  const phoneNumber = firstValidPhone(
    payload.phone,
    payload.number,
    payload.senderPn,
    raw.phone,
    raw.number,
    raw.senderPn,
    key.remoteJidAlt,
    key.participantAlt,
    from,
    payload.remoteJid,
    payload.participant,
    key.participant,
    key.remoteJid,
  );
  const text = clean(
    payload.text ||
      payload.body ||
      raw.text ||
      raw.body ||
      raw.message?.conversation ||
      raw.message?.extendedTextMessage?.text ||
      extractRawText(raw),
  );
  const isFromMe = dataIsArray
    ? true
    : truthy(payload.isFromMe ?? payload.fromMe ?? raw.fromMe ?? key.fromMe);
  const parsedMessageId = clean(
    payload.messageId || payload.id || payload.provider_message_id || raw.id || key.id,
  );
  const fallbackMessageId = parsedMessageId || `tmp-${phoneNumber || "unknown"}-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`;
  const sessionName =
    clean(payload.session_name || payload.instance || raw.instance || payload.session) ||
    String(process.env.BAILEYS_DEFAULT_INSTANCE || "carol-sol");
  const isGroup = from.endsWith("@g.us");
  const isStatus = from === "status@broadcast";

  return {
    sessionName,
    from,
    phoneNumber,
    text,
    isFromMe,
    isGroup,
    isStatus,
    messageId: fallbackMessageId,
    timestamp: payload.timestamp || raw?.messageTimestamp || null,
    raw: payload,
  };
}

export function isMessageWebhookPayload(payload = {}) {
  const eventField = clean(payload.event);
  if (eventField && !EVOLUTION_MESSAGE_EVENTS.has(eventField)) {
    return false;
  }

  if (Array.isArray(payload.data)) {
    return false;
  }

  const normalized = normalizeIncomingWhatsappPayload(payload);
  return Boolean(
    normalized.from ||
      normalized.phoneNumber ||
      normalized.text ||
      normalized.messageId ||
      payload.raw?.key,
  );
}
