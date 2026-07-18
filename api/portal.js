import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { query, transaction } from "../server/lib/db.js";
import { requireUser } from "../server/lib/auth.js";
import {
  deleteFromCloudinary,
  isConfiguredCloudinaryUrl,
  sendEmail,
  sendWhatsApp,
} from "../server/lib/integrations.js";
import { deactivateSumupPaymentInstrument, createSumupCheckout, sumupConfig } from "../server/lib/sumup.js";
import {
  periodFitsSchedule,
  schedulePeriod,
} from "../server/lib/availability-rules.js";
import {
  appError,
  getBody,
  handleError,
  methodNotAllowed,
  send,
} from "../server/lib/http.js";
import { resolveReceiptReview } from "../server/lib/payment-rules.js";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = (value) => String(value ?? "").trim();
const temporaryPassword = () => `Carol-${randomBytes(4).toString("hex").toUpperCase()}`;
const validUuid = (value, label = "ID") => {
  const id = clean(value);
  if (!uuidPattern.test(id)) throw appError(`${label} inválido.`);
  return id;
};
const money = (value) => Number(value || 0);

async function ensureMarketingSchema() {
  await query(`
    alter table public.services add column if not exists show_online_booking boolean not null default true;
    alter table public.services add column if not exists is_free boolean not null default false;
    create table if not exists public.marketing_promotions (
      id uuid primary key default uuid_generate_v4(),
      title text not null,
      description text,
      promotional_value numeric(12,2) not null default 0,
      original_value numeric(12,2),
      starts_at date,
      ends_at date,
      active boolean not null default true,
      show_on_site boolean not null default false,
      whatsapp_only boolean not null default true,
      keywords jsonb not null default '[]',
      archived boolean not null default false,
      created_by uuid references public.profiles(id),
      updated_by uuid references public.profiles(id),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create index if not exists marketing_promotions_active_idx on public.marketing_promotions(active, archived, starts_at, ends_at);
    alter table public.service_categories add column if not exists parent_id uuid references public.service_categories(id) on delete cascade;
    alter table public.hair_methods add column if not exists category_id uuid references public.service_categories(id) on delete cascade;
    alter table public.hair_methods add column if not exists parent_id uuid references public.hair_methods(id) on delete cascade;
  `);
}

function normalizePromotionKeywords(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean).slice(0, 30);
  return clean(value)
    .split(/[\n,;]/)
    .map(clean)
    .filter(Boolean)
    .slice(0, 30);
}

async function ensureAdminSettingsSchema() {
  await query(`
    create table if not exists public.business_settings (
      key text primary key,
      value jsonb not null default '{}',
      updated_by uuid references public.profiles(id),
      updated_at timestamptz default now()
    );
    create table if not exists public.integration_settings (
      provider text primary key,
      enabled boolean not null default false,
      public_config jsonb not null default '{}',
      last_success_at timestamptz,
      last_error text,
      updated_by uuid references public.profiles(id),
      updated_at timestamptz not null default now()
    );
    insert into public.integration_settings(provider,enabled,public_config)
    values
      ('sumup',false,'{"environment":"sandbox"}'),
      ('whatsapp',false,'{}'),
      ('resend',false,'{}'),
      ('message_templates',true,'{}')
    on conflict(provider) do nothing;
  `);
}

async function clientIdFor(user) {
  const { rows } = await query(
    "select id from public.clients where profile_id=$1",
    [user.id],
  );
  if (!rows[0]) throw appError("Perfil de cliente não encontrado.", 404);
  return rows[0].id;
}

async function professionalIdFor(user) {
  const { rows } = await query(
    "select id from public.professionals where profile_id=$1",
    [user.id],
  );
  if (!rows[0]) throw appError("Perfil profissional não encontrado.", 404);
  return rows[0].id;
}

function requireRole(user, roles) {
  if (!roles.includes(user.role))
    throw appError("Você não tem permissão para esta ação.", 403);
}

async function profileResource(user) {
  const { rows } = await query(
    `select p.id,p.role,p.full_name,p.phone,p.avatar_url,p.birth_date,p.instagram,p.address,p.account_status,
    p.notification_preferences,p.created_at,u.email,c.id as client_id,c.cpf,c.preferences,c.personal_notes,
    pr.id as professional_id,pr.bio,pr.specialties,pr.commission_rate,pr.active
    from public.profiles p join auth.users u on u.id=p.id
    left join public.clients c on c.profile_id=p.id left join public.professionals pr on pr.profile_id=p.id
    where p.id=$1`,
    [user.id],
  );
  return rows[0];
}

async function clientOverview(user) {
  await query("alter table public.coupons add column if not exists archived boolean default false");
  await query("alter table public.plans add column if not exists archived boolean default false");
  await query("alter table public.payments add column if not exists billing_reason text");
  requireRole(user, ["client"]);
  const clientId = await clientIdFor(user);
  const [profile, appointment, firstAccessPrompt, points, subscription, coupons, pending] =
    await Promise.all([
      profileResource(user),
      query(
        `select a.id,a.booking_code,a.starts_at,a.status,a.estimated_value,s.name as service,pp.full_name as professional,l.name as location,
        pay.id as payment_id,pay.amount as payment_amount,pay.status as payment_status,pay.billing_reason
      from public.appointments a join public.services s on s.id=a.service_id join public.professionals pr on pr.id=a.professional_id
      join public.profiles pp on pp.id=pr.profile_id left join public.salon_locations l on l.id=a.location_id
      left join lateral (
        select id,amount,status,billing_reason from public.payments
        where appointment_id=a.id and status in ('pending','awaiting_confirmation','under_review','partial','failed','expired')
        order by created_at desc limit 1
      ) pay on true
      where a.client_id=$1 and a.starts_at>=now() and a.status in ('requested','awaiting_payment','pending_deposit','confirmed','rescheduled') order by a.starts_at limit 1`,
        [clientId],
      ),
      query(
        `select a.id,a.booking_code,a.starts_at,a.status,a.estimated_value,s.name as service,pp.full_name as professional,l.name as location,
        pay.id as payment_id,pay.amount as payment_amount,pay.status as payment_status,pay.billing_reason
       from public.appointments a join public.services s on s.id=a.service_id join public.professionals pr on pr.id=a.professional_id
       join public.profiles pp on pp.id=pr.profile_id left join public.salon_locations l on l.id=a.location_id
       join public.payments pay on pay.appointment_id=a.id
      where a.client_id=$1
        and a.starts_at>=now()
        and a.status in ('requested','awaiting_payment','pending_deposit')
        and coalesce(a.intake_data->>'origin','')='whatsapp_ai'
        and pay.status in ('pending','awaiting_confirmation','failed','expired','partial')
      order by a.created_at desc limit 1`,
        [clientId],
      ),
      query(
        "select coalesce(sum(points),0)::int as points from public.loyalty_points where client_id=$1",
        [clientId],
      ),
      query(
        `select sub.id,sub.status,sub.starts_at,sub.renews_at,sub.expires_at,sub.remaining_maintenances,
        sub.auto_renew,sub.recurring_card_id,sub.recurring_consent_at,sub.recurring_consent_revoked_at,
        sub.renewal_failures,sub.next_retry_at,sc.last_four as recurring_card_last_four,
        p.id as plan_id,p.name,p.price,p.benefits
      from public.subscriptions sub join public.plans p on p.id=sub.plan_id
      left join public.saved_cards sc on sc.id=sub.recurring_card_id
      where sub.client_id=$1 order by sub.created_at desc limit 1`,
        [clientId],
      ),
      query(
        `select c.id,c.code,c.description,c.discount_type,c.discount_value,c.ends_at
      from public.coupons c where c.active and not c.archived and (c.starts_at is null or c.starts_at<=now()) and (c.ends_at is null or c.ends_at>=now())
      and not exists(select 1 from public.coupon_usage u where u.coupon_id=c.id and u.client_id=$1) order by c.ends_at nulls last`,
        [clientId],
      ),
      query(
        `select count(*)::int as count,coalesce(sum(amount-paid_amount),0) as amount from public.payments where client_id=$1 and status in ('pending','under_review','partial')`,
        [clientId],
      ),
    ]);
  return {
    profile,
    nextAppointment: appointment.rows[0] || null,
    firstAccessPrompt: firstAccessPrompt.rows[0] || null,
    points: points.rows[0].points,
    subscription: subscription.rows[0] || null,
    coupons: coupons.rows,
    pendingPayments: pending.rows[0],
  };
}

async function paymentsResource(user, id) {
  await query("alter table public.payments add column if not exists billing_reason text");
  let where = "true";
  const params = [];
  if (user.role === "client") {
    params.push(await clientIdFor(user));
    where = `pay.client_id=$${params.length}`;
  } else if (user.role === "professional") {
    params.push(await professionalIdFor(user));
    where = `a.professional_id=$${params.length}`;
  }
  if (id && id !== "structured") {
    params.push(validUuid(id, "Pagamento"));
    where += ` and pay.id=$${params.length}`;
  }
  const { rows } = await query(
    `select pay.id,pay.amount,pay.original_amount,pay.discount_amount,pay.paid_amount,pay.method,pay.payment_method,pay.status,pay.provider,pay.provider_reference,
    pay.provider_checkout_id,pay.provider_transaction_id,pay.checkout_reference,pay.hosted_checkout_url,pay.provider_status,pay.failure_reason,
    pay.receipt_url,pay.notes,pay.paid_at,pay.created_at,pay.updated_at,pay.billing_reason,a.id as appointment_id,a.starts_at,s.name as service,
    sub.id as subscription_id,pl.name as plan,cp.full_name as client,
    lr.id as latest_receipt_id,lr.storage_url as latest_receipt_url,lr.status as latest_receipt_status,
    lr.rejection_reason as latest_receipt_rejection_reason,lr.created_at as latest_receipt_created_at
    from public.payments pay join public.clients c on c.id=pay.client_id join public.profiles cp on cp.id=c.profile_id
    left join public.appointments a on a.id=pay.appointment_id left join public.services s on s.id=a.service_id
    left join public.subscriptions sub on sub.id=pay.subscription_id left join public.plans pl on pl.id=sub.plan_id
    left join lateral (select pr.id,pr.storage_url,pr.status,pr.rejection_reason,pr.created_at from public.payment_receipts pr where pr.payment_id=pay.id order by pr.created_at desc limit 1) lr on true
    where ${where} order by pay.created_at desc`,
    params,
  );
  if (id === "structured") {
    const clientId = await clientIdFor(user);
    const apps = await query(
      `select a.id,a.starts_at,a.status,s.name as service,s.base_price,s.deposit_amount,a.estimated_value,a.discount_amount
       from public.appointments a join public.services s on s.id=a.service_id
       where a.client_id=$1 order by a.starts_at desc`,
      [clientId]
    );
    return {
      payments: rows,
      appointments: apps.rows,
    };
  }
  if (id && id !== "structured" && !rows[0]) throw appError("Pagamento não encontrado.", 404);
  if (!id) return rows;
  const [history, receipts] = await Promise.all([
    query(
      "select old_status,new_status,notes,created_at from public.payment_status_history where payment_id=$1 order by created_at desc",
      [rows[0].id],
    ),
    query(
      "select id,storage_url,status,rejection_reason,created_at,reviewed_at from public.payment_receipts where payment_id=$1 order by created_at desc",
      [rows[0].id],
    ),
  ]);
  return { ...rows[0], history: history.rows, receipts: receipts.rows };
}

async function plansResource(user, id) {
  await query("alter table public.plans add column if not exists archived boolean default false");
  const params = [];
  let where = user.role === "admin" ? "p.archived=false" : "p.active=true and p.archived=false";
  if (id) {
    params.push(validUuid(id, "Plano"));
    where += ` and p.id=$1`;
  }
  const { rows } = await query(
    `select p.id,p.name,p.price,p.billing_cycle,p.benefits,p.active,p.archived,
    (select count(*)::int from public.subscriptions s where s.plan_id=p.id and s.status='active') as active_subscribers
    from public.plans p where ${where} order by p.price`,
    params,
  );
  if (id && !rows[0]) throw appError("Plano não encontrado.", 404);
  if (id && user.role === "client") {
    const clientId = await clientIdFor(user);
    const history = await query(
      `select s.id,s.status,s.starts_at,s.renews_at,s.expires_at,s.payment_method,pay.id as payment_id,pay.status as payment_status,pay.amount,pay.paid_at
      from public.subscriptions s left join public.payments pay on pay.subscription_id=s.id where s.client_id=$1 and s.plan_id=$2 order by s.created_at desc`,
      [clientId, id],
    );
    return { ...rows[0], history: history.rows };
  }
  return id ? rows[0] : rows;
}

async function benefitsResource(user) {
  requireRole(user, ["client"]);
  const overview = await clientOverview(user);
  const plans = await plansResource(user);
  const clientId = await clientIdFor(user);
  const [usage, defaultCard] = await Promise.all([
    query(
      `select u.id,u.used_at,u.discount_amount,c.code,c.description from public.coupon_usage u join public.coupons c on c.id=u.coupon_id where u.client_id=$1 order by u.used_at desc`,
      [clientId],
    ),
    query(
      `select id,brand,last_four from public.saved_cards where client_id=$1 and active
       and is_default and provider='sumup' and external_token is not null limit 1`,
      [clientId],
    ),
  ]);
  return {
    ...overview,
    plans,
    couponUsage: usage.rows,
    defaultCard: defaultCard.rows[0] || null,
  };
}

async function cardsResource(user) {
  requireRole(user, ["client"]);
  const clientId = await clientIdFor(user);
  const { rows } = await query(
    `select id,brand,last_four,holder_name,active,is_default,tokenized_at,created_at
     from public.saved_cards where client_id=$1 and active and provider='sumup' and external_token is not null
     order by is_default desc,created_at desc`,
    [clientId],
  );
  return rows;
}

async function notificationsResource(user) {
  const [items, preferences] = await Promise.all([
    query(
      `select n.id,n.kind,n.title,n.body,n.data,n.action_url,n.metadata,n.read_at,n.created_at,
        coalesce(
          (select json_agg(json_build_object('channel', l.channel, 'status', l.status, 'error_message', l.error_message))
           from public.notification_delivery_logs l
           where l.notification_id = n.id),
          '[]'::json
        ) as delivery_logs
       from public.notifications n
       where n.profile_id=$1
       order by n.created_at desc
       limit 100`,
      [user.id],
    ),
    query(
      "select in_app,whatsapp,email,reminders,promotions from public.notification_preferences where profile_id=$1",
      [user.id],
    ),
  ]);
  return { items: items.rows, preferences: preferences.rows[0] || null };
}

async function privacyResource(user) {
  requireRole(user, ["client"]);
  const [consents, exports, deletion] = await Promise.all([
    query(
      "select consent_type,accepted,accepted_at,revoked_at,policy_version from public.privacy_consents where profile_id=$1 order by consent_type",
      [user.id],
    ),
    query(
      "select id,status,requested_at,completed_at from public.data_export_requests where profile_id=$1 order by requested_at desc limit 10",
      [user.id],
    ),
    query(
      "select id,status,reason,requested_at,reviewed_at from public.account_deletion_requests where profile_id=$1 order by requested_at desc limit 1",
      [user.id],
    ),
  ]);
  return {
    consents: consents.rows,
    exports: exports.rows,
    deletion: deletion.rows[0] || null,
  };
}

async function referralsResource(user) {
  requireRole(user, ["client"]);
  const clientId = await clientIdFor(user);
  const { rows } = await query(
    `select r.id,r.code,r.invited_name,r.invited_phone,r.status,r.reward_amount,r.created_at,
    coalesce(json_agg(json_build_object('kind',rw.kind,'points',rw.points,'amount',rw.amount,'status',rw.status)) filter(where rw.id is not null),'[]') as rewards
    from public.referrals r left join public.referral_rewards rw on rw.referral_id=r.id where r.referrer_client_id=$1 group by r.id order by r.created_at desc`,
    [clientId],
  );
  const code = `CAROL${user.id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
  return {
    code,
    shareUrl: `${process.env.APP_URL || ""}/cadastro?ref=${code}`,
    referrals: rows,
  };
}

async function scopedClients(user) {
  const params = [];
  let where = "true";
  if (user.role === "professional") {
    params.push(await professionalIdFor(user));
    where = `exists(select 1 from public.appointments a where a.client_id=c.id and a.professional_id=$1)`;
  } else requireRole(user, ["admin"]);
  const { rows } = await query(
    `select c.id,p.full_name as name,p.phone,p.avatar_url,p.account_status,u.email,c.lifetime_value,c.created_at,
    coalesce((select sum(points) from public.loyalty_points lp where lp.client_id=c.id),0)::int as points,
    (select max(a.starts_at) from public.appointments a where a.client_id=c.id and a.status='completed') as last_appointment,
    (select min(a.starts_at) from public.appointments a where a.client_id=c.id and a.starts_at>now() and a.status in ('confirmed','pending_deposit')) as next_appointment
    from public.clients c join public.profiles p on p.id=c.profile_id join auth.users u on u.id=p.id where ${where} order by p.full_name`,
    params,
  );
  return rows;
}

async function clientDetail(user, rawId) {
  const id = validUuid(rawId, "Cliente");
  if (user.role === "professional") {
    const professionalId = await professionalIdFor(user);
    const access = await query(
      `select 1 from public.clients c
       where c.id = $1::uuid
         and (
           exists(select 1 from public.appointments a where a.client_id=c.id and a.professional_id=$2::uuid limit 1)
           or (c.preferences->>'created_by_professional' = $3::text)
         )
       limit 1`,
      [id, professionalId, user.id]
    );
    if (!access.rowCount)
      throw appError("Cliente não vinculada à sua agenda.", 403);
  } else requireRole(user, ["admin"]);
  const profile = await query(
    `select c.id,c.cpf,c.source,c.preferences,c.technical_notes,c.personal_notes,c.lifetime_value,c.created_at,
    p.id as profile_id,p.full_name,p.phone,p.avatar_url,p.birth_date,p.instagram,p.address,p.account_status,u.email
    from public.clients c join public.profiles p on p.id=c.profile_id join auth.users u on u.id=p.id where c.id=$1`,
    [id],
  );
  if (!profile.rows[0]) throw appError("Cliente não encontrada.", 404);
  const [
    appointments,
    payments,
    subscriptions,
    coupons,
    points,
    photos,
    reviews,
    referrals,
    consents,
    deletion,
    notes,
  ] = await Promise.all([
    query(
      `select a.id,a.starts_at,a.ends_at,a.status,a.notes,a.estimated_value,a.intake_data,s.name as service,pp.full_name as professional from public.appointments a join public.services s on s.id=a.service_id join public.professionals pr on pr.id=a.professional_id join public.profiles pp on pp.id=pr.profile_id where a.client_id=$1 order by a.starts_at desc`,
      [id],
    ),
    query(
      `select id,amount,paid_amount,method,status,paid_at,created_at from public.payments where client_id=$1 order by created_at desc`,
      [id],
    ),
    query(
      `select s.id,s.status,s.starts_at,s.renews_at,s.expires_at,p.name,p.price from public.subscriptions s join public.plans p on p.id=s.plan_id where s.client_id=$1 order by s.created_at desc`,
      [id],
    ),
    query(
      `select c.code,c.description,u.used_at,u.discount_amount from public.coupon_usage u join public.coupons c on c.id=u.coupon_id where u.client_id=$1 order by u.used_at desc`,
      [id],
    ),
    query(
      "select coalesce(sum(points),0)::int as balance,json_agg(json_build_object('points',points,'reason',reason,'created_at',created_at) order by created_at desc) as history from public.loyalty_points where client_id=$1",
      [id],
    ),
    query(
      "select id,kind,storage_path,created_at from public.client_photos where client_id=$1 order by created_at desc",
      [id],
    ),
    query(
      "select r.id,r.rating,r.comment,r.created_at from public.reviews r where r.client_id=$1 order by r.created_at desc",
      [id],
    ),
    query(
      "select id,code,invited_name,invited_phone,status,reward_amount,created_at from public.referrals where referrer_client_id=$1 order by created_at desc",
      [id],
    ),
    query(
      `select consent_type,accepted,accepted_at,revoked_at,policy_version from public.privacy_consents where profile_id=$1`,
      [profile.rows[0].profile_id],
    ),
    query(
      `select id,status,reason,requested_at,reviewed_at,reviewed_by
       from public.account_deletion_requests where profile_id=$1
       order by requested_at desc limit 1`,
      [profile.rows[0].profile_id],
    ),
    query(
      `select n.id,n.note,n.created_at,p.full_name as author from public.client_internal_notes n join public.profiles p on p.id=n.author_id where n.client_id=$1 order by n.created_at desc`,
      [id],
    ),
  ]);
  return {
    profile: profile.rows[0],
    appointments: appointments.rows,
    payments: payments.rows,
    subscriptions: subscriptions.rows,
    coupons: coupons.rows,
    loyalty: points.rows[0] || { balance: 0, history: [] },
    photos: photos.rows,
    reviews: reviews.rows,
    referrals: referrals.rows,
    consents: consents.rows,
    deletion: deletion.rows[0] || null,
    notes: notes.rows,
  };
}

async function clientHistoryResource(user) {
  requireRole(user, ["client"]);
  const clientId = await clientIdFor(user);
  const [appointments, records, photos, payments, points] = await Promise.all([
    query(
      `select a.id,a.starts_at,a.ends_at,a.status,a.notes,a.estimated_value,s.name as service,s.duration_minutes,
      pp.full_name as professional,l.name as location,tr.id as technical_record_id,tr.next_maintenance_date,tr.final_value,tr.payment_status
      from public.appointments a
      join public.services s on s.id=a.service_id
      join public.professionals pr on pr.id=a.professional_id
      join public.profiles pp on pp.id=pr.profile_id
      left join public.salon_locations l on l.id=a.location_id
      left join public.technical_records tr on tr.appointment_id=a.id
      where a.client_id=$1
      order by a.starts_at desc`,
      [clientId],
    ),
    query(
      `select tr.id,tr.appointment_id,tr.created_at,tr.strands_count,tr.weight_grams,tr.color,tr.shade,tr.length_cm,
      tr.texture,tr.hair_lot,tr.products_used,tr.recommendations,tr.next_maintenance_date,tr.final_value,tr.payment_status,
      hm.name as method,pp.full_name as professional,a.starts_at
      from public.technical_records tr
      left join public.hair_methods hm on hm.id=tr.hair_method_id
      left join public.professionals pr on pr.id=tr.professional_id
      left join public.profiles pp on pp.id=pr.profile_id
      left join public.appointments a on a.id=tr.appointment_id
      where tr.client_id=$1
      order by coalesce(a.starts_at,tr.created_at) desc`,
      [clientId],
    ),
    query(
      "select id,appointment_id,kind,storage_path,created_at from public.client_photos where client_id=$1 order by created_at desc",
      [clientId],
    ),
    query(
      `select pay.id,pay.appointment_id,pay.amount,pay.paid_amount,pay.method,pay.status,pay.paid_at,pay.created_at,
      s.name as service
      from public.payments pay left join public.appointments a on a.id=pay.appointment_id left join public.services s on s.id=a.service_id
      where pay.client_id=$1 order by pay.created_at desc limit 50`,
      [clientId],
    ),
    query(
      `select coalesce(sum(points),0)::int as balance,count(*)::int as movements from public.loyalty_points where client_id=$1`,
      [clientId],
    ),
  ]);
  const completed = appointments.rows.filter(
    (item) => item.status === "completed",
  );
  const nextAppointment =
    appointments.rows
      .filter(
        (item) =>
          new Date(item.starts_at) >= new Date() &&
          ["pending_deposit", "confirmed", "rescheduled"].includes(item.status),
      )
      .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))[0] || null;
  return {
    summary: {
      totalAppointments: appointments.rows.length,
      completedAppointments: completed.length,
      technicalRecords: records.rows.length,
      photos: photos.rows.length,
      loyaltyBalance: points.rows[0]?.balance || 0,
      nextAppointment,
    },
    appointments: appointments.rows,
    records: records.rows,
    photos: photos.rows,
    payments: payments.rows,
  };
}

async function professionalDashboard(user) {
  requireRole(user, ["professional"]);
  const id = await professionalIdFor(user);
  const [metrics, appointments, reviews, goal] = await Promise.all([
    query(
      `select count(*) filter(where a.starts_at::date=current_date)::int as today,
      count(*) filter(where a.status='completed' and date_trunc('month',a.starts_at)=date_trunc('month',now()))::int as completed_month,
      coalesce(sum(a.estimated_value) filter(where a.status in ('confirmed','in_service','completed') and date_trunc('month',a.starts_at)=date_trunc('month',now())),0) as revenue_month,
      coalesce(sum(c.amount) filter(where c.status in ('pending','approved','paid') and date_trunc('month',c.period)=date_trunc('month',now())),0) as commission_month,
      count(distinct a.client_id) filter(where a.status='completed')::int as clients_served
      from public.appointments a left join public.commissions c on c.appointment_id=a.id where a.professional_id=$1`,
      [id],
    ),
    query(
      `select a.id,a.starts_at,a.status,a.estimated_value,s.name as service,cp.full_name as client,cp.avatar_url
      from public.appointments a join public.services s on s.id=a.service_id join public.clients c on c.id=a.client_id join public.profiles cp on cp.id=c.profile_id
      where a.professional_id=$1 and a.starts_at>=current_date and a.starts_at<current_date+interval '7 days' order by a.starts_at`,
      [id],
    ),
    query(
      "select coalesce(round(avg(rating)::numeric,1),0) as rating,count(*)::int as count from public.reviews where professional_id=$1 and published",
      [id],
    ),
    query(
      "select revenue_goal,service_goal,product_goal,recurrence_goal from public.professional_goals where professional_id=$1 and period @> current_date order by period desc limit 1",
      [id],
    ),
  ]);
  return {
    metrics: metrics.rows[0],
    appointments: appointments.rows,
    reviews: reviews.rows[0],
    goal: goal.rows[0] || null,
  };
}

async function professionalNewAppointments(user) {
  requireRole(user, ["professional"]);
  const id = await professionalIdFor(user);
  const { rows } = await query(
    `select a.id,a.booking_code,a.starts_at,a.ends_at,a.status,a.estimated_value,a.created_at,
      s.name as service,cp.full_name as client,cp.phone as client_phone,cp.avatar_url,
      pay.id as payment_id,pay.amount as payment_amount,pay.status as payment_status,pay.hosted_checkout_url
     from public.appointments a
     join public.services s on s.id=a.service_id
     join public.clients c on c.id=a.client_id
     join public.profiles cp on cp.id=c.profile_id
     left join lateral (
       select id,amount,status,hosted_checkout_url
       from public.payments
       where appointment_id=a.id
       order by created_at desc
       limit 1
     ) pay on true
     where a.professional_id=$1
       and a.starts_at>=now()
       and a.created_at>=now()-interval '7 days'
       and a.status in ('requested','awaiting_payment','pending_deposit','confirmed','rescheduled')
     order by a.created_at desc,a.starts_at
     limit 10`,
    [id],
  );
  return { appointments: rows };
}

async function professionalCommissions(user) {
  requireRole(user, ["professional"]);
  const id = await professionalIdFor(user);
  const { rows } = await query(
    `select c.id,c.base_amount,c.rate,c.amount,c.status,c.period,c.paid_at,a.starts_at,s.name as service,cp.full_name as client
    from public.commissions c left join public.appointments a on a.id=c.appointment_id left join public.services s on s.id=a.service_id
    left join public.clients cl on cl.id=a.client_id left join public.profiles cp on cp.id=cl.profile_id
    where c.professional_id=$1 order by c.period desc,a.starts_at desc`,
    [id],
  );
  return rows;
}

async function professionalServices(user) {
  requireRole(user, ["professional"]);
  const id = await professionalIdFor(user);
  const { rows } = await query(
    `select s.id,s.name,s.description,s.duration_minutes,coalesce(ps.custom_price,s.base_price) as price,ps.commission_rate,s.active
    from public.professional_services ps join public.services s on s.id=ps.service_id where ps.professional_id=$1 order by s.name`,
    [id],
  );
  return rows;
}

async function professionalRecords(user) {
  requireRole(user, ["professional"]);
  const id = await professionalIdFor(user);
  const [records, appointments, methods, hairInventory, products] = await Promise.all([
    query(
      `select tr.id,tr.appointment_id,tr.client_id,tr.hair_method_id,tr.strands_count,tr.weight_grams,tr.color,tr.shade,tr.length_cm,
       tr.texture,tr.hair_lot,tr.products_used,tr.recommendations,tr.internal_notes,tr.next_maintenance_date,tr.final_value,tr.payment_status,tr.created_at,
       p.full_name as client,p.avatar_url,hm.name as method,a.starts_at,s.name as service,
       (select count(*)::int from public.client_photos ph where ph.appointment_id=tr.appointment_id) as photo_count,
       (select inventory_id from public.inventory_movements mv where mv.technical_record_id=tr.id and mv.kind='consume' limit 1) as hair_inventory_id,
       (select quantity from public.inventory_movements mv where mv.technical_record_id=tr.id and mv.kind='consume' limit 1) as hair_inventory_qty
       from public.technical_records tr
       join public.clients c on c.id=tr.client_id
       join public.profiles p on p.id=c.profile_id
       join public.appointments a on a.id=tr.appointment_id
       join public.services s on s.id=a.service_id
       left join public.hair_methods hm on hm.id=tr.hair_method_id
       where tr.professional_id=$1 order by coalesce(a.starts_at,tr.created_at) desc`,
      [id],
    ),
    query(
      `select a.id,a.client_id,a.starts_at,a.status,s.name as service,s.hair_method_id,
       cp.full_name as client,cp.avatar_url,hm.name as method,tr.id as record_id,
       exists(select 1 from public.privacy_consents pc where pc.profile_id=c.profile_id and pc.consent_type='photos' and pc.accepted and pc.revoked_at is null) as photos_allowed
       from public.appointments a
       join public.clients c on c.id=a.client_id
       join public.profiles cp on cp.id=c.profile_id
       join public.services s on s.id=a.service_id
       left join public.hair_methods hm on hm.id=s.hair_method_id
       left join public.technical_records tr on tr.appointment_id=a.id
       where a.professional_id=$1 and a.status in ('confirmed','in_service','completed')
       order by a.starts_at desc limit 100`,
      [id],
    ),
    query(
      "select id,name from public.hair_methods where active order by name",
    ),
    query(
      "select id, code, supplier, category, color, shade, length_cm, texture, weight_grams, lot, quantity, unit_cost from public.hair_inventory where status='active' order by lot",
    ),
    query(
      "select id, sku, name, category, cost, price, stock_quantity from public.products where active=true order by name",
    ),
  ]);
  return {
    records: records.rows,
    appointments: appointments.rows,
    methods: methods.rows,
    inventory: hairInventory.rows,
    products: products.rows,
  };
}

async function adminDashboard(user, queryParams = {}) {
  requireRole(user, ["admin"]);

  const start = queryParams.start ? clean(queryParams.start) : null;
  const end = queryParams.end ? clean(queryParams.end) : null;

  let sqlFilterAppointments = `a.starts_at>=date_trunc('month',now()) and a.starts_at<date_trunc('month',now())+interval '1 month'`;
  let sqlFilterPayments = `status='paid' and paid_at>=date_trunc('month',now()) and paid_at<date_trunc('month',now())+interval '1 month'`;
  let sqlFilterClients = `created_at>=date_trunc('month',now()) and created_at<date_trunc('month',now())+interval '1 month'`;
  let sqlFilterTop = `a.starts_at>=date_trunc('month',now()) and a.starts_at<date_trunc('month',now())+interval '1 month'`;

  const params = [];
  if (start && end) {
    sqlFilterAppointments = `a.starts_at::date >= $1 and a.starts_at::date <= $2`;
    sqlFilterPayments = `status='paid' and paid_at::date >= $1 and paid_at::date <= $2`;
    sqlFilterClients = `created_at::date >= $1 and created_at::date <= $2`;
    sqlFilterTop = `a.starts_at::date >= $1 and a.starts_at::date <= $2`;
    params.push(start, end);
  }

  const { rows } = await query(`select
    count(*) filter(where a.starts_at::date=current_date)::int as appointments_today,
    count(*) filter(where ${sqlFilterAppointments})::int as appointments_period,
    count(*) filter(where a.status='cancelled' and ${sqlFilterAppointments})::int as cancelled_period,
    count(*) filter(where a.status='no_show' and ${sqlFilterAppointments})::int as no_show_period,
    (select coalesce(sum(paid_amount),0) from public.payments where ${sqlFilterPayments}) as period_revenue,
    (select count(*)::int from public.clients where ${sqlFilterClients}) as new_clients,
    (select count(*)::int from public.subscriptions where status='active') as active_plans,
    (select count(*)::int from public.payments where status in ('pending','under_review','partial')) as pending_payments
    from public.appointments a`, params);

  const queryParamsForLists = params.length ? params : [
    new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
    new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().split('T')[0]
  ];

  const [services, professionals, appointmentsList, paymentsList] = await Promise.all([
    query(
      `select s.name,count(*)::int as total from public.appointments a join public.services s on s.id=a.service_id where ${sqlFilterTop} group by s.id, s.name order by total desc limit 5`,
      params
    ),
    query(
      `select p.full_name,count(*)::int as total from public.appointments a join public.professionals pr on pr.id=a.professional_id join public.profiles p on p.id=pr.profile_id where ${sqlFilterTop} group by p.id, p.full_name order by total desc limit 5`,
      params
    ),
    query(
      `select a.id, a.starts_at, a.status, s.name as service, pp.full_name as professional, cp.full_name as client, a.estimated_value
       from public.appointments a
       join public.services s on s.id=a.service_id
       join public.professionals pr on pr.id=a.professional_id
       join public.profiles pp on pp.id=pr.profile_id
       join public.clients c on c.id=a.client_id
       join public.profiles cp on cp.id=c.profile_id
       where a.starts_at::date >= $1 and a.starts_at::date <= $2
       order by a.starts_at desc`,
      queryParamsForLists
    ),
    query(
      `select py.id, py.created_at, py.paid_at, py.amount, py.paid_amount, py.method, py.status, cp.full_name as client
       from public.payments py
       join public.clients c on c.id=py.client_id
       join public.profiles cp on cp.id=c.profile_id
       where py.created_at::date >= $1 and py.created_at::date <= $2
       order by py.created_at desc`,
      queryParamsForLists
    )
  ]);

  return {
    metrics: rows[0],
    topServices: services.rows,
    topProfessionals: professionals.rows,
    appointments: appointmentsList.rows,
    payments: paymentsList.rows,
    start: start || queryParamsForLists[0],
    end: end || queryParamsForLists[1]
  };
}

async function adminProfessionals(user) {
  requireRole(user, ["admin"]);
  const { rows } =
    await query(`select pr.id,p.full_name,p.phone,p.avatar_url,u.email,pr.bio,pr.specialties,pr.commission_rate,pr.active,pr.hired_at,
    count(a.id)::int as appointments,coalesce(round(avg(r.rating)::numeric,1),0) as rating
    from public.professionals pr join public.profiles p on p.id=pr.profile_id
    join auth.users u on u.id=p.id
    left join public.appointments a on a.professional_id=pr.id left join public.reviews r on r.professional_id=pr.id
    group by pr.id,p.id,u.email order by p.full_name`);
  return rows;
}

async function adminProfessionalDetail(user, id) {
  requireRole(user, ["admin"]);
  const professionalId = validUuid(id, "Profissional");
  const { rows } = await query(
    `select pr.id, pr.profile_id, p.full_name, p.phone, p.avatar_url, u.email, pr.bio, pr.specialties, pr.commission_rate, pr.active, pr.hired_at
     from public.professionals pr
     join public.profiles p on p.id=pr.profile_id
     join auth.users u on u.id=p.id
     where pr.id=$1`,
    [professionalId]
  );
  if (!rows[0]) throw appError("Profissional não encontrada.", 404);
  const availability = await query(
    `select id, weekday, starts_at::text, ends_at::text, active
     from public.professional_availability
     where professional_id=$1
     order by weekday, starts_at`,
    [professionalId]
  );
  return { ...rows[0], availability: availability.rows };
}

async function adminServices(user) {
  requireRole(user, ["admin"]);
  await ensureMarketingSchema();
  await query("alter table public.services add column if not exists offer_inventory_items boolean default false");
  const [services, links, categories, methods, professionals, inventory] = await Promise.all([
    query(`select s.id,s.category_id,s.hair_method_id,s.name,s.description,s.duration_minutes,s.base_price,s.deposit_amount,s.active,
      coalesce(s.show_online_booking,true) as show_online_booking,
      coalesce(s.is_free,false) as is_free,
      coalesce(s.offer_inventory_items,false) as offer_inventory_items,
      hm.name as method,sc.name as category,count(a.id)::int as appointments
      from public.services s
      left join public.hair_methods hm on hm.id=s.hair_method_id
      left join public.service_categories sc on sc.id=s.category_id
      left join public.appointments a on a.service_id=s.id
      group by s.id,hm.name,sc.name order by s.name`),
    query(`select ps.service_id,ps.professional_id,ps.custom_price,ps.commission_rate,p.full_name as professional,pr.active
      from public.professional_services ps
      join public.professionals pr on pr.id=ps.professional_id
      join public.profiles p on p.id=pr.profile_id
      order by p.full_name`),
    query("select id,name,parent_id from public.service_categories order by sort_order,name"),
    query("select id,name,active,category_id,parent_id,description,maintenance_days from public.hair_methods order by name"),
    query(`select pr.id,p.full_name as name,pr.commission_rate,pr.active
      from public.professionals pr join public.profiles p on p.id=pr.profile_id
      order by p.full_name`),
    query(`select id, code, category as name, category, color, shade, length_cm, texture, weight_grams, quantity, suggested_price, category_id, hair_method_id, active
      from public.hair_inventory
      where archived = false and active = true and quantity > 0`),
  ]);
  const linksByService = new Map();
  for (const link of links.rows) {
    const current = linksByService.get(link.service_id) || [];
    current.push(link);
    linksByService.set(link.service_id, current);
  }
  return {
    services: services.rows.map((service) => ({
      ...service,
      professionals: linksByService.get(service.id) || [],
    })),
    categories: categories.rows,
    methods: methods.rows,
    professionals: professionals.rows,
    inventory: inventory.rows,
  };
}

async function adminPromotions(user) {
  requireRole(user, ["admin"]);
  await ensureMarketingSchema();
  const { rows } = await query(
    `select id,title,description,promotional_value,original_value,starts_at,ends_at,
      active,show_on_site,whatsapp_only,keywords,created_at,updated_at
     from public.marketing_promotions
     where archived=false
     order by active desc, ends_at nulls last, title`,
  );
  return rows;
}

async function adminSchedule(user) {
  requireRole(user, ["admin"]);
  const [professionals, blocked] = await Promise.all([
    query(
      `select pr.id,p.full_name as name,pr.active
       from public.professionals pr
       join public.profiles p on p.id=pr.profile_id
       order by p.full_name`,
    ),
    query(
      `select b.id,b.professional_id,b.starts_at,b.ends_at,b.reason,p.full_name as professional
       from public.blocked_schedule b
       join public.professionals pr on pr.id=b.professional_id
       join public.profiles p on p.id=pr.profile_id
       where b.ends_at>=now()
       order by b.starts_at`,
    ),
  ]);
  return { professionals: professionals.rows, blocked: blocked.rows };
}

async function adminCommissions(user) {
  requireRole(user, ["admin"]);
  const { rows } =
    await query(`select c.id,c.base_amount,c.rate,c.amount,c.status,c.period,c.paid_at,
    p.full_name as professional,s.name as service,cp.full_name as client
    from public.commissions c join public.professionals pr on pr.id=c.professional_id join public.profiles p on p.id=pr.profile_id
    left join public.appointments a on a.id=c.appointment_id left join public.services s on s.id=a.service_id
    left join public.clients cl on cl.id=a.client_id left join public.profiles cp on cp.id=cl.profile_id
    order by c.period desc,p.full_name`);
  return rows;
}

async function adminSettings(user) {
  requireRole(user, ["admin"]);
  await ensureAdminSettingsSchema();
  const [profile, templates] = await Promise.all([
    query("select value,updated_at from public.business_settings where key='business_profile'"),
    query("select public_config from public.integration_settings where provider='message_templates'")
  ]);
  return {
    ...(profile.rows[0]?.value || {}),
    updatedAt: profile.rows[0]?.updated_at || null,
    templates: templates.rows[0]?.public_config || {
      confirmation: "",
      reminder: "",
      cancellation: "",
      reschedule: ""
    }
  };
}

async function availabilityResource(user) {
  requireRole(user, ["professional"]);
  const id = await professionalIdFor(user);
  const [availability, blocked] = await Promise.all([
    query(
      "select id,weekday,starts_at,ends_at,active from public.professional_availability where professional_id=$1 order by weekday,starts_at",
      [id],
    ),
    query(
      "select id,starts_at,ends_at,reason from public.blocked_schedule where professional_id=$1 and ends_at>=now() order by starts_at",
      [id],
    ),
  ]);
  return { availability: availability.rows, blocked: blocked.rows };
}

async function getResource(req, user, resource) {
  if (resource === "profile") return profileResource(user);
  if (resource === "client-overview") return clientOverview(user);
  if (resource === "payments") return paymentsResource(user, req.query?.id);
  if (resource === "plans") return plansResource(user, req.query?.id);
  if (resource === "benefits") return benefitsResource(user);
  if (resource === "cards") return cardsResource(user);
  if (resource === "notifications") return notificationsResource(user);
  if (resource === "privacy") return privacyResource(user);
  if (resource === "referrals") return referralsResource(user);
  if (resource === "client-history") return clientHistoryResource(user);
  if (resource === "clients") return scopedClients(user);
  if (resource === "client-detail") return clientDetail(user, req.query?.id);
  if (resource === "professional-dashboard") return professionalDashboard(user);
  if (resource === "professional-new-appointments")
    return professionalNewAppointments(user);
  if (resource === "professional-commissions")
    return professionalCommissions(user);
  if (resource === "professional-services") return professionalServices(user);
  if (resource === "professional-records") return professionalRecords(user);
  if (resource === "professional-availability")
    return availabilityResource(user);
  if (resource === "admin-dashboard") return adminDashboard(user, req.query);
  if (resource === "admin-professionals") return adminProfessionals(user);
  if (resource === "admin-professional") return adminProfessionalDetail(user, req.query?.id);
  if (resource === "admin-services") return adminServices(user);
  if (resource === "admin-promotions") return adminPromotions(user);
  if (resource === "admin-schedule") return adminSchedule(user);
  if (resource === "admin-commissions") return adminCommissions(user);
  if (resource === "admin-settings") return adminSettings(user);
  if (resource === "admin-backups") return listBackups(user);
  if (resource === "admin-backup-download") return downloadBackup(user, req.query?.id);
  if (resource === "admin-payments") {
    requireRole(user, ["admin"]);
    return paymentsResource(user);
  }
  if (resource === "admin-plans") {
    requireRole(user, ["admin"]);
    return plansResource(user);
  }
  if (resource === "admin-coupons") {
    requireRole(user, ["admin"]);
    await query("alter table public.coupons add column if not exists archived boolean default false");
    return (await query("select * from public.coupons where archived=false order by code")).rows;
  }
  throw appError("Recurso não encontrado.", 404);
}

async function updateProfile(user, body) {
  const fullName = clean(body.fullName);
  const email = clean(body.email).toLowerCase();
  const phone = clean(body.phone);
  const cpf = clean(body.cpf).replace(/\D/g, "");
  const avatarUrl = clean(body.avatarUrl);
  if (fullName.length < 3) throw appError("Informe o nome completo.");
  if (!/^\S+@\S+\.\S+$/.test(email))
    throw appError("Informe um e-mail válido.");
  if (cpf && !/^\d{11}$/.test(cpf)) throw appError("Informe um CPF valido com 11 digitos.");
  const currentProfile = await query(
    "select avatar_url from public.profiles where id=$1",
    [user.id],
  );
  if (!currentProfile.rows[0]) throw appError("Perfil não encontrado.", 404);
  if (
    avatarUrl &&
    avatarUrl !== clean(currentProfile.rows[0].avatar_url) &&
    !isConfiguredCloudinaryUrl(avatarUrl, ["image"])
  )
    throw appError("A foto deve ser enviada pelo upload seguro.");
  return transaction(async (client) => {
    await client.query("alter table public.profiles add column if not exists cpf text").catch(() => null);
    try {
      await client.query(
        "update auth.users set email=$1,phone=$2,updated_at=now() where id=$3",
        [email, phone || null, user.id],
      );
    } catch (authError) {
      console.warn("Direct auth.users update skipped:", authError.message);
    }
    const { rows } = await client.query(
      `update public.profiles set full_name=$1,phone=$2,birth_date=$3,instagram=$4,address=$5,avatar_url=coalesce($6,avatar_url),cpf=$7,updated_at=now() where id=$8 returning *`,
      [
        fullName,
        phone || null,
        body.birthDate || null,
        clean(body.instagram) || null,
        JSON.stringify(body.address || {}),
        avatarUrl || null,
        cpf || null,
        user.id,
      ],
    );
    if (!rows[0]) throw appError("Perfil não encontrado.", 404);
    if (user.role === "client") {
      const clientProfile = await client.query(
        "update public.clients set cpf=$1,preferences=$2,personal_notes=$3 where profile_id=$4",
        [
          cpf || null,
          JSON.stringify(body.preferences || {}),
          clean(body.personalNotes) || null,
          user.id,
        ],
      );
      if (!clientProfile.rowCount)
        throw appError("Perfil de cliente não encontrado.", 404);
    }
    if (user.role === "professional") {
      const professionalProfile = await client.query(
        "update public.professionals set bio=$1,specialties=$2 where profile_id=$3",
        [
          clean(body.bio) || null,
          Array.isArray(body.specialties)
            ? body.specialties.map(clean).filter(Boolean)
            : [],
          user.id,
        ],
      );
      if (!professionalProfile.rowCount)
        throw appError("Perfil profissional não encontrado.", 404);
    }
    await client.query(
      `insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_data)
       values($1::uuid,'update','profile',$2::text,$3::jsonb)`,
      [user.id, user.id, JSON.stringify({ fullName, phone, email })],
    );
    return rows[0];
  });
}

async function planCoupon(client, code, clientId, plan) {
  if (!clean(code))
    return { coupon: null, discount: 0, total: Number(plan.price) };
  const { rows } = await client.query(
    `select c.*,(select count(*)::int from public.coupon_usage u where u.coupon_id=c.id and u.status='used') as total_uses,(select count(*)::int from public.coupon_usage u where u.coupon_id=c.id and u.client_id=$2 and u.status='used') as client_uses from public.coupons c where upper(c.code)=upper($1) and c.active and not c.archived limit 1`,
    [clean(code), clientId],
  );
  const coupon = rows[0];
  if (!coupon) throw appError("Cupom inválido ou inativo.");
  const now = Date.now();
  if (coupon.starts_at && new Date(coupon.starts_at).getTime() > now)
    throw appError("Este cupom ainda não está disponível.");
  if (coupon.ends_at && new Date(coupon.ends_at).getTime() < now)
    throw appError("Este cupom expirou.");
  if (
    coupon.usage_limit &&
    Number(coupon.total_uses) >= Number(coupon.usage_limit)
  )
    throw appError("O limite de uso deste cupom foi atingido.");
  const target =
    coupon.target && typeof coupon.target === "object" ? coupon.target : {};
  const planIds = target.plan_ids || target.plans || [];
  const clientIds = target.client_ids || target.clients || [];
  if (Array.isArray(planIds) && planIds.length && !planIds.includes(plan.id))
    throw appError("Este cupom não se aplica ao plano escolhido.");
  if (
    Array.isArray(clientIds) &&
    clientIds.length &&
    !clientIds.includes(clientId)
  )
    throw appError("Este cupom não está disponível para sua conta.");
  if (target.once_per_client && Number(coupon.client_uses) > 0)
    throw appError("Este cupom já foi utilizado pela sua conta.");
  const amount = Number(plan.price);
  const discount =
    coupon.discount_type === "percentage"
      ? Math.min(amount, (amount * Number(coupon.discount_value || 0)) / 100)
      : Math.min(amount, Number(coupon.discount_value || 0));
  return {
    coupon,
    discount: Number(discount.toFixed(2)),
    total: Number((amount - discount).toFixed(2)),
  };
}

async function requestSubscription(user, body) {
  requireRole(user, ["client"]);
  const clientId = await clientIdFor(user);
  const planId = validUuid(body.planId, "Plano");
  const method = clean(body.method).toLowerCase();
  if (!["pix", "card", "local"].includes(method))
    throw appError("Forma de pagamento inválida.");
  return transaction(async (client) => {
    const { rows: plans } = await client.query(
      "select id,name,price,benefits from public.plans where id=$1 and active for share",
      [planId],
    );
    if (!plans[0]) throw appError("Plano indisponível.", 404);
    const coupon = await planCoupon(
      client,
      body.couponCode,
      clientId,
      plans[0],
    );
    const quote = await client.query(
      `insert into public.quotes(client_id,plan_id,status,subtotal,discount_amount,total,coupon_id,created_by,expires_at) values($1,$2,'requested',$3,$4,$5,$6,$7,now()+interval '7 days') returning *`,
      [
        clientId,
        planId,
        plans[0].price,
        coupon.discount,
        coupon.total,
        coupon.coupon?.id || null,
        user.id,
      ],
    );
    await client.query(
      `insert into public.quote_items(quote_id,description,quantity,unit_price,total) values($1,$2,1,$3,$3)`,
      [quote.rows[0].id, `Plano ${plans[0].name}`, plans[0].price],
    );
    const { rows: subscriptions } = await client.query(
      `insert into public.subscriptions(client_id,plan_id,quote_id,status,payment_method,remaining_maintenances) values($1,$2,$3,'awaiting_payment',$4,0) returning *`,
      [clientId, planId, quote.rows[0].id, method],
    );
    const provider =
      method === "card" ? "sumup" : method === "local" ? "local" : "pix_manual";
    const { rows: payments } = await client.query(
      `insert into public.payments(client_id,subscription_id,quote_id,amount,original_amount,discount_amount,coupon_id,method,payment_method,provider,status) values($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,'pending') returning *`,
      [
        clientId,
        subscriptions[0].id,
        quote.rows[0].id,
        coupon.total,
        plans[0].price,
        coupon.discount,
        coupon.coupon?.id || null,
        method,
        provider,
      ],
    );
    const data = JSON.stringify({
      subscription_id: subscriptions[0].id,
      payment_id: payments[0].id,
      quote_id: quote.rows[0].id,
    });
    await client.query(
      `insert into public.notifications(profile_id,kind,title,body,data,action_url,metadata) values($1,'plan_payment_pending','Plano aguardando pagamento',$2,$3,$4,$3)`,
      [
        user.id,
        `Sua solicitação do plano ${plans[0].name} foi criada.`,
        data,
        `/cliente/pagamentos/${payments[0].id}`,
      ],
    );
    return {
      subscription: subscriptions[0],
      payment: payments[0],
      quote: quote.rows[0],
      plan: plans[0],
    };
  });
}

async function saveCard(user, body) {
  requireRole(user, ["client"]);
  void body;
  throw appError(
    "Cartões só podem ser adicionados pelo fluxo seguro da SumUp.",
    409,
  );
}

async function updateCard(user, body) {
  requireRole(user, ["client"]);
  const clientId = await clientIdFor(user);
  const id = validUuid(body.id, "Cartão");
  const selected = await query(
    `select sc.id,sc.is_default,sc.external_token,sc.provider_customer_id,c.sumup_customer_id
     from public.saved_cards sc join public.clients c on c.id=sc.client_id
     where sc.id=$1 and sc.client_id=$2 and sc.active and sc.provider='sumup' and sc.external_token is not null`,
    [id, clientId],
  );
  const card = selected.rows[0];
  if (!card) throw appError("Cartão não encontrado.", 404);
  if (body.action === "remove" && card.external_token) {
    const customerId = card.provider_customer_id || card.sumup_customer_id;
    if (!customerId)
      throw appError("Cartão sem vínculo de cliente na SumUp.", 409);
    try {
      await deactivateSumupPaymentInstrument(customerId, card.external_token);
    } catch (error) {
      if (error.providerStatus !== 404) throw error;
    }
  }
  return transaction(async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [
      clientId,
    ]);
    if (body.action === "default") {
      await client.query(
        "update public.saved_cards set is_default=false,updated_at=now() where client_id=$1 and active",
        [clientId],
      );
      const { rows } = await client.query(
        "update public.saved_cards set is_default=true,updated_at=now() where id=$1 and client_id=$2 and active and provider='sumup' returning id",
        [id, clientId],
      );
      if (!rows[0]) throw appError("Cartão não encontrado.", 404);
    } else if (body.action === "remove") {
      await client.query(
        `update public.subscriptions set auto_renew=false,recurring_card_id=null,
         recurring_consent_revoked_at=case when auto_renew then now() else recurring_consent_revoked_at end,
         next_retry_at=null,updated_at=now() where client_id=$1 and recurring_card_id=$2`,
        [clientId, id],
      );
      const { rows } = await client.query(
        "update public.saved_cards set active=false,is_default=false,external_token=null,updated_at=now() where id=$1 and client_id=$2 and active returning id,is_default",
        [id, clientId],
      );
      if (!rows[0]) throw appError("Cartão não encontrado.", 404);
      if (card.is_default)
        await client.query(
          `update public.saved_cards set is_default=true,updated_at=now()
           where id=(select id from public.saved_cards where client_id=$1 and active and provider='sumup'
           and external_token is not null order by created_at desc limit 1)`,
          [clientId],
        );
    } else throw appError("Ação inválida.");
    await client.query(
      `insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_data)
       values($1,$2,'saved_card',$3,$4)`,
      [
        user.id,
        body.action === "remove" ? "card_deactivated" : "card_defaulted",
        id,
        JSON.stringify({ provider: "sumup" }),
      ],
    );
    return { ok: true };
  });
}

async function updateSubscriptionRecurring(user, body) {
  requireRole(user, ["client"]);
  if (typeof body.enabled !== "boolean")
    throw appError("Informe se deseja ativar ou desativar a renovação.");
  const clientId = await clientIdFor(user);
  const subscriptionId = validUuid(body.subscriptionId, "Assinatura");
  const cardId = body.cardId ? validUuid(body.cardId, "Cartão") : null;
  return transaction(async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [
      `subscription-consent:${subscriptionId}`,
    ]);
    const selected = await client.query(
      `select id,status,auto_renew,recurring_card_id from public.subscriptions
       where id=$1 and client_id=$2 for update`,
      [subscriptionId, clientId],
    );
    const subscription = selected.rows[0];
    if (!subscription) throw appError("Assinatura não encontrada.", 404);
    if (body.enabled && subscription.status !== "active")
      throw appError("A renovação só pode ser ativada em um plano ativo.", 409);
    let selectedCard = null;
    if (body.enabled) {
      const params = [clientId];
      let filter = "sc.is_default";
      if (cardId) {
        params.push(cardId);
        filter = "sc.id=$2";
      }
      const card = await client.query(
        `select sc.id,sc.last_four,coalesce(sc.provider_customer_id,c.sumup_customer_id) as customer_id
         from public.saved_cards sc join public.clients c on c.id=sc.client_id
         where sc.client_id=$1 and ${filter} and sc.active and sc.provider='sumup'
           and sc.external_token is not null order by sc.created_at desc limit 1`,
        params,
      );
      selectedCard = card.rows[0];
      if (!selectedCard?.customer_id)
        throw appError("Adicione um cartão tokenizado e defina-o como principal.", 409);
    }
    const updated = await client.query(
      `update public.subscriptions set auto_renew=$3,recurring_card_id=$4,
       recurring_consent_at=case when $3 then now() else recurring_consent_at end,
       recurring_consent_revoked_at=case when $3 then null else now() end,
       recurring_consent_version=case when $3 then '1.0' else recurring_consent_version end,
       renewal_failures=case when $3 then 0 else renewal_failures end,
       next_retry_at=null,updated_at=now() where id=$1 and client_id=$2
       returning id,auto_renew,recurring_card_id,recurring_consent_at,recurring_consent_revoked_at`,
      [subscriptionId, clientId, body.enabled, selectedCard?.id || null],
    );
    await client.query(
      `insert into public.consent_logs(profile_id,consent_type,granted,policy_version,source)
       values($1,'recurring_billing',$2,'1.0','client_portal')`,
      [user.id, body.enabled],
    );
    await client.query(
      `insert into public.audit_logs(actor_id,action,entity_type,entity_id,previous_data,new_data)
       values($1,$2,'subscription',$3,$4,$5)`,
      [
        user.id,
        body.enabled ? "recurring_consent_granted" : "recurring_consent_revoked",
        subscriptionId,
        JSON.stringify({
          autoRenew: subscription.auto_renew,
          recurringCardId: subscription.recurring_card_id,
        }),
        JSON.stringify({
          autoRenew: body.enabled,
          recurringCardId: selectedCard?.id || null,
        }),
      ],
    );
    return {
      ...updated.rows[0],
      recurring_card_last_four: selectedCard?.last_four || null,
    };
  });
}

async function updatePreferences(user, body) {
  const values = ["inApp", "whatsapp", "email", "reminders", "promotions"];
  for (const key of values)
    if (typeof body[key] !== "boolean")
      throw appError("Preferências inválidas.");
  const { rows } = await query(
    `insert into public.notification_preferences(profile_id,in_app,whatsapp,email,reminders,promotions,updated_at) values($1,$2,$3,$4,$5,$6,now()) on conflict(profile_id) do update set in_app=excluded.in_app,whatsapp=excluded.whatsapp,email=excluded.email,reminders=excluded.reminders,promotions=excluded.promotions,updated_at=now() returning *`,
    [
      user.id,
      body.inApp,
      body.whatsapp,
      body.email,
      body.reminders,
      body.promotions,
    ],
  );
  return rows[0];
}

async function updateConsent(user, body) {
  requireRole(user, ["client"]);
  const type = clean(body.consentType);
  if (
    !["marketing", "whatsapp", "email", "photos", "referrals"].includes(type) ||
    typeof body.accepted !== "boolean"
  )
    throw appError("Consentimento inválido.");
  const { rows } = await query(
    `insert into public.privacy_consents(profile_id,consent_type,accepted,accepted_at,revoked_at,policy_version) values($1,$2,$3,case when $3 then now() end,case when not $3 then now() end,'1.0') on conflict(profile_id,consent_type) do update set accepted=excluded.accepted,accepted_at=case when excluded.accepted then now() else privacy_consents.accepted_at end,revoked_at=case when not excluded.accepted then now() end returning *`,
    [user.id, type, body.accepted],
  );
  await query(
    `insert into public.consent_logs(profile_id,consent_type,granted,policy_version,source) values($1,$2,$3,'1.0','client_portal')`,
    [user.id, type, body.accepted],
  );
  return rows[0];
}

export async function collectClientDataExport(client, { profileId, clientId }) {
  const [
    account,
    appointments,
    reschedules,
    messages,
    technicalRecords,
    photos,
    payments,
    receipts,
    subscriptions,
    quotes,
    loyalty,
    coupons,
    referrals,
    rewards,
    reviews,
    notifications,
    cards,
    tokenizationSessions,
    consents,
    consentHistory,
    internalNotes,
    exportRequests,
    deletionRequests,
  ] = await Promise.all([
    client.query(
      `select p.id,p.role,p.full_name,p.phone,p.avatar_url,p.birth_date,p.instagram,p.address,p.account_status,p.created_at,p.updated_at,
       u.email,u.email_confirmed_at,u.created_at as account_created_at,
       c.id as client_id,c.cpf,c.source,c.preferences,c.technical_notes,c.personal_notes,c.lifetime_value,c.sumup_customer_id,c.created_at as client_created_at
       from public.profiles p join auth.users u on u.id=p.id join public.clients c on c.profile_id=p.id
       where p.id=$1 and c.id=$2`,
      [profileId, clientId],
    ),
    client.query(
      `select id,booking_code,professional_id,service_id,location_id,starts_at,ends_at,status,notes,estimated_value,
       original_value,discount_amount,intake_data,cancellation_reason,created_at,updated_at
       from public.appointments where client_id=$1 order by starts_at desc`,
      [clientId],
    ),
    client.query(
      `select rr.* from public.reschedule_requests rr join public.appointments a on a.id=rr.appointment_id
       where a.client_id=$1 order by rr.created_at desc`,
      [clientId],
    ),
    client.query(
      `select m.id,m.appointment_id,m.sender_profile_id,m.message,m.message_type,m.visible_to_client,m.created_at
       from public.appointment_messages m join public.appointments a on a.id=m.appointment_id
       where a.client_id=$1 order by m.created_at`,
      [clientId],
    ),
    client.query(
      `select id,appointment_id,professional_id,hair_method_id,strands_count,weight_grams,color,shade,length_cm,texture,
       hair_lot,products_used,recommendations,internal_notes,next_maintenance_date,final_value,payment_status,created_at
       from public.technical_records where client_id=$1 order by created_at desc`,
      [clientId],
    ),
    client.query(
      "select id,appointment_id,kind,storage_path,created_at from public.client_photos where client_id=$1 order by created_at desc",
      [clientId],
    ),
    client.query(
      `select id,appointment_id,subscription_id,quote_id,amount,original_amount,discount_amount,paid_amount,method,payment_method,
       provider,status,provider_status,installments,paid_at,created_at,updated_at
       from public.payments where client_id=$1 order by created_at desc`,
      [clientId],
    ),
    client.query(
      `select pr.id,pr.payment_id,pr.storage_url,pr.status,pr.reviewed_at,pr.rejection_reason,pr.created_at
       from public.payment_receipts pr join public.payments p on p.id=pr.payment_id
       where p.client_id=$1 order by pr.created_at desc`,
      [clientId],
    ),
    client.query(
      `select id,plan_id,quote_id,status,starts_at,renews_at,expires_at,cancelled_at,activated_at,
       remaining_maintenances,payment_method,created_at,updated_at
       from public.subscriptions where client_id=$1 order by created_at desc`,
      [clientId],
    ),
    client.query(
      `select q.id,q.appointment_id,q.plan_id,q.status,q.intake_data,q.subtotal,q.discount_amount,q.total,q.notes,q.expires_at,q.created_at,q.updated_at,
       coalesce(json_agg(json_build_object('description',qi.description,'quantity',qi.quantity,'unit_price',qi.unit_price,'total',qi.total)) filter(where qi.id is not null),'[]') as items
       from public.quotes q left join public.quote_items qi on qi.quote_id=q.id
       where q.client_id=$1 group by q.id order by q.created_at desc`,
      [clientId],
    ),
    client.query(
      "select id,points,reason,expires_at,created_at from public.loyalty_points where client_id=$1 order by created_at desc",
      [clientId],
    ),
    client.query(
      `select c.code,c.description,u.used_at,u.discount_amount,u.status
       from public.coupon_usage u join public.coupons c on c.id=u.coupon_id
       where u.client_id=$1 order by u.used_at desc`,
      [clientId],
    ),
    client.query(
      `select id,referrer_client_id,referred_client_id,code,status,reward_amount,invited_name,invited_phone,created_at
       from public.referrals where referrer_client_id=$1 or referred_client_id=$1 order by created_at desc`,
      [clientId],
    ),
    client.query(
      "select id,referral_id,kind,points,amount,status,granted_at from public.referral_rewards where client_id=$1 order by granted_at desc nulls last",
      [clientId],
    ),
    client.query(
      "select id,appointment_id,professional_id,rating,comment,published,created_at from public.reviews where client_id=$1 order by created_at desc",
      [clientId],
    ),
    client.query(
      "select id,kind,title,body,data,action_url,read_at,scheduled_at,created_at from public.notifications where profile_id=$1 order by created_at desc",
      [profileId],
    ),
    client.query(
      "select id,brand,last_four,holder_name,active,is_default,created_at from public.saved_cards where client_id=$1 order by created_at desc",
      [clientId],
    ),
    client.query(
      `select id,checkout_reference,status,expires_at,completed_at,created_at
       from public.card_tokenization_sessions where client_id=$1 order by created_at desc`,
      [clientId],
    ),
    client.query(
      "select consent_type,accepted,accepted_at,revoked_at,policy_version,created_at from public.privacy_consents where profile_id=$1 order by consent_type",
      [profileId],
    ),
    client.query(
      "select consent_type,granted,policy_version,source,created_at from public.consent_logs where profile_id=$1 order by created_at desc",
      [profileId],
    ),
    client.query(
      "select id,note,author_id,created_at from public.client_internal_notes where client_id=$1 order by created_at desc",
      [clientId],
    ),
    client.query(
      "select id,status,requested_at,completed_at from public.data_export_requests where profile_id=$1 order by requested_at desc",
      [profileId],
    ),
    client.query(
      "select id,status,reason,requested_at,reviewed_at,reviewed_by from public.account_deletion_requests where profile_id=$1 order by requested_at desc",
      [profileId],
    ),
  ]);
  return {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    account: account.rows[0] || null,
    appointments: appointments.rows,
    rescheduleRequests: reschedules.rows,
    appointmentMessages: messages.rows,
    technicalRecords: technicalRecords.rows,
    photos: photos.rows,
    payments: payments.rows,
    paymentReceipts: receipts.rows,
    subscriptions: subscriptions.rows,
    quotes: quotes.rows,
    loyaltyPoints: loyalty.rows,
    couponUsage: coupons.rows,
    referrals: referrals.rows,
    referralRewards: rewards.rows,
    reviews: reviews.rows,
    notifications: notifications.rows,
    savedCards: cards.rows,
    cardTokenizationSessions: tokenizationSessions.rows,
    privacyConsents: consents.rows,
    consentHistory: consentHistory.rows,
    internalNotes: internalNotes.rows,
    exportRequests: exportRequests.rows,
    deletionRequests: deletionRequests.rows,
  };
}

async function exportData(user) {
  requireRole(user, ["client"]);
  const clientId = await clientIdFor(user);
  const request = await query(
    `insert into public.data_export_requests(profile_id,status)
     values($1,'pending') returning id,status,requested_at,completed_at`,
    [user.id],
  );
  const requestId = request.rows[0].id;
  try {
    return await transaction(async (client) => {
      await client.query(
        "update public.data_export_requests set status='processing' where id=$1 and profile_id=$2",
        [requestId, user.id],
      );
      const exported = await collectClientDataExport(client, {
        profileId: user.id,
        clientId,
      });
      const serialized = JSON.stringify(exported);
      const sha256 = createHash("sha256").update(serialized).digest("hex");
      const completed = await client.query(
        `update public.data_export_requests set status='completed',completed_at=now()
         where id=$1 and profile_id=$2 and status='processing'
         returning id,status,requested_at,completed_at`,
        [requestId, user.id],
      );
      if (!completed.rows[0])
        throw appError("Não foi possível concluir a exportação.");
      await client.query(
        `insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_data)
         values($1,'data_export_completed','data_export_request',$2,$3)`,
        [
          user.id,
          requestId,
          JSON.stringify({ sha256, schema_version: exported.schemaVersion }),
        ],
      );
      return { request: completed.rows[0], export: exported, sha256 };
    });
  } catch (error) {
    await Promise.allSettled([
      query(
        "update public.data_export_requests set status='failed' where id=$1 and profile_id=$2 and status<>'completed'",
        [requestId, user.id],
      ),
      query(
        `insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_data)
         values($1,'data_export_failed','data_export_request',$2,$3)`,
        [
          user.id,
          requestId,
          JSON.stringify({ error: String(error?.message || "unknown").slice(0, 300) }),
        ],
      ),
    ]).then((results) => {
      for (const result of results)
        if (result.status === "rejected")
          console.error("Data export failure audit error", result.reason);
    });
    throw error;
  }
}

async function requestDeletion(user, body) {
  requireRole(user, ["client"]);
  return transaction(async (client) => {
    await client.query("select id from public.profiles where id=$1 for update", [
      user.id,
    ]);
    const existing = await client.query(
      `select id from public.account_deletion_requests where profile_id=$1 and status in ('requested','under_review')`,
      [user.id],
    );
    if (existing.rowCount)
      throw appError("Já existe uma solicitação de exclusão em análise.", 409);
    const { rows } = await client.query(
      `insert into public.account_deletion_requests(profile_id,reason) values($1,$2) returning *`,
      [user.id, clean(body.reason) || null],
    );
    const updated = await client.query(
      `update public.profiles set account_status='deletion_requested',updated_at=now() where id=$1`,
      [user.id],
    );
    if (!updated.rowCount) throw appError("Perfil não encontrado.", 404);
    await client.query(
      `insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_data)
       values($1,'account_deletion_requested','account_deletion_request',$2,$3)`,
      [user.id, rows[0].id, JSON.stringify({ reason: clean(body.reason) || null })],
    );
    return rows[0];
  });
}

export async function deleteClientAccount(client, { requestId, adminId }) {
  const locked = await client.query(
    `select dr.id,dr.profile_id,c.id as client_id,c.sumup_customer_id
     from public.account_deletion_requests dr
     join public.profiles p on p.id=dr.profile_id
     join public.clients c on c.profile_id=p.id
     where dr.id=$1 and dr.status in ('requested','under_review')
     for update of dr,p,c`,
    [requestId],
  );
  const target = locked.rows[0];
  if (!target) throw appError("Solicitação de exclusão não encontrada.", 404);

  await client.query(
    "update public.account_deletion_requests set status='under_review',reviewed_at=now(),reviewed_by=$2 where id=$1",
    [requestId, adminId],
  );
  const [photos, gallery, cards] = await Promise.all([
    client.query(
      "select storage_path from public.client_photos where client_id=$1",
      [target.client_id],
    ),
    client.query(
      "select before_photo_path,after_photo_path from public.before_after_gallery where client_id=$1",
      [target.client_id],
    ),
    client.query(
      `select coalesce(provider_customer_id,$2) as customer_id,external_token
       from public.saved_cards where client_id=$1 and provider='sumup' and external_token is not null`,
      [target.client_id, target.sumup_customer_id],
    ),
  ]);
  const mediaUrls = [
    ...photos.rows.map((item) => item.storage_path),
    ...gallery.rows.flatMap((item) => [
      item.before_photo_path,
      item.after_photo_path,
    ]),
  ].filter(Boolean);
  const cardInstruments = cards.rows
    .filter((item) => item.customer_id && item.external_token)
    .map((item) => ({
      customerId: item.customer_id,
      token: item.external_token,
    }));

  const clientId = target.client_id;
  const profileId = target.profile_id;

  // 1. Delete WhatsApp conversation sub-entities
  await client.query(
    `delete from public.conversation_tag_links where conversation_id in (select id from public.whatsapp_conversations where client_id = $1::uuid)`,
    [clientId]
  );
  await client.query(
    `delete from public.human_handoff_tickets where conversation_id in (select id from public.whatsapp_conversations where client_id = $1::uuid)`,
    [clientId]
  );
  await client.query(
    `delete from public.ai_request_logs where conversation_id in (select id from public.whatsapp_conversations where client_id = $1::uuid)`,
    [clientId]
  );
  await client.query(
    `delete from public.ai_tool_calls where conversation_id in (select id from public.whatsapp_conversations where client_id = $1::uuid)`,
    [clientId]
  );
  await client.query(
    `delete from public.ai_interactions where conversation_id in (select id from public.whatsapp_conversations where client_id = $1::uuid)`,
    [clientId]
  );
  await client.query(
    `delete from public.whatsapp_message_logs where conversation_id in (select id from public.whatsapp_conversations where client_id = $1::uuid)`,
    [clientId]
  );
  await client.query(
    `delete from public.whatsapp_messages where conversation_id in (select id from public.whatsapp_conversations where client_id = $1::uuid)`,
    [clientId]
  );
  await client.query(
    `delete from public.whatsapp_conversations where client_id = $1::uuid`,
    [clientId]
  );

  // 2. Delete photos and galleries
  await client.query(
    `delete from public.client_photos where client_id = $1::uuid`,
    [clientId]
  );
  await client.query(
    `delete from public.before_after_gallery where client_id = $1::uuid`,
    [clientId]
  );

  // 3. Delete client internal notes
  await client.query(
    `delete from public.client_internal_notes where client_id = $1::uuid`,
    [clientId]
  );

  // 4. Delete profile consents and logs
  await client.query(
    `delete from public.privacy_consents where profile_id = $1::uuid`,
    [profileId]
  );
  await client.query(
    `delete from public.data_export_requests where profile_id = $1::uuid`,
    [profileId]
  );
  await client.query(
    `delete from public.notifications where profile_id = $1::uuid`,
    [profileId]
  );
  await client.query(
    `delete from public.notification_preferences where profile_id = $1::uuid`,
    [profileId]
  );
  await client.query(
    `delete from public.consent_logs where profile_id = $1::uuid`,
    [profileId]
  );
  await client.query(
    `delete from public.audit_logs where actor_id = $1::uuid`,
    [profileId]
  );

  // 5. Delete loyalty points, waitlist, referral details
  await client.query(
    `delete from public.loyalty_points where client_id = $1::uuid`,
    [clientId]
  );
  await client.query(
    `delete from public.waitlist where client_id = $1::uuid`,
    [clientId]
  );
  await client.query(
    `delete from public.referral_rewards where client_id = $1::uuid`,
    [clientId]
  );
  await client.query(
    `delete from public.referrals where referrer_client_id = $1::uuid or referred_client_id = $1::uuid`,
    [clientId]
  );

  // 6. Decouple inventory movements from technical records, then delete technical records
  await client.query(
    `update public.inventory_movements set technical_record_id = null where technical_record_id in (select id from public.technical_records where client_id = $1::uuid)`,
    [clientId]
  );
  await client.query(
    `delete from public.technical_records where client_id = $1::uuid`,
    [clientId]
  );

  // 7. Delete reviews
  await client.query(
    `delete from public.reviews where client_id = $1::uuid`,
    [clientId]
  );

  // 8. Delete commissions, product sales, coupon usage, saved cards, subscriptions, renewal attempts
  await client.query(
    `delete from public.commissions where appointment_id in (select id from public.appointments where client_id = $1::uuid) or product_sale_id in (select id from public.product_sales where client_id = $1::uuid)`,
    [clientId]
  );
  await client.query(
    `delete from public.product_sales where client_id = $1::uuid`,
    [clientId]
  );
  await client.query(
    `delete from public.coupon_usage where client_id = $1::uuid`,
    [clientId]
  );
  await client.query(
    `delete from public.card_tokenization_sessions where client_id = $1::uuid`,
    [clientId]
  );
  await client.query(
    `delete from public.saved_cards where client_id = $1::uuid`,
    [clientId]
  );
  await client.query(
    `delete from public.subscription_renewal_attempts where client_id = $1::uuid`,
    [clientId]
  );
  await client.query(
    `delete from public.subscriptions where client_id = $1::uuid`,
    [clientId]
  );

  // 9. Delete appointments sub-entities (reschedule_requests, appointment_messages, appointment_status_history)
  await client.query(
    `delete from public.reschedule_requests where appointment_id in (select id from public.appointments where client_id = $1::uuid)`,
    [clientId]
  );
  await client.query(
    `delete from public.appointment_messages where appointment_id in (select id from public.appointments where client_id = $1::uuid)`,
    [clientId]
  );
  await client.query(
    `delete from public.appointment_status_history where appointment_id in (select id from public.appointments where client_id = $1::uuid)`,
    [clientId]
  );

  // 10. Delete quotes, payments, and appointments
  await client.query(
    `delete from public.quotes where client_id = $1::uuid`,
    [clientId]
  );
  await client.query(
    `delete from public.payments where client_id = $1::uuid`,
    [clientId]
  );
  await client.query(
    `delete from public.appointments where client_id = $1::uuid`,
    [clientId]
  );

  // 11. Delete the deletion request itself
  await client.query(
    `delete from public.account_deletion_requests where profile_id = $1::uuid`,
    [profileId]
  );

  // 12. Delete from auth.users (which cascades to public.profiles and public.clients)
  await client.query(
    `delete from auth.users where id = $1::uuid`,
    [profileId]
  );

  // 13. Create a completed request mock structure to return
  const requestMock = {
    id: requestId,
    profile_id: profileId,
    status: "completed",
    reviewed_at: new Date(),
    reviewed_by: adminId,
  };

  await client.query(
    `insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_data)
     values($1,'account_deleted','account_deletion_request',$2,$3)`,
    [
      adminId,
      requestId,
      JSON.stringify({
        profile_id: profileId,
        client_id: clientId,
        removed_media: mediaUrls.length,
        financial_records_deleted: true,
      }),
    ],
  );

  return { request: requestMock, mediaUrls, cardInstruments };
}

async function reviewDeletion(user, body) {
  requireRole(user, ["admin"]);
  const requestId = validUuid(body.requestId, "Solicitação");
  const action = clean(body.action);
  if (!['approve', 'reject'].includes(action))
    throw appError("Ação de exclusão inválida.");
  if (action === "reject")
    return transaction(async (client) => {
      const rejected = await client.query(
        `update public.account_deletion_requests
         set status='rejected',reviewed_at=now(),reviewed_by=$2
         where id=$1 and status in ('requested','under_review')
         returning id,profile_id,status,reviewed_at`,
        [requestId, user.id],
      );
      if (!rejected.rows[0])
        throw appError("Solicitação de exclusão não encontrada.", 404);
      await client.query(
        `update public.profiles set account_status='active',updated_at=now()
         where id=$1 and account_status='deletion_requested'`,
        [rejected.rows[0].profile_id],
      );
      await client.query(
        `insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_data)
         values($1,'account_deletion_rejected','account_deletion_request',$2,$3)`,
        [user.id, requestId, JSON.stringify({ reason: clean(body.reason) || null })],
      );
      return { request: rejected.rows[0], cleanup: { attempted: 0, failed: 0 } };
    });

  const result = await transaction((client) =>
    deleteClientAccount(client, { requestId, adminId: user.id }),
  );
  const cleanup = await Promise.allSettled(
    [...new Set(result.mediaUrls)].map((url) => deleteFromCloudinary(url)),
  );
  const cardCleanup = await Promise.allSettled(
    result.cardInstruments.map(({ customerId, token }) =>
      deactivateSumupPaymentInstrument(customerId, token).catch((error) => {
        if (error.providerStatus === 404) return { alreadyRemoved: true };
        throw error;
      }),
    ),
  );
  const mediaFailed = cleanup.filter(
    (item) =>
      item.status === "rejected" ||
      (item.status === "fulfilled" && item.value?.success !== true),
  ).length;
  const cardFailed = cardCleanup.filter(
    (item) => item.status === "rejected",
  ).length;
  const failed = mediaFailed + cardFailed;
  if (failed)
    console.error("Account media cleanup incomplete", {
      requestId,
      attempted: cleanup.length,
      failed,
      mediaFailed,
      cardFailed,
    });
  return {
    request: result.request,
    cleanup: {
      attempted: cleanup.length + cardCleanup.length,
      failed,
      mediaFailed,
      cardFailed,
    },
  };
}

async function removeAdminClient(user, body) {
  requireRole(user, ["admin"]);
  const clientId = validUuid(body.clientId || body.id, "Cliente");
  const reason = clean(body.reason) || "Remoção manual pelo painel administrativo";
  const result = await transaction(async (client) => {
    const target = await client.query(
      `select c.id as client_id,p.id as profile_id,p.account_status
       from public.clients c
       join public.profiles p on p.id=c.profile_id
       where c.id=$1
       limit 1`,
      [clientId],
    );
    if (!target.rows[0]) throw appError("Cliente não encontrada.", 404);
    if (["anonymized", "deleted"].includes(target.rows[0].account_status))
      throw appError("Esta cliente já foi removida.", 409);

    const existing = await client.query(
      `select id from public.account_deletion_requests
       where profile_id=$1 and status in ('requested','under_review')
       order by requested_at desc limit 1`,
      [target.rows[0].profile_id],
    );
    const requestId =
      existing.rows[0]?.id ||
      (
        await client.query(
          `insert into public.account_deletion_requests(profile_id,reason)
           values($1,$2) returning id`,
          [target.rows[0].profile_id, reason],
        )
      ).rows[0].id;
    await client.query(
      `update public.profiles set account_status='deletion_requested',updated_at=now()
       where id=$1 and account_status <> 'anonymized'`,
      [target.rows[0].profile_id],
    );
    await client.query(
      `insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_data)
       values($1,'admin_client_removal_requested','client',$2,$3)`,
      [user.id, clientId, JSON.stringify({ requestId, reason })],
    );
    return deleteClientAccount(client, { requestId, adminId: user.id });
  });
  const cleanup = await Promise.allSettled(
    [...new Set(result.mediaUrls)].map((url) => deleteFromCloudinary(url)),
  );
  const cardCleanup = await Promise.allSettled(
    result.cardInstruments.map(({ customerId, token }) =>
      deactivateSumupPaymentInstrument(customerId, token).catch((error) => {
        if (error.providerStatus === 404) return { alreadyRemoved: true };
        throw error;
      }),
    ),
  );
  const mediaFailed = cleanup.filter(
    (item) =>
      item.status === "rejected" ||
      (item.status === "fulfilled" && item.value?.success !== true),
  ).length;
  const cardFailed = cardCleanup.filter((item) => item.status === "rejected").length;
  return {
    ok: true,
    request: result.request,
    cleanup: {
      attempted: cleanup.length + cardCleanup.length,
      failed: mediaFailed + cardFailed,
      mediaFailed,
      cardFailed,
    },
  };
}

async function createReferral(user, body) {
  requireRole(user, ["client"]);
  const clientId = await clientIdFor(user);
  const name = clean(body.name);
  const phone = clean(body.phone);
  if (name.length < 3 || phone.replace(/\D/g, "").length < 10)
    throw appError("Informe nome e telefone válidos.");
  const code = `CAROL${user.id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
  const { rows } = await query(
    `insert into public.referrals(referrer_client_id,code,status,invited_name,invited_phone) values($1,$2||'-'||substr(md5(random()::text),1,6),'invited',$3,$4) returning *`,
    [clientId, code, name, phone],
  );
  return rows[0];
}

async function markNotification(user, body) {
  if (body.all) {
    const { rowCount } = await query(
      "update public.notifications set read_at=coalesce(read_at,now()) where profile_id=$1 and read_at is null",
      [user.id],
    );
    return { ok: true, updated: rowCount };
  }
  const id = validUuid(body.id, "Notificação");
  const { rows } = await query(
    "update public.notifications set read_at=coalesce(read_at,now()) where id=$1 and profile_id=$2 returning id",
    [id, user.id],
  );
  if (!rows[0]) throw appError("Notificação não encontrada.", 404);
  return { ok: true };
}

async function updateManualPayment(user, body) {
  requireRole(user, ["admin"]);

  await query("alter table public.profiles add column if not exists cpf text").catch(() => null);

  if (!body.id) {
    const clientId = validUuid(body.clientId, "Cliente");
    const amount = body.amount != null ? Number(body.amount) : 0;
    const paidAmount = body.paidAmount != null ? Number(body.paidAmount) : 0;
    const method = clean(body.method) || "money";
    const status = clean(body.status) || "pending";
    const notes = clean(body.notes) || "Cobrança manual criada pela administração";

    if (amount <= 0) throw appError("O valor da cobrança deve ser maior que zero.");

    return transaction(async (client) => {
      const clientCheck = await client.query("select 1 from public.clients where id=$1", [clientId]);
      if (!clientCheck.rowCount) throw appError("Cliente não encontrada.", 404);

      const provider = method === "pix_manual" ? "pix_manual" : "local";
      const actualPaidAmount = status === "paid" ? amount : (status === "partial" ? paidAmount : 0);

      const { rows } = await client.query(
        `insert into public.payments(client_id, amount, paid_amount, method, provider, status, notes)
         values($1, $2, $3, $4, $5, $6, $7) returning *`,
        [clientId, amount, actualPaidAmount, method, provider, status, notes]
      );
      const newPayment = rows[0];

      await client.query(
        `insert into public.payment_status_history(payment_id, old_status, new_status, changed_by, notes)
         values($1, 'none', $2, $3, $4)`,
        [newPayment.id, status, user.id, "Cobrança manual criada"]
      );

      return newPayment;
    });
  }

  const id = validUuid(body.id, "Pagamento");
  const receiptAction = clean(body.receiptAction);
  const requestedStatus = clean(body.status);
  if (
    !receiptAction &&
    ![
      "pending",
      "under_review",
      "paid",
      "partial",
      "cancelled",
      "refunded",
    ].includes(requestedStatus)
  )
    throw appError("Status de pagamento inválido.");
  const result = await transaction(async (client) => {
    const previous = await client.query(
      "select * from public.payments where id=$1 for update",
      [id],
    );
    if (!previous.rows[0]) throw appError("Pagamento não encontrado.", 404);
    const payment = previous.rows[0];
    let status = requestedStatus;
    let receiptUrl = clean(body.receiptUrl) || payment.receipt_url || null;
    let receipt = null;
    let activationContact = null;
    let notes = clean(body.notes) || "Atualização manual pela administração";

    if (receiptAction) {
      const receiptId = validUuid(body.receiptId, "Comprovante");
      const found = await client.query(
        "select * from public.payment_receipts where id=$1 and payment_id=$2 for update",
        [receiptId, id],
      );
      receipt = found.rows[0];
      if (!receipt) throw appError("Comprovante não encontrado.", 404);
      const review = resolveReceiptReview(receipt.status, receiptAction);
      if (review.error) throw appError(review.error, 409);
      if (!review.changed)
        return { payment, contact: null, idempotent: true };
      const rejectionReason = clean(body.rejectionReason);
      if (receiptAction === "reject" && rejectionReason.length < 3)
        throw appError("Informe o motivo da rejeição.");
      status = receiptAction === "approve" ? "paid" : "pending";
      receiptUrl = receiptAction === "approve" ? receipt.storage_url : null;
      notes =
        receiptAction === "approve"
          ? "Comprovante aprovado pela administração"
          : `Comprovante rejeitado: ${rejectionReason}`;
      await client.query(
        `update public.payment_receipts set status=$1,reviewed_by=$2,reviewed_at=now(),rejection_reason=$3 where id=$4`,
        [
          review.status,
          user.id,
          receiptAction === "reject" ? rejectionReason : null,
          receipt.id,
        ],
      );
    } else {
      if (payment.status === status && (body.paidAmount == null || money(body.paidAmount) === Number(payment.paid_amount)))
        return { payment, contact: null, idempotent: true };
      if (payment.status === "paid" && status !== "refunded" && status !== "paid")
        throw appError("Um pagamento confirmado não pode regredir de status.", 409);
      if (status === "paid" && payment.provider === "sumup")
        throw appError("Sincronize este pagamento diretamente com a SumUp.", 409);
      if (status === "paid" && payment.provider === "pix_manual")
        throw appError("Aprove o comprovante antes de confirmar este Pix.", 409);
    }

    const paidAmount =
      status === "paid"
        ? payment.amount
        : body.paidAmount == null
          ? payment.paid_amount
          : money(body.paidAmount);
    const { rows } = await client.query(
      `update public.payments set status=$1,paid_amount=$2,receipt_url=$3,notes=$4,confirmed_by=case when $1='paid' then $5 else confirmed_by end,paid_at=case when $1='paid' then coalesce(paid_at,now()) else paid_at end,updated_at=now() where id=$6 returning *`,
      [
        status,
        paidAmount,
        receiptUrl,
        notes,
        user.id,
        id,
      ],
    );
    await client.query(
      `insert into public.payment_status_history(payment_id,old_status,new_status,changed_by,notes) values($1,$2,$3,$4,$5)`,
      [
        id,
        payment.status,
        status,
        user.id,
        notes,
      ],
    );
    if (status === "paid" && rows[0].appointment_id)
      await client.query(
        `update public.appointments set status='confirmed',updated_at=now() where id=$1 and status in ('awaiting_payment','pending_deposit')`,
        [rows[0].appointment_id],
      );
    if (status === "paid" && rows[0].quote_id)
      await client.query(
        `update public.quotes set status='converted',updated_at=now() where id=$1`,
        [rows[0].quote_id],
      );
    if (status === "paid" && rows[0].coupon_id)
      await client.query(
        `insert into public.coupon_usage(coupon_id,client_id,appointment_id,payment_id,quote_id,discount_amount,status) select $1,$2,$3,$4,$5,$6,'used' where not exists(select 1 from public.coupon_usage where coupon_id=$1 and payment_id=$4 and status='used')`,
        [
          rows[0].coupon_id,
          rows[0].client_id,
          rows[0].appointment_id,
          rows[0].id,
          rows[0].quote_id,
          rows[0].discount_amount || 0,
        ],
      );
    if (rows[0].subscription_id && status === "paid") {
      const subscription = await client.query(
        `update public.subscriptions s set status='active',starts_at=coalesce(starts_at,current_date),activated_at=coalesce(activated_at,now()),renews_at=coalesce(renews_at,current_date+interval '1 month'),expires_at=coalesce(expires_at,current_date+interval '1 month'),remaining_maintenances=coalesce(nullif(remaining_maintenances,0),(select case when p.name='Essencial' then 1 when p.name='Completo' then 2 when p.name='VIP' then 3 else 4 end from public.plans p where p.id=s.plan_id)),updated_at=now() where s.id=$1 returning s.client_id,s.plan_id`,
        [rows[0].subscription_id],
      );
      if (subscription.rows[0]) {
        const contact = await client.query(
          `select p.id,p.full_name,u.email,pl.name from public.clients c join public.profiles p on p.id=c.profile_id join auth.users u on u.id=p.id join public.plans pl on pl.id=$2 where c.id=$1`,
          [subscription.rows[0].client_id, subscription.rows[0].plan_id],
        );
        if (contact.rows[0])
          await client.query(
            `insert into public.notifications(profile_id,kind,title,body,data,action_url,metadata) values($1,'plan_activated','Plano ativado',$2,$3,'/cliente/beneficios',$3)`,
            [
              contact.rows[0].id,
              `Seu plano ${contact.rows[0].name} está ativo.`,
              JSON.stringify({ subscription_id: rows[0].subscription_id }),
            ],
          );
        activationContact = contact.rows[0] || null;
      }
    }
    const profile = await client.query(
      "select profile_id from public.clients where id=$1",
      [rows[0].client_id],
    );
    if (profile.rows[0]) {
      const rejected = receiptAction === "reject";
      const confirmed = status === "paid";
      const notificationData = JSON.stringify({
        payment_id: rows[0].id,
        receipt_id: receipt?.id || null,
        status,
      });
      await client.query(
        `insert into public.notifications(profile_id,kind,title,body,data,action_url,metadata) values($1,$2,$3,$4,$5,$6,$5)`,
        [
          profile.rows[0].profile_id,
          rejected
            ? "payment_receipt_rejected"
            : confirmed
              ? "payment_confirmed"
              : "payment_status",
          rejected
            ? "Comprovante rejeitado"
            : confirmed
              ? "Pagamento confirmado"
              : "Pagamento atualizado",
          rejected
            ? "Revise o motivo e envie um novo comprovante."
            : confirmed
              ? receipt
                ? "Seu comprovante foi aprovado e o pagamento foi confirmado."
                : "Seu pagamento foi confirmado pela administração."
              : `O pagamento está ${status}.`,
          notificationData,
          `/cliente/pagamentos/${id}`,
        ],
      );
    }
    await client.query(
      `insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_data) values($1,'update','payment',$2,$3)`,
      [
        user.id,
        id,
        JSON.stringify({ status, receiptId: receipt?.id || null, receiptAction }),
      ],
    );
    return { payment: rows[0], contact: activationContact };
  });
  if (result.contact?.email)
    await sendEmail({
      to: result.contact.email,
      subject: "Plano Carol Sol ativado",
      html: `<p>Olá, ${result.contact.full_name}. Seu plano foi ativado com sucesso.</p>`,
    }).catch((error) =>
      console.error("Falha ao enviar ativação:", error.message),
    );
  return result.payment;
}

async function logSumupCheckoutAttempt({
  paymentId,
  eventType = "checkout.create",
  checkout = null,
  requestPayload = null,
  responsePayload = null,
  error = null,
}) {
  try {
    await query(
      `insert into public.payment_webhook_logs(provider,event_type,provider_checkout_id,payload,processing_error,processed,processed_at)
       values('sumup',$1,$2,$3,$4,true,now())`,
      [
        eventType,
        checkout?.id || responsePayload?.id || null,
        JSON.stringify({
          payment_id: paymentId || null,
          request: requestPayload || checkout?.requestPayload || error?.requestPayload || null,
          response: responsePayload || checkout?.rawResponse || checkout || error?.providerResponse || null,
          hosted_checkout_url: checkout?.hostedUrl || checkout?.hosted_checkout_url || null,
          transaction_id:
            checkout?.transaction_id ||
            checkout?.transaction_code ||
            responsePayload?.transaction_id ||
            responsePayload?.transaction_code ||
            null,
        }),
        error ? error.message : null,
      ],
    );
  } catch (logError) {
    console.error("Failed to log SumUp checkout attempt:", logError.message);
  }
}

async function createAdminBilling(user, body) {
  requireRole(user, ["admin", "professional"]);
  const clientId = validUuid(body.clientId, "Cliente");
  const amount = Number(body.amount);
  const reason = clean(body.reason);
  const notes = clean(body.notes);

  if (isNaN(amount) || amount <= 0) {
    throw appError("O valor da cobrança deve ser maior que zero.");
  }
  if (!reason) {
    throw appError("O motivo da cobrança é obrigatório.");
  }

  await query("alter table public.payments add column if not exists billing_reason text");

  const clientInfo = await query(
    `select p.full_name, p.phone, u.email
     from public.clients c join public.profiles p on p.id=c.profile_id
     join auth.users u on u.id=p.id
     where c.id=$1`,
    [clientId]
  );
  const client = clientInfo.rows[0];
  if (!client) throw appError("Cliente não encontrada.", 404);

  const result = await transaction(async (db) => {
    const { rows } = await db.query(
      `insert into public.payments(client_id, amount, provider, method, payment_method, status, notes, billing_reason)
       values($1, $2, 'sumup', 'card', 'card', 'pending', $3, $4) returning *`,
      [clientId, amount, notes || `Cobrança - ${reason}`, reason]
    );
    const payment = rows[0];

    const reference = `CAROLSOL-BILL-${payment.id.slice(0, 8).toUpperCase()}-${Date.now()}`;
    const returnUrl = `${sumupConfig().returnUrl}${sumupConfig().returnUrl.includes("?") ? "&" : "?"}payment_id=${encodeURIComponent(payment.id)}`;

    let checkout;
    try {
      checkout = await createSumupCheckout({
        reference,
        amount,
        description: `Cobrança: ${reason}`,
        returnUrl,
        hostedCheckout: true,
      });
      await logSumupCheckoutAttempt({ paymentId: payment.id, checkout });
    } catch (err) {
      await logSumupCheckoutAttempt({ paymentId: payment.id, error: err });
      console.error("SumUp checkout creation failed for admin billing", err);
      throw appError("Não foi possível gerar o link de pagamento neste momento. A equipe foi notificada automaticamente. Tente novamente em alguns minutos.", 502);
    }

    if (!checkout.hostedUrl) {
      await logSumupCheckoutAttempt({
        paymentId: payment.id,
        eventType: "checkout.create.missing_url",
        checkout,
        error: new Error("SumUp response missing hosted checkout URL"),
      });
      throw appError("Não foi possível gerar o link de pagamento neste momento. A equipe foi notificada automaticamente. Tente novamente em alguns minutos.", 502);
    }

    await db.query(
      `update public.payments
       set provider_checkout_id=$2, checkout_reference=$3, hosted_checkout_url=$4, provider_status=$5, provider_transaction_id=coalesce($6,provider_transaction_id), failure_reason=null, status='awaiting_confirmation', updated_at=now()
       where id=$1`,
      [
        payment.id,
        checkout.id,
        reference,
        checkout.hostedUrl,
        checkout.status || "PENDING",
        checkout.transaction_id || checkout.transaction_code || null,
      ]
    );

    await db.query(
      `insert into public.payment_status_history(payment_id, old_status, new_status, changed_by, notes)
       values($1, 'none', 'awaiting_confirmation', $2, $3)`,
      [payment.id, user.id, `Cobrança de ${reason} gerada via SumUp`]
    );

    payment.hosted_checkout_url = checkout.hostedUrl;
    return payment;
  });

  const formattedVal = amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const prettyDate = new Date().toLocaleDateString("pt-BR");

  const messageText = `Olá, *${client.full_name}*! 😊\n\nUma nova cobrança foi gerada para você:\n*Motivo:* ${reason}\n*Valor:* ${formattedVal}\n*Data:* ${prettyDate}\n\nVocê pode realizar o pagamento de forma segura com cartão ou PIX no link da SumUp abaixo:\n${result.hosted_checkout_url}\n\nSe tiver qualquer dúvida, estamos à disposição!`;

  if (client.phone) {
    await sendWhatsApp({ to: client.phone, text: messageText }).catch((err) =>
      console.error("Failed to send billing WhatsApp notification:", err.message)
    );
  }

  if (client.email) {
    const emailHtml = `
      <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; padding: 20px; border-radius: 10px;">
        <h2 style="color: #cda851; border-bottom: 2px solid #f6f6f6; padding-bottom: 10px;">Carol Sol - Nova Cobrança</h2>
        <p>Olá, <strong>${client.full_name}</strong>!</p>
        <p>Uma nova cobrança foi gerada para você em nosso sistema:</p>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">Motivo:</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${reason}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">Valor:</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee; color: #cda851; font-weight: bold;">${formattedVal}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">Data:</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${prettyDate}</td>
          </tr>
        </table>
        <p>Realize o pagamento de forma rápida e segura através do link abaixo:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${result.hosted_checkout_url}" style="background-color: #cda851; color: white; padding: 12px 30px; text-decoration: none; font-weight: bold; border-radius: 25px; display: inline-block;">Pagar Cobrança na SumUp</a>
        </div>
        <p style="font-size: 11px; color: #999; text-align: center; border-top: 1px solid #eee; padding-top: 15px; margin-top: 30px;">
          Se o botão não funcionar, copie e cole o seguinte endereço no seu navegador:<br/>
          ${result.hosted_checkout_url}
        </p>
      </div>
    `;

    await sendEmail({
      to: client.email,
      subject: `Nova cobrança (${reason}) - Carol Sol`,
      html: emailHtml,
    }).catch((err) =>
      console.error("Failed to send billing email notification:", err.message)
    );
  }

  await query(
    `insert into public.audit_logs(actor_id, action, entity_type, entity_id, new_data)
     values($1, 'create', 'payment_billing', $2, $3)`,
    [
      user.id,
      result.id,
      JSON.stringify({
        clientId,
        amount,
        reason,
        provider: "sumup",
        checkoutUrl: result.hosted_checkout_url,
      }),
    ]
  ).catch(err => console.error("Failed to insert billing audit log", err));

  return result;
}

async function addClientNote(user, body) {
  requireRole(user, ["professional", "admin"]);
  const clientId = validUuid(body.clientId, "Cliente");
  const note = clean(body.note);
  if (note.length < 3) throw appError("Escreva uma observação.");
  if (user.role === "professional") await clientDetail(user, clientId);
  const { rows } = await query(
    "insert into public.client_internal_notes(client_id,author_id,note) values($1,$2,$3) returning *",
    [clientId, user.id, note],
  );
  return rows[0];
}

async function updateClientStatus(user, body) {
  requireRole(user, ["admin"]);
  const clientId = validUuid(body.clientId, "Cliente");
  const status = clean(body.status);
  if (!["active", "blocked"].includes(status))
    throw appError("Status da conta inválido.");
  const { rows } = await query(
    `update public.profiles p set account_status=$1,updated_at=now() from public.clients c where c.profile_id=p.id and c.id=$2 returning p.id,p.account_status`,
    [status, clientId],
  );
  if (!rows[0]) throw appError("Cliente não encontrada.", 404);
  return rows[0];
}

async function savePlan(user, body) {
  requireRole(user, ["admin"]);
  await query("alter table public.plans add column if not exists archived boolean default false");
  const name = clean(body.name);
  const price = money(body.price);
  const benefits = Array.isArray(body.benefits)
    ? body.benefits.map(clean).filter(Boolean)
    : [];
  if (name.length < 2 || price <= 0)
    throw appError("Informe nome e preço válidos.");
  if (body.id) {
    const id = validUuid(body.id, "Plano");
    const { rows } = await query(
      `update public.plans set name=$1,price=$2,billing_cycle=$3,benefits=$4,active=$5,archived=$6 where id=$7 returning *`,
      [
        name,
        price,
        clean(body.billingCycle) || "monthly",
        JSON.stringify(benefits),
        body.active !== false,
        body.archived === true,
        id,
      ],
    );
    if (!rows[0]) throw appError("Plano não encontrado.", 404);
    return rows[0];
  }
  const { rows } = await query(
    `insert into public.plans(name,price,billing_cycle,benefits,active,archived) values($1,$2,$3,$4,true,false) returning *`,
    [
      name,
      price,
      clean(body.billingCycle) || "monthly",
      JSON.stringify(benefits),
    ],
  );
  return rows[0];
}

async function saveCoupon(user, body) {
  requireRole(user, ["admin"]);
  await query("alter table public.coupons add column if not exists archived boolean default false");
  const code = clean(body.code).toUpperCase();
  const description = clean(body.description);
  const value = money(body.discountValue);
  if (code.length < 3 || description.length < 3 || value <= 0)
    throw appError("Preencha código, descrição e desconto.");
  if (body.id) {
    const id = validUuid(body.id, "Cupom");
    const { rows } = await query(
      `update public.coupons set code=$1,description=$2,discount_type=$3,discount_value=$4,starts_at=$5,ends_at=$6,usage_limit=$7,active=$8,archived=$9 where id=$10 returning *`,
      [
        code,
        description,
        clean(body.discountType) || "percentage",
        value,
        body.startsAt || null,
        body.endsAt || null,
        body.usageLimit || null,
        body.active !== false,
        body.archived === true,
        id,
      ],
    );
    if (!rows[0]) throw appError("Cupom não encontrado.", 404);
    return rows[0];
  }
  const { rows } = await query(
    `insert into public.coupons(code,description,discount_type,discount_value,starts_at,ends_at,usage_limit,active,archived) values($1,$2,$3,$4,$5,$6,$7,true,false) returning *`,
    [
      code,
      description,
      clean(body.discountType) || "percentage",
      value,
      body.startsAt || null,
      body.endsAt || null,
      body.usageLimit || null,
    ],
  );
  return rows[0];
}

async function saveMarketingPromotion(user, body) {
  requireRole(user, ["admin"]);
  await ensureMarketingSchema();
  const title = clean(body.title);
  const description = clean(body.description);
  const promotionalValue = money(body.promotionalValue ?? body.promotional_value);
  const originalValueRaw = body.originalValue ?? body.original_value;
  const originalValue =
    originalValueRaw === "" || originalValueRaw == null ? null : money(originalValueRaw);
  const startsAt = clean(body.startsAt ?? body.starts_at) || null;
  const endsAt = clean(body.endsAt ?? body.ends_at) || null;
  const keywords = normalizePromotionKeywords(body.keywords);
  const active = body.active !== false;
  const showOnSite = body.showOnSite === true || body.show_on_site === true;
  const whatsappOnly = body.whatsappOnly !== false && body.whatsapp_only !== false;
  if (title.length < 2) throw appError("Informe o titulo da promocao.");
  if (!Number.isFinite(promotionalValue) || promotionalValue <= 0)
    throw appError("Informe o valor promocional.");
  if (originalValue != null && (!Number.isFinite(originalValue) || originalValue < 0))
    throw appError("Informe um valor original valido.");
  if (startsAt && !/^\d{4}-\d{2}-\d{2}$/.test(startsAt))
    throw appError("Data de inicio invalida.");
  if (endsAt && !/^\d{4}-\d{2}-\d{2}$/.test(endsAt))
    throw appError("Data de termino invalida.");
  if (startsAt && endsAt && startsAt > endsAt)
    throw appError("A data de termino deve ser posterior ao inicio.");
  const payload = [
    title,
    description || null,
    promotionalValue,
    originalValue,
    startsAt,
    endsAt,
    active,
    showOnSite,
    whatsappOnly,
    JSON.stringify(keywords),
    user.id,
  ];
  if (body.id) {
    const id = validUuid(body.id, "Promocao");
    const { rows } = await query(
      `update public.marketing_promotions
       set title=$1,description=$2,promotional_value=$3,original_value=$4,starts_at=$5,ends_at=$6,
           active=$7,show_on_site=$8,whatsapp_only=$9,keywords=$10,updated_by=$11,updated_at=now()
       where id=$12 and archived=false
       returning *`,
      [...payload, id],
    );
    if (!rows[0]) throw appError("Promocao nao encontrada.", 404);
    await query(
      `insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_data)
       values($1,'update','marketing_promotion',$2,$3)`,
      [user.id, id, JSON.stringify(rows[0])],
    ).catch(() => null);
    return rows[0];
  }
  const { rows } = await query(
    `insert into public.marketing_promotions(
      title,description,promotional_value,original_value,starts_at,ends_at,active,
      show_on_site,whatsapp_only,keywords,created_by,updated_by
    ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) returning *`,
    payload,
  );
  await query(
    `insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_data)
     values($1,'create','marketing_promotion',$2,$3)`,
    [user.id, rows[0].id, JSON.stringify(rows[0])],
  ).catch(() => null);
  return rows[0];
}

async function deleteMarketingPromotion(user, body) {
  requireRole(user, ["admin"]);
  await ensureMarketingSchema();
  const id = validUuid(body.id, "Promocao");
  const { rows } = await query(
    `update public.marketing_promotions
     set archived=true,active=false,updated_by=$1,updated_at=now()
     where id=$2 and archived=false
     returning id`,
    [user.id, id],
  );
  if (!rows[0]) throw appError("Promocao nao encontrada.", 404);
  await query(
    `insert into public.audit_logs(actor_id,action,entity_type,entity_id)
     values($1,'delete','marketing_promotion',$2)`,
    [user.id, id],
  ).catch(() => null);
  return { success: true };
}

async function saveAdminService(user, body) {
  requireRole(user, ["admin"]);
  await ensureMarketingSchema();
  const name = clean(body.name);
  const description = clean(body.description);
  const durationMinutes = Number.parseInt(body.durationMinutes ?? body.duration_minutes, 10);
  const isFree =
    body.isFree === undefined ? body.is_free === true : body.isFree === true;
  const basePrice = isFree ? 0 : money(body.basePrice ?? body.base_price);
  const depositAmount = isFree ? 0 : money(body.depositAmount ?? body.deposit_amount);
  const categoryId = body.categoryId ? validUuid(body.categoryId, "Categoria") : null;
  const hairMethodId = body.hairMethodId ? validUuid(body.hairMethodId, "MÃ©todo") : null;
  const active = body.active !== false;
  const showOnlineBooking =
    body.showOnlineBooking === undefined
      ? body.show_online_booking !== false
      : body.showOnlineBooking !== false;
  const offerInventoryItems =
    body.offerInventoryItems === undefined
      ? body.offer_inventory_items === true
      : body.offerInventoryItems === true;
  const replaceProfessionalLinks = Array.isArray(body.professionalLinks);
  const professionalLinks = replaceProfessionalLinks
    ? body.professionalLinks
        .filter((item) => item && item.enabled !== false)
        .map((item) => ({
          professionalId: validUuid(item.professionalId, "Profissional"),
          customPrice:
            isFree || item.customPrice === "" || item.customPrice == null
              ? null
              : money(item.customPrice),
          commissionRate:
            item.commissionRate === "" || item.commissionRate == null
              ? null
              : Number(item.commissionRate),
        }))
    : [];
  if (name.length < 2) throw appError("Informe o nome do serviço.");
  if (!Number.isFinite(durationMinutes) || durationMinutes < 15 || durationMinutes > 720)
    throw appError("A duração deve ficar entre 15 e 720 minutos.");
  if (!isFree && (!Number.isFinite(basePrice) || basePrice <= 0))
    throw appError("Informe um preço válido.");
  if (!Number.isFinite(depositAmount) || depositAmount < 0 || depositAmount > basePrice)
    throw appError("O sinal deve ser zero ou menor que o preço.");
  for (const link of professionalLinks) {
    if (link.customPrice != null && (!Number.isFinite(link.customPrice) || link.customPrice < 0))
      throw appError("Preço personalizado inválido.");
    if (
      link.commissionRate != null &&
      (!Number.isFinite(link.commissionRate) || link.commissionRate < 0 || link.commissionRate > 100)
    )
      throw appError("Comissão deve ficar entre 0 e 100%.");
  }
  const result = await transaction(async (client) => {
    if (categoryId) {
      const category = await client.query(
        "select id from public.service_categories where id=$1",
        [categoryId],
      );
      if (!category.rowCount) throw appError("Categoria não encontrada.", 404);
    }
    if (hairMethodId) {
      const method = await client.query(
        "select id from public.hair_methods where id=$1",
        [hairMethodId],
      );
      if (!method.rowCount) throw appError("Método não encontrado.", 404);
    }
    if (replaceProfessionalLinks && professionalLinks.length) {
      const professionalIds = [...new Set(professionalLinks.map((item) => item.professionalId))];
      const found = await client.query(
        "select id from public.professionals where id=any($1)",
        [professionalIds],
      );
      if (found.rowCount !== professionalIds.length)
        throw appError("Uma das profissionais selecionadas não existe.", 404);
    }
    let previous = null;
    let service;
    let action = "create";
    if (body.id) {
      const id = validUuid(body.id, "Serviço");
      const current = await client.query(
        "select * from public.services where id=$1 for update",
        [id],
      );
      previous = current.rows[0] || null;
      if (!previous) throw appError("Serviço não encontrado.", 404);
      const { rows } = await client.query(
        `update public.services
         set name=$1,description=$2,duration_minutes=$3,base_price=$4,deposit_amount=$5,
             category_id=$6,hair_method_id=$7,active=$8,show_online_booking=$9,is_free=$10,
             offer_inventory_items=$11
         where id=$12 returning *`,
        [
          name,
          description || null,
          durationMinutes,
          basePrice,
          depositAmount,
          categoryId,
          hairMethodId,
          active,
          showOnlineBooking,
          isFree,
          offerInventoryItems,
          id,
        ],
      );
      service = rows[0];
      action = "update";
    } else {
      const { rows } = await client.query(
        `insert into public.services(name,description,duration_minutes,base_price,deposit_amount,category_id,hair_method_id,active,show_online_booking,is_free,offer_inventory_items)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
        [
          name,
          description || null,
          durationMinutes,
          basePrice,
          depositAmount,
          categoryId,
          hairMethodId,
          active,
          showOnlineBooking,
          isFree,
          offerInventoryItems,
        ],
      );
      service = rows[0];
    }
    if (replaceProfessionalLinks) {
      await client.query(
        "delete from public.professional_services where service_id=$1",
        [service.id],
      );
      for (const link of professionalLinks) {
        await client.query(
          `insert into public.professional_services(professional_id,service_id,custom_price,commission_rate)
           values($1,$2,$3,$4)
           on conflict(professional_id,service_id)
           do update set custom_price=excluded.custom_price,commission_rate=excluded.commission_rate`,
          [link.professionalId, service.id, link.customPrice, link.commissionRate],
        );
      }
    }
    await client.query(
      `insert into public.audit_logs(actor_id,action,entity_type,entity_id,previous_data,new_data)
       values($1,$2,'service',$3,$4,$5)`,
      [
        user.id,
        action,
        service.id,
        previous ? JSON.stringify(previous) : null,
        JSON.stringify({
          ...service,
          professionalLinks: replaceProfessionalLinks ? professionalLinks : undefined,
        }),
      ],
    );
    return service;
  });
  return result;
}

async function deleteAdminService(user, body) {
  requireRole(user, ["admin"]);
  const id = validUuid(body.id, "Serviço");
  try {
    const result = await transaction(async (client) => {
      await client.query("delete from public.professional_services where service_id=$1", [id]);
      await client.query("delete from public.ai_service_settings where service_id=$1", [id]);
      const { rowCount } = await client.query("delete from public.services where id=$1", [id]);
      if (!rowCount) throw appError("Serviço não encontrado.", 404);

      await client.query(
        `insert into public.audit_logs(actor_id,action,entity_type,entity_id)
         values($1,'delete','service',$2)`,
        [user.id, id]
      );
      return { success: true };
    });
    return result;
  } catch (error) {
    if (error.code === "23503") {
      throw appError("Não é possível excluir este serviço porque existem agendamentos, avaliações ou registros vinculados a ele. Recomendamos apenas desativar o serviço.", 400);
    }
    throw error;
  }
}

async function saveAdminCategory(user, body) {
  requireRole(user, ["admin"]);
  const name = clean(body.name);
  const sortOrder = Number.parseInt(body.sortOrder ?? body.sort_order ?? 0, 10);
  const parentId = body.parentId || body.parent_id ? validUuid(body.parentId || body.parent_id, "Categoria Pai") : null;
  if (name.length < 2) throw appError("Informe o nome da categoria.");

  const result = await transaction(async (client) => {
    let category;
    if (body.id) {
      const id = validUuid(body.id, "Categoria");
      if (id === parentId) throw appError("Uma categoria não pode ser pai de si mesma.");
      const { rows } = await client.query(
        `update public.service_categories set name=$1, sort_order=$2, parent_id=$3 where id=$4 returning *`,
        [name, sortOrder, parentId, id]
      );
      if (!rows.length) throw appError("Categoria não encontrada.", 404);
      category = rows[0];
    } else {
      const { rows } = await client.query(
        `insert into public.service_categories(name, sort_order, parent_id) values($1, $2, $3) returning *`,
        [name, sortOrder, parentId]
      );
      category = rows[0];
    }
    return category;
  });
  return result;
}

async function deleteAdminCategory(user, body) {
  requireRole(user, ["admin"]);
  const id = validUuid(body.id, "Categoria");
  try {
    const result = await transaction(async (client) => {
      const { rowCount } = await client.query("delete from public.service_categories where id=$1", [id]);
      if (!rowCount) throw appError("Categoria não encontrada.", 404);
      return { success: true };
    });
    return result;
  } catch (error) {
    if (error.code === "23503") {
      throw appError("Não é possível excluir esta categoria porque existem serviços vinculados a ela. Remova ou altere os serviços antes.", 400);
    }
    throw error;
  }
}

async function saveAdminMethod(user, body) {
  requireRole(user, ["admin"]);
  const name = clean(body.name);
  const description = clean(body.description || "");
  const maintenanceDays = body.maintenanceDays ? Number.parseInt(body.maintenanceDays, 10) : null;
  const active = body.active !== false;
  const categoryId = body.categoryId || body.category_id ? validUuid(body.categoryId || body.category_id, "Categoria") : null;
  const parentId = body.parentId || body.parent_id ? validUuid(body.parentId || body.parent_id, "Método Pai") : null;

  if (name.length < 2) throw appError("Informe o nome do método.");

  const result = await transaction(async (client) => {
    let method;
    if (body.id) {
      const id = validUuid(body.id, "Método");
      if (id === parentId) throw appError("Um método não pode ser pai de si mesmo.");
      const { rows } = await client.query(
        `update public.hair_methods set name=$1, description=$2, maintenance_days=$3, active=$4, category_id=$5, parent_id=$6 where id=$7 returning *`,
        [name, description || null, maintenanceDays, active, categoryId, parentId, id]
      );
      if (!rows.length) throw appError("Método não encontrado.", 404);
      method = rows[0];
    } else {
      const { rows } = await client.query(
        `insert into public.hair_methods(name, description, maintenance_days, active, category_id, parent_id) values($1, $2, $3, $4, $5, $6) returning *`,
        [name, description || null, maintenanceDays, active, categoryId, parentId]
      );
      method = rows[0];
    }
    return method;
  });
  return result;
}

async function deleteAdminMethod(user, body) {
  requireRole(user, ["admin"]);
  const id = validUuid(body.id, "Método");
  try {
    const result = await transaction(async (client) => {
      const { rowCount } = await client.query("delete from public.hair_methods where id=$1", [id]);
      if (!rowCount) throw appError("Método não encontrado.", 404);
      return { success: true };
    });
    return result;
  } catch (error) {
    if (error.code === "23503") {
      throw appError("Não é possível excluir este método porque existem serviços vinculados a ele. Remova ou altere os serviços antes.", 400);
    }
    throw error;
  }
}


const backupTables = [
  "profiles",
  "clients",
  "professionals",
  "admins",
  "salon_locations",
  "chairs_or_rooms",
  "service_categories",
  "hair_methods",
  "services",
  "professional_services",
  "professional_availability",
  "appointments",
  "appointment_status_history",
  "payments",
  "payment_status_history",
  "payment_receipts",
  "plans",
  "subscriptions",
  "loyalty_points",
  "coupons",
  "marketing_promotions",
  "campaigns",
  "referrals",
  "client_photos",
  "before_after_gallery",
  "technical_records",
  "hair_inventory",
  "inventory_movements",
  "products",
  "product_sales",
  "commissions",
  "professional_goals",
  "reviews",
  "blocked_schedule",
  "waitlist",
  "consent_logs",
  "audit_logs",
  "ai_settings",
  "ai_prompt_versions",
  "ai_service_settings",
  "ai_plan_settings",
  "ai_automation_flows",
  "whatsapp_conversations",
  "whatsapp_messages",
  "whatsapp_message_logs",
  "ai_interactions",
  "ai_tool_calls",
  "human_handoff_tickets",
  "conversation_tags",
  "conversation_tag_links",
  "whatsapp_incoming_queue",
  "ai_request_logs",
  "knowledge_articles",
  "integration_settings",
  "business_settings"
];

async function listBackups(user) {
  requireRole(user, ["admin"]);
  await query(`
    CREATE TABLE IF NOT EXISTS public.database_backups (
      id uuid primary key default uuid_generate_v4(),
      filename text not null,
      data jsonb not null,
      size_bytes integer not null,
      created_by uuid references public.profiles(id) on delete set null,
      created_at timestamptz not null default now()
    )
  `);

  const { rows } = await query(
    `select b.id, b.filename, b.size_bytes, b.created_at, p.full_name as creator
     from public.database_backups b
     left join public.profiles p on p.id=b.created_by
     order by b.created_at desc`
  );
  return rows;
}

async function downloadBackup(user, id) {
  requireRole(user, ["admin"]);
  const { rows } = await query("select filename, data from public.database_backups where id=$1", [id]);
  if (!rows.length) throw appError("Backup não encontrado.", 404);
  return {
    filename: rows[0].filename,
    data: typeof rows[0].data === "string" ? JSON.parse(rows[0].data) : rows[0].data
  };
}

async function deleteBackup(user, body) {
  requireRole(user, ["admin"]);
  const id = validUuid(body.id, "Backup");
  await query("delete from public.database_backups where id=$1", [id]);
  return { success: true };
}

async function createBackup(user) {
  requireRole(user, ["admin"]);
  await ensureAdminSettingsSchema();
  await ensureMarketingSchema();
  await query(`
    CREATE TABLE IF NOT EXISTS public.database_backups (
      id uuid primary key default uuid_generate_v4(),
      filename text not null,
      data jsonb not null,
      size_bytes integer not null,
      created_by uuid references public.profiles(id) on delete set null,
      created_at timestamptz not null default now()
    )
  `);

  const tablesData = {};
  for (const table of backupTables) {
    const { rows } = await query(`select * from public.${table}`);
    tablesData[table] = rows;
  }

  const backupPayload = {
    backup_version: "1.0",
    created_at: new Date().toISOString(),
    tables: tablesData
  };

  const backupString = JSON.stringify(backupPayload);
  const sizeBytes = Buffer.byteLength(backupString, "utf8");
  const filename = `backup_carolsol_${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}.json`;

  const { rows } = await query(
    `insert into public.database_backups(filename, data, size_bytes, created_by)
     values($1, $2, $3, $4) returning id, filename, size_bytes, created_at`,
    [filename, backupString, sizeBytes, user.id]
  );

  return rows[0];
}

async function restoreBackup(user, body) {
  requireRole(user, ["admin"]);
  await ensureAdminSettingsSchema();
  await ensureMarketingSchema();
  let backupData;
  if (body.id) {
    const { rows } = await query("select data from public.database_backups where id=$1", [body.id]);
    if (!rows.length) throw appError("Backup não encontrado.", 404);
    backupData = typeof rows[0].data === "string" ? JSON.parse(rows[0].data) : rows[0].data;
  } else if (body.rawJson) {
    backupData = typeof body.rawJson === "string" ? JSON.parse(body.rawJson) : body.rawJson;
  } else {
    throw appError("ID do backup ou dados brutos não informados.");
  }

  const tables = backupData.tables;
  if (!tables) throw appError("Estrutura de backup inválida.");

  await transaction(async (client) => {
    const deleteOrder = [
      "whatsapp_message_logs", "whatsapp_messages", "human_handoff_tickets", "conversation_tag_links", "conversation_tags", "whatsapp_conversations", "whatsapp_sessions", "ai_tool_calls", "ai_interactions", "whatsapp_incoming_queue", "ai_request_logs",
      "client_photos", "before_after_gallery",
      "commissions", "product_sales",
      "inventory_movements", "technical_records",
      "appointment_status_history", "appointment_messages", "reschedule_requests", "quote_items", "quotes", "reviews", "professional_goals", "blocked_schedule",
      "payment_receipts", "payment_status_history", "payments", "payment_webhook_logs", "card_tokenization_sessions", "saved_cards",
      "appointments", "waitlist",
      "subscriptions", "subscription_renewal_attempts", "loyalty_points", "client_internal_notes", "coupon_usage", "marketing_promotions", "referral_rewards", "referrals", "data_export_requests", "account_deletion_requests", "privacy_consents",
      "professional_services", "professional_availability", "professionals",
      "notification_preferences", "clients", "profiles", "auth.users",
      "audit_logs", "notification_delivery_logs", "notifications", "consent_logs", "campaigns",
      "ai_settings", "ai_prompt_versions", "ai_service_settings", "ai_plan_settings", "ai_automation_flows", "knowledge_articles", "integration_settings", "business_settings"
    ];

    for (const table of deleteOrder) {
      if (table === "auth.users") {
        await client.query("DELETE FROM auth.users WHERE id <> '00000000-0000-0000-0000-000000000001'");
      } else if (table === "profiles") {
        await client.query("DELETE FROM public.profiles WHERE id <> '00000000-0000-0000-0000-000000000001'");
      } else {
        await client.query(`DELETE FROM public.${table}`);
      }
    }

    const restoreOrder = [...deleteOrder].reverse();

    for (const table of restoreOrder) {
      const rows = tables[table] || tables[table.replace("public.", "")];
      if (!rows || !rows.length) continue;

      for (const row of rows) {
        const keys = Object.keys(row);
        if (!keys.length) continue;

        if (table === "auth.users" && row.id === "00000000-0000-0000-0000-000000000001") {
          const fields = keys.map((k, i) => `${k}=$${i + 1}`).join(", ");
          const vals = Object.values(row);
          await client.query(
            `insert into auth.users(${keys.join(",")}) values(${keys.map((_, i) => `$${i + 1}`).join(",")})
             on conflict(id) do update set ${fields}`,
            vals
          );
          continue;
        }
        if (table === "profiles" && row.id === "00000000-0000-0000-0000-000000000001") {
          const fields = keys.map((k, i) => `${k}=$${i + 1}`).join(", ");
          const vals = Object.values(row);
          await client.query(
            `insert into public.profiles(${keys.join(",")}) values(${keys.map((_, i) => `$${i + 1}`).join(",")})
             on conflict(id) do update set ${fields}`,
            vals
          );
          continue;
        }

        const vals = Object.values(row);
        const queryText = `insert into public.${table}(${keys.join(",")}) values(${keys.map((_, i) => `$${i + 1}`).join(",")})`;
        await client.query(queryText, vals);
      }
    }
  });

  return { success: true };
}


async function blockSchedule(user, body) {
  requireRole(user, ["professional", "admin"]);
  const professionalId =
    user.role === "admin"
      ? validUuid(body.professionalId, "Profissional")
      : await professionalIdFor(user);
  const { period, error } = schedulePeriod(body.startsAt, body.endsAt);
  if (error) throw appError(error);
  return transaction(async (client) => {
    if (user.role === "admin") {
      const professional = await client.query(
        "select id from public.professionals where id=$1 and active limit 1",
        [professionalId],
      );
      if (!professional.rowCount) throw appError("Profissional não encontrada.", 404);
    }
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [
      professionalId,
    ]);
    const schedule = await client.query(
      `select starts_at,ends_at,active
       from public.professional_availability
       where professional_id=$1 and weekday=$2 and active`,
      [professionalId, period.weekday],
    );
    if (!periodFitsSchedule(period, schedule.rows))
      throw appError("O período deve estar dentro da sua jornada configurada.");
    const conflicts = await client.query(
      `select 1 from (
         select 1 from public.appointments
         where professional_id=$1 and status not in ('cancelled','no_show')
           and tstzrange(starts_at,ends_at,'[)') && tstzrange($2,$3,'[)')
         union all
         select 1 from public.blocked_schedule
         where professional_id=$1
           and tstzrange(starts_at,ends_at,'[)') && tstzrange($2,$3,'[)')
       ) conflicts limit 1`,
      [professionalId, period.starts.toISOString(), period.ends.toISOString()],
    );
    if (conflicts.rowCount)
      throw appError("Já existe atendimento ou bloqueio neste período.", 409);
    const { rows } = await client.query(
      `insert into public.blocked_schedule(professional_id,starts_at,ends_at,reason)
       values($1,$2,$3,$4) returning *`,
      [
        professionalId,
        period.starts.toISOString(),
        period.ends.toISOString(),
        clean(body.reason) || null,
      ],
    );
    return rows[0];
  });
}

async function deleteBlockedSchedule(user, body) {
  requireRole(user, ["professional", "admin"]);
  const id = validUuid(body.id, "Bloqueio");
  const professionalId = user.role === "professional" ? await professionalIdFor(user) : "";
  const params = [id];
  let scope = "";
  if (professionalId) {
    params.push(professionalId);
    scope = " and professional_id=$2";
  }
  const { rows } = await query(
    `delete from public.blocked_schedule
      where id=$1${scope}
      returning id,professional_id,starts_at,ends_at,reason`,
    params,
  );
  if (!rows[0]) throw appError("Bloqueio não encontrado.", 404);
  return rows[0];
}

async function saveAdminSettings(user, body) {
  requireRole(user, ["admin"]);
  await ensureAdminSettingsSchema();
  const value = {
    businessName: clean(body.businessName),
    phone: clean(body.phone),
    whatsapp: clean(body.whatsapp),
    email: clean(body.email).toLowerCase(),
    address: clean(body.address),
    timezone: clean(body.timezone) || "America/Sao_Paulo",
  };
  if (value.businessName.length < 2)
    throw appError("Informe o nome da empresa.");
  if (value.email && !/^\S+@\S+\.\S+$/.test(value.email))
    throw appError("Informe um e-mail válido.");

  if (body.templates) {
    const templates = {
      confirmation: String(body.templates.confirmation || "").trim(),
      reminder: String(body.templates.reminder || "").trim(),
      cancellation: String(body.templates.cancellation || "").trim(),
      reschedule: String(body.templates.reschedule || "").trim()
    };
    await query(
      `insert into public.integration_settings(provider,enabled,public_config,updated_by,updated_at)
       values('message_templates',true,$1,$2,now()) on conflict(provider) do update set public_config=excluded.public_config,updated_by=excluded.updated_by,updated_at=now()`,
      [JSON.stringify(templates), user.id]
    );
  }

  const { rows } = await query(
    `insert into public.business_settings(key,value,updated_by,updated_at)
    values('business_profile',$1,$2,now()) on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=now()
    returning value,updated_at`,
    [JSON.stringify(value), user.id],
  );
  await query(
    `insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_data) values($1,'update','business_settings','business_profile',$2)`,
    [user.id, JSON.stringify(value)],
  );
  return { ...rows[0].value, updatedAt: rows[0].updated_at };
}

async function saveAdminProfessional(user, body) {
  requireRole(user, ["admin"]);
  const fullName = clean(body.fullName);
  const email = clean(body.email).toLowerCase();
  const phone = clean(body.phone) || null;
  const bio = clean(body.bio);
  const specialties = Array.isArray(body.specialties)
    ? body.specialties.map(clean).filter(Boolean)
    : [];
  const commissionRate = body.commissionRate != null ? Number(body.commissionRate) : 0;
  const active = body.active !== false;

  if (fullName.length < 3) throw appError("Informe o nome completo.");
  if (!/^\S+@\S+\.\S+$/.test(email)) throw appError("Informe um e-mail válido.");

  if (body.id) {
    const id = validUuid(body.id, "Profissional");
    return transaction(async (client) => {
      const profResult = await client.query(
        "select profile_id from public.professionals where id=$1",
        [id]
      );
      if (!profResult.rows[0]) throw appError("Profissional não encontrada.", 404);
      const profileId = profResult.rows[0].profile_id;

      const emailCheck = await client.query(
        "select id from auth.users where lower(email)=$1 and id<>$2",
        [email, profileId]
      );
      if (emailCheck.rowCount > 0) throw appError("Este e-mail já está cadastrado.", 409);

      try {
        await client.query(
          "update auth.users set email=$1, phone=$2, updated_at=now() where id=$3",
          [email, phone, profileId]
        );
      } catch (authError) {
        console.warn("Direct auth.users email/phone update skipped in saveAdminProfessional:", authError.message);
      }

      await client.query(
        "update public.profiles set full_name=$1, phone=$2, updated_at=now() where id=$3",
        [fullName, phone, profileId]
      );

      const { rows } = await client.query(
        `update public.professionals
         set bio=$1, specialties=$2, commission_rate=$3, active=$4
         where id=$5 returning *`,
        [bio, specialties, commissionRate, active, id]
      );

      if (body.password) {
        if (body.password.length < 8) throw appError("A senha precisa ter pelo menos 8 caracteres.");
        const passwordHash = await bcrypt.hash(body.password, 12);
        try {
          await client.query(
            "update auth.users set encrypted_password=$1, updated_at=now() where id=$2",
            [passwordHash, profileId]
          );
        } catch (authError) {
          console.warn("Direct auth.users password update skipped in saveAdminProfessional:", authError.message);
        }
      }

      await client.query(
        `insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_data)
         values($1,'update','professional',$2,$3)`,
        [user.id, id, JSON.stringify({ fullName, email, active })]
      );

      return rows[0];
    });
  } else {
    const password = body.password ? String(body.password) : "CarolSol@2026";
    if (password.length < 8) throw appError("A senha precisa ter pelo menos 8 caracteres.");
    const passwordHash = await bcrypt.hash(password, 12);

    return transaction(async (client) => {
      const emailCheck = await client.query(
        "select 1 from auth.users where lower(email)=$1",
        [email]
      );
      if (emailCheck.rowCount > 0) throw appError("Este e-mail já está cadastrado.", 409);

      const { rows: users } = await client.query(
        `insert into auth.users(email, phone, encrypted_password, email_confirmed_at, raw_user_meta_data)
         values ($1,$2,$3,now(),$4) returning id`,
        [email, phone, passwordHash, JSON.stringify({ name: fullName })]
      );
      const userId = users[0].id;

      await client.query(
        `insert into public.profiles(id, role, full_name, phone, notification_preferences)
         values ($1,'professional',$2,$3,'{"email":true,"whatsapp":true,"push":true}')`,
        [userId, fullName, phone]
      );

      const { rows: professionals } = await client.query(
        `insert into public.professionals(profile_id, bio, specialties, commission_rate, active, hired_at)
         values($1,$2,$3,$4,true,current_date) returning *`,
        [userId, bio, specialties, commissionRate]
      );

      const newId = professionals[0].id;

      for (let weekday = 1; weekday <= 5; weekday++) {
        await client.query(
          `insert into public.professional_availability(professional_id, weekday, starts_at, ends_at, active)
           values($1, $2, '09:00:00', '18:00:00', true)`,
          [newId, weekday]
        );
      }

      await client.query(
        `insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_data)
         values($1,'create','professional',$2,$3)`,
        [user.id, newId, JSON.stringify({ fullName, email })]
      );

      return professionals[0];
    });
  }
}

async function saveProfessionalAvailability(user, body) {
  requireRole(user, ["professional"]);
  const professionalId = await professionalIdFor(user);
  const slots = Array.isArray(body.availability) ? body.availability : [];

  return transaction(async (client) => {
    await client.query(
      "delete from public.professional_availability where professional_id=$1",
      [professionalId]
    );

    for (const slot of slots) {
      const weekday = Number(slot.weekday);
      const startsAt = clean(slot.starts_at || slot.startsAt);
      const endsAt = clean(slot.ends_at || slot.endsAt);
      const active = slot.active !== false;

      if (weekday < 0 || weekday > 6) throw appError("Dia da semana inválido.");
      if (!startsAt || !endsAt) throw appError("Horários de início e término são obrigatórios.");

      await client.query(
        `insert into public.professional_availability(professional_id, weekday, starts_at, ends_at, active)
         values($1, $2, $3, $4, $5)`,
        [professionalId, weekday, startsAt, endsAt, active]
      );
    }

    await client.query(
      `insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_data)
       values($1,'update_availability','professional',$2,$3)`,
      [user.id, professionalId, JSON.stringify({ slotCount: slots.length, source: "self" })]
    );

    return { ok: true };
  });
}

async function saveAdminProfessionalAvailability(user, body) {
  requireRole(user, ["admin"]);
  const professionalId = validUuid(body.professionalId, "Profissional");
  const slots = Array.isArray(body.availability) ? body.availability : [];

  return transaction(async (client) => {
    const profResult = await client.query(
      "select 1 from public.professionals where id=$1",
      [professionalId]
    );
    if (!profResult.rowCount) throw appError("Profissional não encontrada.", 404);

    await client.query(
      "delete from public.professional_availability where professional_id=$1",
      [professionalId]
    );

    for (const slot of slots) {
      const weekday = Number(slot.weekday);
      const startsAt = clean(slot.startsAt);
      const endsAt = clean(slot.endsAt);
      const active = slot.active !== false;

      if (weekday < 0 || weekday > 6) throw appError("Dia da semana inválido.");
      if (!startsAt || !endsAt) throw appError("Horários de início e término são obrigatórios.");

      await client.query(
        `insert into public.professional_availability(professional_id, weekday, starts_at, ends_at, active)
         values($1, $2, $3, $4, $5)`,
        [professionalId, weekday, startsAt, endsAt, active]
      );
    }

    await client.query(
      `insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_data)
       values($1,'update_availability','professional',$2,$3)`,
      [user.id, professionalId, JSON.stringify({ slotCount: slots.length })]
    );

    return { ok: true };
  });
}

async function saveAdminClient(user, body) {
  requireRole(user, ["admin", "professional"]);
  console.log("[DEBUG saveAdminClient] Received body payload:", JSON.stringify(body));

  const executeQuery = async (conn, sql, params = []) => {
    console.log("[DEBUG SQL]:", sql);
    console.log("[DEBUG PARAMS]:", JSON.stringify(params.map((val, idx) => ({
      index: `$${idx + 1}`,
      value: val,
      type: typeof val,
    }))));
    try {
      const res = await conn.query(sql, params);
      console.log("[DEBUG SUCCESS]");
      return res;
    } catch (err) {
      console.error("[DEBUG ERROR]:", err.message);
      throw err;
    }
  };

  const executeGlobalQuery = async (sql, params = []) => {
    console.log("[DEBUG GLOBAL SQL]:", sql);
    console.log("[DEBUG GLOBAL PARAMS]:", JSON.stringify(params.map((val, idx) => ({
      index: `$${idx + 1}`,
      value: val,
      type: typeof val,
    }))));
    try {
      const res = await query(sql, params);
      console.log("[DEBUG GLOBAL SUCCESS]");
      return res;
    } catch (err) {
      console.error("[DEBUG GLOBAL ERROR]:", err.message);
      throw err;
    }
  };

  await executeGlobalQuery("alter table public.profiles add column if not exists cpf text").catch(() => null);
  const fullName = clean(body.fullName);
  const email = clean(body.email).toLowerCase();
  const whatsapp = clean(body.whatsapp || body.phone) || null;
  const phone = whatsapp;
  const cpf = clean(body.cpf) || null;
  const instagram = clean(body.instagram) || null;
  const birthDate = body.birthDate ? clean(body.birthDate) : null;
  const notes = clean(body.notes);

  if (fullName.length < 3) throw appError("Nome completo inválido.");
  if (!/^\S+@\S+\.\S+$/.test(email) || email.endsWith("@carolsol.local"))
    throw appError("Informe um e-mail real e válido.");

  if (!body.id) {
    const password = body.password || temporaryPassword();
    const passwordHash = await bcrypt.hash(password, 12);
    const created = await transaction(async (client) => {
      const emailCheck = await executeQuery(client,
        "select id from auth.users where lower(email)=lower($1::text) limit 1",
        [email],
      );
      if (emailCheck.rowCount)
        throw appError("Este e-mail já está cadastrado por outro usuário.", 409);
      const { rows: users } = await executeQuery(client,
        `insert into auth.users(email, phone, encrypted_password, email_confirmed_at, raw_user_meta_data)
         values($1::text,$2::text,$3::text,now(),$4::jsonb) returning id`,
        [
          email,
          whatsapp || phone,
          passwordHash,
          JSON.stringify({
            name: fullName,
            source: "admin_manual",
            force_password_change: true,
          }),
        ],
      );
      const profileId = users[0].id;
      await executeQuery(client,
        `insert into public.profiles(id, role, full_name, phone, birth_date, cpf, instagram, notification_preferences)
         values($1::uuid,'client',$2::text,$3::text,$4::date,$5::text,$6::text,'{"email":true,"whatsapp":true,"push":true}')`,
        [profileId, fullName, whatsapp || phone, birthDate, cpf, instagram],
      );
      const clientPreferences = {
        manual_contact: {
          phone,
          whatsapp,
        },
      };
      if (user.role === "professional") {
        clientPreferences.created_by_professional = user.id;
      }
      const { rows: clients } = await executeQuery(client,
        `insert into public.clients(profile_id, source, cpf, personal_notes, preferences)
         values($1::uuid,$2::text,$3::text,$4::text,$5::jsonb) returning id`,
        [
          profileId,
          user.role === "professional" ? "Cadastro manual profissional" : "Cadastro manual admin",
          cpf,
          notes || null,
          JSON.stringify(clientPreferences),
        ],
      );
      await executeQuery(client,
        `insert into public.consent_logs(profile_id, consent_type, granted, policy_version, source)
         values($1::uuid,'admin_manual_registration',true,'1.0','admin_panel')`,
        [profileId],
      ).catch(() => null);
      await executeQuery(client,
        `insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_data)
         values($1::uuid,'create','client',$2::text,$3::jsonb)`,
        [
          user.id,
          clients[0].id,
          JSON.stringify({
            fullName,
            email,
            phone,
            whatsapp,
            temporaryPasswordGenerated: true,
          }),
        ],
      );
      return { id: clients[0].id, profileId };
    });
    const appUrl = process.env.APP_URL || "https://carolmobile.vercel.app";
    await Promise.allSettled([
      sendEmail({
        to: email,
        subject: "Seu acesso ao portal Carol Sol",
        html: `<p>Olá, ${fullName}.</p><p>Seu cadastro foi realizado com sucesso.</p><p><strong>Login:</strong> ${email}<br/><strong>Senha temporária:</strong> ${password}</p><p>Acesse: <a href="${appUrl}/entrar">${appUrl}/entrar</a></p><p>Por segurança, altere sua senha no primeiro acesso.</p>`,
      }),
      whatsapp
        ? sendWhatsApp({
            to: whatsapp,
            text: [
              "Cadastro realizado com sucesso.",
              "",
              "Seu acesso ao portal foi criado.",
              "",
              `Login: ${email}`,
              `Senha temporária: ${password}`,
              `Link: ${appUrl}/entrar`,
              "",
              "Por segurança, altere sua senha no primeiro acesso.",
            ].join("\n"),
          })
        : Promise.resolve({ skipped: true }),
    ]);
    await executeGlobalQuery(
      `insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_data)
       values($1::uuid,'send_credentials','client',$2::text,$3::jsonb)`,
      [
        user.id,
        created.id,
        JSON.stringify({
          emailSent: true,
          whatsappSent: Boolean(whatsapp),
        }),
      ],
    ).catch(() => null);
    return { ok: true, id: created.id };
  }

  const clientId = validUuid(body.id, "Cliente");
  return transaction(async (client) => {
    const clientResult = await executeQuery(client,
      "select profile_id from public.clients where id=$1::uuid",
      [clientId]
    );
    if (!clientResult.rows[0]) throw appError("Cliente não encontrada.", 404);
    const profileId = clientResult.rows[0].profile_id;

    if (email || body.password) {
      if (email) {
        const emailCheck = await executeQuery(client,
          "select id from auth.users where lower(email)=$1::text and id<>$2::uuid",
          [email, profileId]
        );
        if (emailCheck.rowCount > 0) throw appError("Este e-mail já está cadastrado por outro usuário.", 409);
      }

      try {
        if (email && body.password) {
          const passwordHash = await bcrypt.hash(body.password, 12);
          await executeQuery(client,
            "update auth.users set email=$1::text, encrypted_password=$2::text, updated_at=now() where id=$3::uuid",
            [email, passwordHash, profileId]
          );
        } else if (email) {
          await executeQuery(client,
            "update auth.users set email=$1::text, updated_at=now() where id=$2::uuid",
            [email, profileId]
          );
        } else if (body.password) {
          const passwordHash = await bcrypt.hash(body.password, 12);
          await executeQuery(client,
            "update auth.users set encrypted_password=$1::text, updated_at=now() where id=$2::uuid",
            [passwordHash, profileId]
          );
        }
      } catch (authError) {
        console.warn("Direct auth.users update skipped in saveAdminClient:", authError.message);
      }
    }

    await executeQuery(client,
      `update public.profiles
       set full_name=$1::text, phone=$2::text, birth_date=$3::date, cpf=$4::text, instagram=$5::text, updated_at=now()
       where id=$6::uuid`,
      [fullName, whatsapp || phone, birthDate, cpf, instagram, profileId]
    );
    await executeQuery(client,
      `update public.clients
       set cpf=coalesce($2::text,cpf),
           personal_notes=coalesce(nullif($3::text,''),personal_notes),
           preferences=coalesce(preferences,'{}'::jsonb) || $4::jsonb
       where id=$1::uuid`,
      [
        clientId,
        cpf,
        notes,
        JSON.stringify({ manual_contact: { phone, whatsapp } }),
      ],
    ).catch(() => null);

    await executeQuery(client,
      `insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_data)
       values($1::uuid,'update','client',$2::text,$3::jsonb)`,
      [user.id, clientId, JSON.stringify({ fullName, email, phone, whatsapp })]
    );

    return { ok: true };
  });
}

async function testNotification(user, body) {
  requireRole(user, ["admin"]);
  const { channel, recipient, message } = body;
  if (!channel || !recipient || !message) throw appError("Canal, destinatário e mensagem são obrigatórios.");

  if (channel === "email") {
    await sendEmail({
      to: recipient,
      subject: "Teste de Notificação — Carol Sol",
      html: `<div style="font-family:Arial,sans-serif;color:#181511"><h1>Teste do Painel Administrativo</h1><p>${message}</p></div>`
    });
  } else if (channel === "whatsapp") {
    await sendWhatsApp({
      to: recipient,
      text: message
    });
  } else {
    throw appError("Canal inválido.");
  }
  return { success: true };
}

async function mutate(user, resource, body, method = "POST") {
  if (resource === "profile") return updateProfile(user, body);
  if (resource === "subscription-request")
    return requestSubscription(user, body);
  if (resource === "subscription-recurring")
    return updateSubscriptionRecurring(user, body);
  if (resource === "cards" && body.action) return updateCard(user, body);
  if (resource === "cards") return saveCard(user, body);
  if (resource === "notification-preferences")
    return updatePreferences(user, body);
  if (resource === "privacy-consent") return updateConsent(user, body);
  if (resource === "data-export") return exportData(user);
  if (resource === "deletion-request") return requestDeletion(user, body);
  if (resource === "deletion-review") return reviewDeletion(user, body);
  if (resource === "admin-client-removal") return removeAdminClient(user, body);
  if (resource === "referrals") return createReferral(user, body);
  if (resource === "notification-read") return markNotification(user, body);
  if (resource === "admin-payment") return updateManualPayment(user, body);
  if (resource === "admin-billing") return createAdminBilling(user, body);
  if (resource === "client-note") return addClientNote(user, body);
  if (resource === "client-status") return updateClientStatus(user, body);
  if (resource === "admin-plan") return savePlan(user, body);
  if (resource === "admin-coupon") return saveCoupon(user, body);
  if (resource === "admin-promotion" && method === "DELETE")
    return deleteMarketingPromotion(user, body);
  if (resource === "admin-promotion") return saveMarketingPromotion(user, body);
  if (resource === "admin-service" && method === "DELETE")
    return deleteAdminService(user, body);
  if (resource === "admin-service") return saveAdminService(user, body);
  if (resource === "admin-category" && method === "DELETE")
    return deleteAdminCategory(user, body);
  if (resource === "admin-category") return saveAdminCategory(user, body);
  if (resource === "admin-method" && method === "DELETE")
    return deleteAdminMethod(user, body);
  if (resource === "admin-method") return saveAdminMethod(user, body);
  if (resource === "admin-professional") return saveAdminProfessional(user, body);
  if (resource === "admin-professional-availability") return saveAdminProfessionalAvailability(user, body);
  if (resource === "professional-availability") return saveProfessionalAvailability(user, body);
  if (resource === "admin-client") return saveAdminClient(user, body);
  if (resource === "blocked-schedule" && method === "DELETE")
    return deleteBlockedSchedule(user, body);
  if (resource === "blocked-schedule") return blockSchedule(user, body);
  if (resource === "admin-settings") return saveAdminSettings(user, body);
  if (resource === "admin-backup-create") return createBackup(user);
  if (resource === "admin-backup-restore") return restoreBackup(user, body);
  if (resource === "admin-backup-delete" && method === "DELETE") return deleteBackup(user, body);
  if (resource === "test-notification") return testNotification(user, body);
  throw appError("Ação não encontrada.", 404);
}

export default async function handler(req, res) {
  try {
    const user = await requireUser(req);
    const resource = clean(req.query?.resource);
    if (req.method === "GET")
      return send(res, 200, { data: await getResource(req, user, resource) });
    if (!["POST", "PATCH", "DELETE"].includes(req.method))
      return methodNotAllowed(res, ["GET", "POST", "PATCH", "DELETE"]);
    const data = await mutate(user, resource, getBody(req), req.method);
    return send(res, req.method === "POST" ? 201 : 200, { data });
  } catch (error) {
    console.error("Portal API error", {
      method: req.method,
      resource: req.query?.resource,
      status: error.status || 500,
      message: error.message,
    });
    return handleError(res, error);
  }
}
