import { query, transaction } from "./db.js";

const VERSION = "009_recurring_billing";
const DESCRIPTION = "Cobrança recorrente idempotente de assinaturas";
const CARD_VERSION = "008_card_tokenization";
const CARD_DESCRIPTION = "Tokenização segura de cartões via SumUp";

const CARD_TOKENIZATION_SQL = `
alter table public.clients add column if not exists sumup_customer_id text;
create unique index if not exists clients_sumup_customer_unique
  on public.clients(sumup_customer_id) where sumup_customer_id is not null;

alter table public.saved_cards add column if not exists provider text;
alter table public.saved_cards add column if not exists provider_customer_id text;
alter table public.saved_cards add column if not exists tokenized_at timestamptz;
alter table public.saved_cards add column if not exists updated_at timestamptz default now();

update public.saved_cards
set active=false,is_default=false,external_token=null,provider='legacy',updated_at=now()
where provider is null;

alter table public.saved_cards alter column provider set default 'sumup';
create unique index if not exists saved_cards_provider_token_unique
  on public.saved_cards(provider,external_token) where external_token is not null;
create unique index if not exists saved_cards_one_active_default
  on public.saved_cards(client_id) where active and is_default;

create table if not exists public.card_tokenization_sessions (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references public.clients(id) on delete cascade,
  customer_id text not null,
  checkout_id text not null unique,
  checkout_reference text not null unique,
  status text not null default 'pending',
  card_id uuid references public.saved_cards(id),
  expires_at timestamptz not null default (now()+interval '30 minutes'),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists card_tokenization_client_status_idx
  on public.card_tokenization_sessions(client_id,status,created_at desc);
`;

const RECURRING_BILLING_SQL = `
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
`;

export async function recurringMigrationStatus() {
  const { rows } = await query(
    `select exists(
      select 1 from information_schema.tables
      where table_schema='public' and table_name='subscription_renewal_attempts'
    ) as has_attempts_table,
    exists(
      select 1 from information_schema.columns
      where table_schema='public' and table_name='subscriptions' and column_name='auto_renew'
    ) as has_auto_renew,
    exists(
      select 1 from information_schema.columns
      where table_schema='public' and table_name='payments' and column_name='renewal_attempt_id'
    ) as has_payment_link`,
  );
  return rows[0];
}

export async function cardTokenizationMigrationStatus() {
  const { rows } = await query(
    `select exists(
      select 1 from information_schema.columns
      where table_schema='public' and table_name='clients' and column_name='sumup_customer_id'
    ) as has_customer_id,
    exists(
      select 1 from information_schema.columns
      where table_schema='public' and table_name='saved_cards' and column_name='provider'
    ) as has_card_provider,
    exists(
      select 1 from information_schema.columns
      where table_schema='public' and table_name='saved_cards' and column_name='provider_customer_id'
    ) as has_provider_customer_id,
    exists(
      select 1 from information_schema.tables
      where table_schema='public' and table_name='card_tokenization_sessions'
    ) as has_sessions_table`,
  );
  return rows[0];
}

export async function applyCardTokenizationMigration() {
  return transaction(async (client) => {
    await client.query('create extension if not exists "uuid-ossp"');
    await client.query(`create table if not exists public._luxe_migrations (
      version text primary key,
      description text not null,
      applied_at timestamptz not null default now()
    )`);
    const { rowCount: alreadyRecorded } = await client.query(
      "select 1 from public._luxe_migrations where version=$1",
      [CARD_VERSION],
    );
    if (alreadyRecorded) return { applied: false, version: CARD_VERSION };
    await client.query(CARD_TOKENIZATION_SQL);
    await client.query(
      "insert into public._luxe_migrations(version,description) values ($1,$2) on conflict(version) do nothing",
      [CARD_VERSION, CARD_DESCRIPTION],
    );
    return { applied: true, version: CARD_VERSION };
  });
}

export async function applyRecurringBillingMigration() {
  return transaction(async (client) => {
    await client.query('create extension if not exists "uuid-ossp"');
    await client.query(`create table if not exists public._luxe_migrations (
      version text primary key,
      description text not null,
      applied_at timestamptz not null default now()
    )`);
    const { rowCount: alreadyRecorded } = await client.query(
      "select 1 from public._luxe_migrations where version=$1",
      [VERSION],
    );
    if (alreadyRecorded) return { applied: false, version: VERSION };
    await client.query(RECURRING_BILLING_SQL);
    await client.query(
      "insert into public._luxe_migrations(version,description) values ($1,$2) on conflict(version) do nothing",
      [VERSION, DESCRIPTION],
    );
    return { applied: true, version: VERSION };
  });
}
