-- 019_assessment_duration_15_minutes.sql
-- A avaliação é um pré-atendimento breve; web e WhatsApp reservam 15 minutos.

begin;

update public.services
   set duration_minutes = 15,
       updated_at = now()
 where catalog_code = 'assessment-extensions';

update public.service_variants variant
   set duration_minutes = 15,
       updated_at = now()
  from public.services service
 where variant.service_id = service.id
   and service.catalog_code = 'assessment-extensions';

commit;
