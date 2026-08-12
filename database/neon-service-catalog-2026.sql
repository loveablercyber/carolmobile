begin;

alter table public.services add column if not exists catalog_code text;
create unique index if not exists services_catalog_code_uidx
  on public.services(catalog_code);

create table if not exists public.service_variants (
  id uuid primary key default uuid_generate_v4(),
  service_id uuid not null references public.services(id) on delete restrict,
  code text not null unique,
  label text not null,
  purpose text not null default 'general'
    check (purpose in ('general','full_head','partial_or_highlights')),
  operation text not null
    check (operation in ('application','removal','removal_and_application','package_application','evaluation')),
  material_mode text not null
    check (material_mode in ('included','client_supplied','not_applicable')),
  length_label text,
  weight_grams numeric(8,2),
  weight_mode text check (weight_mode in ('exact','up_to')),
  unit_type text not null default 'flat'
    check (unit_type in ('flat','gram','faixa','tela')),
  unit_count numeric(8,2),
  unit_mode text check (unit_mode in ('exact','up_to')),
  price numeric(12,2) not null check (price >= 0),
  price_type text not null default 'fixed'
    check (price_type in ('fixed','starting_at','estimate')),
  duration_minutes int not null check (duration_minutes between 15 and 1440),
  deposit_type text not null default 'none'
    check (deposit_type in ('none','fixed','percentage','full','material_cost')),
  deposit_value numeric(12,2) not null default 0 check (deposit_value >= 0),
  deposit_non_refundable boolean not null default false,
  requires_assessment boolean not null default true,
  requires_human_confirmation boolean not null default false,
  show_online_booking boolean not null default true,
  allow_whatsapp_booking boolean not null default true,
  active boolean not null default true,
  sort_order int not null default 0,
  valid_from date,
  valid_to date,
  notes text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists service_variants_service_idx
  on public.service_variants(service_id,active,sort_order);

create table if not exists public.service_addons (
  id uuid primary key default uuid_generate_v4(),
  code text not null unique,
  name text not null,
  description text,
  price numeric(12,2) not null check (price >= 0),
  duration_minutes int not null default 0 check (duration_minutes between 0 and 1440),
  active boolean not null default true,
  show_online_booking boolean not null default true,
  allow_whatsapp_booking boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.service_variant_addons (
  service_variant_id uuid not null references public.service_variants(id) on delete cascade,
  addon_id uuid not null references public.service_addons(id) on delete cascade,
  primary key(service_variant_id,addon_id)
);

alter table public.appointments add column if not exists service_variant_id uuid
  references public.service_variants(id) on delete restrict;
alter table public.appointments add column if not exists catalog_snapshot jsonb not null default '{}';

create table if not exists public.appointment_addons (
  id uuid primary key default uuid_generate_v4(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  addon_id uuid references public.service_addons(id) on delete set null,
  addon_code text not null,
  addon_name text not null,
  price numeric(12,2) not null check (price >= 0),
  duration_minutes int not null default 0 check (duration_minutes >= 0),
  created_at timestamptz not null default now(),
  unique(appointment_id,addon_code)
);

insert into public.service_categories(name,sort_order)
select v.name,v.sort_order from (values
  ('Aplicação com cabelo/fibra inclusa',10),
  ('Aplicação — somente mão de obra',20),
  ('Manutenção — somente mão de obra',30),
  ('Avaliação',40),
  ('Adicionais',50)
) v(name,sort_order)
where not exists(select 1 from public.service_categories c where lower(c.name)=lower(v.name));

insert into public.hair_methods(name,description,active)
select v.name,v.description,true from (values
  ('Fita Adesiva','Aplicação por fitas adesivas.'),
  ('Ponto Americano Invisível','Aplicação por telas no ponto americano invisível.'),
  ('Entrelace','Aplicação pelo método entrelace.'),
  ('Microcápsula de Queratina','Aplicação por microcápsulas de queratina.')
) v(name,description)
where not exists(select 1 from public.hair_methods m where lower(m.name)=lower(v.name));

with catalog(code,name,description,duration,price,deposit,category,method) as (values
 ('assessment-extensions','Avaliação para alongamento','Avaliação obrigatória para confirmar técnica, características do cabelo, disponibilidade do material e condições do procedimento.',60,0,0,'Avaliação',null),
 ('combo-fita','Combo Fibra Russa + Fita Adesiva','Fibra sintética comercial Fibra Russa e colocação por Fita Adesiva inclusas. Disponibilidade confirmada por uma profissional após avaliação.',180,390,0,'Aplicação com cabelo/fibra inclusa','Fita Adesiva'),
 ('combo-ponto','Combo Fibra Russa + Ponto Americano Invisível','Fibra sintética comercial Fibra Russa e colocação por Ponto Americano Invisível inclusas. Disponibilidade confirmada após avaliação.',240,390,50,'Aplicação com cabelo/fibra inclusa','Ponto Americano Invisível'),
 ('combo-entrelace','Combo Fibra Russa + Entrelace','Fibra sintética comercial Fibra Russa e colocação por Entrelace inclusas. Disponibilidade confirmada após avaliação.',360,690,50,'Aplicação com cabelo/fibra inclusa','Entrelace'),
 ('combo-micro','Combo Fibra Russa + Microcápsula de Queratina','Fibra sintética comercial Fibra Russa e colocação por Microcápsula de Queratina inclusas. Avaliação obrigatória.',600,690,345,'Aplicação com cabelo/fibra inclusa','Microcápsula de Queratina'),
 ('labor-apply-fita','Aplicação com Fita Adesiva — mão de obra','Somente mão de obra. O cabelo não está incluso.',180,80,0,'Aplicação — somente mão de obra','Fita Adesiva'),
 ('labor-apply-ponto','Aplicação com Ponto Americano Invisível — mão de obra','Somente mão de obra. O cabelo não está incluso.',240,60,0,'Aplicação — somente mão de obra','Ponto Americano Invisível'),
 ('labor-apply-entrelace','Aplicação com Entrelace — mão de obra','Somente mão de obra. O cabelo não está incluso.',360,360,0,'Aplicação — somente mão de obra','Entrelace'),
 ('labor-apply-micro','Aplicação com Microcápsula — mão de obra','Somente mão de obra. O cabelo não está incluso.',600,500,0,'Aplicação — somente mão de obra','Microcápsula de Queratina'),
 ('labor-maintain-fita','Manutenção com Fita Adesiva — mão de obra','Somente mão de obra. O cabelo não está incluso.',360,40,0,'Manutenção — somente mão de obra','Fita Adesiva'),
 ('labor-maintain-ponto','Manutenção com Ponto Americano — mão de obra','Somente mão de obra. O cabelo não está incluso.',480,35,0,'Manutenção — somente mão de obra','Ponto Americano Invisível'),
 ('labor-maintain-entrelace','Manutenção com Entrelace — mão de obra','Somente mão de obra. O cabelo não está incluso.',720,430,0,'Manutenção — somente mão de obra','Entrelace'),
 ('labor-maintain-micro','Manutenção com Microcápsula — mão de obra','Somente mão de obra. O cabelo não está incluso.',720,90,0,'Manutenção — somente mão de obra','Microcápsula de Queratina')
)
insert into public.services(catalog_code,name,description,duration_minutes,base_price,deposit_amount,category_id,hair_method_id,active,show_online_booking,is_free,offer_inventory_items)
select c.code,c.name,c.description,c.duration,c.price,c.deposit,sc.id,hm.id,true,true,c.price=0,false
from catalog c
join public.service_categories sc on lower(sc.name)=lower(c.category)
left join public.hair_methods hm on lower(hm.name)=lower(c.method)
on conflict(catalog_code) do update set
 name=excluded.name,description=excluded.description,duration_minutes=excluded.duration_minutes,
 base_price=excluded.base_price,deposit_amount=excluded.deposit_amount,category_id=excluded.category_id,
 hair_method_id=excluded.hair_method_id,active=true,show_online_booking=true,
 is_free=excluded.is_free,offer_inventory_items=false;

create temporary table catalog_variants (
 service_code text, code text, label text, purpose text, operation text, material_mode text,
 length_label text, weight_grams numeric, weight_mode text, unit_type text, unit_count numeric,
 unit_mode text, price numeric, duration int, deposit_type text, deposit_value numeric,
 non_refundable boolean, human_confirmation boolean, sort_order int
) on commit drop;

insert into catalog_variants values
-- Avaliação
('assessment-extensions','assessment-extensions','Avaliação para alongamento','general','evaluation','not_applicable',null,null,null,'flat',null,null,0,60,'none',0,false,false,1),
-- Combos Fita: sinal corresponde ao custo integral do material, definido após avaliação.
('combo-fita','combo-fita-60-100','60/65/70 cm — 100 g','full_head','package_application','included','60/65/70 cm',100,'exact','gram',100,'exact',440,180,'material_cost',0,false,true,1),
('combo-fita','combo-fita-60-150','60/65/70 cm — 150 g','full_head','package_application','included','60/65/70 cm',150,'exact','gram',150,'exact',525,180,'material_cost',0,false,true,2),
('combo-fita','combo-fita-60-200','60/65/70 cm — 200 g','full_head','package_application','included','60/65/70 cm',200,'exact','gram',200,'exact',660,180,'material_cost',0,false,true,3),
('combo-fita','combo-fita-60-250','60/65/70 cm — 250 g','full_head','package_application','included','60/65/70 cm',250,'exact','gram',250,'exact',800,180,'material_cost',0,false,true,4),
('combo-fita','combo-fita-60-300','60/65/70 cm — 300 g','full_head','package_application','included','60/65/70 cm',300,'exact','gram',300,'exact',930,180,'material_cost',0,false,true,5),
('combo-fita','combo-fita-60-350','60/65/70 cm — 350 g','full_head','package_application','included','60/65/70 cm',350,'exact','gram',350,'exact',1085,180,'material_cost',0,false,true,6),
('combo-fita','combo-fita-75-100','75/80 cm — 100 g','full_head','package_application','included','75/80 cm',100,'exact','gram',100,'exact',510,180,'material_cost',0,false,true,7),
('combo-fita','combo-fita-75-150','75/80 cm — 150 g','full_head','package_application','included','75/80 cm',150,'exact','gram',150,'exact',630,180,'material_cost',0,false,true,8),
('combo-fita','combo-fita-75-200','75/80 cm — 200 g','full_head','package_application','included','75/80 cm',200,'exact','gram',200,'exact',800,180,'material_cost',0,false,true,9),
('combo-fita','combo-fita-75-250','75/80 cm — 250 g','full_head','package_application','included','75/80 cm',250,'exact','gram',250,'exact',975,180,'material_cost',0,false,true,10),
('combo-fita','combo-fita-75-300','75/80 cm — 300 g','full_head','package_application','included','75/80 cm',300,'exact','gram',300,'exact',1140,180,'material_cost',0,false,true,11),
('combo-fita','combo-fita-75-350','75/80 cm — 350 g','full_head','package_application','included','75/80 cm',350,'exact','gram',350,'exact',1330,180,'material_cost',0,false,true,12),
-- Combos Ponto
('combo-ponto','combo-ponto-60-100','60/65/70 cm — 100 g','full_head','package_application','included','60/65/70 cm',100,'exact','gram',100,'exact',390,240,'fixed',50,false,true,1),
('combo-ponto','combo-ponto-60-150','60/65/70 cm — 150 g','full_head','package_application','included','60/65/70 cm',150,'exact','gram',150,'exact',410,240,'fixed',50,false,true,2),
('combo-ponto','combo-ponto-60-200','60/65/70 cm — 200 g','full_head','package_application','included','60/65/70 cm',200,'exact','gram',200,'exact',500,240,'fixed',50,false,true,3),
('combo-ponto','combo-ponto-60-250','60/65/70 cm — 250 g','full_head','package_application','included','60/65/70 cm',250,'exact','gram',250,'exact',600,240,'fixed',50,false,true,4),
('combo-ponto','combo-ponto-60-300','60/65/70 cm — 300 g','full_head','package_application','included','60/65/70 cm',300,'exact','gram',300,'exact',660,240,'fixed',50,false,true,5),
('combo-ponto','combo-ponto-60-350','60/65/70 cm — 350 g','full_head','package_application','included','60/65/70 cm',350,'exact','gram',350,'exact',770,240,'fixed',50,false,true,6),
('combo-ponto','combo-ponto-75-100','75/80 cm — 100 g','full_head','package_application','included','75/80 cm',100,'exact','gram',100,'exact',430,240,'fixed',50,false,true,7),
('combo-ponto','combo-ponto-75-150','75/80 cm — 150 g','full_head','package_application','included','75/80 cm',150,'exact','gram',150,'exact',510,240,'fixed',50,false,true,8),
('combo-ponto','combo-ponto-75-200','75/80 cm — 200 g','full_head','package_application','included','75/80 cm',200,'exact','gram',200,'exact',640,240,'fixed',50,false,true,9),
('combo-ponto','combo-ponto-75-250','75/80 cm — 250 g','full_head','package_application','included','75/80 cm',250,'exact','gram',250,'exact',775,240,'fixed',50,false,true,10),
('combo-ponto','combo-ponto-75-300','75/80 cm — 300 g','full_head','package_application','included','75/80 cm',300,'exact','gram',300,'exact',870,240,'fixed',50,false,true,11),
('combo-ponto','combo-ponto-75-350','75/80 cm — 350 g','full_head','package_application','included','75/80 cm',350,'exact','gram',350,'exact',1015,240,'fixed',50,false,true,12),
-- Combos Entrelace
('combo-entrelace','combo-entrelace-60-300','60/65/70 cm — 300 g','full_head','package_application','included','60/65/70 cm',300,'exact','gram',300,'exact',690,360,'fixed',50,false,true,1),
('combo-entrelace','combo-entrelace-60-350','60/65/70 cm — 350 g','full_head','package_application','included','60/65/70 cm',350,'exact','gram',350,'exact',755,360,'fixed',50,false,true,2),
('combo-entrelace','combo-entrelace-60-400','60/65/70 cm — 400 g','full_head','package_application','included','60/65/70 cm',400,'exact','gram',400,'exact',820,360,'fixed',50,false,true,3),
('combo-entrelace','combo-entrelace-60-450','60/65/70 cm — 450 g','full_head','package_application','included','60/65/70 cm',450,'exact','gram',450,'exact',885,360,'fixed',50,false,true,4),
('combo-entrelace','combo-entrelace-60-500','60/65/70 cm — 500 g','full_head','package_application','included','60/65/70 cm',500,'exact','gram',500,'exact',950,360,'fixed',50,false,true,5),
('combo-entrelace','combo-entrelace-60-550','60/65/70 cm — 550 g','full_head','package_application','included','60/65/70 cm',550,'exact','gram',550,'exact',1080,360,'fixed',50,false,true,6),
('combo-entrelace','combo-entrelace-75-300','75/80 cm — 300 g','full_head','package_application','included','75/80 cm',300,'exact','gram',300,'exact',900,360,'fixed',50,false,true,7),
('combo-entrelace','combo-entrelace-75-350','75/80 cm — 350 g','full_head','package_application','included','75/80 cm',350,'exact','gram',350,'exact',1000,360,'fixed',50,false,true,8),
('combo-entrelace','combo-entrelace-75-400','75/80 cm — 400 g','full_head','package_application','included','75/80 cm',400,'exact','gram',400,'exact',1100,360,'fixed',50,false,true,9),
('combo-entrelace','combo-entrelace-75-450','75/80 cm — 450 g','full_head','package_application','included','75/80 cm',450,'exact','gram',450,'exact',1200,360,'fixed',50,false,true,10),
('combo-entrelace','combo-entrelace-75-500','75/80 cm — 500 g','full_head','package_application','included','75/80 cm',500,'exact','gram',500,'exact',1300,360,'fixed',50,false,true,11),
('combo-entrelace','combo-entrelace-75-550','75/80 cm — 550 g','full_head','package_application','included','75/80 cm',550,'exact','gram',550,'exact',1400,360,'fixed',50,false,true,12),
-- Combos Microcápsula
('combo-micro','combo-micro-60-100','60/65/70 cm — 100 g','partial_or_highlights','package_application','included','60/65/70 cm',100,'exact','gram',100,'exact',690,600,'percentage',50,true,true,1),
('combo-micro','combo-micro-60-150','60/65/70 cm — 150 g','full_head','package_application','included','60/65/70 cm',150,'exact','gram',150,'exact',930,600,'percentage',50,true,true,2),
('combo-micro','combo-micro-60-200','60/65/70 cm — 200 g','full_head','package_application','included','60/65/70 cm',200,'exact','gram',200,'exact',1240,600,'percentage',50,true,true,3),
('combo-micro','combo-micro-60-250','60/65/70 cm — 250 g','full_head','package_application','included','60/65/70 cm',250,'exact','gram',250,'exact',1550,600,'percentage',50,true,true,4),
('combo-micro','combo-micro-60-300','60/65/70 cm — 300 g','full_head','package_application','included','60/65/70 cm',300,'exact','gram',300,'exact',1860,600,'percentage',50,true,true,5),
('combo-micro','combo-micro-60-350','60/65/70 cm — 350 g','full_head','package_application','included','60/65/70 cm',350,'exact','gram',350,'exact',2170,600,'percentage',50,true,true,6),
('combo-micro','combo-micro-75-100','75/80 cm — 100 g','partial_or_highlights','package_application','included','75/80 cm',100,'exact','gram',100,'exact',760,600,'percentage',50,true,true,7),
('combo-micro','combo-micro-75-150','75/80 cm — 150 g','full_head','package_application','included','75/80 cm',150,'exact','gram',150,'exact',1035,600,'percentage',50,true,true,8),
('combo-micro','combo-micro-75-200','75/80 cm — 200 g','full_head','package_application','included','75/80 cm',200,'exact','gram',200,'exact',1380,600,'percentage',50,true,true,9),
('combo-micro','combo-micro-75-250','75/80 cm — 250 g','full_head','package_application','included','75/80 cm',250,'exact','gram',250,'exact',1725,600,'percentage',50,true,true,10),
('combo-micro','combo-micro-75-300','75/80 cm — 300 g','full_head','package_application','included','75/80 cm',300,'exact','gram',300,'exact',2070,600,'percentage',50,true,true,11),
('combo-micro','combo-micro-75-350','75/80 cm — 350 g','full_head','package_application','included','75/80 cm',350,'exact','gram',350,'exact',2415,600,'percentage',50,true,true,12);

-- Mão de obra: preço zero de sinal; cabelo fornecido pela cliente.
insert into catalog_variants values
('labor-apply-fita','labor-apply-fita-partial-1','Preenchimento/luzes — 1 faixa','partial_or_highlights','application','client_supplied',null,null,null,'faixa',1,'exact',80,180,'none',0,false,false,1),
('labor-apply-fita','labor-apply-fita-partial-2','Preenchimento/luzes — 2 faixas','partial_or_highlights','application','client_supplied',null,null,null,'faixa',2,'exact',140,180,'none',0,false,false,2),
('labor-apply-fita','labor-apply-fita-full-7','Cabeça toda — até 7 faixas','full_head','application','client_supplied',null,null,null,'faixa',7,'up_to',290,180,'none',0,false,false,3),
('labor-apply-fita','labor-apply-fita-full-10','Cabeça toda — até 10 faixas','full_head','application','client_supplied',null,null,null,'faixa',10,'up_to',360,180,'none',0,false,false,4),
('labor-apply-ponto','labor-apply-ponto-partial-1','Preenchimento/luzes — 1 tela','partial_or_highlights','application','client_supplied',null,null,null,'tela',1,'exact',60,240,'none',0,false,false,1),
('labor-apply-ponto','labor-apply-ponto-partial-2','Preenchimento/luzes — 2 telas','partial_or_highlights','application','client_supplied',null,null,null,'tela',2,'exact',120,240,'none',0,false,false,2),
('labor-apply-ponto','labor-apply-ponto-full-7','Cabeça toda — até 7 telas','full_head','application','client_supplied',null,null,null,'tela',7,'up_to',260,240,'none',0,false,false,3),
('labor-apply-ponto','labor-apply-ponto-full-10','Cabeça toda — até 10 telas','full_head','application','client_supplied',null,null,null,'tela',10,'up_to',320,240,'none',0,false,false,4),
('labor-apply-entrelace','labor-apply-entrelace','Aplicação','general','application','client_supplied',null,null,null,'flat',null,null,360,360,'none',0,false,false,1),
('labor-apply-micro','labor-apply-micro-partial-100','Preenchimento/luzes — até 100 g','partial_or_highlights','application','client_supplied',null,100,'up_to','gram',100,'up_to',500,600,'none',0,false,false,1),
('labor-apply-micro','labor-apply-micro-full-150','Cabeça toda — até 150 g','full_head','application','client_supplied',null,150,'up_to','gram',150,'up_to',750,600,'none',0,false,false,2),
('labor-apply-micro','labor-apply-micro-full-200','Cabeça toda — até 200 g','full_head','application','client_supplied',null,200,'up_to','gram',200,'up_to',1000,600,'none',0,false,false,3),
('labor-apply-micro','labor-apply-micro-full-250','Cabeça toda — até 250 g','full_head','application','client_supplied',null,250,'up_to','gram',250,'up_to',1250,600,'none',0,false,false,4),
('labor-apply-micro','labor-apply-micro-full-300','Cabeça toda — até 300 g','full_head','application','client_supplied',null,300,'up_to','gram',300,'up_to',1500,600,'none',0,false,false,5),
('labor-apply-micro','labor-apply-micro-full-350','Cabeça toda — até 350 g','full_head','application','client_supplied',null,350,'up_to','gram',350,'up_to',1750,600,'none',0,false,false,6),
-- Manutenção Fita
('labor-maintain-fita','labor-maintain-fita-remove-1','Preenchimento/luzes — remover 1 faixa','partial_or_highlights','removal','client_supplied',null,null,null,'faixa',1,'exact',40,180,'none',0,false,false,1),
('labor-maintain-fita','labor-maintain-fita-remove-2','Preenchimento/luzes — remover 2 faixas','partial_or_highlights','removal','client_supplied',null,null,null,'faixa',2,'exact',50,180,'none',0,false,false,2),
('labor-maintain-fita','labor-maintain-fita-apply-1','Preenchimento/luzes — aplicar 1 faixa','partial_or_highlights','application','client_supplied',null,null,null,'faixa',1,'exact',90,180,'none',0,false,false,3),
('labor-maintain-fita','labor-maintain-fita-apply-2','Preenchimento/luzes — aplicar 2 faixas','partial_or_highlights','application','client_supplied',null,null,null,'faixa',2,'exact',160,180,'none',0,false,false,4),
('labor-maintain-fita','labor-maintain-fita-both-1','Preenchimento/luzes — remover e aplicar 1 faixa','partial_or_highlights','removal_and_application','client_supplied',null,null,null,'faixa',1,'exact',180,360,'none',0,false,false,5),
('labor-maintain-fita','labor-maintain-fita-both-2','Preenchimento/luzes — remover e aplicar 2 faixas','partial_or_highlights','removal_and_application','client_supplied',null,null,null,'faixa',2,'exact',230,360,'none',0,false,false,6),
('labor-maintain-fita','labor-maintain-fita-full-remove','Cabeça toda — apenas remoção','full_head','removal','client_supplied',null,null,null,'flat',null,null,90,180,'none',0,false,false,7),
('labor-maintain-fita','labor-maintain-fita-full-apply','Cabeça toda — apenas aplicação','full_head','application','client_supplied',null,null,null,'flat',null,null,290,180,'none',0,false,false,8),
('labor-maintain-fita','labor-maintain-fita-full-both','Cabeça toda — remoção e aplicação','full_head','removal_and_application','client_supplied',null,null,null,'flat',null,null,360,360,'none',0,false,false,9),
-- Manutenção Ponto (unidade validada: tela)
('labor-maintain-ponto','labor-maintain-ponto-remove-1','Preenchimento/luzes — remover 1 tela','partial_or_highlights','removal','client_supplied',null,null,null,'tela',1,'exact',35,240,'none',0,false,false,1),
('labor-maintain-ponto','labor-maintain-ponto-remove-2','Preenchimento/luzes — remover 2 telas','partial_or_highlights','removal','client_supplied',null,null,null,'tela',2,'exact',50,240,'none',0,false,false,2),
('labor-maintain-ponto','labor-maintain-ponto-apply-1','Preenchimento/luzes — aplicar 1 tela','partial_or_highlights','application','client_supplied',null,null,null,'tela',1,'exact',70,240,'none',0,false,false,3),
('labor-maintain-ponto','labor-maintain-ponto-apply-2','Preenchimento/luzes — aplicar 2 telas','partial_or_highlights','application','client_supplied',null,null,null,'tela',2,'exact',130,240,'none',0,false,false,4),
('labor-maintain-ponto','labor-maintain-ponto-both-1','Preenchimento/luzes — remover e aplicar 1 tela','partial_or_highlights','removal_and_application','client_supplied',null,null,null,'tela',1,'exact',150,480,'none',0,false,false,5),
('labor-maintain-ponto','labor-maintain-ponto-both-2','Preenchimento/luzes — remover e aplicar 2 telas','partial_or_highlights','removal_and_application','client_supplied',null,null,null,'tela',2,'exact',200,480,'none',0,false,false,6),
('labor-maintain-ponto','labor-maintain-ponto-full-remove','Cabeça toda — apenas remoção','full_head','removal','client_supplied',null,null,null,'flat',null,null,70,240,'none',0,false,false,7),
('labor-maintain-ponto','labor-maintain-ponto-full-apply','Cabeça toda — apenas aplicação','full_head','application','client_supplied',null,null,null,'flat',null,null,260,240,'none',0,false,false,8),
('labor-maintain-ponto','labor-maintain-ponto-full-both','Cabeça toda — remoção e aplicação','full_head','removal_and_application','client_supplied',null,null,null,'flat',null,null,330,480,'none',0,false,false,9),
('labor-maintain-entrelace','labor-maintain-entrelace','Manutenção','general','removal_and_application','client_supplied',null,null,null,'flat',null,null,430,720,'none',0,false,false,1),
-- Manutenção Microcápsula
('labor-maintain-micro','labor-maintain-micro-partial-remove','Preenchimento/luzes até 100 g — remoção','partial_or_highlights','removal','client_supplied',null,100,'up_to','gram',100,'up_to',90,600,'none',0,false,false,1),
('labor-maintain-micro','labor-maintain-micro-partial-apply','Preenchimento/luzes até 100 g — aplicação','partial_or_highlights','application','client_supplied',null,100,'up_to','gram',100,'up_to',500,600,'none',0,false,false,2),
('labor-maintain-micro','labor-maintain-micro-partial-both','Preenchimento/luzes até 100 g — remoção e aplicação','partial_or_highlights','removal_and_application','client_supplied',null,100,'up_to','gram',100,'up_to',590,720,'none',0,false,false,3);

insert into catalog_variants
select 'labor-maintain-micro',
  'labor-maintain-micro-full-'||op.code||'-'||w.grams,
  'Cabeça toda — '||op.label||' — até '||w.grams||' g',
  'full_head',op.operation,'client_supplied',null,w.grams,'up_to','gram',w.grams,'up_to',
  case op.code
    when 'remove' then case w.grams when 150 then 150 when 200 then 180 when 250 then 250 when 300 then 280 else 320 end
    when 'apply' then case w.grams when 150 then 750 when 200 then 1000 when 250 then 1250 when 300 then 1500 else 1750 end
    else case w.grams when 150 then 900 when 200 then 1180 when 250 then 1500 when 300 then 1780 else 2070 end
  end,
  case when op.code='both' then 720 else 600 end,'none',0,false,false,10 + op.order_no*10 + w.order_no
from (values (150,1),(200,2),(250,3),(300,4),(350,5)) w(grams,order_no)
cross join (values
  ('remove','apenas remoção','removal',1),
  ('apply','apenas aplicação','application',2),
  ('both','remoção e aplicação','removal_and_application',3)
) op(code,label,operation,order_no);

insert into public.service_variants(
 service_id,code,label,purpose,operation,material_mode,length_label,weight_grams,weight_mode,
 unit_type,unit_count,unit_mode,price,duration_minutes,deposit_type,deposit_value,
 deposit_non_refundable,requires_assessment,requires_human_confirmation,show_online_booking,
 allow_whatsapp_booking,active,sort_order,valid_from,notes,metadata
)
select s.id,v.code,v.label,v.purpose,v.operation,v.material_mode,v.length_label,v.weight_grams,v.weight_mode,
 v.unit_type,v.unit_count,v.unit_mode,v.price,v.duration,v.deposit_type,v.deposit_value,
 v.non_refundable,true,v.human_confirmation,true,true,true,v.sort_order,date '2026-01-01',
 case when v.material_mode='included' then 'Preço final da combinação escolhida. Material sujeito à confirmação humana após avaliação.' else 'Somente mão de obra; cabelo não incluso.' end,
 jsonb_build_object('catalog_year',2026,'source','tabelas_aprovadas_2026')
from catalog_variants v join public.services s on s.catalog_code=v.service_code
on conflict(code) do update set
 service_id=excluded.service_id,label=excluded.label,purpose=excluded.purpose,operation=excluded.operation,
 material_mode=excluded.material_mode,length_label=excluded.length_label,weight_grams=excluded.weight_grams,
 weight_mode=excluded.weight_mode,unit_type=excluded.unit_type,unit_count=excluded.unit_count,
 unit_mode=excluded.unit_mode,price=excluded.price,duration_minutes=excluded.duration_minutes,
 deposit_type=excluded.deposit_type,deposit_value=excluded.deposit_value,
 deposit_non_refundable=excluded.deposit_non_refundable,requires_assessment=true,
 requires_human_confirmation=excluded.requires_human_confirmation,active=true,sort_order=excluded.sort_order,
 valid_from=excluded.valid_from,notes=excluded.notes,metadata=excluded.metadata,updated_at=now();

insert into public.service_addons(code,name,description,price,duration_minutes,active,sort_order)
values ('wash-brush','Lavagem e escova','Adicional opcional disponível para todos os métodos.',50,60,true,10)
on conflict(code) do update set name=excluded.name,description=excluded.description,
 price=excluded.price,duration_minutes=excluded.duration_minutes,active=true,updated_at=now();

insert into public.service_variant_addons(service_variant_id,addon_id)
select v.id,a.id from public.service_variants v cross join public.service_addons a
where a.code='wash-brush' and v.operation<>'evaluation'
on conflict do nothing;

-- Preserve the current business rule: every active professional may receive the
-- newly imported catalog. The administrator can narrow this assignment later.
insert into public.professional_services(professional_id,service_id,custom_price,commission_rate)
select p.id,s.id,null,p.commission_rate
from public.professionals p cross join public.services s
where p.active and s.catalog_code is not null
on conflict(professional_id,service_id) do nothing;

commit;
