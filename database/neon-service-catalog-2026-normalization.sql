insert into public.service_categories(name,sort_order)
select 'Histórico importado',999
where not exists (
  select 1 from public.service_categories where lower(name)=lower('Histórico importado')
);

create table if not exists public.service_catalog_normalization_backups (
  version text primary key,
  created_at timestamptz not null default now(),
  services jsonb not null,
  variants jsonb not null
);

insert into public.service_catalog_normalization_backups(version,services,variants)
select
  '013_service_catalog_2026_normalization',
  coalesce((
    select jsonb_agg(to_jsonb(s) order by s.name,s.id)
    from public.services s
  ),'[]'::jsonb),
  coalesce((
    select jsonb_agg(to_jsonb(v) order by v.code,v.id)
    from public.service_variants v
  ),'[]'::jsonb)
on conflict(version) do nothing;

-- O catálogo oficial 2026 é identificado por catalog_code, não pelo nome
-- visível. Assim nomes semelhantes do legado não interferem nos novos itens.
update public.services
set active=true,
    show_online_booking=true
where catalog_code is not null;

-- Registros anteriores permanecem para preservar agendamentos migrados, mas
-- deixam de ser oferecidos em novos atendimentos.
update public.services
set category_id=(
      select id from public.service_categories
      where lower(name)=lower('Histórico importado')
      order by id limit 1
    ),
    active=false,
    show_online_booking=false
where catalog_code is null;

with expected_prefix(prefix,catalog_code) as (values
  ('assessment-extensions','assessment-extensions'),
  ('combo-fita-','combo-fita'),
  ('combo-ponto-','combo-ponto'),
  ('combo-entrelace-','combo-entrelace'),
  ('combo-micro-','combo-micro'),
  ('labor-apply-fita-','labor-apply-fita'),
  ('labor-apply-ponto-','labor-apply-ponto'),
  ('labor-apply-entrelace','labor-apply-entrelace'),
  ('labor-apply-micro-','labor-apply-micro'),
  ('labor-maintain-fita-','labor-maintain-fita'),
  ('labor-maintain-ponto-','labor-maintain-ponto'),
  ('labor-maintain-entrelace','labor-maintain-entrelace'),
  ('labor-maintain-micro-','labor-maintain-micro')
), expected as (
  select distinct on(v.id) v.id,s.id as service_id
  from public.service_variants v
  join expected_prefix p on v.code=p.prefix or v.code like p.prefix||'%'
  join public.services s on s.catalog_code=p.catalog_code
  where v.metadata->>'catalog_year'='2026'
  order by v.id,length(p.prefix) desc
)
update public.service_variants v
set service_id=e.service_id,
    active=true,
    show_online_booking=true,
    allow_whatsapp_booking=true,
    updated_at=now()
from expected e
where v.id=e.id;

insert into public.professional_services(professional_id,service_id,custom_price,commission_rate)
select p.id,s.id,null,p.commission_rate
from public.professionals p
cross join public.services s
where p.active and s.active and s.catalog_code is not null
on conflict(professional_id,service_id) do nothing;

