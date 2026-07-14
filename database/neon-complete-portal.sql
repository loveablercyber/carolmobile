-- Camada operacional completa para cliente, profissional e administração.
alter table public.profiles add column if not exists instagram text;
alter table public.profiles add column if not exists address jsonb default '{}';
alter table public.profiles add column if not exists account_status text not null default 'active';
alter table public.profiles add column if not exists cpf text;
alter table public.clients add column if not exists cpf text;
alter table public.clients add column if not exists personal_notes text;

alter table public.payments alter column status drop default;
alter table public.payments alter column status type text using status::text;
alter table public.payments alter column status set default 'pending';
alter table public.payments add column if not exists subscription_id uuid references public.subscriptions(id);
alter table public.payments add column if not exists discount_amount numeric(12,2) default 0;
alter table public.payments add column if not exists paid_amount numeric(12,2) default 0;
alter table public.payments add column if not exists receipt_url text;
alter table public.payments add column if not exists notes text;
alter table public.payments add column if not exists confirmed_by uuid references public.profiles(id);
alter table public.payments add column if not exists updated_at timestamptz default now();

alter table public.subscriptions alter column status set default 'draft';
alter table public.subscriptions add column if not exists payment_method text;
alter table public.subscriptions add column if not exists remaining_maintenances int default 0;
alter table public.subscriptions add column if not exists expires_at date;
alter table public.subscriptions add column if not exists created_at timestamptz default now();
alter table public.subscriptions add column if not exists updated_at timestamptz default now();

create table if not exists public.saved_cards (
  id uuid primary key default uuid_generate_v4(), client_id uuid not null references public.clients(id) on delete cascade,
  brand text not null, last_four text not null check(last_four ~ '^\d{4}$'), holder_name text not null,
  external_token text, active boolean not null default true, is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.coupon_usage (
  id uuid primary key default uuid_generate_v4(), coupon_id uuid not null references public.coupons(id),
  client_id uuid not null references public.clients(id), appointment_id uuid references public.appointments(id),
  used_at timestamptz not null default now(), discount_amount numeric(12,2) default 0
);

create table if not exists public.notification_preferences (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  in_app boolean not null default true, whatsapp boolean not null default true, email boolean not null default true,
  reminders boolean not null default true, promotions boolean not null default false, updated_at timestamptz default now()
);

create table if not exists public.privacy_consents (
  id uuid primary key default uuid_generate_v4(), profile_id uuid not null references public.profiles(id) on delete cascade,
  consent_type text not null, accepted boolean not null, accepted_at timestamptz, revoked_at timestamptz,
  policy_version text not null default '1.0', created_at timestamptz default now(),
  unique(profile_id, consent_type)
);

create table if not exists public.data_export_requests (
  id uuid primary key default uuid_generate_v4(), profile_id uuid not null references public.profiles(id),
  status text not null default 'pending', requested_at timestamptz default now(), completed_at timestamptz
);

create table if not exists public.account_deletion_requests (
  id uuid primary key default uuid_generate_v4(), profile_id uuid not null references public.profiles(id),
  reason text, status text not null default 'requested', requested_at timestamptz default now(),
  reviewed_at timestamptz, reviewed_by uuid references public.profiles(id)
);

alter table public.referrals add column if not exists invited_name text;
alter table public.referrals add column if not exists invited_phone text;
alter table public.referrals add column if not exists created_at timestamptz default now();
create table if not exists public.referral_rewards (
  id uuid primary key default uuid_generate_v4(), referral_id uuid not null references public.referrals(id) on delete cascade,
  client_id uuid not null references public.clients(id), kind text not null, points int default 0,
  amount numeric(12,2) default 0, status text not null default 'pending', granted_at timestamptz
);

create table if not exists public.professional_availability (
  id uuid primary key default uuid_generate_v4(), professional_id uuid not null references public.professionals(id) on delete cascade,
  weekday int not null check(weekday between 0 and 6), starts_at time not null, ends_at time not null,
  active boolean not null default true, unique(professional_id,weekday,starts_at,ends_at)
);

create table if not exists public.business_settings (
  key text primary key, value jsonb not null default '{}', updated_by uuid references public.profiles(id), updated_at timestamptz default now()
);

create table if not exists public.client_internal_notes (
  id uuid primary key default uuid_generate_v4(), client_id uuid not null references public.clients(id) on delete cascade,
  author_id uuid not null references public.profiles(id), note text not null, created_at timestamptz default now()
);

create index if not exists payments_client_created_idx on public.payments(client_id,created_at desc);
create index if not exists payments_subscription_idx on public.payments(subscription_id);
create index if not exists payments_status_idx on public.payments(status,created_at desc);
create index if not exists subscriptions_client_status_idx on public.subscriptions(client_id,status);
create index if not exists subscriptions_plan_idx on public.subscriptions(plan_id);
create index if not exists saved_cards_client_idx on public.saved_cards(client_id,active);
create index if not exists coupon_usage_client_idx on public.coupon_usage(client_id,used_at desc);
create index if not exists privacy_consents_profile_idx on public.privacy_consents(profile_id);
create index if not exists data_exports_profile_idx on public.data_export_requests(profile_id,requested_at desc);
create index if not exists deletion_requests_profile_idx on public.account_deletion_requests(profile_id,requested_at desc);
create index if not exists referrals_referrer_idx on public.referrals(referrer_client_id,created_at desc);
create index if not exists professional_availability_idx on public.professional_availability(professional_id,weekday);
create index if not exists client_internal_notes_idx on public.client_internal_notes(client_id,created_at desc);

insert into public.notification_preferences(profile_id)
select id from public.profiles on conflict(profile_id) do nothing;

insert into public.privacy_consents(profile_id,consent_type,accepted,accepted_at,policy_version)
select p.id, v.consent_type, false, null, '1.0'
from public.profiles p cross join (values ('marketing'),('whatsapp'),('email'),('photos'),('referrals')) v(consent_type)
where p.role='client'
on conflict(profile_id,consent_type) do nothing;
