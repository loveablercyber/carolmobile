-- Compatibilidade mínima para executar o modelo originalmente preparado para Supabase no Neon.
create extension if not exists "uuid-ossp";
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default uuid_generate_v4(),
  email text unique,
  phone text unique,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create table if not exists public._luxe_migrations (
  version text primary key,
  description text not null,
  applied_at timestamptz not null default now()
);
