alter table auth.users add column if not exists last_login_at timestamptz;
alter table public.notifications add column if not exists notification_key text;

create unique index if not exists notifications_key_unique on public.notifications(notification_key) where notification_key is not null;
create index if not exists appointments_client_starts_idx on public.appointments(client_id, starts_at desc);
create index if not exists appointments_status_starts_idx on public.appointments(status, starts_at);
create index if not exists notifications_profile_created_idx on public.notifications(profile_id, created_at desc);
create index if not exists clients_profile_idx on public.clients(profile_id);
create index if not exists professionals_profile_idx on public.professionals(profile_id);

create table if not exists auth.password_reset_tokens (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists password_reset_user_idx on auth.password_reset_tokens(user_id, created_at desc);
