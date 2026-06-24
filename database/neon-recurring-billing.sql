alter table public.subscriptions add column if not exists auto_renew boolean not null default false;
alter table public.subscriptions add column if not exists recurring_card_id uuid references public.saved_cards(id) on delete set null;
alter table public.subscriptions add column if not exists recurring_consent_at timestamptz;
alter table public.subscriptions add column if not exists recurring_consent_revoked_at timestamptz;
alter table public.subscriptions add column if not exists recurring_consent_version text;
alter table public.subscriptions add column if not exists renewal_failures int not null default 0;
alter table public.subscriptions add column if not exists next_retry_at timestamptz;
alter table public.subscriptions add column if not exists last_renewal_at timestamptz;

create table if not exists public.subscription_renewal_attempts (
  id uuid primary key default uuid_generate_v4(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  client_id uuid not null references public.clients(id),
  card_id uuid references public.saved_cards(id) on delete set null,
  payment_id uuid references public.payments(id) on delete set null,
  billing_period date not null,
  attempt_number int not null check(attempt_number between 1 and 3),
  idempotency_key text not null unique,
  amount numeric(12,2) not null check(amount > 0),
  status text not null default 'reserved' check(status in ('reserved','processing','paid','failed','cancelled')),
  provider_checkout_id text,
  provider_status text,
  provider_transaction_id text,
  failure_reason text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(subscription_id,billing_period,attempt_number)
);

alter table public.payments add column if not exists renewal_attempt_id uuid references public.subscription_renewal_attempts(id) on delete set null;
create unique index if not exists payments_renewal_attempt_unique on public.payments(renewal_attempt_id) where renewal_attempt_id is not null;
create index if not exists subscription_renewal_due_idx on public.subscriptions(auto_renew,renews_at,next_retry_at) where auto_renew;
create index if not exists renewal_attempts_subscription_idx on public.subscription_renewal_attempts(subscription_id,billing_period,created_at desc);
