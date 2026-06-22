-- Fluxos transacionais, integrações e trilhas de auditoria do portal Carol Sol.

alter table public.appointments alter column status drop default;
alter table public.appointments alter column status type text using status::text;
alter table public.appointments alter column status set default 'requested';
alter table public.appointment_status_history alter column from_status type text using from_status::text;
alter table public.appointment_status_history alter column to_status type text using to_status::text;

alter table public.appointments add column if not exists booking_code text;
alter table public.appointments add column if not exists intake_data jsonb not null default '{}';
alter table public.appointments add column if not exists original_value numeric(12,2);
alter table public.appointments add column if not exists discount_amount numeric(12,2) not null default 0;
alter table public.appointments add column if not exists coupon_id uuid references public.coupons(id);
alter table public.appointments add column if not exists updated_at timestamptz not null default now();
update public.appointments set booking_code='CS-'||upper(right(replace(id::text,'-',''),12)) where booking_code is null;
create unique index if not exists appointments_booking_code_unique on public.appointments(booking_code);

create table if not exists public.appointment_messages (
  id uuid primary key default uuid_generate_v4(), appointment_id uuid not null references public.appointments(id) on delete cascade,
  sender_profile_id uuid references public.profiles(id), message text not null, message_type text not null default 'note',
  visible_to_client boolean not null default true, created_at timestamptz not null default now()
);

create table if not exists public.reschedule_requests (
  id uuid primary key default uuid_generate_v4(), appointment_id uuid not null references public.appointments(id) on delete cascade,
  requested_by uuid not null references public.profiles(id), previous_status text not null,
  old_starts_at timestamptz not null, old_ends_at timestamptz not null,
  requested_starts_at timestamptz not null, requested_ends_at timestamptz not null,
  suggested_starts_at timestamptz, suggested_ends_at timestamptz, status text not null default 'pending', reason text,
  response_note text, responded_by uuid references public.profiles(id), responded_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists reschedule_one_pending_per_appointment on public.reschedule_requests(appointment_id) where status in ('pending','suggested');

create table if not exists public.quotes (
  id uuid primary key default uuid_generate_v4(), client_id uuid not null references public.clients(id),
  appointment_id uuid references public.appointments(id), plan_id uuid references public.plans(id), status text not null default 'requested',
  intake_data jsonb not null default '{}', subtotal numeric(12,2) not null default 0,
  discount_amount numeric(12,2) not null default 0, total numeric(12,2) not null default 0,
  coupon_id uuid references public.coupons(id), notes text, expires_at timestamptz, created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.quote_items (
  id uuid primary key default uuid_generate_v4(), quote_id uuid not null references public.quotes(id) on delete cascade,
  service_id uuid references public.services(id), description text not null, quantity numeric(10,2) not null default 1,
  unit_price numeric(12,2) not null default 0, total numeric(12,2) not null default 0, created_at timestamptz not null default now()
);

alter table public.subscriptions add column if not exists quote_id uuid references public.quotes(id);
alter table public.subscriptions add column if not exists activated_at timestamptz;

alter table public.payments add column if not exists quote_id uuid references public.quotes(id);
alter table public.payments add column if not exists provider text not null default 'pix_manual';
alter table public.payments add column if not exists provider_checkout_id text;
alter table public.payments add column if not exists provider_transaction_id text;
alter table public.payments add column if not exists checkout_reference text;
alter table public.payments add column if not exists hosted_checkout_url text;
alter table public.payments add column if not exists provider_status text;
alter table public.payments add column if not exists payment_method text;
alter table public.payments add column if not exists failure_reason text;
alter table public.payments add column if not exists webhook_received_at timestamptz;
alter table public.payments add column if not exists original_amount numeric(12,2);
alter table public.payments add column if not exists coupon_id uuid references public.coupons(id);
update public.payments set original_amount=amount where original_amount is null;
update public.payments set payment_method=method where payment_method is null;

create table if not exists public.payment_receipts (
  id uuid primary key default uuid_generate_v4(), payment_id uuid not null references public.payments(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id), storage_url text not null, status text not null default 'under_review',
  reviewed_by uuid references public.profiles(id), reviewed_at timestamptz, rejection_reason text, created_at timestamptz not null default now()
);

create table if not exists public.payment_status_history (
  id uuid primary key default uuid_generate_v4(), payment_id uuid not null references public.payments(id) on delete cascade,
  old_status text, new_status text not null, changed_by uuid references public.profiles(id), notes text, created_at timestamptz not null default now()
);

create table if not exists public.payment_webhook_logs (
  id uuid primary key default uuid_generate_v4(), provider text not null, event_type text, provider_checkout_id text,
  payload jsonb not null default '{}', processed boolean not null default false, processing_error text,
  received_at timestamptz not null default now(), processed_at timestamptz
);

alter table public.coupon_usage add column if not exists payment_id uuid references public.payments(id);
alter table public.coupon_usage add column if not exists quote_id uuid references public.quotes(id);
alter table public.coupon_usage add column if not exists appointment_id uuid references public.appointments(id);
alter table public.coupon_usage add column if not exists status text not null default 'reserved';
alter table public.notifications add column if not exists action_url text;
alter table public.notifications add column if not exists metadata jsonb not null default '{}';

create table if not exists public.notification_delivery_logs (
  id uuid primary key default uuid_generate_v4(), notification_id uuid references public.notifications(id) on delete set null,
  channel text not null, recipient text, status text not null, provider_reference text, error_message text, created_at timestamptz not null default now()
);

create table if not exists public.whatsapp_sessions (
  id uuid primary key default uuid_generate_v4(), professional_id uuid references public.professionals(id),
  session_name text not null unique, phone_number text, account_name text, connection_status text not null default 'disconnected',
  qr_code_data text, last_connected_at timestamptz, last_activity_at timestamptz, last_error text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.integration_settings (
  provider text primary key, enabled boolean not null default false, public_config jsonb not null default '{}',
  last_success_at timestamptz, last_error text, updated_by uuid references public.profiles(id), updated_at timestamptz not null default now()
);

create index if not exists appointment_messages_appointment_created_idx on public.appointment_messages(appointment_id,created_at);
create index if not exists reschedule_status_created_idx on public.reschedule_requests(status,created_at);
create index if not exists quotes_client_status_created_idx on public.quotes(client_id,status,created_at desc);
create index if not exists quotes_appointment_idx on public.quotes(appointment_id);
create index if not exists quote_items_quote_idx on public.quote_items(quote_id);
create index if not exists payments_provider_status_idx on public.payments(provider,status,created_at desc);
create index if not exists payments_checkout_idx on public.payments(provider_checkout_id);
create unique index if not exists payments_checkout_reference_unique on public.payments(checkout_reference) where checkout_reference is not null;
create index if not exists payment_receipts_payment_created_idx on public.payment_receipts(payment_id,created_at desc);
create index if not exists payment_history_payment_created_idx on public.payment_status_history(payment_id,created_at desc);
create index if not exists payment_webhooks_checkout_received_idx on public.payment_webhook_logs(provider_checkout_id,received_at desc);
create index if not exists notification_delivery_notification_idx on public.notification_delivery_logs(notification_id,created_at desc);
create index if not exists whatsapp_sessions_professional_idx on public.whatsapp_sessions(professional_id);

insert into public.integration_settings(provider,enabled,public_config) values
  ('sumup',false,'{"environment":"sandbox"}'), ('whatsapp',false,'{}'), ('resend',false,'{}')
on conflict(provider) do nothing;
