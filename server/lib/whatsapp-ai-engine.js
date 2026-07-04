import { query, transaction } from "./db.js";
import {
  buildRuntimePrompt,
  ensureAiWhatsappSchema,
  getAiCommercialBase,
  getAiSettings,
} from "./ai-whatsapp.js";
import {
  schedulePeriod,
  scheduleSlots,
  slotsWithConflicts,
  periodFitsSchedule,
  weekdayForDate,
} from "./availability-rules.js";
import { generateOpenAiText, openAiPublicStatus } from "./openai-client.js";
import { sendBaileysTextMessage, sendBaileysPresence } from "./baileys-client.js";

const MAX_AI_MESSAGE_CHARS = 6000;

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

function localDateParts(value = new Date()) {
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

function addLocalDays(date, days) {
  const base = new Date(`${date}T12:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function formatDateLabel(date) {
  return new Date(`${date}T12:00:00.000Z`).toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    timeZone: "UTC",
  });
}

function normalizeBookingState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...value };
}

function parseJsonObject(value) {
  if (!value) return {};
  if (typeof value === "object") return normalizeBookingState(value);
  try {
    return normalizeBookingState(JSON.parse(value));
  } catch {
    return {};
  }
}

function numericChoice(text) {
  const match = normalizeText(text).match(/^\s*(?:opcao\s*)?(\d{1,2})\s*$/);
  return match ? Number(match[1]) : null;
}

function dateOptionsFrom(date = localDateParts()) {
  return [
    { id: 1, date, label: `Hoje (${formatDateLabel(date)})` },
    { id: 2, date: addLocalDays(date, 1), label: `Amanhã (${formatDateLabel(addLocalDays(date, 1))})` },
    { id: 3, date: addLocalDays(date, 2), label: `Depois de amanhã (${formatDateLabel(addLocalDays(date, 2))})` },
  ];
}

function parseBookingDateFromText(text, state = {}) {
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

function parseBookingTimeFromText(text) {
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

function periodMatches(time, period) {
  if (!period) return true;
  const hour = Number(String(time).slice(0, 2));
  if (period === "morning") return hour < 12;
  if (period === "afternoon") return hour >= 12 && hour < 18;
  if (period === "evening") return hour >= 18;
  return true;
}

function periodLabel(period) {
  if (period === "morning") return "manhã";
  if (period === "afternoon") return "tarde";
  if (period === "evening") return "noite";
  return "";
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

function selectBookingService(text, base = {}, state = {}) {
  const choice = numericChoice(text);
  if (choice && Array.isArray(state.serviceOptions)) {
    const selected = state.serviceOptions.find((item) => Number(item.id) === choice);
    if (selected?.serviceId) return selected;
  }

  const normalized = normalizeText(text);
  const services = (base.services || []).filter((service) => service.active !== false && service.ai_active);
  const bookable = bookableAiServices(base);
  const evaluation = bookable.find((service) => serviceSearchText(service).includes("avaliacao")) || bookable[0] || null;
  const matched = services.find((service) => {
    const haystack = serviceSearchText(service);
    const terms = haystack.split(/\s+/).filter((term) => term.length >= 4);
    return terms.length && terms.some((term) => normalized.includes(term));
  });

  if (matched?.allow_auto_booking) {
    return {
      serviceId: matched.id,
      serviceName: matched.commercial_name || matched.name,
      requestedServiceName: matched.commercial_name || matched.name,
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
      note:
        matched && !matched.allow_auto_booking
          ? "O serviço solicitado exige validação da equipe; a IA vai registrar uma avaliação primeiro."
          : "",
    };
  }

  return null;
}

function buildServiceOptions(base = {}) {
  return bookableAiServices(base).slice(0, 5).map((service, index) => ({
    id: index + 1,
    serviceId: service.id,
    serviceName: service.commercial_name || service.name,
    requestedServiceName: service.commercial_name || service.name,
  }));
}

function optionLines(options, formatter) {
  return options.map((item) => `${item.id}) ${formatter(item)}`).join("\n");
}

function extractClientName(text) {
  const value = clean(text);
  const match = value.match(/(?:meu nome (?:é|e)|sou|me chamo|pode colocar como)\s+([A-Za-zÀ-ÿ' ]{2,80})/i);
  if (!match) return "";
  return clean(match[1]).replace(/[.!,?].*$/, "").slice(0, 80);
}

async function saveBookingState(conversationId, state) {
  await query(
    `update public.whatsapp_conversations
        set booking_state=$2, updated_at=now()
      where id=$1`,
    [conversationId, JSON.stringify(prunePayload(state))],
  );
}

async function ensureClientForBooking(client, { phoneNumber, clientName }) {
  const found = await findClientByPhone(client, phoneNumber);
  if (found?.id) {
    const profile = await client.query(
      `select c.id as client_id,p.id as profile_id,p.full_name
         from public.clients c
         join public.profiles p on p.id=c.profile_id
        where c.id=$1
        limit 1`,
      [found.id],
    );
    return profile.rows[0] || { client_id: found.id, profile_id: null, full_name: found.full_name };
  }

  const safeName =
    clean(clientName).length >= 2
      ? clean(clientName).slice(0, 120)
      : `Cliente WhatsApp ${String(phoneNumber || "").slice(-4)}`;
  const email = `whatsapp+${String(phoneNumber).replace(/\D/g, "")}@carolsol.local`;
  const user = await client.query(
    `insert into auth.users(email, phone, encrypted_password, email_confirmed_at, raw_user_meta_data)
     values($1,$2,null,now(),$3)
     on conflict(email) do update
        set phone=coalesce(auth.users.phone, excluded.phone),
            raw_user_meta_data=coalesce(nullif(auth.users.raw_user_meta_data,'{}'::jsonb), excluded.raw_user_meta_data),
            updated_at=now()
     returning id`,
    [email, phoneNumber, JSON.stringify({ name: safeName, source: "whatsapp_ai" })],
  );
  const profile = await client.query(
    `insert into public.profiles(id, role, full_name, phone, notification_preferences)
     values($1,'client',$2,$3,'{"email":false,"whatsapp":true,"push":false}')
     on conflict(id) do update
        set full_name=case
              when public.profiles.full_name ilike 'Cliente WhatsApp %' then excluded.full_name
              else public.profiles.full_name
            end,
            phone=coalesce(public.profiles.phone, excluded.phone),
            updated_at=now()
     returning id as profile_id, full_name`,
    [user.rows[0].id, safeName, phoneNumber],
  );
  const insertedClient = await client.query(
    `insert into public.clients(profile_id, source, preferences)
     values($1,'WhatsApp IA','{}')
     on conflict(profile_id) do update set source=coalesce(public.clients.source, excluded.source)
     returning id as client_id`,
    [profile.rows[0].profile_id],
  );
  await client.query(
    `insert into public.consent_logs(profile_id, consent_type, granted, policy_version, source)
     values($1,'whatsapp_contact',true,'1.0','whatsapp_ai')
     on conflict do nothing`,
    [profile.rows[0].profile_id],
  ).catch(() => null);
  return {
    client_id: insertedClient.rows[0].client_id,
    profile_id: profile.rows[0].profile_id,
    full_name: profile.rows[0].full_name,
  };
}

async function availableBookingSlots(client, { serviceId, date, preferredTime = "", period = "" }) {
  const service = await client.query(
    "select id,name,duration_minutes,base_price,deposit_amount,active from public.services where id=$1 and active limit 1",
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
  return { service: service.rows[0], slots: slots.slice(0, 8) };
}

async function createWhatsappAppointment({ conversationId, phoneNumber, state }) {
  return transaction(async (client) => {
    const lockedConversation = await client.query(
      "select id,appointment_id from public.whatsapp_conversations where id=$1 for update",
      [conversationId],
    );
    if (!lockedConversation.rows[0]) throw new Error("Conversa não encontrada para agendamento.");
    if (lockedConversation.rows[0].appointment_id) {
      return { id: lockedConversation.rows[0].appointment_id, alreadyCreated: true };
    }

    const bookingClient = await ensureClientForBooking(client, {
      phoneNumber,
      clientName: state.clientName,
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
    const intake = {
      origin: "whatsapp_ai",
      conversation_id: conversationId,
      requested_service: state.requestedServiceName || state.serviceName,
      selected_by_ai: true,
      requires_human_confirmation: true,
    };
    const notes = [
      "Pré-agendamento criado pela IA do WhatsApp.",
      state.requestedServiceName && state.requestedServiceName !== state.serviceName
        ? `Serviço solicitado pela cliente: ${state.requestedServiceName}.`
        : "",
      "Confirmar disponibilidade e detalhes com a cliente antes do atendimento.",
    ].filter(Boolean).join(" ");

    await client.query(
      `insert into public.appointments(
        id,booking_code,client_id,professional_id,service_id,location_id,starts_at,ends_at,
        status,notes,estimated_value,original_value,discount_amount,intake_data,created_by
      ) values($1,$2,$3,$4,$5,$6,$7,$8,'requested',$9,$10,$10,0,$11,$12)`,
      [
        appointmentId,
        bookingCode,
        bookingClient.client_id,
        professional.rows[0].id,
        service.rows[0].id,
        location.rows[0]?.id || null,
        startsAt.toISOString(),
        endsAt.toISOString(),
        notes,
        service.rows[0].base_price || 0,
        JSON.stringify(intake),
        bookingClient.profile_id || null,
      ],
    );
    await client.query(
      `insert into public.appointment_status_history(appointment_id,to_status,changed_by,note)
       values($1,'requested',$2,'Pré-agendamento criado pela IA do WhatsApp')`,
      [appointmentId, bookingClient.profile_id || null],
    );
    const notificationData = JSON.stringify({ appointment_id: appointmentId, conversation_id: conversationId });
    await client.query(
      `insert into public.notifications(profile_id,kind,title,body,data,action_url,metadata)
       values($1,'appointment_created','Pré-agendamento enviado',$2,$3,$4,$3)`,
      [
        bookingClient.profile_id,
        `Sua solicitação de ${service.rows[0].name} foi registrada. A equipe vai confirmar a disponibilidade.`,
        notificationData,
        `/cliente/agendamentos/${appointmentId}`,
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
      updatedAt: new Date().toISOString(),
    };
    await client.query(
      `update public.whatsapp_conversations
          set client_id=coalesce(client_id,$2),
              professional_id=coalesce(professional_id,$3),
              appointment_id=$4,
              booking_state=$5,
              updated_at=now()
        where id=$1`,
      [
        conversationId,
        bookingClient.client_id,
        professional.rows[0].id,
        appointmentId,
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
      service: service.rows[0].name,
      professional: professional.rows[0].full_name,
    };
  });
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

function flowEnabled(base, flowKey) {
  const flow = (base.flows || []).find((item) => item.flow_key === flowKey);
  return flow ? flow.enabled !== false : true;
}

function formatSlot(slot) {
  return `${formatDateLabel(slot.date)} às ${slot.time} com ${slot.professionalName}`;
}

async function slotOptionsForBooking({ serviceId, date, preferredTime = "", period = "" }) {
  return transaction(async (client) => {
    const { slots } = await availableBookingSlots(client, {
      serviceId,
      date,
      preferredTime,
      period,
    });
    return slots.slice(0, 5).map((slot, index) => ({ ...slot, id: index + 1 }));
  });
}

async function nextAvailableSlotOptions({ serviceId, fromDate, period = "" }) {
  const options = [];
  for (let offset = 0; offset <= 10 && options.length < 5; offset++) {
    const date = addLocalDays(fromDate, offset);
    const slots = await slotOptionsForBooking({ serviceId, date, period });
    for (const slot of slots) {
      options.push({ ...slot, id: options.length + 1 });
      if (options.length >= 5) break;
    }
  }
  return options;
}

function buildBookingSummary(state) {
  return [
    `Serviço: ${state.serviceName}`,
    state.requestedServiceName && state.requestedServiceName !== state.serviceName
      ? `Pedido informado: ${state.requestedServiceName}`
      : "",
    `Data e horário: ${formatDateLabel(state.date)} às ${state.time}`,
    state.professionalName ? `Profissional: ${state.professionalName}` : "",
  ].filter(Boolean).join("\n");
}

async function handleStructuredBookingFlow({
  normalized,
  conversationId,
  inboundMessageId,
  text,
  settings,
  base,
  recorded,
  queueLatencyMs,
  receivedAt,
}) {
  if (!settings.allowAutoBooking) return null;
  if (!flowEnabled(base, "pre_agendamento") && !flowEnabled(base, "verificacao_agenda")) return null;

  const currentState = parseJsonObject(recorded.conversation.booking_state);
  const previousPrompt = normalizeText(recorded.conversation.last_message_preview || "");
  const previousPromptSuggestsBooking =
    isBookingIntent(previousPrompt) ||
    includesAny(previousPrompt, [
      "data preferida",
      "escolha a data",
      "escolha o horario",
      "escolha o horário",
      "responda so com o numero",
      "responda só com o número",
      "pre agendamento",
      "pré agendamento",
    ]);
  const active =
    (currentState.status && currentState.status !== "booked") ||
    previousPromptSuggestsBooking;
  if (!active && !isBookingIntent(text)) return null;

  const state = {
    status: "collecting",
    ...currentState,
    updatedAt: new Date().toISOString(),
  };
  const detectedName = extractClientName(text);
  if (detectedName) state.clientName = detectedName;

  if (state.status === "booked" && state.appointmentId) {
    const responseText = `Seu pré-agendamento já foi registrado com o código ${state.bookingCode || String(state.appointmentId).slice(0, 8)}. A equipe vai confirmar os detalhes pelo WhatsApp.`;
    await sendTextAndRecord({ normalized, conversationId, text: responseText, reason: "booking_already_created" });
    await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
    return { ok: true, replied: true, reason: "booking_already_created", conversationId };
  }

  const serviceChoice = selectBookingService(text, base, state);
  if (!state.serviceId && serviceChoice) {
    Object.assign(state, {
      serviceId: serviceChoice.serviceId,
      serviceName: serviceChoice.serviceName,
      requestedServiceName: serviceChoice.requestedServiceName || serviceChoice.serviceName,
      serviceNote: serviceChoice.note || "",
    });
  }

  if (!state.serviceId) {
    const serviceOptions = buildServiceOptions(base);
    if (!serviceOptions.length) return null;
    if (serviceOptions.length === 1) {
      Object.assign(state, {
        serviceId: serviceOptions[0].serviceId,
        serviceName: serviceOptions[0].serviceName,
        requestedServiceName: serviceOptions[0].requestedServiceName,
      });
    } else {
      state.serviceOptions = serviceOptions;
      state.status = "awaiting_service";
      await saveBookingState(conversationId, state);
      const responseText = [
        "Posso registrar o pré-agendamento pelo WhatsApp ✨",
        "Escolha o serviço respondendo só com o número:",
        optionLines(serviceOptions, (item) => item.serviceName),
      ].join("\n\n");
      await sendTextAndRecord({ normalized, conversationId, text: responseText, reason: "booking_service_options" });
      await sendBaileysPresence({ number: normalized.phoneNumber, presence: "paused" });
      await logAiRequest({
        conversationId,
        messageId: inboundMessageId,
        provider: "local_booking",
        model: "booking_state_machine",
        status: "service_options",
        queueLatencyMs,
        providerLatencyMs: 0,
        totalLatencyMs: Date.now() - receivedAt.getTime(),
      });
      return { ok: true, replied: true, reason: "booking_service_options", conversationId };
    }
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
    if (choice && Array.isArray(state.slotOptions)) {
      const selected = state.slotOptions.find((item) => Number(item.id) === choice);
      if (selected) {
        Object.assign(state, {
          date: selected.date,
          time: selected.time,
          professionalId: selected.professionalId,
          professionalName: selected.professionalName,
          status: "awaiting_confirmation",
        });
      }
    }

    if (!state.time || !state.professionalId) {
      const parsedTime = parseBookingTimeFromText(text);
      const preferredTime = parsedTime.time || "";
      const period = parsedTime.period || state.period || "";
      if (period) state.period = period;
      let slotOptions = await slotOptionsForBooking({
        serviceId: state.serviceId,
        date: state.date,
        preferredTime,
        period,
      });
      if (!slotOptions.length && !preferredTime) {
        slotOptions = await nextAvailableSlotOptions({
          serviceId: state.serviceId,
          fromDate: state.date,
          period,
        });
      }
      if (!slotOptions.length) {
        state.status = "awaiting_date";
        state.date = "";
        state.time = "";
        state.professionalId = "";
        state.slotOptions = [];
        state.dateOptions = dateOptionsFrom();
        await saveBookingState(conversationId, state);
        const responseText = [
          "Não encontrei horário disponível nessa opção.",
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
      state.slotOptions = slotOptions;
      state.status = "awaiting_slot";
      await saveBookingState(conversationId, state);
      const periodText = state.period ? ` no período da ${periodLabel(state.period)}` : "";
      const responseText = [
        `Encontrei estes horários${periodText}. Responda só com o número para escolher:`,
        optionLines(slotOptions, formatSlot),
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

  if (!isAffirmativeBookingConfirmation(text)) {
    state.status = "awaiting_confirmation";
    await saveBookingState(conversationId, state);
    const responseText = [
      "Resumo do pré-agendamento:",
      buildBookingSummary(state),
      "Posso registrar essa solicitação? Responda “sim” para registrar ou escolha outro número de horário.",
    ].join("\n\n");
    await sendTextAndRecord({ normalized, conversationId, text: responseText, reason: "booking_confirmation_request" });
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
    const responseText = [
      `Pronto, registrei sua solicitação de pré-agendamento ✨`,
      appointment.bookingCode ? `Código: ${appointment.bookingCode}` : "",
      `${appointment.service || state.serviceName} — ${formatDateLabel(state.date)} às ${state.time}`,
      appointment.professional ? `Com ${appointment.professional}` : "",
      "A equipe vai confirmar os detalhes antes do atendimento.",
    ].filter(Boolean).join("\n");
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
  const enabledFlows = (base.flows || [])
    .filter((flow) => flow.enabled)
    .map((flow) => flow.name || flow.flow_key)
    .slice(0, 12);

  return [
    "Dados reais liberados para esta resposta:",
    services.length ? `Serviços:\n${services.join("\n")}` : "Serviços: nenhum serviço foi liberado para atendimento automático.",
    plans.length ? `Planos ativos:\n${plans.join("\n")}` : "Planos ativos: nenhum plano ativo encontrado.",
    coupons.length ? `Cupons ativos:\n${coupons.join("\n")}` : "Cupons ativos: nenhum cupom ativo encontrado.",
    enabledFlows.length
      ? `Fluxos automáticos habilitados: ${enabledFlows.join(", ")}.`
      : "Fluxos automáticos: nenhum fluxo específico habilitado.",
    settings.allowAutoBooking
      ? "Pré-agendamento automático está permitido, mas exige dados completos e confirmação explícita antes de qualquer gravação."
      : "A IA pode conduzir e registrar uma solicitação de pré-agendamento; a equipe confirma disponibilidade e horário.",
    "Nunca prometa horário, pagamento ou agendamento confirmado sem uma gravação bem-sucedida no backend.",
  ].join("\n\n");
}

function isAffirmativeBookingConfirmation(text) {
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

export function buildBookingGuidance({
  incomingText,
  history = [],
  knownClient = false,
  settings = {},
}) {
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
        "Identifique no histórico o que a cliente já informou e pergunte somente UM dado faltante por mensagem, nesta ordem: serviço desejado, data preferida, período/horário e nome (apenas se a cliente não estiver cadastrada).",
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

  const requiredContext = [
    `Mensagem atual da cliente:\n${clean(incomingText)}`,
    bookingGuidance,
    "A mensagem atual é a prioridade. Use o histórico apenas para continuidade; se a cliente mudar de assunto, responda ao novo assunto sem repetir o serviço anterior. Não presuma que a dúvida é sobre Fibra Russa quando a mensagem atual não mencionar essa técnica nem for uma continuação inequívoca dela.",
    "Responda em até 700 caracteres, em português do Brasil, sem inventar dados. Não repita uma pergunta cuja resposta já esteja no histórico. Se a cliente quiser agendar, avance pelo fluxo de pré-agendamento. Nunca diga que um horário foi confirmado sem persistência real no backend.",
  ]
    .filter(Boolean)
    .join("\n\n");
  const optionalContext = [
    clean(commercialContext).slice(0, 1600),
    clean(knowledgeContext).slice(0, 1300),
    `Cliente já cadastrada: ${knownClient ? "sim" : "não"}.`,
    historyText ? `Histórico recente:\n${historyText}` : "Histórico recente: primeira mensagem desta conversa.",
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
      JSON.stringify(usage ? [{ tool: "openai", usage }] : []),
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
  });
  if (structuredBooking) return structuredBooking;

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
  const history = await loadRecentHistory(conversationId, inboundMessageId);
  const booking = buildBookingGuidance({
    incomingText: concatenatedText,
    history,
    knownClient: Boolean(recorded.client),
    settings,
  });
  const commercialContext = summarizeAiCommercialContext(base, settings);
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

  const promptMessage = buildAiConversationMessage({
    incomingText: concatenatedText,
    history: history.slice(-(settings.contextLimit || 8)),
    commercialContext,
    knowledgeContext,
    bookingGuidance: booking.text,
    knownClient: Boolean(recorded.client),
  });

  let finalResponse = null;
  const finalProvider = "openai";
  let finalModel = null;
  let finalUsage = null;
  let retryCountTotal = 0;
  const fallbackUsed = false;
  let errorMsg = null;
  let errorCode = null;
  let providerStartedAt = null;
  let providerFinishedAt = null;

  const runtimeStatus = openAiPublicStatus();
  if (!runtimeStatus.enabled || !runtimeStatus.configured) {
    const missingReason = !runtimeStatus.enabled ? "disabled" : "not_configured";
    console.warn(`AI provider openai skipped: ${missingReason}.`, {
      enabled: runtimeStatus.enabled,
      configured: runtimeStatus.configured,
      model: runtimeStatus.model,
    });
    errorMsg = "OpenAI não está habilitada/configurada no ambiente.";
    errorCode = `OPENAI_${missingReason.toUpperCase()}`;
  } else {
    const retries = settings.maxRetries ?? 2;
    let currentAttempt = 0;
    providerStartedAt = new Date();

    while (currentAttempt <= retries && !finalResponse) {
      try {
        if (currentAttempt > 0) {
          retryCountTotal++;
          await delay(getRetryDelay(currentAttempt));
        }
        const result = await generateOpenAiText({
          systemPrompt,
          message: promptMessage,
          model: settings.primaryModel || settings.model || runtimeStatus.model,
          timeoutMs: settings.timeoutMs || 12000,
          maxTokens: settings.maxResponseTokens || 300,
        });
        finalResponse = result.text;
        finalModel = result.model;
        finalUsage = result.usage;
      } catch (err) {
        console.error(
          `AI provider openai failed (attempt ${currentAttempt + 1}/${retries + 1}): ${err.message}`,
        );
        errorMsg = err.message;
        errorCode = err.code || null;
        if (err.code === "RESOURCE_EXHAUSTED" || err.status === 429 || err.status === 401) break;
        currentAttempt++;
      }
    }
    providerFinishedAt = new Date();
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
      model: runtimeStatus.model,
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
