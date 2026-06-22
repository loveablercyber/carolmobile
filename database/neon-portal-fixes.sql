-- Ajustes idempotentes posteriores à ativação dos portais.
update public.payments
set paid_amount = amount,
    updated_at = coalesce(updated_at, now())
where status = 'paid' and coalesce(paid_amount, 0) = 0;

insert into public.professional_availability(professional_id,weekday,starts_at,ends_at)
select pr.id,d.weekday,'09:00'::time,'18:00'::time
from public.professionals pr
cross join (values (1),(2),(3),(4),(5),(6)) d(weekday)
where pr.active
on conflict(professional_id,weekday,starts_at,ends_at) do nothing;

create index if not exists technical_records_professional_created_idx
  on public.technical_records(professional_id,created_at desc);

create index if not exists appointment_history_appointment_created_idx
  on public.appointment_status_history(appointment_id,created_at desc);
