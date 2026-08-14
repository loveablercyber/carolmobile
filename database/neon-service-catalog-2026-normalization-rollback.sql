-- Executar somente em caso de rollback aprovado da versão 013.
-- Os agendamentos e clientes nunca são alterados por este procedimento.
begin;

with backup as (
  select services
  from public.service_catalog_normalization_backups
  where version='013_service_catalog_2026_normalization'
), previous as (
  select item
  from backup, jsonb_array_elements(services) item
)
update public.services s
set category_id=nullif(previous.item->>'category_id','')::uuid,
    active=coalesce((previous.item->>'active')::boolean,false),
    show_online_booking=coalesce((previous.item->>'show_online_booking')::boolean,true)
from previous
where s.id=(previous.item->>'id')::uuid;

with backup as (
  select variants
  from public.service_catalog_normalization_backups
  where version='013_service_catalog_2026_normalization'
), previous as (
  select item
  from backup, jsonb_array_elements(variants) item
)
update public.service_variants v
set service_id=(previous.item->>'service_id')::uuid,
    active=coalesce((previous.item->>'active')::boolean,false),
    show_online_booking=coalesce((previous.item->>'show_online_booking')::boolean,true),
    allow_whatsapp_booking=coalesce((previous.item->>'allow_whatsapp_booking')::boolean,true),
    updated_at=now()
from previous
where v.id=(previous.item->>'id')::uuid;

delete from public._luxe_migrations
where version='013_service_catalog_2026_normalization';

commit;

