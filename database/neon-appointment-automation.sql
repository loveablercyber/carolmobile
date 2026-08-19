-- Confiabilidade de agendamentos, notificações, lembretes e calendário.
-- Migração aditiva: preserva todos os registros históricos existentes.

alter table public.appointments add column if not exists source text not null default 'app';
alter table public.appointments add column if not exists timezone text not null default 'America/Sao_Paulo';
alter table public.appointments add column if not exists duration_minutes integer;
alter table public.appointments add column if not exists idempotency_key text;
alter table public.appointments add column if not exists confirmed_at timestamptz;
alter table public.appointments add column if not exists cancelled_at timestamptz;
alter table public.appointments add column if not exists cancelled_by uuid references public.profiles(id);

update public.appointments
set duration_minutes = greatest(1, round(extract(epoch from (ends_at - starts_at)) / 60)::integer)
where duration_minutes is null and ends_at > starts_at;

update public.appointments
set source = case
  when intake_data->>'origin' = 'whatsapp_ai' then 'bot'
  when source is null or btrim(source) = '' then 'app'
  else source
end;

update public.appointments
set confirmed_at = coalesce(confirmed_at, updated_at, created_at)
where status in ('confirmed','in_service','completed','rescheduled') and confirmed_at is null;

update public.appointments
set cancelled_at = coalesce(cancelled_at, updated_at, created_at)
where status = 'cancelled' and cancelled_at is null;

create unique index if not exists appointments_idempotency_key_unique
  on public.appointments(idempotency_key)
  where idempotency_key is not null;
create index if not exists appointments_source_starts_idx
  on public.appointments(source, starts_at desc);
create index if not exists appointments_professional_active_starts_idx
  on public.appointments(professional_id, starts_at)
  where status not in ('cancelled','no_show');
create index if not exists appointments_client_starts_idx
  on public.appointments(client_id, starts_at desc);
create index if not exists appointments_status_starts_idx
  on public.appointments(status, starts_at);

alter table public.notifications add column if not exists appointment_id uuid
  references public.appointments(id) on delete cascade;
alter table public.notifications add column if not exists delivery_status text not null default 'pending';
alter table public.notifications add column if not exists delivery_attempts integer not null default 0;
alter table public.notifications add column if not exists last_delivery_error text;
alter table public.notifications add column if not exists delivered_at timestamptz;
alter table public.notifications add column if not exists cancelled_at timestamptz;
alter table public.notifications add column if not exists updated_at timestamptz not null default now();

update public.notifications
set appointment_id = (data->>'appointment_id')::uuid
where appointment_id is null
  and coalesce(data->>'appointment_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

update public.notifications n
set delivery_status = 'sent',
    delivered_at = coalesce(n.delivered_at, n.created_at),
    updated_at = now()
where exists (
  select 1 from public.notification_delivery_logs l
  where l.notification_id=n.id and l.status in ('delivered','sent')
);

alter table public.notification_delivery_logs add column if not exists attempt integer not null default 1;
create index if not exists notifications_appointment_created_idx
  on public.notifications(appointment_id, created_at desc);
create index if not exists notifications_delivery_queue_idx
  on public.notifications(delivery_status, scheduled_at, created_at)
  where delivery_status in ('pending','failed','processing');
create index if not exists notification_delivery_channel_status_idx
  on public.notification_delivery_logs(notification_id, channel, status, created_at desc);

insert into public.business_settings(key,value,updated_at)
values(
  'appointment_automation',
  '{
    "bookingEnabled": true,
    "notifyClientOnCreate": true,
    "notifyProfessionalOnCreate": true,
    "reminder24hEnabled": true,
    "reminder24hHoursBefore": 24,
    "reminder2hEnabled": true,
    "reminder2hHoursBefore": 2,
    "notifyClientOnReschedule": true,
    "notifyProfessionalOnReschedule": true,
    "notifyClientOnCancel": true,
    "notifyProfessionalOnCancel": true,
    "googleCalendarLinkEnabled": true,
    "reminderRetryWindowMinutes": 90,
    "maxDeliveryAttempts": 3,
    "timezone": "America/Sao_Paulo"
  }'::jsonb,
  now()
)
on conflict(key) do nothing;
