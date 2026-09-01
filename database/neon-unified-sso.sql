create table if not exists public.carolsol_sso_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  identity_user_id uuid not null,
  target_origin text not null,
  return_path text not null default '/',
  source_origin text,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists carolsol_sso_codes_lookup_idx
  on public.carolsol_sso_codes(code_hash,target_origin,expires_at)
  where used_at is null;

create index if not exists carolsol_sso_codes_identity_created_idx
  on public.carolsol_sso_codes(identity_user_id,created_at desc);

delete from public.carolsol_sso_codes
 where expires_at < now() - interval '1 day';
