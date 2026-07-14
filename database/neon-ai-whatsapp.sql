-- Configurações do Atendimento IA no WhatsApp.

create table if not exists public.ai_settings (
  id uuid primary key default uuid_generate_v4(),
  business_id text not null default 'default',
  enabled boolean not null default false,
  provider text not null default 'openai',
  model text not null default 'gpt-5.4-mini',
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

alter table public.ai_settings add column if not exists primary_provider text not null default 'openai';
alter table public.ai_settings add column if not exists primary_model text not null default 'gpt-5.4-mini';
alter table public.ai_settings add column if not exists fallback_provider text not null default 'openai';
alter table public.ai_settings add column if not exists fallback_model text not null default 'gpt-5.4-mini';
alter table public.ai_settings add column if not exists timeout_ms integer not null default 7000;
alter table public.ai_settings add column if not exists max_retries integer not null default 2;
alter table public.ai_settings add column if not exists grouping_window_ms integer not null default 1500;
alter table public.ai_settings add column if not exists context_limit integer not null default 8;
alter table public.ai_settings add column if not exists max_response_tokens integer not null default 220;
alter table public.ai_settings add column if not exists fallback_enabled boolean not null default false;
alter table public.ai_settings add column if not exists contingency_enabled boolean not null default true;
alter table public.ai_settings add column if not exists cache_enabled boolean not null default true;
alter table public.ai_settings add column if not exists human_transfer_enabled boolean not null default true;
alter table public.ai_settings add column if not exists circuit_breaker_cooldown_seconds integer not null default 60;
alter table public.ai_settings add column if not exists gemini_circuit_breaker_until timestamptz;
alter table public.ai_settings add column if not exists groq_circuit_breaker_until timestamptz;

update public.ai_settings
set provider='openai',
    model=case when model ~* '^(gemini|llama)' or model is null then 'gpt-5.4-mini' else model end,
    primary_provider='openai',
    primary_model=case when primary_model ~* '^(gemini|llama)' or primary_model is null then 'gpt-5.4-mini' else primary_model end,
    fallback_provider='openai',
    fallback_model='gpt-5.4-mini',
    fallback_enabled=false;

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
  booking_state jsonb not null default '{}',
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

create table if not exists public.whatsapp_incoming_queue (
  id uuid primary key default uuid_generate_v4(),
  phone_number text not null,
  message_id text not null unique,
  text text not null,
  processed boolean not null default false,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create table if not exists public.ai_request_logs (
  id uuid primary key default uuid_generate_v4(),
  conversation_id uuid references public.whatsapp_conversations(id) on delete set null,
  message_id uuid references public.whatsapp_messages(id) on delete set null,
  provider text,
  model text,
  status text,
  retry_count int not null default 0,
  fallback_used boolean not null default false,
  queue_latency_ms int,
  provider_latency_ms int,
  total_latency_ms int,
  input_tokens_estimated int,
  output_tokens_estimated int,
  error_code text,
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists public.knowledge_articles (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  slug text not null unique,
  category text not null,
  question_variations jsonb not null default '[]',
  short_answer text not null,
  full_answer text not null,
  recommended_followup_questions jsonb not null default '[]',
  recommended_services jsonb not null default '[]',
  requires_evaluation boolean not null default false,
  requires_human_handoff boolean not null default false,
  medical_safety_level text not null default 'normal',
  status text not null default 'active',
  priority int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists whatsapp_incoming_queue_phone_processed_idx on public.whatsapp_incoming_queue(phone_number, processed);
create index if not exists ai_request_logs_created_idx on public.ai_request_logs(created_at desc);
create index if not exists knowledge_articles_category_idx on public.knowledge_articles(category);
create index if not exists knowledge_articles_status_idx on public.knowledge_articles(status);

alter table public.services add column if not exists show_online_booking boolean not null default true;
alter table public.services add column if not exists is_free boolean not null default false;

create table if not exists public.marketing_promotions (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  description text,
  promotional_value numeric(12,2) not null default 0,
  original_value numeric(12,2),
  starts_at date,
  ends_at date,
  active boolean not null default true,
  show_on_site boolean not null default false,
  whatsapp_only boolean not null default true,
  keywords jsonb not null default '[]',
  archived boolean not null default false,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists marketing_promotions_active_idx on public.marketing_promotions(active, archived, starts_at, ends_at);

alter table public.whatsapp_conversations add column if not exists booking_state jsonb not null default '{}';

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

insert into public.ai_automation_flows(flow_key,name) values
  ('boas_vindas', 'Boas-vindas'),
  ('cliente_nova', 'IdentificaÃ§Ã£o de cliente nova'),
  ('cliente_existente', 'IdentificaÃ§Ã£o de cliente existente'),
  ('apresentacao_servicos', 'ApresentaÃ§Ã£o de serviÃ§os'),
  ('consulta_valores', 'Consulta de valores'),
  ('pre_orcamento', 'PrÃ©-orÃ§amento'),
  ('solicitacao_fotos', 'SolicitaÃ§Ã£o de fotos'),
  ('verificacao_agenda', 'VerificaÃ§Ã£o de agenda'),
  ('pre_agendamento', 'PrÃ©-agendamento'),
  ('confirmacao_agendamento', 'ConfirmaÃ§Ã£o de agendamento'),
  ('lembrete_atendimento', 'Lembrete de atendimento'),
  ('reagendamento', 'Reagendamento'),
  ('manutencao_proxima', 'ManutenÃ§Ã£o prÃ³xima'),
  ('cobranca_pagamento', 'CobranÃ§a de pagamento pendente'),
  ('envio_link_sumup', 'Envio de link SumUp'),
  ('oferta_plano', 'Oferta de plano'),
  ('aplicacao_cupom', 'AplicaÃ§Ã£o de cupom'),
  ('indique_ganhe', 'Indique e Ganhe'),
  ('transferencia_humano', 'TransferÃªncia para humano'),
  ('pos_atendimento', 'PÃ³s-atendimento'),
  ('pedido_avaliacao', 'Pedido de avaliaÃ§Ã£o')
on conflict(flow_key) do nothing;
