import { weekdayForDate } from "../availability-rules.js";
import {
  clean,
  normalizeText,
  localDateParts,
  addLocalDays,
  formatDateLabel,
  isActiveBookingState,
  hasBookingStateProgress,
  includesAny,
} from "./utils.js";

export const aiDomainTerms = [
  "mega hair",
  "megahair",
  "alongamento",
  "aplique",
  "aplicacao",
  "aplicar",
  "manutencao",
  "retirada",
  "remocao",
  "fibra russa",
  "fita",
  "queratina",
  "microlink",
  "nanopele",
  "lace",
  "peruca",
  "protese capilar",
  "cabelo",
  "cabelos",
  "fio",
  "fios",
  "couro cabeludo",
  "raiz",
  "mecha",
  "mechas",
  "ponta",
  "pontas",
  "preenchimento",
  "preencher",
  "alongamento parcial",
  "parcial",
  "volume",
  "comprimento",
  "correcao",
  "corrigir",
  "reposicao",
  "repor",
  "queda",
  "quebra",
  "coceira",
  "irritacao",
  "oleosidade",
  "progressiva",
  "quimica",
  "loiro",
  "descolorido",
  "lavar",
  "pentear",
  "cuidados",
  "avaliacao",
  "diagnostico",
];

export const salonOperationalTerms = [
  "agendar",
  "agendamento",
  "agenda",
  "horario",
  "disponivel",
  "disponibilidade",
  "encaixe",
  "servico",
  "servicos",
  "valor",
  "preco",
  "orcamento",
  "custa",
  "quanto fica",
  "quanto esta",
  "promocao",
  "promocoes",
  "promocional",
  "desconto",
  "descontos",
  "oferta",
  "ofertas",
  "campanha",
  "liquidacao",
  "promo",
  "sinal",
  "pagamento",
  "pix",
  "cartao",
  "cupom",
  "endereco",
  "localizacao",
  "funcionamento",
  "atendente",
  "equipe",
  "salao",
  "carol sol",
  "registrar",
  "confirmar",
  "confirmo",
  "pode registrar",
  "pode confirmar",
];

export const clearlyOutOfScopeTerms = [
  "receita",
  "bolo",
  "comida",
  "cozinha",
  "futebol",
  "jogo",
  "politica",
  "programacao",
  "codigo",
  "filme",
  "serie",
  "musica",
  "noticia",
  "matematica",
  "viagem",
  "hotel",
];

export function keywordInText(text, keyword) {
  const needle = normalizeText(keyword);
  if (!needle) return false;
  return normalizeText(text).includes(needle);
}

export function isWithinAiHours(settings, now = new Date()) {
  if (settings.allow24h) return true;
  if (!settings.aiStartTime || !settings.aiEndTime) return false;
  const formatter = new Intl.DateTimeFormat("pt-BR", {
    timeZone: settings.timezone || "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const current = formatter.format(now);
  const start = settings.aiStartTime;
  const end = settings.aiEndTime;
  if (start <= end) return current >= start && current <= end;
  return current >= start || current <= end;
}

export function numericChoice(text) {
  const normalized = normalizeText(text);
  if (/^\s*\d{1,2}\s*h\b/.test(normalized)) return null;
  const match = normalized.match(/^\s*(?:opcao\s*)?(\d{1,2})(?:\s*[\).:-]?\s*$|\s+[\p{L}])/u);
  return match ? Number(match[1]) : null;
}

export function dateOptionsFrom(date = localDateParts()) {
  return [
    { id: 1, date, label: `Hoje (${formatDateLabel(date)})` },
    { id: 2, date: addLocalDays(date, 1), label: `Amanhã (${formatDateLabel(addLocalDays(date, 1))})` },
    { id: 3, date: addLocalDays(date, 2), label: `Depois de amanhã (${formatDateLabel(addLocalDays(date, 2))})` },
  ];
}

export function parseBookingDateFromText(text, state = {}) {
  const choice = numericChoice(text);
  if (choice && Array.isArray(state.dateOptions)) {
    const selected = state.dateOptions.find((item) => Number(item.id) === choice);
    if (selected?.date) return selected.date;
  }

  const normalized = normalizeText(text);
  const today = localDateParts();
  if (/\b(hoje|hj)\b/.test(normalized)) return today;
  if (/\b(amanha|amanhã)\b/.test(normalized)) return addLocalDays(today, 1);
  if (/depois de amanha|depois de amanhã/.test(normalized)) return addLocalDays(today, 2);

  const iso = normalized.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const slash = normalized.match(/\b(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?\b/);
  if (slash) {
    const day = Number(slash[1]);
    const month = Number(slash[2]);
    const currentYear = Number(today.slice(0, 4));
    let year = slash[3] ? Number(slash[3]) : currentYear;
    if (year < 100) year += 2000;
    const candidate = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (new Date(`${candidate}T12:00:00.000Z`).toString() !== "Invalid Date") {
      if (!slash[3] && candidate < today) {
        return `${String(year + 1).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      }
      return candidate;
    }
  }

  const weekdayTerms = [
    ["domingo", 0],
    ["segunda", 1],
    ["terca", 2],
    ["terça", 2],
    ["quarta", 3],
    ["quinta", 4],
    ["sexta", 5],
    ["sabado", 6],
    ["sábado", 6],
  ];
  const found = weekdayTerms.find(([label]) => normalized.includes(label));
  if (found) {
    const currentWeekday = weekdayForDate(today);
    const target = found[1];
    const diff = (target - currentWeekday + 7) % 7 || 7;
    return addLocalDays(today, diff);
  }
  return "";
}

export function parseBookingTimeFromText(text) {
  const normalized = normalizeText(text);
  if (/\b(manha|manhã)\b/.test(normalized)) return { period: "morning", time: "" };
  if (/\b(tarde)\b/.test(normalized)) return { period: "afternoon", time: "" };
  if (/\b(noite)\b/.test(normalized)) return { period: "evening", time: "" };

  const explicit = normalized.match(/(?:\b(?:as|às|horario|horário|hora)\s*)?(\d{1,2})(?:[:h](\d{2}))\b/);
  if (explicit) {
    const hour = Number(explicit[1]);
    const minute = Number(explicit[2] || 0);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return { period: "", time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` };
    }
  }
  return { period: "", time: "" };
}

export function parseFlexibleBookingTimeFromText(text) {
  const normalized = normalizeText(text);
  if (/\b(cedo|cedinho)\b/.test(normalized)) return { period: "morning", time: "" };
  if (/\b(depois do almoco|apos o almoco|apos almoco|depois de almoco|depois do meio dia|depois de meio dia|mais tarde)\b/.test(normalized)) {
    return { period: "afternoon", time: "" };
  }
  if (/\b(meio dia|meiodia|perto das 12|por volta das 12)\b/.test(normalized)) {
    return { period: "afternoon", time: "12:00" };
  }
  const colloquial = normalized.match(/\b(\d{1,2})\s*(?:da|de)\s*(manha|tarde|noite)\b/);
  if (colloquial) {
    let hour = Number(colloquial[1]);
    const period = colloquial[2];
    if (period === "tarde" && hour >= 1 && hour <= 11) hour += 12;
    if (period === "noite" && hour >= 1 && hour <= 11) hour += 12;
    if (hour >= 0 && hour <= 23) {
      return {
        period: period === "manha" ? "morning" : period === "tarde" ? "afternoon" : "evening",
        time: `${String(hour).padStart(2, "0")}:00`,
      };
    }
  }
  const explicit = normalized.match(
    /(?:\b(?:as|a?s|horario|hora|perto das|por volta das|depois das|apos as)\s*)(\d{1,2})(?:[:h](\d{0,2}))?\b|\b(\d{1,2})h(?:(\d{2}))?\b/,
  );
  if (explicit) {
    const hour = Number(explicit[1] || explicit[3]);
    const minute = Number(explicit[2] || explicit[4] || 0);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return { period: "", time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` };
    }
  }
  return parseBookingTimeFromText(text);
}

export function periodMatches(time, period) {
  if (!period) return true;
  const hour = Number(String(time).slice(0, 2));
  if (period === "morning") return hour < 12;
  if (period === "afternoon") return hour >= 12 && hour < 18;
  if (period === "evening") return hour >= 18;
  return true;
}

export function periodLabel(period) {
  if (period === "morning") return "manhã";
  if (period === "afternoon") return "tarde";
  if (period === "evening") return "noite";
  return "";
}

export function lastAiText(history = []) {
  return (history || []).filter((item) => item.sender_type === "ai").pop()?.body || "";
}

export function wantsMoreSlotOptions(text) {
  const normalized = normalizeText(text);
  return includesAny(normalized, [
    "ver mais",
    "mais horarios",
    "mais horários",
    "proximos horarios",
    "próximos horários",
    "proximo horario",
    "próximo horário",
  ]);
}

export function hasTemporalBookingSignal(text, state = {}) {
  const normalized = normalizeText(text);
  const parsedDate = parseBookingDateFromText(text, state);
  const parsedTime = parseFlexibleBookingTimeFromText(text);
  return Boolean(
    parsedDate ||
      parsedTime.time ||
      parsedTime.period ||
      wantsMoreSlotOptions(text) ||
      includesAny(normalized, [
        "depois do almoco",
        "depois do meio dia",
        "perto das",
        "por volta das",
        "mais tarde",
        "cedo",
        "cedinho",
        "qualquer horario",
        "esse horario nao da",
        "esse horario nao serve",
      ]),
  );
}

export function promptSuggestsBookingAnswer(prompt = "") {
  const normalized = normalizeText(prompt);
  return includesAny(normalized, [
    "qual dia",
    "escolha a data",
    "data preferida",
    "escolha o horario",
    "escolha o horÃ¡rio",
    "horarios disponiveis",
    "horÃ¡rios disponÃ­veis",
    "proximos horarios",
    "prÃ³ximos horÃ¡rios",
    "qual servico",
    "qual serviÃ§o",
    "escolha o servico",
    "escolha o serviÃ§o",
  ]);
}

export function isAffirmativeBookingConfirmation(text) {
  const normalized = normalizeText(text).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  return [
    "sim",
    "sim pode",
    "pode sim",
    "confirmo",
    "confirmado",
    "isso",
    "isso mesmo",
    "correto",
    "certo",
    "ok",
    "pode confirmar",
    "pode registrar",
    "sim pode registrar",
    "sim pode confirmar",
  ].includes(normalized);
}

export function isFinalBookingConfirmation(text) {
  return isAffirmativeBookingConfirmation(text) || numericChoice(text) === 1;
}

export function isFinalBookingAlteration(text) {
  const normalized = normalizeText(text);
  return numericChoice(text) === 2 || includesAny(normalized, [
    "alterar",
    "mudar",
    "trocar",
    "corrigir",
    "escolher outro",
    "escolher outro horario",
    "escolher outro horário",
    "outra data",
    "outro dia",
    "voltar",
  ]);
}

export function shouldPrioritizeBookingState(text, state = {}, history = []) {
  if (!isActiveBookingState(state)) return false;
  const normalized = normalizeText(text);
  const choice = numericChoice(text);
  if (state.status === "awaiting_contact") return true;
  if (state.status === "awaiting_confirmation") {
    return Boolean(isAffirmativeBookingConfirmation(text) || choice || hasTemporalBookingSignal(text, state));
  }
  if (state.status === "awaiting_service_details") {
    return Boolean(
      isAffirmativeBookingConfirmation(text) ||
        choice ||
        includesAny(normalized, ["verificar", "horario", "horarios", "outro servico", "outro serviço", "alterar"]),
    );
  }
  if (state.status === "awaiting_slot") {
    return Boolean(choice || hasTemporalBookingSignal(text, state));
  }
  if (state.status === "awaiting_date") {
    return hasTemporalBookingSignal(text, state);
  }
  if (state.status === "awaiting_service") {
    return Boolean(choice || includesAny(normalized, aiDomainTerms));
  }
  if (state.serviceId && hasTemporalBookingSignal(text, state)) return true;
  return promptSuggestsBookingAnswer(lastAiText(history)) && hasTemporalBookingSignal(text, state);
}

export function shouldResetBookingStateOnGreeting(text, state = {}) {
  return isSimpleGreeting(text) && hasBookingStateProgress(state);
}

export function isSimpleGreeting(text) {
  const compact = normalizeText(text)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, "")
    .trim();
  const greetings = [
    "oi",
    "olam",
    "ola",
    "oie",
    "opa",
    "bomdia",
    "boatarde",
    "boanoite",
    "hello",
    "hi",
  ];
  const allowedSuffixes = [
    "",
    "tudobem",
    "tudobom",
    "tdbem",
    "tdbom",
    "comovai",
    "bomdia",
    "boatarde",
    "boanoite",
    "carol",
  ];
  return greetings.some((greeting) => {
    if (!compact.startsWith(greeting)) return false;
    return allowedSuffixes.includes(compact.slice(greeting.length));
  });
}

export function isClientAskingQuestion(text) {
  const normalized = normalizeText(text);
  if (text.includes("?")) return true;
  const questionWords = [
    "como", "qual", "quais", "oque", "o que", "por que", "porque", "quanto", "quando", "onde", "quem", "cuja", "cujo",
    "dura", "durabilidade", "estraga", "doi", "vende", "valor", "preco", "cust", "orcamento",
    "funciona", "diferenca", "queria saber", "gostaria de saber", "me explica", "pode explicar", "saber se"
  ];
  return questionWords.some(word => normalized.includes(word));
}

export function isClientChangingSubjectOrNegating(text) {
  const normalized = normalizeText(text);
  const terms = [
    "nao quero agendar", "depois vejo", "depois marco", "so tirar duvida", "tirar duvida", "tirar uma duvida",
    "mudei de ideia", "mudei de opiniao", "quero cancelar", "cancelar", "so queria saber"
  ];
  return terms.some(term => normalized.includes(term));
}

export function isClientExitingFlow(text) {
  const normalized = normalizeText(text);
  const exitTerms = [
    "depois eu agendo",
    "depois agendo",
    "vou ver e retorno",
    "obrigado",
    "obrigada",
    "valeu",
    "depois volto",
    "vou pensar",
    "nao agora",
    "não agora",
    "mais tarde",
    "so queria saber",
    "só queria saber",
    "era so uma duvida",
    "era só uma dúvida"
  ];
  return exitTerms.some(term => normalized.includes(term));
}

export function isReplyingToExplanationOffer(text, history = []) {
  const lastAiMessage = history.filter(item => item.sender_type === "ai").pop();
  if (!lastAiMessage) return false;
  const lastAiBody = normalizeText(lastAiMessage.body);
  const offersExplanation = lastAiBody.includes("posso explicar") ||
                             lastAiBody.includes("posso te mostrar") ||
                             lastAiBody.includes("posso te informar") ||
                             lastAiBody.includes("posso detalhar") ||
                             lastAiBody.includes("quer que eu explique") ||
                             lastAiBody.includes("posso tirar essa duvida") ||
                             lastAiBody.includes("posso tirar essa dúvida");
  if (!offersExplanation) return false;
  const normalizedText = normalizeText(text).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const confirmationWords = [
    "sim", "pode", "claro", "quero", "quero saber", "pode sim", "sim pode", "com certeza", "manda", "envia", "explique"
  ];
  return confirmationWords.some(word => normalizedText === word || normalizedText.startsWith(word));
}

export function isAgendaAvailabilityIntent(text) {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  const wantsAgenda = includesAny(normalized, [
    "horario",
    "agenda",
    "disponivel",
    "disponibilidade",
    "vaga",
    "encaixe",
    "atende",
    "atendimento",
    "tem hora",
    "tem horario",
    "consegue",
    "tem como",
  ]);
  if (!wantsAgenda) return false;
  return includesAny(normalized, [
    "hoje",
    "hj",
    "amanha",
    "depois de amanha",
    "domingo",
    "segunda",
    "terca",
    "quarta",
    "quinta",
    "sexta",
    "sabado",
    "manha",
    "tarde",
    "noite",
  ]) || /\b(?:dia\s*)?\d{1,2}[\/.-]\d{1,2}(?:[\/.-]\d{2,4})?\b/.test(normalized);
}

export function isInAiServiceScope(text) {
  const normalized = normalizeText(text);
  if (!normalized) return true;
  if (isSimpleGreeting(text)) return true;
  if (isAffirmativeBookingConfirmation(text)) return true;
  const hasDomainTerm = includesAny(normalized, aiDomainTerms);
  if (hasDomainTerm) return true;
  if (includesAny(normalized, clearlyOutOfScopeTerms)) return false;
  return includesAny(normalized, salonOperationalTerms);
}
