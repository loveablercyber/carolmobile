import { query, transaction } from "./db.js";
import {
  buildRuntimePrompt,
  ensureAiWhatsappSchema,
  getAiBase,
  getAiSettings,
} from "./ai-whatsapp.js";
import { generateGeminiText, geminiPublicStatus } from "./gemini-client.js";
import { sendBaileysTextMessage } from "./baileys-client.js";

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
  const number = jid.replace(/@(?:s\.whatsapp\.net|lid|broadcast)$/i, "");
  return number.replace(/\D/g, "");
}

export function normalizeIncomingWhatsappPayload(payload = {}) {
  const raw = payload.raw || payload.message || {};
  const key = raw?.key || payload.key || {};
  const from =
    clean(payload.from || payload.remoteJid || payload.jid || key.remoteJid) ||
    "";
  const phoneNumber = jidToPhone(from || payload.phone || payload.number);
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
    `Cliente já cadastrada: ${knownClient ? "sim" : "não"}.`,
    historyText ? `Histórico recente:\n${historyText}` : "Histórico recente: primeira mensagem desta conversa.",
    `Mensagem atual da cliente:\n${clean(incomingText)}`,
    "Responda em até 700 caracteres, em português do Brasil, sem inventar dados. Não crie agendamento, não confirme horário e não envie link de pagamento nesta etapa. Se precisar de agenda, pagamento, desconto fora de cupom ou humano, explique que a equipe vai confirmar.",
  ]
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
  });
  const sent = await recordOutboundAiMessage({
    conversationId,
    providerMessageId: result.data?.messageId || null,
    text,
    payload: { reason, provider: result.data },
  });
  return { sent, provider: result.data };
}

async function pauseConversationForHuman({ conversationId, messageId, reason, responseText }) {
  await transaction(async (client) => {
    await client.query(
      `update public.whatsapp_conversations
          set status='human',ai_enabled=false,updated_at=now()
        where id=$1`,
      [conversationId],
    );
    await client.query(
      `insert into public.human_handoff_tickets(conversation_id,reason,status,created_by)
       values($1,$2,'pending',null)`,
      [conversationId, reason],
    );
    await logMessage(client, {
      conversationId,
      messageId,
      eventType: "human_handoff",
      status: "warning",
      details: { reason, responseText },
    });
  });
}

export async function processIncomingWhatsAppWebhook(payload = {}) {
  const normalized = normalizeIncomingWhatsappPayload(payload);
  if (normalized.isGroup || normalized.isStatus)
    return { ignored: true, reason: "unsupported_chat" };
  if (normalized.isFromMe) return { ignored: true, reason: "from_me" };
  if (!normalized.phoneNumber || !/^55\d{10,11}$/.test(normalized.phoneNumber))
    return { ignored: true, reason: "invalid_phone" };
  if (!normalized.text) return { ignored: true, reason: "empty_text" };

  const recorded = await recordInboundMessage(normalized);
  const settings = await getAiSettings();
  const conversationId = recorded.conversation.id;
  const inboundMessageId = recorded.message.id;

  if (keywordInText(normalized.text, settings.resumeKeyword)) {
    await query(
      `update public.whatsapp_conversations
          set status='ai',ai_enabled=true,updated_at=now()
        where id=$1`,
      [conversationId],
    );
    const responseText = settings.welcomeMessage;
    await sendTextAndRecord({ normalized, conversationId, text: responseText, reason: "resume_keyword" });
    return { ok: true, replied: true, reason: "resume_keyword", conversationId };
  }

  if (keywordInText(normalized.text, settings.pauseKeyword)) {
    const responseText = settings.humanHandoffMessage;
    await pauseConversationForHuman({
      conversationId,
      messageId: inboundMessageId,
      reason: "pause_keyword",
      responseText,
    });
    await sendTextAndRecord({ normalized, conversationId, text: responseText, reason: "pause_keyword" });
    return { ok: true, replied: true, reason: "pause_keyword", conversationId };
  }

  if (keywordInText(normalized.text, settings.stopKeyword)) {
    await query(
      `update public.whatsapp_conversations
          set status='closed',ai_enabled=false,updated_at=now()
        where id=$1`,
      [conversationId],
    );
    await sendTextAndRecord({ normalized, conversationId, text: settings.closingMessage, reason: "stop_keyword" });
    return { ok: true, replied: true, reason: "stop_keyword", conversationId };
  }

  if (!settings.enabled) {
    await query(
      `insert into public.whatsapp_message_logs(conversation_id,message_id,event_type,status,details)
       values($1,$2,'ai_skipped','info',$3)`,
      [conversationId, inboundMessageId, JSON.stringify({ reason: "settings_disabled" })],
    );
    return { ok: true, replied: false, reason: "settings_disabled", conversationId };
  }

  if (recorded.conversation.ai_enabled === false) {
    await query(
      `insert into public.whatsapp_message_logs(conversation_id,message_id,event_type,status,details)
       values($1,$2,'ai_skipped','info',$3)`,
      [conversationId, inboundMessageId, JSON.stringify({ reason: "conversation_paused" })],
    );
    return { ok: true, replied: false, reason: "conversation_paused", conversationId };
  }

  if (!settings.allowNewContacts && !recorded.client) {
    await query(
      `insert into public.whatsapp_message_logs(conversation_id,message_id,event_type,status,details)
       values($1,$2,'ai_skipped','info',$3)`,
      [conversationId, inboundMessageId, JSON.stringify({ reason: "new_contacts_disabled" })],
    );
    return { ok: true, replied: false, reason: "new_contacts_disabled", conversationId };
  }

  if (!settings.allowExistingClients && recorded.client) {
    await query(
      `insert into public.whatsapp_message_logs(conversation_id,message_id,event_type,status,details)
       values($1,$2,'ai_skipped','info',$3)`,
      [conversationId, inboundMessageId, JSON.stringify({ reason: "existing_clients_disabled" })],
    );
    return { ok: true, replied: false, reason: "existing_clients_disabled", conversationId };
  }

  if (!isWithinAiHours(settings)) {
    const responseText = settings.afterHoursMessage;
    await sendTextAndRecord({ normalized, conversationId, text: responseText, reason: "after_hours" });
    return { ok: true, replied: true, reason: "after_hours", conversationId };
  }

  const count = await query(
    `select count(*)::int as total
       from public.whatsapp_messages
      where conversation_id=$1 and direction='outbound' and sender_type='ai'`,
    [conversationId],
  );
  if (Number(count.rows[0]?.total || 0) >= settings.maxAutoMessages) {
    const responseText = settings.humanHandoffMessage;
    await pauseConversationForHuman({
      conversationId,
      messageId: inboundMessageId,
      reason: "max_auto_messages",
      responseText,
    });
    await sendTextAndRecord({ normalized, conversationId, text: responseText, reason: "max_auto_messages" });
    return { ok: true, replied: true, reason: "max_auto_messages", conversationId };
  }

  const gemini = geminiPublicStatus();
  if (!gemini.configured || !gemini.enabled) {
    await query(
      `insert into public.whatsapp_message_logs(conversation_id,message_id,event_type,status,error_message,details)
       values($1,$2,'gemini_unavailable','warning',$3,$4)`,
      [
        conversationId,
        inboundMessageId,
        "Gemini não está configurado ou habilitado.",
        JSON.stringify(gemini),
      ],
    );
    return { ok: true, replied: false, reason: "gemini_unavailable", conversationId };
  }

  try {
    const base = await getAiBase();
    const history = await loadRecentHistory(conversationId);
    const commercialContext = summarizeAiCommercialContext(base);
    const message = buildGeminiConversationMessage({
      incomingText: normalized.text,
      history,
      commercialContext,
      knownClient: Boolean(recorded.client),
    });
    const result = await generateGeminiText({
      model: settings.model,
      systemPrompt: buildRuntimePrompt(settings),
      message,
    });
    await recordAiInteraction({
      conversationId,
      messageId: inboundMessageId,
      model: result.model,
      inputSummary: normalized.text,
      outputSummary: result.text,
      status: "success",
      usage: result.usage,
    });
    await sendTextAndRecord({
      normalized,
      conversationId,
      text: result.text,
      reason: "gemini_reply",
    });
    return {
      ok: true,
      replied: true,
      reason: "gemini_reply",
      conversationId,
      model: result.model,
    };
  } catch (error) {
    console.error("WhatsApp AI processing error", {
      conversationId,
      message: error.message,
      code: error.code || null,
    });
    await recordAiInteraction({
      conversationId,
      messageId: inboundMessageId,
      model: settings.model,
      inputSummary: normalized.text,
      outputSummary: "",
      status: "error",
      errorMessage: error.message,
    });
    await query(
      `insert into public.whatsapp_message_logs(conversation_id,message_id,event_type,status,error_message,details)
       values($1,$2,'ai_processing_failed','error',$3,$4)`,
      [
        conversationId,
        inboundMessageId,
        error.message,
        JSON.stringify({ code: error.code || null }),
      ],
    );
    return {
      ok: true,
      replied: false,
      reason: "ai_processing_failed",
      conversationId,
    };
  }
}
