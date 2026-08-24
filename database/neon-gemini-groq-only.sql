-- Remove a OpenAI do atendimento e transfere a operação para Gemini + Groq.

alter table public.ai_settings add column if not exists gemini_api_key text;
alter table public.ai_settings add column if not exists groq_api_key text;
alter table public.ai_settings add column if not exists gemini_enabled boolean not null default false;
alter table public.ai_settings add column if not exists groq_enabled boolean not null default false;

update public.ai_settings
set provider='gemini',
    model='gemini-3.5-flash-lite',
    primary_provider='gemini',
    primary_model='gemini-3.5-flash-lite',
    fallback_provider='groq',
    fallback_model='openai/gpt-oss-20b',
    fallback_enabled=true,
    gemini_enabled=true,
    groq_enabled=true,
    enabled=true;

update public.whatsapp_conversations
set status='ai', ai_enabled=true, assigned_to=null, updated_at=now();

update public.human_handoff_tickets
set status='closed', resolved_at=coalesce(resolved_at,now()), updated_at=now()
where status in ('pending','open');

alter table public.ai_settings drop column if exists openai_api_key;
alter table public.ai_settings drop column if exists openai_enabled;
