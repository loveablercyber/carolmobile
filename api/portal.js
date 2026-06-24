import { createHash } from "node:crypto";
import { query, transaction } from "../server/lib/db.js";
import { requireUser } from "../server/lib/auth.js";
import {
  deleteFromCloudinary,
  isConfiguredCloudinaryUrl,
  sendEmail,
} from "../server/lib/integrations.js";
import { deactivateSumupPaymentInstrument } from "../server/lib/sumup.js";
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
const validUuid = (value, label = "ID") => {
  const id = clean(value);
  if (!uuidPattern.test(id)) throw appError(`${label} inválido.`);
  return id;
};
const money = (value) => Number(value || 0);

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
  requireRole(user, ["client"]);
  const clientId = await clientIdFor(user);
  const [profile, appointment, points, subscription, coupons, pending] =
    await Promise.all([
      profileResource(user),
      query(
        `select a.id,a.starts_at,a.status,s.name as service,pp.full_name as professional,l.name as location
      from public.appointments a join public.services s on s.id=a.service_id join public.professionals pr on pr.id=a.professional_id
      join public.profiles pp on pp.id=pr.profile_id left join public.salon_locations l on l.id=a.location_id
      where a.client_id=$1 and a.starts_at>=now() and a.status in ('pending_deposit','confirmed','rescheduled') order by a.starts_at limit 1`,
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
      from public.coupons c where c.active and (c.starts_at is null or c.starts_at<=now()) and (c.ends_at is null or c.ends_at>=now())
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
    points: points.rows[0].points,
    subscription: subscription.rows[0] || null,
    coupons: coupons.rows,
    pendingPayments: pending.rows[0],
  };
}

async function paymentsResource(user, id) {
  let where = "true";
  const params = [];
  if (user.role === "client") {
    params.push(await clientIdFor(user));
    where = `pay.client_id=$${params.length}`;
  } else if (user.role === "professional") {
    params.push(await professionalIdFor(user));
    where = `a.professional_id=$${params.length}`;
  }
  if (id) {
    params.push(validUuid(id, "Pagamento"));
    where += ` and pay.id=$${params.length}`;
  }
  const { rows } = await query(
    `select pay.id,pay.amount,pay.original_amount,pay.discount_amount,pay.paid_amount,pay.method,pay.payment_method,pay.status,pay.provider,pay.provider_reference,
    pay.provider_checkout_id,pay.provider_transaction_id,pay.checkout_reference,pay.hosted_checkout_url,pay.provider_status,pay.failure_reason,
    pay.receipt_url,pay.notes,pay.paid_at,pay.created_at,pay.updated_at,a.id as appointment_id,a.starts_at,s.name as service,
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
  if (id && !rows[0]) throw appError("Pagamento não encontrado.", 404);
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
  const params = [];
  let where = user.role === "admin" ? "true" : "p.active=true";
  if (id) {
    params.push(validUuid(id, "Plano"));
    where += ` and p.id=$1`;
  }
  const { rows } = await query(
    `select p.id,p.name,p.price,p.billing_cycle,p.benefits,p.active,
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
      "select id,kind,title,body,data,action_url,metadata,read_at,created_at from public.notifications where profile_id=$1 order by created_at desc limit 100",
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
      "select 1 from public.appointments where client_id=$1 and professional_id=$2 limit 1",
      [id, professionalId],
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
  const appointmentFilter =
    user.role === "professional" ? "and a.professional_id=$2" : "";
  const appointmentParams =
    user.role === "professional" ? [id, await professionalIdFor(user)] : [id];
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
      `select a.id,a.starts_at,a.ends_at,a.status,a.notes,a.estimated_value,a.intake_data,s.name as service,pp.full_name as professional from public.appointments a join public.services s on s.id=a.service_id join public.professionals pr on pr.id=a.professional_id join public.profiles pp on pp.id=pr.profile_id where a.client_id=$1 ${appointmentFilter} order by a.starts_at desc`,
      appointmentParams,
    ),
    user.role === "admin"
      ? query(
          `select id,amount,paid_amount,method,status,paid_at,created_at from public.payments where client_id=$1 order by created_at desc`,
          [id],
        )
      : Promise.resolve({ rows: [] }),
    user.role === "admin"
      ? query(
          `select s.id,s.status,s.starts_at,s.renews_at,s.expires_at,p.name,p.price from public.subscriptions s join public.plans p on p.id=s.plan_id where s.client_id=$1 order by s.created_at desc`,
          [id],
        )
      : Promise.resolve({ rows: [] }),
    user.role === "admin"
      ? query(
          `select c.code,c.description,u.used_at,u.discount_amount from public.coupon_usage u join public.coupons c on c.id=u.coupon_id where u.client_id=$1 order by u.used_at desc`,
          [id],
        )
      : Promise.resolve({ rows: [] }),
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
    user.role === "admin"
      ? query(
          "select id,code,invited_name,invited_phone,status,reward_amount,created_at from public.referrals where referrer_client_id=$1 order by created_at desc",
          [id],
        )
      : Promise.resolve({ rows: [] }),
    user.role === "admin"
      ? query(
          `select consent_type,accepted,accepted_at,revoked_at,policy_version from public.privacy_consents where profile_id=$1`,
          [profile.rows[0].profile_id],
        )
      : Promise.resolve({ rows: [] }),
    user.role === "admin"
      ? query(
          `select id,status,reason,requested_at,reviewed_at,reviewed_by
           from public.account_deletion_requests where profile_id=$1
           order by requested_at desc limit 1`,
          [profile.rows[0].profile_id],
        )
      : Promise.resolve({ rows: [] }),
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

async function adminDashboard(user) {
  requireRole(user, ["admin"]);
  const { rows } = await query(`select
    count(*) filter(where a.starts_at::date=current_date)::int as appointments_today,
    count(*) filter(where a.starts_at>=date_trunc('week',now()) and a.starts_at<date_trunc('week',now())+interval '7 days')::int as appointments_week,
    count(*) filter(where a.status='cancelled' and date_trunc('month',a.starts_at)=date_trunc('month',now()))::int as cancelled_month,
    count(*) filter(where a.status='no_show' and date_trunc('month',a.starts_at)=date_trunc('month',now()))::int as no_show_month,
    (select coalesce(sum(paid_amount),0) from public.payments where status='paid' and date_trunc('month',paid_at)=date_trunc('month',now())) as monthly_revenue,
    (select count(*)::int from public.clients where date_trunc('month',created_at)=date_trunc('month',now())) as new_clients,
    (select count(*)::int from public.subscriptions where status='active') as active_plans,
    (select count(*)::int from public.payments where status in ('pending','under_review','partial')) as pending_payments
    from public.appointments a`);
  const [services, professionals] = await Promise.all([
    query(
      `select s.name,count(*)::int as total from public.appointments a join public.services s on s.id=a.service_id group by s.id order by total desc limit 5`,
    ),
    query(
      `select p.full_name,count(*)::int as total from public.appointments a join public.professionals pr on pr.id=a.professional_id join public.profiles p on p.id=pr.profile_id group by p.id order by total desc limit 5`,
    ),
  ]);
  return {
    metrics: rows[0],
    topServices: services.rows,
    topProfessionals: professionals.rows,
  };
}

async function adminProfessionals(user) {
  requireRole(user, ["admin"]);
  const { rows } =
    await query(`select pr.id,p.full_name,p.phone,p.avatar_url,pr.bio,pr.specialties,pr.commission_rate,pr.active,pr.hired_at,
    count(a.id)::int as appointments,coalesce(round(avg(r.rating)::numeric,1),0) as rating
    from public.professionals pr join public.profiles p on p.id=pr.profile_id
    left join public.appointments a on a.professional_id=pr.id left join public.reviews r on r.professional_id=pr.id
    group by pr.id,p.id order by p.full_name`);
  return rows;
}

async function adminServices(user) {
  requireRole(user, ["admin"]);
  const { rows } =
    await query(`select s.id,s.name,s.description,s.duration_minutes,s.base_price,s.deposit_amount,s.active,hm.name as method,sc.name as category,
    count(a.id)::int as appointments from public.services s left join public.hair_methods hm on hm.id=s.hair_method_id
    left join public.service_categories sc on sc.id=s.category_id left join public.appointments a on a.service_id=s.id
    group by s.id,hm.name,sc.name order by s.name`);
  return rows;
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
  const { rows } = await query(
    "select value,updated_at from public.business_settings where key='business_profile'",
  );
  return { ...(rows[0]?.value || {}), updatedAt: rows[0]?.updated_at || null };
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
  if (resource === "professional-commissions")
    return professionalCommissions(user);
  if (resource === "professional-services") return professionalServices(user);
  if (resource === "professional-records") return professionalRecords(user);
  if (resource === "professional-availability")
    return availabilityResource(user);
  if (resource === "admin-dashboard") return adminDashboard(user);
  if (resource === "admin-professionals") return adminProfessionals(user);
  if (resource === "admin-services") return adminServices(user);
  if (resource === "admin-commissions") return adminCommissions(user);
  if (resource === "admin-settings") return adminSettings(user);
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
    return (await query("select * from public.coupons order by code")).rows;
  }
  throw appError("Recurso não encontrado.", 404);
}

async function updateProfile(user, body) {
  const fullName = clean(body.fullName);
  const email = clean(body.email).toLowerCase();
  const phone = clean(body.phone);
  const avatarUrl = clean(body.avatarUrl);
  if (fullName.length < 3) throw appError("Informe o nome completo.");
  if (!/^\S+@\S+\.\S+$/.test(email))
    throw appError("Informe um e-mail válido.");
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
    await client.query(
      "update auth.users set email=$1,phone=$2,updated_at=now() where id=$3",
      [email, phone || null, user.id],
    );
    const { rows } = await client.query(
      `update public.profiles set full_name=$1,phone=$2,birth_date=$3,instagram=$4,address=$5,avatar_url=coalesce($6,avatar_url),updated_at=now() where id=$7 returning *`,
      [
        fullName,
        phone || null,
        body.birthDate || null,
        clean(body.instagram) || null,
        JSON.stringify(body.address || {}),
        avatarUrl || null,
        user.id,
      ],
    );
    if (!rows[0]) throw appError("Perfil não encontrado.", 404);
    if (user.role === "client") {
      const clientProfile = await client.query(
        "update public.clients set preferences=$1,personal_notes=$2 where profile_id=$3",
        [
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
      `insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_data) values($1,'update','profile',$1,$2)`,
      [user.id, JSON.stringify({ fullName, phone, email })],
    );
    return rows[0];
  });
}

async function planCoupon(client, code, clientId, plan) {
  if (!clean(code))
    return { coupon: null, discount: 0, total: Number(plan.price) };
  const { rows } = await client.query(
    `select c.*,(select count(*)::int from public.coupon_usage u where u.coupon_id=c.id and u.status='used') as total_uses,(select count(*)::int from public.coupon_usage u where u.coupon_id=c.id and u.client_id=$2 and u.status='used') as client_uses from public.coupons c where upper(c.code)=upper($1) and c.active limit 1`,
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

export async function anonymizeClientAccount(client, { requestId, adminId }) {
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

  await client.query(
    `update auth.users set email=$2,phone=null,encrypted_password=null,raw_user_meta_data='{}',updated_at=now()
     where id=$1`,
    [
      target.profile_id,
      `deleted+${String(target.profile_id).replace(/-/g, "")}@anonymized.invalid`,
    ],
  );
  await client.query(
    `update public.profiles set full_name='Conta anonimizada',phone=null,avatar_url=null,birth_date=null,
     instagram=null,address='{}',notification_preferences='{}',account_status='anonymized',updated_at=now()
     where id=$1`,
    [target.profile_id],
  );
  await client.query(
    `update public.clients set cpf=null,source='Conta anonimizada',preferences='{}',technical_notes=null,personal_notes=null,sumup_customer_id=null
     where id=$1`,
    [target.client_id],
  );
  await client.query(
    `update public.appointments set notes=null,intake_data='{}',cancellation_reason=null
     where client_id=$1`,
    [target.client_id],
  );
  await client.query(
    `update public.reschedule_requests rr set reason=null,response_note=null
     from public.appointments a where a.id=rr.appointment_id and a.client_id=$1`,
    [target.client_id],
  );
  await client.query(
    `update public.quotes set notes=null,intake_data='{}' where client_id=$1`,
    [target.client_id],
  );
  await client.query(
    `update public.technical_records set recommendations=null,internal_notes=null where client_id=$1`,
    [target.client_id],
  );
  await client.query(
    `update public.saved_cards set holder_name='REMOVIDO',external_token=null,active=false,is_default=false
     where client_id=$1`,
    [target.client_id],
  );
  await client.query(
    "update public.reviews set comment=null,published=false where client_id=$1",
    [target.client_id],
  );
  await client.query(
    "update public.referrals set invited_name=null,invited_phone=null where referrer_client_id=$1",
    [target.client_id],
  );
  await client.query(
    `delete from public.appointment_messages m using public.appointments a
     where a.id=m.appointment_id and a.client_id=$1`,
    [target.client_id],
  );
  await client.query(
    "delete from public.client_internal_notes where client_id=$1",
    [target.client_id],
  );
  await client.query(
    "delete from public.client_photos where client_id=$1",
    [target.client_id],
  );
  await client.query(
    "delete from public.before_after_gallery where client_id=$1",
    [target.client_id],
  );
  await client.query(
    "delete from public.notifications where profile_id=$1",
    [target.profile_id],
  );
  await client.query(
    "delete from public.notification_preferences where profile_id=$1",
    [target.profile_id],
  );
  const completed = await client.query(
    `update public.account_deletion_requests
     set status='completed',reviewed_at=now(),reviewed_by=$2
     where id=$1 and status='under_review' returning *`,
    [requestId, adminId],
  );
  await client.query(
    `insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_data)
     values($1,'account_anonymized','account_deletion_request',$2,$3)`,
    [
      adminId,
      requestId,
      JSON.stringify({
        profile_id: target.profile_id,
        client_id: target.client_id,
        removed_media: mediaUrls.length,
        financial_records_preserved: true,
      }),
    ],
  );
  return { request: completed.rows[0], mediaUrls, cardInstruments };
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
    anonymizeClientAccount(client, { requestId, adminId: user.id }),
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
      if (payment.status === status)
        return { payment, contact: null, idempotent: true };
      if (payment.status === "paid" && status !== "refunded")
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
      `update public.plans set name=$1,price=$2,billing_cycle=$3,benefits=$4,active=$5 where id=$6 returning *`,
      [
        name,
        price,
        clean(body.billingCycle) || "monthly",
        JSON.stringify(benefits),
        body.active !== false,
        id,
      ],
    );
    if (!rows[0]) throw appError("Plano não encontrado.", 404);
    return rows[0];
  }
  const { rows } = await query(
    `insert into public.plans(name,price,billing_cycle,benefits,active) values($1,$2,$3,$4,true) returning *`,
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
  const code = clean(body.code).toUpperCase();
  const description = clean(body.description);
  const value = money(body.discountValue);
  if (code.length < 3 || description.length < 3 || value <= 0)
    throw appError("Preencha código, descrição e desconto.");
  if (body.id) {
    const id = validUuid(body.id, "Cupom");
    const { rows } = await query(
      `update public.coupons set code=$1,description=$2,discount_type=$3,discount_value=$4,starts_at=$5,ends_at=$6,usage_limit=$7,active=$8 where id=$9 returning *`,
      [
        code,
        description,
        clean(body.discountType) || "percentage",
        value,
        body.startsAt || null,
        body.endsAt || null,
        body.usageLimit || null,
        body.active !== false,
        id,
      ],
    );
    if (!rows[0]) throw appError("Cupom não encontrado.", 404);
    return rows[0];
  }
  const { rows } = await query(
    `insert into public.coupons(code,description,discount_type,discount_value,starts_at,ends_at,usage_limit,active) values($1,$2,$3,$4,$5,$6,$7,true) returning *`,
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

async function blockSchedule(user, body) {
  requireRole(user, ["professional"]);
  const professionalId = await professionalIdFor(user);
  const { period, error } = schedulePeriod(body.startsAt, body.endsAt);
  if (error) throw appError(error);
  return transaction(async (client) => {
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

async function saveAdminSettings(user, body) {
  requireRole(user, ["admin"]);
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

async function mutate(user, resource, body) {
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
  if (resource === "referrals") return createReferral(user, body);
  if (resource === "notification-read") return markNotification(user, body);
  if (resource === "admin-payment") return updateManualPayment(user, body);
  if (resource === "client-note") return addClientNote(user, body);
  if (resource === "client-status") return updateClientStatus(user, body);
  if (resource === "admin-plan") return savePlan(user, body);
  if (resource === "admin-coupon") return saveCoupon(user, body);
  if (resource === "blocked-schedule") return blockSchedule(user, body);
  if (resource === "admin-settings") return saveAdminSettings(user, body);
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
    const data = await mutate(user, resource, getBody(req));
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
