import { query, transaction } from "./db.js";
import { appError } from "./http.js";
import { geminiPublicStatus } from "./gemini-client.js";

const DEFAULT_SYSTEM_PROMPT =
  "Você é a assistente virtual do salão [NOME_SALAO], especializado em Mega Hair premium.\n\nSeu objetivo é acolher, orientar e ajudar a cliente a encontrar serviços, valores, planos, horários e agendamentos reais.\n\nVocê deve usar apenas informações fornecidas pelas ferramentas do sistema.\n\nNunca invente valores, horários, cupons, disponibilidade, formas de pagamento ou políticas.\n\nAntes de confirmar um agendamento, sempre mostre resumo completo e peça confirmação explícita.\n\nQuando houver dúvida, pedido de desconto fora das regras, reclamação, pagamento com problema ou pedido de atendente, transfira para uma pessoa da equipe.\n\nUse o modo de humor configurado pelo administrador.\n\nResponda em português do Brasil, com mensagens curtas, claras e elegantes.";

export const personalityModes = [
  {
    value: "simpatica_acolhedora",
    label: "Simpática e acolhedora",
    description: "Tom caloroso, leve e empático, com poucos emojis.",
  },
  {
    value: "premium_consultiva",
    label: "Premium e consultiva",
    description: "Tom elegante, profissional e especializado.",
  },
  {
    value: "eficiente_objetiva",
    label: "Eficiente e objetiva",
    description: "Respostas curtas, diretas e organizadas.",
  },
  {
    value: "vendedora_persuasiva",
    label: "Vendedora e persuasiva",
    description: "Comercial sem pressão e sem promessas irreais.",
  },
  {
    value: "humana_descontraida",
    label: "Humana e descontraída",
    description: "Tom próximo, moderno e amigável.",
  },
];

export const automationFlowDefaults = [
  ["boas_vindas", "Boas-vindas"],
  ["cliente_nova", "Identificação de cliente nova"],
  ["cliente_existente", "Identificação de cliente existente"],
  ["apresentacao_servicos", "Apresentação de serviços"],
  ["consulta_valores", "Consulta de valores"],
  ["pre_orcamento", "Pré-orçamento"],
  ["solicitacao_fotos", "Solicitação de fotos"],
  ["verificacao_agenda", "Verificação de agenda"],
  ["pre_agendamento", "Pré-agendamento"],
  ["confirmacao_agendamento", "Confirmação de agendamento"],
  ["lembrete_atendimento", "Lembrete de atendimento"],
  ["reagendamento", "Reagendamento"],
  ["manutencao_proxima", "Manutenção próxima"],
  ["cobranca_pagamento", "Cobrança de pagamento pendente"],
  ["envio_link_sumup", "Envio de link SumUp"],
  ["oferta_plano", "Oferta de plano"],
  ["aplicacao_cupom", "Aplicação de cupom"],
  ["indique_ganhe", "Indique e Ganhe"],
  ["transferencia_humano", "Transferência para humano"],
  ["pos_atendimento", "Pós-atendimento"],
  ["pedido_avaliacao", "Pedido de avaliação"],
];

export const aiWhatsappTables = [
  "ai_settings",
  "ai_prompt_versions",
  "ai_service_settings",
  "ai_plan_settings",
  "ai_automation_flows",
  "whatsapp_conversations",
  "whatsapp_messages",
  "whatsapp_message_logs",
  "ai_interactions",
  "ai_tool_calls",
  "human_handoff_tickets",
  "conversation_tags",
  "conversation_tag_links",
];

const schemaSql = `
create table if not exists public.ai_settings (
  id uuid primary key default uuid_generate_v4(),
  business_id text not null default 'default',
  enabled boolean not null default false,
  provider text not null default 'gemini',
  model text not null default 'gemini-2.5-flash-lite',
  assistant_name text not null default 'Carol',
  salon_name text not null default 'Carol Sol Mega Hair',
  personality_mode text not null default 'simpatica_acolhedora',
  system_prompt text not null default '',
  welcome_message text not null default '',
  after_hours_message text not null default '',
  human_handoff_message text not null default '',
  closing_message text not null default '',
  max_idle_minutes int not null default 30,
  max_auto_messages int not null default 12,
  allow_24h boolean not null default true,
  ai_start_time time,
  ai_end_time time,
  allow_new_contacts boolean not null default true,
  allow_existing_clients boolean not null default true,
  allow_auto_payment_links boolean not null default false,
  allow_auto_booking boolean not null default false,
  require_booking_confirmation boolean not null default true,
  handoff_on_complaint boolean not null default true,
  handoff_on_payment boolean not null default true,
  handoff_on_urgency boolean not null default true,
  pause_keyword text not null default 'atendente',
  resume_keyword text not null default 'voltar ao bot',
  stop_keyword text not null default 'parar',
  timezone text not null default 'America/Sao_Paulo',
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(business_id)
);
create table if not exists public.ai_prompt_versions (
  id uuid primary key default uuid_generate_v4(),
  settings_id uuid references public.ai_settings(id) on delete cascade,
  prompt text not null,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create table if not exists public.ai_service_settings (
  id uuid primary key default uuid_generate_v4(),
  service_id uuid not null references public.services(id) on delete cascade,
  active boolean not null default false,
  commercial_name text,
  short_description text,
  detailed_description text,
  initial_price numeric(12,2),
  estimated_duration_minutes int,
  requires_assessment boolean not null default false,
  requires_deposit boolean not null default false,
  deposit_type text not null default 'amount',
  deposit_value numeric(12,2) not null default 0,
  professional_ids jsonb not null default '[]',
  required_questions jsonb not null default '[]',
  reference_photos_required boolean not null default false,
  allow_auto_quote boolean not null default false,
  allow_auto_booking boolean not null default false,
  recommended_message text,
  priority_order int not null default 100,
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(service_id)
);
create table if not exists public.ai_plan_settings (
  id uuid primary key default uuid_generate_v4(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  can_sell_by_ai boolean not null default false,
  requires_human_confirmation boolean not null default true,
  active boolean not null default true,
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(plan_id)
);
create table if not exists public.ai_automation_flows (
  id uuid primary key default uuid_generate_v4(),
  flow_key text not null unique,
  name text not null,
  enabled boolean not null default false,
  initial_message text,
  internal_instructions text,
  trigger_delay_minutes int not null default 0,
  channel text not null default 'whatsapp',
  requires_human_approval boolean not null default true,
  responsible_professional_id uuid references public.professionals(id),
  tags jsonb not null default '[]',
  conditions jsonb not null default '{}',
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.whatsapp_conversations (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid references public.clients(id),
  phone_number text not null,
  professional_id uuid references public.professionals(id),
  session_id uuid references public.whatsapp_sessions(id),
  status text not null default 'ai',
  assigned_to uuid references public.profiles(id),
  ai_enabled boolean not null default true,
  last_message_at timestamptz,
  last_message_preview text,
  appointment_id uuid references public.appointments(id),
  payment_id uuid references public.payments(id),
  origin text not null default 'whatsapp_ai',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.whatsapp_messages (
  id uuid primary key default uuid_generate_v4(),
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  provider_message_id text,
  direction text not null,
  sender_type text not null,
  body text,
  media_url text,
  payload jsonb not null default '{}',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create table if not exists public.whatsapp_message_logs (
  id uuid primary key default uuid_generate_v4(),
  conversation_id uuid references public.whatsapp_conversations(id) on delete set null,
  message_id uuid references public.whatsapp_messages(id) on delete set null,
  event_type text not null,
  status text not null default 'info',
  error_message text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create table if not exists public.ai_interactions (
  id uuid primary key default uuid_generate_v4(),
  conversation_id uuid references public.whatsapp_conversations(id) on delete set null,
  message_id uuid references public.whatsapp_messages(id) on delete set null,
  model text,
  input_summary text,
  output_summary text,
  tool_calls jsonb not null default '[]',
  status text not null default 'success',
  error_message text,
  created_at timestamptz not null default now()
);
create table if not exists public.ai_tool_calls (
  id uuid primary key default uuid_generate_v4(),
  interaction_id uuid references public.ai_interactions(id) on delete cascade,
  conversation_id uuid references public.whatsapp_conversations(id) on delete set null,
  tool_name text not null,
  input_summary text,
  output_summary text,
  status text not null default 'success',
  error_message text,
  created_at timestamptz not null default now()
);
create table if not exists public.human_handoff_tickets (
  id uuid primary key default uuid_generate_v4(),
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  reason text not null,
  status text not null default 'pending',
  assigned_to uuid references public.profiles(id),
  created_by uuid references public.profiles(id),
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.conversation_tags (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  color text,
  created_at timestamptz not null default now()
);
create table if not exists public.conversation_tag_links (
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  tag_id uuid not null references public.conversation_tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(conversation_id, tag_id)
);
create index if not exists whatsapp_conversations_phone_idx on public.whatsapp_conversations(phone_number);
create index if not exists whatsapp_conversations_status_idx on public.whatsapp_conversations(status,last_message_at desc);
create index if not exists whatsapp_messages_conversation_idx on public.whatsapp_messages(conversation_id,created_at desc);
create index if not exists whatsapp_message_logs_created_idx on public.whatsapp_message_logs(event_type,status,created_at desc);
create index if not exists ai_interactions_conversation_idx on public.ai_interactions(conversation_id,created_at desc);
create index if not exists ai_tool_calls_interaction_idx on public.ai_tool_calls(interaction_id,created_at desc);
create index if not exists human_handoff_status_idx on public.human_handoff_tickets(status,created_at desc);
`;

const defaultMessages = {
  welcomeMessage:
    "Oi! Sou a assistente virtual da Carol Sol. Posso te ajudar com serviços, valores, horários e agendamento.",
  afterHoursMessage:
    "No momento estamos fora do horário de atendimento. Posso registrar sua mensagem e nossa equipe continua assim que possível.",
  humanHandoffMessage:
    "Vou encaminhar sua mensagem para nossa equipe. Em breve uma pessoa do salão continuará seu atendimento por aqui.",
  closingMessage: "Obrigada pelo contato! Se precisar de algo mais, é só me chamar.",
};

let schemaEnsured = false;

const clean = (value) => String(value ?? "").trim();
const bool = (value, fallback = false) =>
  value === undefined || value === null ? fallback : value === true || value === "true";
const intRange = (value, fallback, min, max) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};
const moneyOrNull = (value, fallback = null) => {
  if (value === "" || value === null || value === undefined) return fallback;
  const parsed = Number(String(value).replace(",", "."));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(999999, Math.round(parsed * 100) / 100));
};
const textLimit = (value, fallback, max) => {
  const current = clean(value);
  if (!current) return clean(fallback).slice(0, max);
  return current.slice(0, max);
};
const uuidLike = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    clean(value),
  );
const timeOrNull = (value) => {
  const v = clean(value);
  return /^\d{2}:\d{2}$/.test(v) ? v : null;
};

function defaultSettingsInput() {
  return {
    enabled: false,
    provider: "gemini",
    model: "gemini-2.5-flash-lite",
    assistantName: "Carol",
    salonName: "Carol Sol Mega Hair",
    personalityMode: "simpatica_acolhedora",
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    ...defaultMessages,
    maxIdleMinutes: 30,
    maxAutoMessages: 12,
    allow24h: true,
    aiStartTime: null,
    aiEndTime: null,
    allowNewContacts: true,
    allowExistingClients: true,
    allowAutoPaymentLinks: false,
    allowAutoBooking: false,
    requireBookingConfirmation: true,
    handoffOnComplaint: true,
    handoffOnPayment: true,
    handoffOnUrgency: true,
    pauseKeyword: "atendente",
    resumeKeyword: "voltar ao bot",
    stopKeyword: "parar",
    timezone: "America/Sao_Paulo",
  };
}

export function defaultAiSettings() {
  return defaultSettingsInput();
}

export function normalizeAiSettingsInput(input = {}, current = defaultSettingsInput()) {
  const fallback = { ...defaultSettingsInput(), ...current };
  const personalityMode = clean(input.personalityMode || fallback.personalityMode);
  if (!personalityModes.some((mode) => mode.value === personalityMode))
    throw appError("Modo de humor inválido.");
  const model = clean(input.model || fallback.model);
  const assistantName = clean(input.assistantName || fallback.assistantName);
  const salonName = clean(input.salonName || fallback.salonName);
  const systemPrompt = clean(input.systemPrompt || fallback.systemPrompt);
  if (assistantName.length < 2) throw appError("Informe o nome da assistente.");
  if (salonName.length < 2) throw appError("Informe o nome do salão.");
  if (!model) throw appError("Informe o modelo Gemini.");
  if (systemPrompt.length < 80)
    throw appError("O prompt base precisa ter pelo menos 80 caracteres.");
  return {
    enabled: bool(input.enabled, fallback.enabled),
    provider: "gemini",
    model,
    assistantName,
    salonName,
    personalityMode,
    systemPrompt,
    welcomeMessage: clean(input.welcomeMessage || fallback.welcomeMessage),
    afterHoursMessage: clean(input.afterHoursMessage || fallback.afterHoursMessage),
    humanHandoffMessage: clean(
      input.humanHandoffMessage || fallback.humanHandoffMessage,
    ),
    closingMessage: clean(input.closingMessage || fallback.closingMessage),
    maxIdleMinutes: intRange(input.maxIdleMinutes, fallback.maxIdleMinutes, 5, 1440),
    maxAutoMessages: intRange(input.maxAutoMessages, fallback.maxAutoMessages, 1, 80),
    allow24h: bool(input.allow24h, fallback.allow24h),
    aiStartTime: timeOrNull(input.aiStartTime ?? fallback.aiStartTime),
    aiEndTime: timeOrNull(input.aiEndTime ?? fallback.aiEndTime),
    allowNewContacts: bool(input.allowNewContacts, fallback.allowNewContacts),
    allowExistingClients: bool(
      input.allowExistingClients,
      fallback.allowExistingClients,
    ),
    allowAutoPaymentLinks: bool(
      input.allowAutoPaymentLinks,
      fallback.allowAutoPaymentLinks,
    ),
    allowAutoBooking: bool(input.allowAutoBooking, fallback.allowAutoBooking),
    requireBookingConfirmation: bool(
      input.requireBookingConfirmation,
      fallback.requireBookingConfirmation,
    ),
    handoffOnComplaint: bool(input.handoffOnComplaint, fallback.handoffOnComplaint),
    handoffOnPayment: bool(input.handoffOnPayment, fallback.handoffOnPayment),
    handoffOnUrgency: bool(input.handoffOnUrgency, fallback.handoffOnUrgency),
    pauseKeyword: clean(input.pauseKeyword || fallback.pauseKeyword) || "atendente",
    resumeKeyword:
      clean(input.resumeKeyword || fallback.resumeKeyword) || "voltar ao bot",
    stopKeyword: clean(input.stopKeyword || fallback.stopKeyword) || "parar",
    timezone: clean(input.timezone || fallback.timezone) || "America/Sao_Paulo",
  };
}

export function normalizeAiServiceSettingsInput(input = {}, service = {}) {
  const serviceId = clean(input.serviceId || input.service_id || service.id);
  if (!uuidLike(serviceId)) throw appError("Serviço inválido.");

  const active = bool(input.active ?? input.aiActive, service.ai_active || false);
  if (active && service.active === false)
    throw appError("Não é possível ativar IA para um serviço inativo.");

  const initialPrice = moneyOrNull(
    input.initialPrice ?? input.initial_price,
    moneyOrNull(service.initial_price ?? service.base_price, null),
  );
  const depositValue = moneyOrNull(
    input.depositValue ?? input.deposit_value,
    moneyOrNull(service.deposit_value ?? service.deposit_amount, 0),
  );
  const estimatedDurationMinutes = intRange(
    input.estimatedDurationMinutes ?? input.estimated_duration_minutes,
    Number(service.estimated_duration_minutes || service.duration_minutes || 60),
    5,
    720,
  );
  const priorityOrder = intRange(
    input.priorityOrder ?? input.priority_order,
    Number(service.priority_order || 100),
    1,
    999,
  );
  const depositType = clean(input.depositType || input.deposit_type || service.deposit_type || "amount");
  if (!["amount", "percentage"].includes(depositType))
    throw appError("Tipo de sinal inválido.");

  return {
    serviceId,
    active,
    commercialName: textLimit(
      input.commercialName ?? input.commercial_name,
      service.commercial_name || service.name,
      120,
    ),
    shortDescription: textLimit(
      input.shortDescription ?? input.short_description,
      service.short_description || service.description,
      240,
    ),
    detailedDescription: textLimit(
      input.detailedDescription ?? input.detailed_description,
      service.detailed_description || service.description,
      1200,
    ),
    initialPrice,
    estimatedDurationMinutes,
    requiresAssessment: bool(
      input.requiresAssessment ?? input.requires_assessment,
      service.requires_assessment || false,
    ),
    requiresDeposit: bool(
      input.requiresDeposit ?? input.requires_deposit,
      service.requires_deposit || false,
    ),
    depositType,
    depositValue,
    referencePhotosRequired: bool(
      input.referencePhotosRequired ?? input.reference_photos_required,
      service.reference_photos_required || false,
    ),
    allowAutoQuote: bool(
      input.allowAutoQuote ?? input.allow_auto_quote,
      service.allow_auto_quote || false,
    ),
    allowAutoBooking: bool(
      input.allowAutoBooking ?? input.allow_auto_booking,
      service.allow_auto_booking || false,
    ),
    recommendedMessage: textLimit(
      input.recommendedMessage ?? input.recommended_message,
      service.recommended_message || "",
      800,
    ),
    priorityOrder,
  };
}

function dbToSettings(row) {
  if (!row) return defaultSettingsInput();
  return {
    id: row.id,
    businessId: row.business_id,
    enabled: row.enabled,
    provider: row.provider,
    model: row.model,
    assistantName: row.assistant_name,
    salonName: row.salon_name,
    personalityMode: row.personality_mode,
    systemPrompt: row.system_prompt || DEFAULT_SYSTEM_PROMPT,
    welcomeMessage: row.welcome_message || defaultMessages.welcomeMessage,
    afterHoursMessage: row.after_hours_message || defaultMessages.afterHoursMessage,
    humanHandoffMessage:
      row.human_handoff_message || defaultMessages.humanHandoffMessage,
    closingMessage: row.closing_message || defaultMessages.closingMessage,
    maxIdleMinutes: row.max_idle_minutes,
    maxAutoMessages: row.max_auto_messages,
    allow24h: row.allow_24h,
    aiStartTime: row.ai_start_time ? String(row.ai_start_time).slice(0, 5) : null,
    aiEndTime: row.ai_end_time ? String(row.ai_end_time).slice(0, 5) : null,
    allowNewContacts: row.allow_new_contacts,
    allowExistingClients: row.allow_existing_clients,
    allowAutoPaymentLinks: row.allow_auto_payment_links,
    allowAutoBooking: row.allow_auto_booking,
    requireBookingConfirmation: row.require_booking_confirmation,
    handoffOnComplaint: row.handoff_on_complaint,
    handoffOnPayment: row.handoff_on_payment,
    handoffOnUrgency: row.handoff_on_urgency,
    pauseKeyword: row.pause_keyword,
    resumeKeyword: row.resume_keyword,
    stopKeyword: row.stop_keyword,
    timezone: row.timezone,
    updatedAt: row.updated_at,
  };
}

export async function ensureAiWhatsappSchema({ force = false } = {}) {
  if (schemaEnsured && !force) return;
  await query(schemaSql);
  await query(
    `insert into public.ai_settings(
      business_id,system_prompt,welcome_message,after_hours_message,human_handoff_message,closing_message
    ) values($1,$2,$3,$4,$5,$6) on conflict(business_id) do nothing`,
    [
      "default",
      DEFAULT_SYSTEM_PROMPT,
      defaultMessages.welcomeMessage,
      defaultMessages.afterHoursMessage,
      defaultMessages.humanHandoffMessage,
      defaultMessages.closingMessage,
    ],
  );
  for (const [flowKey, name] of automationFlowDefaults) {
    await query(
      "insert into public.ai_automation_flows(flow_key,name) values($1,$2) on conflict(flow_key) do nothing",
      [flowKey, name],
    );
  }
  await query(
    `insert into public._luxe_migrations(version, description)
     values ('011_ai_whatsapp', 'Atendimento IA WhatsApp Gemini')
     on conflict(version) do nothing`,
  ).catch(() => null);
  schemaEnsured = true;
}

export async function aiWhatsappMigrationStatus() {
  const { rows } = await query(
    `select table_name
       from information_schema.tables
      where table_schema='public' and table_name = any($1::text[])`,
    [aiWhatsappTables],
  );
  const existing = new Set(rows.map((row) => row.table_name));
  const missingTables = aiWhatsappTables.filter((table) => !existing.has(table));
  const settingsResult = existing.has("ai_settings")
    ? await query(
        "select count(*)::int as count from public.ai_settings where business_id='default'",
      )
    : { rows: [{ count: 0 }] };
  const flowsResult = existing.has("ai_automation_flows")
    ? await query("select count(*)::int as count from public.ai_automation_flows")
    : { rows: [{ count: 0 }] };
  const migrationResult = await query(
    "select 1 from public._luxe_migrations where version=$1",
    ["011_ai_whatsapp"],
  ).catch(() => ({ rowCount: 0 }));

  return {
    version: "011_ai_whatsapp",
    applied: missingTables.length === 0 && migrationResult.rowCount > 0,
    migrationRegistered: migrationResult.rowCount > 0,
    missingTables,
    settingsExists: Number(settingsResult.rows[0]?.count || 0) > 0,
    flowsCount: Number(flowsResult.rows[0]?.count || 0),
  };
}

export async function applyAiWhatsappMigration() {
  const before = await aiWhatsappMigrationStatus();
  await ensureAiWhatsappSchema({ force: true });
  const after = await aiWhatsappMigrationStatus();
  return { applied: true, before, after };
}

export async function getAiSettings() {
  await ensureAiWhatsappSchema();
  const { rows } = await query(
    "select * from public.ai_settings where business_id='default' limit 1",
  );
  return dbToSettings(rows[0]);
}

export async function saveAiSettings(user, input) {
  await ensureAiWhatsappSchema();
  const current = await getAiSettings();
  const value = normalizeAiSettingsInput(input, current);
  return transaction(async (client) => {
    const { rows } = await client.query(
      `insert into public.ai_settings(
        business_id,enabled,provider,model,assistant_name,salon_name,personality_mode,system_prompt,
        welcome_message,after_hours_message,human_handoff_message,closing_message,max_idle_minutes,max_auto_messages,
        allow_24h,ai_start_time,ai_end_time,allow_new_contacts,allow_existing_clients,allow_auto_payment_links,
        allow_auto_booking,require_booking_confirmation,handoff_on_complaint,handoff_on_payment,handoff_on_urgency,
        pause_keyword,resume_keyword,stop_keyword,timezone,updated_by,updated_at
      ) values(
        'default',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,now()
      ) on conflict(business_id) do update set
        enabled=excluded.enabled,provider=excluded.provider,model=excluded.model,assistant_name=excluded.assistant_name,
        salon_name=excluded.salon_name,personality_mode=excluded.personality_mode,system_prompt=excluded.system_prompt,
        welcome_message=excluded.welcome_message,after_hours_message=excluded.after_hours_message,
        human_handoff_message=excluded.human_handoff_message,closing_message=excluded.closing_message,
        max_idle_minutes=excluded.max_idle_minutes,max_auto_messages=excluded.max_auto_messages,allow_24h=excluded.allow_24h,
        ai_start_time=excluded.ai_start_time,ai_end_time=excluded.ai_end_time,allow_new_contacts=excluded.allow_new_contacts,
        allow_existing_clients=excluded.allow_existing_clients,allow_auto_payment_links=excluded.allow_auto_payment_links,
        allow_auto_booking=excluded.allow_auto_booking,require_booking_confirmation=excluded.require_booking_confirmation,
        handoff_on_complaint=excluded.handoff_on_complaint,handoff_on_payment=excluded.handoff_on_payment,
        handoff_on_urgency=excluded.handoff_on_urgency,pause_keyword=excluded.pause_keyword,resume_keyword=excluded.resume_keyword,
        stop_keyword=excluded.stop_keyword,timezone=excluded.timezone,updated_by=excluded.updated_by,updated_at=now()
      returning *`,
      [
        value.enabled,
        value.provider,
        value.model,
        value.assistantName,
        value.salonName,
        value.personalityMode,
        value.systemPrompt,
        value.welcomeMessage,
        value.afterHoursMessage,
        value.humanHandoffMessage,
        value.closingMessage,
        value.maxIdleMinutes,
        value.maxAutoMessages,
        value.allow24h,
        value.aiStartTime,
        value.aiEndTime,
        value.allowNewContacts,
        value.allowExistingClients,
        value.allowAutoPaymentLinks,
        value.allowAutoBooking,
        value.requireBookingConfirmation,
        value.handoffOnComplaint,
        value.handoffOnPayment,
        value.handoffOnUrgency,
        value.pauseKeyword,
        value.resumeKeyword,
        value.stopKeyword,
        value.timezone,
        user.id,
      ],
    );
    if (current.systemPrompt !== value.systemPrompt) {
      await client.query(
        "update public.ai_prompt_versions set active=false where settings_id=$1",
        [rows[0].id],
      );
      await client.query(
        "insert into public.ai_prompt_versions(settings_id,prompt,created_by,active) values($1,$2,$3,true)",
        [rows[0].id, value.systemPrompt, user.id],
      );
    }
    await client.query(
      `insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_data)
       values($1,'update','ai_settings',$2,$3)`,
      [user.id, rows[0].id, JSON.stringify({ ...value, systemPrompt: "[stored]" })],
    ).catch(() => null);
    return dbToSettings(rows[0]);
  });
}

export async function saveAiServiceSettings(user, input) {
  await ensureAiWhatsappSchema();
  const serviceId = clean(input.serviceId || input.service_id);
  if (!uuidLike(serviceId)) throw appError("Serviço inválido.");

  const { rows: services } = await query(
    `select s.id,s.name,s.description,s.duration_minutes,s.base_price,s.deposit_amount,s.active,
        ais.id as ai_service_settings_id,ais.active as ai_active,ais.commercial_name,ais.short_description,
        ais.detailed_description,ais.initial_price,ais.estimated_duration_minutes,ais.requires_assessment,
        ais.requires_deposit,ais.deposit_type,ais.deposit_value,ais.reference_photos_required,
        ais.allow_auto_quote,ais.allow_auto_booking,ais.recommended_message,ais.priority_order
       from public.services s
       left join public.ai_service_settings ais on ais.service_id=s.id
      where s.id=$1
      limit 1`,
    [serviceId],
  );
  if (!services[0]) throw appError("Serviço não encontrado.", 404);

  const value = normalizeAiServiceSettingsInput(input, services[0]);
  return transaction(async (client) => {
    const { rows } = await client.query(
      `insert into public.ai_service_settings(
        service_id,active,commercial_name,short_description,detailed_description,initial_price,
        estimated_duration_minutes,requires_assessment,requires_deposit,deposit_type,deposit_value,
        reference_photos_required,allow_auto_quote,allow_auto_booking,recommended_message,priority_order,
        updated_by,updated_at
      ) values(
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,now()
      ) on conflict(service_id) do update set
        active=excluded.active,
        commercial_name=excluded.commercial_name,
        short_description=excluded.short_description,
        detailed_description=excluded.detailed_description,
        initial_price=excluded.initial_price,
        estimated_duration_minutes=excluded.estimated_duration_minutes,
        requires_assessment=excluded.requires_assessment,
        requires_deposit=excluded.requires_deposit,
        deposit_type=excluded.deposit_type,
        deposit_value=excluded.deposit_value,
        reference_photos_required=excluded.reference_photos_required,
        allow_auto_quote=excluded.allow_auto_quote,
        allow_auto_booking=excluded.allow_auto_booking,
        recommended_message=excluded.recommended_message,
        priority_order=excluded.priority_order,
        updated_by=excluded.updated_by,
        updated_at=now()
      returning *`,
      [
        value.serviceId,
        value.active,
        value.commercialName,
        value.shortDescription,
        value.detailedDescription,
        value.initialPrice,
        value.estimatedDurationMinutes,
        value.requiresAssessment,
        value.requiresDeposit,
        value.depositType,
        value.depositValue,
        value.referencePhotosRequired,
        value.allowAutoQuote,
        value.allowAutoBooking,
        value.recommendedMessage,
        value.priorityOrder,
        user.id,
      ],
    );
    await client.query(
      `insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_data)
       values($1,'update','ai_service_settings',$2,$3)`,
      [user.id, rows[0].id, JSON.stringify(value)],
    ).catch(() => null);
    return rows[0];
  });
}

export async function getAiBase() {
  await ensureAiWhatsappSchema();
  const [services, plans, coupons, flows, conversations, logs] = await Promise.all([
    query(
      `select s.id,s.name,s.description,s.duration_minutes,s.base_price,s.deposit_amount,s.active,
        ais.id as ai_service_settings_id,
        coalesce(ais.active,false) as ai_active,coalesce(ais.commercial_name,s.name) as commercial_name,
        ais.short_description,ais.detailed_description,ais.initial_price,ais.estimated_duration_minutes,
        ais.allow_auto_quote,ais.allow_auto_booking,ais.requires_assessment,ais.requires_deposit,
        ais.deposit_type,ais.deposit_value,ais.reference_photos_required,ais.recommended_message,ais.priority_order
       from public.services s
       left join public.ai_service_settings ais on ais.service_id=s.id
       order by s.active desc,coalesce(ais.priority_order,100),s.name`,
    ),
    query(
      `select p.id,p.name,p.price,p.billing_cycle,p.benefits,p.active,
        coalesce(aps.can_sell_by_ai,false) as can_sell_by_ai,
        coalesce(aps.requires_human_confirmation,true) as requires_human_confirmation
       from public.plans p
       left join public.ai_plan_settings aps on aps.plan_id=p.id
       order by p.active desc,p.price`,
    ),
    query(
      `select id,code,description,discount_type,discount_value,starts_at,ends_at,active
       from public.coupons
       order by active desc,ends_at nulls last,code`,
    ),
    query(
      `select id,flow_key,name,enabled,channel,requires_human_approval,trigger_delay_minutes,updated_at
       from public.ai_automation_flows order by name`,
    ),
    query(
      `select wc.id,wc.phone_number,wc.status,wc.ai_enabled,wc.last_message_at,wc.last_message_preview,
        p.full_name as client,ap.starts_at
       from public.whatsapp_conversations wc
       left join public.clients c on c.id=wc.client_id
       left join public.profiles p on p.id=c.profile_id
       left join public.appointments ap on ap.id=wc.appointment_id
       order by wc.last_message_at desc nulls last,wc.created_at desc
       limit 20`,
    ),
    query(
      `select id,event_type,status,error_message,created_at
       from public.whatsapp_message_logs order by created_at desc limit 30`,
    ),
  ]);
  return {
    services: services.rows,
    plans: plans.rows,
    coupons: coupons.rows,
    flows: flows.rows,
    conversations: conversations.rows,
    logs: logs.rows,
  };
}

export async function getAiPanel() {
  const [settings, base] = await Promise.all([getAiSettings(), getAiBase()]);
  return {
    status: {
      gemini: geminiPublicStatus(),
      database: { configured: true },
      ai: {
        enabled: settings.enabled,
        active: settings.enabled && geminiPublicStatus().enabled && geminiPublicStatus().configured,
      },
    },
    personalityModes,
    settings,
    base,
  };
}

export function buildRuntimePrompt(settings) {
  const mode =
    personalityModes.find((item) => item.value === settings.personalityMode) ||
    personalityModes[0];
  return `${settings.systemPrompt || DEFAULT_SYSTEM_PROMPT}

Contexto configurado:
- Salão: ${settings.salonName}
- Assistente: ${settings.assistantName}
- Modo de humor: ${mode.label} — ${mode.description}
- Nunca inventar preços, horários, cupons, planos, pagamentos ou confirmações.
- Ao precisar de dados comerciais, agenda ou pagamento, use somente ferramentas reais do backend.
- Palavra para humano: ${settings.pauseKeyword}
- Palavra para parar automações: ${settings.stopKeyword}`.trim();
}
