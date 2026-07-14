import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { query, transaction } from './db.js'

const legacyDataUrl = new URL('../../migration-data/site-antigo.json', import.meta.url)
const serviceMappingUrl = new URL('../../migration-data/service-mapping.json', import.meta.url)

const validUuid = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || ''),
  )

export function deterministicLegacyUuid(kind, legacyId) {
  const bytes = createHash('sha256')
    .update(`carol-sol-legacy:${kind}:${legacyId}`)
    .digest()
    .subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const normalizeText = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')

const normalizeEmail = (value) => {
  const email = String(value || '').trim().toLowerCase()
  return /^\S+@\S+\.\S+$/.test(email) ? email : null
}

const normalizeCpf = (value) => {
  const cpf = String(value || '').replace(/\D/g, '')
  return cpf.length === 11 ? cpf : null
}

const normalizePhone = (value) => {
  const digits = String(value || '').replace(/\D/g, '')
  if (digits.length < 10 || digits.length > 13) return null
  return digits.startsWith('55') && digits.length >= 12 ? digits : `55${digits}`
}

const money = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const raw = String(value ?? '').trim()
  if (!raw) return 0
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

const positiveInteger = (value, fallback) => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

const safeDate = (value, fallback = null) => {
  if (!value) return fallback
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString()
}

const median = (values, fallback = 0) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!sorted.length) return fallback
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

export function mapLegacyAppointmentStatus(value) {
  const status = normalizeText(value)
  if (status === 'completed') return 'completed'
  if (status === 'cancelled' || status === 'canceled') return 'cancelled'
  if (status === 'confirmed' || status === 'scheduled') return 'confirmed'
  return 'requested'
}

export function planLegacyPayment(appointment) {
  const providerStatus = String(
    appointment.payment_status || appointment.billing_status || '',
  ).toUpperCase()
  const total = money(
    appointment.total_price || appointment.total_amount || appointment.deposit_amount,
  )
  const paid = money(appointment.paid_amount)
  const deposit = money(appointment.deposit_amount)
  const approved = providerStatus === 'APPROVED' || providerStatus === 'PAID'
  const pending = providerStatus === 'PENDING'
  if (!approved && !pending && paid <= 0) return null
  const amount = Math.max(total, deposit, paid)
  if (amount <= 0) return null
  const status = approved || paid >= amount ? 'paid' : paid > 0 ? 'partial' : 'pending'
  return {
    amount,
    paidAmount: status === 'paid' ? amount : paid,
    status,
    providerStatus: providerStatus || null,
  }
}

async function loadJson(url) {
  return JSON.parse(await readFile(url, 'utf8'))
}

export function analyzeLegacyDataset(root) {
  const data = root?.data || {}
  const collections = Object.fromEntries(
    Object.entries(data).map(([name, rows]) => [name, Array.isArray(rows) ? rows.length : 0]),
  )
  const appointments = Array.isArray(data.customerAppointments)
    ? data.customerAppointments
    : []
  const users = Array.isArray(data.users) ? data.users : []
  return {
    collections,
    totalRecords: Object.values(collections).reduce((sum, count) => sum + count, 0),
    users: users.length,
    customers: users.filter((item) => normalizeText(item.role) === 'customer').length,
    appointments: appointments.length,
    distinctServices: new Set(
      appointments.map((item) => String(item.service_name || '').trim()).filter(Boolean),
    ).size,
    payments: appointments.filter((item) => planLegacyPayment(item)).length,
    products: Array.isArray(data.products) ? data.products.length : 0,
    coupons: Array.isArray(data.coupons) ? data.coupons.length : 0,
  }
}

async function loadLegacyInput() {
  const [legacy, mapping] = await Promise.all([
    loadJson(legacyDataUrl),
    loadJson(serviceMappingUrl),
  ])
  return {
    legacy,
    data: legacy?.data || {},
    serviceMapping: mapping?.service_mapping || {},
    analysis: analyzeLegacyDataset(legacy),
  }
}

const setupSql = `
create table if not exists public.legacy_import_batches (
  id uuid primary key,
  source text not null,
  status text not null default 'running',
  summary jsonb not null default '{}',
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
create table if not exists public.legacy_import_records (
  id uuid primary key,
  batch_id uuid references public.legacy_import_batches(id),
  source_collection text not null,
  legacy_id text not null,
  target_table text,
  target_id text,
  payload jsonb not null,
  imported_at timestamptz not null default now(),
  unique(source_collection, legacy_id)
);
alter table public.profiles add column if not exists legacy_id text;
alter table public.profiles add column if not exists legacy_data jsonb not null default '{}';
alter table public.appointments add column if not exists legacy_id text;
alter table public.appointments add column if not exists legacy_data jsonb not null default '{}';
alter table public.payments add column if not exists legacy_id text;
alter table public.payments add column if not exists legacy_data jsonb not null default '{}';
alter table public.products add column if not exists legacy_id text;
alter table public.products add column if not exists legacy_data jsonb not null default '{}';
alter table public.coupons add column if not exists legacy_id text;
alter table public.coupons add column if not exists legacy_data jsonb not null default '{}';
alter table public.client_photos add column if not exists legacy_id text;
alter table public.consent_logs add column if not exists legacy_id text;
create unique index if not exists profiles_legacy_id_unique on public.profiles(legacy_id);
create unique index if not exists appointments_legacy_id_unique on public.appointments(legacy_id);
create unique index if not exists payments_legacy_id_unique on public.payments(legacy_id);
create unique index if not exists products_legacy_id_unique on public.products(legacy_id);
create unique index if not exists coupons_legacy_id_unique on public.coupons(legacy_id);
create unique index if not exists client_photos_legacy_id_unique on public.client_photos(legacy_id);
create unique index if not exists consent_logs_legacy_id_unique on public.consent_logs(legacy_id);
`

async function archiveRecord(client, batchId, collection, item, index) {
  const legacyId = String(
    item?.id || item?.module_key || item?.page_slug || item?.code || index,
  )
  const id = deterministicLegacyUuid('archive', `${collection}:${legacyId}`)
  await client.query(
    `insert into public.legacy_import_records(
       id,batch_id,source_collection,legacy_id,payload
     ) values($1,$2,$3,$4,$5)
     on conflict(source_collection,legacy_id) do update
       set batch_id=excluded.batch_id,payload=excluded.payload,imported_at=now()`,
    [id, batchId, collection, legacyId, JSON.stringify(item || {})],
  )
  return legacyId
}

async function linkArchive(client, collection, legacyId, targetTable, targetId) {
  await client.query(
    `update public.legacy_import_records
     set target_table=$1,target_id=$2,imported_at=now()
     where source_collection=$3 and legacy_id=$4`,
    [targetTable, String(targetId), collection, String(legacyId)],
  )
}

function contactMaps(appointments) {
  const byUser = new Map()
  const byEmail = new Map()
  for (const appointment of appointments) {
    const contact = {
      phone: normalizePhone(
        appointment.customer_phone || appointment.questionnaire_data?.phone,
      ),
      cpf: normalizeCpf(appointment.questionnaire_data?.cpf),
    }
    if (appointment.user_id && !byUser.has(appointment.user_id))
      byUser.set(appointment.user_id, contact)
    const email = normalizeEmail(
      appointment.customer_email || appointment.questionnaire_data?.email,
    )
    if (email && !byEmail.has(email)) byEmail.set(email, contact)
  }
  return { byUser, byEmail }
}

async function importUsers(client, input, stats) {
  const users = Array.isArray(input.data.users) ? input.data.users : []
  const appointments = Array.isArray(input.data.customerAppointments)
    ? input.data.customerAppointments
    : []
  const contacts = contactMaps(appointments)
  const clientByLegacyId = new Map()
  const clientByEmail = new Map()

  for (const user of users) {
    const legacyId = String(user.id)
    const email = normalizeEmail(user.email)
    const contact = contacts.byUser.get(legacyId) || (email && contacts.byEmail.get(email)) || {}
    const phone = contact.phone || null
    const cpf = normalizeCpf(user.cpf) || contact.cpf || null
    const createdAt = safeDate(user.createdAt, new Date().toISOString())
    const updatedAt = safeDate(user.updatedAt, createdAt)
    const preferredId = deterministicLegacyUuid('profile', legacyId)
    const account = await client.query(
      `select u.id,p.role,p.legacy_id
       from auth.users u left join public.profiles p on p.id=u.id
       where ($1::text is not null and lower(u.email)=lower($1)) or p.legacy_id=$2
       order by (p.legacy_id=$2) desc limit 1`,
      [email, legacyId],
    )
    const profileId = account.rows[0]?.id || preferredId
    const role = account.rows[0]?.role || 'client'

    if (!account.rows[0]) {
      await client.query(
        `insert into auth.users(
           id,email,phone,encrypted_password,email_confirmed_at,raw_user_meta_data,created_at,updated_at
         ) values($1,$2,null,null,$3,$4,$3,$5)
         on conflict(id) do nothing`,
        [
          profileId,
          email,
          email ? createdAt : null,
          JSON.stringify({ name: user.name, legacy_id: legacyId, password_reset_required: true }),
          updatedAt,
        ],
      )
    }

    await client.query(
      `insert into public.profiles(
         id,role,full_name,phone,cpf,notification_preferences,account_status,
         legacy_id,legacy_data,created_at,updated_at
       ) values($1,$2,$3,$4,$5,'{"email":true,"whatsapp":true,"push":true}',
         'active',$6,$7,$8,$9)
       on conflict(id) do update set
         full_name=coalesce(nullif(public.profiles.full_name,''),excluded.full_name),
         phone=coalesce(public.profiles.phone,excluded.phone),
         cpf=coalesce(public.profiles.cpf,excluded.cpf),
         legacy_id=coalesce(public.profiles.legacy_id,excluded.legacy_id),
         legacy_data=coalesce(public.profiles.legacy_data,'{}') || excluded.legacy_data,
         updated_at=greatest(public.profiles.updated_at,excluded.updated_at)`,
      [
        profileId,
        role,
        String(user.name || 'Cliente importada').trim(),
        phone,
        cpf,
        legacyId,
        JSON.stringify({ ...user, original_role: user.role, invalid_email: email ? null : user.email }),
        createdAt,
        updatedAt,
      ],
    )

    if (role === 'client') {
      const preferredClientId = deterministicLegacyUuid('client', legacyId)
      await client.query(
        `insert into public.clients(id,profile_id,source,preferences,cpf,created_at)
         values($1,$2,'Migração do sistema anterior',$3,$4,$5)
         on conflict(profile_id) do update set
           source=coalesce(public.clients.source,excluded.source),
           preferences=coalesce(public.clients.preferences,'{}') || excluded.preferences,
           cpf=coalesce(public.clients.cpf,excluded.cpf)`,
        [
          preferredClientId,
          profileId,
          JSON.stringify({ legacy_id: legacyId, legacy_role: user.role, password_reset_required: true }),
          cpf,
          createdAt,
        ],
      )
      const linked = await client.query(
        'select id from public.clients where profile_id=$1 limit 1',
        [profileId],
      )
      const clientId = linked.rows[0].id
      clientByLegacyId.set(legacyId, clientId)
      if (email) clientByEmail.set(email, clientId)
      stats.clients += 1
      await client.query(
        'insert into public.notification_preferences(profile_id) values($1) on conflict(profile_id) do nothing',
        [profileId],
      )
      for (const consentType of ['marketing', 'whatsapp', 'email', 'photos', 'referrals']) {
        await client.query(
          `insert into public.privacy_consents(profile_id,consent_type,accepted,policy_version)
           values($1,$2,false,'1.0') on conflict(profile_id,consent_type) do nothing`,
          [profileId, consentType],
        )
      }
      await linkArchive(client, 'users', legacyId, 'clients', clientId)
    } else {
      await linkArchive(client, 'users', legacyId, 'profiles', profileId)
    }
    stats.profiles += 1
  }
  return { clientByLegacyId, clientByEmail }
}

async function importServices(client, input, stats) {
  const appointments = Array.isArray(input.data.customerAppointments)
    ? input.data.customerAppointments
    : []
  const existing = await client.query('select id,name from public.services order by id')
  const existingById = new Map(existing.rows.map((item) => [item.id, item]))
  const existingByName = new Map(
    existing.rows.map((item) => [normalizeText(item.name), item.id]),
  )
  const legacyCategoryId = deterministicLegacyUuid('service-category', 'historico')
  await client.query(
    `insert into public.service_categories(id,name,sort_order)
     values($1,'Histórico importado',999) on conflict(id) do nothing`,
    [legacyCategoryId],
  )
  const serviceIdByName = new Map()
  const groups = new Map()
  for (const appointment of appointments) {
    const name = String(appointment.service_name || 'Serviço não informado').trim()
    const normalizedName = normalizeText(name)
    const mapped =
      input.serviceMapping[name] || input.serviceMapping[appointment.questionnaire_data?.serviceId]
    let targetId = existingByName.get(normalizedName)
    if (!targetId && validUuid(mapped)) targetId = mapped
    if (!targetId) targetId = deterministicLegacyUuid('service', normalizedName)
    serviceIdByName.set(normalizedName, targetId)
    if (!existingById.has(targetId)) {
      const group = groups.get(targetId) || { names: [], durations: [], prices: [], deposits: [] }
      group.names.push(name)
      group.durations.push(positiveInteger(appointment.duration_minutes, 60))
      group.prices.push(money(appointment.total_price || appointment.total_amount))
      group.deposits.push(money(appointment.deposit_amount))
      groups.set(targetId, group)
    }
  }
  for (const [targetId, group] of groups) {
    const name = [...new Set(group.names)].sort((a, b) => a.length - b.length)[0]
    const price = median(group.prices, 0)
    await client.query(
      `insert into public.services(
         id,category_id,name,description,duration_minutes,base_price,deposit_amount,
         active,show_online_booking,is_free
       ) values($1,$2,$3,$4,$5,$6,$7,false,false,$8)
       on conflict(id) do update set show_online_booking=false`,
      [
        targetId,
        legacyCategoryId,
        name,
        'Serviço histórico importado do sistema anterior. Oculto do agendamento online.',
        Math.max(15, Math.round(median(group.durations, 60))),
        price,
        median(group.deposits, 0),
        price === 0,
      ],
    )
    stats.servicesCreated += 1
  }
  return serviceIdByName
}

async function importProductsAndCoupons(client, input, stats) {
  const categories = new Map(
    (input.data.categories || []).map((item) => [String(item.id), String(item.name || '')]),
  )
  for (const product of input.data.products || []) {
    const legacyId = String(product.id)
    const sku = String(product.slug || `LEGACY-${legacyId}`).slice(0, 120)
    await client.query(
      `insert into public.products(
         id,sku,name,category,price,stock_quantity,minimum_stock,active,legacy_id,legacy_data
       ) values($1,$2,$3,$4,$5,$6,0,$7,$8,$9)
       on conflict(sku) do update set
         legacy_id=coalesce(public.products.legacy_id,excluded.legacy_id),
         legacy_data=coalesce(public.products.legacy_data,'{}') || excluded.legacy_data`,
      [
        deterministicLegacyUuid('product', legacyId),
        sku,
        String(product.name || 'Produto importado'),
        categories.get(String(product.categoryId)) || product.hairType || 'Catálogo legado',
        money(product.price),
        positiveInteger(product.stock, 0),
        product.isActive !== false && product.inStock !== false,
        legacyId,
        JSON.stringify(product),
      ],
    )
    const linked = await client.query('select id from public.products where sku=$1 limit 1', [sku])
    await linkArchive(client, 'products', legacyId, 'products', linked.rows[0].id)
    stats.products += 1
  }
  for (const coupon of input.data.coupons || []) {
    const legacyId = String(coupon.id)
    const code = String(coupon.code || `LEGACY-${legacyId}`).trim().toUpperCase()
    await client.query(
      `insert into public.coupons(
         id,code,description,discount_type,discount_value,starts_at,ends_at,
         usage_limit,target,active,legacy_id,legacy_data
       ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       on conflict(code) do update set
         legacy_id=coalesce(public.coupons.legacy_id,excluded.legacy_id),
         legacy_data=coalesce(public.coupons.legacy_data,'{}') || excluded.legacy_data`,
      [
        deterministicLegacyUuid('coupon', legacyId),
        code,
        `Cupom importado do sistema anterior (${coupon.type || 'desconto'}).`,
        normalizeText(coupon.type).includes('percent') ? 'percentage' : 'fixed',
        money(coupon.value),
        safeDate(coupon.validFrom),
        safeDate(coupon.validTo),
        coupon.usageLimit == null ? null : Number(coupon.usageLimit),
        JSON.stringify({ min_purchase: money(coupon.minPurchase), applicable_to: coupon.applicableTo }),
        coupon.isActive !== false,
        legacyId,
        JSON.stringify(coupon),
      ],
    )
    const linked = await client.query('select id from public.coupons where code=$1 limit 1', [code])
    await linkArchive(client, 'coupons', legacyId, 'coupons', linked.rows[0].id)
    stats.coupons += 1
  }
}

async function importPhotos(client, appointment, clientId, appointmentId, stats) {
  const photos = [
    ['before', appointment.before_image_url],
    ['after', appointment.after_image_url],
    ['intake', appointment.questionnaire_data?.hairPhotoUrl],
    ['donation', appointment.questionnaire_data?.donationHairImageUrl],
  ].filter(([, url]) => /^https?:\/\//i.test(String(url || '')))
  for (const [kind, storagePath] of photos) {
    const legacyId = `${appointment.id}:${kind}`
    await client.query(
      `insert into public.client_photos(
         id,client_id,appointment_id,kind,storage_path,legacy_id,created_at
       ) values($1,$2,$3,$4,$5,$6,$7) on conflict(legacy_id) do nothing`,
      [
        deterministicLegacyUuid('client-photo', legacyId),
        clientId,
        appointmentId,
        kind,
        String(storagePath),
        legacyId,
        safeDate(appointment.created_at, new Date().toISOString()),
      ],
    )
    stats.photos += 1
  }
}

async function importConsent(client, appointment, profileId, stats) {
  const questionnaire = appointment.questionnaire_data || {}
  const accepted =
    questionnaire.termsAccepted === true ||
    (Array.isArray(questionnaire.acceptedTerms) && questionnaire.acceptedTerms.length > 0)
  if (!accepted) return
  const legacyId = `${appointment.id}:terms`
  await client.query(
    `insert into public.consent_logs(
       id,profile_id,consent_type,granted,policy_version,source,legacy_id,created_at
     ) values($1,$2,'legacy_booking_terms',true,$3,'Migração do sistema anterior',$4,$5)
     on conflict(legacy_id) do nothing`,
    [
      deterministicLegacyUuid('consent', legacyId),
      profileId,
      String(questionnaire.termsVersion || questionnaire.responsibilityTermVersion || 'legacy'),
      legacyId,
      safeDate(questionnaire.termsAcceptedAt || appointment.created_at, new Date().toISOString()),
    ],
  )
  stats.consents += 1
}

async function importAppointments(client, input, users, serviceIds, stats) {
  const professional = await client.query(
    `select pr.id,pr.profile_id
     from public.professionals pr join public.profiles p on p.id=pr.profile_id
     order by (lower(p.full_name) like '%carol%') desc,pr.active desc,pr.hired_at nulls last,pr.id
     limit 1`,
  )
  if (!professional.rows[0]) throw new Error('Nenhuma profissional cadastrada para receber o histórico.')
  const professionalId = professional.rows[0].id
  const createdBy = professional.rows[0].profile_id
  const location = await client.query(
    'select id from public.salon_locations order by active desc,id limit 1',
  )
  const locationId = location.rows[0]?.id || null

  for (const appointment of input.data.customerAppointments || []) {
    const legacyId = String(appointment.id)
    const email = normalizeEmail(
      appointment.customer_email || appointment.questionnaire_data?.email,
    )
    const clientId =
      users.clientByLegacyId.get(String(appointment.user_id || '')) ||
      (email && users.clientByEmail.get(email))
    if (!clientId) {
      stats.skippedAppointments += 1
      stats.warnings.push(`Agendamento ${legacyId} sem cliente correspondente.`)
      continue
    }
    const profile = await client.query('select profile_id from public.clients where id=$1', [clientId])
    const serviceId = serviceIds.get(
      normalizeText(appointment.service_name || 'Serviço não informado'),
    )
    if (!serviceId) {
      stats.skippedAppointments += 1
      stats.warnings.push(`Agendamento ${legacyId} sem serviço correspondente.`)
      continue
    }
    const startsAt = safeDate(
      appointment.scheduled_at ||
        `${appointment.scheduled_local_date || ''}T${appointment.scheduled_local_time || '09:00'}:00-03:00`,
    )
    if (!startsAt) {
      stats.skippedAppointments += 1
      stats.warnings.push(`Agendamento ${legacyId} sem data válida.`)
      continue
    }
    const duration = positiveInteger(appointment.duration_minutes, 60)
    const endsAt = new Date(new Date(startsAt).getTime() + duration * 60_000).toISOString()
    const appointmentId = deterministicLegacyUuid('appointment', legacyId)
    const estimatedValue = money(appointment.total_price || appointment.total_amount)
    const createdAt = safeDate(appointment.created_at, startsAt)
    const updatedAt = safeDate(appointment.updated_at, createdAt)
    await client.query(
      `insert into public.appointments(
         id,client_id,professional_id,service_id,location_id,starts_at,ends_at,status,
         notes,estimated_value,created_by,created_at,booking_code,intake_data,
         original_value,updated_at,legacy_id,legacy_data
       ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$10,$15,$16,$17)
       on conflict(legacy_id) do update set
         intake_data=excluded.intake_data,legacy_data=excluded.legacy_data,
         updated_at=greatest(public.appointments.updated_at,excluded.updated_at)`,
      [
        appointmentId,
        clientId,
        professionalId,
        serviceId,
        locationId,
        startsAt,
        endsAt,
        mapLegacyAppointmentStatus(appointment.status),
        appointment.notes || null,
        estimatedValue,
        createdBy,
        createdAt,
        `LEG-${createHash('sha256').update(legacyId).digest('hex').slice(0, 12).toUpperCase()}`,
        JSON.stringify(appointment.questionnaire_data || {}),
        updatedAt,
        legacyId,
        JSON.stringify(appointment),
      ],
    )
    stats.appointments += 1
    await linkArchive(client, 'customerAppointments', legacyId, 'appointments', appointmentId)

    const payment = planLegacyPayment(appointment)
    if (payment) {
      await client.query(
        `insert into public.payments(
           id,appointment_id,client_id,amount,method,status,provider_reference,
           paid_at,created_at,paid_amount,notes,updated_at,provider,provider_status,
           payment_method,original_amount,checkout_reference,legacy_id,legacy_data
         ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'legacy',$13,$5,$4,$14,$15,$16)
         on conflict(legacy_id) do update set legacy_data=excluded.legacy_data`,
        [
          deterministicLegacyUuid('payment', legacyId),
          appointmentId,
          clientId,
          payment.amount,
          appointment.payment_method || 'legacy',
          payment.status,
          legacyId,
          payment.status === 'paid' ? updatedAt : null,
          createdAt,
          payment.paidAmount,
          'Cobrança importada do sistema anterior.',
          updatedAt,
          payment.providerStatus,
          `LEGACY-${createHash('sha256').update(legacyId).digest('hex').slice(0, 16).toUpperCase()}`,
          legacyId,
          JSON.stringify(appointment),
        ],
      )
      stats.payments += 1
    }
    await importPhotos(client, appointment, clientId, appointmentId, stats)
    await importConsent(client, appointment, profile.rows[0].profile_id, stats)
  }
}

export async function legacyImportStatus() {
  const input = await loadLegacyInput()
  const relation = await query("select to_regclass('public.legacy_import_records') as records")
  if (!relation.rows[0]?.records)
    return { applied: false, source: input.analysis, imported: {} }
  const imported = await query(`
    select
      (select count(*)::int from public.legacy_import_records) as archived_records,
      (select count(*)::int from public.profiles where legacy_id is not null) as profiles,
      (select count(*)::int from public.appointments where legacy_id is not null) as appointments,
      (select count(*)::int from public.payments where legacy_id is not null) as payments,
      (select count(*)::int from public.products where legacy_id is not null) as products,
      (select count(*)::int from public.coupons where legacy_id is not null) as coupons
  `)
  return {
    applied: Number(imported.rows[0].archived_records) >= input.analysis.totalRecords,
    source: input.analysis,
    imported: imported.rows[0],
  }
}

export async function applyLegacyImport() {
  const input = await loadLegacyInput()
  const batchId = deterministicLegacyUuid('batch', 'site-antigo-v1')
  const stats = {
    archivedRecords: 0,
    profiles: 0,
    clients: 0,
    servicesCreated: 0,
    appointments: 0,
    skippedAppointments: 0,
    payments: 0,
    photos: 0,
    consents: 0,
    products: 0,
    coupons: 0,
    warnings: [],
  }
  await transaction(async (client) => {
    await client.query(setupSql)
    await client.query(
      `insert into public.legacy_import_batches(id,source,status,summary)
       values($1,'site-antigo.json','running','{}')
       on conflict(id) do update set status='running',started_at=now(),completed_at=null`,
      [batchId],
    )
    for (const [collection, rows] of Object.entries(input.data)) {
      if (!Array.isArray(rows)) continue
      for (let index = 0; index < rows.length; index += 1) {
        await archiveRecord(client, batchId, collection, rows[index], index)
        stats.archivedRecords += 1
      }
    }
    const users = await importUsers(client, input, stats)
    const services = await importServices(client, input, stats)
    await importProductsAndCoupons(client, input, stats)
    await importAppointments(client, input, users, services, stats)
    await client.query(
      `update public.legacy_import_batches
       set status='completed',summary=$2,completed_at=now() where id=$1`,
      [batchId, JSON.stringify(stats)],
    )
    await client.query(
      `insert into public._luxe_migrations(version,description)
       values('012_legacy_site_import','Importação idempotente do sistema Carol Sol anterior')
       on conflict(version) do nothing`,
    )
  })
  return { batchId, source: input.analysis, imported: stats }
}
