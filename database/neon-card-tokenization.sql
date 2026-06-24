-- Tokenização de cartões via SumUp. Nenhum PAN ou CVV é armazenado localmente.
alter table public.clients add column if not exists sumup_customer_id text;
create unique index if not exists clients_sumup_customer_unique
  on public.clients(sumup_customer_id) where sumup_customer_id is not null;

alter table public.saved_cards add column if not exists provider text;
alter table public.saved_cards add column if not exists provider_customer_id text;
alter table public.saved_cards add column if not exists tokenized_at timestamptz;
alter table public.saved_cards add column if not exists updated_at timestamptz default now();

-- Registros anteriores eram apenas referências digitadas manualmente e não podem ser tratados como tokenizados.
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
