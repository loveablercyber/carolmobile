import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { query, transaction } from "./db.js";
import {
  buildRuntimePrompt,
  ensureAiWhatsappSchema,
  getAiCommercialBase,
  getAiSettings,
} from "./ai-whatsapp.js";
import { createSumupCheckout, sumupConfig } from "./sumup.js";
import {
  schedulePeriod,
  scheduleSlots,
  slotsWithConflicts,
  periodFitsSchedule,
  weekdayForDate,
} from "./availability-rules.js";
import { generateOpenAiText, openAiPublicStatus } from "./openai-client.js";
import { generateGeminiText, geminiPublicStatus } from "./gemini-client.js";
import { generateGroqText, groqPublicStatus } from "./groq-client.js";
import { sendBaileysTextMessage, sendBaileysPresence } from "./baileys-client.js";
import { sendEmail } from "./integrations.js";

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
} from "./whatsapp/intent-detector.js";

import {
  explicitGreetingFromText,
  localGreetingForDate,
  buildLocalGreetingResponse,
  naturalConversationPrefix,
  buildOutOfScopeResponse,
} from "./whatsapp/local-handlers.js";

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
} from "./whatsapp/intent-detector.js";

export {
  localGreetingForDate,
  buildLocalGreetingResponse,
  buildOutOfScopeResponse,
} from "./whatsapp/local-handlers.js";

const MAX_AI_MESSAGE_CHARS = 6000;
const SLOT_PAGE_SIZE = 5;

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
    entries.push([
      service.name,
      service.commercial_name,
      service.short_description,
      service.detailed_description,
      service.description,
    ].filter(Boolean).join(" "));
  }
  for (const item of base.products || []) entries.push([item.name, item.category].filter(Boolean).join(" "));
  for (const item of base.inventory || []) {
    entries.push([item.name, item.category, item.color, item.shade, item.texture].filter(Boolean).join(" "));
  }
  for (const article of base.knowledgeArticles || []) {
    entries.push([article.title, article.short_answer, article.category].filter(Boolean).join(" "));
  }
  return entries.some((entry) => textMatchesCatalogEntry(text, entry));
}

function bookableAiServices(base = {}) {
  return (base.services || [])
    .filter((service) => service.active !== false && service.ai_active && service.allow_auto_booking)
    .sort((a, b) => Number(a.priority_order || 100) - Number(b.priority_order || 100));
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

function matchingServiceForPriceQuestion(text, base = {}) {
  const normalized = normalizeText(text);
  const services = (base.services || []).filter((service) => service.active !== false && service.ai_active);
  return services.find((service) => {
    const haystack = serviceSearchText(service);
    const terms = haystack.split(/\s+/).filter((term) => term.length >= 4);
    return terms.some((term) => normalized.includes(term));
  }) || null;
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
  const service = matchingServiceForPriceQuestion(text, base);
  if (!service) return null;
  const serviceName = service.commercial_name || service.name;
  const price = serviceValue(service);
  const promotion = matchingPromotionForService(service, base);
  const lines = [
    servicePriceText(service, price, { serviceName }),
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

export function selectBookingService(text, base = {}, state = {}) {
  const choice = numericChoice(text);
  if (choice && state.status === "awaiting_service" && Array.isArray(state.serviceOptions)) {
    const selected = state.serviceOptions.find((item) => Number(item.id) === choice);
    if (selected?.serviceId) return selected;
  }


  const normalized = normalizeText(text);
  const services = (base.services || []).filter((service) => service.active !== false && service.ai_active);
  const bookable = bookableAiServices(base);
  const evaluation = bookable.find((service) => serviceSearchText(service).includes("avaliacao")) || bookable[0] || null;
  const matched = services.find((service) => {
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
  return [
    "servico",
    "servicos",
    "ver servicos",
    "quero ver servicos",
    "quais servicos",
    "lista de servicos",
    "catalogo de servicos",
  ].includes(normalized);
}

function buildCategoryOptions(base = {}) {
  const services = bookableAiServices(base);
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

function buildMethodOptions(base = {}, categoryId) {
  const services = bookableAiServices(base).filter(s => s.category_id === categoryId);
  const methodsMap = new Map();
  for (const s of services) {
    if (s.hair_method_id) {
      methodsMap.set(s.hair_method_id, true);
    }
  }
  return (base.methods || [])
    .filter(m => methodsMap.has(m.id) && m.category_id === categoryId)
    .map((m, index) => ({
      id: index + 1,
      methodId: m.id,
      methodName: m.name,
    }));
}

function buildServiceOptions(base = {}, categoryId, methodId) {
  let services = bookableAiServices(base);
  if (categoryId) services = services.filter(s => s.category_id === categoryId);
  if (methodId) services = services.filter(s => s.hair_method_id === methodId);

  return services.slice(0, 10).map((service, index) => ({
    id: index + 1,
    serviceId: service.id,
    serviceName: service.commercial_name || service.name,
    requestedServiceName: service.commercial_name || service.name,
    serviceValue: serviceValue(service),
    serviceIsFree: isFreeService(service),
    offerInventoryItems: service.offer_inventory_items === true,
    categoryId: service.category_id,
    methodId: service.hair_method_id,
    ...bookingServiceDetails(service),
  }));
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
  return items.slice(0, 15).map((item, index) => ({
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

async function processServiceHierarchySelection(text, base, state, conversationId, normalized, isAgendaIntent = false, parsedDate = "") {
  const choice = numericChoice(text);

  if (state.status === "awaiting_category" && choice && Array.isArray(state.categoryOptions)) {
    const selected = state.categoryOptions.find(item => Number(item.id) === choice);
    if (selected) state.categoryId = selected.categoryId;
  }
  if (state.status === "awaiting_method" && choice && Array.isArray(state.methodOptions)) {
    const selected = state.methodOptions.find(item => Number(item.id) === choice);
    if (selected) state.methodId = selected.methodId;
  }
  if (state.status === "awaiting_service" && choice && Array.isArray(state.serviceOptions)) {
    const selected = state.serviceOptions.find(item => Number(item.id) === choice);
    if (selected) {
      Object.assign(state, {
        serviceId: selected.serviceId,
        serviceName: selected.serviceName,
        requestedServiceName: selected.requestedServiceName || selected.serviceName,
        serviceValue: selected.serviceValue || 0,
        serviceIsFree: selected.serviceIsFree === true,
        offerInventoryItems: selected.offerInventoryItems === true,
        categoryId: selected.categoryId || state.categoryId || "",
        methodId: selected.methodId || state.methodId || "",
        ...serviceDetailsState(selected),
        serviceDetailsAccepted: false,
        serviceNote: selected.note || "",
      });
    }
  }
  if (state.status === "awaiting_inventory" && choice && Array.isArray(state.inventoryOptions)) {
    const selected = state.inventoryOptions.find(item => Number(item.id) === choice);
    if (selected) {
      state.inventoryId = selected.inventoryId;
      state.inventoryName = selected.inventoryName;
      if (selected.inventoryValue > 0) state.serviceValue = selected.inventoryValue;
      state.serviceName = `${state.serviceName} - ${state.inventoryName}`;
    }
  }

  if (!state.serviceId && !choice) {
    const serviceChoice = selectBookingService(text, base, state);
    if (serviceChoice) {
      Object.assign(state, {
        serviceId: serviceChoice.serviceId,
        serviceName: serviceChoice.serviceName,
        requestedServiceName: serviceChoice.requestedServiceName || serviceChoice.serviceName,
        serviceValue: serviceChoice.serviceValue || 0,
        serviceIsFree: serviceChoice.serviceIsFree === true,
        offerInventoryItems: serviceChoice.offerInventoryItems === true,
        categoryId: serviceChoice.categoryId || state.categoryId || "",
        methodId: serviceChoice.methodId || state.methodId || "",
        ...serviceDetailsState(serviceChoice),
        serviceDetailsAccepted: false,
        serviceNote: serviceChoice.note || "",
      });
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

  if (!state.serviceId && state.categoryId && !state.methodId) {
    const methodOptions = buildMethodOptions(base, state.categoryId);
    if (methodOptions.length === 1 || methodOptions.length === 0) {
      if (methodOptions.length === 1) state.methodId = methodOptions[0].methodId;
    } else {
      state.methodOptions = methodOptions;
      state.status = "awaiting_method";
      await saveBookingState(conversationId, state);
      const responseText = [
        "Certo! Qual o método de aplicação?",
        "Responda só com o número:",
        optionLines(methodOptions, (item) => item.methodName),
      ].join("\n\n");
      await performSendTextAndRecord({ normalized, conversationId, text: responseText, reason: "booking_method_options" });
      await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
      return { ok: true, replied: true, reason: "booking_method_options", conversationId };
    }
  }

  if (!state.serviceId) {
    const serviceOptions = buildServiceOptions(base, state.categoryId, state.methodId);
    if (serviceOptions.length === 1) {
      const selected = serviceOptions[0];
      Object.assign(state, {
        serviceId: selected.serviceId,
        serviceName: selected.serviceName,
        requestedServiceName: selected.requestedServiceName || selected.serviceName,
        serviceValue: selected.serviceValue || 0,
        serviceIsFree: selected.serviceIsFree === true,
        offerInventoryItems: selected.offerInventoryItems === true,
        categoryId: selected.categoryId || state.categoryId || "",
        methodId: selected.methodId || state.methodId || "",
        ...serviceDetailsState(selected),
        serviceDetailsAccepted: false,
      });
    } else if (serviceOptions.length > 1) {
      state.serviceOptions = serviceOptions;
      state.status = "awaiting_service";
      await saveBookingState(conversationId, state);
      const prefix = isAgendaIntent ? `Consigo consultar a agenda real${parsedDate ? ` para ${formatDateLabel(parsedDate)}` : ""}.` : "Posso registrar o pré-agendamento pelo WhatsApp ✨";
      const instruction = state.categoryId && state.methodId ? "Excelente. Agora escolha o serviço específico:" : "Escolha o serviço respondendo só com o número:";
      const responseText = [
        prefix,
        instruction,
        optionLines(serviceOptions, (item) => item.serviceName),
      ].filter(Boolean).join("\n\n");
      await performSendTextAndRecord({ normalized, conversationId, text: responseText, reason: "booking_service_options" });
      await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
      return { ok: true, replied: true, reason: "booking_service_options", conversationId };
    } else {
      return null;
    }
  }

  if (state.serviceId && state.offerInventoryItems && !state.inventoryId) {
    const inventoryOptions = buildInventoryOptions(base, state);
    if (inventoryOptions.length > 0) {
      state.inventoryOptions = inventoryOptions;
      state.status = "awaiting_inventory";
      await saveBookingState(conversationId, state);
      const responseText = [
        "Para esse serviço, escolha a variação desejada (tamanho, cor, etc):",
        "Responda só com o número:",
        optionLines(inventoryOptions, (item) => item.inventoryValue ? `${item.inventoryName} (A partir de R$ ${item.inventoryValue})` : item.inventoryName),
      ].join("\n\n");
      await performSendTextAndRecord({ normalized, conversationId, text: responseText, reason: "booking_inventory_options" });
      await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
      return { ok: true, replied: true, reason: "booking_inventory_options", conversationId };
    }
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
  const nextCommand = start + SLOT_PAGE_SIZE + 1;
  if (options.length > start + SLOT_PAGE_SIZE) {
    lines.push(`Digite ${nextCommand} para ver mais horários.`);
  }
  return lines.filter(Boolean).join("\n");
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

function buildServiceDetailsResponse(state = {}) {
  const description = state.serviceDetailedDescription || state.serviceDescription || "";
  const duration = Number(state.serviceDurationMinutes || 0);
  const valueLabel = formatServiceValue({ is_free: state.serviceIsFree }, state.serviceValue);
  const assessmentLabel = state.serviceRequiresAssessment ? "\n⚠️ Observação: Requer avaliação prévia." : "";
  const recomLabel = state.serviceRecommendedMessage ? `\n💡 Dica: ${state.serviceRecommendedMessage}` : "";
  const depositText = state.serviceRequiresDeposit ? `\n💳 Sinal: R$ ${Number(state.serviceDepositAmount || 0).toFixed(2)}` : "";

  return [
    state.serviceNote ? `${state.serviceNote}\n` : "",
    `✨ *Excelente escolha!* Você selecionou *${state.serviceName}*.`,
    description ? `📝 ${description}` : "",
    duration > 0 ? `⏱️ *Duracao: ${duration} minutos*` : "",
    `*💰 Valor: ${valueLabel}*${depositText}${assessmentLabel}${recomLabel}`,
    `🗓️ Posso verificar os horários disponíveis para você?\n\n1) Sim\n2) Escolher outro servico`
  ].filter(Boolean).join("\n");
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
    [conversationId, JSON.stringify(prunePayload(state))],
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

async function availableBookingSlots(client, { serviceId, date, preferredTime = "", period = "" }) {
  const service = await client.query(
    "select id,name,duration_minutes,base_price,deposit_amount,active,coalesce(is_free,false) as is_free from public.services where id=$1 and active limit 1",
    [serviceId],
  );
  if (!service.rows[0]) return { service: null, slots: [] };

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
    const times = scheduleSlots(availability.rows, service.rows[0].duration_minutes);
    const available = slotsWithConflicts(date, times, service.rows[0].duration_minutes, conflicts.rows)
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
        durationMinutes: service.rows[0].duration_minutes,
      });
    }
  }
  return { service: service.rows[0], slots };
}

async function createWhatsappAppointment({ conversationId, phoneNumber, state }) {
  const result = await transaction(async (client) => {
    const lockedConversation = await client.query(
      "select id,appointment_id from public.whatsapp_conversations where id=$1 for update",
      [conversationId],
    );
    if (!lockedConversation.rows[0]) throw new Error("Conversa não encontrada para agendamento.");
    if (lockedConversation.rows[0].appointment_id && !state.previousAppointmentId) {
      return { id: lockedConversation.rows[0].appointment_id, alreadyCreated: true };
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
    const professional = await client.query(
      `select p.id,p.profile_id,pp.full_name
         from public.professionals p
         join public.profiles pp on pp.id=p.profile_id
         join public.professional_services ps on ps.professional_id=p.id and ps.service_id=$2
        where p.id=$1 and p.active
        limit 1`,
      [state.professionalId, state.serviceId],
    );
    if (!professional.rows[0]) throw new Error("Profissional indisponível para este serviço.");

    await client.query("select pg_advisory_xact_lock(hashtext($1))", [professional.rows[0].id]);

    const startsAt = new Date(`${state.date}T${state.time}:00-03:00`);
    const endsAt = new Date(startsAt.getTime() + Number(service.rows[0].duration_minutes || 60) * 60_000);
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
      "select id from public.salon_locations where active order by name limit 1",
    );
    const appointmentId = (await client.query("select uuid_generate_v4() as id")).rows[0].id;
    const bookingCode = `CS-${String(appointmentId).replace(/-/g, "").slice(-12).toUpperCase()}`;
    const paymentInfo = whatsappBookingPaymentInfo(service.rows[0], state);
    const shouldCreatePayment = paymentInfo.amount > 0;
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

    await client.query(
      `insert into public.appointments(
        id,booking_code,client_id,professional_id,service_id,location_id,starts_at,ends_at,
        status,notes,estimated_value,original_value,discount_amount,intake_data,created_by
      ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,0,$12,$13)`,
      [
        appointmentId,
        bookingCode,
        bookingClient.client_id,
        professional.rows[0].id,
        service.rows[0].id,
        location.rows[0]?.id || null,
        startsAt.toISOString(),
        endsAt.toISOString(),
        initialStatus,
        notes,
        state.serviceValue || service.rows[0].base_price || 0,
        JSON.stringify(intake),
        bookingClient.profile_id || null,
      ],
    );
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
    await client.query(
      `insert into public.notifications(profile_id,kind,title,body,data,action_url,metadata)
       values($1,'appointment_created','Pré-agendamento enviado',$2,$3,$4,$3)`,
      [
        bookingClient.profile_id,
        shouldCreatePayment
          ? `Sua solicitação de ${service.rows[0].name} foi registrada. A fatura já está disponível no portal.`
          : `Sua solicitação de ${service.rows[0].name} foi registrada. A equipe vai confirmar a disponibilidade.`,
        notificationData,
        paymentId ? `/cliente/pagamentos/${paymentId}` : `/cliente/agendamentos/${appointmentId}`,
      ],
    ).catch(() => null);
    await client.query(
      `insert into public.notifications(profile_id,kind,title,body,data,action_url,metadata)
       values($1,'appointment_requested','Novo pré-agendamento do WhatsApp',$2,$3,$4,$3)`,
      [
        professional.rows[0].profile_id,
        `Nova solicitação de ${service.rows[0].name} para ${startsAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.`,
        notificationData,
        "/profissional/agenda",
      ],
    ).catch(() => null);
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
      bookingCode,
      startsAt: startsAt.toISOString(),
      paymentId,
      paymentAmount: paymentInfo.amount,
      paymentUrl,
      billingReason: paymentInfo.billingReason,
      service: service.rows[0].name,
      professional: professional.rows[0].full_name,
      access: bookingClient.access || null,
    };
  });
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
  if (isBookingIntent(text) || isAgendaAvailabilityIntent(text)) return true;
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

async function slotOptionsForBooking({ serviceId, date, preferredTime = "", period = "" }) {
  return transaction(async (client) => {
    const { slots } = await availableBookingSlots(client, {
      serviceId,
      date,
      preferredTime,
      period,
    });
    return slots.map((slot, index) => ({ ...slot, id: index + 1 }));
  });
}

async function nextAvailableSlotOptions({ serviceId, fromDate, period = "" }) {
  const options = [];
  for (let offset = 0; offset <= 10; offset++) {
    const date = addLocalDays(fromDate, offset);
    const slots = await slotOptionsForBooking({ serviceId, date, period });
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
      date: state.date,
      preferredTime,
      period: requestedPeriod,
    });
    let reason = "agenda_slot_options";
    let header = `Consultei a agenda real para ${formatDateLabel(state.date)}.`;

    if (!slotOptions.length) {
      const nextOptions = await nextAvailableSlotOptions({
        serviceId: state.serviceId,
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
}) {
  if (!settings.allowAutoBooking) return null;
  if (!flowEnabled(base, "pre_agendamento") && !flowEnabled(base, "verificacao_agenda")) return null;

  const lastAiMessage = (history || []).filter(item => item.sender_type === "ai").pop();
  const lastAiResponseText = lastAiMessage ? lastAiMessage.body : "";

  const sendTextAndRecord = async ({ normalized, conversationId, text: responseText, reason }) => {
    if (lastAiResponseText && responseText.trim() === lastAiResponseText.trim()) {
      throw new Error("LOOP_DETECTED");
    }
    return performSendTextAndRecord({ normalized, conversationId, text: responseText, reason });
  };

  try {
    let currentState = parseJsonObject(recorded.conversation.booking_state);
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
        if (currentState.status === "booked") {
          currentState.status = "";
          currentState.appointmentId = "";
        }
      }
    }

    if (
      persistedAppointmentId &&
      currentState.status !== "booked" &&
      currentState.previousAppointmentId !== persistedAppointmentId
    ) {
      currentState = {
        ...currentState,
        status: "booked",
        appointmentId: persistedAppointmentId,
      };
    }
  if (shouldResetBookingStateOnGreeting(text, currentState)) {
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
      });
      await sendTextAndRecord({ normalized, conversationId, text: responseText, reason: "booking_followup_handoff" });
      await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
      return { ok: true, replied: true, reason: "booking_followup_handoff", conversationId };
    }

    if (isBookedFollowupQuestionChoice(text)) {
      const responseText =
        "Claro 😊 Me manda sua dúvida sobre Mega Hair que eu te respondo por aqui.";
      await sendTextAndRecord({ normalized, conversationId, text: responseText, reason: "booking_followup_question_prompt" });
      await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
      return { ok: true, replied: true, reason: "booking_followup_question_prompt", conversationId };
    }

    if (isNewBookingRequestAfterBooked(text)) {
      currentState = {
        status: "collecting",
        previousAppointmentId: currentState.appointmentId,
        previousBookingCode: currentState.bookingCode || "",
        updatedAt: new Date().toISOString(),
      };
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
  const previousServiceChoice = !currentState.serviceId && previousPromptSuggestsBooking
    ? selectBookingService(previousAiPrompt, base, currentState)
    : null;
  const active =
    (currentState.status && currentState.status !== "booked") ||
    previousPromptSuggestsBooking ||
    isServiceCatalogMenuIntent(text) ||
    Boolean(directServiceChoice?.serviceId);
  if (!active && !isBookingIntent(text)) return null;

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
  if (!state.serviceId) return null;

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
      const displayedSlots = state.slotOptions.slice(pageStart, pageStart + SLOT_PAGE_SIZE);
      const selected = displayedSlots.find((item) => Number(item.id) === choice);
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
        date: state.date,
        preferredTime,
        period,
      });
      if (!slotOptions.length) {
        const unavailableDate = state.date;
        const fallbackSlots = (preferredTime || period)
          ? await slotOptionsForBooking({
              serviceId: state.serviceId,
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

  if (isFinalBookingAlteration(text) && state.status === "awaiting_confirmation") {
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

  if (!isFinalBookingConfirmation(text)) {
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
      appointment.paymentUrl
        ? `💳 *Sinal:* link para pagamento enviado abaixo:`
        : appointment.paymentId
          ? `💳 Fatura: ${formatBookingCurrency(appointment.paymentAmount)} para pagamento no portal.`
          : `💵 *Pagamento:* No local do atendimento.`,
      "",
      appointment.paymentUrl ? `${appointment.paymentUrl}\n` : "",
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
    if (error.message === "LOOP_DETECTED") {
      return null;
    }
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

export function summarizeAiCommercialContext(base, settings = {}) {
  const services = (base.services || [])
    .filter((service) => service.active && service.ai_active)
    .slice(0, 10)
    .map((service) => {
      const price = Number(service.initial_price || service.base_price || 0);
      const priceText = isFreeService(service)
        ? "sem custo"
        : price > 0
          ? `valor inicial R$ ${price.toFixed(2)}`
          : "valor sob consulta";
      return `- ${service.commercial_name || service.name}: ${priceText}, duração ${service.estimated_duration_minutes || service.duration_minutes || "sob consulta"} min.`;
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
  const servicesWithOffer = (base.services || []).filter((s) => s.offer_inventory_items);
  const servicesWithOfferDescriptions = servicesWithOffer.map((service) => {
    const matching = (base.inventory || []).filter((item) => 
      item.quantity > 0 && 
      item.category_id === service.category_id && 
      (!service.hair_method_id || item.hair_method_id === service.hair_method_id)
    );
    const optionsText = matching.length > 0 
      ? matching.map((item) => {
          const price = Number(item.suggested_price || 0);
          const priceText = price > 0 ? `R$ ${price.toFixed(2)}` : "valor sob consulta";
          const lengthText = item.length_cm ? (String(item.length_cm).toLowerCase().includes('cm') ? item.length_cm : `${item.length_cm}cm`) : "N/A";
          return `  * Opção de Cabelo (Cód: ${item.code || "N/A"}): Cor ${item.color || "N/A"}, Tom ${item.shade || "N/A"}, ${lengthText}, ${item.weight_grams || "N/A"}g — ${priceText} (Disponível: ${item.quantity} un)`;
        }).join("\n")
      : "  (Nenhuma variação disponível em estoque no momento)";
    return `- Serviço: ${service.name} (Variações do Estoque)\n${optionsText}`;
  });
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
    services.length ? `Serviços:\n${services.join("\n")}` : "Serviços: nenhum serviço foi liberado para atendimento automático.",
    plans.length ? `Planos ativos:\n${plans.join("\n")}` : "Planos ativos: nenhum plano ativo encontrado.",
    coupons.length ? `Cupons ativos:\n${coupons.join("\n")}` : "Cupons ativos: nenhum cupom ativo encontrado.",
    promotions.length ? `Promocoes ativas para WhatsApp:\n${promotions.join("\n")}` : "Promocoes ativas para WhatsApp: nenhuma promocao ativa cadastrada.",
    servicesWithOfferDescriptions.length ? `Variações de Cabelos e mechas em estoque por serviço:\n${servicesWithOfferDescriptions.join("\n")}` : "Cabelos e mechas: nenhum item em estoque no momento para serviços cadastrados.",
    products.length ? `Produtos e acessórios ativos:\n${products.join("\n")}` : "Produtos e acessórios: nenhum item ativo em estoque no momento.",
    enabledFlows.length
      ? `Fluxos automáticos habilitados: ${enabledFlows.join(", ")}.`
      : "Fluxos automáticos: nenhum fluxo específico habilitado.",
    settings.allowAutoBooking
      ? "Pré-agendamento automático está permitido, mas exige dados completos e confirmação explícita antes de qualquer gravação."
      : "A IA pode conduzir e registrar uma solicitação de pré-agendamento; a equipe confirma disponibilidade e horário.",
    "Catálogo: responda sobre cabelos naturais, mechas, microlink, queratina, fita adesiva, telas, acessórios e produtos de manutenção usando exclusivamente os itens cadastrados acima. Nunca invente produto, preço, disponibilidade, cor, peso ou comprimento.",
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

  if (hasQuestion && currentState && currentState.serviceId) {
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
      text: `Existe um fluxo de pre-agendamento em andamento. Servico selecionado: ${serviceName} ${dateText}. Campos ja salvos: ${savedFields || "nenhum"}. Proximo campo faltante: ${nextStep}. Responda a pergunta da cliente primeiro, mantenha todos os campos salvos, nunca pergunte novamente campo preenchido e retome exatamente do proximo campo faltante.`,
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
    bookingGuidance,
    historyBlock,
    history && history.length > 0
      ? "ATENÇÃO MÁXIMA: Esta NÃO é a primeira mensagem da conversa. Já existe histórico recente. NUNCA repita saudações, boas-vindas ou apresentações. Vá direto à dúvida/assunto da cliente de forma curta e objetiva."
      : "",
    "REGRA DE CONVERSA NATURAL: durante agendamento, aceite respostas livres como hoje a tarde, depois do almoco, perto das 12, amiga consegue mais tarde, esse horario nao da e pode ser amanha cedo. Converta isso em data/periodo/horario e nao peca novamente dados ja salvos na sessao.",
    "REGRA DE VALORES: preenchimento de pontas, alongamento parcial, volume, correcao de comprimento e reposicao de mechas sao assuntos do salao. Se nao houver preco exato cadastrado, diga que depende da quantidade de cabelo e da tecnica, e ofereca explicacao ou avaliacao.",
    "A mensagem atual é a prioridade. Use o histórico apenas para continuidade; se a cliente mudar de assunto, responda ao novo assunto sem repetir o serviço anterior. Não presuma que a dúvida é sobre Fibra Russa quando a mensagem atual não mencionar essa técnica nem for uma continuação inequívoca dela.",
    "Responda em até 700 caracteres, em português do Brasil, sem inventar dados. Não repita uma pergunta cuja resposta já esteja no histórico. Se a cliente quiser agendar, avance pelo fluxo de pré-agendamento. Nunca diga que um horário foi confirmado sem persistência real no backend.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const optionalContext = [
    clean(commercialContext).slice(0, 1600),
    clean(knowledgeContext).slice(0, 1300),
    `Cliente já cadastrada: ${knownClient ? "sim" : "não"}.`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const optionalBudget = Math.max(0, MAX_AI_MESSAGE_CHARS - requiredContext.length - 4);
  return `${optionalContext.slice(0, optionalBudget)}\n\n${requiredContext}`.trim();
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
            client_id,phone_number,professional_id,session_id,status,ai_enabled,last_message_at,last_message_preview,origin
          ) values($1,$2,$3,$4,'ai',true,now(),$5,'whatsapp_ai')
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
      messageId: messageRows[0].id,
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

async function recordOutboundAiMessage({ conversationId, providerMessageId, text, payload = {} }) {
  return transaction(async (client) => {
    const { rows } = await client.query(
      `insert into public.whatsapp_messages(
        conversation_id,provider_message_id,direction,sender_type,body,payload
      ) values($1,$2,'outbound','ai',$3,$4)
      returning *`,
      [conversationId, providerMessageId || null, text, JSON.stringify(prunePayload(payload))],
    );
    await client.query(
      `update public.whatsapp_conversations
          set last_message_at=now(),last_message_preview=$2,updated_at=now()
        where id=$1`,
      [conversationId, text.slice(0, 240)],
    );
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
      JSON.stringify(usage ? [{ tool: "openai", usage }] : []),
      status,
      errorMessage,
    ],
  );
}

async function performSendTextAndRecord({ normalized, conversationId, text, reason }) {
  const result = await sendBaileysTextMessage({
    number: normalized.phoneNumber,
    text,
    skipStatusCheck: true,
  });
  const sent = await recordOutboundAiMessage({
    conversationId,
    providerMessageId: result.data?.messageId || null,
    text,
    payload: { reason, provider: result.data },
  });
  return { sent, provider: result.data };
}

export async function sendTextAndRecord(args) {
  return performSendTextAndRecord(args);
}

async function requestHumanAttention({ conversationId, messageId, reason, responseText }) {
  await transaction(async (client) => {
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
      eventType: "human_attention_requested",
      status: "warning",
      details: { reason, responseText, action: "keep_ai_enabled" },
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
    const evaluation = bookable.find((service) => serviceSearchText(service).includes("avaliacao")) || bookable[0];
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

export function buildLocalIntentResponse(text, base = {}) {
  const normalized = normalizeText(text);
  if (!normalized) return null;

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

  return null;
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

export async function processIncomingWhatsAppWebhook(payload = {}) {
  const receivedAt = new Date();
  const normalized = normalizeIncomingWhatsappPayload(payload);

  if (normalized.isGroup || normalized.isStatus) {
    await recordIgnoredWebhook(normalized, "unsupported_chat");
    return { ignored: true, reason: "unsupported_chat" };
  }
  if (normalized.isFromMe) {
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
  const recorded = await recordInboundMessage(normalized);
  const settings = await getAiSettings();
  const base = await getAiCommercialBase();
  const conversationId = recorded.conversation.id;
  const inboundMessageId = recorded.message.id;

  await query(
    `insert into public.whatsapp_incoming_queue(phone_number, message_id, text)
     values($1, $2, $3)`,
    [normalized.phoneNumber, normalized.messageId, normalized.text],
  );

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

  // 6. Keywords checkpoints
  if (keywordInText(concatenatedText, settings.resumeKeyword)) {
    await query(
      `update public.whatsapp_conversations
          set status='ai',ai_enabled=true,updated_at=now()
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

  if (recorded.conversation.ai_enabled === false) {
    const status = String(recorded.conversation.status || "").toLowerCase();
    if (status && status !== "human") {
      await query(
        `update public.whatsapp_conversations
            set status='ai', ai_enabled=true, updated_at=now()
          where id=$1`,
        [conversationId],
      );
      await query(
        `insert into public.whatsapp_message_logs(conversation_id,message_id,event_type,status,details)
         values($1,$2,'conversation_auto_resumed','info',$3)`,
        [
          conversationId,
          inboundMessageId,
          JSON.stringify({ reason: "stale_ai_disabled", previousStatus: status }),
        ],
      );
    } else {
      await query(
        `insert into public.whatsapp_message_logs(conversation_id,message_id,event_type,status,details)
         values($1,$2,'ai_skipped','info',$3)`,
        [conversationId, inboundMessageId, JSON.stringify({ reason: "conversation_paused" })],
      );
      await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
      return { ok: true, replied: false, reason: "conversation_paused", conversationId };
    }
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

  const localGreetingResponse = buildLocalGreetingResponse(concatenatedText, {
    date: processingStartedAt,
    timezone: settings.timezone,
    salonName: settings.salonName,
  });
  if (localGreetingResponse) {
    const currentBookingState = parseJsonObject(recorded.conversation.booking_state);
    const shouldResetBooking = shouldResetBookingStateOnGreeting(concatenatedText, currentBookingState);
    if (shouldResetBooking) await saveBookingState(conversationId, {});

    await sendTextAndRecord({
      normalized,
      conversationId,
      text: localGreetingResponse,
      reason: shouldResetBooking ? "booking_state_reset_greeting" : "greeting_template",
    });
    await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });

    await logAiRequest({
      conversationId,
      messageId: inboundMessageId,
      provider: "local_template",
      model: "time_based_greeting",
      status: shouldResetBooking ? "state_reset_greeting" : "success",
      retryCount: 0,
      fallbackUsed: false,
      totalLatencyMs: Date.now() - receivedAt.getTime(),
      queueLatencyMs,
      providerLatencyMs: 0,
      inputTokens: 0,
      outputTokens: 0,
    });

    return {
      ok: true,
      replied: true,
      reason: shouldResetBooking ? "booking_state_reset_greeting" : "greeting_template",
      conversationId,
    };
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
          (select resumed_at from latest_resume),
          (select created_at from public.whatsapp_conversations where id=$1),
          '-infinity'::timestamptz
        )`,
    [conversationId, settings.resumeKeyword],
  );
  if (Number(count.rows[0]?.total || 0) >= settings.maxAutoMessages) {
    await query(
      `insert into public.whatsapp_message_logs(conversation_id,message_id,event_type,status,details)
       values($1,$2,'auto_message_limit_reached','warning',$3)`,
      [
        conversationId,
        inboundMessageId,
        JSON.stringify({
          total: Number(count.rows[0]?.total || 0),
          limit: settings.maxAutoMessages,
          action: "continue_ai",
        }),
      ],
    );
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
  const hasActiveBookingState = isActiveBookingState(currentStateForRouting);
  console.log("whatsapp-ai-engine execution log:", {
    phone: normalized.phoneNumber,
    lastIntent: recorded.conversation.last_intent || null,
    currentFlow: currentStateForRouting ? currentStateForRouting.status : null,
    currentStep: currentStateForRouting ? currentStateForRouting.step : null,
    hasActiveState: hasActiveBookingState,
    message: concatenatedText,
    historyLength: history.length,
    history: history.map(h => ({ sender: h.sender_type, body: h.body ? h.body.slice(0, 50) : "" })),
  });

  // PRIORIDADE 1: Estado ativo de agendamento é verificado ANTES de qualquer análise
  // de palavras-chave. Se há contexto ativo, a resposta do usuário é sempre tratada
  // como continuação do fluxo — nunca como mensagem fora do escopo.
  if (hasActiveBookingState) {
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

  const localAgendaAvailability = await handleLocalAgendaAvailabilityIntent({
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

  const hasQuestion = isClientAskingQuestion(concatenatedText) ||
                      isReplyingToExplanationOffer(concatenatedText, history) ||
                      isClientChangingSubjectOrNegating(concatenatedText);

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

  const localIntentResponse = buildLocalIntentResponse(concatenatedText, base);
  if (localIntentResponse) {
    await sendTextAndRecord({
      normalized,
      conversationId,
      text: localIntentResponse,
      reason: "local_intent_reply",
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
      outputTokens: Math.round(localIntentResponse.length / 4),
    });

    return { ok: true, replied: true, reason: "local_intent_reply", conversationId };
  }

  const outOfScopeResponse = buildOutOfScopeResponse(concatenatedText);
  // Quando há estado ativo de agendamento, o guard de fora do escopo é completamente
  // ignorado: o usuário está respondendo a uma pergunta do bot e sua mensagem deve
  // sempre seguir para o fluxo de agendamento ou para a IA — nunca retornar a
  // mensagem genérica de restrição de escopo.
  if (
    outOfScopeResponse &&
    !hasActiveBookingState &&
    !(
      matchedArticle ||
      hasCommercialCatalogReference(concatenatedText, base)
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
      model: "domain_scope",
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

  // 8. Start Placeholder typing indicator timer (4 seconds)
  let typingPlaceholderSent = false;
  const placeholderTimer = setTimeout(async () => {
    typingPlaceholderSent = true;
    try {
      await sendBaileysTextMessage({
        number: normalized.phoneNumber,
        text: "Só um instante, estou verificando isso para você 😊",
        skipStatusCheck: true,
      });
      await recordOutboundAiMessage({
        conversationId,
        providerMessageId: null,
        text: "Só um instante, estou verificando isso para você 😊",
        payload: { reason: "typing_placeholder" },
      });
    } catch (e) {
      console.error("Failed to send typing placeholder", e.message);
    }
  }, 4000);

  // 9. Load AI Context & Prompt
  const currentState = parseJsonObject(recorded.conversation.booking_state);
  const agendaAvailabilityContext = await getAgendaAvailabilityContext(query, concatenatedText, base, currentState);

  const booking = buildBookingGuidance({
    incomingText: concatenatedText,
    history,
    knownClient: Boolean(recorded.client),
    settings,
    currentState,
  });
  const commercialContext = summarizeAiCommercialContext(base, settings);
  const systemPrompt = buildRuntimePrompt(settings);

  let knowledgeContext = "";
  if (agendaAvailabilityContext) {
    knowledgeContext = `${agendaAvailabilityContext}\n\n`;
  }

  if (matchedArticle) {
    knowledgeContext += [
      `Base de Conhecimento Aprovada - Artigo: "${matchedArticle.title}" (Nível ${safetyLevel})`,
      `Resposta Curta: ${matchedArticle.short_answer}`,
      `Resposta Completa: ${matchedArticle.full_answer}`,
      matchedArticle.recommended_followup_questions?.length > 0
        ? `Perguntas sugeridas para triagem: ${JSON.stringify(matchedArticle.recommended_followup_questions)}`
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
  });

  let finalResponse = null;
  let finalProvider = settings.provider || "openai";
  let finalModel = null;
  let finalUsage = null;
  let retryCountTotal = 0;
  const fallbackUsed = false;
  let errorMsg = null;
  let errorCode = null;
  let providerStartedAt = null;
  let providerFinishedAt = null;

  const provider = String(settings.provider || "openai").toLowerCase().trim();
  let isConfigured = false;
  let isEnabled = false;
  let defaultModel = "gpt-4o-mini";

  if (provider === "gemini") {
    const status = geminiPublicStatus();
    isConfigured = status.configured || Boolean(settings.geminiApiKey);
    isEnabled = status.enabled || settings.geminiEnabled;
    defaultModel = status.model || "gemini-2.5-flash-lite";
  } else if (provider === "groq" || provider === "grok") {
    const status = groqPublicStatus();
    isConfigured = status.configured || Boolean(settings.groqApiKey);
    isEnabled = status.enabled || settings.groqEnabled;
    defaultModel = status.model || "llama-3.1-8b-instant";
  } else {
    const status = openAiPublicStatus();
    isConfigured = status.configured || Boolean(settings.openaiApiKey);
    isEnabled = status.enabled || settings.openaiEnabled;
    defaultModel = status.model || "gpt-4o-mini";
  }

  if (!isEnabled || !isConfigured) {
    const missingReason = !isEnabled ? "disabled" : "not_configured";
    console.warn(`AI provider ${provider} skipped: ${missingReason}.`, {
      enabled: isEnabled,
      configured: isConfigured,
      model: settings.model || defaultModel,
    });
    errorMsg = `Provedor ${provider} não está habilitado/configurado no ambiente ou painel.`;
    errorCode = `${provider.toUpperCase()}_${missingReason.toUpperCase()}`;
  } else {
    const retries = settings.maxRetries ?? 2;
    let currentAttempt = 0;
    providerStartedAt = new Date();

    const activeModel = settings.model || defaultModel;

    while (currentAttempt <= retries && !finalResponse) {
      try {
        if (currentAttempt > 0) {
          retryCountTotal++;
          await delay(getRetryDelay(currentAttempt));
        }

        let result;
        if (provider === "gemini") {
          result = await generateGeminiText({
            systemPrompt,
            message: promptMessage,
            model: activeModel,
            timeoutMs: settings.timeoutMs || 12000,
            maxTokens: settings.maxResponseTokens || 300,
            apiKey: settings.geminiApiKey || null,
          });
        } else if (provider === "groq" || provider === "grok") {
          result = await generateGroqText({
            systemPrompt,
            message: promptMessage,
            model: activeModel,
            timeoutMs: settings.timeoutMs || 12000,
            maxTokens: settings.maxResponseTokens || 300,
            apiKey: settings.groqApiKey || null,
          });
        } else {
          result = await generateOpenAiText({
            systemPrompt,
            message: promptMessage,
            model: activeModel,
            timeoutMs: settings.timeoutMs || 12000,
            maxTokens: settings.maxResponseTokens || 300,
            apiKey: settings.openaiApiKey || null,
          });
        }

        finalResponse = result.text;
        finalModel = result.model;
        finalUsage = result.usage;
      } catch (err) {
        console.error(
          `AI provider ${provider} failed (attempt ${currentAttempt + 1}/${retries + 1}): ${err.message}`,
        );
        errorMsg = err.message;
        errorCode = err.code || null;
        if (err.code === "RESOURCE_EXHAUSTED" || err.status === 429 || err.status === 401) break;
        currentAttempt++;
      }
    }
    providerFinishedAt = new Date();

    const lastAiMessage = history.filter(item => item.sender_type === "ai").pop();
    const lastAiText = lastAiMessage ? lastAiMessage.body : "";

    if (finalResponse && lastAiText && finalResponse.trim() === lastAiText.trim()) {
      try {
        const loopPrompt = `${systemPrompt}\n\nATENÇÃO: Sua resposta gerada foi exatamente idêntica à última resposta enviada: "${finalResponse}". Para evitar repetição e loops, gere uma resposta diferente, mais natural e contextualizada.`;
        let result;
        if (provider === "gemini") {
          result = await generateGeminiText({
            systemPrompt: loopPrompt,
            message: promptMessage,
            model: activeModel,
            timeoutMs: settings.timeoutMs || 12000,
            maxTokens: settings.maxResponseTokens || 300,
            apiKey: settings.geminiApiKey || null,
          });
        } else if (provider === "groq" || provider === "grok") {
          result = await generateGroqText({
            systemPrompt: loopPrompt,
            message: promptMessage,
            model: activeModel,
            timeoutMs: settings.timeoutMs || 12000,
            maxTokens: settings.maxResponseTokens || 300,
            apiKey: settings.groqApiKey || null,
          });
        } else {
          result = await generateOpenAiText({
            systemPrompt: loopPrompt,
            message: promptMessage,
            model: activeModel,
            timeoutMs: settings.timeoutMs || 12000,
            maxTokens: settings.maxResponseTokens || 300,
            apiKey: settings.openaiApiKey || null,
          });
        }
        finalResponse = result.text;
      } catch (err) {
        console.error("Regenerating response to prevent loop failed:", err.message);
      }
    }
  }

  // Clear typing indicator placeholder timer
  clearTimeout(placeholderTimer);

  // Turn off typing indicator
  await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });

  const totalFinishedAt = new Date();
  const totalLatencyMs = totalFinishedAt.getTime() - receivedAt.getTime();
  const providerLatencyMs =
    providerStartedAt && providerFinishedAt
      ? providerFinishedAt.getTime() - providerStartedAt.getTime()
      : 0;

  if (finalResponse) {
    if (booking.shouldRegister) {
      await requestHumanAttention({
        conversationId,
        messageId: inboundMessageId,
        reason: "booking_request",
        responseText: finalResponse,
      });
    }

    // Send response
    await sendTextAndRecord({
      normalized,
      conversationId,
      text: finalResponse,
      reason: `${finalProvider}_reply`,
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
      reason: `${finalProvider}_reply`,
      conversationId,
      model: finalModel,
    };
  } else {
    console.error("OpenAI provider failed. Triggering contingency response.");

    let contingencyReplied = false;
    if (settings.contingencyEnabled) {
      const contingencyText =
        "Olá! Recebi sua mensagem, mas nosso atendimento automático está com uma instabilidade momentânea. Pode tentar me enviar de novo em instantes, por favor?";
      await sendTextAndRecord({
        normalized,
        conversationId,
        text: contingencyText,
        reason: "contingency_reply",
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
      provider: "openai",
      model: settings.primaryModel || settings.model || "gpt-4o",
      status: contingencyReplied ? "contingency_reply" : "provider_error",
      retryCount: retryCountTotal,
      fallbackUsed: false,
      queueLatencyMs,
      providerLatencyMs,
      totalLatencyMs,
      errorCode: errorCode || "OPENAI_PROVIDER_FAILED",
      errorMessage: errorMsg || "OpenAI provider failed.",
    });

    return {
      ok: true,
      replied: contingencyReplied,
      reason: contingencyReplied ? "contingency_reply" : "providers_failed",
      conversationId,
    };
  }
}
