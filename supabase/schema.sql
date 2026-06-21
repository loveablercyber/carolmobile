-- LUXE HAIR — estrutura inicial para Supabase/PostgreSQL
create extension if not exists "uuid-ossp";

create type public.user_role as enum ('client','professional','admin');
create type public.appointment_status as enum ('pending_deposit','confirmed','in_service','completed','cancelled','no_show','rescheduled');
create type public.payment_status as enum ('pending','paid','refunded','failed');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role user_role not null default 'client', full_name text not null, phone text, avatar_url text,
  birth_date date, notification_preferences jsonb default '{}', created_at timestamptz default now(), updated_at timestamptz default now()
);
create table public.clients (
  id uuid primary key default uuid_generate_v4(), profile_id uuid unique references public.profiles(id) on delete cascade,
  source text, preferences jsonb default '{}', technical_notes text, lifetime_value numeric(12,2) default 0, created_at timestamptz default now()
);
create table public.professionals (
  id uuid primary key default uuid_generate_v4(), profile_id uuid unique references public.profiles(id) on delete cascade,
  bio text, specialties text[] default '{}', commission_rate numeric(5,2), active boolean default true, hired_at date
);
create table public.admins (id uuid primary key default uuid_generate_v4(), profile_id uuid unique references public.profiles(id) on delete cascade, permissions jsonb default '{}');
create table public.salon_locations (id uuid primary key default uuid_generate_v4(), name text not null, address jsonb not null, phone text, active boolean default true);
create table public.chairs_or_rooms (id uuid primary key default uuid_generate_v4(), location_id uuid references public.salon_locations(id), name text not null, kind text, active boolean default true);

create table public.service_categories (id uuid primary key default uuid_generate_v4(), name text not null, sort_order int default 0);
create table public.hair_methods (id uuid primary key default uuid_generate_v4(), name text not null, description text, maintenance_days int, active boolean default true);
create table public.services (
  id uuid primary key default uuid_generate_v4(), category_id uuid references public.service_categories(id), hair_method_id uuid references public.hair_methods(id),
  name text not null, description text, duration_minutes int not null, base_price numeric(12,2) not null, deposit_amount numeric(12,2) default 0, active boolean default true
);
create table public.professional_services (professional_id uuid references public.professionals(id) on delete cascade, service_id uuid references public.services(id) on delete cascade, custom_price numeric(12,2), commission_rate numeric(5,2), primary key(professional_id,service_id));

create table public.appointments (
  id uuid primary key default uuid_generate_v4(), client_id uuid not null references public.clients(id), professional_id uuid not null references public.professionals(id),
  service_id uuid not null references public.services(id), location_id uuid references public.salon_locations(id), chair_or_room_id uuid references public.chairs_or_rooms(id),
  starts_at timestamptz not null, ends_at timestamptz not null, status appointment_status default 'pending_deposit', notes text, estimated_value numeric(12,2),
  cancellation_reason text, created_by uuid references public.profiles(id), created_at timestamptz default now(), constraint valid_appointment_range check(ends_at > starts_at)
);
create index appointments_schedule_idx on public.appointments(professional_id,starts_at,ends_at);
create table public.appointment_status_history (id uuid primary key default uuid_generate_v4(), appointment_id uuid references public.appointments(id) on delete cascade, from_status appointment_status, to_status appointment_status not null, changed_by uuid references public.profiles(id), note text, created_at timestamptz default now());
create table public.blocked_schedule (id uuid primary key default uuid_generate_v4(), professional_id uuid references public.professionals(id), location_id uuid references public.salon_locations(id), starts_at timestamptz not null, ends_at timestamptz not null, reason text);
create table public.waitlist (id uuid primary key default uuid_generate_v4(), client_id uuid references public.clients(id), service_id uuid references public.services(id), preferred_professional_id uuid references public.professionals(id), preferred_dates daterange, status text default 'waiting', created_at timestamptz default now());

create table public.payments (id uuid primary key default uuid_generate_v4(), appointment_id uuid references public.appointments(id), client_id uuid references public.clients(id), amount numeric(12,2) not null, method text not null, status payment_status default 'pending', provider_reference text, installments int default 1, paid_at timestamptz, created_at timestamptz default now());
create table public.plans (id uuid primary key default uuid_generate_v4(), name text not null, price numeric(12,2) not null, billing_cycle text, benefits jsonb default '[]', active boolean default true);
create table public.subscriptions (id uuid primary key default uuid_generate_v4(), client_id uuid references public.clients(id), plan_id uuid references public.plans(id), status text default 'active', starts_at date, renews_at date, cancelled_at timestamptz);
create table public.loyalty_points (id uuid primary key default uuid_generate_v4(), client_id uuid references public.clients(id), points int not null, reason text not null, expires_at date, created_at timestamptz default now());
create table public.coupons (id uuid primary key default uuid_generate_v4(), code text unique not null, description text, discount_type text, discount_value numeric(12,2), starts_at timestamptz, ends_at timestamptz, usage_limit int, target jsonb default '{}', active boolean default true);

create table public.campaigns (id uuid primary key default uuid_generate_v4(), name text not null, channel text[] default '{}', target_filters jsonb default '{}', content jsonb default '{}', status text default 'draft', scheduled_at timestamptz, created_by uuid references public.profiles(id), created_at timestamptz default now());
create table public.referrals (id uuid primary key default uuid_generate_v4(), referrer_client_id uuid references public.clients(id), referred_client_id uuid references public.clients(id), code text unique, status text default 'invited', reward_amount numeric(12,2));
create table public.whatsapp_templates (id uuid primary key default uuid_generate_v4(), name text not null, category text, body text not null, variables text[] default '{}', active boolean default true);
create table public.notifications (id uuid primary key default uuid_generate_v4(), profile_id uuid references public.profiles(id), kind text not null, title text not null, body text not null, data jsonb default '{}', read_at timestamptz, scheduled_at timestamptz, created_at timestamptz default now());

create table public.client_photos (id uuid primary key default uuid_generate_v4(), client_id uuid references public.clients(id), appointment_id uuid references public.appointments(id), kind text not null, storage_path text not null, consent_log_id uuid, created_at timestamptz default now());
create table public.before_after_gallery (id uuid primary key default uuid_generate_v4(), client_id uuid references public.clients(id), service_id uuid references public.services(id), before_photo_path text not null, after_photo_path text not null, tags text[] default '{}', consent_to_publish boolean default false, published boolean default false);
create table public.technical_records (id uuid primary key default uuid_generate_v4(), appointment_id uuid unique references public.appointments(id), client_id uuid references public.clients(id), professional_id uuid references public.professionals(id), hair_method_id uuid references public.hair_methods(id), strands_count int, weight_grams numeric(8,2), color text, shade text, length_cm int, texture text, hair_lot text, products_used jsonb default '[]', recommendations text, internal_notes text, next_maintenance_date date, final_value numeric(12,2), payment_status payment_status, created_at timestamptz default now());

create table public.hair_inventory (id uuid primary key default uuid_generate_v4(), code text unique not null, supplier text, category text not null, color text, shade text, length_cm int, texture text, weight_grams numeric(8,2), lot text, unit_cost numeric(12,2), suggested_price numeric(12,2), quantity numeric(10,2) default 0, minimum_stock numeric(10,2) default 0, status text default 'active', created_at timestamptz default now());
create table public.inventory_movements (id uuid primary key default uuid_generate_v4(), inventory_id uuid references public.hair_inventory(id), technical_record_id uuid references public.technical_records(id), kind text not null, quantity numeric(10,2) not null, unit_cost numeric(12,2), note text, created_by uuid references public.profiles(id), created_at timestamptz default now());
create table public.products (id uuid primary key default uuid_generate_v4(), sku text unique, name text not null, category text, cost numeric(12,2), price numeric(12,2), stock_quantity int default 0, minimum_stock int default 0, active boolean default true);
create table public.product_sales (id uuid primary key default uuid_generate_v4(), client_id uuid references public.clients(id), professional_id uuid references public.professionals(id), product_id uuid references public.products(id), quantity int not null, unit_price numeric(12,2), payment_id uuid references public.payments(id), sold_at timestamptz default now());
create table public.commissions (id uuid primary key default uuid_generate_v4(), professional_id uuid references public.professionals(id), appointment_id uuid references public.appointments(id), product_sale_id uuid references public.product_sales(id), base_amount numeric(12,2), rate numeric(5,2), amount numeric(12,2), status text default 'pending', period date, paid_at timestamptz);
create table public.professional_goals (id uuid primary key default uuid_generate_v4(), professional_id uuid references public.professionals(id), period daterange, revenue_goal numeric(12,2), service_goal int, product_goal numeric(12,2), recurrence_goal numeric(5,2));
create table public.reviews (id uuid primary key default uuid_generate_v4(), appointment_id uuid unique references public.appointments(id), client_id uuid references public.clients(id), professional_id uuid references public.professionals(id), rating int check(rating between 1 and 5), comment text, published boolean default true, created_at timestamptz default now());

create table public.consent_logs (id uuid primary key default uuid_generate_v4(), profile_id uuid references public.profiles(id), consent_type text not null, granted boolean not null, policy_version text not null, source text, ip_hash text, created_at timestamptz default now());
alter table public.client_photos add constraint client_photos_consent_fk foreign key(consent_log_id) references public.consent_logs(id);
create table public.audit_logs (id bigserial primary key, actor_id uuid references public.profiles(id), action text not null, entity_type text not null, entity_id text, previous_data jsonb, new_data jsonb, created_at timestamptz default now());

-- RLS: usuários autenticados só acessam dados coerentes com seu papel. Políticas detalhadas devem ser revisadas antes de produção.
alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.professionals enable row level security;
alter table public.appointments enable row level security;
alter table public.technical_records enable row level security;
alter table public.payments enable row level security;
alter table public.client_photos enable row level security;

create policy "profile can read own row" on public.profiles for select using (auth.uid() = id);
create policy "profile can update own row" on public.profiles for update using (auth.uid() = id);
create policy "client can read own client record" on public.clients for select using (profile_id = auth.uid());
create policy "client can read own appointments" on public.appointments for select using (client_id in (select id from public.clients where profile_id = auth.uid()));
create policy "professional can read assigned appointments" on public.appointments for select using (professional_id in (select id from public.professionals where profile_id = auth.uid()));
