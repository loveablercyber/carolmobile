import { query, transaction } from '../server/lib/db.js'
import { requireUser } from '../server/lib/auth.js'
import { sendEmail } from '../server/lib/integrations.js'
import { appError, getBody, handleError, methodNotAllowed, send } from '../server/lib/http.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const clean = value => String(value ?? '').trim()
const validUuid = (value, label = 'ID') => {
  const id = clean(value)
  if (!uuidPattern.test(id)) throw appError(`${label} inválido.`)
  return id
}
const money = value => Number(value || 0)

async function clientIdFor(user) {
  const { rows } = await query('select id from public.clients where profile_id=$1', [user.id])
  if (!rows[0]) throw appError('Perfil de cliente não encontrado.', 404)
  return rows[0].id
}

async function professionalIdFor(user) {
  const { rows } = await query('select id from public.professionals where profile_id=$1', [user.id])
  if (!rows[0]) throw appError('Perfil profissional não encontrado.', 404)
  return rows[0].id
}

function requireRole(user, roles) {
  if (!roles.includes(user.role)) throw appError('Você não tem permissão para esta ação.', 403)
}

async function profileResource(user) {
  const { rows } = await query(`select p.id,p.role,p.full_name,p.phone,p.avatar_url,p.birth_date,p.instagram,p.address,p.account_status,
    p.notification_preferences,p.created_at,u.email,c.id as client_id,c.cpf,c.preferences,c.personal_notes,
    pr.id as professional_id,pr.bio,pr.specialties,pr.commission_rate,pr.active
    from public.profiles p join auth.users u on u.id=p.id
    left join public.clients c on c.profile_id=p.id left join public.professionals pr on pr.profile_id=p.id
    where p.id=$1`, [user.id])
  return rows[0]
}

async function clientOverview(user) {
  requireRole(user, ['client'])
  const clientId = await clientIdFor(user)
  const [profile, appointment, points, subscription, coupons, pending] = await Promise.all([
    profileResource(user),
    query(`select a.id,a.starts_at,a.status,s.name as service,pp.full_name as professional,l.name as location
      from public.appointments a join public.services s on s.id=a.service_id join public.professionals pr on pr.id=a.professional_id
      join public.profiles pp on pp.id=pr.profile_id left join public.salon_locations l on l.id=a.location_id
      where a.client_id=$1 and a.starts_at>=now() and a.status in ('pending_deposit','confirmed','rescheduled') order by a.starts_at limit 1`, [clientId]),
    query('select coalesce(sum(points),0)::int as points from public.loyalty_points where client_id=$1', [clientId]),
    query(`select sub.id,sub.status,sub.starts_at,sub.renews_at,sub.expires_at,sub.remaining_maintenances,p.id as plan_id,p.name,p.price,p.benefits
      from public.subscriptions sub join public.plans p on p.id=sub.plan_id where sub.client_id=$1 order by sub.created_at desc limit 1`, [clientId]),
    query(`select c.id,c.code,c.description,c.discount_type,c.discount_value,c.ends_at
      from public.coupons c where c.active and (c.starts_at is null or c.starts_at<=now()) and (c.ends_at is null or c.ends_at>=now())
      and not exists(select 1 from public.coupon_usage u where u.coupon_id=c.id and u.client_id=$1) order by c.ends_at nulls last`, [clientId]),
    query(`select count(*)::int as count,coalesce(sum(amount-paid_amount),0) as amount from public.payments where client_id=$1 and status in ('pending','under_review','partial')`, [clientId])
  ])
  return { profile, nextAppointment: appointment.rows[0] || null, points: points.rows[0].points, subscription: subscription.rows[0] || null, coupons: coupons.rows, pendingPayments: pending.rows[0] }
}

async function paymentsResource(user, id) {
  let where = 'true'; const params = []
  if (user.role === 'client') { params.push(await clientIdFor(user)); where = `pay.client_id=$${params.length}` }
  else if (user.role === 'professional') { params.push(await professionalIdFor(user)); where = `a.professional_id=$${params.length}` }
  if (id) { params.push(validUuid(id, 'Pagamento')); where += ` and pay.id=$${params.length}` }
  const { rows } = await query(`select pay.id,pay.amount,pay.discount_amount,pay.paid_amount,pay.method,pay.status,pay.provider_reference,
    pay.receipt_url,pay.notes,pay.paid_at,pay.created_at,pay.updated_at,a.id as appointment_id,a.starts_at,s.name as service,
    sub.id as subscription_id,pl.name as plan,cp.full_name as client
    from public.payments pay join public.clients c on c.id=pay.client_id join public.profiles cp on cp.id=c.profile_id
    left join public.appointments a on a.id=pay.appointment_id left join public.services s on s.id=a.service_id
    left join public.subscriptions sub on sub.id=pay.subscription_id left join public.plans pl on pl.id=sub.plan_id
    where ${where} order by pay.created_at desc`, params)
  if (id && !rows[0]) throw appError('Pagamento não encontrado.', 404)
  return id ? rows[0] : rows
}

async function plansResource(user, id) {
  const params = []; let where = user.role === 'admin' ? 'true' : 'p.active=true'
  if (id) { params.push(validUuid(id, 'Plano')); where += ` and p.id=$1` }
  const { rows } = await query(`select p.id,p.name,p.price,p.billing_cycle,p.benefits,p.active,
    (select count(*)::int from public.subscriptions s where s.plan_id=p.id and s.status='active') as active_subscribers
    from public.plans p where ${where} order by p.price`, params)
  if (id && !rows[0]) throw appError('Plano não encontrado.', 404)
  if (id && user.role === 'client') {
    const clientId = await clientIdFor(user)
    const history = await query(`select s.id,s.status,s.starts_at,s.renews_at,s.expires_at,s.payment_method,pay.id as payment_id,pay.status as payment_status,pay.amount,pay.paid_at
      from public.subscriptions s left join public.payments pay on pay.subscription_id=s.id where s.client_id=$1 and s.plan_id=$2 order by s.created_at desc`, [clientId, id])
    return { ...rows[0], history: history.rows }
  }
  return id ? rows[0] : rows
}

async function benefitsResource(user) {
  requireRole(user, ['client'])
  const overview = await clientOverview(user)
  const plans = await plansResource(user)
  const clientId = await clientIdFor(user)
  const usage = await query(`select u.id,u.used_at,u.discount_amount,c.code,c.description from public.coupon_usage u join public.coupons c on c.id=u.coupon_id where u.client_id=$1 order by u.used_at desc`, [clientId])
  return { ...overview, plans, couponUsage: usage.rows }
}

async function cardsResource(user) {
  requireRole(user, ['client'])
  const clientId = await clientIdFor(user)
  const { rows } = await query('select id,brand,last_four,holder_name,active,is_default,created_at from public.saved_cards where client_id=$1 and active order by is_default desc,created_at desc', [clientId])
  return rows
}

async function notificationsResource(user) {
  const [items, preferences] = await Promise.all([
    query('select id,kind,title,body,data,read_at,created_at from public.notifications where profile_id=$1 order by created_at desc limit 100', [user.id]),
    query('select in_app,whatsapp,email,reminders,promotions from public.notification_preferences where profile_id=$1', [user.id])
  ])
  return { items: items.rows, preferences: preferences.rows[0] || null }
}

async function privacyResource(user) {
  requireRole(user, ['client'])
  const [consents, exports, deletion] = await Promise.all([
    query('select consent_type,accepted,accepted_at,revoked_at,policy_version from public.privacy_consents where profile_id=$1 order by consent_type', [user.id]),
    query('select id,status,requested_at,completed_at from public.data_export_requests where profile_id=$1 order by requested_at desc limit 10', [user.id]),
    query('select id,status,reason,requested_at,reviewed_at from public.account_deletion_requests where profile_id=$1 order by requested_at desc limit 1', [user.id])
  ])
  return { consents: consents.rows, exports: exports.rows, deletion: deletion.rows[0] || null }
}

async function referralsResource(user) {
  requireRole(user, ['client'])
  const clientId = await clientIdFor(user)
  const { rows } = await query(`select r.id,r.code,r.invited_name,r.invited_phone,r.status,r.reward_amount,r.created_at,
    coalesce(json_agg(json_build_object('kind',rw.kind,'points',rw.points,'amount',rw.amount,'status',rw.status)) filter(where rw.id is not null),'[]') as rewards
    from public.referrals r left join public.referral_rewards rw on rw.referral_id=r.id where r.referrer_client_id=$1 group by r.id order by r.created_at desc`, [clientId])
  const code = `CAROL${user.id.replace(/-/g,'').slice(0,8).toUpperCase()}`
  return { code, shareUrl: `${process.env.APP_URL || ''}/cadastro?ref=${code}`, referrals: rows }
}

async function scopedClients(user) {
  const params = []; let where = 'true'
  if (user.role === 'professional') { params.push(await professionalIdFor(user)); where = `exists(select 1 from public.appointments a where a.client_id=c.id and a.professional_id=$1)` }
  else requireRole(user, ['admin'])
  const { rows } = await query(`select c.id,p.full_name as name,p.phone,p.avatar_url,p.account_status,u.email,c.lifetime_value,c.created_at,
    coalesce((select sum(points) from public.loyalty_points lp where lp.client_id=c.id),0)::int as points,
    (select max(a.starts_at) from public.appointments a where a.client_id=c.id and a.status='completed') as last_appointment,
    (select min(a.starts_at) from public.appointments a where a.client_id=c.id and a.starts_at>now() and a.status in ('confirmed','pending_deposit')) as next_appointment
    from public.clients c join public.profiles p on p.id=c.profile_id join auth.users u on u.id=p.id where ${where} order by p.full_name`, params)
  return rows
}

async function clientDetail(user, rawId) {
  const id = validUuid(rawId, 'Cliente')
  if (user.role === 'professional') {
    const professionalId = await professionalIdFor(user)
    const access = await query('select 1 from public.appointments where client_id=$1 and professional_id=$2 limit 1', [id, professionalId])
    if (!access.rowCount) throw appError('Cliente não vinculada à sua agenda.', 403)
  } else requireRole(user, ['admin'])
  const profile = await query(`select c.id,c.cpf,c.source,c.preferences,c.technical_notes,c.personal_notes,c.lifetime_value,c.created_at,
    p.id as profile_id,p.full_name,p.phone,p.avatar_url,p.birth_date,p.instagram,p.address,p.account_status,u.email
    from public.clients c join public.profiles p on p.id=c.profile_id join auth.users u on u.id=p.id where c.id=$1`, [id])
  if (!profile.rows[0]) throw appError('Cliente não encontrada.', 404)
  const appointmentFilter = user.role === 'professional' ? 'and a.professional_id=$2' : ''
  const appointmentParams = user.role === 'professional' ? [id, await professionalIdFor(user)] : [id]
  const [appointments, payments, subscriptions, coupons, points, photos, reviews, referrals, consents, notes] = await Promise.all([
    query(`select a.id,a.starts_at,a.ends_at,a.status,a.notes,a.estimated_value,s.name as service,pp.full_name as professional from public.appointments a join public.services s on s.id=a.service_id join public.professionals pr on pr.id=a.professional_id join public.profiles pp on pp.id=pr.profile_id where a.client_id=$1 ${appointmentFilter} order by a.starts_at desc`, appointmentParams),
    user.role === 'admin' ? query(`select id,amount,paid_amount,method,status,paid_at,created_at from public.payments where client_id=$1 order by created_at desc`, [id]) : Promise.resolve({ rows: [] }),
    user.role === 'admin' ? query(`select s.id,s.status,s.starts_at,s.renews_at,s.expires_at,p.name,p.price from public.subscriptions s join public.plans p on p.id=s.plan_id where s.client_id=$1 order by s.created_at desc`, [id]) : Promise.resolve({ rows: [] }),
    user.role === 'admin' ? query(`select c.code,c.description,u.used_at,u.discount_amount from public.coupon_usage u join public.coupons c on c.id=u.coupon_id where u.client_id=$1 order by u.used_at desc`, [id]) : Promise.resolve({ rows: [] }),
    query('select coalesce(sum(points),0)::int as balance,json_agg(json_build_object(\'points\',points,\'reason\',reason,\'created_at\',created_at) order by created_at desc) as history from public.loyalty_points where client_id=$1', [id]),
    query('select id,kind,storage_path,created_at from public.client_photos where client_id=$1 order by created_at desc', [id]),
    query('select r.id,r.rating,r.comment,r.created_at from public.reviews r where r.client_id=$1 order by r.created_at desc', [id]),
    user.role === 'admin' ? query('select id,code,invited_name,invited_phone,status,reward_amount,created_at from public.referrals where referrer_client_id=$1 order by created_at desc', [id]) : Promise.resolve({ rows: [] }),
    user.role === 'admin' ? query(`select consent_type,accepted,accepted_at,revoked_at,policy_version from public.privacy_consents where profile_id=$1`, [profile.rows[0].profile_id]) : Promise.resolve({ rows: [] }),
    query(`select n.id,n.note,n.created_at,p.full_name as author from public.client_internal_notes n join public.profiles p on p.id=n.author_id where n.client_id=$1 order by n.created_at desc`, [id])
  ])
  return { profile: profile.rows[0], appointments: appointments.rows, payments: payments.rows, subscriptions: subscriptions.rows, coupons: coupons.rows, loyalty: points.rows[0] || { balance: 0, history: [] }, photos: photos.rows, reviews: reviews.rows, referrals: referrals.rows, consents: consents.rows, notes: notes.rows }
}

async function clientHistoryResource(user) {
  requireRole(user, ['client'])
  const clientId = await clientIdFor(user)
  const [appointments, records, photos, payments, points] = await Promise.all([
    query(`select a.id,a.starts_at,a.ends_at,a.status,a.notes,a.estimated_value,s.name as service,s.duration_minutes,
      pp.full_name as professional,l.name as location,tr.id as technical_record_id,tr.next_maintenance_date,tr.final_value,tr.payment_status
      from public.appointments a
      join public.services s on s.id=a.service_id
      join public.professionals pr on pr.id=a.professional_id
      join public.profiles pp on pp.id=pr.profile_id
      left join public.salon_locations l on l.id=a.location_id
      left join public.technical_records tr on tr.appointment_id=a.id
      where a.client_id=$1
      order by a.starts_at desc`, [clientId]),
    query(`select tr.id,tr.appointment_id,tr.created_at,tr.strands_count,tr.weight_grams,tr.color,tr.shade,tr.length_cm,
      tr.texture,tr.hair_lot,tr.products_used,tr.recommendations,tr.next_maintenance_date,tr.final_value,tr.payment_status,
      hm.name as method,pp.full_name as professional,a.starts_at
      from public.technical_records tr
      left join public.hair_methods hm on hm.id=tr.hair_method_id
      left join public.professionals pr on pr.id=tr.professional_id
      left join public.profiles pp on pp.id=pr.profile_id
      left join public.appointments a on a.id=tr.appointment_id
      where tr.client_id=$1
      order by coalesce(a.starts_at,tr.created_at) desc`, [clientId]),
    query('select id,appointment_id,kind,storage_path,created_at from public.client_photos where client_id=$1 order by created_at desc', [clientId]),
    query(`select pay.id,pay.appointment_id,pay.amount,pay.paid_amount,pay.method,pay.status,pay.paid_at,pay.created_at,
      s.name as service
      from public.payments pay left join public.appointments a on a.id=pay.appointment_id left join public.services s on s.id=a.service_id
      where pay.client_id=$1 order by pay.created_at desc limit 50`, [clientId]),
    query(`select coalesce(sum(points),0)::int as balance,count(*)::int as movements from public.loyalty_points where client_id=$1`, [clientId])
  ])
  const completed = appointments.rows.filter(item => item.status === 'completed')
  const nextAppointment = appointments.rows
    .filter(item => new Date(item.starts_at) >= new Date() && ['pending_deposit','confirmed','rescheduled'].includes(item.status))
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))[0] || null
  return {
    summary: {
      totalAppointments: appointments.rows.length,
      completedAppointments: completed.length,
      technicalRecords: records.rows.length,
      photos: photos.rows.length,
      loyaltyBalance: points.rows[0]?.balance || 0,
      nextAppointment
    },
    appointments: appointments.rows,
    records: records.rows,
    photos: photos.rows,
    payments: payments.rows
  }
}

async function professionalDashboard(user) {
  requireRole(user, ['professional'])
  const id = await professionalIdFor(user)
  const [metrics, appointments, reviews, goal] = await Promise.all([
    query(`select count(*) filter(where a.starts_at::date=current_date)::int as today,
      count(*) filter(where a.status='completed' and date_trunc('month',a.starts_at)=date_trunc('month',now()))::int as completed_month,
      coalesce(sum(a.estimated_value) filter(where a.status in ('confirmed','in_service','completed') and date_trunc('month',a.starts_at)=date_trunc('month',now())),0) as revenue_month,
      coalesce(sum(c.amount) filter(where c.status in ('pending','approved','paid') and date_trunc('month',c.period)=date_trunc('month',now())),0) as commission_month,
      count(distinct a.client_id) filter(where a.status='completed')::int as clients_served
      from public.appointments a left join public.commissions c on c.appointment_id=a.id where a.professional_id=$1`, [id]),
    query(`select a.id,a.starts_at,a.status,a.estimated_value,s.name as service,cp.full_name as client,cp.avatar_url
      from public.appointments a join public.services s on s.id=a.service_id join public.clients c on c.id=a.client_id join public.profiles cp on cp.id=c.profile_id
      where a.professional_id=$1 and a.starts_at>=current_date and a.starts_at<current_date+interval '7 days' order by a.starts_at`, [id]),
    query('select coalesce(round(avg(rating)::numeric,1),0) as rating,count(*)::int as count from public.reviews where professional_id=$1 and published', [id]),
    query('select revenue_goal,service_goal,product_goal,recurrence_goal from public.professional_goals where professional_id=$1 and period @> current_date order by period desc limit 1', [id])
  ])
  return { metrics: metrics.rows[0], appointments: appointments.rows, reviews: reviews.rows[0], goal: goal.rows[0] || null }
}

async function professionalCommissions(user) {
  requireRole(user, ['professional'])
  const id = await professionalIdFor(user)
  const { rows } = await query(`select c.id,c.base_amount,c.rate,c.amount,c.status,c.period,c.paid_at,a.starts_at,s.name as service,cp.full_name as client
    from public.commissions c left join public.appointments a on a.id=c.appointment_id left join public.services s on s.id=a.service_id
    left join public.clients cl on cl.id=a.client_id left join public.profiles cp on cp.id=cl.profile_id
    where c.professional_id=$1 order by c.period desc,a.starts_at desc`, [id])
  return rows
}

async function professionalServices(user) {
  requireRole(user, ['professional'])
  const id = await professionalIdFor(user)
  const { rows } = await query(`select s.id,s.name,s.description,s.duration_minutes,coalesce(ps.custom_price,s.base_price) as price,ps.commission_rate,s.active
    from public.professional_services ps join public.services s on s.id=ps.service_id where ps.professional_id=$1 order by s.name`, [id])
  return rows
}

async function professionalRecords(user) {
  requireRole(user, ['professional'])
  const id = await professionalIdFor(user)
  const { rows } = await query(`select tr.id,tr.appointment_id,tr.client_id,tr.strands_count,tr.weight_grams,tr.color,tr.shade,tr.length_cm,
    tr.texture,tr.hair_lot,tr.products_used,tr.recommendations,tr.next_maintenance_date,tr.final_value,tr.payment_status,tr.created_at,
    p.full_name as client,p.avatar_url,hm.name as method,a.starts_at
    from public.technical_records tr join public.clients c on c.id=tr.client_id join public.profiles p on p.id=c.profile_id
    left join public.hair_methods hm on hm.id=tr.hair_method_id left join public.appointments a on a.id=tr.appointment_id
    where tr.professional_id=$1 order by tr.created_at desc`, [id])
  return rows
}

async function adminDashboard(user) {
  requireRole(user, ['admin'])
  const { rows } = await query(`select
    count(*) filter(where a.starts_at::date=current_date)::int as appointments_today,
    count(*) filter(where a.starts_at>=date_trunc('week',now()) and a.starts_at<date_trunc('week',now())+interval '7 days')::int as appointments_week,
    count(*) filter(where a.status='cancelled' and date_trunc('month',a.starts_at)=date_trunc('month',now()))::int as cancelled_month,
    count(*) filter(where a.status='no_show' and date_trunc('month',a.starts_at)=date_trunc('month',now()))::int as no_show_month,
    (select coalesce(sum(paid_amount),0) from public.payments where status='paid' and date_trunc('month',paid_at)=date_trunc('month',now())) as monthly_revenue,
    (select count(*)::int from public.clients where date_trunc('month',created_at)=date_trunc('month',now())) as new_clients,
    (select count(*)::int from public.subscriptions where status='active') as active_plans,
    (select count(*)::int from public.payments where status in ('pending','under_review','partial')) as pending_payments
    from public.appointments a`)
  const [services, professionals] = await Promise.all([
    query(`select s.name,count(*)::int as total from public.appointments a join public.services s on s.id=a.service_id group by s.id order by total desc limit 5`),
    query(`select p.full_name,count(*)::int as total from public.appointments a join public.professionals pr on pr.id=a.professional_id join public.profiles p on p.id=pr.profile_id group by p.id order by total desc limit 5`)
  ])
  return { metrics: rows[0], topServices: services.rows, topProfessionals: professionals.rows }
}

async function adminProfessionals(user) {
  requireRole(user,['admin'])
  const {rows}=await query(`select pr.id,p.full_name,p.phone,p.avatar_url,pr.bio,pr.specialties,pr.commission_rate,pr.active,pr.hired_at,
    count(a.id)::int as appointments,coalesce(round(avg(r.rating)::numeric,1),0) as rating
    from public.professionals pr join public.profiles p on p.id=pr.profile_id
    left join public.appointments a on a.professional_id=pr.id left join public.reviews r on r.professional_id=pr.id
    group by pr.id,p.id order by p.full_name`)
  return rows
}

async function adminServices(user) {
  requireRole(user,['admin'])
  const {rows}=await query(`select s.id,s.name,s.description,s.duration_minutes,s.base_price,s.deposit_amount,s.active,hm.name as method,sc.name as category,
    count(a.id)::int as appointments from public.services s left join public.hair_methods hm on hm.id=s.hair_method_id
    left join public.service_categories sc on sc.id=s.category_id left join public.appointments a on a.service_id=s.id
    group by s.id,hm.name,sc.name order by s.name`)
  return rows
}

async function adminCommissions(user) {
  requireRole(user, ['admin'])
  const { rows } = await query(`select c.id,c.base_amount,c.rate,c.amount,c.status,c.period,c.paid_at,
    p.full_name as professional,s.name as service,cp.full_name as client
    from public.commissions c join public.professionals pr on pr.id=c.professional_id join public.profiles p on p.id=pr.profile_id
    left join public.appointments a on a.id=c.appointment_id left join public.services s on s.id=a.service_id
    left join public.clients cl on cl.id=a.client_id left join public.profiles cp on cp.id=cl.profile_id
    order by c.period desc,p.full_name`)
  return rows
}

async function adminSettings(user) {
  requireRole(user, ['admin'])
  const { rows } = await query("select value,updated_at from public.business_settings where key='business_profile'")
  return { ...(rows[0]?.value || {}), updatedAt: rows[0]?.updated_at || null }
}

async function availabilityResource(user) {
  requireRole(user, ['professional'])
  const id = await professionalIdFor(user)
  const [availability, blocked] = await Promise.all([
    query('select id,weekday,starts_at,ends_at,active from public.professional_availability where professional_id=$1 order by weekday,starts_at', [id]),
    query('select id,starts_at,ends_at,reason from public.blocked_schedule where professional_id=$1 and ends_at>=now() order by starts_at', [id])
  ])
  return { availability: availability.rows, blocked: blocked.rows }
}

async function getResource(req, user, resource) {
  if (resource === 'profile') return profileResource(user)
  if (resource === 'client-overview') return clientOverview(user)
  if (resource === 'payments') return paymentsResource(user, req.query?.id)
  if (resource === 'plans') return plansResource(user, req.query?.id)
  if (resource === 'benefits') return benefitsResource(user)
  if (resource === 'cards') return cardsResource(user)
  if (resource === 'notifications') return notificationsResource(user)
  if (resource === 'privacy') return privacyResource(user)
  if (resource === 'referrals') return referralsResource(user)
  if (resource === 'client-history') return clientHistoryResource(user)
  if (resource === 'clients') return scopedClients(user)
  if (resource === 'client-detail') return clientDetail(user, req.query?.id)
  if (resource === 'professional-dashboard') return professionalDashboard(user)
  if (resource === 'professional-commissions') return professionalCommissions(user)
  if (resource === 'professional-services') return professionalServices(user)
  if (resource === 'professional-records') return professionalRecords(user)
  if (resource === 'professional-availability') return availabilityResource(user)
  if (resource === 'admin-dashboard') return adminDashboard(user)
  if (resource === 'admin-professionals') return adminProfessionals(user)
  if (resource === 'admin-services') return adminServices(user)
  if (resource === 'admin-commissions') return adminCommissions(user)
  if (resource === 'admin-settings') return adminSettings(user)
  if (resource === 'admin-payments') { requireRole(user, ['admin']); return paymentsResource(user) }
  if (resource === 'admin-plans') { requireRole(user, ['admin']); return plansResource(user) }
  if (resource === 'admin-coupons') { requireRole(user, ['admin']); return (await query('select * from public.coupons order by code')).rows }
  throw appError('Recurso não encontrado.', 404)
}

async function updateProfile(user, body) {
  const fullName = clean(body.fullName); const email = clean(body.email).toLowerCase(); const phone = clean(body.phone)
  if (fullName.length < 3) throw appError('Informe o nome completo.')
  if (!/^\S+@\S+\.\S+$/.test(email)) throw appError('Informe um e-mail válido.')
  return transaction(async client => {
    await client.query('update auth.users set email=$1,phone=$2,updated_at=now() where id=$3', [email, phone || null, user.id])
    const { rows } = await client.query(`update public.profiles set full_name=$1,phone=$2,birth_date=$3,instagram=$4,address=$5,avatar_url=coalesce($6,avatar_url),updated_at=now() where id=$7 returning *`, [fullName, phone || null, body.birthDate || null, clean(body.instagram) || null, JSON.stringify(body.address || {}), clean(body.avatarUrl) || null, user.id])
    if (user.role === 'client') await client.query('update public.clients set preferences=$1,personal_notes=$2 where profile_id=$3', [JSON.stringify(body.preferences || {}), clean(body.personalNotes) || null, user.id])
    if (user.role === 'professional') await client.query('update public.professionals set bio=$1,specialties=$2 where profile_id=$3', [clean(body.bio) || null, Array.isArray(body.specialties) ? body.specialties.map(clean).filter(Boolean) : [], user.id])
    await client.query(`insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_data) values($1,'update','profile',$1,$2)`, [user.id, JSON.stringify({ fullName, phone, email })])
    return rows[0]
  })
}

async function requestSubscription(user, body) {
  requireRole(user, ['client'])
  const clientId = await clientIdFor(user); const planId = validUuid(body.planId, 'Plano'); const method = clean(body.method).toLowerCase()
  if (!['pix','card','local'].includes(method)) throw appError('Forma de pagamento inválida.')
  return transaction(async client => {
    const { rows: plans } = await client.query('select id,name,price,benefits from public.plans where id=$1 and active for share', [planId])
    if (!plans[0]) throw appError('Plano indisponível.', 404)
    const { rows: subscriptions } = await client.query(`insert into public.subscriptions(client_id,plan_id,status,payment_method,remaining_maintenances) values($1,$2,'awaiting_payment',$3,0) returning *`, [clientId, planId, method])
    const { rows: payments } = await client.query(`insert into public.payments(client_id,subscription_id,amount,method,status) values($1,$2,$3,$4,'pending') returning *`, [clientId, subscriptions[0].id, plans[0].price, method])
    await client.query(`insert into public.notifications(profile_id,kind,title,body,data) values($1,'plan_payment_pending','Plano aguardando pagamento',$2,$3)`, [user.id, `Sua solicitação do plano ${plans[0].name} foi criada.`, JSON.stringify({ subscription_id: subscriptions[0].id, payment_id: payments[0].id })])
    return { subscription: subscriptions[0], payment: payments[0], plan: plans[0] }
  })
}

async function saveCard(user, body) {
  requireRole(user, ['client']); const clientId = await clientIdFor(user)
  const brand = clean(body.brand); const lastFour = clean(body.lastFour); const holder = clean(body.holderName)
  if (!brand || !/^\d{4}$/.test(lastFour) || holder.length < 3) throw appError('Preencha bandeira, nome e últimos quatro dígitos.')
  return transaction(async client => {
    if (body.isDefault) await client.query('update public.saved_cards set is_default=false where client_id=$1', [clientId])
    const { rows } = await client.query(`insert into public.saved_cards(client_id,brand,last_four,holder_name,external_token,is_default) values($1,$2,$3,$4,$5,$6) returning id,brand,last_four,holder_name,active,is_default,created_at`, [clientId, brand, lastFour, holder, clean(body.externalToken) || null, Boolean(body.isDefault)])
    return rows[0]
  })
}

async function updateCard(user, body) {
  requireRole(user, ['client']); const clientId = await clientIdFor(user); const id = validUuid(body.id, 'Cartão')
  return transaction(async client => {
    if (body.action === 'default') {
      await client.query('update public.saved_cards set is_default=false where client_id=$1', [clientId])
      const { rows } = await client.query('update public.saved_cards set is_default=true where id=$1 and client_id=$2 and active returning id', [id, clientId])
      if (!rows[0]) throw appError('Cartão não encontrado.', 404)
    } else if (body.action === 'remove') {
      const { rows } = await client.query('update public.saved_cards set active=false,is_default=false where id=$1 and client_id=$2 returning id', [id, clientId])
      if (!rows[0]) throw appError('Cartão não encontrado.', 404)
    } else throw appError('Ação inválida.')
    return { ok: true }
  })
}

async function updatePreferences(user, body) {
  const values = ['inApp','whatsapp','email','reminders','promotions']
  for (const key of values) if (typeof body[key] !== 'boolean') throw appError('Preferências inválidas.')
  const { rows } = await query(`insert into public.notification_preferences(profile_id,in_app,whatsapp,email,reminders,promotions,updated_at) values($1,$2,$3,$4,$5,$6,now()) on conflict(profile_id) do update set in_app=excluded.in_app,whatsapp=excluded.whatsapp,email=excluded.email,reminders=excluded.reminders,promotions=excluded.promotions,updated_at=now() returning *`, [user.id, body.inApp, body.whatsapp, body.email, body.reminders, body.promotions])
  return rows[0]
}

async function updateConsent(user, body) {
  requireRole(user, ['client']); const type = clean(body.consentType)
  if (!['marketing','whatsapp','email','photos','referrals'].includes(type) || typeof body.accepted !== 'boolean') throw appError('Consentimento inválido.')
  const { rows } = await query(`insert into public.privacy_consents(profile_id,consent_type,accepted,accepted_at,revoked_at,policy_version) values($1,$2,$3,case when $3 then now() end,case when not $3 then now() end,'1.0') on conflict(profile_id,consent_type) do update set accepted=excluded.accepted,accepted_at=case when excluded.accepted then now() else privacy_consents.accepted_at end,revoked_at=case when not excluded.accepted then now() end returning *`, [user.id, type, body.accepted])
  await query(`insert into public.consent_logs(profile_id,consent_type,granted,policy_version,source) values($1,$2,$3,'1.0','client_portal')`, [user.id, type, body.accepted])
  return rows[0]
}

async function exportData(user) {
  requireRole(user, ['client']); const clientId = await clientIdFor(user)
  const request = await query(`insert into public.data_export_requests(profile_id,status,completed_at) values($1,'completed',now()) returning id,status,requested_at,completed_at`, [user.id])
  const [profile, appointments, payments, subscriptions, coupons, consents] = await Promise.all([
    profileResource(user), query('select * from public.appointments where client_id=$1 order by starts_at desc', [clientId]),
    query('select id,appointment_id,subscription_id,amount,discount_amount,paid_amount,method,status,paid_at,created_at from public.payments where client_id=$1 order by created_at desc', [clientId]),
    query('select * from public.subscriptions where client_id=$1 order by created_at desc', [clientId]),
    query('select c.code,c.description,u.used_at,u.discount_amount from public.coupon_usage u join public.coupons c on c.id=u.coupon_id where u.client_id=$1', [clientId]),
    query('select consent_type,accepted,accepted_at,revoked_at,policy_version from public.privacy_consents where profile_id=$1', [user.id])
  ])
  return { request: request.rows[0], export: { generatedAt: new Date().toISOString(), profile, appointments: appointments.rows, payments: payments.rows, subscriptions: subscriptions.rows, couponUsage: coupons.rows, consents: consents.rows } }
}

async function requestDeletion(user, body) {
  requireRole(user, ['client'])
  return transaction(async client => {
    const existing = await client.query(`select id from public.account_deletion_requests where profile_id=$1 and status in ('requested','under_review')`, [user.id])
    if (existing.rowCount) throw appError('Já existe uma solicitação de exclusão em análise.', 409)
    const { rows } = await client.query(`insert into public.account_deletion_requests(profile_id,reason) values($1,$2) returning *`, [user.id, clean(body.reason) || null])
    await client.query(`update public.profiles set account_status='deletion_requested',updated_at=now() where id=$1`, [user.id])
    return rows[0]
  })
}

async function createReferral(user, body) {
  requireRole(user, ['client']); const clientId = await clientIdFor(user); const name = clean(body.name); const phone = clean(body.phone)
  if (name.length < 3 || phone.replace(/\D/g,'').length < 10) throw appError('Informe nome e telefone válidos.')
  const code = `CAROL${user.id.replace(/-/g,'').slice(0,8).toUpperCase()}`
  const { rows } = await query(`insert into public.referrals(referrer_client_id,code,status,invited_name,invited_phone) values($1,$2||'-'||substr(md5(random()::text),1,6),'invited',$3,$4) returning *`, [clientId, code, name, phone])
  return rows[0]
}

async function markNotification(user, body) {
  const id = validUuid(body.id, 'Notificação')
  const { rows } = await query('update public.notifications set read_at=coalesce(read_at,now()) where id=$1 and profile_id=$2 returning id', [id, user.id])
  if (!rows[0]) throw appError('Notificação não encontrada.', 404)
  return { ok: true }
}

async function updateManualPayment(user, body) {
  requireRole(user, ['admin']); const id = validUuid(body.id, 'Pagamento'); const status = clean(body.status)
  if (!['pending','under_review','paid','partial','cancelled','refunded'].includes(status)) throw appError('Status de pagamento inválido.')
  const result = await transaction(async client => {
    const previous = await client.query('select * from public.payments where id=$1 for update', [id])
    if (!previous.rows[0]) throw appError('Pagamento não encontrado.', 404)
    const paidAmount = status === 'paid' ? previous.rows[0].amount : body.paidAmount == null ? previous.rows[0].paid_amount : money(body.paidAmount)
    const { rows } = await client.query(`update public.payments set status=$1,paid_amount=$2,receipt_url=coalesce($3,receipt_url),notes=coalesce($4,notes),confirmed_by=$5,paid_at=case when $1='paid' then coalesce(paid_at,now()) else paid_at end,updated_at=now() where id=$6 returning *`, [status, paidAmount, clean(body.receiptUrl) || null, clean(body.notes) || null, user.id, id])
    if (rows[0].subscription_id && status === 'paid') {
      const subscription = await client.query(`update public.subscriptions s set status='active',starts_at=coalesce(starts_at,current_date),renews_at=coalesce(renews_at,current_date+interval '1 month'),expires_at=coalesce(expires_at,current_date+interval '1 month'),remaining_maintenances=coalesce(nullif(remaining_maintenances,0),(select case when p.name='Essencial' then 1 when p.name='Completo' then 2 when p.name='VIP' then 3 else 4 end from public.plans p where p.id=s.plan_id)),updated_at=now() where s.id=$1 returning s.client_id,s.plan_id`, [rows[0].subscription_id])
      if (subscription.rows[0]) {
        const contact = await client.query(`select p.id,p.full_name,u.email,pl.name from public.clients c join public.profiles p on p.id=c.profile_id join auth.users u on u.id=p.id join public.plans pl on pl.id=$2 where c.id=$1`, [subscription.rows[0].client_id, subscription.rows[0].plan_id])
        if (contact.rows[0]) await client.query(`insert into public.notifications(profile_id,kind,title,body,data) values($1,'plan_activated','Plano ativado',$2,$3)`, [contact.rows[0].id, `Seu plano ${contact.rows[0].name} está ativo.`, JSON.stringify({ subscription_id: rows[0].subscription_id })])
        return { payment: rows[0], contact: contact.rows[0] }
      }
    }
    return { payment: rows[0], contact: null }
  })
  if (result.contact?.email) await sendEmail({ to: result.contact.email, subject: 'Plano Carol Sol ativado', html: `<p>Olá, ${result.contact.full_name}. Seu plano foi ativado com sucesso.</p>` }).catch(error => console.error('Falha ao enviar ativação:', error.message))
  return result.payment
}

async function addClientNote(user, body) {
  requireRole(user, ['professional','admin']); const clientId = validUuid(body.clientId, 'Cliente'); const note = clean(body.note)
  if (note.length < 3) throw appError('Escreva uma observação.')
  if (user.role === 'professional') await clientDetail(user, clientId)
  const { rows } = await query('insert into public.client_internal_notes(client_id,author_id,note) values($1,$2,$3) returning *', [clientId, user.id, note])
  return rows[0]
}

async function updateClientStatus(user, body) {
  requireRole(user, ['admin']); const clientId = validUuid(body.clientId, 'Cliente'); const status = clean(body.status)
  if (!['active','blocked','deletion_requested'].includes(status)) throw appError('Status da conta inválido.')
  const { rows } = await query(`update public.profiles p set account_status=$1,updated_at=now() from public.clients c where c.profile_id=p.id and c.id=$2 returning p.id,p.account_status`, [status, clientId])
  if (!rows[0]) throw appError('Cliente não encontrada.', 404)
  return rows[0]
}

async function savePlan(user, body) {
  requireRole(user, ['admin']); const name=clean(body.name); const price=money(body.price); const benefits=Array.isArray(body.benefits)?body.benefits.map(clean).filter(Boolean):[]
  if(name.length<2||price<=0)throw appError('Informe nome e preço válidos.')
  if(body.id){const id=validUuid(body.id,'Plano');const{rows}=await query(`update public.plans set name=$1,price=$2,billing_cycle=$3,benefits=$4,active=$5 where id=$6 returning *`,[name,price,clean(body.billingCycle)||'monthly',JSON.stringify(benefits),body.active!==false,id]);if(!rows[0])throw appError('Plano não encontrado.',404);return rows[0]}
  const{rows}=await query(`insert into public.plans(name,price,billing_cycle,benefits,active) values($1,$2,$3,$4,true) returning *`,[name,price,clean(body.billingCycle)||'monthly',JSON.stringify(benefits)]);return rows[0]
}

async function saveCoupon(user, body) {
  requireRole(user,['admin']);const code=clean(body.code).toUpperCase();const description=clean(body.description);const value=money(body.discountValue)
  if(code.length<3||description.length<3||value<=0)throw appError('Preencha código, descrição e desconto.')
  if(body.id){const id=validUuid(body.id,'Cupom');const{rows}=await query(`update public.coupons set code=$1,description=$2,discount_type=$3,discount_value=$4,starts_at=$5,ends_at=$6,usage_limit=$7,active=$8 where id=$9 returning *`,[code,description,clean(body.discountType)||'percentage',value,body.startsAt||null,body.endsAt||null,body.usageLimit||null,body.active!==false,id]);if(!rows[0])throw appError('Cupom não encontrado.',404);return rows[0]}
  const{rows}=await query(`insert into public.coupons(code,description,discount_type,discount_value,starts_at,ends_at,usage_limit,active) values($1,$2,$3,$4,$5,$6,$7,true) returning *`,[code,description,clean(body.discountType)||'percentage',value,body.startsAt||null,body.endsAt||null,body.usageLimit||null]);return rows[0]
}

async function blockSchedule(user, body) {
  requireRole(user, ['professional']); const professionalId = await professionalIdFor(user)
  const starts = new Date(body.startsAt); const ends = new Date(body.endsAt)
  if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime()) || ends <= starts) throw appError('Período inválido.')
  const { rows } = await query('insert into public.blocked_schedule(professional_id,starts_at,ends_at,reason) values($1,$2,$3,$4) returning *', [professionalId, starts.toISOString(), ends.toISOString(), clean(body.reason) || null])
  return rows[0]
}

async function saveAdminSettings(user, body) {
  requireRole(user, ['admin'])
  const value = {
    businessName: clean(body.businessName),
    phone: clean(body.phone),
    whatsapp: clean(body.whatsapp),
    email: clean(body.email).toLowerCase(),
    address: clean(body.address),
    timezone: clean(body.timezone) || 'America/Sao_Paulo'
  }
  if (value.businessName.length < 2) throw appError('Informe o nome da empresa.')
  if (value.email && !/^\S+@\S+\.\S+$/.test(value.email)) throw appError('Informe um e-mail válido.')
  const { rows } = await query(`insert into public.business_settings(key,value,updated_by,updated_at)
    values('business_profile',$1,$2,now()) on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=now()
    returning value,updated_at`, [JSON.stringify(value), user.id])
  await query(`insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_data) values($1,'update','business_settings','business_profile',$2)`, [user.id, JSON.stringify(value)])
  return { ...rows[0].value, updatedAt: rows[0].updated_at }
}

async function mutate(user, resource, body) {
  if (resource === 'profile') return updateProfile(user, body)
  if (resource === 'subscription-request') return requestSubscription(user, body)
  if (resource === 'cards' && body.action) return updateCard(user, body)
  if (resource === 'cards') return saveCard(user, body)
  if (resource === 'notification-preferences') return updatePreferences(user, body)
  if (resource === 'privacy-consent') return updateConsent(user, body)
  if (resource === 'data-export') return exportData(user)
  if (resource === 'deletion-request') return requestDeletion(user, body)
  if (resource === 'referrals') return createReferral(user, body)
  if (resource === 'notification-read') return markNotification(user, body)
  if (resource === 'admin-payment') return updateManualPayment(user, body)
  if (resource === 'client-note') return addClientNote(user, body)
  if (resource === 'client-status') return updateClientStatus(user, body)
  if (resource === 'admin-plan') return savePlan(user, body)
  if (resource === 'admin-coupon') return saveCoupon(user, body)
  if (resource === 'blocked-schedule') return blockSchedule(user, body)
  if (resource === 'admin-settings') return saveAdminSettings(user, body)
  throw appError('Ação não encontrada.', 404)
}

export default async function handler(req, res) {
  try {
    const user = await requireUser(req)
    const resource = clean(req.query?.resource)
    if (req.method === 'GET') return send(res, 200, { data: await getResource(req, user, resource) })
    if (!['POST','PATCH','DELETE'].includes(req.method)) return methodNotAllowed(res, ['GET','POST','PATCH','DELETE'])
    const data = await mutate(user, resource, getBody(req))
    return send(res, req.method === 'POST' ? 201 : 200, { data })
  } catch (error) {
    console.error('Portal API error', { method: req.method, resource: req.query?.resource, status: error.status || 500, message: error.message })
    return handleError(res, error)
  }
}
