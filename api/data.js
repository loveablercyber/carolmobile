import { query, transaction } from '../server/lib/db.js'
import { requireUser } from '../server/lib/auth.js'
import { notifyAppointment } from '../server/lib/integrations.js'
import { appError, getBody, handleError, methodNotAllowed, send } from '../server/lib/http.js'

const appointmentSelect = `
  select a.id, a.starts_at, a.ends_at, a.status, a.notes, a.estimated_value,
    to_char(a.starts_at at time zone 'America/Sao_Paulo','DD/MM/YYYY') as date,
    to_char(a.starts_at at time zone 'America/Sao_Paulo','HH24:MI') as time,
    s.id as service_id, s.name as service, s.duration_minutes,
    p.id as professional_id, pp.full_name as professional,
    c.id as client_id, cp.full_name as client, cp.phone as client_phone,
    l.name as location
  from public.appointments a
  join public.services s on s.id = a.service_id
  join public.professionals p on p.id = a.professional_id
  join public.profiles pp on pp.id = p.profile_id
  join public.clients c on c.id = a.client_id
  join public.profiles cp on cp.id = c.profile_id
  left join public.salon_locations l on l.id = a.location_id
`

function formatAppointment(row) {
  return {
    ...row,
    value: Number(row.estimated_value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
    duration: row.duration_minutes >= 60 ? `${Math.floor(row.duration_minutes / 60)}h${row.duration_minutes % 60 ? String(row.duration_minutes % 60).padStart(2, '0') : ''}` : `${row.duration_minutes}min`
  }
}

async function appointmentScope(user, alias = 'a') {
  if (user.role === 'client') return { sql: `${alias}.client_id in (select id from public.clients where profile_id = $1)`, params: [user.id] }
  if (user.role === 'professional') return { sql: `${alias}.professional_id in (select id from public.professionals where profile_id = $1)`, params: [user.id] }
  return { sql: 'true', params: [] }
}

async function getResource(req, res, user, resource) {
  if (resource === 'bootstrap') {
    const [services, professionals, locations, points] = await Promise.all([
      query(`select id, name, description, duration_minutes, base_price, deposit_amount from public.services where active order by base_price`),
      query(`select p.id, pp.full_name as name, p.specialties, coalesce(round(avg(r.rating)::numeric,1),5) as rating from public.professionals p join public.profiles pp on pp.id=p.profile_id left join public.reviews r on r.professional_id=p.id where p.active group by p.id,pp.full_name order by pp.full_name`),
      query(`select id,name,address from public.salon_locations where active order by name`),
      user.role === 'client' ? query(`select coalesce(sum(lp.points),0)::int as points from public.loyalty_points lp join public.clients c on c.id=lp.client_id where c.profile_id=$1`, [user.id]) : Promise.resolve({ rows: [{ points: 0 }] })
    ])
    return send(res, 200, { services: services.rows, professionals: professionals.rows, locations: locations.rows, points: points.rows[0].points })
  }

  if (resource === 'appointments') {
    const scope = await appointmentScope(user)
    const { rows } = await query(`${appointmentSelect} where ${scope.sql} order by a.starts_at desc limit 100`, scope.params)
    return send(res, 200, { appointments: rows.map(formatAppointment) })
  }

  if (resource === 'availability') {
    const date = String(req.query?.date || '')
    const serviceName = String(req.query?.serviceName || '')
    const requestedProfessional = String(req.query?.professionalName || '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw appError('Data inválida.')
    const { rows: services } = await query('select duration_minutes from public.services where lower(name)=lower($1) and active limit 1', [serviceName])
    if (!services[0]) throw appError('Serviço não encontrado.')
    const professionalSql = requestedProfessional === 'Primeira disponível'
      ? `select p.id,pp.full_name from public.professionals p join public.profiles pp on pp.id=p.profile_id where p.active order by pp.full_name limit 1`
      : `select p.id,pp.full_name from public.professionals p join public.profiles pp on pp.id=p.profile_id where p.active and lower(pp.full_name)=lower($1) limit 1`
    const { rows: professionals } = await query(professionalSql, requestedProfessional === 'Primeira disponível' ? [] : [requestedProfessional])
    if (!professionals[0]) throw appError('Profissional não encontrada.')
    const slots = ['09:00','10:30','14:00','16:00']
    const result = []
    for (const time of slots) {
      const startsAt = new Date(`${date}T${time}:00-03:00`)
      const endsAt = new Date(startsAt.getTime() + services[0].duration_minutes * 60_000)
      const { rowCount } = await query(`select 1 from public.appointments where professional_id=$1 and status not in ('cancelled','no_show') and tstzrange(starts_at,ends_at,'[)') && tstzrange($2,$3,'[)') limit 1`, [professionals[0].id, startsAt.toISOString(), endsAt.toISOString()])
      result.push({ time, available: rowCount === 0 })
    }
    return send(res, 200, { professional: professionals[0], slots: result })
  }

  if (resource === 'clients') {
    await requireUser(req, ['professional', 'admin'])
    const { rows } = await query(`
      select c.id, p.full_name as name, p.phone, p.avatar_url as photo, c.lifetime_value,
        coalesce((select to_char(max(a.starts_at),'DD/MM/YYYY') from public.appointments a where a.client_id=c.id and a.status='completed'),'—') as last,
        coalesce((select to_char(min(a.starts_at),'DD/MM/YYYY') from public.appointments a where a.client_id=c.id and a.starts_at>now() and a.status in ('confirmed','pending_deposit')),'—') as next,
        coalesce((select sum(points) from public.loyalty_points lp where lp.client_id=c.id),0)::int as points
      from public.clients c join public.profiles p on p.id=c.profile_id order by p.full_name
    `)
    return send(res, 200, { clients: rows.map(row => ({ ...row, ticket: Number(row.lifetime_value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }), tag: Number(row.lifetime_value) > 10000 ? 'VIP' : 'Recorrente' })) })
  }

  if (resource === 'inventory') {
    await requireUser(req, ['professional', 'admin'])
    const { rows } = await query(`select id, code, supplier, category as item, concat_ws(' • ',color,shade,length_cm||' cm',texture) as detail, lot, quantity as qty, minimum_stock as min, unit_cost, suggested_price, case when quantity<=minimum_stock then 'Estoque baixo' else 'Em estoque' end as status from public.hair_inventory order by category,color`)
    return send(res, 200, { inventory: rows.map(row => ({ ...row, cost: Number(row.unit_cost || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }), margin: row.suggested_price ? `${Math.round((1 - Number(row.unit_cost) / Number(row.suggested_price)) * 100)}%` : '—' })) })
  }

  if (resource === 'dashboard') {
    await requireUser(req, ['professional', 'admin'])
    const { rows } = await query(`select
      coalesce(sum(case when pay.status='paid' and date_trunc('month',pay.paid_at)=date_trunc('month',now()) then pay.amount end),0) as monthly_revenue,
      (select count(*) from public.appointments where starts_at::date=current_date) as today_appointments,
      (select count(*) from public.clients) as clients,
      (select count(*) from public.appointments where starts_at>now() and status in ('confirmed','pending_deposit')) as future_appointments
      from public.payments pay`)
    return send(res, 200, { dashboard: rows[0] })
  }

  if (resource === 'notifications') {
    const { rows } = await query(`select id,kind,title,body,read_at,created_at from public.notifications where profile_id=$1 order by created_at desc limit 50`, [user.id])
    return send(res, 200, { notifications: rows })
  }
  throw appError('Recurso não encontrado.', 404)
}

async function createAppointment(req, res, user, body) {
  if (!['client', 'admin'].includes(user.role)) throw appError('Somente clientes e administradores podem criar agendamentos.', 403)
  const startsAt = new Date(body.startsAt)
  if (Number.isNaN(startsAt.getTime())) throw appError('Data e horário inválidos.')
  const appointment = await transaction(async client => {
    let clientId = body.clientId
    if (user.role === 'client') {
      const { rows } = await client.query('select id from public.clients where profile_id=$1', [user.id])
      clientId = rows[0]?.id
    }
    if (!clientId) throw appError('Cliente não encontrado.')
    let service
    if (body.serviceId) ({ rows: [service] } = await client.query('select * from public.services where id=$1 and active', [body.serviceId]))
    else ({ rows: [service] } = await client.query('select * from public.services where lower(name)=lower($1) and active limit 1', [body.serviceName]))
    if (!service) throw appError('Serviço não encontrado.')
    let professional
    if (body.professionalId) ({ rows: [professional] } = await client.query(`select p.id,pp.full_name from public.professionals p join public.profiles pp on pp.id=p.profile_id where p.id=$1 and p.active`, [body.professionalId]))
    else if (body.professionalName === 'Primeira disponível') ({ rows: [professional] } = await client.query(`select p.id,pp.full_name from public.professionals p join public.profiles pp on pp.id=p.profile_id where p.active order by pp.full_name limit 1`))
    else ({ rows: [professional] } = await client.query(`select p.id,pp.full_name from public.professionals p join public.profiles pp on pp.id=p.profile_id where lower(pp.full_name)=lower($1) and p.active limit 1`, [body.professionalName]))
    if (!professional) throw appError('Profissional não encontrada.')
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [professional.id])
    const endsAt = new Date(startsAt.getTime() + service.duration_minutes * 60_000)
    const conflict = await client.query(`select 1 from public.appointments where professional_id=$1 and status not in ('cancelled','no_show') and tstzrange(starts_at,ends_at,'[)') && tstzrange($2,$3,'[)') limit 1`, [professional.id, startsAt.toISOString(), endsAt.toISOString()])
    if (conflict.rowCount) throw appError('Este horário acabou de ficar indisponível. Escolha outro.', 409)
    const location = await client.query('select id from public.salon_locations where active order by name limit 1')
    const { rows } = await client.query(`insert into public.appointments(client_id,professional_id,service_id,location_id,starts_at,ends_at,status,notes,estimated_value,created_by) values($1,$2,$3,$4,$5,$6,'pending_deposit',$7,$8,$9) returning id`, [clientId, professional.id, service.id, location.rows[0]?.id || null, startsAt.toISOString(), endsAt.toISOString(), body.notes || null, service.base_price, user.id])
    await client.query(`insert into public.payments(appointment_id,client_id,amount,method,status) values($1,$2,$3,$4,'pending')`, [rows[0].id, clientId, service.deposit_amount || 0, body.paymentMethod || 'pix'])
    await client.query(`insert into public.appointment_status_history(appointment_id,to_status,changed_by,note) values($1,'pending_deposit',$2,'Agendamento criado pelo aplicativo')`, [rows[0].id, user.id])
    await client.query(`insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_data) values($1,'create','appointment',$2,$3)`, [user.id, rows[0].id, JSON.stringify({ startsAt, service: service.name, professional: professional.full_name })])
    const details = await client.query(`${appointmentSelect} where a.id=$1`, [rows[0].id])
    return details.rows[0]
  })
  const contact = await query(`select u.email,p.phone,p.full_name from public.clients c join public.profiles p on p.id=c.profile_id join auth.users u on u.id=p.id where c.id=$1`, [appointment.client_id])
  await notifyAppointment({ email: contact.rows[0]?.email, phone: contact.rows[0]?.phone, clientName: contact.rows[0]?.full_name, service: appointment.service, date: appointment.starts_at, professional: appointment.professional })
  return send(res, 201, { appointment: formatAppointment(appointment) })
}

async function updateAppointment(req, res, user, body) {
  if (!body.id) throw appError('Agendamento não informado.')
  const scope = await appointmentScope(user)
  const allowed = ['confirmed','in_service','completed','cancelled','no_show','rescheduled']
  if (!allowed.includes(body.status)) throw appError('Status inválido.')
  const params = [body.status, body.id, ...scope.params]
  const { rows } = await query(`update public.appointments a set status=$1 where a.id=$2 and ${scope.sql} returning id`, params)
  if (!rows[0]) throw appError('Agendamento não encontrado.', 404)
  await query(`insert into public.appointment_status_history(appointment_id,to_status,changed_by,note) values($1,$2,$3,$4)`, [body.id, body.status, user.id, body.note || 'Atualizado pelo aplicativo'])
  return send(res, 200, { ok: true })
}

async function createPhoto(req, res, user, body) {
  if (user.role !== 'client') throw appError('Apenas a cliente pode adicionar fotos por este fluxo.', 403)
  if (!body.url) throw appError('Imagem não informada.')
  const { rows: clients } = await query('select id from public.clients where profile_id=$1', [user.id])
  const { rows } = await query(`insert into public.client_photos(client_id,kind,storage_path) values($1,$2,$3) returning id,kind,storage_path`, [clients[0]?.id, body.kind || 'evaluation', body.url])
  return send(res, 201, { photo: rows[0] })
}

async function createInventory(req, res, user, body) {
  await requireUser(req, ['admin'])
  const { rows } = await query(`insert into public.hair_inventory(code,supplier,category,color,shade,length_cm,texture,weight_grams,lot,unit_cost,suggested_price,quantity,minimum_stock) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`, [body.code, body.supplier, body.category, body.color || null, body.shade || null, body.lengthCm || null, body.texture || null, body.weightGrams || null, body.lot || null, body.unitCost || 0, body.suggestedPrice || 0, body.quantity || 0, body.minimumStock || 0])
  return send(res, 201, { item: rows[0] })
}

async function createTechnicalRecord(req, res, user, body) {
  await requireUser(req, ['professional', 'admin'])
  const professional = user.role === 'professional' ? await query('select id from public.professionals where profile_id=$1', [user.id]) : { rows: [{ id: body.professionalId }] }
  const { rows } = await query(`insert into public.technical_records(appointment_id,client_id,professional_id,hair_method_id,strands_count,weight_grams,color,shade,length_cm,texture,hair_lot,products_used,recommendations,internal_notes,next_maintenance_date,final_value,payment_status) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) on conflict(appointment_id) do update set strands_count=excluded.strands_count,weight_grams=excluded.weight_grams,color=excluded.color,shade=excluded.shade,length_cm=excluded.length_cm,texture=excluded.texture,hair_lot=excluded.hair_lot,products_used=excluded.products_used,recommendations=excluded.recommendations,internal_notes=excluded.internal_notes,next_maintenance_date=excluded.next_maintenance_date,final_value=excluded.final_value,payment_status=excluded.payment_status returning *`, [body.appointmentId, body.clientId, professional.rows[0]?.id, body.hairMethodId || null, body.strandsCount || null, body.weightGrams || null, body.color || null, body.shade || null, body.lengthCm || null, body.texture || null, body.hairLot || null, JSON.stringify(body.productsUsed || []), body.recommendations || null, body.internalNotes || null, body.nextMaintenanceDate || null, body.finalValue || null, body.paymentStatus || 'pending'])
  return send(res, 201, { record: rows[0] })
}

export default async function handler(req, res) {
  try {
    const user = await requireUser(req)
    const resource = req.query?.resource || 'bootstrap'
    if (req.method === 'GET') return getResource(req, res, user, resource)
    const body = getBody(req)
    if (req.method === 'POST' && resource === 'appointments') return createAppointment(req, res, user, body)
    if (req.method === 'POST' && resource === 'photos') return createPhoto(req, res, user, body)
    if (req.method === 'POST' && resource === 'inventory') return createInventory(req, res, user, body)
    if (req.method === 'POST' && resource === 'technical-records') return createTechnicalRecord(req, res, user, body)
    if (req.method === 'PATCH' && resource === 'appointments') return updateAppointment(req, res, user, body)
    return methodNotAllowed(res, ['GET', 'POST', 'PATCH'])
  } catch (error) {
    return handleError(res, error)
  }
}
