import {
  clean,
  normalizeText,
} from "./utils.js";
import { isSimpleGreeting, isInAiServiceScope } from "./intent-detector.js";

export function explicitGreetingFromText(text) {
  const normalized = normalizeText(text).replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  if (/\bboa noite\b/.test(normalized)) return "Boa noite";
  if (/\bboa tarde\b/.test(normalized)) return "Boa tarde";
  if (/\bbom dia\b/.test(normalized)) return "Bom dia";
  return "";
}

export function localGreetingForDate(date = new Date(), timezone = "America/Sao_Paulo") {
  let hour = new Date(date).getHours();
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone || "America/Sao_Paulo",
      hour: "2-digit",
      hour12: false,
    }).formatToParts(new Date(date));
    const parsed = Number(parts.find((part) => part.type === "hour")?.value);
    if (Number.isFinite(parsed)) hour = parsed;
  } catch {
    // Keep the runtime local hour if the configured timezone is invalid.
  }
  if (hour >= 5 && hour < 12) return "Bom dia";
  if (hour >= 12 && hour < 18) return "Boa tarde";
  return "Boa noite";
}

export function buildLocalGreetingResponse(text, {
  date = new Date(),
  timezone = "America/Sao_Paulo",
  salonName = "Carol Sol",
} = {}) {
  if (!isSimpleGreeting(text)) return "";
  const greeting = explicitGreetingFromText(text) || localGreetingForDate(date, timezone);
  const brand = clean(salonName) || "Carol Sol";
  return `${greeting}! Sou a assistente virtual da ${brand}. Posso te ajudar com serviços, valores, horários ou agendamento.`;
}

export function naturalConversationPrefix(text) {
  const normalized = normalizeText(text);
  if (normalized.includes("amiga") || normalized.includes("amg")) return "Claro, amiga.";
  return "";
}

export function buildOutOfScopeResponse(text) {
  if (isInAiServiceScope(text)) return "";
  return [
    "Consigo te ajudar apenas com assuntos do salão: Mega Hair, cabelos, perucas, apliques, cuidados, valores, horários e agendamentos.",
    "Me manda uma dúvida dentro desses temas que eu sigo daqui.",
  ].join("\n\n");
}

