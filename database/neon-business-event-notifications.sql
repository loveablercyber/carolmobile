create table if not exists public.business_event_requests (
  id uuid primary key default uuid_generate_v4(),
  type text not null check (type in ('donation_created','course_requested','product_sold')),
  requested_by uuid references public.profiles(id) on delete set null,
  client_name text,
  contact_phone text,
  description text not null,
  metadata jsonb not null default '{}',
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create index if not exists business_event_requests_type_created_idx
  on public.business_event_requests(type, created_at desc);
