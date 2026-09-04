-- 018_salon_services_2026.sql
-- Serviços de alinhamento, coloração e corte disponíveis no site e no WhatsApp.

begin;

insert into public.service_categories(name, sort_order)
select v.name, v.sort_order
from (values
  ('Tratamentos e Alinhamento', 60),
  ('Coloração e Corte', 70)
) v(name, sort_order)
where not exists (
  select 1 from public.service_categories category where lower(category.name) = lower(v.name)
);

with catalog(
  code, name, description, duration_minutes, base_price, category
) as (values
  ('treatment-acidification', 'Acidificação Capilar', 'Tratamento para ajudar a selar cutículas, preservar nutrientes, reduzir porosidade e frizz.', 120, 150, 'Tratamentos e Alinhamento'),
  ('treatment-hair-shielding', 'Blindagem Capilar', 'Tratamento de hidratação e nutrição com selagem das cutículas, pensado para proteção contra agressões externas.', 120, 160, 'Tratamentos e Alinhamento'),
  ('treatment-organic-botox', 'Botox Capilar Organic', 'Tratamento de reconstrução e nutrição profunda para brilho, maciez e massa capilar. Não contém toxina botulínica.', 120, 150, 'Tratamentos e Alinhamento'),
  ('treatment-selante-blond', 'Selante Capilar Sylante Blond', 'Procedimento de alinhamento com química alisante. A aplicação é indicada após confirmação da profissional.', 180, 190, 'Tratamentos e Alinhamento'),
  ('treatment-espelhamento-3d', 'Espelhamento 3D BTX', 'Tratamento de hidratação e reconstrução intensa, com possibilidade de leve redução de volume conforme o produto utilizado.', 120, 160, 'Tratamentos e Alinhamento'),
  ('coloring', 'Coloração', 'Serviço de coloração. O valor depende de a tinta ser da cliente ou da quantidade de tubos utilizada pelo salão.', 150, 130, 'Coloração e Corte'),
  ('haircut-complete', 'Corte de Cabelo', 'Corte personalizado que inclui lavagem e finalização.', 90, 180, 'Coloração e Corte')
)
insert into public.services(
  catalog_code, name, description, duration_minutes, base_price, deposit_amount,
  category_id, active, show_online_booking, is_free, offer_inventory_items
)
select catalog.code, catalog.name, catalog.description, catalog.duration_minutes, catalog.base_price, 0,
       category.id, true, true, false, false
from catalog
join public.service_categories category on lower(category.name) = lower(catalog.category)
on conflict(catalog_code) do update set
  name = excluded.name,
  description = excluded.description,
  duration_minutes = excluded.duration_minutes,
  base_price = excluded.base_price,
  category_id = excluded.category_id,
  active = true,
  show_online_booking = true,
  is_free = false,
  offer_inventory_items = false;

create temporary table salon_service_variants (
  service_code text,
  code text,
  label text,
  price numeric(12,2),
  duration_minutes int,
  sort_order int,
  notes text,
  requires_human_confirmation boolean default false
) on commit drop;

insert into salon_service_variants(
  service_code, code, label, price, duration_minutes, sort_order, notes, requires_human_confirmation
) values
  ('treatment-acidification', 'acidification-short-medium', 'Curto a médio', 150, 120, 1, 'Ajuda a selar cutículas, preservar nutrientes, reduzir porosidade e frizz.', false),
  ('treatment-acidification', 'acidification-medium-long', 'Médio a longo', 180, 120, 2, 'Ajuda a selar cutículas, preservar nutrientes, reduzir porosidade e frizz.', false),
  ('treatment-acidification', 'acidification-long', 'Longos — a partir de', 250, 150, 3, 'O valor pode aumentar conforme volume e comprimento.', false),
  ('treatment-hair-shielding', 'hair-shielding-short-medium', 'Curto a médio', 160, 120, 1, 'Hidratação e nutrição com proteção contra agressões externas. Não é alisamento.', false),
  ('treatment-hair-shielding', 'hair-shielding-medium-long', 'Médio a longo', 190, 120, 2, 'Hidratação e nutrição com proteção contra agressões externas. Não é alisamento.', false),
  ('treatment-hair-shielding', 'hair-shielding-long', 'Longos — a partir de', 260, 150, 3, 'O valor pode aumentar conforme volume e comprimento. Não é alisamento.', false),
  ('treatment-organic-botox', 'organic-botox-short-medium', 'Curto a médio', 150, 120, 1, 'Reconstrução e nutrição profunda. Não contém toxina botulínica e não alisa.', false),
  ('treatment-organic-botox', 'organic-botox-medium-long', 'Médio a longo', 180, 120, 2, 'Reconstrução e nutrição profunda. Não contém toxina botulínica e não alisa.', false),
  ('treatment-organic-botox', 'organic-botox-long', 'Longos — a partir de', 250, 150, 3, 'O valor pode aumentar conforme volume e comprimento. Não contém toxina botulínica e não alisa.', false),
  ('treatment-selante-blond', 'selante-blond-short-medium', 'Curto a médio', 190, 180, 1, 'Procedimento de alinhamento com química alisante. A profissional confirmará a indicação antes da execução.', true),
  ('treatment-selante-blond', 'selante-blond-medium-long', 'Médio a longo', 230, 180, 2, 'Procedimento de alinhamento com química alisante. A profissional confirmará a indicação antes da execução.', true),
  ('treatment-selante-blond', 'selante-blond-long', 'Longos — a partir de', 270, 210, 3, 'O valor pode aumentar conforme volume e comprimento. A profissional confirmará a indicação antes da execução.', true),
  ('treatment-espelhamento-3d', 'espelhamento-3d-short-medium', 'Curto a médio', 160, 120, 1, 'Hidratação e reconstrução intensa; o resultado pode variar conforme o produto e o cabelo.', false),
  ('treatment-espelhamento-3d', 'espelhamento-3d-medium-long', 'Médio a longo', 200, 120, 2, 'Hidratação e reconstrução intensa; o resultado pode variar conforme o produto e o cabelo.', false),
  ('treatment-espelhamento-3d', 'espelhamento-3d-long', 'Longos — a partir de', 240, 150, 3, 'O valor pode aumentar conforme volume e comprimento.', false),
  ('coloring', 'coloring-client-dye', 'Com tinta da cliente', 130, 120, 1, 'A cliente deve levar a própria tinta.', false),
  ('coloring', 'coloring-salon-1-tube', 'Com tinta do salão — 1 tubo', 190, 150, 2, 'Aplicação inclusa. A quantidade de tubos é confirmada pela profissional.', false),
  ('coloring', 'coloring-salon-2-tubes', 'Com tinta do salão — 2 tubos', 250, 180, 3, 'Aplicação inclusa. A quantidade de tubos é confirmada pela profissional.', false),
  ('coloring', 'coloring-salon-3-tubes', 'Com tinta do salão — 3 tubos', 310, 210, 4, 'Aplicação inclusa. A quantidade de tubos é confirmada pela profissional.', false),
  ('coloring', 'coloring-salon-4-tubes', 'Com tinta do salão — 4 tubos', 370, 240, 5, 'Aplicação inclusa. A quantidade de tubos é confirmada pela profissional.', false),
  ('haircut-complete', 'haircut-complete', 'Lavagem, corte e finalização', 180, 90, 1, 'Inclui lavagem e finalização.', false);

insert into public.service_variants(
  service_id, code, label, purpose, operation, material_mode, unit_type, price,
  duration_minutes, deposit_type, deposit_value, deposit_non_refundable,
  requires_assessment, requires_human_confirmation, show_online_booking,
  allow_whatsapp_booking, active, sort_order, valid_from, notes, metadata
)
select service.id, variant.code, variant.label, 'general', 'application', 'not_applicable', 'flat',
       variant.price, variant.duration_minutes, 'percentage', 30, true,
       false, variant.requires_human_confirmation, true, true, true, variant.sort_order,
       date '2026-09-04', variant.notes,
       jsonb_build_object('catalog_year', 2026, 'source', 'tabela_alinhamento_coloracao_2025', 'deposit_policy', '30_percent_non_refundable')
from salon_service_variants variant
join public.services service on service.catalog_code = variant.service_code
on conflict(code) do update set
  service_id = excluded.service_id,
  label = excluded.label,
  purpose = excluded.purpose,
  operation = excluded.operation,
  material_mode = excluded.material_mode,
  unit_type = excluded.unit_type,
  price = excluded.price,
  duration_minutes = excluded.duration_minutes,
  deposit_type = excluded.deposit_type,
  deposit_value = excluded.deposit_value,
  deposit_non_refundable = excluded.deposit_non_refundable,
  requires_assessment = excluded.requires_assessment,
  requires_human_confirmation = excluded.requires_human_confirmation,
  show_online_booking = true,
  allow_whatsapp_booking = true,
  active = true,
  sort_order = excluded.sort_order,
  valid_from = excluded.valid_from,
  notes = excluded.notes,
  metadata = excluded.metadata,
  updated_at = now();

insert into public.professional_services(professional_id, service_id, custom_price, commission_rate)
select professional.id, service.id, null, professional.commission_rate
from public.professionals professional
cross join public.services service
where professional.active and service.catalog_code in (
  'treatment-acidification', 'treatment-hair-shielding', 'treatment-organic-botox',
  'treatment-selante-blond', 'treatment-espelhamento-3d', 'coloring', 'haircut-complete'
)
on conflict(professional_id, service_id) do nothing;

commit;
