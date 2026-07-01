import { query, transaction } from "./db.js";
import {
  buildRuntimePrompt,
  ensureAiWhatsappSchema,
  getAiCommercialBase,
  getAiSettings,
  invalidateAiSettingsCache,
} from "./ai-whatsapp.js";
import { generateGeminiText, geminiPublicStatus } from "./gemini-client.js";
import { generateGroqText, groqPublicStatus } from "./groq-client.js";
import { sendBaileysTextMessage, sendBaileysPresence } from "./baileys-client.js";

const MAX_GEMINI_MESSAGE_CHARS = 4000;

const clean = (value) => String(value ?? "").trim();

function normalizeText(value) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function truthy(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function extractRawText(raw) {
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

function jidToPhone(value) {
  const jid = clean(value);
  if (!jid || jid.endsWith("@g.us") || jid === "status@broadcast") return "";
  const number = jid.replace(/@(?:s\.whatsapp\.net|c\.us|lid|broadcast)$/i, "");
  return number.replace(/\D/g, "");
}

function firstValidPhone(...values) {
  for (const value of values) {
    const number = jidToPhone(value);
    if (/^55\d{10,11}$/.test(number)) return number;
  }
  return "";
}

export function normalizeIncomingWhatsappPayload(payload = {}) {
  const raw = payload.raw || payload.message || {};
  const key = raw?.key || payload.key || {};
  const from =
    clean(payload.from || payload.remoteJid || payload.jid || key.remoteJid) ||
    "";
  const phoneNumber = firstValidPhone(
    payload.phone,
    payload.number,
    payload.senderPn,
    raw.senderPn,
    key.remoteJidAlt,
    key.participantAlt,
    from,
    payload.remoteJid,
    payload.participant,
    key.participant,
    key.remoteJid,
  );
  const text = clean(payload.text || payload.body || extractRawText(raw));
  const isFromMe = truthy(payload.isFromMe ?? payload.fromMe ?? key.fromMe);
  const messageId = clean(
    payload.messageId || payload.id || payload.provider_message_id || key.id,
  );
  const sessionName =
    clean(payload.session_name || payload.instance || payload.session) ||
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
    messageId: messageId || null,
    timestamp: payload.timestamp || raw?.messageTimestamp || null,
    raw: payload,
  };
}

export function isMessageWebhookPayload(payload = {}) {
  const normalized = normalizeIncomingWhatsappPayload(payload);
  return Boolean(
    normalized.from ||
      normalized.phoneNumber ||
      normalized.text ||
      normalized.messageId ||
      payload.raw?.key,
  );
}

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

async function findClientByPhone(client, phoneNumber) {
  const withCountry = clean(phoneNumber).replace(/\D/g, "");
  if (!withCountry) return null;
  const local = withCountry.startsWith("55") ? withCountry.slice(2) : withCountry;
  const { rows } = await client.query(
    `select c.id,p.full_name
       from public.clients c
       join public.profiles p on p.id=c.profile_id
      where regexp_replace(coalesce(p.phone,''), '\\D', '', 'g') = any($1::text[])
      limit 1`,
    [[withCountry, local]],
  );
  return rows[0] || null;
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

async function loadRecentHistory(conversationId) {
  const { rows } = await query(
    `select direction,sender_type,body,created_at
       from public.whatsapp_messages
      where conversation_id=$1 and body is not null
      order by created_at desc
      limit 8`,
    [conversationId],
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

export function summarizeAiCommercialContext(base) {
  const services = (base.services || [])
    .filter((service) => service.active && service.ai_active)
    .slice(0, 10)
    .map((service) => {
      const price = Number(service.initial_price || service.base_price || 0);
      const priceText = price > 0 ? `valor inicial R$ ${price.toFixed(2)}` : "valor sob consulta";
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

  return [
    "Dados reais liberados para esta resposta:",
    services.length ? `Serviços:\n${services.join("\n")}` : "Serviços: nenhum serviço foi liberado para atendimento automático.",
    plans.length ? `Planos ativos:\n${plans.join("\n")}` : "Planos ativos: nenhum plano ativo encontrado.",
    coupons.length ? `Cupons ativos:\n${coupons.join("\n")}` : "Cupons ativos: nenhum cupom ativo encontrado.",
    "Nesta etapa, não crie agendamento, não prometa horário e não envie link de pagamento. Oriente e diga que a equipe confirma quando necessário.",
  ].join("\n\n");
}

export function buildGeminiConversationMessage({
  incomingText,
  history = [],
  commercialContext,
  knowledgeContext = "",
  knownClient = false,
}) {
  const historyText = history
    .slice(-8)
    .map((item) => {
      const speaker = item.sender_type === "ai" ? "Assistente" : "Cliente";
      return `${speaker}: ${clean(item.body).slice(0, 600)}`;
    })
    .join("\n");

  return [
    commercialContext,
    knowledgeContext,
    `Cliente já cadastrada: ${knownClient ? "sim" : "não"}.`,
    historyText ? `Histórico recente:\n${historyText}` : "Histórico recente: primeira mensagem desta conversa.",
    `Mensagem atual da cliente:\n${clean(incomingText)}`,
    "Nesta etapa, não crie agendamento, não prometa horário e não envie link de pagamento. Oriente e diga que a equipe confirma quando necessário. Responda em até 700 caracteres, em português do Brasil, sem inventar dados. Se a cliente perguntar algo sobre técnicas ou dúvidas de Mega Hair, use a resposta aprovada e faça até duas perguntas curtas para personalização. Se for recomendado avaliação, sugira agendar de forma natural.",
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, MAX_GEMINI_MESSAGE_CHARS);
}

async function recordInboundMessage(normalized) {
  await ensureAiWhatsappSchema();
  return transaction(async (client) => {
    const session = await client.query(
      "select id,professional_id from public.whatsapp_sessions where session_name=$1 limit 1",
      [normalized.sessionName],
    );
    const foundClient = await findClientByPhone(client, normalized.phoneNumber);
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
      JSON.stringify(usage ? [{ tool: "gemini", usage }] : []),
      status,
      errorMessage,
    ],
  );
}

async function sendTextAndRecord({ normalized, conversationId, text, reason }) {
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

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSimpleGreeting(text) {
  const normalized = String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[?!.,\s-]/g, "");
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
  return greetings.includes(normalized);
}

function includesAny(normalizedText, terms) {
  return terms.some((term) => normalizedText.includes(term));
}

function findAiService(base, terms) {
  const normalizedTerms = terms.map(normalizeText).filter(Boolean);
  return (base.services || []).find((service) => {
    if (!service.active) return false;
    const text = normalizeText(
      [
        service.commercial_name,
        service.name,
        service.short_description,
        service.detailed_description,
        service.description,
        service.recommended_message,
      ]
        .filter(Boolean)
        .join(" "),
    );
    return normalizedTerms.some((term) => text.includes(term));
  });
}

function serviceName(service, fallback) {
  return clean(service?.commercial_name || service?.name || fallback);
}

export function buildLocalIntentResponse(text, base = {}) {
  const normalized = normalizeText(text);
  if (!normalized) return null;

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

  const mentionsFibraRussa =
    normalized.includes("fibra russa") ||
    normalized.includes("fibrarussa") ||
    (normalized.includes("fibra") && normalized.includes("russa"));

  if (mentionsFibraRussa) {
    const service = findAiService(base, ["fibra russa"]);
    const intro = service
      ? `Sim, temos ${serviceName(service, "Fibra Russa")} no catálogo da Carol Sol.`
      : "Sim, posso te orientar sobre Fibra Russa por aqui.";

    return [
      `${intro} ✨`,
      "Você quer fazer aplicação, manutenção ou prefere uma explicação rápida de como funciona o serviço?",
      "Se for aplicação, me diga também se é sua primeira vez com Mega Hair e se você busca mais volume, comprimento ou os dois.",
    ].join("\n\n");
  }

  return null;
}

async function activateCircuitBreaker(provider, cooldownSeconds = 60) {
  const until = new Date(Date.now() + cooldownSeconds * 1000).toISOString();
  if (provider === "gemini") {
    await query(
      "update public.ai_settings set gemini_circuit_breaker_until = $1 where business_id = 'default'",
      [until],
    );
  } else if (provider === "groq") {
    await query(
      "update public.ai_settings set groq_circuit_breaker_until = $1 where business_id = 'default'",
      [until],
    );
  }
  invalidateAiSettingsCache();
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
  const isDuplicate = await query(
    `select 1 from public.whatsapp_incoming_queue where message_id = $1
     union
     select 1 from public.whatsapp_messages where provider_message_id = $1
     limit 1`,
    [normalized.messageId],
  );
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

  // 7. Local template greeting reply
  if (settings.cacheEnabled && isSimpleGreeting(concatenatedText)) {
    const responseText = settings.welcomeMessage;
    await sendTextAndRecord({ normalized, conversationId, text: responseText, reason: "greeting_template" });
    await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });

    // Log the mock metric for template greeting
    await logAiRequest({
      conversationId,
      messageId: inboundMessageId,
      provider: "local_template",
      model: "greeting",
      status: "success",
      totalLatencyMs: Date.now() - receivedAt.getTime(),
      queueLatencyMs,
      providerLatencyMs: 0,
    });

    return { ok: true, replied: true, reason: "greeting_template", conversationId };
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
  const history = await loadRecentHistory(conversationId);
  const commercialContext = summarizeAiCommercialContext(base);
  const systemPrompt = buildRuntimePrompt(settings);

  let knowledgeContext = "";
  if (matchedArticle) {
    knowledgeContext = [
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

  const promptMessage = buildGeminiConversationMessage({
    incomingText: concatenatedText,
    history: history.slice(-(settings.contextLimit || 8)),
    commercialContext,
    knowledgeContext,
    knownClient: Boolean(recorded.client),
  });

  const providersOrder = [];
  if (settings.primaryProvider === "groq") {
    providersOrder.push("groq", "gemini");
  } else {
    providersOrder.push("gemini", "groq");
  }

  let finalResponse = null;
  let finalProvider = null;
  let finalModel = null;
  let finalUsage = null;
  let retryCountTotal = 0;
  let fallbackUsed = false;
  let errorMsg = null;
  let errorCode = null;
  let providerStartedAt = null;
  let providerFinishedAt = null;

  for (let pIdx = 0; pIdx < providersOrder.length; pIdx++) {
    const currentProvider = providersOrder[pIdx];
    const isFallbackStep = pIdx > 0;

    // Skip if fallback disabled
    if (isFallbackStep && !settings.fallbackEnabled) {
      break;
    }

    const runtimeStatus = currentProvider === "gemini" ? geminiPublicStatus() : groqPublicStatus();
    if (!runtimeStatus.enabled || !runtimeStatus.configured) {
      const missingReason = !runtimeStatus.enabled ? "disabled" : "not_configured";
      console.warn(`AI provider ${currentProvider} skipped: ${missingReason}.`, {
        enabled: runtimeStatus.enabled,
        configured: runtimeStatus.configured,
        model: runtimeStatus.model,
      });
      errorMsg =
        currentProvider === "gemini"
          ? "Gemini não está habilitado/configurado no ambiente."
          : "Groq não está habilitado/configurado no ambiente.";
      errorCode = `${currentProvider.toUpperCase()}_${missingReason.toUpperCase()}`;
      if (!isFallbackStep) fallbackUsed = true;
      continue;
    }

    // Check circuit breaker
    const isGeminiInCooldown =
      currentProvider === "gemini" &&
      settings.geminiCircuitBreakerUntil &&
      new Date(settings.geminiCircuitBreakerUntil) > new Date();
    const isGroqInCooldown =
      currentProvider === "groq" &&
      settings.groqCircuitBreakerUntil &&
      new Date(settings.groqCircuitBreakerUntil) > new Date();

    if (isGeminiInCooldown || isGroqInCooldown) {
      console.log(`Skipping provider ${currentProvider} due to active circuit breaker.`);
      fallbackUsed = true;
      continue;
    }

    let success = false;
    let retries =
      currentProvider === "gemini"
        ? settings.maxRetries ?? 2
        : Math.max(0, (runtimeStatus.keyCount || 1) - 1);
    let currentAttempt = 0;

    providerStartedAt = new Date();

    while (currentAttempt <= retries && !success) {
      try {
        if (currentAttempt > 0) {
          retryCountTotal++;
          const delayTime = getRetryDelay(currentAttempt);
          await delay(delayTime);
        }

        if (currentProvider === "gemini") {
          const result = await generateGeminiText({
            systemPrompt,
            message: promptMessage,
            model: settings.primaryProvider === "gemini" ? settings.model : settings.primaryModel,
            timeoutMs: settings.timeoutMs || 7000,
            maxTokens: settings.maxResponseTokens || 220,
            apiKeyIndex: currentAttempt, // Rotate key index on retry
          });
          finalResponse = result.text;
          finalModel = result.model;
          finalUsage = result.usage;
        } else {
          const result = await generateGroqText({
            systemPrompt,
            message: promptMessage,
            model: settings.primaryProvider === "groq" ? settings.model : settings.fallbackModel,
            timeoutMs: settings.timeoutMs || 7000,
            maxTokens: settings.maxResponseTokens || 220,
          });
          finalResponse = result.text;
          finalModel = result.model;
          finalUsage = result.usage;
        }

        finalProvider = currentProvider;
        success = true;
      } catch (err) {
        console.error(
          `AI provider ${currentProvider} failed (attempt ${currentAttempt + 1}/${retries + 1}): ${
            err.message
          }`,
        );
        errorMsg = err.message;
        errorCode = err.code || null;

        if (err.code === "RESOURCE_EXHAUSTED" || err.status === 429) {
          if (currentProvider === "groq" && currentAttempt < retries) {
            currentAttempt++;
            continue;
          }
          // Open circuit breaker for this provider
          console.log(`Rate limit detected on ${currentProvider}. Opening circuit breaker.`);
          await activateCircuitBreaker(
            currentProvider,
            settings.circuitBreakerCooldownSeconds || 60,
          );
          break; // Don't retry, fall through to fallback provider immediately
        }

        currentAttempt++;
      }
    }

    providerFinishedAt = new Date();

    if (success) {
      if (isFallbackStep) {
        fallbackUsed = true;
      }
      break;
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
        Math.round(promptMessage.length / 4)
      : Math.round(promptMessage.length / 4);
    const outputTokens = finalUsage
      ? finalUsage.candidatesTokenCount ||
        finalUsage.completion_tokens ||
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
    // BOTH Providers failed. Reply with a contingency message, but keep AI enabled.
    console.error("All AI providers failed. Triggering contingency response.");

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
      provider: providersOrder[0],
      model: settings.model,
      status: contingencyReplied ? "contingency_reply" : "provider_error",
      retryCount: retryCountTotal,
      fallbackUsed: settings.fallbackEnabled,
      queueLatencyMs,
      providerLatencyMs,
      totalLatencyMs,
      errorCode: errorCode || "ALL_PROVIDERS_FAILED",
      errorMessage: errorMsg || "All AI providers failed.",
    });

    return {
      ok: true,
      replied: contingencyReplied,
      reason: contingencyReplied ? "contingency_reply" : "providers_failed",
      conversationId,
    };
  }
}
