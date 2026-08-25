-- Retoma automaticamente o bot quando o atendimento humano ultrapassa o prazo configurado.

alter table public.ai_settings
  add column if not exists auto_resume_after_human_enabled boolean not null default true;

alter table public.ai_settings
  add column if not exists human_response_timeout_minutes integer not null default 15;

alter table public.whatsapp_conversations
  add column if not exists human_takeover_at timestamptz;

update public.ai_settings
set auto_resume_after_human_enabled=true,
    human_response_timeout_minutes=coalesce(human_response_timeout_minutes,15)
where business_id='default';

create index if not exists whatsapp_conversations_human_resume_idx
  on public.whatsapp_conversations(human_takeover_at)
  where status='human' and ai_enabled=false and human_takeover_at is not null;
