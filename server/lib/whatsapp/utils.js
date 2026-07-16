import { query } from "../db.js";

export const clean = (value) => String(value ?? "").trim();

export function normalizeText(value) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function truthy(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

export function extractRawText(raw) {
  const message = raw?.message || raw?.messages?.[0]?.message || {};
  return clean(
    message.conversation ||
      message.extendedTextMessage?.text ||
      message.imageMessage?.caption ||
      message.videoMessage?.caption ||
      message.documentMessage?.caption ||
      message.buttonsResponseMessage?.selectedDisplayText ||
      message.listResponseMessage?.title ||
      "",
  );
}

export function jidToPhone(value) {
  const jid = clean(value);
  if (!jid || jid.endsWith("@g.us") || jid === "status@broadcast") return "";
  const number = jid.replace(/@(?:s\.whatsapp\.net|c\.us|lid|broadcast)$/i, "");
  return number.replace(/\D/g, "");
}

export function firstValidPhone(...values) {
  for (const value of values) {
    const number = jidToPhone(value);
    if (/^55\d{10,11}$/.test(number)) return number;
  }
  return "";
}

export function localDateParts(value = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function addLocalDays(date, days) {
  const base = new Date(`${date}T12:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

export function formatDateLabel(date) {
  return new Date(`${date}T12:00:00.000Z`).toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    timeZone: "UTC",
  });
}

export function normalizeBookingState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...value };
}

export function parseJsonObject(value) {
  if (!value) return {};
  if (typeof value === "object") return normalizeBookingState(value);
  try {
    return normalizeBookingState(JSON.parse(value));
  } catch {
    return {};
  }
}

export function hasBookingStateProgress(state = {}) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return false;
  return Boolean(
    state.status ||
      state.appointmentId ||
      state.previousAppointmentId ||
      state.serviceId ||
      state.date ||
      state.time ||
      state.professionalId ||
      state.clientName ||
      state.clientEmail ||
      state.serviceOptions?.length ||
      state.dateOptions?.length ||
      state.slotOptions?.length,
  );
}

export function isActiveBookingState(state = {}) {
  if (!hasBookingStateProgress(state)) return false;
  return state.status !== "booked";
}

export function includesAny(normalizedText, terms) {
  return terms.some((term) => normalizedText.includes(term));
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
