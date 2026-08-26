import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { query, transaction } from "./db.js";
import {
  buildRuntimePrompt,
  ensureAiWhatsappSchema,
  getAiCommercialBase,
  getAiSettings,
} from "./ai-whatsapp.js";
import {
  aiProviderRuntime,
  buildAiProviderCandidates,
  generateAiProviderText,
  normalizeAiProvider,
  shouldRetryAiProviderError,
} from "./ai-provider-router.js";
import { createSumupCheckout, sumupConfig } from "./sumup.js";
import {
  schedulePeriod,
  scheduleSlots,
  slotsWithConflicts,
  periodFitsSchedule,
  weekdayForDate,
} from "./availability-rules.js";
import { sendBaileysTextMessage, sendBaileysPresence } from "./baileys-client.js";
import { notifyAppointment, sendEmail } from "./integrations.js";
import {
  generateGoogleCalendarUrl,
  loadAppointmentAutomationContext,
  whatsappAppointmentIdempotencyKey,
} from "./appointment-automation.js";
import { catalogSnapshot, variantDepositAmount } from "./service-catalog.js";

// Módulos refatorados na Fase 3
import {
  clean,
  normalizeText,
  truthy,
  extractRawText,
  jidToPhone,
  firstValidPhone,
  localDateParts,
  addLocalDays,
  formatDateLabel,
  normalizeBookingState,
  parseJsonObject,
  hasBookingStateProgress,
  isActiveBookingState,
  includesAny,
  delay,
} from "./whatsapp/utils.js";

import {
  normalizeIncomingWhatsappPayload,
  isMessageWebhookPayload,
} from "./whatsapp/normalizer.js";

import {
  aiDomainTerms,
  salonOperationalTerms,
  clearlyOutOfScopeTerms,
  keywordInText,
  isWithinAiHours,
  numericChoice,
  dateOptionsFrom,
  parseBookingDateFromText,
  parseBookingTimeFromText,
  parseFlexibleBookingTimeFromText,
  periodMatches,
  periodLabel,
  lastAiText,
  wantsMoreSlotOptions,
  hasTemporalBookingSignal,
  promptSuggestsBookingAnswer,
  isAffirmativeBookingConfirmation,
  isFinalBookingConfirmation,
  isFinalBookingAlteration,
  shouldPrioritizeBookingState,
  shouldResetBookingStateOnGreeting,
  isSimpleGreeting,
  isClientAskingQuestion,
  isClientChangingSubjectOrNegating,
  isClientExitingFlow,
  isReplyingToExplanationOffer,
  isAgendaAvailabilityIntent,
  isInAiServiceScope,
  AI_SERVICE_SCOPE,
  classifyAiServiceScope,
} from "./whatsapp/intent-detector.js";

import {
  explicitGreetingFromText,
  localGreetingForDate,
  buildLocalGreetingResponse,
  naturalConversationPrefix,
  buildOutOfScopeResponse,
} from "./whatsapp/local-handlers.js";
import {
  buildHairKnowledgeResponse,
  isKnownHairKnowledgeTopic,
} from "./whatsapp/hair-knowledge.js";

// Re-exportar funções para compatibilidade total com os testes existentes
export {
  normalizeIncomingWhatsappPayload,
  isMessageWebhookPayload,
} from "./whatsapp/normalizer.js";

export {
  keywordInText,
  isWithinAiHours,
  shouldPrioritizeBookingState,
  shouldResetBookingStateOnGreeting,
  isSimpleGreeting,
  isClientAskingQuestion,
  isClientChangingSubjectOrNegating,
  isClientExitingFlow,
  isReplyingToExplanationOffer,
  isAgendaAvailabilityIntent,
  isInAiServiceScope,
  AI_SERVICE_SCOPE,
  classifyAiServiceScope,
} from "./whatsapp/intent-detector.js";

export {
  localGreetingForDate,
  buildLocalGreetingResponse,
  buildOutOfScopeResponse,
} from "./whatsapp/local-handlers.js";

const MAX_AI_MESSAGE_CHARS = 6000;
const SLOT_PAGE_SIZE = 5;
const DIALOGUE_ACTION_TTL_MS = 30 * 60 * 1000;
const BOOKING_FLOW_HELP_TEXT = [
  "Comandos: cancelar | voltar | menu | trocar servico | atendente",
  "Pode enviar qualquer duvida a qualquer momento. Eu respondo e continuo seu agendamento de onde parou.",
].join("\n");

function shouldAppendBookingFlowHelp(reason = "", text = "") {
  const value = String(reason || "");
  if (!/^(booking|agenda)_/.test(value)) return false;
  if (/^(booking_created|booking_global_cancel|booking_global_handoff|booking_followup_handoff)/.test(value)) return false;
  return !String(text || "").includes("Comandos: cancelar | voltar | menu | trocar servico | atendente");
}

function withBookingFlowHelp(text, reason) {
  const body = String(text || "").trim();
  if (!shouldAppendBookingFlowHelp(reason, body)) return body;
  return [body, BOOKING_FLOW_HELP_TEXT].filter(Boolean).join("\n\n");
}

function currentFlowOptionLabels(state = {}) {
  const optionGroups = {
    awaiting_category: [state.categoryOptions, ["categoryName"]],
    awaiting_method: [state.methodOptions, ["methodName"]],
    awaiting_service: [state.serviceOptions, ["serviceName", "requestedServiceName"]],
    awaiting_inventory: [state.inventoryOptions, ["inventoryName"]],
    awaiting_addon: [state.addonOptions, ["addonName"]],
  };
  const [options, fields] = optionGroups[String(state.status || "")] || [[], []];
  return (Array.isArray(options) ? options : [])
    .flatMap((option) => fields.map((field) => normalizeText(option?.[field] || "")))
    .filter(Boolean);
}

function normalizedShortReply(text) {
  return normalizeText(text)
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isShortAffirmativeReply(text) {
  return [
    "sim", "pode", "pode sim", "sim pode", "claro", "quero", "quero sim",
    "com certeza", "ok", "certo", "isso", "isso mesmo", "manda", "envia",
  ].includes(normalizedShortReply(text));
}

function isShortNegativeReply(text) {
  return [
    "nao", "nao quero", "agora nao", "nao agora", "deixa", "deixa pra la",
    "depois", "mais tarde",
  ].includes(normalizedShortReply(text));
}

function assistantDecisionSignals(text) {
  const normalized = normalizeText(text);
  const asksQuestion = String(text || "").includes("?");
  const catalog = asksQuestion && includesAny(normalized, [
    "mostrar o catalogo", "mostre o catalogo", "ver o catalogo", "catalogo completo",
    "mostrar os servicos", "ver os servicos",
  ]);
  const booking = asksQuestion && includesAny(normalized, [
    "agendar uma avaliacao", "agendar avaliacao", "marcar uma avaliacao",
    "prefere agendar", "quer agendar", "gostaria de agendar",
  ]);
  return { catalog, booking };
}

export function prepareAssistantDialogueResponse(text, now = new Date()) {
  let finalText = String(text || "").trim();
  let signals = assistantDecisionSignals(finalText);

  // Perguntas com duas decisões tornam respostas como "sim" insolúveis. Quando
  // a IA produzir essa construção, priorizamos uma única ação e oferecemos o
  // agendamento somente depois que o catálogo for apresentado.
  if (signals.catalog && signals.booking) {
    const questionEnd = finalText.lastIndexOf("?");
    const beforeQuestion = finalText.slice(0, Math.max(0, questionEnd));
    const separators = ["\n\n", "\n", ". ", "! "];
    const questionStart = separators.reduce((start, separator) => {
      const index = beforeQuestion.lastIndexOf(separator);
      return index >= 0 ? Math.max(start, index + separator.length) : start;
    }, 0);
    const questionText = finalText.slice(questionStart, questionEnd + 1);
    const questionSignals = assistantDecisionSignals(questionText);
    if (questionSignals.catalog && questionSignals.booking) {
      finalText = [
        finalText.slice(0, questionStart),
        "Quer que eu te mostre o catálogo completo de serviços?",
        finalText.slice(questionEnd + 1),
      ].join("").trim();
      signals = assistantDecisionSignals(finalText);
    }
  }

  const type = signals.catalog && !signals.booking
    ? "show_catalog"
    : signals.booking && !signals.catalog
      ? "start_booking"
      : "";
  if (!type) return { text: finalText, pendingAction: null };

  const createdAt = now instanceof Date ? now : new Date(now);
  return {
    text: finalText,
    pendingAction: {
      type,
      expectedReply: "yes_no",
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + DIALOGUE_ACTION_TTL_MS).toISOString(),
    },
  };
}

export function resolvePendingDialogueReply(text, dialogueState = {}, now = new Date()) {
  const pendingAction = parseJsonObject(dialogueState).pendingAction;
  if (!pendingAction?.type) return { matched: false, expired: false, action: "" };
  const expiresAt = pendingAction.expiresAt ? new Date(pendingAction.expiresAt) : null;
  if (expiresAt && Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() <= now.getTime()) {
    return { matched: false, expired: true, action: "" };
  }
  if (isShortAffirmativeReply(text)) {
    return { matched: true, expired: false, action: pendingAction.type, accepted: true };
  }
  if (isShortNegativeReply(text)) {
    return { matched: true, expired: false, action: pendingAction.type, accepted: false };
  }
  return { matched: false, expired: false, action: pendingAction.type };
}

export function recoverDialogueStateFromHistory(dialogueState = {}, history = [], now = new Date()) {
  const storedState = parseJsonObject(dialogueState);
  if (storedState.pendingAction?.type) return storedState;
  const lastAssistantMessage = [...(history || [])]
    .reverse()
    .find((item) => item?.sender_type === "ai" && clean(item?.body));
  if (!lastAssistantMessage) return {};
  const messageDate = lastAssistantMessage.created_at
    ? new Date(lastAssistantMessage.created_at)
    : now;
  const validDate = Number.isFinite(messageDate.getTime()) ? messageDate : now;
  const recovered = prepareAssistantDialogueResponse(lastAssistantMessage.body, validDate);
  return recovered.pendingAction
    ? { pendingAction: { ...recovered.pendingAction, recoveredFromHistory: true } }
    : {};
}

function isExplicitCurrentFlowSelection(text, state = {}) {
  if (numericChoice(text)) return true;
  const labels = currentFlowOptionLabels(state);
  if (!labels.length) return false;
  const matches = labels.filter((label) =>
    catalogOptionMatches(text, { serviceName: label }),
  );
  return matches.length === 1;
}

function hasExplicitBookingAction(text) {
  const normalized = normalizeText(text);
  return includesAny(normalized, [
    "quero agendar",
    "queria agendar",
    "gostaria de agendar",
    "posso agendar",
    "vamos agendar",
    "quero marcar",
    "marcar horario",
    "reservar horario",
    "fazer agendamento",
    "iniciar agendamento",
    "escolho o servico",
    "escolho esse",
  ]);
}

export function isBookingFlowInterruptionQuestion(text, history = [], { base = {}, state = {} } = {}) {
  if (
    isClientAskingQuestion(text) ||
    isReplyingToExplanationOffer(text, history) ||
    isClientChangingSubjectOrNegating(text)
  ) return true;
  if (isExplicitCurrentFlowSelection(text, state) || hasExplicitBookingAction(text)) return false;
  if (isKnownHairKnowledgeTopic(text)) return true;
  return hasCommercialCatalogReference(text, base);
}

function prunePayload(value, depth = 0) {
  if (depth > 4) return "[truncated]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string")
    return value.length > 1000 ? `${value.slice(0, 1000)}...` : value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 10).map((item) => prunePayload(item, depth + 1));
  const output = {};
  for (const [key, item] of Object.entries(value).slice(0, 40)) {
    if (/token|secret|api[_-]?key|authorization/i.test(key)) {
      output[key] = "[redacted]";
    } else {
      output[key] = prunePayload(item, depth + 1);
    }
  }
  return output;
}

export function phoneLookupCandidates(phoneNumber) {
  const digits = clean(phoneNumber).replace(/\D/g, "");
  if (!digits) return { exact: [], localSuffixes: [] };
  const local = digits.startsWith("55") ? digits.slice(2) : digits;
  const localVariants = new Set([local]);
  if (/^\d{2}9\d{8}$/.test(local)) localVariants.add(`${local.slice(0, 2)}${local.slice(3)}`);
  if (/^\d{10}$/.test(local)) localVariants.add(`${local.slice(0, 2)}9${local.slice(2)}`);
  const exact = new Set([digits]);
  for (const variant of localVariants) {
    exact.add(variant);
    exact.add(`55${variant}`);
  }
  return {
    exact: [...exact],
    localSuffixes: [...localVariants].map((variant) => variant.slice(-10)),
  };
}

async function findClientById(client, clientId) {
  if (!clientId) return null;
  const { rows } = await client.query(
    `select c.id, p.full_name, coalesce(c.cpf,p.cpf) as cpf, p.birth_date, u.email
       from public.clients c
       join public.profiles p on p.id=c.profile_id
       left join auth.users u on u.id=p.id
      where c.id=$1
      limit 1`,
    [clientId],
  );
  return rows[0] || null;
}

async function findClientByPhone(client, phoneNumber) {
  const candidates = phoneLookupCandidates(phoneNumber);
  if (!candidates.exact.length) return null;
  const { rows } = await client.query(
    `select c.id, p.full_name, coalesce(c.cpf,p.cpf) as cpf, p.birth_date, u.email
       from public.clients c
       join public.profiles p on p.id=c.profile_id
       left join auth.users u on u.id=p.id
      where regexp_replace(coalesce(p.phone,''), '\\D', '', 'g') = any($1::text[])
         or regexp_replace(coalesce(u.phone,''), '\\D', '', 'g') = any($1::text[])
         or regexp_replace(coalesce(c.preferences #>> '{whatsapp_ai_contact,phone}',''), '\\D', '', 'g') = any($1::text[])
         or right(regexp_replace(coalesce(p.phone,''), '\\D', '', 'g'),10) = any($2::text[])
         or right(regexp_replace(coalesce(u.phone,''), '\\D', '', 'g'),10) = any($2::text[])
      order by case
        when regexp_replace(coalesce(p.phone,''), '\\D', '', 'g') = any($1::text[])
          or regexp_replace(coalesce(u.phone,''), '\\D', '', 'g') = any($1::text[])
        then 0 else 1 end
      limit 1`,
    [candidates.exact, candidates.localSuffixes],
  );
  return rows[0] || null;
}

function textMatchesCatalogEntry(text, entryText) {
  const normalized = normalizeText(text).replace(/[^a-z0-9 ]/g, " ");
  const entry = normalizeText(entryText).replace(/[^a-z0-9 ]/g, " ");
  if (!normalized || !entry) return false;
  if (normalized.includes(entry) || entry.includes(normalized)) return true;
  const ignored = new Set(["qual", "quanto", "esta", "para", "pra", "com", "sem", "uma", "por", "que", "voce", "voces"]);
  const tokens = normalized.split(/\s+/).filter((token) => token.length >= 4 && !ignored.has(token));
  if (!tokens.length) return false;
  const matches = tokens.filter((token) => entry.includes(token)).length;
  return matches >= Math.min(2, tokens.length);
}

function hasCommercialCatalogReference(text, base = {}) {
  const entries = [];
  for (const service of base.services || []) {
    if (service.active === false) continue;
    entries.push([
      service.name,
      service.commercial_name,
      service.short_description,
      service.detailed_description,
      service.description,
    ].filter(Boolean).join(" "));
  }
  for (const category of base.categories || []) {
    if (category.active === false) continue;
    entries.push([category.name, category.description].filter(Boolean).join(" "));
  }
  for (const method of base.methods || []) {
    if (method.active === false) continue;
    entries.push([method.name, method.description].filter(Boolean).join(" "));
  }
  for (const variant of base.serviceVariants || []) {
    if (variant.active === false || variant.allow_whatsapp_booking === false) continue;
    entries.push([variant.label, variant.length_label, variant.notes].filter(Boolean).join(" "));
  }
  for (const addon of base.serviceAddons || []) {
    if (addon.active === false || addon.allow_whatsapp_booking === false) continue;
    entries.push([addon.name, addon.description].filter(Boolean).join(" "));
  }
  for (const item of base.products || []) entries.push([item.name, item.category].filter(Boolean).join(" "));
  for (const article of base.knowledgeArticles || []) {
    entries.push([article.title, article.short_answer, article.category].filter(Boolean).join(" "));
  }
  return entries.some((entry) => textMatchesCatalogEntry(text, entry));
}

function bookableAiServices(base = {}) {
  return (base.services || [])
    .filter((service) => service.active !== false && service.show_online_booking !== false)
    .sort((a, b) => Number(a.priority_order || 100) - Number(b.priority_order || 100));
}

function structuredCatalogServices(base = {}) {
  return (base.services || [])
    .filter((service) => service.active !== false && service.show_online_booking !== false)
    .sort((a, b) => {
      const priority = Number(a.priority_order || 100) - Number(b.priority_order || 100);
      if (priority !== 0) return priority;
      return String(a.commercial_name || a.name || "").localeCompare(
        String(b.commercial_name || b.name || ""),
        "pt-BR",
      );
    });
}

function serviceSearchText(service) {
  return normalizeText(
    [
      service.name,
      service.commercial_name,
      service.short_description,
      service.detailed_description,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

export function serializeBookingState(state = {}) {
  return JSON.stringify(state && typeof state === "object" ? state : {});
}

const COMMERCIAL_TOPIC_ALIASES = [
  { key: "fita_adesiva", label: "Fita Adesiva", terms: ["fita adesiva", "metodo fita", "mega hair de fita"] },
  { key: "ponto_americano", label: "Ponto Americano Invisível", terms: ["ponto americano invisivel", "ponto americano"] },
  { key: "entrelace", label: "Entrelace", terms: ["entrelace"] },
  { key: "microcapsula", label: "Microcápsula de Queratina", terms: ["microcapsula de queratina", "micro capsula de queratina", "microcapsula"] },
];

function recentConversationHistory(history = [], maxIdleMinutes = 30, now = new Date()) {
  const idleMinutes = Number.isFinite(Number(maxIdleMinutes))
    ? Math.max(1, Number(maxIdleMinutes))
    : 30;
  return (history || []).filter((item) => {
    if (!item?.created_at) return true;
    const createdAt = new Date(item.created_at);
    if (Number.isNaN(createdAt.getTime())) return true;
    return now.getTime() - createdAt.getTime() <= idleMinutes * 60 * 1000;
  });
}

function commercialTopicFromText(text, base = {}) {
  const normalized = normalizeText(text);
  if (!normalized) return null;
  const material = normalized.includes("fibra russa") ? "Fibra Russa" : "";
  const methodMatches = COMMERCIAL_TOPIC_ALIASES.filter((entry) =>
    entry.terms.some((term) => normalized.includes(normalizeText(term))),
  );
  const method = methodMatches.length === 1 ? methodMatches[0] : null;
  const exactService = (base.services || []).find((service) => {
    if (!service || service.active === false) return false;
    const name = normalizeText(service.commercial_name || service.name);
    return name.length >= 6 && normalized.includes(name);
  }) || null;
  if (!material && !method && !exactService) return null;
  return {
    material,
    methodKey: method?.key || "",
    method: method?.label || "",
    serviceId: exactService?.id || "",
    serviceName: exactService?.commercial_name || exactService?.name || "",
    topicLabel: exactService?.commercial_name || exactService?.name || method?.label || material,
  };
}

function isContextualFollowupText(text) {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  return includesAny(normalized, [
    "como funciona",
    "como e o procedimento",
    "procedimento",
    "e o valor",
    "qual o valor",
    "quanto custa",
    "quanto fica",
    "quanto demora",
    "quanto tempo",
    "duracao",
    "como cuidar",
    "quais cuidados",
    "manutencao",
    "posso lavar",
    "posso pintar",
    "serve para",
    "me explica",
    "explique",
    "sobre isso",
    "sobre esse",
    "sobre essa",
  ]) || /^(?:e\s+)?(?:como|qual|quanto|quando|posso|pode|tem)\b/.test(normalized);
}

export function resolveContextualServiceReference({
  incomingText,
  history = [],
  base = {},
  maxIdleMinutes = 30,
  now = new Date(),
} = {}) {
  const originalText = clean(incomingText);
  const explicitTopic = commercialTopicFromText(originalText, base);
  if (explicitTopic) {
    return {
      ...explicitTopic,
      resolvedFromHistory: false,
      confidence: "high",
      effectiveText: originalText,
    };
  }
  if (!isContextualFollowupText(originalText)) {
    return {
      resolvedFromHistory: false,
      confidence: "none",
      topicLabel: "",
      effectiveText: originalText,
    };
  }

  const recentHistory = recentConversationHistory(history, maxIdleMinutes, now);
  const newestFirst = [...recentHistory].reverse();
  const topic = [
    ...newestFirst.filter((item) => item?.sender_type === "client"),
    ...newestFirst.filter((item) => item?.sender_type !== "client"),
  ].map((item) => commercialTopicFromText(item?.body || "", base)).find(Boolean);
  if (!topic) {
    return {
      resolvedFromHistory: false,
      confidence: "ambiguous",
      topicLabel: "",
      effectiveText: originalText,
    };
  }
  const contextParts = [
    topic.material ? `material ${topic.material}` : "",
    topic.method ? `método ${topic.method}` : "",
    topic.serviceName ? `serviço ${topic.serviceName}` : "",
  ].filter(Boolean);
  return {
    ...topic,
    resolvedFromHistory: true,
    confidence: "high",
    effectiveText: `${originalText}\nAssunto referido no histórico: ${contextParts.join(", ")}.`,
  };
}

function arrayFromJsonLike(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function activePromotions(base = {}, today = localDateParts()) {
  return (base.promotions || []).filter((promotion) => {
    if (!promotion || promotion.active === false) return false;
    const startsAt = promotion.starts_at ? String(promotion.starts_at).slice(0, 10) : "";
    const endsAt = promotion.ends_at ? String(promotion.ends_at).slice(0, 10) : "";
    if (startsAt && startsAt > today) return false;
    if (endsAt && endsAt < today) return false;
    return true;
  });
}

function promotionSearchText(promotion = {}) {
  return normalizeText(
    [
      promotion.title,
      promotion.description,
      ...arrayFromJsonLike(promotion.keywords),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function significantTerms(text) {
  return normalizeText(text)
    .split(/[^a-z0-9]+/)
    .filter(
      (term) =>
        term.length >= 4 &&
        ![
          "promocao",
          "promocoes",
          "desconto",
          "descontos",
          "oferta",
          "ofertas",
          "campanha",
          "liquidacao",
          "preco promocional",
          "cabelo em promocao",
          "mega hair em promocao",
          "promo",
          "valor",
          "preco",
          "quanto",
          "custa",
          "esta",
          "fica",
          "para",
          "pra",
          "tem",
          "qual",
        ].includes(term),
    );
}

function matchingPromotionsForText(text, base = {}) {
  const promotions = activePromotions(base);
  if (!promotions.length) return [];
  const terms = significantTerms(text);
  if (!terms.length) return promotions;
  const matched = promotions.filter((promotion) => {
    const haystack = promotionSearchText(promotion);
    return terms.some((term) => haystack.includes(term));
  });
  return matched.length ? matched : promotions;
}

function matchingPromotionForService(service, base = {}) {
  if (!service) return null;
  const serviceText = serviceSearchText(service);
  return activePromotions(base).find((promotion) => {
    const promoText = promotionSearchText(promotion);
    const keywords = arrayFromJsonLike(promotion.keywords).map(normalizeText);
    if (keywords.some((keyword) => keyword && serviceText.includes(keyword))) return true;
    const promoTerms = promoText.split(/\s+/).filter((term) => term.length >= 4);
    return promoTerms.some((term) => serviceText.includes(term));
  }) || null;
}

function matchingServicesForPriceQuestion(text, base = {}) {
  const normalized = normalizeText(text);
  const services = (base.services || []).filter((service) => service.active !== false);
  return services.filter((service) => {
    const haystack = serviceSearchText(service);
    const terms = haystack.split(/\s+/).filter((term) => term.length >= 4);
    return terms.some((term) => normalized.includes(term));
  });
}

function matchingServicesForCatalogQuery(text, base = {}) {
  const categories = new Map((base.categories || []).map((item) => [item.id, item.name || ""]));
  const methods = new Map((base.methods || []).map((item) => [item.id, item.name || ""]));
  const services = structuredCatalogServices(base);
  const normalizedQuery = catalogChoiceText(text);
  const exactNameMatches = services.filter((service) => {
    const name = catalogChoiceText(service.commercial_name || service.name || "");
    return name.length >= 5 && normalizedQuery.includes(name);
  });
  if (exactNameMatches.length) return exactNameMatches;
  return services.filter((service) => {
    const variants = (base.serviceVariants || [])
      .filter((variant) => variant.service_id === service.id && variant.active !== false)
      .map((variant) => [
        variant.label,
        variant.length_label,
        variant.weight_grams ? `${variant.weight_grams} gramas` : "",
      ].filter(Boolean).join(" "));
    const searchable = [
      service.name,
      service.commercial_name,
      service.short_description,
      service.detailed_description,
      service.description,
      categories.get(service.category_id),
      methods.get(service.hair_method_id),
      ...variants,
    ].filter(Boolean).join(" ");
    return textMatchesCatalogEntry(text, searchable);
  });
}

function catalogChoiceText(value) {
  return normalizeText(value)
    .replace(/[+&]/g, " mais ")
    .replace(/\be\b/g, " mais ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function catalogPriceTokens(value) {
  return (String(value || "").match(/\d[\d.,]*/g) || [])
    .map((token) => token.replace(/,00$/, "").replace(/[.,]/g, ""))
    .filter((token) => token && token !== "0");
}

function catalogOptionMatches(text, option = {}) {
  const input = catalogChoiceText(text);
  const name = catalogChoiceText(option.serviceName || "");
  if (!input || !name) return false;
  if (input === name || input.includes(name)) return true;
  const requestedPrices = catalogPriceTokens(text).filter((token) => token.length >= 3);
  const optionPrices = new Set(catalogPriceTokens(option.priceText));
  if (requestedPrices.length && requestedPrices.every((token) => optionPrices.has(token))) {
    return true;
  }
  const ignored = new Set([
    "combo",
    "mais",
    "com",
    "para",
    "servico",
    "quero",
    "saber",
    "sobre",
  ]);
  const tokens = input.split(" ").filter((token) => token.length >= 4 && !ignored.has(token));
  if (!tokens.length) return false;
  return tokens.every((token) => name.includes(token));
}

export function matchingCatalogInformationOptions(text, options = []) {
  const choice = numericChoice(text);
  if (choice && options.some((option) => Number(option.id) === choice)) {
    return options.filter((option) => Number(option.id) === choice);
  }
  return options.filter((option) => catalogOptionMatches(text, option));
}

export function buildCatalogExplorationResult(text, base = {}) {
  const matches = matchingServicesForCatalogQuery(text, base);
  if (!matches.length) return null;

  const options = matches.map((service, index) => {
    const name = service.commercial_name || service.name;
    const variants = (base.serviceVariants || []).filter((variant) =>
      variant.service_id === service.id &&
      variant.active !== false &&
      variant.allow_whatsapp_booking !== false,
    );
    const prices = variants.map((variant) => Number(variant.price || 0)).filter((value) => value >= 0);
    const priceText = prices.length
      ? `${formatBookingCurrency(Math.min(...prices))}${Math.max(...prices) !== Math.min(...prices) ? ` a ${formatBookingCurrency(Math.max(...prices))}` : ""}`
      : (isFreeService(service) ? "sem custo" : (serviceValue(service) > 0 ? formatBookingCurrency(serviceValue(service)) : "valor sob consulta"));
    return {
      id: index + 1,
      serviceId: service.id,
      serviceName: name,
      priceText,
    };
  });
  const visibleOptions = options.slice(0, 6);
  const numberedOptions = visibleOptions.map((option) => `${option.id}) ${option.serviceName}: ${option.priceText}`);

  if (matches.length === 1) {
    const service = matches[0];
    const description = clean(service.short_description || service.description || service.detailed_description);
    return {
      options,
      text: [
      `Encontrei este serviço relacionado: ${service.commercial_name || service.name}.`,
      description,
      numberedOptions[0],
      "A indicação final é confirmada na avaliação prévia. Responda 1 ou escreva o nome para conhecer os detalhes.",
    ].filter(Boolean).join("\n\n"),
    };
  }

  return {
    options,
    text: [
      "Encontrei estas opções relacionadas no catálogo ativo:",
      numberedOptions.join("\n"),
      matches.length > 6
        ? `Há mais ${matches.length - 6} opção(ões) relacionadas. Envie “mais opções” para visualizar.`
        : "",
      "Responda com o número ou com o nome da opção que você quer conhecer melhor.",
    ].filter(Boolean).join("\n\n"),
  };
}

export function buildCatalogExplorationResponse(text, base = {}) {
  return buildCatalogExplorationResult(text, base)?.text || null;
}

function buildCatalogInformationDetail(option = {}, base = {}, { hasPausedBooking = false } = {}) {
  const service = (base.services || []).find((item) =>
    item.id === option.serviceId &&
    item.active !== false &&
    item.show_online_booking !== false,
  );
  if (!service) return "Essa opção não está mais disponível no catálogo ativo.";
  const variants = (base.serviceVariants || []).filter((variant) =>
    variant.service_id === service.id &&
    variant.active !== false &&
    variant.allow_whatsapp_booking !== false,
  );
  const durations = variants
    .map((variant) => Number(variant.duration_minutes || service.duration_minutes || 0))
    .filter((value) => value > 0);
  const durationText = durations.length
    ? `${Math.min(...durations)}${Math.max(...durations) !== Math.min(...durations) ? ` a ${Math.max(...durations)}` : ""} minutos`
    : Number(service.duration_minutes || 0) > 0
      ? `${Number(service.duration_minutes)} minutos`
      : "confirmada após a avaliação";
  const variantLines = variants.slice(0, 6).map((variant) =>
    `- ${variant.label}: ${formatBookingCurrency(variant.price)}`,
  );
  return [
    `✨ *${service.commercial_name || service.name}*`,
    clean(service.short_description || service.description || service.detailed_description),
    `⏱️ Duração estimada: ${durationText}.`,
    `💰 Valores cadastrados: ${option.priceText}.`,
    variants.some((variant) => variant.requires_assessment) || service.requires_assessment
      ? "📋 Requer avaliação prévia."
      : "",
    variantLines.length ? `Algumas variações:\n${variantLines.join("\n")}` : "",
    variants.length > variantLines.length ? `Existem mais ${variants.length - variantLines.length} variação(ões) cadastradas.` : "",
    hasPausedBooking
      ? "Para comparar outra opção, escreva novamente o nome do serviço. Para voltar ao seu agendamento, envie “continuar”."
      : "Para comparar outra opção, escreva novamente o nome do serviço. Para iniciar um agendamento, envie “menu”.",
  ].filter(Boolean).join("\n\n");
}

function clearCatalogInformationState(state = {}, { keepInformationPause = false } = {}) {
  delete state.catalogInfoOptions;
  delete state.catalogInfoSelectedServiceId;
  delete state.catalogInfoUpdatedAt;
  delete state.catalogInfoStatus;
  delete state.catalogInfoPageStart;
  if (!keepInformationPause) delete state.informationPause;
}

function bookingInformationPauseNotice(state = {}) {
  if (!hasBookingStateProgress(state)) return "";
  return "Seu agendamento continua salvo. Quando quiser retomar, envie “continuar”.";
}

async function handlePendingCatalogInformationChoice({
  normalized,
  conversationId,
  text,
  state,
  base,
}) {
  const options = Array.isArray(state.catalogInfoOptions) ? state.catalogInfoOptions : [];
  const catalogInfoActive = state.catalogInfoStatus === "awaiting_choice" && options.length > 0;
  const informationPause = state.informationPause === true;
  if (!catalogInfoActive && !informationPause) return null;
  const normalizedText = normalizeText(text);
  if (includesAny(normalizedText, ["continuar", "retomar", "voltar ao agendamento"])) {
    clearCatalogInformationState(state);
    state.updatedAt = new Date().toISOString();
    await saveBookingState(conversationId, state);
    const responseText = hasBookingStateProgress(state)
      ? buildBookingResumePrompt(state)
      : "Tudo certo. Envie “serviços” para conhecer o catálogo ou faça uma nova pergunta.";
    await performSendTextAndRecord({
      normalized,
      conversationId,
      text: responseText,
      reason: "booking_catalog_info_resume",
    });
    await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
    return { ok: true, replied: true, reason: "booking_catalog_info_resume", conversationId };
  }

  if (!catalogInfoActive) {
    const isAnotherInformationRequest =
      isClientAskingQuestion(text) ||
      isKnownHairKnowledgeTopic(text) ||
      hasCommercialCatalogReference(text, base);
    if (isAnotherInformationRequest || !hasBookingStateProgress(state)) return null;
    const responseText = [
      "Seu agendamento está pausado enquanto esclarecemos suas dúvidas.",
      "Para voltar exatamente à etapa anterior, envie “continuar”. Se preferir, pode fazer outra pergunta sobre cabelos ou Mega Hair.",
    ].join("\n\n");
    await performSendTextAndRecord({
      normalized,
      conversationId,
      text: responseText,
      reason: "information_pause_waiting",
    });
    await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
    return { ok: true, replied: true, reason: "information_pause_waiting", conversationId };
  }

  if (includesAny(normalizedText, ["mais opcoes", "ver mais opcoes", "proximas opcoes"])) {
    const pageStart = Number(state.catalogInfoPageStart || 0);
    const nextStart = pageStart + 6;
    if (nextStart >= options.length) {
      const responseText = "Você já visualizou todas as opções. Escolha pelo número ou envie “continuar” para retomar o agendamento.";
      await performSendTextAndRecord({
        normalized,
        conversationId,
        text: responseText,
        reason: "booking_catalog_info_last_page",
      });
      await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
      return { ok: true, replied: true, reason: "booking_catalog_info_last_page", conversationId };
    }
    state.catalogInfoPageStart = nextStart;
    state.catalogInfoUpdatedAt = new Date().toISOString();
    state.updatedAt = new Date().toISOString();
    await saveBookingState(conversationId, state);
    const page = options.slice(nextStart, nextStart + 6);
    const responseText = [
      "Mais opções relacionadas:",
      page.map((option) => `${option.id}) ${option.serviceName}: ${option.priceText}`).join("\n"),
      options.length > nextStart + 6 ? "Envie “mais opções” para continuar." : "Estas são as últimas opções.",
      "Escolha pelo número ou escreva o nome.",
    ].join("\n\n");
    await performSendTextAndRecord({
      normalized,
      conversationId,
      text: responseText,
      reason: "booking_catalog_info_more_options",
    });
    await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
    return { ok: true, replied: true, reason: "booking_catalog_info_more_options", conversationId };
  }

  const matches = matchingCatalogInformationOptions(text, options);
  const choice = numericChoice(text);
  if (
    !matches.length &&
    (
      isClientAskingQuestion(text) ||
      isKnownHairKnowledgeTopic(text) ||
      hasCommercialCatalogReference(text, base)
    )
  ) {
    const hasPausedBooking = hasBookingStateProgress(state);
    clearCatalogInformationState(state, { keepInformationPause: hasPausedBooking });
    state.updatedAt = new Date().toISOString();
    await saveBookingState(conversationId, state);
    return null;
  }
  if (matches.length !== 1) {
    const pageStart = Number(state.catalogInfoPageStart || 0);
    const visibleOptions = options.slice(pageStart, pageStart + 6);
    const visible = (matches.length ? matches : visibleOptions)
      .map((option) => `${option.id}) ${option.serviceName}: ${option.priceText}`)
      .join("\n");
    const responseText = [
      matches.length > 1
        ? "Esse nome corresponde a mais de uma opção. Escolha pelo número:"
        : choice
          ? "Não encontrei esse número nas opções apresentadas. Escolha uma destas opções:"
          : "Não identifiquei esse nome nas opções apresentadas. Escolha pelo número ou escreva o nome como aparece na lista:",
      visible,
    ].join("\n\n");
    await performSendTextAndRecord({
      normalized,
      conversationId,
      text: responseText,
      reason: "booking_catalog_info_clarification",
    });
    await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
    return { ok: true, replied: true, reason: "booking_catalog_info_clarification", conversationId };
  }

  const selected = matches[0];
  const hasPausedBooking = hasBookingStateProgress(state);
  clearCatalogInformationState(state, { keepInformationPause: hasPausedBooking });
  state.updatedAt = new Date().toISOString();
  await saveBookingState(conversationId, state);
  const responseText = buildCatalogInformationDetail(selected, base, { hasPausedBooking });
  await performSendTextAndRecord({
    normalized,
    conversationId,
    text: responseText,
    reason: "booking_catalog_info_detail",
  });
  await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
  return { ok: true, replied: true, reason: "booking_catalog_info_detail", conversationId };
}

function matchingServiceForPriceQuestion(text, base = {}) {
  return matchingServicesForPriceQuestion(text, base)[0] || null;
}

function promotionDateText(promotion = {}) {
  const date = promotion.ends_at ? String(promotion.ends_at).slice(0, 10) : "";
  if (!date) return "";
  const label = new Date(`${date}T12:00:00.000Z`).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
  return ` Promocao valida ate ${label}.`;
}

function formatPromotionLine(promotion = {}) {
  const promo = Number(promotion.promotional_value || 0);
  const original = Number(promotion.original_value || 0);
  const valueText =
    original > 0
      ? `De ${formatBookingCurrency(original)} por ${formatBookingCurrency(promo)}.`
      : `Valor promocional: ${formatBookingCurrency(promo)}.`;
  return [
    promotion.title,
    promotion.description,
    valueText + promotionDateText(promotion),
  ].filter(Boolean).join("\n");
}

function buildPromotionIntentResponse(text, base = {}) {
  const active = activePromotions(base);
  const promotions = matchingPromotionsForText(text, base);
  if (!active.length) {
    return [
      "Deixe-me verificar.",
      "No momento nao temos promocoes cadastradas.",
      "Posso te informar os valores normais ou verificar condicoes especiais disponiveis.",
    ].join("\n\n");
  }
  if (!promotions.length) {
    return [
      "Deixe-me verificar.",
      "No momento nao encontrei promocao ativa cadastrada para essa pergunta.",
      "Posso verificar o valor normal do servico ou te ajudar a agendar uma avaliacao.",
    ].join("\n\n");
  }
  const selected = promotions.slice(0, 3).map(formatPromotionLine).join("\n\n");
  return [
    "Deixe-me verificar.",
    promotions.length === 1 ? "Temos uma promocao ativa:" : "Temos promocoes ativas:",
    selected,
    "Deseja agendar uma avaliacao ou aplicacao?",
  ].join("\n\n");
}

function buildPriceIntentResponse(text, base = {}) {
  const matches = matchingServicesForPriceQuestion(text, base);
  if (!matches.length) return null;
  if (matches.length > 1) {
    const options = matches.slice(0, 6).map((service) => {
      const variants = (base.serviceVariants || []).filter((variant) =>
        variant.service_id === service.id && variant.active !== false && variant.allow_whatsapp_booking !== false,
      );
      const prices = variants.map((variant) => Number(variant.price || 0)).filter((value) => value >= 0);
      if (!prices.length) return `- ${service.name}: ${servicePriceText(service, serviceValue(service), { serviceName: service.name })}`;
      const minimum = Math.min(...prices);
      const maximum = Math.max(...prices);
      return `- ${service.name}: ${formatBookingCurrency(minimum)}${maximum !== minimum ? ` a ${formatBookingCurrency(maximum)}` : ""}.`;
    });
    return [
      "Trabalhamos com estas opções cadastradas:",
      options.join("\n"),
      "O preço final depende do método, comprimento e gramatura. Qual método você deseja: Fita Adesiva, Ponto Americano Invisível, Entrelace ou Microcápsula de Queratina?",
    ].join("\n\n");
  }
  const service = matches[0];
  const serviceName = service.commercial_name || service.name;
  const variants = (base.serviceVariants || []).filter((variant) =>
    variant.service_id === service.id && variant.active !== false && variant.allow_whatsapp_booking !== false,
  );
  const numericTerms = [...new Set((String(text).match(/\d+/g) || []).map(Number))];
  const exactVariants = numericTerms.length
    ? variants.filter((variant) => {
        const variantNumbers = (normalizeText([
          variant.label,
          variant.length_label,
          variant.weight_grams,
          variant.unit_count,
        ].filter(Boolean).join(" ")).match(/\d+/g) || []).map(Number);
        return numericTerms.every((term) => variantNumbers.includes(term));
      })
    : [];
  const variantPrices = variants.map((variant) => Number(variant.price || 0)).filter((value) => value >= 0);
  const price = exactVariants.length === 1
    ? Number(exactVariants[0].price || 0)
    : variantPrices.length
      ? Math.min(...variantPrices)
      : serviceValue(service);
  const promotion = matchingPromotionForService(service, base);
  const lines = [
    exactVariants.length === 1
      ? `${serviceName} — ${exactVariants[0].label}: ${formatBookingCurrency(price)}.`
      : variantPrices.length
        ? `${serviceName} possui opções de ${formatBookingCurrency(Math.min(...variantPrices))} a ${formatBookingCurrency(Math.max(...variantPrices))}, conforme comprimento e quantidade.`
        : servicePriceText(service, price, { serviceName }),
  ];
  if (promotion) {
    lines.push(
      [
        `Temos uma promocao ativa: ${promotion.title}.`,
        formatPromotionLine(promotion),
      ].join("\n"),
    );
  }
  lines.push("Quer que eu verifique uma avaliacao ou horario para voce?");
  return lines.join("\n\n");
}

function activeMethodLabelsForServices(services = []) {
  return COMMERCIAL_TOPIC_ALIASES
    .filter((entry) => services.some((service) => {
      const haystack = serviceSearchText(service);
      return entry.terms.some((term) => haystack.includes(normalizeText(term)));
    }))
    .map((entry) => entry.label);
}

export function buildServiceAvailabilityIntentResponse(text, base = {}) {
  const normalized = normalizeText(text);
  const asksIfOffered = includesAny(normalized, [
    "trabalha com",
    "trabalham com",
    "voces trabalham",
    "voce trabalha",
    "voces fazem",
    "voce faz",
    "oferece",
    "oferecem",
    "tem fibra",
  ]);
  if (!asksIfOffered) return null;
  const matches = matchingServicesForPriceQuestion(text, base);
  if (!matches.length) return null;

  if (normalized.includes("fibra russa")) {
    const methods = activeMethodLabelsForServices(matches);
    const methodClause = methods.length
      ? `com aplicação por ${methods.join(", ").replace(/, ([^,]*)$/, " e $1")}`
      : "nos combos ativos do catálogo";
    return [
      "Sim, trabalhamos com Fibra Russa 😊",
      `Ela é uma fibra sintética oferecida ${methodClause}. Todos exigem avaliação prévia, e a disponibilidade do material é confirmada pela profissional.`,
      "Você quer saber como funciona, consultar os valores ou conhecer as diferenças entre os métodos?",
    ].join("\n\n");
  }

  const names = [...new Set(matches.map((service) => service.commercial_name || service.name))]
    .filter(Boolean)
    .slice(0, 5);
  return [
    `Sim, trabalhamos com ${names.join(", ").replace(/, ([^,]*)$/, " e $1")}.`,
    "A indicação e as opções disponíveis são confirmadas na avaliação prévia.",
    "Você quer saber como funciona ou consultar os valores?",
  ].join("\n\n");
}

export function buildContextualProcedureResponse(text, base = {}, context = {}) {
  const normalized = normalizeText(text);
  const asksHowItWorks = includesAny(normalized, [
    "como funciona",
    "como e o procedimento",
    "explique o procedimento",
    "me explica o procedimento",
  ]);
  if (!asksHowItWorks) return null;

  const isRussianFiber = context.material === "Fibra Russa" || normalized.includes("fibra russa");
  if (isRussianFiber && !context.method) {
    const matchingServices = (base.services || []).filter((service) =>
      service.active !== false && serviceSearchText(service).includes("fibra russa"),
    );
    const methods = activeMethodLabelsForServices(matchingServices);
    const methodText = methods.length
      ? methods.join(", ").replace(/, ([^,]*)$/, " e $1")
      : "o método escolhido";
    return [
      "Sobre a Fibra Russa: ela é uma fibra sintética usada para proporcionar volume e/ou comprimento.",
      `Primeiro fazemos uma avaliação do cabelo e do resultado desejado. Depois definimos cor, comprimento, gramatura e a forma de colocação. A aplicação e o tempo mudam conforme o método: ${methodText}.`,
      "Qual desses métodos você quer conhecer melhor?",
    ].join("\n\n");
  }

  const hasSpecificSalonTerm = aiDomainTerms.some((term) => normalized.includes(normalizeText(term)));
  if (context.topicLabel || hasSpecificSalonTerm) return null;
  const activeServices = (base.services || []).filter((service) => service.active !== false);
  const methods = activeMethodLabelsForServices(activeServices);
  const methodText = methods.length
    ? methods.join(", ").replace(/, ([^,]*)$/, " e $1")
    : "o método adequado";
  return [
    "Em geral, o atendimento começa com uma avaliação do cabelo e do resultado que você deseja.",
    `Depois definimos o material, a quantidade, o comprimento e o método de aplicação. Trabalhamos com opções como ${methodText}, conforme os serviços ativos.`,
    "Sobre qual método você quer saber?",
  ].join("\n\n");
}

export function findEvaluationService(servicesList = []) {
  const EVALUATION_ALIASES = ["avaliacao", "avaliação", "avaliar", "assessment", "diagnostico", "diagnóstico"];
  return (servicesList || []).find((service) => {
    if (!service || service.active === false) return false;
    const nameOnly = normalizeText(
      [service.name, service.commercial_name].filter(Boolean).join(" ")
    );
    return EVALUATION_ALIASES.some((alias) => nameOnly.includes(alias));
  }) || null;
}

export function prepareRequiredAssessmentBooking(state = {}, base = {}) {
  if (!state.serviceRequiresAssessment || state.bookingPurpose === "assessment") return false;
  const assessment = (base.services || []).find((service) =>
    service.active !== false &&
    service.show_online_booking !== false &&
    service.catalog_code === "assessment-extensions",
  ) || findEvaluationService(bookableAiServices(base));
  if (!assessment || assessment.id === state.serviceId) return false;

  const requestedProcedure = {
    serviceId: state.serviceId || "",
    serviceVariantId: state.serviceVariantId || "",
    serviceVariantCode: state.serviceVariantCode || "",
    serviceName: state.serviceName || state.requestedServiceName || "",
    value: Number(state.serviceValue || 0),
    durationMinutes: Number(state.serviceDurationMinutes || 0),
  };
  const assessmentDetails = bookingServiceDetails(assessment);
  const assessmentName = assessment.commercial_name || assessment.name;
  Object.assign(state, {
    bookingPurpose: "assessment",
    requestedProcedure,
    requestedServiceId: requestedProcedure.serviceId,
    requestedServiceVariantId: requestedProcedure.serviceVariantId,
    requestedServiceName: requestedProcedure.serviceName,
    serviceId: assessment.id,
    serviceVariantId: "",
    serviceVariantCode: "",
    serviceName: assessmentName,
    baseServiceName: assessmentName,
    serviceValue: serviceValue(assessment),
    serviceIsFree: isFreeService(assessment),
    offerInventoryItems: false,
    ...assessmentDetails,
    serviceRequiresAssessment: false,
    serviceDetailsAccepted: true,
    addonOptions: [],
    addonIds: [],
    addons: [],
    addonDecisionMade: true,
    serviceNote: `Como ${requestedProcedure.serviceName} exige avaliação prévia, este horário será reservado para a avaliação. O procedimento definitivo será confirmado e agendado separadamente pela profissional.`,
  });
  return true;
}

export function selectBookingService(text, base = {}, state = {}) {
  const choice = numericChoice(text);
  if (state.status === "awaiting_service" && Array.isArray(state.serviceOptions)) {
    if (choice) {
      const selected = state.serviceOptions.find((item) => Number(item.id) === choice);
      return selected?.serviceId ? selected : null;
    }

    const namedMatches = state.serviceOptions.filter((item) => {
      const serviceName = item.serviceName || item.requestedServiceName || "";
      return serviceName && catalogOptionMatches(text, { serviceName });
    });
    const selected = namedMatches.length === 1 ? namedMatches[0] : null;
    return selected?.serviceId ? selected : null;
  }


  const normalized = normalizeText(text);
  const services = (base.services || []).filter((service) => service.active !== false);
  const bookable = bookableAiServices(base);
  const evaluation = findEvaluationService(bookable);
  const matching = services.filter((service) => {
    const nameStr = normalizeText(service.commercial_name || service.name || "");
    if (!nameStr) return false;

    // Correspondência exata se o nome do serviço inteiro estiver na mensagem
    if (nameStr.length >= 5 && normalized.includes(nameStr)) return true;

    // Correspondência por palavras significativas do nome do serviço
    const ignored = new Set(["para", "como", "qual", "fazer", "com", "sem", "uma", "por", "que"]);
    const serviceTokens = nameStr.split(/\s+/).filter(t => t.length >= 4 && !ignored.has(t));

    if (serviceTokens.length > 0) {
      const userTokens = normalized.split(/\s+/);
      const matches = serviceTokens.filter(st => userTokens.includes(st));
      // Exige pelo menos 2 palavras do nome do serviço, ou todas se o nome tiver apenas 1 palavra útil
      if (matches.length >= Math.min(2, serviceTokens.length)) return true;
    }
    return false;
  });
  const exactMatches = matching.filter((service) => {
    const name = normalizeText(service.commercial_name || service.name || "");
    return name.length >= 5 && normalized.includes(name);
  });
  const candidates = exactMatches.length ? exactMatches : matching;
  const matched = candidates.length === 1 ? candidates[0] : null;

  // Uma referência compartilhada por vários serviços (por exemplo, somente o
  // material) nunca deve selecionar silenciosamente o primeiro item do catálogo.
  if (candidates.length > 1) return null;

  if (matched?.allow_auto_booking) {
    return {
      serviceId: matched.id,
      serviceName: matched.commercial_name || matched.name,
      requestedServiceName: matched.commercial_name || matched.name,
      serviceValue: serviceValue(matched),
      serviceIsFree: isFreeService(matched),
      offerInventoryItems: matched.offer_inventory_items === true,
      categoryId: matched.category_id,
      methodId: matched.hair_method_id,
      ...bookingServiceDetails(matched),
    };
  }

  const asksApplication = includesAny(normalized, ["aplicacao", "aplicação", "aplicar", "fibra russa", "mega hair"]);
  const asksMaintenance = includesAny(normalized, ["manutencao", "manutenção", "retirar", "reposicionar"]);
  const asksEvaluation = includesAny(normalized, ["avaliacao", "avaliação", "diagnostico", "diagnóstico"]);

  if (evaluation && (matched || asksApplication || asksMaintenance || asksEvaluation)) {
    return {
      serviceId: evaluation.id,
      serviceName: evaluation.commercial_name || evaluation.name,
      requestedServiceName:
        matched?.commercial_name ||
        matched?.name ||
        (asksMaintenance ? "Manutenção" : asksApplication ? "Aplicação de Mega Hair" : evaluation.name),
      serviceValue: serviceValue(evaluation),
      serviceIsFree: isFreeService(evaluation),
      offerInventoryItems: evaluation.offer_inventory_items === true,
      categoryId: evaluation.category_id,
      methodId: evaluation.hair_method_id,
      ...bookingServiceDetails(evaluation),
      note:
        matched && !matched.allow_auto_booking
          ? "O serviço solicitado exige validação da equipe; a IA vai registrar uma avaliação primeiro."
          : "",
    };
  }

  return null;
}

export function isServiceCatalogMenuIntent(text) {
  const normalized = normalizeText(text).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  if ([
    "servico",
    "servicos",
    "ver servicos",
    "quero ver servicos",
    "quais servicos",
    "quais servicos disponiveis",
    "quais servicos estao disponiveis",
    "servicos disponiveis",
    "lista de servicos",
    "catalogo de servicos",
  ].includes(normalized)) return true;
  return /^(?:quero saber |me mostra |mostre )?(?:quais |que )?servicos (?:voces? (?:tem|oferece|oferecem)|tem disponiveis)$/.test(normalized);
}

export function detectBookingGlobalCommand(text) {
  const normalized = normalizeText(text)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (
    ["cancelar", "cancela", "cacenlar", "desistir"].includes(normalized) ||
    includesAny(normalized, ["cancelar agendamento", "nao quero mais"])
  ) return "cancel";

  if (["voltar", "voltar menu", "retornar", "anterior"].includes(normalized)) return "back";
  if (["menu", "inicio", "comecar novamente"].includes(normalized)) return "main_menu";
  if (includesAny(normalized, ["outro servico", "trocar servico", "mudar servico"])) return "change_service";
  if (
    ["atendente", "humano"].includes(normalized) ||
    includesAny(normalized, [
      "falar com alguem",
      "falar com atendente",
      "falar com um atendente",
      "falar com humano",
      "chamar atendente",
    ])
  ) return "handoff";

  return "";
}

function buildCategoryOptions(base = {}) {
  const services = structuredCatalogServices(base);
  const categoriesMap = new Map();
  for (const s of services) {
    if (s.category_id) {
      categoriesMap.set(s.category_id, true);
    }
  }
  return (base.categories || [])
    .filter(c => categoriesMap.has(c.id))
    .map((c, index) => ({
      id: index + 1,
      categoryId: c.id,
      categoryName: c.name,
    }));
}

export function buildInitialCategoryCatalogOptions(base = {}) {
  return buildCategoryOptions(base);
}

function buildMethodOptions(base = {}, categoryId) {
  const services = structuredCatalogServices(base).filter(s => s.category_id === categoryId);
  const methodsMap = new Map();
  for (const s of services) {
    if (s.hair_method_id) {
      methodsMap.set(s.hair_method_id, true);
    }
  }
  return (base.methods || [])
    .filter(m => methodsMap.has(m.id) && m.active !== false)
    .map((m, index) => ({
      id: index + 1,
      methodId: m.id,
      methodName: m.name,
    }));
}

function buildAddonOptions(base = {}, serviceVariantId) {
  const addons = (base.serviceAddons || []).filter((addon) => addon.service_variant_id === serviceVariantId);
  return [
    { id: 1, addonId: "", addonName: "Continuar sem adicional", addonValue: 0, addonDurationMinutes: 0 },
    ...addons.map((addon, index) => ({
      id: index + 2,
      addonId: addon.id,
      addonName: addon.name,
      addonValue: Number(addon.price || 0),
      addonDurationMinutes: Number(addon.duration_minutes || 0),
    })),
  ];
}

function buildServiceOptions(base = {}, categoryId, methodId) {
  let services = structuredCatalogServices(base);
  if (categoryId) services = services.filter(s => s.category_id === categoryId);
  if (methodId) services = services.filter(s => s.hair_method_id === methodId);

  const options = [];
  for (const service of services) {
    const variants = (base.serviceVariants || []).filter((variant) => variant.service_id === service.id);
    const source = variants.length ? variants : [null];
    for (const variant of source) {
      options.push({
        id: options.length + 1,
        serviceId: service.id,
        serviceVariantId: variant?.id || "",
        serviceVariantCode: variant?.code || "",
        serviceName: variant ? `${service.commercial_name || service.name} — ${variant.label}` : service.commercial_name || service.name,
        baseServiceName: service.commercial_name || service.name,
        requestedServiceName: service.commercial_name || service.name,
        serviceValue: variant ? Number(variant.price || 0) : serviceValue(service),
        serviceIsFree: variant ? Number(variant.price || 0) === 0 : isFreeService(service),
        offerInventoryItems: variant ? false : service.offer_inventory_items === true,
        categoryId: service.category_id,
        methodId: service.hair_method_id,
        categoryName: (base.categories || []).find((item) => item.id === service.category_id)?.name || "",
        methodName: (base.methods || []).find((item) => item.id === service.hair_method_id)?.name || "",
        ...bookingServiceDetails(service),
        ...(variant ? {
          serviceDurationMinutes: Number(variant.duration_minutes || 0),
          serviceDepositType: variant.deposit_type,
          serviceDepositAmount: Number(variant.deposit_value || 0),
          serviceRequiresAssessment: variant.requires_assessment === true,
          serviceRequiresDeposit: !["none","material_cost"].includes(variant.deposit_type),
          serviceRequiresHumanConfirmation: variant.requires_human_confirmation === true,
          serviceDepositNonRefundable: variant.deposit_non_refundable === true,
          serviceMaterialMode: variant.material_mode,
          serviceNote: variant.notes || "",
        } : {}),
      });
    }
  }
  return options;
}

export function buildInitialServiceCatalogOptions(base = {}) {
  return buildServiceOptions(base, "", "");
}

function serviceCatalogOptionLabel(option = {}) {
  const classification = [option.categoryName, option.methodName].filter(Boolean).join(" / ");
  return classification ? `${option.serviceName} - ${classification}` : option.serviceName;
}

export function buildInventoryOptions(base = {}, serviceChoice) {
  if (!serviceChoice.offerInventoryItems) return [];
  const categoryItems = (base.inventory || []).filter((item) =>
    item.active !== false &&
    Number(item.quantity || 0) > 0 &&
    item.category_id === serviceChoice.categoryId
  );
  const exactMethodItems = serviceChoice.methodId
    ? categoryItems.filter((item) => item.hair_method_id === serviceChoice.methodId)
    : categoryItems;
  const genericCategoryItems = serviceChoice.methodId
    ? categoryItems.filter((item) => !item.hair_method_id)
    : [];
  const items = [...exactMethodItems, ...genericCategoryItems];
  return items.map((item, index) => ({
    id: index + 1,
    inventoryId: item.id,
    inventoryName: [
      item.color,
      item.shade,
      item.length_cm
        ? (String(item.length_cm).toLowerCase().includes("cm") ? item.length_cm : `${item.length_cm} cm`)
        : "",
      item.texture,
      Number(item.weight_grams || 0) > 0 ? `${item.weight_grams} g` : "",
    ].filter(Boolean).join(" - ") || item.name,
    inventoryValue: Number(item.suggested_price || 0),
  }));
}

function applyServiceChoiceToState(state, selected) {
  Object.assign(state, {
    serviceId: selected.serviceId,
    serviceVariantId: selected.serviceVariantId || "",
    serviceVariantCode: selected.serviceVariantCode || "",
    serviceName: selected.serviceName,
    baseServiceName: selected.baseServiceName || selected.serviceName,
    requestedServiceName: selected.requestedServiceName || selected.serviceName,
    serviceValue: selected.serviceValue || 0,
    serviceIsFree: selected.serviceIsFree === true,
    offerInventoryItems: selected.offerInventoryItems === true,
    categoryId: selected.categoryId || state.categoryId || "",
    methodId: selected.methodId || state.methodId || "",
    ...serviceDetailsState(selected),
    serviceDetailsAccepted: false,
    serviceNote: selected.note || "",
    addonOptions: [],
    addonIds: [],
    addons: [],
    addonDecisionMade: false,
  });
}

async function processServiceHierarchySelection(text, base, state, conversationId, normalized, isAgendaIntent = false, parsedDate = "") {
  const choice = numericChoice(text);

  if (state.status === "awaiting_category" && Array.isArray(state.categoryOptions)) {
    const normalizedText = normalizeText(text);
    const selected = state.categoryOptions.find(item =>
      (choice && Number(item.id) === choice) ||
      normalizeText(item.categoryName) === normalizedText ||
      normalizedText.includes(normalizeText(item.categoryName)),
    );
    if (selected) {
      state.categoryId = selected.categoryId;
      state.categoryName = selected.categoryName;
      state.status = "collecting";
    } else {
      await saveBookingState(conversationId, state);
      const responseText = [
        "Escolha uma categoria respondendo com o número:",
        optionLines(state.categoryOptions, (item) => item.categoryName),
      ].join("\n\n");
      await performSendTextAndRecord({ normalized, conversationId, text: responseText, reason: "booking_category_options" });
      await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
      return { ok: true, replied: true, reason: "booking_category_options", conversationId };
    }
  }
  if (state.status === "awaiting_method" && choice && Array.isArray(state.methodOptions)) {
    const selected = state.methodOptions.find(item => Number(item.id) === choice);
    if (selected) {
      state.methodId = selected.methodId;
      state.methodName = selected.methodName;
      state.status = "collecting";
    }
  }
  if (state.status === "awaiting_service" && choice && Array.isArray(state.serviceOptions)) {
    const selected = state.serviceOptions.find(item => Number(item.id) === choice);
    if (selected) applyServiceChoiceToState(state, selected);
  }
  if (state.status === "awaiting_inventory" && Array.isArray(state.inventoryOptions)) {
    const selected = choice
      ? state.inventoryOptions.find(item => Number(item.id) === choice)
      : null;
    if (!selected) {
      await saveBookingState(conversationId, state);
      const responseText = [
        "Agora estamos escolhendo o item de estoque deste serviço.",
        optionLines(state.inventoryOptions, (item) => item.inventoryValue
          ? `${item.inventoryName} - ${formatBookingCurrency(item.inventoryValue)}`
          : item.inventoryName),
        "Responda com o número do item desejado.",
      ].join("\n\n");
      await performSendTextAndRecord({ normalized, conversationId, text: responseText, reason: "booking_inventory_invalid_choice" });
      await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
      return { ok: true, replied: true, reason: "booking_inventory_invalid_choice", conversationId };
    }
    state.inventoryId = selected.inventoryId;
    state.inventoryName = selected.inventoryName;
    if (selected.inventoryValue > 0) state.serviceValue = selected.inventoryValue;
    state.serviceName = `${state.baseServiceName || state.requestedServiceName || state.serviceName} - ${state.inventoryName}`;
    state.status = "collecting";
  }

  if (state.status === "awaiting_addon" && Array.isArray(state.addonOptions)) {
    const selected = choice ? state.addonOptions.find(item => Number(item.id) === choice) : null;
    if (!selected) {
      await saveBookingState(conversationId, state);
      const responseText = [
        "Escolha um adicional respondendo com o número:",
        optionLines(state.addonOptions, (item) => item.addonValue > 0
          ? `${item.addonName} — ${formatBookingCurrency(item.addonValue)}`
          : item.addonName),
      ].join("\n\n");
      await performSendTextAndRecord({ normalized, conversationId, text: responseText, reason: "booking_addon_invalid_choice" });
      return { ok: true, replied: true, reason: "booking_addon_invalid_choice", conversationId };
    }
    state.addonIds = selected.addonId ? [selected.addonId] : [];
    state.addons = selected.addonId ? [selected] : [];
    state.addonDecisionMade = true;
    state.status = "collecting";
  }

  if (!state.serviceId && !choice) {
    const serviceChoice = selectBookingService(text, base, state);
    if (serviceChoice) {
      applyServiceChoiceToState(state, serviceChoice);
    }
  }

  if (!state.serviceId && !state.categoryId) {
    const categoryOptions = buildCategoryOptions(base);
    if (categoryOptions.length === 1) {
      state.categoryId = categoryOptions[0].categoryId;
    } else if (categoryOptions.length > 1) {
      state.categoryOptions = categoryOptions;
      state.status = "awaiting_category";
      await saveBookingState(conversationId, state);
      const prefix = isAgendaIntent ? `Consigo consultar a agenda real${parsedDate ? ` para ${formatDateLabel(parsedDate)}` : ""}. Para verificar com precisão,` : "Posso registrar o pré-agendamento pelo WhatsApp ✨";
      const responseText = [
        prefix,
        "Escolha a categoria do serviço respondendo só com o número:",
        optionLines(categoryOptions, (item) => item.categoryName),
      ].join("\n\n");
      await performSendTextAndRecord({ normalized, conversationId, text: responseText, reason: "booking_category_options" });
      await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
      return { ok: true, replied: true, reason: "booking_category_options", conversationId };
    }
  }

  if (!state.serviceId) {
    if (state.categoryId && !state.methodId) {
      const methodOptions = buildMethodOptions(base, state.categoryId);
      if (methodOptions.length === 1) {
        state.methodId = methodOptions[0].methodId;
        state.methodName = methodOptions[0].methodName;
      } else if (methodOptions.length > 1) {
        state.methodOptions = methodOptions;
        state.status = "awaiting_method";
        await saveBookingState(conversationId, state);
        const responseText = [
          `Escolha o método em ${state.categoryName || "esta categoria"}:`,
          optionLines(methodOptions, (item) => item.methodName),
        ].join("\n\n");
        await performSendTextAndRecord({ normalized, conversationId, text: responseText, reason: "booking_method_options" });
        return { ok: true, replied: true, reason: "booking_method_options", conversationId };
      }
    }
    const serviceOptions = buildServiceOptions(base, state.categoryId, state.methodId || "");
    if (serviceOptions.length === 1) {
      const selected = serviceOptions[0];
      applyServiceChoiceToState(state, selected);
    } else if (serviceOptions.length > 1) {
      state.serviceOptions = serviceOptions;
      state.status = "awaiting_service";
      await saveBookingState(conversationId, state);
      const prefix = isAgendaIntent ? `Consigo consultar a agenda real${parsedDate ? ` para ${formatDateLabel(parsedDate)}` : ""}.` : "Posso registrar o pré-agendamento pelo WhatsApp ✨";
      const instruction = state.categoryId
        ? `Serviços ativos em ${state.categoryName || "sua categoria"}:`
        : "Escolha o serviço respondendo só com o número:";
      const responseText = [
        prefix,
        instruction,
        optionLines(serviceOptions, (item) => item.serviceName),
      ].filter(Boolean).join("\n\n");
      await performSendTextAndRecord({ normalized, conversationId, text: responseText, reason: "booking_service_options" });
      await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
      return { ok: true, replied: true, reason: "booking_service_options", conversationId };
    } else {
      state.status = "awaiting_category";
      state.categoryOptions = buildCategoryOptions(base);
      await saveBookingState(conversationId, state);
      const responseText = [
        "Não encontrei serviços ativos nessa categoria.",
        "Escolha outra categoria:",
        optionLines(state.categoryOptions, (item) => item.categoryName),
      ].filter(Boolean).join("\n\n");
      await performSendTextAndRecord({ normalized, conversationId, text: responseText, reason: "booking_category_without_services" });
      await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
      return { ok: true, replied: true, reason: "booking_category_without_services", conversationId };
    }
  }

  if (
    state.serviceId &&
    state.offerInventoryItems &&
    !state.inventoryId
  ) {
    const inventoryOptions = buildInventoryOptions(base, state);
    if (inventoryOptions.length > 0) {
      state.inventoryOptions = inventoryOptions;
      state.serviceDetailsAccepted = true;
      state.status = "awaiting_inventory";
      await saveBookingState(conversationId, state);
      const responseText = [
        buildServicePresentation(state),
        "Itens disponíveis em estoque para este serviço:",
        optionLines(inventoryOptions, (item) => item.inventoryValue
          ? `${item.inventoryName} - ${formatBookingCurrency(item.inventoryValue)}`
          : item.inventoryName),
        "Responda com o número do item desejado.",
      ].join("\n\n");
      await performSendTextAndRecord({ normalized, conversationId, text: responseText, reason: "booking_inventory_options" });
      await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
      return { ok: true, replied: true, reason: "booking_inventory_options", conversationId };
    }
  }

  return null;
}

async function openInitialServiceCatalog({
  normalized,
  conversationId,
  base,
  recorded,
  greetingText = "",
}) {
  const categoryOptions = buildInitialCategoryCatalogOptions(base);
  const serviceOptions = buildInitialServiceCatalogOptions(base);
  if (!categoryOptions.length && !serviceOptions.length) {
    const responseText = [
      greetingText,
      "No momento não encontrei serviços ativos disponíveis no catálogo.",
      "Vou encaminhar seu atendimento para a equipe conferir o cadastro.",
    ].filter(Boolean).join("\n\n");
    await performSendTextAndRecord({
      normalized,
      conversationId,
      text: responseText,
      reason: "booking_catalog_empty",
    });
    await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
    return { ok: true, replied: true, reason: "booking_catalog_empty", conversationId };
  }

  const state = {
    status: categoryOptions.length ? "awaiting_category" : "awaiting_service",
    categoryOptions,
    serviceOptions: categoryOptions.length ? [] : serviceOptions,
    clientPhone: normalized.phoneNumber,
    previousAppointmentId: recorded.conversation.appointment_id || "",
    updatedAt: new Date().toISOString(),
  };
  hydrateBookingContactFromClient(state, recorded.client);
  await saveBookingState(conversationId, state);

  const responseText = [
    greetingText,
    categoryOptions.length ? "Categorias de serviços disponíveis:" : "Serviços disponíveis:",
    categoryOptions.length
      ? optionLines(categoryOptions, (item) => item.categoryName)
      : optionLines(serviceOptions, serviceCatalogOptionLabel),
    categoryOptions.length
      ? "Responda com o número da categoria para ver os serviços e itens disponíveis."
      : "Responda com o número do serviço para ver a apresentação, os detalhes e as opções disponíveis.",
  ].filter(Boolean).join("\n\n");
  await performSendTextAndRecord({
    normalized,
    conversationId,
    text: responseText,
    reason: categoryOptions.length ? "booking_initial_category_catalog" : "booking_initial_service_catalog",
  });
  await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
  return {
    ok: true,
    replied: true,
    reason: categoryOptions.length ? "booking_initial_category_catalog" : "booking_initial_service_catalog",
    conversationId,
  };
}

function clearSelectedService(state) {
  Object.assign(state, {
    serviceId: "",
    serviceVariantId: "",
    serviceVariantCode: "",
    serviceName: "",
    baseServiceName: "",
    requestedServiceName: "",
    serviceValue: 0,
    serviceIsFree: false,
    serviceNote: "",
    serviceDescription: "",
    serviceDetailedDescription: "",
    serviceDurationMinutes: 0,
    serviceDepositAmount: 0,
    serviceDepositType: "amount",
    serviceRequiresAssessment: false,
    serviceRequiresDeposit: false,
    serviceRecommendedMessage: "",
    serviceDetailsAccepted: false,
    offerInventoryItems: false,
    inventoryId: "",
    inventoryName: "",
    inventoryOptions: [],
    addonOptions: [],
    addonIds: [],
    addons: [],
    addonDecisionMade: false,
    date: "",
    dateOptions: [],
    time: "",
    period: "",
    preferredTime: "",
    professionalId: "",
    professionalName: "",
    slotOptions: [],
    slotPageStart: 0,
  });
}

async function openServicesForCurrentCategory({ normalized, conversationId, base, recorded, state }) {
  if (!state.categoryId) {
    return openInitialServiceCatalog({ normalized, conversationId, base, recorded });
  }

  const serviceOptions = buildServiceOptions(base, state.categoryId, "");
  if (!serviceOptions.length) {
    return openInitialServiceCatalog({ normalized, conversationId, base, recorded });
  }

  clearSelectedService(state);
  state.status = "awaiting_service";
  state.serviceOptions = serviceOptions;
  state.updatedAt = new Date().toISOString();
  await saveBookingState(conversationId, state);

  const responseText = [
    `Serviços ativos em ${state.categoryName || "sua categoria"}:`,
    optionLines(serviceOptions, (item) => item.serviceName),
    "Responda com o número do serviço desejado.",
  ].join("\n\n");
  await performSendTextAndRecord({ normalized, conversationId, text: responseText, reason: "booking_back_to_services" });
  await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
  return { ok: true, replied: true, reason: "booking_back_to_services", conversationId };
}

async function reopenInventoryStep({ normalized, conversationId, base, state }) {
  const inventoryOptions = buildInventoryOptions(base, state);
  if (!inventoryOptions.length) return null;

  state.inventoryId = "";
  state.inventoryName = "";
  state.inventoryOptions = inventoryOptions;
  state.serviceName = state.baseServiceName || state.requestedServiceName || state.serviceName;
  state.date = "";
  state.dateOptions = [];
  state.time = "";
  state.period = "";
  state.preferredTime = "";
  state.professionalId = "";
  state.professionalName = "";
  state.slotOptions = [];
  state.slotPageStart = 0;
  state.serviceDetailsAccepted = true;
  state.status = "awaiting_inventory";
  state.updatedAt = new Date().toISOString();
  await saveBookingState(conversationId, state);

  const responseText = [
    buildServicePresentation(state),
    "Itens disponíveis em estoque para este serviço:",
    optionLines(inventoryOptions, (item) => item.inventoryValue
      ? `${item.inventoryName} - ${formatBookingCurrency(item.inventoryValue)}`
      : item.inventoryName),
    "Responda com o número do item desejado.",
  ].join("\n\n");
  await performSendTextAndRecord({ normalized, conversationId, text: responseText, reason: "booking_back_to_inventory" });
  await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
  return { ok: true, replied: true, reason: "booking_back_to_inventory", conversationId };
}

async function reopenDateStep({ normalized, conversationId, state }) {
  state.date = "";
  state.time = "";
  state.period = "";
  state.preferredTime = "";
  state.professionalId = "";
  state.professionalName = "";
  state.slotOptions = [];
  state.slotPageStart = 0;
  state.dateOptions = dateOptionsFrom();
  state.status = "awaiting_date";
  state.updatedAt = new Date().toISOString();
  await saveBookingState(conversationId, state);

  const responseText = [
    "Escolha a data respondendo com o número:",
    optionLines(state.dateOptions, (item) => item.label),
    "Se preferir outro dia, envie no formato 10/07.",
  ].join("\n\n");
  await performSendTextAndRecord({ normalized, conversationId, text: responseText, reason: "booking_back_to_date" });
  await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
  return { ok: true, replied: true, reason: "booking_back_to_date", conversationId };
}

async function reopenSlotStep({ normalized, conversationId, state }) {
  if (!state.date || !Array.isArray(state.slotOptions) || !state.slotOptions.length) return null;

  state.time = "";
  state.professionalId = "";
  state.professionalName = "";
  state.slotPageStart = 0;
  state.status = "awaiting_slot";
  state.updatedAt = new Date().toISOString();
  await saveBookingState(conversationId, state);

  const responseText = [
    `Escolha novamente o horário para ${formatDateLabel(state.date)}:`,
    slotPageLines(state.slotOptions, 0),
  ].join("\n\n");
  await performSendTextAndRecord({ normalized, conversationId, text: responseText, reason: "booking_back_to_slot" });
  await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
  return { ok: true, replied: true, reason: "booking_back_to_slot", conversationId };
}

async function handleBookingGlobalCommand({
  command,
  normalized,
  conversationId,
  inboundMessageId,
  settings,
  base,
  recorded,
}) {
  const state = parseJsonObject(recorded.conversation.booking_state);

  if (command === "cancel") {
    await saveBookingState(conversationId, {});
    await query(
      `insert into public.whatsapp_message_logs(conversation_id,message_id,event_type,status,details)
       values($1,$2,'booking_flow_cancelled','info',$3)`,
      [conversationId, inboundMessageId, JSON.stringify({ action: "cancel_transient_flow" })],
    ).catch(() => null);
    const responseText = "Tudo bem. O fluxo atual foi cancelado. Quando quiser recomeçar, envie menu.";
    await performSendTextAndRecord({ normalized, conversationId, text: responseText, reason: "booking_global_cancel" });
    await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
    return { ok: true, replied: true, reason: "booking_global_cancel", conversationId };
  }

  if (command === "handoff") {
    await saveBookingState(conversationId, {});
    const responseText = settings.humanHandoffMessage || "Certo, chamei a equipe para continuar seu atendimento por aqui.";
    await requestHumanAttention({
      conversationId,
      messageId: inboundMessageId,
      reason: "booking_global_handoff",
      responseText,
      pauseAi: true,
    });
    await performSendTextAndRecord({ normalized, conversationId, text: responseText, reason: "booking_global_handoff" });
    await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
    return { ok: true, replied: true, reason: "booking_global_handoff", conversationId };
  }

  if (command === "main_menu" || command === "change_service") {
    return openInitialServiceCatalog({ normalized, conversationId, base, recorded });
  }

  if (command === "back") {
    if (["awaiting_inventory", "awaiting_service_details"].includes(String(state.status || ""))) {
      return openServicesForCurrentCategory({ normalized, conversationId, base, recorded, state });
    }
    if (state.status === "awaiting_date") {
      const inventoryResult = await reopenInventoryStep({ normalized, conversationId, base, state });
      if (inventoryResult) return inventoryResult;
      state.status = "awaiting_service_details";
      state.serviceDetailsAccepted = false;
      await saveBookingState(conversationId, state);
      const responseText = buildServiceDetailsResponse(state);
      await performSendTextAndRecord({ normalized, conversationId, text: responseText, reason: "booking_back_to_service_details" });
      await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
      return { ok: true, replied: true, reason: "booking_back_to_service_details", conversationId };
    }
    if (["awaiting_contact", "awaiting_confirmation"].includes(String(state.status || ""))) {
      const slotResult = await reopenSlotStep({ normalized, conversationId, state });
      if (slotResult) return slotResult;
      return reopenDateStep({ normalized, conversationId, state });
    }
    if (state.status === "awaiting_slot") {
      return reopenDateStep({ normalized, conversationId, state });
    }
    if (state.status === "awaiting_service") {
      return openInitialServiceCatalog({ normalized, conversationId, base, recorded });
    }
    if (state.serviceId) {
      return openServicesForCurrentCategory({ normalized, conversationId, base, recorded, state });
    }
    return openInitialServiceCatalog({ normalized, conversationId, base, recorded });
  }

  return null;
}

function bookingServiceDetails(service = {}) {
  const isFree = isFreeService(service);
  return {
    serviceDescription: clean(service.short_description || service.description),
    serviceDetailedDescription: clean(service.detailed_description),
    serviceDurationMinutes: Number(service.estimated_duration_minutes || service.duration_minutes || 0),
    serviceDepositAmount: isFree ? 0 : Number(service.deposit_value ?? service.deposit_amount ?? 0),
    serviceDepositType: isFree ? "amount" : clean(service.deposit_type || "amount"),
    serviceRequiresAssessment: service.requires_assessment === true,
    serviceRequiresDeposit: isFree ? false : (service.requires_deposit === true),
    serviceRecommendedMessage: clean(service.recommended_message),
    serviceIsFree: isFree,
  };
}

function serviceDetailsState(choice = {}) {
  const isFree = choice.serviceIsFree === true;
  return {
    serviceDescription: choice.serviceDescription || "",
    serviceDetailedDescription: choice.serviceDetailedDescription || "",
    serviceDurationMinutes: Number(choice.serviceDurationMinutes || 0),
    serviceDepositAmount: isFree ? 0 : Number(choice.serviceDepositAmount || 0),
    serviceDepositType: choice.serviceDepositType || "amount",
    serviceRequiresAssessment: choice.serviceRequiresAssessment === true,
    serviceRequiresDeposit: isFree ? false : (choice.serviceRequiresDeposit === true),
    serviceRecommendedMessage: choice.serviceRecommendedMessage || "",
    serviceIsFree: isFree,
  };
}

function optionLines(options, formatter) {
  return options.map((item) => `${item.id}) ${formatter(item)}`).join("\n");
}

function slotPageLines(options = [], start = 0) {
  const visible = options.slice(start, start + SLOT_PAGE_SIZE);
  const lines = [optionLines(visible, formatSlot)];
  if (options.length > start + SLOT_PAGE_SIZE) {
    lines.push(`Digite "mais horários" para ver as próximas opções.`);
  }
  return lines.filter(Boolean).join("\n");
}

export function selectDisplayedBookingSlot(state = {}, text = "") {
  const choice = numericChoice(text);
  if (!choice || !Array.isArray(state.slotOptions)) return null;
  const pageStart = Number(state.slotPageStart || 0);
  return state.slotOptions
    .slice(pageStart, pageStart + SLOT_PAGE_SIZE)
    .find((item) => Number(item.id) === choice) || null;
}

export function buildBookingResumePrompt(state = {}) {
  const status = String(state.status || "");
  const prefix = "Agora podemos continuar seu agendamento de onde paramos:";

  if (status === "awaiting_category" && Array.isArray(state.categoryOptions)) {
    return [
      prefix,
      "Escolha a categoria respondendo com o número:",
      optionLines(state.categoryOptions, (item) => item.categoryName),
    ].filter(Boolean).join("\n\n");
  }

  if (status === "awaiting_method" && Array.isArray(state.methodOptions)) {
    return [
      prefix,
      "Escolha o método respondendo com o número:",
      optionLines(state.methodOptions, (item) => item.methodName),
    ].filter(Boolean).join("\n\n");
  }

  if (status === "awaiting_service" && Array.isArray(state.serviceOptions)) {
    return [
      prefix,
      "Escolha o serviço respondendo com o número:",
      optionLines(state.serviceOptions, (item) => item.serviceName),
    ].filter(Boolean).join("\n\n");
  }

  if (status === "awaiting_inventory" && Array.isArray(state.inventoryOptions)) {
    return [
      prefix,
      "Escolha o item de estoque respondendo com o número:",
      optionLines(state.inventoryOptions, (item) => item.inventoryValue
        ? `${item.inventoryName} - ${formatBookingCurrency(item.inventoryValue)}`
        : item.inventoryName),
    ].filter(Boolean).join("\n\n");
  }

  if (status === "awaiting_service_details") {
    return [
      prefix,
      buildServiceDetailsResponse(state),
      "Responda 1 para verificar horários ou 2 para escolher outro serviço.",
    ].filter(Boolean).join("\n\n");
  }

  if (status === "awaiting_date") {
    const options = Array.isArray(state.dateOptions) && state.dateOptions.length
      ? state.dateOptions
      : dateOptionsFrom();
    return [
      prefix,
      "Escolha a data respondendo com o número:",
      optionLines(options, (item) => item.label),
      "Se preferir outro dia, envie no formato 10/07.",
    ].filter(Boolean).join("\n\n");
  }

  if (status === "awaiting_slot" && Array.isArray(state.slotOptions) && state.slotOptions.length) {
    return [
      prefix,
      state.date ? `Escolha o horário para ${formatDateLabel(state.date)}:` : "Escolha o horário:",
      slotPageLines(state.slotOptions, Number(state.slotPageStart || 0)),
    ].filter(Boolean).join("\n\n");
  }

  if (status === "awaiting_contact") {
    const missingContact = missingBookingContactFields(state);
    if (missingContact.length) {
      return [prefix, bookingContactPrompt(state, missingContact)].join("\n\n");
    }
  }

  if (status === "awaiting_confirmation") {
    return [
      prefix,
      "📝 *Resumo do seu Agendamento:*",
      buildBookingSummary(state),
      "👍 *Confirmar agendamento?*",
      "1️⃣ Confirmar",
      "2️⃣ Alterar",
    ].filter(Boolean).join("\n\n");
  }

  if (state.serviceId && !state.date) {
    return `${prefix}\n\nQual data você prefere?`;
  }

  return `${prefix}\n\nResponda à última pergunta do atendimento quando estiver pronta.`;
}

function extractClientName(text) {
  const value = clean(text);
  const match = value.match(/(?:meu nome (?:é|e)|sou|me chamo|pode colocar como)\s+([A-Za-zÀ-ÿ' ]{2,80})/i);
  if (!match) return "";
  return clean(match[1]).replace(/[.!,?].*$/, "").slice(0, 80);
}

function extractBookingClientName(text, { allowPlain = false } = {}) {
  const value = clean(text);
  const match = value.match(/(?:nome\s*:|meu nome (?:é|e)|sou|me chamo|pode colocar como)\s+([^0-9@,;|]{2,80})/i);
  if (match) return clean(match[1]).replace(/[.!,?].*$/, "").slice(0, 80);
  if (!allowPlain) return "";
  const withoutContacts = value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, " ")
    .replace(/(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?\d{4,5}[-\s]?\d{4}/g, " ")
    .replace(/(?:cpf|documento)\s*:?\s*[0-9.\-]{11,14}/gi, " ")
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-\d{2}\b/g, " ")
    .replace(/(?:nascimento|data de nascimento|nasci|nasc\.?|anivers[aá]rio)\s*:?\s*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/gi, " ")
    .replace(/\b\d{1,2}[/-]\d{1,2}[/-](?:19|20)\d{2}\b/g, " ")
    .replace(/\b(nome|email|e-mail|telefone|celular|whats|whatsapp)\b\s*:?/gi, " ")
    .replace(/[|,;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!/^[^\d@,;|]{2,80}$/.test(withoutContacts)) return "";
  const parts = withoutContacts.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return "";
  return withoutContacts.slice(0, 80);
}

function extractClientEmail(text) {
  const match = clean(text).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase().slice(0, 160) : "";
}

function isFakeWhatsappEmail(value) {
  const email = clean(value).toLowerCase();
  return /^whatsapp\+\d+@/.test(email) || email.endsWith("@carolsol.local");
}

function isValidClientEmail(value) {
  const email = clean(value).toLowerCase();
  return /^\S+@\S+\.\S+$/.test(email) && !isFakeWhatsappEmail(email);
}

function normalizeClientCpf(value) {
  const digits = clean(value).replace(/\D/g, "");
  return digits.length === 11 ? digits : "";
}

function extractClientCpf(text) {
  const value = clean(text);
  const labeled = value.match(/(?:cpf|documento)\s*:?\s*([0-9.\-]{11,14})/i);
  if (labeled) return normalizeClientCpf(labeled[1]);
  const formatted = value.match(/\b\d{3}\.?\d{3}\.?\d{3}-\d{2}\b/);
  if (formatted) return normalizeClientCpf(formatted[0]);
  const digits = value.replace(/\D/g, "");
  if (digits.length === 11 && !/^\d{2}9\d{8}$/.test(digits)) return digits;
  return "";
}

function normalizeBirthDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return [
      String(value.getUTCFullYear()).padStart(4, "0"),
      String(value.getUTCMonth() + 1).padStart(2, "0"),
      String(value.getUTCDate()).padStart(2, "0"),
    ].join("-");
  }
  const raw = clean(value);
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const br = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
  if (!iso && !br) return "";
  const day = Number(iso ? iso[3] : br[1]);
  const month = Number(iso ? iso[2] : br[2]);
  let year = Number(iso ? iso[1] : br[3]);
  if (year < 100) year += year > 30 ? 1900 : 2000;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return "";
  const currentYear = Number(localDateParts().slice(0, 4));
  if (year < 1900 || year > currentYear) return "";
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

function extractClientBirthDate(text) {
  const value = clean(text);
  const labeled = value.match(/(?:nascimento|data de nascimento|nasci|nasc\.?|anivers[aá]rio)\s*:?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i);
  if (labeled) return normalizeBirthDate(labeled[1]);
  const generic = value.match(/\b(\d{1,2}[/-]\d{1,2}[/-](?:19|20)\d{2})\b/);
  return generic ? normalizeBirthDate(generic[1]) : "";
}

function generateTemporaryPassword() {
  return `Carol-${randomBytes(4).toString("hex").toUpperCase()}`;
}

function normalizeBookingPhone(value, fallback = "") {
  const digits = clean(value).replace(/\D/g, "");
  const candidate = digits || clean(fallback).replace(/\D/g, "");
  if (!candidate) return "";
  if (/^55\d{10,11}$/.test(candidate)) return candidate;
  if (/^\d{10,11}$/.test(candidate)) return `55${candidate}`;
  return candidate.slice(0, 16);
}

function extractClientPhone(text) {
  const value = clean(text);
  const labeled = value.match(
    /(?:telefone|celular|whats(?:app)?|fone|contato)\s*:?\s*((?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?\d{4,5}[-\s]?\d{4})/i,
  );
  if (labeled) return normalizeBookingPhone(labeled[1]);
  const match = value.match(/(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?\d{4,5}[-\s]?\d{4}/);
  if (!match) return "";
  const digits = match[0].replace(/\D/g, "");
  const allDigits = value.replace(/\D/g, "");
  if (extractClientCpf(value) && digits === allDigits) return "";
  if (/^\d{11}$/.test(digits) && !/^\d{2}9\d{8}$/.test(digits)) return "";
  if (/^55\d{11}$/.test(digits) && !/^55\d{2}9\d{8}$/.test(digits)) return "";
  return normalizeBookingPhone(match[0]);
}

function formatBookingPhone(value) {
  const digits = normalizeBookingPhone(value);
  const local = digits.startsWith("55") ? digits.slice(2) : digits;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return digits || clean(value);
}

function applyBookingContactFields(state, text, { allowPlainName = false } = {}) {
  const email = extractClientEmail(text);
  const cpf = extractClientCpf(text);
  const phone = extractClientPhone(text);
  const birthDate = extractClientBirthDate(text);
  const name = extractBookingClientName(text, { allowPlain: allowPlainName || Boolean(email || phone || cpf || birthDate) });
  if (name) state.clientName = name;
  if (email) state.clientEmail = email;
  if (cpf) state.clientCpf = cpf;
  if (phone) state.clientPhone = phone;
  if (birthDate) state.clientBirthDate = birthDate;
  return state;
}

export function hydrateBookingContactFromClient(state, client) {
  if (!client) return state;
  if (!state.clientName && client.full_name && !/^Cliente WhatsApp/i.test(client.full_name)) {
    state.clientName = client.full_name;
  }
  if (!state.clientCpf && client.cpf) state.clientCpf = client.cpf;
  if (!state.clientEmail && client.email && !isFakeWhatsappEmail(client.email)) {
    state.clientEmail = client.email;
  }
  if (!state.clientBirthDate && client.birth_date) {
    state.clientBirthDate = normalizeBirthDate(client.birth_date);
  }
  return state;
}

function formatBookingCurrency(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return "valor sob consulta";
  return amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function isFreeService(service = {}) {
  if (!service) return false;
  const isFreeField = service.is_free === true || service.isFree === true || truthy(service.is_free) || truthy(service.isFree);
  if (isFreeField) return true;
  
  const basePrice = service.base_price !== undefined && service.base_price !== null ? Number(service.base_price) : null;
  const initialPrice = service.initial_price !== undefined && service.initial_price !== null ? Number(service.initial_price) : null;
  if (basePrice === 0) return true;
  if (initialPrice === 0) return true;
  return false;
}

function servicePriceText(service = {}, value = serviceValue(service), { serviceName = "" } = {}) {
  const label = serviceName || service.commercial_name || service.name || "servico";
  if (isFreeService(service)) return `${label} nao tem custo.`;
  const amount = Number(value || 0);
  return amount > 0
    ? `${label} custa a partir de ${formatBookingCurrency(amount)}.`
    : `O valor de ${label} esta sob consulta.`;
}

function formatServiceValue(service = {}, value = serviceValue(service)) {
  if (isFreeService(service)) return "sem custo";
  return formatBookingCurrency(value);
}

function formatServiceDeposit(state = {}) {
  if (state.serviceIsFree) return "";
  const amount = Number(state.serviceDepositAmount || 0);
  if (!Number.isFinite(amount) || amount <= 0) return "Sinal: nao exige sinal";
  if (state.serviceDepositType === "percentage") return `Sinal: ${amount}%`;
  return `Sinal: ${formatBookingCurrency(amount)}`;
}

function serviceValue(service = {}) {
  if (isFreeService(service)) return 0;
  const amount = Number(service.initial_price || service.base_price || 0);
  return Number.isFinite(amount) ? amount : 0;
}

function buildServicePresentation(state = {}) {
  const description = state.serviceDetailedDescription || state.serviceDescription || "";
  const duration = Number(state.serviceDurationMinutes || 0);
  const isWaitingInventoryPrice = state.offerInventoryItems === true && !state.inventoryId;
  const valueLabel = isWaitingInventoryPrice
    ? "conforme item escolhido no estoque"
    : formatServiceValue({ is_free: state.serviceIsFree }, state.serviceValue);
  if (isWaitingInventoryPrice) state.serviceRequiresDeposit = false;
  const assessmentLabel = state.serviceRequiresAssessment ? "\n⚠️ Observação: Requer avaliação prévia." : "";
  const recomLabel = state.serviceRecommendedMessage ? `\n💡 Dica: ${state.serviceRecommendedMessage}` : "";
  const depositText = state.serviceRequiresDeposit ? `\n💳 Sinal: R$ ${Number(state.serviceDepositAmount || 0).toFixed(2)}` : "";

  return [
    state.serviceNote ? `${state.serviceNote}\n` : "",
    `✨ *Excelente escolha!* Você selecionou *${state.serviceName}*.`,
    description ? `📝 ${description}` : "",
    duration > 0 ? `⏱️ *Duracao: ${duration} minutos*` : "",
    `*💰 Valor: ${valueLabel}*${depositText}${assessmentLabel}${recomLabel}`,
  ].filter(Boolean).join("\n");
}

function buildServiceDetailsResponse(state = {}) {
  return [
    buildServicePresentation(state),
    "🗓️ Posso verificar os horários disponíveis para você?\n\n1) Sim\n2) Escolher outro servico",
  ].join("\n");
}

function isServiceDetailsAccepted(text) {
  const normalized = normalizeText(text);
  const hasDateOrTime = parseBookingDateFromText(text) || parseFlexibleBookingTimeFromText(text).time || parseFlexibleBookingTimeFromText(text).period;
  return (
    isAffirmativeBookingConfirmation(text) ||
    numericChoice(text) === 1 ||
    Boolean(hasDateOrTime) ||
    includesAny(normalized, ["verificar horario", "verificar horarios", "pode verificar", "seguir", "continuar"])
  );
}

function wantsAnotherServiceAfterDetails(text) {
  const normalized = normalizeText(text);
  return numericChoice(text) === 2 || includesAny(normalized, [
    "outro servico",
    "outro serviço",
    "escolher outro",
    "alterar servico",
    "alterar serviço",
    "mudar servico",
    "mudar serviço",
    "trocar servico",
    "trocar serviço",
  ]);
}

function whatsappBookingPaymentInfo(service = {}, state = {}) {
  if (isFreeService(service) || state.serviceIsFree === true) {
    return {
      amount: 0,
      originalAmount: 0,
      billingReason: "Servico sem custo",
      notes: `Agendamento sem custo para ${service.name || "servico"}.`,
    };
  }
  const serviceTotal = Number(state.serviceValue || service.base_price || 0);
  const deposit = Number(service.deposit_amount || 0);
  const safeTotal = Number.isFinite(serviceTotal) ? Math.max(0, serviceTotal) : 0;
  const safeDeposit = Number.isFinite(deposit) ? Math.max(0, deposit) : 0;
  if (safeDeposit > 0) {
    return {
      amount: safeTotal > 0 ? Math.min(safeDeposit, safeTotal) : safeDeposit,
      originalAmount: safeDeposit,
      billingReason: "Sinal do agendamento",
      notes: `Fatura de sinal gerada automaticamente pelo WhatsApp para ${service.name || "servico"}.`,
    };
  }
  return {
    amount: safeTotal,
    originalAmount: safeTotal,
    billingReason: "Servico agendado",
    notes: `Fatura do servico gerada automaticamente pelo WhatsApp para ${service.name || "servico"}.`,
  };
}

function bookingCreatedPaymentLines(appointment = {}) {
  const amount = Number(appointment.paymentAmount || 0);
  const signalLine = amount > 0 ? `💳 *Sinal:* ${formatBookingCurrency(amount)}` : "";
  if (appointment.paymentUrl) {
    return [
      `${signalLine}\n\nlink para pagamento enviado abaixo:\n${appointment.paymentUrl}`,
    ];
  }
  if (appointment.paymentId) {
    return [
      amount > 0
        ? `💳 *Sinal:* ${formatBookingCurrency(amount)} para pagamento no portal.`
        : "💳 Fatura gerada para pagamento no portal.",
    ];
  }
  return ["💵 *Pagamento:* No local do atendimento."];
}

function missingBookingContactFields(state) {
  const missing = [];
  if (!clean(state.clientName)) missing.push("nome completo");
  if (!isValidClientEmail(state.clientEmail)) missing.push("e-mail real");
  if (!normalizeClientCpf(state.clientCpf)) missing.push("CPF");
  if (!normalizeBirthDate(state.clientBirthDate)) missing.push("data de nascimento");
  if (!normalizeBookingPhone(state.clientPhone)) missing.push("telefone");
  return missing;
}

function bookingContactPrompt(state, missingContact = []) {
  const next = missingContact[0];
  const nextQuestion =
    next === "nome completo"
      ? "Qual seu nome completo? 😊"
      : next === "e-mail real"
        ? "Qual seu e-mail real? 📧"
        : next === "CPF"
          ? "Qual seu CPF? 📄"
          : next === "data de nascimento"
            ? "Qual sua data de nascimento? Pode enviar no formato 10/02/1990 📅"
            : "Qual telefone deseja usar para contato? 📱";

  const isFirstField = missingContact.length === 5 || (missingContact.length === 4 && state.clientPhone);
  if (isFirstField) {
    const valText = formatServiceValue({ is_free: state.serviceIsFree }, state.serviceValue);
    const depositText = state.serviceRequiresDeposit ? ` com sinal de R$ ${Number(state.serviceDepositAmount || 0).toFixed(2)}` : "";
    const phoneText = normalizeBookingPhone(state.clientPhone)
      ? `Vou usar este WhatsApp como telefone de contato: ${formatBookingPhone(state.clientPhone)}.`
      : "";
    return [
      `✨ *Excelente! Horário reservado.*`,
      `Para finalizar seu pré-agendamento de *${state.serviceName}* (${valText}${depositText}), preciso apenas confirmar alguns dados rápidos.`,
      phoneText,
      nextQuestion
    ].filter(Boolean).join("\n\n");
  }

  return `✨ *Obrigado!* Agora, por favor, ${nextQuestion.toLowerCase()}`;
}

async function saveBookingState(conversationId, state) {
  await query(
    `update public.whatsapp_conversations
        set booking_state=$2, updated_at=now()
      where id=$1`,
    [conversationId, serializeBookingState(state)],
  );
}

async function ensureClientForBooking(client, {
  phoneNumber,
  clientName,
  clientEmail = "",
  clientPhone = "",
  clientCpf = "",
  clientBirthDate = "",
}) {
  const contactPhone = normalizeBookingPhone(clientPhone, phoneNumber);
  const email = clean(clientEmail).toLowerCase();
  const cpf = normalizeClientCpf(clientCpf);
  const birthDate = normalizeBirthDate(clientBirthDate);
  if (!isValidClientEmail(email))
    throw new Error("Informe um e-mail real para criar o acesso da cliente.");
  if (!cpf) throw new Error("Informe um CPF válido para o pré-cadastro.");
  if (!birthDate) throw new Error("Informe uma data de nascimento válida.");
  await client.query("alter table public.profiles add column if not exists cpf text").catch(() => null);
  const found = await findClientByPhone(client, contactPhone || phoneNumber);
  if (found?.id) {
    const profile = await client.query(
      `select c.id as client_id,c.cpf,p.id as profile_id,p.full_name,p.birth_date,u.email,u.encrypted_password
         from public.clients c
         join public.profiles p on p.id=c.profile_id
         join auth.users u on u.id=p.id
        where c.id=$1
        limit 1`,
      [found.id],
    );
    if (profile.rows[0]?.profile_id) {
      const target = profile.rows[0];
      const emailCheck = await client.query(
        "select id from auth.users where lower(email)=lower($1) and id<>$2 limit 1",
        [email, target.profile_id],
      );
      if (emailCheck.rowCount)
        throw new Error("Este e-mail já está cadastrado para outra cliente.");
      const needsTemporaryPassword =
        !target.encrypted_password || isFakeWhatsappEmail(target.email);
      const temporaryPassword = needsTemporaryPassword
        ? generateTemporaryPassword()
        : "";
      const passwordHash = temporaryPassword
        ? await bcrypt.hash(temporaryPassword, 12)
        : null;
      await client.query(
        `update auth.users
            set email=$1,
                phone=coalesce(phone,$2),
                encrypted_password=coalesce($3, encrypted_password),
                email_confirmed_at=coalesce(email_confirmed_at,now()),
                raw_user_meta_data=coalesce(raw_user_meta_data,'{}'::jsonb) || $4::jsonb,
                updated_at=now()
          where id=$5`,
        [
          email,
          contactPhone || phoneNumber,
          passwordHash,
          JSON.stringify({
            name: clean(clientName) || target.full_name || "",
            source: "whatsapp_ai",
            force_password_change: Boolean(temporaryPassword),
          }),
          target.profile_id,
        ],
      );
      await client.query(
        `update public.profiles
            set full_name=case
                  when full_name ilike 'Cliente WhatsApp %' then $2
                  else full_name
                end,
                phone=coalesce(phone,$3),
                birth_date=coalesce(birth_date,$4::date),
                cpf=coalesce(cpf,$5),
                notification_preferences=coalesce(notification_preferences,'{}'::jsonb) || '{"email":true,"whatsapp":true}'::jsonb,
                updated_at=now()
          where id=$1`,
        [
          target.profile_id,
          clean(clientName) || target.full_name || "",
          contactPhone || phoneNumber,
          birthDate,
          cpf,
        ],
      );
      await client.query(
        `update public.clients
            set cpf=coalesce(cpf,$2),
                preferences=coalesce(preferences,'{}'::jsonb) || $3::jsonb
          where id=$1`,
        [
          target.client_id,
          cpf,
          JSON.stringify({
            whatsapp_ai_contact: {
              name: clean(clientName) || target.full_name || "",
              email,
              phone: contactPhone || phoneNumber,
              cpf,
              birthDate,
            },
          }),
        ],
      ).catch(() => null);
      await client.query(
        `insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_data)
         values($1,'update','client',$2,$3)`,
        [
          target.profile_id,
          target.client_id,
          JSON.stringify({
            source: "whatsapp_ai",
            emailUpdated: target.email !== email,
            temporaryPasswordGenerated: Boolean(temporaryPassword),
          }),
        ],
      ).catch(() => null);
      return {
        ...target,
        access: temporaryPassword
          ? {
              email,
              temporaryPassword,
              fullName: clean(clientName) || target.full_name || "",
            }
          : null,
      };
    }
    return profile.rows[0] || { client_id: found.id, profile_id: null, full_name: found.full_name, access: null };
  }

  const safeName =
    clean(clientName).length >= 2
      ? clean(clientName).slice(0, 120)
      : `Cliente WhatsApp ${String(phoneNumber || "").slice(-4)}`;
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(temporaryPassword, 12);
  const existingEmail = await client.query(
    "select id from auth.users where lower(email)=lower($1) limit 1",
    [email],
  );
  if (existingEmail.rowCount)
    throw new Error("Este e-mail já está cadastrado para outra cliente.");
  const user = await client.query(
    `insert into auth.users(email, phone, encrypted_password, email_confirmed_at, raw_user_meta_data)
     values($1,$2,$3,now(),$4)
     on conflict(email) do update
        set phone=coalesce(auth.users.phone, excluded.phone),
            raw_user_meta_data=coalesce(nullif(auth.users.raw_user_meta_data,'{}'::jsonb), excluded.raw_user_meta_data),
            updated_at=now()
     returning id`,
    [
      email,
      contactPhone || phoneNumber,
      passwordHash,
      JSON.stringify({
        name: safeName,
        source: "whatsapp_ai",
        force_password_change: true,
      }),
    ],
  );
  const profile = await client.query(
    `insert into public.profiles(id, role, full_name, phone, birth_date, cpf, notification_preferences)
     values($1,'client',$2,$3,$4,$5,'{"email":true,"whatsapp":true,"push":false}')
     on conflict(id) do update
        set full_name=case
              when public.profiles.full_name ilike 'Cliente WhatsApp %' then excluded.full_name
              else public.profiles.full_name
            end,
            phone=coalesce(public.profiles.phone, excluded.phone),
            birth_date=coalesce(public.profiles.birth_date, excluded.birth_date),
            cpf=coalesce(public.profiles.cpf, excluded.cpf),
            notification_preferences=coalesce(public.profiles.notification_preferences,'{}'::jsonb) || '{"email":true,"whatsapp":true}'::jsonb,
            updated_at=now()
     returning id as profile_id, full_name`,
    [user.rows[0].id, safeName, contactPhone || phoneNumber, birthDate, cpf],
  );
  const insertedClient = await client.query(
    `insert into public.clients(profile_id, source, cpf, preferences)
     values($1,'WhatsApp IA',$2,$3)
     on conflict(profile_id) do update set
       source=coalesce(public.clients.source, excluded.source),
       cpf=coalesce(public.clients.cpf, excluded.cpf),
       preferences=coalesce(public.clients.preferences,'{}'::jsonb) || excluded.preferences
     returning id as client_id`,
    [
      profile.rows[0].profile_id,
      cpf,
      JSON.stringify({
        whatsapp_ai_contact: {
          name: safeName,
          email,
          phone: contactPhone || phoneNumber,
          cpf,
          birthDate,
        },
      }),
    ],
  );
  await client.query(
    `insert into public.consent_logs(profile_id, consent_type, granted, policy_version, source)
     values($1,'whatsapp_contact',true,'1.0','whatsapp_ai')
     on conflict do nothing`,
    [profile.rows[0].profile_id],
  ).catch(() => null);
  await client.query(
    `insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_data)
     values($1,'create','client',$2,$3)`,
    [
      profile.rows[0].profile_id,
      insertedClient.rows[0].client_id,
      JSON.stringify({
        source: "whatsapp_ai",
        loginCreated: true,
        temporaryPasswordGenerated: true,
      }),
    ],
  ).catch(() => null);
  return {
    client_id: insertedClient.rows[0].client_id,
    profile_id: profile.rows[0].profile_id,
    full_name: profile.rows[0].full_name,
    access: {
      email,
      temporaryPassword,
      fullName: safeName,
    },
  };
}

async function availableBookingSlots(client, { serviceId, serviceVariantId = "", date, preferredTime = "", period = "" }) {
  const service = await client.query(
    "select id,name,duration_minutes,base_price,deposit_amount,active,coalesce(is_free,false) as is_free from public.services where id=$1 and active limit 1",
    [serviceId],
  );
  if (!service.rows[0]) return { service: null, slots: [] };
  let durationMinutes = Number(service.rows[0].duration_minutes || 60);
  if (serviceVariantId) {
    const variant = await client.query(
      `select duration_minutes from public.service_variants
       where id=$1 and service_id=$2 and active and allow_whatsapp_booking limit 1`,
      [serviceVariantId, serviceId],
    );
    if (!variant.rows[0]) return { service: null, slots: [] };
    durationMinutes = Number(variant.rows[0].duration_minutes || durationMinutes);
  }

  const professionals = await client.query(
    `select p.id,pp.full_name
       from public.professionals p
       join public.profiles pp on pp.id=p.profile_id
       join public.professional_services ps on ps.professional_id=p.id and ps.service_id=$1
      where p.active
      order by pp.full_name`,
    [serviceId],
  );
  const weekday = weekdayForDate(date);
  const slots = [];
  for (const professional of professionals.rows) {
    const [availability, conflicts] = await Promise.all([
      client.query(
        `select starts_at,ends_at,active
           from public.professional_availability
          where professional_id=$1 and weekday=$2 and active
          order by starts_at`,
        [professional.id, weekday],
      ),
      client.query(
        `select starts_at,ends_at
           from public.appointments
          where professional_id=$1 and status not in ('cancelled','no_show')
            and starts_at < (($2::date + interval '1 day')::timestamp at time zone 'America/Sao_Paulo')
            and ends_at > ($2::date::timestamp at time zone 'America/Sao_Paulo')
         union all
         select starts_at,ends_at
           from public.blocked_schedule
          where professional_id=$1
            and starts_at < (($2::date + interval '1 day')::timestamp at time zone 'America/Sao_Paulo')
            and ends_at > ($2::date::timestamp at time zone 'America/Sao_Paulo')`,
        [professional.id, date],
      ),
    ]);
    const times = scheduleSlots(availability.rows, durationMinutes);
    const available = slotsWithConflicts(date, times, durationMinutes, conflicts.rows)
      .filter((slot) => slot.available)
      .filter((slot) => !preferredTime || slot.time === preferredTime)
      .filter((slot) => periodMatches(slot.time, period));
    for (const slot of available) {
      slots.push({
        id: slots.length + 1,
        date,
        time: slot.time,
        serviceId,
        serviceName: service.rows[0].name,
        professionalId: professional.id,
        professionalName: professional.full_name,
        durationMinutes,
      });
    }
  }
  return { service: service.rows[0], slots };
}

async function createWhatsappAppointment({ conversationId, phoneNumber, state }) {
  const automation = await loadAppointmentAutomationContext();
  if (!automation.settings.bookingEnabled) {
    throw new Error("Novos agendamentos estão temporariamente desativados. Fale com uma atendente.");
  }
  const result = await transaction(async (client) => {
    const lockedConversation = await client.query(
      "select id,appointment_id from public.whatsapp_conversations where id=$1 for update",
      [conversationId],
    );
    if (!lockedConversation.rows[0]) throw new Error("Conversa não encontrada para agendamento.");
    if (
      lockedConversation.rows[0].appointment_id &&
      lockedConversation.rows[0].appointment_id !== (state.previousAppointmentId || null)
    ) {
      const linkedAppointment = await client.query(
        `select id, booking_code
           from public.appointments
          where id=$1
            and status not in ('cancelled','rejected')
          limit 1`,
        [lockedConversation.rows[0].appointment_id],
      );
      if (linkedAppointment.rows[0]) {
        return {
          id: linkedAppointment.rows[0].id,
          bookingCode: linkedAppointment.rows[0].booking_code || state.bookingCode || "",
          alreadyCreated: true,
          persisted: true,
        };
      }

      // A conversa podia conservar um appointment_id de uma tentativa antiga
      // cujo registro nunca foi criado (ou já não existe). Não trate esse vínculo
      // órfão como sucesso: limpe-o sob o mesmo lock e prossiga com o INSERT real.
      await client.query(
        `update public.whatsapp_conversations
            set appointment_id=null, payment_id=null, updated_at=now()
          where id=$1`,
        [conversationId],
      );
    }

    const bookingClient = await ensureClientForBooking(client, {
      phoneNumber,
      clientName: state.clientName,
      clientEmail: state.clientEmail,
      clientPhone: state.clientPhone,
      clientCpf: state.clientCpf,
      clientBirthDate: state.clientBirthDate,
    });
    if (!bookingClient?.client_id) throw new Error("Cliente não encontrado para o agendamento.");

    const service = await client.query(
      "select * from public.services where id=$1 and active limit 1",
      [state.serviceId],
    );
    if (!service.rows[0]) throw new Error("Serviço indisponível para agendamento.");
    const variant = state.serviceVariantId
      ? await client.query(
          `select * from public.service_variants
           where id=$1 and service_id=$2 and active and allow_whatsapp_booking limit 1`,
          [state.serviceVariantId, state.serviceId],
        )
      : { rows: [] };
    if (state.serviceVariantId && !variant.rows[0])
      throw new Error("Variação indisponível para agendamento.");
    const addonIds = Array.isArray(state.addonIds) ? [...new Set(state.addonIds.map(String))] : [];
    const addons = addonIds.length && variant.rows[0]
      ? await client.query(
          `select a.* from public.service_addons a
           join public.service_variant_addons va on va.addon_id=a.id
           where va.service_variant_id=$1 and a.id=any($2::uuid[]) and a.active and a.allow_whatsapp_booking`,
          [variant.rows[0].id, addonIds],
        )
      : { rows: [] };
    if (addons.rows.length !== addonIds.length) throw new Error("Adicional indisponível para esta opção.");
    const professional = await client.query(
      `select p.id,p.profile_id,pp.full_name,pp.phone,u.email
         from public.professionals p
         join public.profiles pp on pp.id=p.profile_id
         left join auth.users u on u.id=pp.id
         join public.professional_services ps on ps.professional_id=p.id and ps.service_id=$2
        where p.id=$1 and p.active
        limit 1`,
      [state.professionalId, state.serviceId],
    );
    if (!professional.rows[0]) throw new Error("Profissional indisponível para este serviço.");

    await client.query("select pg_advisory_xact_lock(hashtext($1))", [professional.rows[0].id]);

    const startsAt = new Date(`${state.date}T${state.time}:00-03:00`);
    const addonDuration = addons.rows.reduce((sum, addon) => sum + Number(addon.duration_minutes || 0), 0);
    const durationMinutes = Number(variant.rows[0]?.duration_minutes || service.rows[0].duration_minutes || 60) + addonDuration;
    const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
    const { period, error: periodError } = schedulePeriod(startsAt, endsAt);
    if (periodError) throw new Error(periodError);
    const schedule = await client.query(
      `select starts_at,ends_at,active
         from public.professional_availability
        where professional_id=$1 and weekday=$2 and active`,
      [professional.rows[0].id, period.weekday],
    );
    if (!periodFitsSchedule(period, schedule.rows)) {
      throw new Error("O horário escolhido está fora da jornada da profissional.");
    }
    const conflict = await client.query(
      `select 1 from (
        select 1 from public.appointments
         where professional_id=$1
           and status not in ('cancelled','no_show')
           and tstzrange(starts_at,ends_at,'[)') && tstzrange($2,$3,'[)')
        union all
        select 1 from public.blocked_schedule
         where professional_id=$1
           and tstzrange(starts_at,ends_at,'[)') && tstzrange($2,$3,'[)')
      ) conflicts limit 1`,
      [professional.rows[0].id, startsAt.toISOString(), endsAt.toISOString()],
    );
    if (conflict.rowCount) throw new Error("Este horário acabou de ficar indisponível.");

    const location = await client.query(
      "select id,name from public.salon_locations where active order by name limit 1",
    );
    const appointmentId = (await client.query("select uuid_generate_v4() as id")).rows[0].id;
    const bookingCode = `CS-${String(appointmentId).replace(/-/g, "").slice(-12).toUpperCase()}`;
    const selectedValue = Number(variant.rows[0]?.price || state.serviceValue || service.rows[0].base_price || 0) +
      addons.rows.reduce((sum, addon) => sum + Number(addon.price || 0), 0);
    const variantDeposit = variant.rows[0] ? variantDepositAmount(variant.rows[0], selectedValue) : null;
    const paymentInfo = variant.rows[0]
      ? { amount: variantDeposit, originalAmount: variantDeposit, notes: "Sinal da variação selecionada", billingReason: "appointment_deposit" }
      : whatsappBookingPaymentInfo(service.rows[0], state);
    const needsReview = variant.rows[0]?.requires_assessment || variant.rows[0]?.requires_human_confirmation;
    const shouldCreatePayment = paymentInfo.amount > 0 && !needsReview;
    const initialStatus = shouldCreatePayment ? "awaiting_payment" : "requested";
    const intake = {
      origin: "whatsapp_ai",
      conversation_id: conversationId,
      requested_service: state.requestedServiceName || state.serviceName,
      service_value: Number(state.serviceValue || service.rows[0].base_price || 0),
      contact: {
        name: clean(state.clientName),
        email: clean(state.clientEmail),
        phone: normalizeBookingPhone(state.clientPhone, phoneNumber),
        cpf: normalizeClientCpf(state.clientCpf),
        birthDate: normalizeBirthDate(state.clientBirthDate),
      },
      selected_by_ai: true,
      requires_human_confirmation: true,
      service_variant_id: variant.rows[0]?.id || null,
      service_variant_code: variant.rows[0]?.code || null,
      requires_assessment: variant.rows[0]?.requires_assessment === true,
    };
    const notes = [
      "Pré-agendamento criado pela IA do WhatsApp.",
      state.clientName ? `Nome informado: ${state.clientName}.` : "",
      state.clientEmail ? `E-mail informado: ${state.clientEmail}.` : "",
      normalizeClientCpf(state.clientCpf) ? `CPF informado: ${normalizeClientCpf(state.clientCpf)}.` : "",
      normalizeBirthDate(state.clientBirthDate) ? `Nascimento informado: ${normalizeBirthDate(state.clientBirthDate)}.` : "",
      normalizeBookingPhone(state.clientPhone, phoneNumber)
        ? `Telefone informado: ${normalizeBookingPhone(state.clientPhone, phoneNumber)}.`
        : "",
      state.requestedServiceName && state.requestedServiceName !== state.serviceName
        ? `Serviço solicitado pela cliente: ${state.requestedServiceName}.`
        : "",
      `Valor registrado: ${formatServiceValue({ is_free: state.serviceIsFree || service.rows[0].is_free }, state.serviceValue || service.rows[0].base_price || 0)}.`,
      "Confirmar disponibilidade e detalhes com a cliente antes do atendimento.",
    ].filter(Boolean).join(" ");
    const idempotencyKey = whatsappAppointmentIdempotencyKey(conversationId, state.previousAppointmentId);

    if (variant.rows[0]) {
      await client.query(
        `insert into public.appointments(
          id,booking_code,client_id,professional_id,service_id,service_variant_id,location_id,starts_at,ends_at,
          status,notes,estimated_value,original_value,discount_amount,intake_data,catalog_snapshot,created_by,
          source,timezone,duration_minutes,idempotency_key
        ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,0,$13,$14,$15,$16,$17,$18,$19)`,
        [appointmentId,bookingCode,bookingClient.client_id,professional.rows[0].id,service.rows[0].id,
          variant.rows[0].id,location.rows[0]?.id || null,startsAt.toISOString(),endsAt.toISOString(),
          initialStatus,notes,selectedValue,JSON.stringify(intake),
          JSON.stringify(catalogSnapshot({ service: service.rows[0], variant: variant.rows[0], addons: addons.rows, total: selectedValue, deposit: paymentInfo.amount })),
          bookingClient.profile_id || null,"bot",automation.settings.timezone,durationMinutes,idempotencyKey],
      );
      for (const addon of addons.rows) {
        await client.query(
          `insert into public.appointment_addons(appointment_id,addon_id,addon_code,addon_name,price,duration_minutes)
           values($1,$2,$3,$4,$5,$6)`,
          [appointmentId, addon.id, addon.code, addon.name, addon.price, addon.duration_minutes],
        );
      }
    } else {
      // Keep the legacy statement stable for services that do not use the 2026 catalog.
      await client.query(
        `insert into public.appointments(
          id,booking_code,client_id,professional_id,service_id,location_id,starts_at,ends_at,
          status,notes,estimated_value,original_value,discount_amount,intake_data,created_by,
          source,timezone,duration_minutes,idempotency_key
        ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,0,$12,$13,$14,$15,$16,$17)`,
        [appointmentId,bookingCode,bookingClient.client_id,professional.rows[0].id,service.rows[0].id,
          location.rows[0]?.id || null,startsAt.toISOString(),endsAt.toISOString(),initialStatus,notes,
          selectedValue,JSON.stringify(intake),bookingClient.profile_id || null,"bot",automation.settings.timezone,durationMinutes,idempotencyKey],
      );
    }
    let paymentId = null;
    let paymentUrl = null;
    if (shouldCreatePayment) {
      await client.query("alter table public.payments add column if not exists billing_reason text").catch(() => null);
      await client.query("alter table public.payments add column if not exists hosted_checkout_url text").catch(() => null);
      const payment = await client.query(
        `insert into public.payments(
          appointment_id,client_id,amount,original_amount,discount_amount,method,payment_method,provider,status,notes,billing_reason
        ) values($1,$2,$3,$4,0,'pix','pix','pix_manual','pending',$5,$6) returning id`,
        [
          appointmentId,
          bookingClient.client_id,
          paymentInfo.amount,
          paymentInfo.originalAmount,
          paymentInfo.notes,
          paymentInfo.billingReason,
        ],
      );
      paymentId = payment.rows[0]?.id || null;
      if (!paymentId) throw new Error("Nao foi possivel criar a fatura do agendamento.");
      await client.query(
        `insert into public.payment_status_history(payment_id,old_status,new_status,changed_by,notes)
         values($1,null,'pending',$2,$3)`,
        [paymentId, bookingClient.profile_id || null, "Fatura criada automaticamente pelo WhatsApp"],
      ).catch(() => null);

      try {
        const sumup = sumupConfig();
        if (sumup.enabled) {
          const returnUrl = `${sumup.returnUrl}${sumup.returnUrl.includes("?") ? "&" : "?"}payment_id=${encodeURIComponent(paymentId)}`;
          const checkout = await createSumupCheckout({
            reference: `pay-${paymentId}`,
            amount: paymentInfo.amount,
            description: `Sinal - ${state.serviceName}`,
            returnUrl,
            customerId: bookingClient.sumup_customer_id || null,
            hostedCheckout: true,
          });
          if (checkout?.hostedUrl) {
            paymentUrl = checkout.hostedUrl;
            await client.query(
              `update public.payments
                  set provider='sumup',
                      method='card',
                      payment_method='card',
                      provider_checkout_id=$2,
                      hosted_checkout_url=$3,
                      updated_at=now()
                where id=$1`,
              [paymentId, checkout.id, checkout.hostedUrl],
            );
          }
        }
      } catch (sumupError) {
        console.error("Failed to generate SumUp checkout for whatsapp booking:", sumupError.message);
      }
    }
    await client.query(
      `insert into public.appointment_status_history(appointment_id,to_status,changed_by,note)
       values($1,$2,$3,'Pré-agendamento criado pela IA do WhatsApp')`,
      [appointmentId, initialStatus, bookingClient.profile_id || null],
    );
    const notificationData = JSON.stringify({ appointment_id: appointmentId, payment_id: paymentId, conversation_id: conversationId });
    const clientNotification = await client.query(
      `insert into public.notifications(profile_id,kind,title,body,data,action_url,metadata)
       values($1,'appointment_created','Pré-agendamento enviado',$2,$3,$4,$3) returning id`,
      [
        bookingClient.profile_id,
        shouldCreatePayment
          ? `Sua solicitação de ${service.rows[0].name} foi registrada. A fatura já está disponível no portal.`
          : `Sua solicitação de ${service.rows[0].name} foi registrada. A equipe vai confirmar a disponibilidade.`,
        notificationData,
        paymentId ? `/cliente/pagamentos/${paymentId}` : `/cliente/agendamentos/${appointmentId}`,
      ],
    );
    const professionalNotification = await client.query(
      `insert into public.notifications(profile_id,kind,title,body,data,action_url,metadata)
       values($1,'appointment_requested','Novo pré-agendamento do WhatsApp',$2,$3,$4,$3) returning id`,
      [
        professional.rows[0].profile_id,
        `Nova solicitação de ${service.rows[0].name} para ${startsAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.`,
        notificationData,
        "/profissional/agenda",
      ],
    );
    const nextState = {
      ...state,
      status: "booked",
      appointmentId,
      bookingCode,
      paymentId,
      paymentUrl,
      updatedAt: new Date().toISOString(),
    };
    await client.query(
      `update public.whatsapp_conversations
          set client_id=coalesce(client_id,$2),
              professional_id=coalesce(professional_id,$3),
              appointment_id=$4,
              payment_id=$5,
              booking_state=$6,
              updated_at=now()
        where id=$1`,
      [
        conversationId,
        bookingClient.client_id,
        professional.rows[0].id,
        appointmentId,
        paymentId,
        JSON.stringify(prunePayload(nextState)),
      ],
    );
    await logMessage(client, {
      conversationId,
      messageId: null,
      eventType: "booking_appointment_created",
      status: "success",
      details: {
        appointmentId,
        bookingCode,
        paymentId,
        paymentAmount: paymentInfo.amount,
        paymentUrl,
        billingReason: paymentInfo.billingReason,
        service: service.rows[0].name,
        professional: professional.rows[0].full_name,
        startsAt: startsAt.toISOString(),
      },
    });
    await client.query(
      `insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_data)
       values($1,'create','appointment',$2,$3)`,
      [
        bookingClient.profile_id || null,
        appointmentId,
        JSON.stringify({ origin: "whatsapp_ai", conversation_id: conversationId }),
      ],
    ).catch(() => null);
    return {
      id: appointmentId,
      persisted: true,
      bookingCode,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      durationMinutes,
      location: location.rows[0]?.name || automation.address || "",
      paymentId,
      paymentAmount: paymentInfo.amount,
      paymentUrl,
      billingReason: paymentInfo.billingReason,
      service: service.rows[0].name,
      professional: professional.rows[0].full_name,
      professionalEmail: professional.rows[0].email || "",
      professionalPhone: professional.rows[0].phone || "",
      clientName: bookingClient.full_name || state.clientName || "",
      clientEmail: bookingClient.email || state.clientEmail || "",
      clientPhone: normalizeBookingPhone(state.clientPhone, phoneNumber),
      clientNotificationId: clientNotification.rows[0]?.id || null,
      professionalNotificationId: professionalNotification.rows[0]?.id || null,
      value: selectedValue,
      notes,
      access: bookingClient.access || null,
    };
  });
  if (!result.alreadyCreated) {
    const calendarUrl = generateGoogleCalendarUrl(
      {
        starts_at: result.startsAt,
        ends_at: result.endsAt,
        service: result.service,
        professional: result.professional,
        booking_code: result.bookingCode,
        location: result.location,
      },
      automation,
    );
    result.calendarUrl = automation.settings.googleCalendarLinkEnabled ? calendarUrl : "";
    await notifyAppointment({
      email: result.clientEmail,
      // A confirmação no próprio fluxo já é o aviso WhatsApp da cliente.
      phone: "",
      clientName: result.clientName,
      service: result.service,
      date: result.startsAt,
      endsAt: result.endsAt,
      durationMinutes: result.durationMinutes,
      professional: result.professional,
      professionalEmail: result.professionalEmail,
      professionalPhone: result.professionalPhone,
      clientNotificationId: result.clientNotificationId,
      professionalNotificationId: result.professionalNotificationId,
      notes: result.notes,
      value: result.value,
      location: result.location,
      bookingCode: result.bookingCode,
      settings: automation.settings,
      businessName: automation.businessName,
      address: automation.address,
    });
  }
  if (result.access?.email && result.access?.temporaryPassword) {
    await sendEmail({
      to: result.access.email,
      subject: "Seu acesso ao portal Carol Sol",
      html: `<p>Olá, ${result.access.fullName || "cliente"}.</p><p>Seu cadastro foi realizado com sucesso e seu acesso ao portal foi criado.</p><p><strong>Login:</strong> ${result.access.email}<br/><strong>Senha temporária:</strong> ${result.access.temporaryPassword}</p><p>Acesse: <a href="${process.env.APP_URL || "https://carolmobile.vercel.app"}/entrar">${process.env.APP_URL || "https://carolmobile.vercel.app"}/entrar</a></p><p>Por segurança, altere sua senha no primeiro acesso.</p>`,
    }).catch((error) =>
      console.error("Failed to send WhatsApp booking access email:", error.message),
    );
  }
  return result;
}

function isBookingIntent(text) {
  const normalized = normalizeText(text);
  return includesAny(normalized, [
    "agendar",
    "agendamento",
    "agenda",
    "horario",
    "horário",
    "disponivel",
    "disponível",
    "disponibilidade",
    "marcar",
    "encaixe",
    "quero fazer",
    "gostaria de fazer",
    "aplicacao",
    "aplicação",
    "manutencao",
    "manutenção",
    "avaliacao",
    "avaliação",
    "fibra russa",
    "mega hair",
  ]);
}

function bookingFollowupOptionsText() {
  return [
    "Posso continuar te ajudando por aqui:",
    "1) Agendar outro serviço ou avaliação",
    "2) Tirar uma dúvida sobre Mega Hair",
    "3) Falar com a equipe",
  ].join("\n");
}

function buildAlreadyBookedResponse(state) {
  const code = state.bookingCode || (state.appointmentId ? String(state.appointmentId).slice(0, 8) : "");
  return [
    `Seu pré-agendamento já está registrado${code ? ` com o código ${code}` : ""}.`,
    "A equipe vai confirmar os detalhes pelo WhatsApp.",
    bookingFollowupOptionsText(),
  ].join("\n\n");
}

function asksAboutExistingBooking(text) {
  const normalized = normalizeText(text);
  return includesAny(normalized, [
    "meu pre agendamento",
    "meu agendamento",
    "pre agendamento registrado",
    "agendamento registrado",
    "codigo",
    "protocolo",
    "status do agendamento",
    "ja foi registrado",
    "ja registrou",
    "ficou registrado",
    "deu certo",
    "confirmado",
    "confirmou",
    "esta marcado",
    "ta marcado",
    "esta agendado",
    "ta agendado",
  ]);
}

function isBookedFollowupQuestionChoice(text) {
  return numericChoice(text) === 2;
}

function isBookedFollowupHandoffChoice(text) {
  const normalized = normalizeText(text);
  return numericChoice(text) === 3 || includesAny(normalized, [
    "falar com a equipe",
    "falar com atendente",
    "falar com humano",
    "chamar equipe",
    "chamar atendente",
    "atendente",
  ]);
}

function isNewBookingRequestAfterBooked(text) {
  const normalized = normalizeText(text);
  if (numericChoice(text) === 1) return true;
  if (asksAboutExistingBooking(text)) return false;
  if (isAgendaAvailabilityIntent(text)) return true;
  if (includesAny(normalized, [
    "agendar outro",
    "marcar outro",
    "novo agendamento",
    "novo horario",
    "novo horário",
    "quero agendar",
    "quero marcar",
    "gostaria de agendar",
    "gostaria de marcar",
    "preciso agendar",
    "preciso marcar",
  ])) return true;
  const hasServiceAction = includesAny(normalized, [
    "quero fazer aplicacao",
    "quero fazer uma aplicacao",
    "quero fazer manutencao",
    "quero fazer uma manutencao",
    "quero fazer avaliacao",
    "quero fazer uma avaliacao",
    "quero fazer mega hair",
    "quero fazer fibra russa",
    "queria fazer aplicacao",
    "queria fazer manutencao",
    "queria fazer avaliacao",
    "gostaria de fazer aplicacao",
    "gostaria de fazer manutencao",
    "gostaria de fazer avaliacao",
    "preciso fazer aplicacao",
    "preciso fazer manutencao",
    "preciso fazer avaliacao",
  ]);
  return hasServiceAction || includesAny(normalized, [
    "agendar outro",
    "agendar outra",
    "agendar mais",
    "marcar outro",
    "marcar outra",
    "novo agendamento",
    "nova avaliacao",
    "outra avaliacao",
    "outro servico",
    "outro horario",
    "tem horario",
    "tem vaga",
    "tem disponibilidade",
    "horario disponivel",
    "marcar horario",
    "marcar um horario",
    "quero agendar",
    "queria agendar",
    "gostaria de agendar",
    "posso agendar",
    "quero marcar",
  ]);
}

function flowEnabled(base, flowKey) {
  const flow = (base.flows || []).find((item) => item.flow_key === flowKey);
  return flow ? flow.enabled !== false : true;
}

function formatSlot(slot) {
  return `${slot.time} com ${slot.professionalName}`;
}

function slotAvailabilityContextLine() {
  return "Esses horarios ja consideram a duracao do servico e a agenda ocupada ou bloqueada.";
}

async function slotOptionsForBooking({ serviceId, serviceVariantId = "", date, preferredTime = "", period = "" }) {
  return transaction(async (client) => {
    const { slots } = await availableBookingSlots(client, {
      serviceId,
      serviceVariantId,
      date,
      preferredTime,
      period,
    });
    return slots.map((slot, index) => ({ ...slot, id: index + 1 }));
  });
}

async function nextAvailableSlotOptions({ serviceId, serviceVariantId = "", fromDate, period = "" }) {
  const options = [];
  for (let offset = 0; offset <= 10; offset++) {
    const date = addLocalDays(fromDate, offset);
    const slots = await slotOptionsForBooking({ serviceId, serviceVariantId, date, period });
    for (const slot of slots) {
      options.push({ ...slot, id: options.length + 1 });
    }
  }
  return options;
}

export async function handleLocalAgendaAvailabilityIntent({
  normalized,
  conversationId,
  inboundMessageId,
  text,
  settings,
  base,
  recorded,
  queueLatencyMs,
  receivedAt,
  history = [],
}) {
  if (!settings.allowAutoBooking) return null;
  if (!flowEnabled(base, "verificacao_agenda")) return null;
  if (!isAgendaAvailabilityIntent(text)) return null;

  const lastAiMessage = (history || []).filter((item) => item.sender_type === "ai").pop();
  const lastAiResponseText = lastAiMessage ? lastAiMessage.body : "";
  const sendTextAndRecord = async ({ text: responseText, reason }) => {
    if (lastAiResponseText && responseText.trim() === lastAiResponseText.trim()) {
      throw new Error("LOOP_DETECTED");
    }
    return performSendTextAndRecord({ normalized, conversationId, text: responseText, reason });
  };

  try {
    const currentState = parseJsonObject(recorded.conversation.booking_state);
    const state = {
      status: "collecting",
      ...currentState,
      previousAppointmentId: recorded.conversation.appointment_id || currentState.appointmentId || "",
      updatedAt: new Date().toISOString(),
    };
    state.clientPhone = normalizeBookingPhone(state.clientPhone, normalized.phoneNumber);

    const parsedDate = parseBookingDateFromText(text, state) || state.date || "";
    const parsedTime = parseFlexibleBookingTimeFromText(text);
    const requestedPeriod = parsedTime.period || state.period || "";
    const preferredTime = parsedTime.time || "";

    state.date = parsedDate || state.date || "";
    state.period = requestedPeriod;
    state.preferredTime = preferredTime;
    state.requestedAgendaQuestion = clean(text);

    const hierarchyResult = await processServiceHierarchySelection(text, base, state, conversationId, normalized, true, parsedDate);
    if (hierarchyResult) return hierarchyResult;


    if (!state.serviceDetailsAccepted) {
      state.status = "awaiting_service_details";
      await saveBookingState(conversationId, state);
      const responseText = buildServiceDetailsResponse(state);
      await sendTextAndRecord({ text: responseText, reason: "agenda_service_details" });
      await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
      await logAiRequest({
        conversationId,
        messageId: inboundMessageId,
        provider: "local_booking",
        model: "agenda_availability_intent",
        status: "service_details",
        queueLatencyMs,
        providerLatencyMs: 0,
        totalLatencyMs: Date.now() - receivedAt.getTime(),
        inputTokens: 0,
        outputTokens: 0,
      });
      return { ok: true, replied: true, reason: "agenda_service_details", conversationId };
    }

    if (!state.date) {
      state.status = "awaiting_date";
      state.dateOptions = dateOptionsFrom();
      await saveBookingState(conversationId, state);
      const responseText = [
      `Consigo consultar a agenda real para ${state.serviceName}.`,
        "Qual dia voce quer verificar?",
        optionLines(state.dateOptions, (item) => item.label),
        "Se preferir outro dia, pode mandar no formato 10/07.",
      ].join("\n\n");
      await sendTextAndRecord({ text: responseText, reason: "agenda_date_request" });
      await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
      await logAiRequest({
        conversationId,
        messageId: inboundMessageId,
        provider: "local_booking",
        model: "agenda_availability_intent",
        status: "date_request",
        queueLatencyMs,
        providerLatencyMs: 0,
        totalLatencyMs: Date.now() - receivedAt.getTime(),
        inputTokens: 0,
        outputTokens: 0,
      });
      return { ok: true, replied: true, reason: "agenda_date_request", conversationId };
    }

    let slotOptions = await slotOptionsForBooking({
      serviceId: state.serviceId,
      serviceVariantId: state.serviceVariantId,
      date: state.date,
      preferredTime,
      period: requestedPeriod,
    });
    let reason = "agenda_slot_options";
    let header = `Consultei a agenda real para ${formatDateLabel(state.date)}.`;

    if (!slotOptions.length) {
      const nextOptions = await nextAvailableSlotOptions({
        serviceId: state.serviceId,
        serviceVariantId: state.serviceVariantId,
        fromDate: addLocalDays(state.date, 1),
        period: requestedPeriod,
      });
      if (!nextOptions.length) {
        Object.assign(state, {
          status: "awaiting_date",
          date: "",
          time: "",
          professionalId: "",
          slotOptions: [],
          dateOptions: dateOptionsFrom(),
        });
        await saveBookingState(conversationId, state);
        const responseText = [
          `${header} Nao encontrei horarios disponiveis nessa data.`,
          "Tambem nao encontrei vagas nos proximos dias para esse servico.",
          "Pode me enviar outra data para eu consultar?",
        ].join("\n\n");
        await sendTextAndRecord({ text: responseText, reason: "agenda_no_slots" });
        await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
        await logAiRequest({
          conversationId,
          messageId: inboundMessageId,
          provider: "local_booking",
          model: "agenda_availability_intent",
          status: "no_slots",
          queueLatencyMs,
          providerLatencyMs: 0,
          totalLatencyMs: Date.now() - receivedAt.getTime(),
          inputTokens: 0,
          outputTokens: 0,
        });
        return { ok: true, replied: true, reason: "agenda_no_slots", conversationId };
      }
      slotOptions = nextOptions;
      reason = "agenda_next_slot_options";
      header = `${header} Nao encontrei horarios nessa data, mas achei proximas opcoes.`;
    }

    Object.assign(state, {
      status: "awaiting_slot",
      date: state.date,
      time: "",
      professionalId: "",
      slotOptions,
      slotPageStart: 0,
    });
    await saveBookingState(conversationId, state);
    const periodText = requestedPeriod ? ` no periodo da ${periodLabel(requestedPeriod)}` : "";
    const responseText = [
      naturalConversationPrefix(text),
      `${header} Encontrei ${slotOptions.length} horarios disponiveis${periodText}.`,
      slotAvailabilityContextLine(),
      "Pode escolher pelo numero ou me dizer o horario que prefere:",
      slotPageLines(slotOptions, 0),
    ].filter(Boolean).join("\n\n");
    await sendTextAndRecord({ text: responseText, reason });
    await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
    await logAiRequest({
      conversationId,
      messageId: inboundMessageId,
      provider: "local_booking",
      model: "agenda_availability_intent",
      status: reason,
      queueLatencyMs,
      providerLatencyMs: 0,
      totalLatencyMs: Date.now() - receivedAt.getTime(),
      inputTokens: 0,
      outputTokens: 0,
    });
    return { ok: true, replied: true, reason, conversationId };
  } catch (error) {
    if (error.message !== "LOOP_DETECTED") {
      console.error("Local agenda availability intent failed:", error.message);
    }
    return null;
  }
}

function buildBookingSummary(state) {
  const valText = state.serviceIsFree ? "Gratuito" : `R$ ${Number(state.serviceValue || 0).toFixed(2)}`;
  const depositText = state.serviceRequiresDeposit ? `\n💳 Sinal: R$ ${Number(state.serviceDepositAmount || 0).toFixed(2)}` : "";
  return [
    `💇 *Serviço:* ${state.serviceName}`,
    state.bookingPurpose === "assessment" && state.requestedServiceName
      ? `✨ *Interesse informado:* ${state.requestedServiceName}`
      : "",
    state.professionalName ? `👤 *Profissional:* ${state.professionalName}` : "",
    `📅 *Data:* ${formatDateLabel(state.date)}`,
    `🕒 *Horário:* ${state.time}`,
    `💰 *Valor:* ${valText}${depositText}`,
    "",
    `👤 *Cliente:* ${state.clientName}`,
    state.clientEmail ? `📧 *E-mail: ${state.clientEmail}*` : "",
    state.clientCpf ? `📄 *CPF: ${state.clientCpf}*` : "",
    state.clientBirthDate ? `📅 *Nascimento: ${state.clientBirthDate}*` : "",
    `📱 *Telefone: ${state.clientPhone}*`,
  ].filter(Boolean).join("\n");
}

export async function handleStructuredBookingFlow({
  normalized,
  conversationId,
  inboundMessageId,
  text,
  settings,
  base,
  recorded,
  queueLatencyMs,
  receivedAt,
  history = [],
  forceCatalogFlow = false,
}) {
  const persistedBookingState = parseJsonObject(recorded.conversation.booking_state);
  const isPersistedStateActive = isActiveBookingState(persistedBookingState);

  if (!settings.allowAutoBooking && !forceCatalogFlow && !isPersistedStateActive) return null;
  if (
    !forceCatalogFlow &&
    !isPersistedStateActive &&
    !flowEnabled(base, "pre_agendamento") &&
    !flowEnabled(base, "verificacao_agenda")
  ) return null;

  const sendTextAndRecord = performSendTextAndRecord;

  try {
    let currentState = persistedBookingState;
    const hasActiveCatalogMenu = [
      "awaiting_category",
      "awaiting_method",
      "awaiting_service",
      "awaiting_service_details",
      "awaiting_inventory",
    ].includes(String(currentState.status || ""));
    let persistedAppointmentId = recorded.conversation.appointment_id || currentState.appointmentId || "";
    if (persistedAppointmentId) {
      const appQuery = await query(
        `select id
           from public.appointments
          where id = $1
            and starts_at > now() - interval '2 hours'
            and status not in ('cancelled', 'rejected')`,
        [persistedAppointmentId]
      ).catch(() => null);
      if (!appQuery || appQuery.rowCount === 0) {
        persistedAppointmentId = "";
        await query(
          `update public.whatsapp_conversations
              set appointment_id=null, payment_id=null, updated_at=now()
            where id=$1`,
          [conversationId],
        ).catch(() => null);
        if (currentState.status === "booked") {
          currentState.status = "";
          currentState.appointmentId = "";
        }
      }
    }

    if (
      persistedAppointmentId &&
      !hasActiveCatalogMenu &&
      currentState.status !== "booked" &&
      currentState.previousAppointmentId !== persistedAppointmentId
    ) {
      currentState = {
        ...currentState,
        status: "booked",
        appointmentId: persistedAppointmentId,
      };
    }
  if (shouldResetBookingStateOnGreeting(text, currentState) && !isActiveBookingState(currentState)) {
    await saveBookingState(conversationId, {});
    const responseText = settings.welcomeMessage;
    await sendTextAndRecord({ normalized, conversationId, text: responseText, reason: "booking_state_reset_greeting" });
    await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
    await logAiRequest({
      conversationId,
      messageId: inboundMessageId,
      provider: "local_booking",
      model: "booking_state_machine",
      status: "state_reset_greeting",
      queueLatencyMs,
      providerLatencyMs: 0,
      totalLatencyMs: Date.now() - receivedAt.getTime(),
    });
    return { ok: true, replied: true, reason: "booking_state_reset_greeting", conversationId };
  }
  if (currentState.status === "booked" && currentState.appointmentId) {
    if (isBookedFollowupHandoffChoice(text)) {
      const responseText =
        settings.humanHandoffMessage ||
        "Certo, chamei a equipe para continuar seu atendimento por aqui.";
      await requestHumanAttention({
        conversationId,
        messageId: inboundMessageId,
        reason: "booking_followup_handoff",
        responseText,
        pauseAi: true,
      });
      await sendTextAndRecord({ normalized, conversationId, text: responseText, reason: "booking_followup_handoff" });
      await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
      return { ok: true, replied: true, reason: "booking_followup_handoff", conversationId };
    }

    if (isBookedFollowupQuestionChoice(text)) {
      currentState = {
        ...currentState,
        followupMode: "question",
        updatedAt: new Date().toISOString(),
      };
      await saveBookingState(conversationId, currentState);
      const responseText =
        "Claro 😊 Me manda sua dúvida sobre Mega Hair que eu te respondo por aqui.";
      await sendTextAndRecord({ normalized, conversationId, text: responseText, reason: "booking_followup_question_prompt" });
      await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
      return { ok: true, replied: true, reason: "booking_followup_question_prompt", conversationId };
    }

    if (currentState.followupMode === "question" && !isNewBookingRequestAfterBooked(text)) {
      // A mensagem seguinte à opção 2 é conteúdo da dúvida, mesmo quando cita
      // nomes de serviços. Ela deve seguir para a IA, não para alteração/agendamento.
      return null;
    }

    if (isNewBookingRequestAfterBooked(text)) {
      return openInitialServiceCatalog({ normalized, conversationId, base, recorded });
    } else if (asksAboutExistingBooking(text) || isAffirmativeBookingConfirmation(text)) {
      const responseText = buildAlreadyBookedResponse(currentState);
      await sendTextAndRecord({ normalized, conversationId, text: responseText, reason: "booking_already_created" });
      await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
      return { ok: true, replied: true, reason: "booking_already_created", conversationId };
    } else {
      return null;
    }
  }

  const previousAiPrompt = lastAiText(history) || recorded.conversation.last_message_preview || "";
  const previousPrompt = normalizeText(previousAiPrompt);
  const previousPromptSuggestsBooking =
    isBookingIntent(previousPrompt) ||
    includesAny(previousPrompt, [
      "data preferida",
      "escolha a data",
      "escolha o horario",
      "escolha o horário",
      "responda so com o numero",
      "responda só com o número",
    ]);
  const directServiceChoice = selectBookingService(text, base, currentState);
  const canRecoverServiceFromPreviousPrompt = ![
    "awaiting_category",
    "awaiting_method",
    "awaiting_service",
    "awaiting_inventory",
  ].includes(String(currentState.status || ""));
  const previousServiceChoice = !currentState.serviceId &&
    canRecoverServiceFromPreviousPrompt &&
    previousPromptSuggestsBooking
    ? selectBookingService(previousAiPrompt, base, currentState)
    : null;
  const active =
    (currentState.status && currentState.status !== "booked") ||
    previousPromptSuggestsBooking ||
    forceCatalogFlow ||
    isServiceCatalogMenuIntent(text) ||
    Boolean(directServiceChoice?.serviceId);
  if (!active && !isBookingIntent(text)) return null;
  const entryStatus = String(currentState.status || "collecting");

  const state = {
    status: "collecting",
    ...currentState,
    updatedAt: new Date().toISOString(),
  };
  if (!state.serviceId && previousServiceChoice?.serviceId) {
    Object.assign(state, {
      serviceId: previousServiceChoice.serviceId,
      serviceName: previousServiceChoice.serviceName,
      requestedServiceName: previousServiceChoice.requestedServiceName || previousServiceChoice.serviceName,
      serviceValue: previousServiceChoice.serviceValue || 0,
      serviceIsFree: previousServiceChoice.serviceIsFree === true,
      offerInventoryItems: previousServiceChoice.offerInventoryItems === true,
      categoryId: previousServiceChoice.categoryId,
      methodId: previousServiceChoice.methodId,
      ...serviceDetailsState(previousServiceChoice),
      serviceDetailsAccepted: false,
      serviceNote: previousServiceChoice.note || "",
    });
  }
  state.clientPhone = normalizeBookingPhone(state.clientPhone, normalized.phoneNumber);
  applyBookingContactFields(state, text, { allowPlainName: state.status === "awaiting_contact" });
  hydrateBookingContactFromClient(state, recorded.client);

  // Extrai data e hora/período da mensagem se ainda não estiverem definidos no estado
  if (!state.date) {
    const parsedDate = parseBookingDateFromText(text, state);
    if (parsedDate) state.date = parsedDate;
  }
  const parsedTimeForAutoExtract = parseFlexibleBookingTimeFromText(text);
  if (parsedTimeForAutoExtract.time && !state.time) {
    state.time = parsedTimeForAutoExtract.time;
  }
  if (parsedTimeForAutoExtract.period && !state.period) {
    state.period = parsedTimeForAutoExtract.period;
  }

  const hierarchyResult = await processServiceHierarchySelection(text, base, state, conversationId, normalized, false, "");
  if (hierarchyResult) return hierarchyResult;
  if (!state.serviceId) {
    if (isPersistedStateActive) {
      return openInitialServiceCatalog({ normalized, conversationId, base, recorded });
    }
    return null;
  }

  // Se a intenção original era consultar a agenda ou se o usuário já forneceu data/hora/período,
  // pula a confirmação de detalhes do serviço.
  if (state.serviceId && (state.date || state.requestedAgendaQuestion || state.period)) {
    state.serviceDetailsAccepted = true;
  }

  if (state.serviceId && state.status === "awaiting_service_details") {
    if (wantsAnotherServiceAfterDetails(text)) {
      Object.assign(state, {
        status: "collecting",
        categoryId: "",
        methodId: "",
        serviceId: "",
        inventoryId: "",
        serviceName: "",
        requestedServiceName: "",
        serviceValue: 0,
        serviceIsFree: false,
        serviceNote: "",
        serviceDetailsAccepted: false,
        serviceDescription: "",
        serviceDetailedDescription: "",
        serviceDurationMinutes: 0,
        serviceDepositAmount: 0,
        serviceDepositType: "amount",
        serviceRequiresAssessment: false,
        serviceRequiresDeposit: false,
        serviceRecommendedMessage: "",
        categoryOptions: [],
        methodOptions: [],
        serviceOptions: [],
        inventoryOptions: [],
      });
      await saveBookingState(conversationId, state);

      const hierarchyResult = await processServiceHierarchySelection("agendar", base, state, conversationId, normalized, false, "");
      if (hierarchyResult) return hierarchyResult;
    }
    if (!isServiceDetailsAccepted(text)) {
      await saveBookingState(conversationId, state);
      const responseText = [
        buildServiceDetailsResponse(state),
        "Responda 1 para verificar horarios ou 2 para escolher outro servico.",
      ].join("\n\n");
      await sendTextAndRecord({ normalized, conversationId, text: responseText, reason: "booking_service_details" });
      await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
      return { ok: true, replied: true, reason: "booking_service_details", conversationId };
    }
    state.serviceDetailsAccepted = true;
    state.status = "collecting";

    const assessmentPrepared = prepareRequiredAssessmentBooking(state, base);
    if (!assessmentPrepared) {
      const inventoryResult = await processServiceHierarchySelection(
        text,
        base,
        state,
        conversationId,
        normalized,
        false,
        "",
      );
      if (inventoryResult) return inventoryResult;
    }
  }

  if (state.serviceRequiresAssessment && state.serviceDetailsAccepted) {
    prepareRequiredAssessmentBooking(state, base);
  }

  if (state.serviceVariantId && state.serviceDetailsAccepted && !state.addonDecisionMade) {
    const addonOptions = buildAddonOptions(base, state.serviceVariantId);
    if (addonOptions.length > 1) {
      state.addonOptions = addonOptions;
      state.status = "awaiting_addon";
      await saveBookingState(conversationId, state);
      const responseText = [
        "Deseja acrescentar algum adicional?",
        optionLines(addonOptions, (item) => item.addonValue > 0
          ? `${item.addonName} — ${formatBookingCurrency(item.addonValue)}`
          : item.addonName),
      ].join("\n\n");
      await sendTextAndRecord({ normalized, conversationId, text: responseText, reason: "booking_addon_options" });
      return { ok: true, replied: true, reason: "booking_addon_options", conversationId };
    }
    state.addonDecisionMade = true;
  }

  const hasDateOrTimeInText = parseBookingDateFromText(text, state) || parseFlexibleBookingTimeFromText(text).time || parseFlexibleBookingTimeFromText(text).period;
  if (hasDateOrTimeInText && state.serviceId) {
    state.serviceDetailsAccepted = true;
  }

  if (
    state.serviceId &&
    !state.serviceDetailsAccepted &&
    ["collecting", "awaiting_service"].includes(String(state.status || "collecting"))
  ) {
    state.status = "awaiting_service_details";
    await saveBookingState(conversationId, state);
    const responseText = buildServiceDetailsResponse(state);
    await sendTextAndRecord({ normalized, conversationId, text: responseText, reason: "booking_service_details" });
    await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
    await logAiRequest({
      conversationId,
      messageId: inboundMessageId,
      provider: "local_booking",
      model: "booking_state_machine",
      status: "service_details",
      queueLatencyMs,
      providerLatencyMs: 0,
      totalLatencyMs: Date.now() - receivedAt.getTime(),
    });
    return { ok: true, replied: true, reason: "booking_service_details", conversationId };
  }

  if (!state.date) {
    const parsedDate = parseBookingDateFromText(text, state);
    if (parsedDate) {
      state.date = parsedDate;
    } else {
      const dateOptions = dateOptionsFrom();
      state.dateOptions = dateOptions;
      state.status = "awaiting_date";
      await saveBookingState(conversationId, state);
      const responseText = [
        `${state.serviceNote ? `${state.serviceNote}\n\n` : ""}Perfeito. Agora escolha a data respondendo só com o número:`,
        optionLines(dateOptions, (item) => item.label),
        "Se preferir outro dia, pode mandar no formato 10/07.",
      ].join("\n\n");
      await sendTextAndRecord({ normalized, conversationId, text: responseText, reason: "booking_date_options" });
      await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
      await logAiRequest({
        conversationId,
        messageId: inboundMessageId,
        provider: "local_booking",
        model: "booking_state_machine",
        status: "date_options",
        queueLatencyMs,
        providerLatencyMs: 0,
        totalLatencyMs: Date.now() - receivedAt.getTime(),
      });
      return { ok: true, replied: true, reason: "booking_date_options", conversationId };
    }
  }

  if (!state.time || !state.professionalId) {
    const choice = numericChoice(text);
    if (Array.isArray(state.slotOptions)) {
      const pageStart = Number(state.slotPageStart || 0);
      const nextCommand = pageStart + SLOT_PAGE_SIZE + 1;
      if (
        choice === nextCommand &&
        state.slotOptions.length > pageStart + SLOT_PAGE_SIZE
      ) {
        state.slotPageStart = pageStart + SLOT_PAGE_SIZE;
        state.status = "awaiting_slot";
        await saveBookingState(conversationId, state);
        const responseText = [
          `Encontrei ${state.slotOptions.length} horários disponíveis. Próximos horários:`,
          slotPageLines(state.slotOptions, state.slotPageStart),
        ].join("\n\n");
        await sendTextAndRecord({ normalized, conversationId, text: responseText, reason: "booking_slot_more_options" });
        await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
        await logAiRequest({
          conversationId,
          messageId: inboundMessageId,
          provider: "local_booking",
          model: "booking_state_machine",
          status: "slot_more_options",
          queueLatencyMs,
          providerLatencyMs: 0,
          totalLatencyMs: Date.now() - receivedAt.getTime(),
        });
        return { ok: true, replied: true, reason: "booking_slot_more_options", conversationId };
      }
      if (
        wantsMoreSlotOptions(text) &&
        state.slotOptions.length > pageStart + SLOT_PAGE_SIZE
      ) {
        state.slotPageStart = pageStart + SLOT_PAGE_SIZE;
        state.status = "awaiting_slot";
        await saveBookingState(conversationId, state);
        const responseText = [
          `Encontrei ${state.slotOptions.length} horários disponíveis. Próximos horários:`,
          slotPageLines(state.slotOptions, state.slotPageStart),
        ].join("\n\n");
        await sendTextAndRecord({ normalized, conversationId, text: responseText, reason: "booking_slot_more_options" });
        await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
        await logAiRequest({
          conversationId,
          messageId: inboundMessageId,
          provider: "local_booking",
          model: "booking_state_machine",
          status: "slot_more_options",
          queueLatencyMs,
          providerLatencyMs: 0,
          totalLatencyMs: Date.now() - receivedAt.getTime(),
        });
        return { ok: true, replied: true, reason: "booking_slot_more_options", conversationId };
      }
      const selected = selectDisplayedBookingSlot(state, text);
      if (selected) {
        Object.assign(state, {
          date: selected.date,
          time: selected.time,
          professionalId: selected.professionalId,
          professionalName: selected.professionalName,
          slotPageStart: pageStart,
          status: "awaiting_confirmation",
        });
      }
    }

    if (!state.time || !state.professionalId) {
      const parsedTime = parseFlexibleBookingTimeFromText(text);
      const preferredTime = parsedTime.time || "";
      const period = parsedTime.period || state.period || "";
      if (period) state.period = period;
      const slotOptions = await slotOptionsForBooking({
        serviceId: state.serviceId,
        serviceVariantId: state.serviceVariantId,
        date: state.date,
        preferredTime,
        period,
      });
      if (!slotOptions.length) {
        const unavailableDate = state.date;
        const fallbackSlots = (preferredTime || period)
          ? await slotOptionsForBooking({
              serviceId: state.serviceId,
              serviceVariantId: state.serviceVariantId,
              date: state.date,
            })
          : [];
        if (fallbackSlots.length) {
          state.status = "awaiting_slot";
          state.time = "";
          state.professionalId = "";
          state.slotOptions = fallbackSlots;
          state.slotPageStart = 0;
          await saveBookingState(conversationId, state);
          const responseText = [
            preferredTime
              ? `Nao encontrei ${preferredTime} disponivel para ${formatDateLabel(unavailableDate)}, mas mantive essa data e achei estas opcoes:`
              : `Nao encontrei horario nesse periodo para ${formatDateLabel(unavailableDate)}, mas mantive essa data e achei estas opcoes:`,
            slotAvailabilityContextLine(),
            slotPageLines(fallbackSlots, 0),
            "Pode escolher pelo numero ou me dizer outro horario.",
          ].join("\n\n");
          await sendTextAndRecord({ normalized, conversationId, text: responseText, reason: "booking_slot_alternatives" });
          await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
          await logAiRequest({
            conversationId,
            messageId: inboundMessageId,
            provider: "local_booking",
            model: "booking_state_machine",
            status: "slot_alternatives",
            queueLatencyMs,
            providerLatencyMs: 0,
            totalLatencyMs: Date.now() - receivedAt.getTime(),
          });
          return { ok: true, replied: true, reason: "booking_slot_alternatives", conversationId };
        }
        state.status = "awaiting_date";
        state.date = "";
        state.time = "";
        state.professionalId = "";
        state.slotOptions = [];
        state.dateOptions = dateOptionsFrom();
        await saveBookingState(conversationId, state);
        const responseText = [
          `Não encontrei horário disponível para ${formatDateLabel(unavailableDate)}.`,
          "Escolha outra data:",
          optionLines(state.dateOptions, (item) => item.label),
        ].join("\n\n");
        await sendTextAndRecord({ normalized, conversationId, text: responseText, reason: "booking_no_slots" });
        await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
        await logAiRequest({
          conversationId,
          messageId: inboundMessageId,
          provider: "local_booking",
          model: "booking_state_machine",
          status: "no_slots",
          queueLatencyMs,
          providerLatencyMs: 0,
          totalLatencyMs: Date.now() - receivedAt.getTime(),
        });
        return { ok: true, replied: true, reason: "booking_no_slots", conversationId };
      }
      if (((preferredTime || period) && slotOptions.length > 0) || (preferredTime && slotOptions.length === 1)) {
        const selected = preferredTime 
          ? (slotOptions.find(s => s.time === preferredTime) || slotOptions[0])
          : slotOptions[0];
        Object.assign(state, {
          date: selected.date,
          time: selected.time,
          professionalId: selected.professionalId,
          professionalName: selected.professionalName,
          slotOptions,
          slotPageStart: 0,
          status: "awaiting_confirmation",
        });
      } else {
      state.slotOptions = slotOptions;
      state.slotPageStart = 0;
      state.status = "awaiting_slot";
      await saveBookingState(conversationId, state);
      const periodText = state.period ? ` no período da ${periodLabel(state.period)}` : "";
      const responseText = [
        `Encontrei ${slotOptions.length} horários disponíveis${periodText}. Pode escolher pelo número ou me dizer o horário que prefere:`,
        slotAvailabilityContextLine(),
        slotPageLines(slotOptions, 0),
      ].join("\n\n");
      await sendTextAndRecord({ normalized, conversationId, text: responseText, reason: "booking_slot_options" });
      await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
      await logAiRequest({
        conversationId,
        messageId: inboundMessageId,
        provider: "local_booking",
        model: "booking_state_machine",
        status: "slot_options",
        queueLatencyMs,
        providerLatencyMs: 0,
        totalLatencyMs: Date.now() - receivedAt.getTime(),
      });
      return { ok: true, replied: true, reason: "booking_slot_options", conversationId };
      }
    }
  }

  const missingContact = missingBookingContactFields(state);
  if (missingContact.length) {
    state.status = "awaiting_contact";
    await saveBookingState(conversationId, state);
    const contactResponseText = bookingContactPrompt(state, missingContact);
    await sendTextAndRecord({ normalized, conversationId, text: contactResponseText, reason: "booking_contact_request" });
    await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
    await logAiRequest({
      conversationId,
      messageId: inboundMessageId,
      provider: "local_booking",
      model: "booking_state_machine",
      status: "contact_request",
      queueLatencyMs,
      providerLatencyMs: 0,
      totalLatencyMs: Date.now() - receivedAt.getTime(),
    });
    return { ok: true, replied: true, reason: "booking_contact_request", conversationId };
  }

  if (entryStatus === "awaiting_confirmation" && isFinalBookingAlteration(text)) {
    state.status = "awaiting_slot";
    state.time = "";
    state.professionalId = "";
    state.professionalName = "";
    await saveBookingState(conversationId, state);
    const responseText = [
      "Claro, vamos alterar.",
      state.date ? `Mantive a data ${formatDateLabel(state.date)} e o servico ${state.serviceName}.` : `Mantive o servico ${state.serviceName}.`,
      "Me diga o novo horario ou periodo que prefere.",
    ].join("\n\n");
    await sendTextAndRecord({ normalized, conversationId, text: responseText, reason: "booking_change_requested" });
    await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
    return { ok: true, replied: true, reason: "booking_change_requested", conversationId };
  }

  if (entryStatus !== "awaiting_confirmation" || !isFinalBookingConfirmation(text)) {
    state.status = "awaiting_confirmation";
    await saveBookingState(conversationId, state);
    const finalSummaryText = [
      `📝 *Resumo do seu Agendamento:*`,
      "",
      buildBookingSummary(state),
      "",
      `👍 *Confirmar agendamento?*`,
      `1️⃣ Confirmar`,
      `2️⃣ Alterar`
    ].filter(Boolean).join("\n");
    await sendTextAndRecord({ normalized, conversationId, text: finalSummaryText, reason: "booking_confirmation_request" });
    await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
    await logAiRequest({
      conversationId,
      messageId: inboundMessageId,
      provider: "local_booking",
      model: "booking_state_machine",
      status: "confirmation_request",
      queueLatencyMs,
      providerLatencyMs: 0,
      totalLatencyMs: Date.now() - receivedAt.getTime(),
    });
    return { ok: true, replied: true, reason: "booking_confirmation_request", conversationId };
  }

  try {
    const appointment = await createWhatsappAppointment({
      conversationId,
      phoneNumber: normalized.phoneNumber,
      state,
    });
    if (!appointment?.id || appointment.persisted !== true) {
      throw new Error("O agendamento não foi confirmado no banco de dados.");
    }
    const bookedState = {
      ...state,
      status: "booked",
      appointmentId: appointment.id,
      bookingCode: appointment.bookingCode || state.bookingCode || "",
      paymentId: appointment.paymentId || state.paymentId || "",
      paymentUrl: appointment.paymentUrl || state.paymentUrl || "",
      followupMode: "",
      updatedAt: new Date().toISOString(),
    };
    await saveBookingState(conversationId, bookedState);
    const accessText = appointment.access?.temporaryPassword
      ? [
          "Cadastro realizado com sucesso.",
          "",
          "Seu acesso ao portal foi criado.",
          "",
          `Login: ${appointment.access.email}`,
          `Senha temporária: ${appointment.access.temporaryPassword}`,
          `Link: ${process.env.APP_URL || "https://carolmobile.vercel.app"}/entrar`,
          "",
          "Por segurança, altere sua senha no primeiro acesso.",
        ].join("\n")
      : "";
    const confirmationText = [
      `🎉 *Agendamento solicitado com sucesso!*`,
      "",
      `📅 Serviço: *${appointment.service || state.serviceName}*`,
      `🗓️ Data: *${formatDateLabel(state.date)}*`,
      `🕒 Horário: *${state.time}*`,
      appointment.professional ? `👩‍💼 Profissional: *${appointment.professional}*` : "",
      appointment.bookingCode ? `🔑 Protocolo: *${appointment.bookingCode}*` : "",
      appointment.calendarUrl ? `📅 Adicionar ao Google Calendar:\n${appointment.calendarUrl}` : "",
      ...bookingCreatedPaymentLines(appointment),
      "",
      "✨ Em breve nossa equipe confirmará todos os detalhes com você por aqui! 💖",
      accessText ? `\n${accessText}` : "",
    ].filter(Boolean).join("\n");
    const responseText = [confirmationText, bookingFollowupOptionsText()].join("\n\n");
    await sendTextAndRecord({ normalized, conversationId, text: responseText, reason: "booking_created" });
    await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
    await logAiRequest({
      conversationId,
      messageId: inboundMessageId,
      provider: "local_booking",
      model: "booking_state_machine",
      status: "booking_created",
      queueLatencyMs,
      providerLatencyMs: 0,
      totalLatencyMs: Date.now() - receivedAt.getTime(),
    });
    return { ok: true, replied: true, reason: "booking_created", conversationId, appointmentId: appointment.id };
  } catch (error) {
    console.error("WhatsApp booking creation error", {
      conversationId,
      message: error.message,
    });
    await query(
      `insert into public.whatsapp_message_logs(conversation_id,message_id,event_type,status,error_message,details)
       values($1,$2,'booking_create_failed','error',$3,$4)`,
      [
        conversationId,
        inboundMessageId,
        String(error.message || "booking failed").slice(0, 1000),
        JSON.stringify({ state: prunePayload(state) }),
      ],
    ).catch(() => null);
    await requestHumanAttention({
      conversationId,
      messageId: inboundMessageId,
      reason: "booking_create_failed",
      responseText: error.message,
    });
    const responseText =
      "Tentei registrar o pré-agendamento, mas não consegui confirmar esse horário agora. Encaminhei para a equipe conferir manualmente e te responder por aqui.";
    await sendTextAndRecord({ normalized, conversationId, text: responseText, reason: "booking_create_failed" });
    await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
    await logAiRequest({
      conversationId,
      messageId: inboundMessageId,
      provider: "local_booking",
      model: "booking_state_machine",
      status: "booking_create_failed",
      errorMessage: error.message,
      queueLatencyMs,
      providerLatencyMs: 0,
      totalLatencyMs: Date.now() - receivedAt.getTime(),
    });
    return { ok: true, replied: true, reason: "booking_create_failed", conversationId };
  }
  } catch (error) {
    throw error;
  }
}

async function logMessage(client, { conversationId, messageId, eventType, status = "info", errorMessage = null, details = {} }) {
  await client.query(
    `insert into public.whatsapp_message_logs(
      conversation_id,message_id,event_type,status,error_message,details
    ) values($1,$2,$3,$4,$5,$6)`,
    [
      conversationId || null,
      messageId || null,
      eventType,
      status,
      errorMessage,
      JSON.stringify(prunePayload(details)),
    ],
  );
}

async function loadRecentHistory(conversationId, currentMessageId = null) {
  const { rows } = await query(
    `select direction,sender_type,body,created_at
       from public.whatsapp_messages
      where conversation_id=$1
        and body is not null
        and ($2::uuid is null or id <> $2::uuid)
        and coalesce(payload->>'reason','') <> 'typing_placeholder'
      order by created_at desc
      limit 8`,
    [conversationId, currentMessageId],
  );
  return rows.reverse();
}

async function recordIgnoredWebhook(normalized, reason) {
  try {
    await ensureAiWhatsappSchema();
    await query(
      `insert into public.whatsapp_message_logs(
        conversation_id,message_id,event_type,status,details
      ) values(null,null,'webhook_ignored','info',$1)`,
      [
        JSON.stringify({
          reason,
          chatType: normalized.isGroup
            ? "group"
            : normalized.isStatus
              ? "status"
              : "private",
          isFromMe: normalized.isFromMe,
          hasText: Boolean(normalized.text),
          hasPhone: Boolean(normalized.phoneNumber),
          from: normalized.from,
          text: normalized.text ? normalized.text.slice(0, 100) : null,
          phoneNumber: normalized.phoneNumber,
        }),
      ],
    );
  } catch (error) {
    console.error("WhatsApp ignored webhook log error", {
      reason,
      message: error.message,
    });
  }
}

export function summarizeAiCommercialContext(base, settings = {}, incomingText = "") {
  const activeServices = (base.services || []).filter((service) => service.active !== false);
  const normalizedQuery = normalizeText(incomingText);
  const ignoredTerms = new Set([
    "como", "qual", "quais", "quanto", "custa", "valor", "preco", "voces", "voce",
    "trabalham", "fazem", "fazer", "servico", "servicos", "sobre", "para", "uma", "tem",
  ]);
  const queryTerms = normalizedQuery
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 4 && !ignoredTerms.has(term));
  const variantsByService = new Map();
  for (const variant of base.serviceVariants || []) {
    if (variant.active === false || variant.allow_whatsapp_booking === false) continue;
    const current = variantsByService.get(variant.service_id) || [];
    current.push(variant);
    variantsByService.set(variant.service_id, current);
  }
  const rankedServices = activeServices
    .map((service) => {
      const variants = variantsByService.get(service.id) || [];
      const haystack = normalizeText([
        service.name,
        service.description,
        ...variants.map((variant) => [variant.label, variant.notes, variant.material_mode].filter(Boolean).join(" ")),
      ].filter(Boolean).join(" "));
      const score = queryTerms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
      return { service, variants, score };
    })
    .sort((left, right) => right.score - left.score || String(left.service.name).localeCompare(String(right.service.name), "pt-BR"));
  const matchedServices = queryTerms.length
    ? rankedServices.filter((entry) => entry.score > 0)
    : rankedServices;
  const selectedServices = (matchedServices.length ? matchedServices : rankedServices).slice(0, 20);
  const numericTerms = [...new Set((String(incomingText).match(/\d+/g) || []).map(Number))];
  const services = selectedServices.map(({ service, variants }) => {
    if (!variants.length) {
      const price = Number(service.base_price || 0);
      const priceText = isFreeService(service)
        ? "sem custo"
        : price > 0
          ? `R$ ${price.toFixed(2)}`
          : "valor sob consulta";
      return `- ${service.name}: ${priceText}; duração ${service.duration_minutes || "sob consulta"} min. ${service.description || ""}`.trim();
    }

    const exactVariants = numericTerms.length
      ? variants.filter((variant) => {
          const variantNumbers = (normalizeText([
            variant.label,
            variant.length_label,
            variant.weight_grams,
            variant.unit_count,
          ].filter(Boolean).join(" ")).match(/\d+/g) || []).map(Number);
          return numericTerms.every((term) => variantNumbers.includes(term));
        })
      : [];
    if (exactVariants.length) {
      const options = exactVariants.slice(0, 6).map((variant) =>
        `${variant.label}: ${formatBookingCurrency(variant.price)}, ${variant.duration_minutes || service.duration_minutes || "duração sob consulta"} min`,
      );
      return `- ${service.name}: ${options.join("; ")}. Avaliação prévia: ${exactVariants.some((variant) => variant.requires_assessment) ? "obrigatória" : "conforme cadastro"}; confirmação humana: ${exactVariants.some((variant) => variant.requires_human_confirmation) ? "obrigatória" : "não obrigatória"}.`;
    }

    const prices = variants.map((variant) => Number(variant.price || 0)).filter((value) => value >= 0);
    const durations = variants.map((variant) => Number(variant.duration_minutes || service.duration_minutes || 0)).filter((value) => value > 0);
    const lengths = [...new Set(variants.map((variant) => clean(variant.length_label)).filter(Boolean))];
    const weights = variants.map((variant) => Number(variant.weight_grams || 0)).filter((value) => value > 0);
    const minimumPrice = prices.length ? Math.min(...prices) : 0;
    const maximumPrice = prices.length ? Math.max(...prices) : 0;
    const priceText = prices.length
      ? `${formatBookingCurrency(minimumPrice)}${maximumPrice !== minimumPrice ? ` a ${formatBookingCurrency(maximumPrice)}` : ""}`
      : "valor sob consulta";
    const minimumDuration = durations.length ? Math.min(...durations) : 0;
    const maximumDuration = durations.length ? Math.max(...durations) : 0;
    const durationText = durations.length
      ? `${minimumDuration}${maximumDuration !== minimumDuration ? ` a ${maximumDuration}` : ""} min`
      : "sob consulta";
    const optionDetails = [
      lengths.length ? `comprimentos ${lengths.join(" ou ")}` : "",
      weights.length ? `pesos ${Math.min(...weights)}${Math.max(...weights) !== Math.min(...weights) ? ` a ${Math.max(...weights)}` : ""} g` : "",
    ].filter(Boolean).join(", ");
    return `- ${service.name}: ${priceText}; duração ${durationText}; ${variants.length} opção(ões)${optionDetails ? ` (${optionDetails})` : ""}. ${service.description || ""}`.trim();
  });
  const plans = (base.plans || [])
    .filter((plan) => plan.active)
    .slice(0, 8)
    .map((plan) => `- ${plan.name}: R$ ${Number(plan.price || 0).toFixed(2)} (${plan.billing_cycle || "ciclo não informado"}).`);
  const coupons = (base.coupons || [])
    .filter((coupon) => coupon.active)
    .slice(0, 8)
    .map((coupon) => `- ${coupon.code}: ${coupon.description || "cupom ativo sem descrição"}.`);
  const promotions = activePromotions(base)
    .slice(0, 8)
    .map((promotion) => {
      const promo = formatBookingCurrency(promotion.promotional_value);
      const original = Number(promotion.original_value || 0);
      const originalText = original > 0 ? `de ${formatBookingCurrency(original)} por ${promo}` : promo;
      const keywords = arrayFromJsonLike(promotion.keywords).join(", ");
      return `- ${promotion.title}: ${originalText}. ${promotion.description || ""}${promotion.ends_at ? ` Valida ate ${promotion.ends_at}.` : ""}${keywords ? ` Palavras-chave: ${keywords}.` : ""}`;
    });
  const enabledFlows = (base.flows || [])
    .filter((flow) => flow.enabled)
    .map((flow) => flow.name || flow.flow_key)
    .slice(0, 12);
  const products = (base.products || [])
    .filter((item) => item.active !== false && Number(item.stock_quantity || 0) > 0)
    .slice(0, 15)
    .map((item) => {
      const price = Number(item.price || 0);
      const priceText = price > 0 ? `R$ ${price.toFixed(2)}` : "valor não cadastrado";
      return `- ${item.name} (${item.category || "produto"}): ${priceText}; disponibilidade: ${item.stock_quantity} unidades.`;
    });

  return [
    "Dados reais liberados para esta resposta:",
    services.length ? `Serviços ativos e variações comerciais:\n${services.join("\n")}` : "Serviços: nenhum serviço ativo cadastrado.",
    plans.length ? `Planos ativos:\n${plans.join("\n")}` : "Planos ativos: nenhum plano ativo encontrado.",
    coupons.length ? `Cupons ativos:\n${coupons.join("\n")}` : "Cupons ativos: nenhum cupom ativo encontrado.",
    promotions.length ? `Promocoes ativas para WhatsApp:\n${promotions.join("\n")}` : "Promocoes ativas para WhatsApp: nenhuma promocao ativa cadastrada.",
    products.length ? `Produtos e acessórios ativos:\n${products.join("\n")}` : "Produtos e acessórios: nenhum item ativo em estoque no momento.",
    enabledFlows.length
      ? `Fluxos automáticos habilitados: ${enabledFlows.join(", ")}.`
      : "Fluxos automáticos: nenhum fluxo específico habilitado.",
    settings.allowAutoBooking
      ? "Pré-agendamento automático está permitido, mas exige dados completos e confirmação explícita antes de qualquer gravação."
      : "A IA pode conduzir e registrar uma solicitação de pré-agendamento; a equipe confirma disponibilidade e horário.",
    "Catálogo: a existência de um serviço é determinada pelos serviços ativos e suas variações comerciais, nunca pelo estoque físico. Para serviços com cabelo ou fibra inclusa, informe que a disponibilidade do material é confirmada por uma profissional após a avaliação. Nunca diga que o salão não oferece um serviço apenas porque não há item de estoque.",
    "Fibra Russa: é o nome comercial de uma fibra sintética oferecida nos combos ativos. Quando a pergunta não definir o método, apresente as opções cadastradas e pergunte se a cliente prefere Fita Adesiva, Ponto Americano Invisível, Entrelace ou Microcápsula de Queratina.",
    "Promocoes: nunca trate promocao como servico. Quando a cliente perguntar por desconto, oferta, promocao ou valor de um servico com promocao relacionada, use somente as promocoes ativas listadas acima.",
    "Nunca prometa horário, pagamento ou agendamento confirmado sem uma gravação bem-sucedida no backend.",
  ].join("\n\n");
}

export function buildBookingGuidance({
  incomingText,
  history = [],
  knownClient = false,
  settings = {},
  currentState = {},
}) {
  const isChangingSubject = isClientChangingSubjectOrNegating(incomingText);
  if (isChangingSubject) {
    return { active: false, shouldRegister: false, text: "" };
  }

  const hasQuestion = isClientAskingQuestion(incomingText) ||
                      isReplyingToExplanationOffer(incomingText, history);

  if (hasQuestion && currentState && isActiveBookingState(currentState)) {
    const serviceName = currentState.serviceName || "Mega Hair";
    const dateText = currentState.date ? `para o dia ${formatDateLabel(currentState.date)}` : "";
    const savedFields = [
      currentState.serviceName ? `servico=${currentState.serviceName}` : "",
      currentState.date ? `data=${currentState.date}` : "",
      currentState.time ? `horario=${currentState.time}` : "",
      currentState.clientName ? `nome=${currentState.clientName}` : "",
      currentState.clientEmail ? `email=${currentState.clientEmail}` : "",
      currentState.clientPhone ? `telefone=${currentState.clientPhone}` : "",
      currentState.clientCpf ? `cpf=${currentState.clientCpf}` : "",
      currentState.clientBirthDate ? `nascimento=${currentState.clientBirthDate}` : "",
    ].filter(Boolean).join("; ");
    const missing = [];
    if (!currentState.time) missing.push("horario");
    missing.push(...missingBookingContactFields(currentState));
    const nextStep = missing[0] || "confirmacao do resumo";
    return {
      active: true,
      shouldRegister: false,
      text: `Existe um fluxo de pre-agendamento em andamento. Servico selecionado: ${serviceName} ${dateText}. Campos ja salvos: ${savedFields || "nenhum"}. Proximo campo faltante: ${nextStep}. Responda somente a pergunta atual da cliente, mantenha todos os campos salvos e nunca pergunte novamente campo preenchido. Nao repita o menu nem a pergunta pendente: o backend informara como a cliente pode retomar a etapa depois da resposta.`,
      resumeText: bookingInformationPauseNotice(currentState),
    };
  }

  if (hasQuestion) {
    return { active: false, shouldRegister: false, text: "" };
  }

  const normalizedCurrent = normalizeText(incomingText);
  const bookingTerms = [
    "agendar",
    "agendamento",
    "marcar horario",
    "marcar um horario",
    "quero fazer",
    "gostaria de fazer",
    "tem horario",
    "disponibilidade",
    "encaixe",
    "avaliacao",
  ];
  const currentHasIntent = includesAny(normalizedCurrent, bookingTerms);
  const recentAssistantText = history
    .filter((item) => item.sender_type === "ai")
    .slice(-2)
    .map((item) => normalizeText(item.body))
    .join(" ");
  const assistantIsBooking = includesAny(recentAssistantText, [
    "agend",
    "qual servico",
    "qual dia",
    "qual data",
    "manha, tarde ou noite",
    "periodo",
    "posso encaminhar",
    "posso registrar",
    "confirma",
  ]);
  const assistantAskedConfirmation = includesAny(recentAssistantText, [
    "confirma",
    "posso encaminhar",
    "posso registrar",
    "esta correto",
    "está correto",
  ]);
  const active = currentHasIntent || assistantIsBooking;
  const shouldRegister =
    active && assistantAskedConfirmation && isAffirmativeBookingConfirmation(incomingText);

  if (!active) return { active: false, shouldRegister: false, text: "" };

  const mode = settings.allowAutoBooking
    ? "O pré-agendamento está habilitado, mas qualquer confirmação depende de persistência real."
    : "O horário final será confirmado pela equipe; registre somente uma solicitação de pré-agendamento.";
  const nextAction = shouldRegister
    ? "A confirmação explícita foi detectada. O backend registrará a solicitação antes do envio da resposta. Informe que a solicitação foi registrada e que a equipe confirmará a disponibilidade; não diga que o horário já está confirmado."
    : [
        "Avance o atendimento sem repetir explicações ou perguntas já respondidas.",
        "Identifique no histórico o que a cliente já informou e pergunte somente UM dado faltante por mensagem, nesta ordem: serviço desejado, data preferida, período/horário, nome completo, e-mail e telefone. Sempre inclua o valor real/inicial do serviço quando o serviço estiver definido.",
        "Quando todos os dados estiverem claros, mostre um resumo curto e peça confirmação explícita para registrar a solicitação.",
      ].join(" ");

  return {
    active: true,
    shouldRegister,
    text: `Fluxo de pré-agendamento ativo. ${mode} Cliente cadastrada: ${knownClient ? "sim" : "não"}. ${nextAction}`,
  };
}

export function buildAiConversationMessage({
  incomingText,
  history = [],
  commercialContext,
  knowledgeContext = "",
  bookingGuidance = "",
  knownClient = false,
  contextualReference = {},
}) {
  const historyText = history
    .slice(-6)
    .map((item) => {
      const speaker = item.sender_type === "ai" ? "Assistente" : "Cliente";
      return `${speaker}: ${clean(item.body).slice(0, 350)}`;
    })
    .join("\n");

  const historyBlock = historyText
    ? `Histórico recente:\n${historyText}`
    : "Histórico recente: primeira mensagem desta conversa.";

  const requiredContext = [
    `Mensagem atual da cliente:\n${clean(incomingText)}`,
    contextualReference?.resolvedFromHistory && contextualReference?.topicLabel
      ? `CONTEXTO RESOLVIDO PELO BACKEND: a mensagem atual se refere a "${contextualReference.topicLabel}". Responda usando esse assunto sem pedir que a cliente o repita.`
      : contextualReference?.confidence === "ambiguous"
        ? "MENSAGEM AMBÍGUA: forneça primeiro uma explicação geral útil dentro do contexto do salão e faça somente uma pergunta curta para identificar o procedimento. Não classifique a mensagem como assunto externo."
        : "",
    bookingGuidance,
    historyBlock,
    history && history.length > 0
      ? "ATENÇÃO MÁXIMA: Esta NÃO é a primeira mensagem da conversa. Já existe histórico recente. NUNCA repita saudações, boas-vindas ou apresentações. Vá direto à dúvida/assunto da cliente de forma curta e objetiva."
      : "",
    "REGRA DE CONVERSA NATURAL: durante agendamento, aceite respostas livres como hoje a tarde, depois do almoco, perto das 12, amiga consegue mais tarde, esse horario nao da e pode ser amanha cedo. Converta isso em data/periodo/horario e nao peca novamente dados ja salvos na sessao.",
    "REGRA DE VALORES: preenchimento de pontas, alongamento parcial, volume, correcao de comprimento e reposicao de mechas sao assuntos do salao. Se nao houver preco exato cadastrado, diga que depende da quantidade de cabelo e da tecnica, e ofereca explicacao ou avaliacao.",
    "A mensagem atual é a prioridade. Use o histórico apenas para continuidade; se a cliente mudar de assunto, responda ao novo assunto sem repetir o serviço anterior. Não presuma que a dúvida é sobre Fibra Russa quando a mensagem atual não mencionar esse material nem for uma continuação inequívoca dele.",
    "REGRA DE PAPÉIS: você representa o salão e conversa com a cliente. Nunca devolva a pergunta como se a cliente fosse o salão (por exemplo, nunca responda 'Você trabalha com...'). Quando o catálogo confirmar um serviço, responda diretamente 'Sim, trabalhamos com...'.",
    "REGRA DE TERMINOLOGIA: Fibra Russa é um material sintético, não uma técnica. Os métodos de colocação são Fita Adesiva, Ponto Americano Invisível, Entrelace e Microcápsula de Queratina, conforme opções ativas do catálogo.",
    "REGRA DE RESPOSTA ÚTIL: responda o que já for possível antes de pedir esclarecimento e faça no máximo uma pergunta por mensagem. Nunca ofereça catálogo e agendamento na mesma pergunta; apresente uma única decisão por vez.",
    "Responda em até 700 caracteres, em português do Brasil, sem inventar dados. Não repita uma pergunta cuja resposta já esteja no histórico. Se a cliente quiser agendar, avance pelo fluxo de pré-agendamento. Nunca diga que um horário foi confirmado sem persistência real no backend.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const optionalContext = [
    clean(commercialContext).slice(0, 3600),
    clean(knowledgeContext).slice(0, 1300),
    `Cliente já cadastrada: ${knownClient ? "sim" : "não"}.`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const optionalBudget = Math.max(0, MAX_AI_MESSAGE_CHARS - requiredContext.length - 4);
  return `${optionalContext.slice(0, optionalBudget)}\n\n${requiredContext}`.trim();
}

async function saveDialogueState(conversationId, state) {
  await query(
    `update public.whatsapp_conversations
        set dialogue_state=$2, updated_at=now()
      where id=$1`,
    [conversationId, JSON.stringify(parseJsonObject(state))],
  );
}

export function enforceAiResponseQuality({
  response,
  incomingText = "",
  history = [],
  base = {},
  contextualReference = {},
} = {}) {
  let result = clean(response);
  if (!result) return "";

  const hasPriorAiReply = (history || []).some((item) =>
    item?.sender_type === "ai" && clean(item?.body),
  );
  if (hasPriorAiReply) {
    result = result.replace(
      /^(?:ol[aá]|oi|bom dia|boa tarde|boa noite)[!,.?:;\s-]*/i,
      "",
    ).trim();
  }

  const normalizedInput = normalizeText(incomingText);
  const normalizedResponse = normalizeText(result);
  const asksRussianFiberAvailability = normalizedInput.includes("fibra russa") &&
    includesAny(normalizedInput, ["trabalha", "trabalham", "oferece", "oferecem", "tem fibra"]);
  const activeRussianFiberService = (base.services || []).some((service) =>
    service.active !== false && serviceSearchText(service).includes("fibra russa"),
  );
  const invertedRoles = normalizedResponse.includes("voce trabalha com fibra russa") ||
    (asksRussianFiberAvailability && normalizedResponse.includes("se sim"));
  const contradictsCatalog = activeRussianFiberService && normalizedInput.includes("fibra russa") &&
    includesAny(normalizedResponse, [
      "nao trabalhamos com fibra russa",
      "nao oferecemos fibra russa",
      "nao temos fibra russa",
      "fibra russa nao esta disponivel",
    ]);
  if (invertedRoles || contradictsCatalog) {
    return buildServiceAvailabilityIntentResponse(incomingText, base) || result;
  }

  if (
    contextualReference?.material === "Fibra Russa" &&
    /\b(?:a|essa)\s+t[eé]cnica\s+(?:de|da|chamada)?\s*fibra\s+russa\b/i.test(result)
  ) {
    result = result.replace(
      /\b(?:a|essa)\s+t[eé]cnica\s+(?:de|da|chamada)?\s*fibra\s+russa\b/gi,
      "o material Fibra Russa",
    );
  }
  return result;
}

async function recordInboundMessage(normalized) {
  await ensureAiWhatsappSchema();
  return transaction(async (client) => {
    const session = await client.query(
      "select id,professional_id from public.whatsapp_sessions where session_name=$1 limit 1",
      [normalized.sessionName],
    );
    let foundClient = await findClientByPhone(client, normalized.phoneNumber);
    const existing = await client.query(
      `select *
         from public.whatsapp_conversations
        where phone_number=$1
        order by updated_at desc
        limit 1`,
      [normalized.phoneNumber],
    );
    const conversation =
      existing.rows[0] ||
      (
        await client.query(
          `insert into public.whatsapp_conversations(
            client_id,phone_number,professional_id,session_id,status,ai_enabled,session_started_at,last_message_at,last_message_preview,origin
          ) values($1,$2,$3,$4,'ai',true,now(),now(),$5,'whatsapp_ai')
          returning *`,
          [
            foundClient?.id || null,
            normalized.phoneNumber,
            session.rows[0]?.professional_id || null,
            session.rows[0]?.id || null,
            normalized.text.slice(0, 240),
          ],
        )
      ).rows[0];

    if (!foundClient && conversation.client_id) {
      foundClient = await findClientById(client, conversation.client_id);
    }

    const { rows: messageRows } = await client.query(
      `insert into public.whatsapp_messages(
        conversation_id,provider_message_id,direction,sender_type,body,payload
      ) values($1,$2,'inbound','client',$3,$4)
      returning *`,
      [
        conversation.id,
        normalized.messageId,
        normalized.text,
        JSON.stringify(prunePayload(normalized.raw)),
      ],
    );
    await client.query(
      `update public.whatsapp_conversations
          set client_id=coalesce(client_id,$2),
              session_id=coalesce(session_id,$3),
              professional_id=coalesce(professional_id,$4),
              last_message_at=now(),
              last_message_preview=$5,
              updated_at=now()
        where id=$1`,
      [
        conversation.id,
        foundClient?.id || null,
        session.rows[0]?.id || null,
        session.rows[0]?.professional_id || null,
        normalized.text.slice(0, 240),
      ],
    );
    await logMessage(client, {
      conversationId: conversation.id,
      messageId: messageRows?.[0]?.id || null,
      eventType: "inbound_received",
      status: "success",
      details: { from: normalized.from, hasText: Boolean(normalized.text) },
    });
    return {
      conversation: { ...conversation, client_id: conversation.client_id || foundClient?.id || null },
      message: messageRows[0],
      client: foundClient,
    };
  });
}

async function recordOutboundAiMessage({
  conversationId,
  providerMessageId,
  text,
  payload = {},
  pendingDialogueAction = null,
}) {
  return transaction(async (client) => {
    const { rows } = await client.query(
      `insert into public.whatsapp_messages(
        conversation_id,provider_message_id,direction,sender_type,body,payload
      ) values($1,$2,'outbound','ai',$3,$4)
      returning *`,
      [conversationId, providerMessageId || null, text, JSON.stringify(prunePayload(payload))],
    );
    if (providerMessageId) {
      await client.query(
        `insert into public.whatsapp_outbox_ids(conversation_id, provider_message_id)
         values($1, $2) on conflict do nothing`,
        [conversationId, providerMessageId],
      ).catch(() => null);
    }
    const dialogueState = pendingDialogueAction
      ? {
          pendingAction: {
            ...pendingDialogueAction,
            sourceMessageId: rows[0].id,
          },
        }
      : null;
    if (dialogueState) {
      await client.query(
        `update public.whatsapp_conversations
            set last_message_at=now(),last_message_preview=$2,dialogue_state=$3,updated_at=now()
          where id=$1`,
        [conversationId, text.slice(0, 240), JSON.stringify(dialogueState)],
      );
    } else {
      await client.query(
        `update public.whatsapp_conversations
            set last_message_at=now(),last_message_preview=$2,updated_at=now()
          where id=$1`,
        [conversationId, text.slice(0, 240)],
      );
    }
    await logMessage(client, {
      conversationId,
      messageId: rows[0].id,
      eventType: "outbound_sent",
      status: "success",
      details: { providerMessageId },
    });
    return rows[0];
  });
}

async function recordAiInteraction({ conversationId, messageId, model, inputSummary, outputSummary, status, errorMessage = null, usage = null }) {
  await query(
    `insert into public.ai_interactions(
      conversation_id,message_id,model,input_summary,output_summary,tool_calls,status,error_message
    ) values($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      conversationId,
      messageId,
      model || null,
      clean(inputSummary).slice(0, 1000),
      clean(outputSummary).slice(0, 1000),
      JSON.stringify(usage ? [{ tool: "ai_provider", usage }] : []),
      status,
      errorMessage,
    ],
  );
}

async function performSendTextAndRecord({ normalized, conversationId, text, reason }) {
  const prepared = prepareAssistantDialogueResponse(text);
  const finalText = withBookingFlowHelp(prepared.text, reason);
  const result = await sendBaileysTextMessage({
    number: normalized.phoneNumber,
    text: finalText,
    skipStatusCheck: true,
  });
  const sent = await recordOutboundAiMessage({
    conversationId,
    providerMessageId: result.data?.messageId || null,
    text: finalText,
    payload: { reason, provider: result.data, pendingAction: prepared.pendingAction },
    pendingDialogueAction: prepared.pendingAction,
  });
  return { sent, provider: result.data };
}

export async function sendTextAndRecord(args) {
  return performSendTextAndRecord(args);
}

async function requestHumanAttention({ conversationId, messageId, reason, responseText, pauseAi = false }) {
  await transaction(async (client) => {
    if (pauseAi) {
      await client.query(
        `update public.whatsapp_conversations
            set status='human', ai_enabled=false, human_takeover_at=now(), updated_at=now()
          where id=$1`,
        [conversationId],
      );
    }
    await client.query(
      `insert into public.human_handoff_tickets(conversation_id,reason,status,created_by)
       select $1,$2,'pending',null
        where not exists (
          select 1
            from public.human_handoff_tickets
           where conversation_id=$1
             and reason=$2
             and status='pending'
        )`,
      [conversationId, reason],
    );
    await logMessage(client, {
      conversationId,
      messageId,
      eventType: pauseAi ? "conversation_paused_for_human" : "human_attention_requested",
      status: "warning",
      details: { reason, responseText, action: pauseAi ? "pause_ai" : "keep_ai_enabled" },
    });
  });
}

export async function getAgendaAvailabilityContext(client, text, base, state) {
  const normalized = normalizeText(text);
  const wantsAgenda = includesAny(normalized, [
    "horario", "horário", "agenda", "disponivel", "disponível", "disponibilidade", "vaga", "encaixe", "atende", "tem hora"
  ]);
  if (!wantsAgenda) return "";

  let serviceId = state.serviceId;
  if (!serviceId) {
    const bookable = bookableAiServices(base);
    const evaluation = findEvaluationService(bookable);
    if (evaluation) serviceId = evaluation.id;
  }
  if (!serviceId) return "";

  const today = localDateParts();
  let parsedDate = parseBookingDateFromText(text, state);
  if (!parsedDate) {
    parsedDate = today;
  }

  try {
    const datesToQuery = [parsedDate];
    if (!parseBookingDateFromText(text, state)) {
      datesToQuery.push(addLocalDays(today, 1));
    }

    const allSlots = [];
    for (const d of datesToQuery) {
      const { slots } = await availableBookingSlots(client, { serviceId, date: d });
      allSlots.push(...slots);
    }

    if (allSlots.length === 0) {
      return `CONSULTA DE AGENDA REAL para a data ${parsedDate}: NÃO existem horários disponíveis nesta data. Informe à cliente que não há vagas para esta data e ofereça para verificar a próxima data disponível.`;
    }

    const slotLines = allSlots.map(s => `- ${formatDateLabel(s.date)} às ${s.time} com ${s.professionalName}`).join("\n");
    return `CONSULTA DE AGENDA REAL:\nHorários disponíveis encontrados para agendamento:\n${slotLines}\n\nInstrução: Se a cliente perguntou sobre disponibilidade/vagas, responda diretamente listando estes horários reais disponíveis de forma natural e pergunte qual ela prefere. Não exiba menu de serviços.`;
  } catch (err) {
    console.error("Failed to query agenda for prompt injection:", err.message);
    return "";
  }
}

export function buildLocalIntentResponse(text, base = {}, context = {}) {
  const normalized = normalizeText(text);
  if (!normalized) return null;

  const availabilityResponse = buildServiceAvailabilityIntentResponse(text, base);
  if (availabilityResponse) return availabilityResponse;

  const procedureResponse = buildContextualProcedureResponse(text, base, context);
  if (procedureResponse) return procedureResponse;

  const asksPromotion = includesAny(normalized, [
    "promocao",
    "promocoes",
    "promocional",
    "desconto",
    "descontos",
    "oferta",
    "ofertas",
    "campanha",
    "liquidacao",
    "preco promocional",
    "cabelo em promocao",
    "mega hair em promocao",
    "promo",
  ]);
  const asksPrice = includesAny(normalized, [
    "quanto custa",
    "quanto esta",
    "qual valor",
    "valor",
    "preco",
    "custa",
    "fica",
  ]);

  if (asksPromotion) return buildPromotionIntentResponse(text, base);

  if (asksPrice) {
    const response = buildPriceIntentResponse(text, base);
    if (response) return response;
  }

  const asksTodayAvailability =
    includesAny(normalized, [
      "horario",
      "agenda",
      "disponivel",
      "disponibilidade",
      "vaga",
      "encaixe",
      "atende hoje",
      "tem hora",
    ]) &&
    includesAny(normalized, ["hoje", "hj", "agora", "ainda hoje"]);

  if (asksTodayAvailability) {
    return [
      "Consigo te ajudar com isso 😊",
      "Para horário de hoje, eu não vou prometer disponibilidade sem consultar a agenda real.",
      "Me diga qual serviço você quer fazer — aplicação, manutenção ou avaliação — e qual período fica melhor para você: manhã, tarde ou noite. A equipe confirma o encaixe certinho.",
    ].join("\n\n");
  }

  const catalogExplorationResponse = buildCatalogExplorationResponse(text, base);
  if (catalogExplorationResponse) return catalogExplorationResponse;

  const hairKnowledgeResponse = buildHairKnowledgeResponse(text, {
    offeredInCatalog: matchingServicesForCatalogQuery(text, base).length > 0,
  });
  if (hairKnowledgeResponse) return hairKnowledgeResponse;

  return null;
}

async function loadQueuedConversation(conversationId) {
  const { rows } = await query(
    `select * from public.whatsapp_conversations where id=$1 limit 1`,
    [conversationId],
  );
  const conversation = rows[0];
  if (!conversation) throw new Error("Conversa pendente não encontrada.");
  const latestMessage = await query(
    `select id from public.whatsapp_messages
      where conversation_id=$1 and direction='inbound'
      order by created_at desc limit 1`,
    [conversationId],
  );
  return {
    conversation,
    message: latestMessage.rows[0] || { id: null },
    client: conversation.client_id ? { id: conversation.client_id } : null,
  };
}

export function humanAutoResumeState(settings = {}, conversation = {}, now = new Date()) {
  const paused = conversation.ai_enabled === false ||
    String(conversation.status || "").toLowerCase() === "human";
  const enabled = settings.autoResumeAfterHumanEnabled !== false;
  const timeoutMinutes = Math.min(
    1440,
    Math.max(1, Number(settings.humanResponseTimeoutMinutes || 15)),
  );
  const takeoverAt = conversation.human_takeover_at
    ? new Date(conversation.human_takeover_at)
    : null;
  const validTakeover = takeoverAt && Number.isFinite(takeoverAt.getTime());
  const dueAt = validTakeover
    ? new Date(takeoverAt.getTime() + timeoutMinutes * 60_000)
    : null;
  return {
    paused,
    enabled,
    timeoutMinutes,
    dueAt,
    due: Boolean(paused && enabled && dueAt && dueAt.getTime() <= now.getTime()),
  };
}

function getRetryDelay(retryCount) {
  const jitter = Math.random() * 500; // 0 to 500ms
  if (retryCount === 1) {
    return 1000 + Math.random() * 1000 + jitter; // 1-2s + jitter
  }
  if (retryCount === 2) {
    return 3000 + Math.random() * 2000 + jitter; // 3-5s + jitter
  }
  return 1000 + jitter;
}

async function logAiRequest({
  conversationId,
  messageId,
  provider,
  model,
  status,
  retryCount,
  fallbackUsed,
  queueLatencyMs,
  providerLatencyMs,
  totalLatencyMs,
  inputTokens,
  outputTokens,
  errorCode,
  errorMessage,
}) {
  await query(
    `insert into public.ai_request_logs(
      conversation_id, message_id, provider, model, status, retry_count, fallback_used,
      queue_latency_ms, provider_latency_ms, total_latency_ms,
      input_tokens_estimated, output_tokens_estimated, error_code, error_message
    ) values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      conversationId || null,
      messageId || null,
      provider || null,
      model || null,
      status || null,
      retryCount || 0,
      fallbackUsed || false,
      queueLatencyMs || null,
      providerLatencyMs || null,
      totalLatencyMs || null,
      inputTokens || null,
      outputTokens || null,
      errorCode ? String(errorCode) : null,
      errorMessage ? String(errorMessage).slice(0, 1000) : null,
    ],
  ).catch((err) => console.error("Failed to insert into ai_request_logs", err));
}

export function findMatchingArticle(text, articles) {
  const normalizedInput = normalizeText(text);
  if (!normalizedInput) return null;

  for (const article of articles) {
    if (article.status !== "active") continue;
    const normalizedTitle = normalizeText(article.title);
    if (normalizedInput.includes(normalizedTitle)) {
      return article;
    }
    const variations = Array.isArray(article.question_variations)
      ? article.question_variations
      : JSON.parse(article.question_variations || "[]");
    for (const variation of variations) {
      const normalizedVariation = normalizeText(variation);
      if (normalizedInput.includes(normalizedVariation)) {
        return article;
      }
    }
  }
  return null;
}

export function classifyInboundMessage(text, matchedArticle) {
  const normalized = normalizeText(text);

  // Severe symptoms keywords (Nível 4)
  const isSevere = normalized.includes("dor") ||
                   normalized.includes("ferida") ||
                   normalized.includes("irritac") ||
                   normalized.includes("coceira") ||
                   normalized.includes("cocando") ||
                   normalized.includes("doendo") ||
                   normalized.includes("queda intensa") ||
                   normalized.includes("caindo muito") ||
                   normalized.includes("quebrando") ||
                   normalized.includes("quebra") ||
                   normalized.includes("dano") ||
                   normalized.includes("estragou") ||
                   normalized.includes("reembolso") ||
                   normalized.includes("processo") ||
                   normalized.includes("urgente") ||
                   normalized.includes("ruim");

  if (isSevere || (matchedArticle && (matchedArticle.requires_human_handoff || matchedArticle.medical_safety_level === "alert"))) {
    return 4; // Nível 4
  }

  // Moderate warnings or specific evaluation indicators (Nível 3)
  const isEvaluationNeeded = normalized.includes("muito curto") ||
                             normalized.includes("extremamente fino") ||
                             normalized.includes("descoloracao recente") ||
                             normalized.includes("quimica recente") ||
                             normalized.includes("cabelo quebrado") ||
                             normalized.includes("caindo") ||
                             normalized.includes("quantidade de mechas") ||
                             normalized.includes("quantas mechas") ||
                             normalized.includes("outro salao") ||
                             normalized.includes("corrigir");

  if (isEvaluationNeeded || (matchedArticle && matchedArticle.requires_evaluation)) {
    return 3; // Nível 3
  }

  // Triagem indicators (Nível 2)
  const isTriagemNeeded = normalized.includes("melhor tecnica") ||
                          normalized.includes("melhor metodo") ||
                          normalized.includes("cabelo curto") ||
                          normalized.includes("cabelo fino") ||
                          normalized.includes("quimica") ||
                          normalized.includes("progressiva") ||
                          normalized.includes("loiro") ||
                          normalized.includes("descolorido") ||
                          normalized.includes("quanto custa") ||
                          normalized.includes("preco") ||
                          normalized.includes("valor") ||
                          normalized.includes("orcamento") ||
                          normalized.includes("alongar") ||
                          normalized.includes("volume") ||
                          normalized.includes("combina comigo");

  if (isTriagemNeeded || (matchedArticle && matchedArticle.category === "Métodos de Mega Hair")) {
    return 2; // Nível 2
  }

  return 1; // Nível 1
}

export async function processIncomingWhatsAppWebhook(payload = {}, runtime = {}) {
  const receivedAt = new Date();
  const normalized = normalizeIncomingWhatsappPayload(payload);

  if (normalized.isGroup || normalized.isStatus) {
    await recordIgnoredWebhook(normalized, "unsupported_chat");
    return { ignored: true, reason: "unsupported_chat" };
  }
  if (normalized.isFromMe) {
    await ensureAiWhatsappSchema();
    let isBotEcho = false;
    if (normalized.messageId && !normalized.messageId.startsWith("tmp-")) {
      const echoCheck = await query(
        `select 1 from public.whatsapp_outbox_ids where provider_message_id = $1 limit 1`,
        [normalized.messageId],
      );
      if (echoCheck.rowCount > 0) {
        isBotEcho = true;
      }
    }
    if (isBotEcho) {
      await recordIgnoredWebhook(normalized, "bot_outbound_echo_ignored");
      return { ignored: true, reason: "bot_outbound_echo_ignored" };
    }

    if (normalized.phoneNumber && /^55\d{10,11}$/.test(normalized.phoneNumber)) {
      const recordedHuman = await recordInboundMessage(normalized);
      await query(
        `update public.whatsapp_conversations
            set status='human', ai_enabled=false, human_takeover_at=now(), updated_at=now()
          where phone_number=$1`,
        [normalized.phoneNumber],
      );
      await query(
        `insert into public.whatsapp_message_logs(conversation_id,message_id,event_type,status,details)
         values($1,$2,'human_message_recorded','info',$3)`,
        [
          recordedHuman.conversation.id,
          recordedHuman.message.id,
          JSON.stringify({ reason: "human_takeover_from_me", text: normalized.text }),
        ],
      ).catch(() => null);
      return { ok: true, ignored: true, reason: "human_message_recorded", conversationId: recordedHuman.conversation.id };
    }

    await recordIgnoredWebhook(normalized, "from_me");
    return { ignored: true, reason: "from_me" };
  }
  if (!normalized.phoneNumber || !/^55\d{10,11}$/.test(normalized.phoneNumber)) {
    await recordIgnoredWebhook(normalized, "invalid_phone");
    return { ignored: true, reason: "invalid_phone" };
  }
  if (!normalized.text) {
    await recordIgnoredWebhook(normalized, "empty_text");
    return { ignored: true, reason: "empty_text" };
  }

  await ensureAiWhatsappSchema();

  // 1. Idempotency Check
  // Quando messageId existe (e não é temporário): checar de forma eficiente.
  // Quando messageId é temporário (sem ID da Evolution): usar fingerprint de
  // phone + text + janela de 30s.
  let isDuplicate;
  if (normalized.messageId && !normalized.messageId.startsWith("tmp-")) {
    isDuplicate = await query(
      `select 1 from public.whatsapp_incoming_queue where message_id = $1
       union
       select 1 from public.whatsapp_messages where provider_message_id = $1
       limit 1`,
      [normalized.messageId],
    );
  } else {
    // Sem messageId real: checar se já existe mensagem idêntica do mesmo número
    // nos últimos 30 segundos na fila (evita loop por retry do webhook).
    isDuplicate = await query(
      `select 1 from public.whatsapp_incoming_queue
        where phone_number = $1
          and text = $2
          and message_id like 'tmp-%'
          and created_at >= now() - interval '30 seconds'
        limit 1`,
      [normalized.phoneNumber, normalized.text],
    );
  }
  if (isDuplicate.rowCount > 0) {
    await recordIgnoredWebhook(normalized, "duplicate_message");
    return { ignored: true, reason: "duplicate_message" };
  }

  // 2. Record Inbound message (history) and insert to incoming queue
  const queuedResume = runtime.queuedResume === true && runtime.conversationId;
  const recorded = queuedResume
    ? await loadQueuedConversation(runtime.conversationId)
    : await recordInboundMessage(normalized);
  const settings = await getAiSettings();
  const base = await getAiCommercialBase();
  const conversationId = recorded.conversation.id;
  const inboundMessageId = recorded.message.id;

  if (!queuedResume) {
    await query(
      `insert into public.whatsapp_incoming_queue(phone_number, message_id, text)
       values($1, $2, $3)`,
      [normalized.phoneNumber, normalized.messageId, normalized.text],
    );
  }

  const autoResume = humanAutoResumeState(settings, recorded.conversation, receivedAt);
  if (autoResume.paused && autoResume.enabled && autoResume.dueAt) {
    if (!autoResume.due) {
      await query(
        `insert into public.whatsapp_message_logs(conversation_id,message_id,event_type,status,details)
         values($1,$2,'ai_waiting_human_timeout','info',$3)`,
        [
          conversationId,
          inboundMessageId,
          JSON.stringify({
            dueAt: autoResume.dueAt?.toISOString() || null,
            timeoutMinutes: autoResume.timeoutMinutes,
          }),
        ],
      ).catch(() => null);
      return {
        ok: true,
        replied: false,
        reason: "waiting_human_timeout",
        conversationId,
        resumeAt: autoResume.dueAt?.toISOString() || null,
      };
    }
    await query(
      `update public.whatsapp_conversations
          set status='ai',ai_enabled=true,assigned_to=null,human_takeover_at=null,
              session_started_at=now(),updated_at=now()
        where id=$1`,
      [conversationId],
    );
    await query(
      `update public.human_handoff_tickets
          set status='closed',resolved_at=coalesce(resolved_at,now()),updated_at=now()
        where conversation_id=$1 and status in ('pending','open')`,
      [conversationId],
    ).catch(() => null);
    recorded.conversation.status = "ai";
    recorded.conversation.ai_enabled = true;
    recorded.conversation.human_takeover_at = null;
  }

  // 3. Typing Presence Composer
  await sendBaileysPresence({ number: normalized.phoneNumber, presence: "composing" });

  // 4. Sleep for the grouping window
  const windowMs = settings.groupingWindowMs || 1500;
  await delay(windowMs);

  // 5. Open Transaction and Lock conversation
  const processResult = await transaction(async (client) => {
    // Row lock the conversation to ensure sequential execution per conversation
    await client.query(
      "select id from public.whatsapp_conversations where id = $1 for update",
      [conversationId],
    );

    // Fetch unprocessed messages from queue
    const pending = await client.query(
      `select * from public.whatsapp_incoming_queue
       where phone_number = $1 and processed = false
       order by created_at asc
       for update`,
      [normalized.phoneNumber],
    );
    if (pending.rowCount === 0) {
      return { alreadyProcessed: true };
    }

    const texts = pending.rows.map((row) => String(row.text).trim());
    const concatenatedText = texts.join(" ");

    const pendingIds = pending.rows.map((row) => row.id);
    await client.query(
      `update public.whatsapp_incoming_queue
       set processed = true, processed_at = now()
       where id = any($1::uuid[])`,
      [pendingIds],
    );

    return {
      alreadyProcessed: false,
      concatenatedText,
    };
  });

  if (processResult.alreadyProcessed) {
    // Pause typing indicator and exit
    await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
    return { ok: true, ignored: true, reason: "already_processed_in_batch" };
  }

  const concatenatedText = processResult.concatenatedText;
  const processingStartedAt = new Date();
  const queueLatencyMs = processingStartedAt.getTime() - receivedAt.getTime();

  const globalBookingCommand = detectBookingGlobalCommand(concatenatedText) ||
    (isServiceCatalogMenuIntent(concatenatedText) ? "main_menu" : "");
  if (globalBookingCommand) {
    await saveDialogueState(conversationId, {});
    return handleBookingGlobalCommand({
      command: globalBookingCommand,
      normalized,
      conversationId,
      inboundMessageId,
      settings,
      base,
      recorded,
    });
  }

  // 6. Keywords checkpoints
  if (keywordInText(concatenatedText, settings.resumeKeyword)) {
    await query(
      `update public.whatsapp_conversations
          set status='ai',ai_enabled=true,human_takeover_at=null,session_started_at=now(),updated_at=now()
        where id=$1`,
      [conversationId],
    );
    const responseText = settings.welcomeMessage;
    await sendTextAndRecord({ normalized, conversationId, text: responseText, reason: "resume_keyword" });
    await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
    return { ok: true, replied: true, reason: "resume_keyword", conversationId };
  }

  if (keywordInText(concatenatedText, settings.pauseKeyword)) {
    const responseText = settings.humanHandoffMessage;
    await requestHumanAttention({
      conversationId,
      messageId: inboundMessageId,
      reason: "pause_keyword",
      responseText,
    });
    await sendTextAndRecord({ normalized, conversationId, text: responseText, reason: "pause_keyword" });
    await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
    return { ok: true, replied: true, reason: "pause_keyword", conversationId };
  }

  if (keywordInText(concatenatedText, settings.stopKeyword)) {
    await query(
      `insert into public.whatsapp_message_logs(conversation_id,message_id,event_type,status,details)
       values($1,$2,'stop_keyword_received','info',$3)`,
      [
        conversationId,
        inboundMessageId,
        JSON.stringify({ reason: "stop_keyword", action: "keep_ai_enabled" }),
      ],
    );
    await sendTextAndRecord({ normalized, conversationId, text: settings.closingMessage, reason: "stop_keyword" });
    await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
    return { ok: true, replied: true, reason: "stop_keyword", conversationId };
  }

  if (!settings.enabled) {
    await query(
      `insert into public.whatsapp_message_logs(conversation_id,message_id,event_type,status,details)
       values($1,$2,'ai_skipped','info',$3)`,
      [conversationId, inboundMessageId, JSON.stringify({ reason: "settings_disabled" })],
    );
    await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
    return { ok: true, replied: false, reason: "settings_disabled", conversationId };
  }

  if (recorded.conversation.ai_enabled === false || String(recorded.conversation.status || "").toLowerCase() === "human") {
    await query(
      `insert into public.whatsapp_message_logs(conversation_id,message_id,event_type,status,details)
       values($1,$2,'ai_skipped','info',$3)`,
      [conversationId, inboundMessageId, JSON.stringify({ reason: "conversation_paused" })],
    );
    await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
    return { ok: true, replied: false, reason: "conversation_paused", conversationId };
  }

  if (!settings.allowNewContacts && !recorded.client) {
    await query(
      `insert into public.whatsapp_message_logs(conversation_id,message_id,event_type,status,details)
       values($1,$2,'ai_skipped','info',$3)`,
      [conversationId, inboundMessageId, JSON.stringify({ reason: "new_contacts_disabled" })],
    );
    await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
    return { ok: true, replied: false, reason: "new_contacts_disabled", conversationId };
  }

  if (!settings.allowExistingClients && recorded.client) {
    await query(
      `insert into public.whatsapp_message_logs(conversation_id,message_id,event_type,status,details)
       values($1,$2,'ai_skipped','info',$3)`,
      [conversationId, inboundMessageId, JSON.stringify({ reason: "existing_clients_disabled" })],
    );
    await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
    return { ok: true, replied: false, reason: "existing_clients_disabled", conversationId };
  }

  const maxIdleMinutes = settings.maxIdleMinutes || 30;
  let initialBookingState = parseJsonObject(recorded.conversation.booking_state);
  const lastMsgAt = recorded.conversation.last_message_at
    ? new Date(recorded.conversation.last_message_at)
    : (initialBookingState.updatedAt ? new Date(initialBookingState.updatedAt) : null);
  let idleExpired = false;
  if (lastMsgAt) {
    const idleDiffMinutes = (processingStartedAt.getTime() - lastMsgAt.getTime()) / (1000 * 60);
    if (idleDiffMinutes > maxIdleMinutes) {
      idleExpired = true;
      await saveBookingState(conversationId, {});
      recorded.conversation.booking_state = {};
      initialBookingState = {};
      await query(
        `insert into public.whatsapp_message_logs(conversation_id,message_id,event_type,status,details)
         values($1,$2,'conversation_idle_expired','info',$3)`,
        [conversationId, inboundMessageId, JSON.stringify({ idleDiffMinutes, maxIdleMinutes })],
      ).catch(() => null);
    }
  }
  if (!recorded.conversation.session_started_at || idleExpired) {
    await query(
      `update public.whatsapp_conversations
          set session_started_at=$2,updated_at=now()
        where id=$1`,
      [conversationId, processingStartedAt],
    );
    recorded.conversation.session_started_at = processingStartedAt;
  }

  const localGreetingResponse = buildLocalGreetingResponse(concatenatedText, {
    date: processingStartedAt,
    timezone: settings.timezone,
    salonName: settings.salonName,
  });
  const hasActiveInitialBookingState = isActiveBookingState(initialBookingState);
  const shouldResetBooking = Boolean(localGreetingResponse) &&
    !hasActiveInitialBookingState &&
    shouldResetBookingStateOnGreeting(concatenatedText, initialBookingState);
  if (shouldResetBooking) await saveBookingState(conversationId, {});

  if (localGreetingResponse) {
    const greetingState = hasActiveInitialBookingState ? initialBookingState : {};
    if (hasActiveInitialBookingState) {
      greetingState.informationPause = true;
      greetingState.updatedAt = new Date().toISOString();
      await saveBookingState(conversationId, greetingState);
    }
    const responseText = hasActiveInitialBookingState
      ? `${localGreetingResponse}\n\nSeu agendamento continua salvo. Quando quiser retomá-lo, envie “continuar”.`
      : localGreetingResponse;
    await sendTextAndRecord({
      normalized,
      conversationId,
      text: responseText,
      reason: "conversation_greeting",
    });
    await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
    return { ok: true, replied: true, reason: "conversation_greeting", conversationId };
  }

  if (!isWithinAiHours(settings)) {
    const responseText = settings.afterHoursMessage;
    await sendTextAndRecord({ normalized, conversationId, text: responseText, reason: "after_hours" });
    await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
    return { ok: true, replied: true, reason: "after_hours", conversationId };
  }

  const count = await query(
    `with latest_resume as (
       select max(created_at) as resumed_at
         from public.whatsapp_messages
        where conversation_id=$1
          and direction='inbound'
          and sender_type='client'
          and body is not null
          and lower(body) like '%' || lower($2) || '%'
     )
     select count(*)::int as total
       from public.whatsapp_messages wm
      where wm.conversation_id=$1
        and wm.direction='outbound'
        and wm.sender_type='ai'
        and coalesce(wm.payload->>'reason','') <> 'typing_placeholder'
        and wm.created_at >= coalesce(
          greatest(
            (select resumed_at from latest_resume),
            (select session_started_at from public.whatsapp_conversations where id=$1)
          ),
          (select created_at from public.whatsapp_conversations where id=$1),
          '-infinity'::timestamptz
        )`,
    [conversationId, settings.resumeKeyword],
  );
  if (Number(count.rows[0]?.total || 0) >= settings.maxAutoMessages) {
    const responseText =
      "Nossa conversa atingiu o limite desta etapa automática. Vou encaminhar para a equipe continuar com você por aqui, tudo bem? 😊";
    await query(
      `insert into public.whatsapp_message_logs(conversation_id,message_id,event_type,status,details)
       values($1,$2,'auto_message_limit_handoff','warning',$3)`,
      [
        conversationId,
        inboundMessageId,
        JSON.stringify({
          total: Number(count.rows[0]?.total || 0),
          limit: settings.maxAutoMessages,
          action: "reply_and_handoff",
        }),
      ],
    );
    await sendTextAndRecord({
      normalized,
      conversationId,
      text: responseText,
      reason: "auto_message_limit_handoff",
    });
    await requestHumanAttention({
      conversationId,
      messageId: inboundMessageId,
      reason: "auto_message_limit",
      responseText,
      pauseAi: true,
    });
    await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
    await logAiRequest({
      conversationId,
      messageId: inboundMessageId,
      provider: "local_control",
      model: "auto_message_limit",
      status: "human_handoff",
      retryCount: 0,
      fallbackUsed: false,
      queueLatencyMs,
      providerLatencyMs: 0,
      totalLatencyMs: Date.now() - receivedAt.getTime(),
    });
    return {
      ok: true,
      replied: true,
      reason: "auto_message_limit_handoff",
      conversationId,
    };
  }

  // 6.5. Safety/Medical Classification Check (Nível 4)
  const matchedArticle = findMatchingArticle(concatenatedText, base.knowledgeArticles || []);
  const safetyLevel = classifyInboundMessage(concatenatedText, matchedArticle);

  if (safetyLevel === 4) {
    const safetyText = matchedArticle?.full_answer ||
      "Se você percebe dor, coceira intensa, feridas, quebra acentuada ou queda importante, recomendamos pausar qualquer procedimento, evitar coçar a região e procurar uma profissional qualificada para avaliação física do couro cabeludo e, se necessário, um dermatologista. Sintomas inflamatórios requerem cuidados especializados.";

    await sendTextAndRecord({
      normalized,
      conversationId,
      text: safetyText,
      reason: "safety_alert",
    });

    await requestHumanAttention({
      conversationId,
      messageId: inboundMessageId,
      reason: "safety_alert",
      responseText: safetyText,
    });

    await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });

    await logAiRequest({
      conversationId,
      messageId: inboundMessageId,
      provider: "local_safety",
      model: matchedArticle?.slug || "safety_alert",
      status: "safety_alert",
      retryCount: 0,
      fallbackUsed: false,
      queueLatencyMs,
      providerLatencyMs: 0,
      totalLatencyMs: Date.now() - receivedAt.getTime(),
    });

    return {
      ok: true,
      replied: true,
      reason: "safety_alert",
      conversationId,
    };
  }

  if (isClientExitingFlow(concatenatedText)) {
    await saveBookingState(conversationId, {});
    const responseText = [
      "Sem problemas! 😊",
      "Não precisa escolher agora. Quando quiser agendar é só me chamar novamente.",
      "Posso te ajudar com alguma dúvida sobre os procedimentos ou técnicas?"
    ].join("\n\n");

    await sendTextAndRecord({
      normalized,
      conversationId,
      text: responseText,
      reason: "exit_booking_flow",
    });
    await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });

    await logAiRequest({
      conversationId,
      messageId: inboundMessageId,
      provider: "local_booking",
      model: "booking_exit",
      status: "success",
      totalLatencyMs: Date.now() - receivedAt.getTime(),
      queueLatencyMs,
      providerLatencyMs: 0,
    });

    return { ok: true, replied: true, reason: "exit_booking_flow", conversationId };
  }

  const history = await loadRecentHistory(conversationId, inboundMessageId);
  const effectiveDialogueState = recoverDialogueStateFromHistory(
    recorded.conversation.dialogue_state,
    history,
    receivedAt,
  );
  const pendingDialogueReply = resolvePendingDialogueReply(
    concatenatedText,
    effectiveDialogueState,
    receivedAt,
  );
  if (pendingDialogueReply.expired) {
    await saveDialogueState(conversationId, {});
    recorded.conversation.dialogue_state = {};
    await query(
      `insert into public.whatsapp_message_logs(conversation_id,message_id,event_type,status,details)
       values($1,$2,'dialogue_action_expired','info',$3)`,
      [conversationId, inboundMessageId, JSON.stringify({ action: pendingDialogueReply.action || null })],
    ).catch(() => null);
  } else if (pendingDialogueReply.matched) {
    await saveDialogueState(conversationId, {});
    recorded.conversation.dialogue_state = {};
    await query(
      `insert into public.whatsapp_message_logs(conversation_id,message_id,event_type,status,details)
       values($1,$2,'dialogue_action_resolved','success',$3)`,
      [conversationId, inboundMessageId, JSON.stringify({
        action: pendingDialogueReply.action,
        accepted: pendingDialogueReply.accepted,
        resolution: "deterministic_short_reply",
      })],
    ).catch(() => null);

    if (!pendingDialogueReply.accepted) {
      const responseText = "Sem problemas 😊 Posso te ajudar com alguma outra dúvida sobre nossos serviços?";
      await sendTextAndRecord({
        normalized,
        conversationId,
        text: responseText,
        reason: "dialogue_action_declined",
      });
      await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
      return { ok: true, replied: true, reason: "dialogue_action_declined", conversationId };
    }

    if (["show_catalog", "start_booking"].includes(pendingDialogueReply.action)) {
      const actionText = pendingDialogueReply.action === "show_catalog"
        ? "serviços"
        : "agendar uma avaliação";
      const structuredAction = await handleStructuredBookingFlow({
        normalized,
        conversationId,
        inboundMessageId,
        text: actionText,
        settings,
        base,
        recorded,
        queueLatencyMs,
        receivedAt,
        history,
        forceCatalogFlow: true,
      });
      if (structuredAction) return structuredAction;

      const responseText = pendingDialogueReply.action === "show_catalog"
        ? "Claro 😊 Envie “serviços” para eu abrir o catálogo completo para você."
        : "Claro 😊 Envie “agendar” para começarmos sua avaliação.";
      await sendTextAndRecord({
        normalized,
        conversationId,
        text: responseText,
        reason: "dialogue_action_fallback",
      });
      await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
      return { ok: true, replied: true, reason: "dialogue_action_fallback", conversationId };
    }
  } else if (effectiveDialogueState.pendingAction) {
    // A nova mensagem tem prioridade quando não é uma confirmação curta.
    const discardedAction = effectiveDialogueState.pendingAction?.type || null;
    await saveDialogueState(conversationId, {});
    recorded.conversation.dialogue_state = {};
    await query(
      `insert into public.whatsapp_message_logs(conversation_id,message_id,event_type,status,details)
       values($1,$2,'dialogue_action_discarded','info',$3)`,
      [conversationId, inboundMessageId, JSON.stringify({ action: discardedAction, reason: "subject_changed" })],
    ).catch(() => null);
  }
  const contextualReference = resolveContextualServiceReference({
    incomingText: concatenatedText,
    history,
    base,
    maxIdleMinutes: settings.maxIdleMinutes,
    now: receivedAt,
  });
  const routingText = contextualReference.effectiveText || concatenatedText;
  const topicArticle = contextualReference.topicLabel
    ? (base.knowledgeArticles || []).find((article) => {
        if (article?.status !== "active") return false;
        const topic = normalizeText(contextualReference.topicLabel);
        const articleText = normalizeText([
          article.title,
          article.category,
          article.slug,
        ].filter(Boolean).join(" "));
        return topic && articleText.includes(topic);
      }) || null
    : null;
  const contextualArticle = matchedArticle || topicArticle || findMatchingArticle(
    routingText,
    base.knowledgeArticles || [],
  );
  if (contextualReference.resolvedFromHistory || contextualReference.confidence === "ambiguous") {
    await query(
      `insert into public.whatsapp_message_logs(conversation_id,message_id,event_type,status,details)
       values($1,$2,'context_resolution','info',$3)`,
      [
        conversationId,
        inboundMessageId,
        JSON.stringify({
          topic: contextualReference.topicLabel || null,
          material: contextualReference.material || null,
          method: contextualReference.method || null,
          confidence: contextualReference.confidence,
          resolvedFromHistory: Boolean(contextualReference.resolvedFromHistory),
        }),
      ],
    ).catch((error) => console.error("Failed to log WhatsApp context resolution", error.message));
  }
  const parsedState = parseJsonObject(recorded.conversation.booking_state);
  let currentStateForRouting = parsedState;

  if (parsedState.updatedAt) {
    const updatedAt = new Date(parsedState.updatedAt);
    const now = new Date();
    const diffHours = (now.getTime() - updatedAt.getTime()) / (1000 * 60 * 60);
    // Se a última interação de agendamento foi há mais de 2 horas, expiramos o fluxo
    if (diffHours > 2) {
      await saveBookingState(conversationId, {});
      currentStateForRouting = {};
    }
  }
  const pendingCatalogInformation = await handlePendingCatalogInformationChoice({
    normalized,
    conversationId,
    text: concatenatedText,
    state: currentStateForRouting,
    base,
  });
  if (pendingCatalogInformation) return pendingCatalogInformation;

  const hasActiveBookingState = isActiveBookingState(currentStateForRouting);
  const bookingInterruptionQuestion = hasActiveBookingState &&
    isBookingFlowInterruptionQuestion(concatenatedText, history, {
      base,
      state: currentStateForRouting,
    });
  if (bookingInterruptionQuestion) {
    currentStateForRouting.informationPause = true;
    currentStateForRouting.updatedAt = new Date().toISOString();
    await saveBookingState(conversationId, currentStateForRouting);
    recorded.conversation.booking_state = currentStateForRouting;
  }
  console.log("whatsapp-ai-engine execution log:", {
    phone: normalized.phoneNumber,
    lastIntent: recorded.conversation.last_intent || null,
    currentFlow: currentStateForRouting ? currentStateForRouting.status : null,
    currentStep: currentStateForRouting ? currentStateForRouting.step : null,
    hasActiveState: hasActiveBookingState,
    message: concatenatedText,
    historyLength: history.length,
    contextualTopic: contextualReference.topicLabel || null,
    contextConfidence: contextualReference.confidence,
    resolvedFromHistory: contextualReference.resolvedFromHistory,
    history: history.map(h => ({ sender: h.sender_type, body: h.body ? h.body.slice(0, 50) : "" })),
  });

  // O estado ativo continua tendo prioridade para respostas da etapa. Perguntas
  // paralelas, porém, pausam o fluxo sem apagar o estado, seguem para a IA/base de
  // conhecimento e recebem a retomada determinística da etapa depois da resposta.
  if (hasActiveBookingState && !bookingInterruptionQuestion) {
    const structuredBooking = await handleStructuredBookingFlow({
      normalized,
      conversationId,
      inboundMessageId,
      text: concatenatedText,
      settings,
      base,
      recorded,
      queueLatencyMs,
      receivedAt,
      history,
    });
    if (structuredBooking) return structuredBooking;
  }

  const backendCatalogRequest =
    isServiceCatalogMenuIntent(concatenatedText) ||
    (
      hasExplicitBookingAction(concatenatedText) &&
      hasCommercialCatalogReference(routingText, base)
    );
  if (!hasActiveBookingState && backendCatalogRequest) {
    const structuredCatalog = await handleStructuredBookingFlow({
      normalized,
      conversationId,
      inboundMessageId,
      text: concatenatedText,
      settings,
      base,
      recorded,
      queueLatencyMs,
      receivedAt,
      history,
      forceCatalogFlow: true,
    });
    if (structuredCatalog) return structuredCatalog;
    console.warn("WhatsApp backend catalog flow returned no response", {
      conversationId,
      catalogMenuIntent: isServiceCatalogMenuIntent(concatenatedText),
      hasCatalogReference: hasCommercialCatalogReference(routingText, base),
      bookableServices: bookableAiServices(base).length,
    });
  }

  const prioritizeBookingState = !hasActiveBookingState && shouldPrioritizeBookingState(
    concatenatedText,
    currentStateForRouting,
    history,
  );
  if (prioritizeBookingState) {
    const structuredBooking = await handleStructuredBookingFlow({
      normalized,
      conversationId,
      inboundMessageId,
      text: concatenatedText,
      settings,
      base,
      recorded,
      queueLatencyMs,
      receivedAt,
      history,
    });
    if (structuredBooking) return structuredBooking;
  }

  const localAgendaAvailability = bookingInterruptionQuestion
    ? null
    : await handleLocalAgendaAvailabilityIntent({
        normalized,
        conversationId,
        inboundMessageId,
        text: concatenatedText,
        settings,
        base,
        recorded,
        queueLatencyMs,
        receivedAt,
        history,
      });
  if (localAgendaAvailability) return localAgendaAvailability;

  const hasQuestion = isBookingFlowInterruptionQuestion(concatenatedText, history, {
    base,
    state: currentStateForRouting,
  });

  if (!hasQuestion && !prioritizeBookingState) {
    const structuredBooking = await handleStructuredBookingFlow({
      normalized,
      conversationId,
      inboundMessageId,
      text: concatenatedText,
      settings,
      base,
      recorded,
      queueLatencyMs,
      receivedAt,
      history,
    });
    if (structuredBooking) return structuredBooking;
  }

  const catalogExplorationResult = buildCatalogExplorationResult(routingText, base);
  const localIntentResponse = buildLocalIntentResponse(routingText, base, contextualReference);
  if (localIntentResponse) {
    const isCatalogExploration = catalogExplorationResult?.text === localIntentResponse;
    if (isCatalogExploration) {
      currentStateForRouting.catalogInfoOptions = catalogExplorationResult.options;
      currentStateForRouting.catalogInfoSelectedServiceId = "";
      currentStateForRouting.catalogInfoUpdatedAt = new Date().toISOString();
      currentStateForRouting.catalogInfoStatus = "awaiting_choice";
      currentStateForRouting.catalogInfoPageStart = 0;
      currentStateForRouting.informationPause = true;
      currentStateForRouting.updatedAt = new Date().toISOString();
      await saveBookingState(conversationId, currentStateForRouting);
    }
    const pauseNotice = bookingInterruptionQuestion
      ? bookingInformationPauseNotice(currentStateForRouting)
      : "";
    const responseText = [localIntentResponse, pauseNotice].filter(Boolean).join("\n\n");
    const responseReason = isCatalogExploration
      ? "booking_catalog_info_options"
      : bookingInterruptionQuestion
        ? "booking_question_local_reply"
        : "local_intent_reply";
    await sendTextAndRecord({
      normalized,
      conversationId,
      text: responseText,
      reason: responseReason,
    });
    await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });

    await logAiRequest({
      conversationId,
      messageId: inboundMessageId,
      provider: "local_intent",
      model: "basic_commercial_intent",
      status: "success",
      retryCount: 0,
      fallbackUsed: false,
      queueLatencyMs,
      providerLatencyMs: 0,
      totalLatencyMs: Date.now() - receivedAt.getTime(),
      inputTokens: Math.round(concatenatedText.length / 4),
      outputTokens: Math.round(responseText.length / 4),
    });

    return { ok: true, replied: true, reason: responseReason, conversationId };
  }

  const scopeClassification = classifyAiServiceScope(concatenatedText, {
    history,
    maxIdleMinutes: settings.maxIdleMinutes,
    now: receivedAt,
  });
  const outOfScopeResponse = buildOutOfScopeResponse(concatenatedText, {
    history,
    maxIdleMinutes: settings.maxIdleMinutes,
    now: receivedAt,
  });
  // Quando há estado ativo de agendamento, o guard de fora do escopo é completamente
  // ignorado: o usuário está respondendo a uma pergunta do bot e sua mensagem deve
  // sempre seguir para o fluxo de agendamento ou para a IA — nunca retornar a
  // mensagem genérica de restrição de escopo.
  if (
    outOfScopeResponse &&
    !hasActiveBookingState &&
    !(
      contextualArticle ||
      hasCommercialCatalogReference(routingText, base)
    )
  ) {
    await sendTextAndRecord({
      normalized,
      conversationId,
      text: outOfScopeResponse,
      reason: "out_of_scope_guard",
    });
    await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });

    await logAiRequest({
      conversationId,
      messageId: inboundMessageId,
      provider: "local_scope_guard",
      model: `domain_scope:${scopeClassification}`,
      status: "out_of_scope",
      retryCount: 0,
      fallbackUsed: false,
      queueLatencyMs,
      providerLatencyMs: 0,
      totalLatencyMs: Date.now() - receivedAt.getTime(),
      inputTokens: Math.round(concatenatedText.length / 4),
      outputTokens: Math.round(outOfScopeResponse.length / 4),
    });

    return { ok: true, replied: true, reason: "out_of_scope_guard", conversationId };
  }

  // 8. Load AI Context & Prompt. O indicador nativo de digitação permanece
  // ativo; não enviamos uma segunda mensagem textual durante a geração.
  const currentState = parseJsonObject(recorded.conversation.booking_state);
  const agendaAvailabilityContext = await getAgendaAvailabilityContext(query, concatenatedText, base, currentState);

  const booking = buildBookingGuidance({
    incomingText: concatenatedText,
    history,
    knownClient: Boolean(recorded.client),
    settings,
    currentState,
  });
  const commercialContext = summarizeAiCommercialContext(base, settings, routingText);
  const systemPrompt = buildRuntimePrompt(settings);

  let knowledgeContext = "";
  if (agendaAvailabilityContext) {
    knowledgeContext = `${agendaAvailabilityContext}\n\n`;
  }

  if (contextualArticle) {
    knowledgeContext += [
      `Base de Conhecimento Aprovada - Artigo: "${contextualArticle.title}" (Nível ${safetyLevel})`,
      `Resposta Curta: ${contextualArticle.short_answer}`,
      `Resposta Completa: ${contextualArticle.full_answer}`,
      contextualArticle.recommended_followup_questions?.length > 0
        ? `Perguntas sugeridas para triagem: ${JSON.stringify(contextualArticle.recommended_followup_questions)}`
        : "",
      `Instruções de nível para este atendimento:`,
      safetyLevel === 3
        ? "- IMPORTANTE: A cliente relatou uma condição que exige avaliação presencial cuidadosa. Responda a dúvida de forma clara e empática, mas reforce firmemente que é indispensável realizar uma avaliação presencial no salão para examinar o cabelo e o couro cabeludo antes de qualquer procedimento."
        : safetyLevel === 2
        ? "- A cliente tem dúvidas ou está em triagem de técnicas. Responda com clareza usando o artigo e faça até duas perguntas curtas e diretas para entender melhor a necessidade dela (ex: objetivo, tipo de cabelo, se tem química) e poder orientar o agendamento de uma avaliação."
        : "- Responda a dúvida diretamente com base no artigo fornecido, de forma curta e acolhedora."
    ].filter(Boolean).join("\n");
  }

  const promptMessage = buildAiConversationMessage({
    incomingText: concatenatedText,
    history: history.slice(-(settings.contextLimit || 8)),
    commercialContext,
    knowledgeContext,
    bookingGuidance: booking.text,
    knownClient: Boolean(recorded.client),
    contextualReference,
  });

  let finalResponse = null;
  const primaryProvider = normalizeAiProvider(
    settings.primaryProvider || settings.provider || "gemini",
  );
  let finalProvider = primaryProvider;
  let finalModel = null;
  let finalUsage = null;
  let retryCountTotal = 0;
  let fallbackUsed = false;
  let errorMsg = null;
  let errorCode = null;
  const providerStartedAt = new Date();
  let providerFinishedAt = providerStartedAt;
  const candidates = buildAiProviderCandidates(settings);

  for (const candidate of candidates) {
    if (finalResponse) break;
    const runtime = aiProviderRuntime(candidate.provider, settings);
    const activeModel = candidate.model || runtime.defaultModel;
    if (!runtime.enabled || !runtime.configured) {
      const missingReason = !runtime.enabled ? "disabled" : "not_configured";
      console.warn(`AI provider ${runtime.provider} skipped: ${missingReason}.`, {
        enabled: runtime.enabled,
        configured: runtime.configured,
        model: activeModel,
      });
      errorMsg = `Provedor ${runtime.provider} não está habilitado/configurado no ambiente ou painel.`;
      errorCode = `${runtime.provider.toUpperCase()}_${missingReason.toUpperCase()}`;
      continue;
    }

    if (candidate.isFallback) fallbackUsed = true;
    const retries = settings.maxRetries ?? 2;
    let currentAttempt = 0;
    while (currentAttempt <= retries && !finalResponse) {
      try {
        if (currentAttempt > 0) {
          retryCountTotal += 1;
          await delay(getRetryDelay(currentAttempt));
        }
        const result = await generateAiProviderText({
          provider: runtime.provider,
          systemPrompt,
          message: promptMessage,
          model: activeModel,
          timeoutMs: settings.timeoutMs || 12000,
          maxTokens: settings.maxResponseTokens || 300,
          apiKey: runtime.apiKey,
        });
        finalResponse = result.text;
        finalProvider = runtime.provider;
        finalModel = result.model || activeModel;
        finalUsage = result.usage;
      } catch (err) {
        console.error(
          `AI provider ${runtime.provider} failed (attempt ${currentAttempt + 1}/${retries + 1}): ${err.message}`,
        );
        errorMsg = err.message;
        errorCode = err.code || String(err.status || "") || null;
        if (!shouldRetryAiProviderError(err)) break;
        currentAttempt += 1;
      }
    }
  }
  providerFinishedAt = new Date();

  const lastAiMessage = history.filter(item => item.sender_type === "ai").pop();
  const lastAiText = lastAiMessage ? lastAiMessage.body : "";
  if (finalResponse && lastAiText && finalResponse.trim() === lastAiText.trim()) {
    try {
      const loopPrompt = `${systemPrompt}\n\nATENÇÃO: Sua resposta gerada foi exatamente idêntica à última resposta enviada: "${finalResponse}". Para evitar repetição e loops, gere uma resposta diferente, mais natural e contextualizada.`;
      const runtime = aiProviderRuntime(finalProvider, settings);
      const result = await generateAiProviderText({
        provider: finalProvider,
        systemPrompt: loopPrompt,
        message: promptMessage,
        model: finalModel || runtime.defaultModel,
        timeoutMs: settings.timeoutMs || 12000,
        maxTokens: settings.maxResponseTokens || 300,
        apiKey: runtime.apiKey,
      });
      finalResponse = result.text;
      finalUsage = result.usage || finalUsage;
    } catch (err) {
      console.error("Regenerating response to prevent loop failed:", err.message);
    }
  }

  // Turn off typing indicator
  await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });

  const totalFinishedAt = new Date();
  const totalLatencyMs = totalFinishedAt.getTime() - receivedAt.getTime();
  const providerLatencyMs =
    providerStartedAt && providerFinishedAt
      ? providerFinishedAt.getTime() - providerStartedAt.getTime()
      : 0;

  if (finalResponse) {
    finalResponse = enforceAiResponseQuality({
      response: finalResponse,
      incomingText: concatenatedText,
      history,
      base,
      contextualReference,
    });
    if (
      bookingInterruptionQuestion &&
      booking.resumeText &&
      !finalResponse.includes(booking.resumeText)
    ) {
      finalResponse = [finalResponse.trim(), booking.resumeText].join("\n\n");
    }
    if (booking.shouldRegister) {
      await requestHumanAttention({
        conversationId,
        messageId: inboundMessageId,
        reason: "booking_request",
        responseText: finalResponse,
      });
    }

    // Send response
    const responseReason = bookingInterruptionQuestion
      ? `booking_question_${finalProvider}_reply`
      : `${finalProvider}_reply`;
    await sendTextAndRecord({
      normalized,
      conversationId,
      text: finalResponse,
      reason: responseReason,
    });

    // Log metric in ai_request_logs
    const inputTokens = finalUsage
      ? finalUsage.promptTokenCount ||
        finalUsage.prompt_tokens ||
        finalUsage.input_tokens ||
        Math.round(promptMessage.length / 4)
      : Math.round(promptMessage.length / 4);
    const outputTokens = finalUsage
      ? finalUsage.candidatesTokenCount ||
        finalUsage.completion_tokens ||
        finalUsage.output_tokens ||
        Math.round(finalResponse.length / 4)
      : Math.round(finalResponse.length / 4);

    await logAiRequest({
      conversationId,
      messageId: inboundMessageId,
      provider: finalProvider,
      model: finalModel,
      status: "success",
      retryCount: retryCountTotal,
      fallbackUsed,
      queueLatencyMs,
      providerLatencyMs,
      totalLatencyMs,
      inputTokens,
      outputTokens,
    });

    return {
      ok: true,
      replied: true,
      reason: responseReason,
      conversationId,
      model: finalModel,
    };
  } else {
    console.error("All configured AI providers failed. Triggering contingency response.");

    let contingencyReplied = false;
    if (settings.contingencyEnabled) {
      const contingencyText = [
        "Recebi sua mensagem, mas nosso atendimento automático está com uma instabilidade momentânea. Pode tentar novamente em instantes, por favor?",
        bookingInterruptionQuestion ? bookingInformationPauseNotice(currentState) : "",
      ].filter(Boolean).join("\n\n");
      await sendTextAndRecord({
        normalized,
        conversationId,
        text: contingencyText,
        reason: bookingInterruptionQuestion
          ? "booking_question_contingency_reply"
          : "contingency_reply",
      });
      contingencyReplied = true;
    }

    await query(
      `insert into public.whatsapp_message_logs(conversation_id,message_id,event_type,status,details)
       values($1,$2,'ai_contingency','warning',$3)`,
      [
        conversationId,
        inboundMessageId,
        JSON.stringify({
          reason: "providers_failed",
          action: "keep_ai_enabled",
          replied: contingencyReplied,
        }),
      ],
    );

    // Log the failure metrics
    await logAiRequest({
      conversationId,
      messageId: inboundMessageId,
      provider: finalProvider,
      model: finalModel || settings.primaryModel || settings.model || "not_available",
      status: contingencyReplied ? "contingency_reply" : "provider_error",
      retryCount: retryCountTotal,
      fallbackUsed,
      queueLatencyMs,
      providerLatencyMs,
      totalLatencyMs,
      errorCode: errorCode || "AI_PROVIDERS_FAILED",
      errorMessage: errorMsg || "Todos os provedores de IA falharam.",
    });

    return {
      ok: true,
      replied: contingencyReplied,
      reason: contingencyReplied ? "contingency_reply" : "providers_failed",
      conversationId,
    };
  }
}

export async function resumeDueHumanConversations({ limit = 25 } = {}) {
  await ensureAiWhatsappSchema();
  const settings = await getAiSettings();
  if (!settings.enabled || settings.autoResumeAfterHumanEnabled === false) {
    return { processed: 0, resumed: 0, failed: 0, disabled: true };
  }

  const timeoutMinutes = Math.min(
    1440,
    Math.max(1, Number(settings.humanResponseTimeoutMinutes || 15)),
  );
  const safeLimit = Math.min(100, Math.max(1, Number(limit || 25)));
  const { rows } = await query(
    `select id,phone_number,human_takeover_at
       from public.whatsapp_conversations wc
      where wc.status='human'
        and wc.ai_enabled=false
        and wc.human_takeover_at is not null
        and wc.human_takeover_at <= now() - ($1::text || ' minutes')::interval
        and exists (
          select 1 from public.whatsapp_incoming_queue wiq
           where wiq.phone_number=wc.phone_number and wiq.processed=false
        )
      order by wc.human_takeover_at asc
      limit $2`,
    [String(timeoutMinutes), safeLimit],
  );

  let resumed = 0;
  let failed = 0;
  for (const conversation of rows) {
    const claimed = await query(
      `update public.whatsapp_conversations
          set status='ai',ai_enabled=true,assigned_to=null,human_takeover_at=null,
              session_started_at=now(),updated_at=now()
        where id=$1 and status='human' and ai_enabled=false
        returning id`,
      [conversation.id],
    );
    if (!claimed.rowCount) continue;
    await query(
      `update public.human_handoff_tickets
          set status='closed',resolved_at=coalesce(resolved_at,now()),updated_at=now()
        where conversation_id=$1 and status in ('pending','open')`,
      [conversation.id],
    ).catch(() => null);
    try {
      await processIncomingWhatsAppWebhook(
        {
          from: `${conversation.phone_number}@s.whatsapp.net`,
          text: "Retomada automática após espera humana.",
          isFromMe: false,
          messageId: `tmp-auto-resume-${conversation.id}-${Date.now()}`,
        },
        { queuedResume: true, conversationId: conversation.id },
      );
      resumed += 1;
    } catch (error) {
      failed += 1;
      await query(
        `update public.whatsapp_conversations
            set status='human',ai_enabled=false,human_takeover_at=$2,updated_at=now()
          where id=$1`,
        [conversation.id, conversation.human_takeover_at],
      ).catch(() => null);
      console.error("Automatic AI resume failed", {
        conversationId: conversation.id,
        message: error?.message || String(error),
      });
    }
  }
  return { processed: rows.length, resumed, failed, timeoutMinutes };
}
