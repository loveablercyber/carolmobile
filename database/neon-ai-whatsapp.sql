-- Configurações do Atendimento IA no WhatsApp.

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

insert into public.ai_settings(business_id, system_prompt, welcome_message, after_hours_message, human_handoff_message, closing_message)
values(
  'default',
  'Você é a assistente virtual do salão [NOME_SALAO], especializado em Mega Hair premium. Use apenas informações fornecidas pelas ferramentas do sistema. Nunca invente valores, horários, cupons, disponibilidade, formas de pagamento ou políticas. Antes de confirmar um agendamento, mostre resumo completo e peça confirmação explícita. Quando houver dúvida, pedido de desconto fora das regras, reclamação, pagamento com problema ou pedido de atendente, transfira para uma pessoa da equipe. Responda em português do Brasil, com mensagens curtas, claras e elegantes.',
  'Oi! Sou a assistente virtual da Carol Sol. Posso te ajudar com serviços, valores, horários e agendamento.',
  'No momento estamos fora do horário de atendimento. Posso registrar sua mensagem e nossa equipe continua assim que possível.',
  'Vou encaminhar sua mensagem para nossa equipe. Em breve uma pessoa do salão continuará seu atendimento por aqui.',
  'Obrigada pelo contato! Se precisar de algo mais, é só me chamar.'
)
on conflict(business_id) do nothing;
