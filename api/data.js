import { query, transaction } from "../server/lib/db.js";
import { requireUser } from "../server/lib/auth.js";
import {
  appointmentRange,
  appointmentStatuses,
  canUpdateAppointmentStatus,
} from "../server/lib/appointment-rules.js";
import {
  isAvailabilityDate,
  periodFitsSchedule,
  schedulePeriod,
  scheduleSlots,
  slotsWithConflicts,
  weekdayForDate,
} from "../server/lib/availability-rules.js";
import {
  calculateInventoryChanges,
  technicalRecordAppointmentStatuses,
  technicalRecordInput,
} from "../server/lib/technical-record-rules.js";
import {
  deleteFromCloudinary,
  isConfiguredCloudinaryUrl,
  notifyAppointment,
  sendEmail,
  sendWhatsApp,
  getMessageTemplate,
} from "../server/lib/integrations.js";
import {
  appError,
  getBody,
  handleError,
  methodNotAllowed,
  send,
} from "../server/lib/http.js";

async function ensureServicesVisibilityColumn() {
  await query(
    `alter table public.services add column if not exists show_online_booking boolean not null default true;
     alter table public.services add column if not exists is_free boolean not null default false`,
  );
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const appointmentSelect = `
  select a.id, a.booking_code, a.starts_at, a.ends_at, a.status, a.notes, a.estimated_value,
    a.original_value, a.discount_amount, a.intake_data,
    to_char(a.starts_at at time zone 'America/Sao_Paulo','DD/MM/YYYY') as date,
    to_char(a.starts_at at time zone 'America/Sao_Paulo','HH24:MI') as time,
    s.id as service_id, s.name as service, s.duration_minutes,
    p.id as professional_id, pp.full_name as professional, pp.phone as professional_phone,
    pp.avatar_url as professional_avatar_url,
    c.id as client_id, cp.full_name as client, cp.phone as client_phone,
    cp.avatar_url as client_avatar_url,
    l.name as location
  from public.appointments a
  join public.services s on s.id = a.service_id
  join public.professionals p on p.id = a.professional_id
  join public.profiles pp on pp.id = p.profile_id
  join public.clients c on c.id = a.client_id
  join public.profiles cp on cp.id = c.profile_id
  left join public.salon_locations l on l.id = a.location_id
`;

function formatAppointment(row) {
  if (!row) return row;
  const phone = row.client_phone || "";
  const last4 = phone.replace(/\D/g, "").slice(-4);
  const clientWhatsappTitle = last4 ? `Cliente WhatsApp ${last4}` : "Cliente WhatsApp";

  return {
    ...row,
    client_name: row.client,
    client_whatsapp_title: clientWhatsappTitle,
    value: Number(row.estimated_value || 0).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    }),
    duration:
      row.duration_minutes >= 60
        ? `${Math.floor(row.duration_minutes / 60)}h${row.duration_minutes % 60 ? String(row.duration_minutes % 60).padStart(2, "0") : ""}`
        : `${row.duration_minutes}min`,
  };
}

async function appointmentScope(user, alias = "a") {
  if (user.role === "client")
    return {
      sql: `${alias}.client_id in (select id from public.clients where profile_id = $1)`,
      params: [user.id],
    };
  if (user.role === "professional")
    return {
      sql: `${alias}.professional_id in (select id from public.professionals where profile_id = $1)`,
      params: [user.id],
    };
  return { sql: "true", params: [] };
}

async function getResource(req, res, user, resource) {
  if (resource === "bootstrap") {
    await ensureServicesVisibilityColumn();
    const [services, professionals, locations, points, inventory] = await Promise.all([
      query(
        `select id, name, description, duration_minutes, base_price, deposit_amount,
          coalesce(is_free,false) as is_free,
          coalesce(show_online_booking,true) as show_online_booking,
          coalesce(offer_inventory_items,false) as offer_inventory_items,
          category_id,
          hair_method_id
         from public.services
         where active and ($1::text <> 'client' or coalesce(show_online_booking,true))
         order by base_price`,
        [user.role],
      ),
      query(
        `select p.id, pp.full_name as name, pp.avatar_url as photo, p.specialties, coalesce(round(avg(r.rating)::numeric,1),5) as rating from public.professionals p join public.profiles pp on pp.id=p.profile_id left join public.reviews r on r.professional_id=p.id where p.active group by p.id,pp.full_name,pp.avatar_url order by pp.full_name`,
      ),
      query(
        `select id,name,address from public.salon_locations where active order by name`,
      ),
      user.role === "client"
        ? query(
            `select coalesce(sum(lp.points),0)::int as points from public.loyalty_points lp join public.clients c on c.id=lp.client_id where c.profile_id=$1`,
            [user.id],
          )
        : Promise.resolve({ rows: [{ points: 0 }] }),
      query(
        `select id, category as name, category, color, shade, length_cm, texture, weight_grams, quantity, suggested_price, category_id, hair_method_id, active
         from public.hair_inventory
         where archived = false and active = true and quantity > 0`
      ),
    ]);
    return send(res, 200, {
      services: services.rows,
      professionals: professionals.rows,
      locations: locations.rows,
      points: points.rows[0].points,
      inventoryItems: inventory.rows,
    });
  }

  if (resource === "appointments") {
    const scope = await appointmentScope(user);
    const { range, error } = appointmentRange(req.query);
    if (error) throw appError(error);
    const params = [...scope.params];
    const filters = [scope.sql];
    if (range) {
      params.push(range.dateFrom);
      const fromParam = params.length;
      params.push(range.dateTo);
      const toParam = params.length;
      filters.push(
        `a.starts_at >= ($${fromParam}::date::timestamp at time zone 'America/Sao_Paulo')`,
        `a.starts_at < ($${toParam}::date::timestamp at time zone 'America/Sao_Paulo')`,
      );
    }
    const { rows } = await query(
      `${appointmentSelect} where ${filters.join(" and ")} order by a.starts_at ${range ? "asc" : "desc"} limit ${range ? 500 : 100}`,
      params,
    );
    return send(res, 200, {
      appointments: rows.map(formatAppointment),
      range,
    });
  }

  if (resource === "appointment-detail") {
    const user = await requireUser(req, ["admin", "professional", "client"]);
    const id = String(req.query?.id || "");
    if (!uuidPattern.test(id)) throw appError("Agendamento inválido.");
    const scopeSql = user.role === "admin"
      ? "true"
      : user.role === "professional"
        ? `a.professional_id = (select id from public.professionals where profile_id=$2)`
        : `a.client_id = (select id from public.clients where profile_id=$2)`;
    const params = [id];
    if (user.role !== "admin") params.push(user.id);
    const { rows } = await query(`${appointmentSelect} where a.id=$1 and ${scopeSql}`, params);
    const appointment = rows[0];
    if (!appointment) throw appError("Agendamento não encontrado.", 404);
    const [history, payments, messages, notifications, photos, record] =
      await Promise.all([
        query(
          `select h.id,h.from_status,h.to_status,h.note,h.created_at,p.full_name as actor
           from public.appointment_status_history h
           left join public.profiles p on p.id=h.changed_by
           where h.appointment_id=$1
           order by h.created_at desc`,
          [id],
        ),
        query(
          `select pay.id,pay.amount,pay.original_amount,pay.discount_amount,pay.paid_amount,pay.method,pay.payment_method,
             pay.provider,pay.status,pay.provider_status,pay.failure_reason,pay.receipt_url,pay.paid_at,pay.created_at,pay.updated_at,
             coalesce(json_agg(json_build_object(
               'old_status',ph.old_status,
               'new_status',ph.new_status,
               'notes',ph.notes,
               'created_at',ph.created_at,
               'actor',pp.full_name
             ) order by ph.created_at desc) filter(where ph.payment_id is not null),'[]') as history
           from public.payments pay
           left join public.payment_status_history ph on ph.payment_id=pay.id
           left join public.profiles pp on pp.id=ph.changed_by
           where pay.appointment_id=$1
           group by pay.id
           order by pay.created_at desc`,
          [id],
        ),
        query(
          `select m.id,m.message,m.message_type,m.visible_to_client,m.created_at,p.full_name as sender
           from public.appointment_messages m
           left join public.profiles p on p.id=m.sender_profile_id
           where m.appointment_id=$1
           order by m.created_at desc`,
          [id],
        ),
        query(
          `select id,kind,title,body,read_at,created_at
           from public.notifications
           where data->>'appointment_id'=$1 or metadata->>'appointment_id'=$1
           order by created_at desc
           limit 50`,
          [id],
        ),
        query(
          `select id,kind,storage_path,created_at
           from public.client_photos
           where appointment_id=$1
           order by created_at desc`,
          [id],
        ),
        query(
          `select tr.id,tr.created_at,tr.next_maintenance_date,tr.final_value,tr.payment_status,
             tr.recommendations,tr.internal_notes,hm.name as method
           from public.technical_records tr
           left join public.hair_methods hm on hm.id=tr.hair_method_id
           where tr.appointment_id=$1
           limit 1`,
          [id],
        ),
      ]);
    return send(res, 200, {
      appointment: formatAppointment(appointment),
      history: history.rows,
      payments: payments.rows,
      messages: messages.rows,
      notifications: notifications.rows,
      photos: photos.rows,
      technicalRecord: record.rows[0] || null,
    });
  }

  if (resource === "availability") {
    await ensureServicesVisibilityColumn();
    const date = String(req.query?.date || "");
    const serviceId = String(req.query?.serviceId || "");
    const professionalId = String(req.query?.professionalId || "");
    const firstAvailable = String(req.query?.firstAvailable || "") === "true";
    if (!isAvailabilityDate(date)) throw appError("Data inválida.");
    if (!uuidPattern.test(serviceId)) throw appError("Serviço inválido.");
    if (professionalId && !uuidPattern.test(professionalId))
      throw appError("Profissional inválida.");
    if ((!professionalId && !firstAvailable) || (professionalId && firstAvailable))
      throw appError("Informe uma profissional ou solicite a primeira disponível.");
    const { rows: services } = await query(
      "select id,duration_minutes,coalesce(show_online_booking,true) as show_online_booking from public.services where id=$1 and active and ($2::text <> 'client' or coalesce(show_online_booking,true)) limit 1",
      [serviceId, user.role],
    );
    if (!services[0]) throw appError("Serviço não encontrado.");
    const { rows: professionals } = await query(
      `select p.id,pp.full_name
       from public.professionals p
       join public.profiles pp on pp.id=p.profile_id
       join public.professional_services ps on ps.professional_id=p.id and ps.service_id=$1
       where p.active and ($2::uuid is null or p.id=$2)
       order by pp.full_name`,
      [serviceId, professionalId || null],
    );
    if (!professionals.length)
      throw appError("Nenhuma profissional realiza este serviço.", 404);

    const weekday = weekdayForDate(date);
    let firstCandidate = null;
    for (const professional of professionals) {
      const [availability, conflicts] = await Promise.all([
        query(
          `select starts_at,ends_at,active from public.professional_availability
           where professional_id=$1 and weekday=$2 and active order by starts_at`,
          [professional.id, weekday],
        ),
        query(
          `select starts_at,ends_at from public.appointments
           where professional_id=$1 and status not in ('cancelled','no_show')
             and starts_at < (($2::date + interval '1 day')::timestamp at time zone 'America/Sao_Paulo')
             and ends_at > ($2::date::timestamp at time zone 'America/Sao_Paulo')
           union all
           select starts_at,ends_at from public.blocked_schedule
           where professional_id=$1
             and starts_at < (($2::date + interval '1 day')::timestamp at time zone 'America/Sao_Paulo')
             and ends_at > ($2::date::timestamp at time zone 'America/Sao_Paulo')`,
          [professional.id, date],
        ),
      ]);
      const times = scheduleSlots(
        availability.rows,
        services[0].duration_minutes,
      );
      const slots = slotsWithConflicts(
        date,
        times,
        services[0].duration_minutes,
        conflicts.rows,
      );
      const candidate = { professional, slots };
      if (!firstCandidate) firstCandidate = candidate;
      if (!firstAvailable || slots.some((slot) => slot.available)) {
        return send(res, 200, candidate);
      }
    }
    return send(res, 200, firstCandidate);
  }

  if (resource === "validate-coupon") {
    const code = String(req.query.code || "").trim();
    const serviceId = String(req.query.serviceId || "");
    const amount = Number(req.query.amount || 0);
    const { rows } = await query(
      "select id from public.clients where profile_id=$1",
      [user.id],
    );
    const clientId = rows[0]?.id;
    if (!clientId) throw appError("Cliente não encontrado.");

    try {
      const result = await validateCoupon({ query }, {
        code,
        clientId,
        amount,
        serviceId,
      });
      return send(res, 200, {
        valid: true,
        couponId: result.coupon?.id || null,
        discount: result.discount,
        total: result.total,
      });
    } catch (err) {
      return send(res, 200, {
        valid: false,
        discount: 0,
        total: amount,
        error: err.message,
      });
    }
  }

  if (resource === "clients") {
    await requireUser(req, ["professional", "admin"]);
    const clientParams = [];
    let clientWhere = "";
    if (user.role === "professional") {
      clientParams.push(user.id);
      clientWhere = `where exists(select 1 from public.appointments a join public.professionals pr on pr.id=a.professional_id where a.client_id=c.id and pr.profile_id=$1) or (c.preferences->>'created_by_professional' = $1::text)`;
    }
    const { rows } = await query(
      `
      select c.id, p.full_name as name, p.phone, p.avatar_url as photo, c.lifetime_value,
        coalesce((select to_char(max(a.starts_at),'DD/MM/YYYY') from public.appointments a where a.client_id=c.id and a.status='completed'),'—') as last,
        coalesce((select to_char(min(a.starts_at),'DD/MM/YYYY') from public.appointments a where a.client_id=c.id and a.starts_at>now() and a.status in ('confirmed','pending_deposit')),'—') as next,
        coalesce((select sum(points) from public.loyalty_points lp where lp.client_id=c.id),0)::int as points
      from public.clients c join public.profiles p on p.id=c.profile_id ${clientWhere} order by p.full_name
    `,
      clientParams,
    );
    return send(res, 200, {
      clients: rows.map((row) => ({
        ...row,
        ticket: Number(row.lifetime_value || 0).toLocaleString("pt-BR", {
          style: "currency",
          currency: "BRL",
        }),
        tag: Number(row.lifetime_value) > 10000 ? "VIP" : "Recorrente",
      })),
    });
  }

  if (resource === "inventory") {
    await requireUser(req, ["professional", "admin"]);
    await query("alter table public.hair_inventory add column if not exists archived boolean default false");
    await query("alter table public.hair_inventory add column if not exists category_id uuid references public.service_categories(id) on delete set null");
    await query("alter table public.hair_inventory add column if not exists hair_method_id uuid references public.hair_methods(id) on delete set null");
    await query("alter table public.hair_inventory add column if not exists active boolean default true");

    await query(`
      create table if not exists public.hair_colors (
        id uuid primary key default uuid_generate_v4(),
        name text unique not null,
        created_at timestamptz default now()
      );
    `);
    const countRes = await query("select count(*) from public.hair_colors");
    if (parseInt(countRes.rows[0].count, 10) === 0) {
      await query(`
        insert into public.hair_colors (name) values
        ('Preto'), ('Castanho Escuro'), ('Castanho Médio'), ('Castanho Claro'),
        ('Loiro Escuro'), ('Loiro Médio'), ('Loiro Claro'), ('Loiro Claríssimo'),
        ('Ruivo'), ('Platinado')
        on conflict do nothing;
      `);
    }

    const [invRes, catRes, metRes, colRes] = await Promise.all([
      query(
        `select id, code, supplier, category as item, category, color, shade, length_cm, texture, weight_grams, lot,
                quantity as qty, minimum_stock as min, unit_cost, suggested_price,
                case when quantity<=minimum_stock then 'Estoque baixo' else 'Em estoque' end as status,
                archived, category_id, hair_method_id, active
         from public.hair_inventory
         where archived = false
         order by category,color`,
      ),
      query("select id, name, parent_id from public.service_categories order by sort_order, name"),
      query("select id, name, parent_id, category_id from public.hair_methods order by name"),
      query("select id, name from public.hair_colors order by name"),
    ]);

    return send(res, 200, {
      inventory: invRes.rows.map((row) => ({
        ...row,
        detail: [row.color, row.shade, row.length_cm ? (String(row.length_cm).toLowerCase().includes('cm') ? String(row.length_cm) : `${row.length_cm} cm`) : "", row.texture].filter(Boolean).join(" • "),
        cost: Number(row.unit_cost || 0).toLocaleString("pt-BR", {
          style: "currency",
          currency: "BRL",
        }),
        margin: row.suggested_price
          ? `${Math.round((1 - Number(row.unit_cost) / Number(row.suggested_price)) * 100)}%`
          : "—",
      })),
      categories: catRes.rows,
      methods: metRes.rows,
      colors: colRes.rows,
    });
  }

  if (resource === "dashboard") {
    await requireUser(req, ["professional", "admin"]);
    const { rows } = await query(`select
      coalesce(sum(case when pay.status='paid' and date_trunc('month',pay.paid_at)=date_trunc('month',now()) then pay.amount end),0) as monthly_revenue,
      (select count(*) from public.appointments where starts_at::date=current_date) as today_appointments,
      (select count(*) from public.clients) as clients,
      (select count(*) from public.appointments where starts_at>now() and status in ('confirmed','pending_deposit')) as future_appointments
      from public.payments pay`);
    return send(res, 200, { dashboard: rows[0] });
  }

  if (resource === "notifications") {
    const { rows } = await query(
      `select id,kind,title,body,read_at,created_at from public.notifications where profile_id=$1 order by created_at desc limit 50`,
      [user.id],
    );
    return send(res, 200, { notifications: rows });
  }

  if (resource === "reschedule-requests") {
    if (!["client", "professional", "admin"].includes(user.role))
      throw appError("Acesso negado.", 403);
    const params = [];
    let scope = "true";
    if (user.role === "client") {
      params.push(user.id);
      scope = "c.profile_id=$1";
    }
    if (user.role === "professional") {
      params.push(user.id);
      scope = "pr.profile_id=$1";
    }
    const { rows } = await query(
      `
      select rr.*,a.service_id,a.professional_id,a.client_id,s.name as service,cp.full_name as client,
        pp.full_name as professional,cp.phone as client_phone
      from public.reschedule_requests rr
      join public.appointments a on a.id=rr.appointment_id
      join public.services s on s.id=a.service_id
      join public.clients c on c.id=a.client_id join public.profiles cp on cp.id=c.profile_id
      join public.professionals pr on pr.id=a.professional_id join public.profiles pp on pp.id=pr.profile_id
      where ${scope} order by case when rr.status='pending' then 0 else 1 end,rr.created_at desc
    `,
      params,
    );
    return send(res, 200, { requests: rows });
  }
  throw appError("Recurso não encontrado.", 404);
}

async function validateCoupon(client, { code, clientId, amount, serviceId }) {
  if (!String(code || "").trim())
    return { coupon: null, discount: 0, total: amount };
  const { rows } = await client.query(
    `
    select c.*,
      (select count(*)::int from public.coupon_usage cu where cu.coupon_id=c.id and cu.status='used') as total_uses,
      (select count(*)::int from public.coupon_usage cu where cu.coupon_id=c.id and cu.client_id=$2 and cu.status='used') as client_uses
    from public.coupons c where upper(c.code)=upper($1) and c.active and not c.archived limit 1
  `,
    [String(code).trim(), clientId],
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
  const clientIds = target.client_ids || target.clients || [];
  const serviceIds = target.service_ids || target.services || [];
  if (
    Array.isArray(clientIds) &&
    clientIds.length &&
    !clientIds.includes(clientId)
  )
    throw appError("Este cupom não está disponível para sua conta.");
  if (
    Array.isArray(serviceIds) &&
    serviceIds.length &&
    !serviceIds.includes(serviceId)
  )
    throw appError("Este cupom não se aplica ao serviço escolhido.");
  if (target.once_per_client && Number(coupon.client_uses) > 0)
    throw appError("Este cupom já foi utilizado pela sua conta.");
  if (Number(target.minimum_value || 0) > amount)
    throw appError(
      `Valor mínimo para este cupom: ${Number(target.minimum_value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}.`,
    );
  const discount =
    coupon.discount_type === "percentage"
      ? Math.min(amount, (amount * Number(coupon.discount_value || 0)) / 100)
      : Math.min(amount, Number(coupon.discount_value || 0));
  return {
    coupon,
    discount: Number(discount.toFixed(2)),
    total: Number(Math.max(0, amount - discount).toFixed(2)),
  };
}

async function resolveAppointmentSlot(client, {
  serviceId,
  professionalId,
  startsAt,
  excludeAppointmentId = null,
}) {
  if (!uuidPattern.test(String(serviceId || "")))
    throw appError("ServiÃ§o invÃ¡lido.");
  if (!uuidPattern.test(String(professionalId || "")))
    throw appError("Profissional invÃ¡lida.");
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime()))
    throw appError("Data e horÃ¡rio invÃ¡lidos.");
  const {
    rows: [service],
  } = await client.query(
    "select * from public.services where id=$1 and active",
    [serviceId],
  );
  if (!service) throw appError("ServiÃ§o nÃ£o encontrado.");
  const professionalSelect = `select p.id,p.profile_id,pp.full_name,pp.phone,u.email from public.professionals p join public.profiles pp on pp.id=p.profile_id left join auth.users u on u.id=pp.id`;
  const {
    rows: [professional],
  } = await client.query(
    `${professionalSelect}
     join public.professional_services ps on ps.professional_id=p.id and ps.service_id=$2
     where p.id=$1 and p.active`,
    [professionalId, serviceId],
  );
  if (!professional) throw appError("Profissional nÃ£o encontrada.");
  await client.query("select pg_advisory_xact_lock(hashtext($1))", [
    professional.id,
  ]);
  const endsAt = new Date(start.getTime() + service.duration_minutes * 60_000);
  const { period, error: periodError } = schedulePeriod(start, endsAt);
  if (periodError) throw appError(periodError);
  const schedule = await client.query(
    `select starts_at,ends_at,active from public.professional_availability
     where professional_id=$1 and weekday=$2 and active`,
    [professional.id, period.weekday],
  );
  if (!periodFitsSchedule(period, schedule.rows))
    throw appError("O horÃ¡rio escolhido estÃ¡ fora da jornada da profissional.");
  const conflict = await client.query(
    `select 1 from (
      select 1 from public.appointments
       where professional_id=$1
         and ($4::uuid is null or id<>$4)
         and status not in ('cancelled','no_show')
         and tstzrange(starts_at,ends_at,'[)') && tstzrange($2,$3,'[)')
      union all
      select 1 from public.blocked_schedule
       where professional_id=$1
         and tstzrange(starts_at,ends_at,'[)') && tstzrange($2,$3,'[)')
    ) conflicts limit 1`,
    [
      professional.id,
      start.toISOString(),
      endsAt.toISOString(),
      excludeAppointmentId,
    ],
  );
  if (conflict.rowCount)
    throw appError(
      "Este horÃ¡rio acabou de ficar indisponÃ­vel. Escolha outro.",
      409,
    );
  return { service, professional, startsAt: start, endsAt };
}

async function createAppointment(req, res, user, body) {
  if (!["client", "admin", "professional"].includes(user.role))
    throw appError(
      "Somente clientes, profissionais e administradores podem criar agendamentos.",
      403,
    );
  const startsAt = new Date(body.startsAt);
  if (Number.isNaN(startsAt.getTime()))
    throw appError("Data e horário inválidos.");
  if (!uuidPattern.test(String(body.serviceId || "")))
    throw appError("Serviço inválido.");
  if (!uuidPattern.test(String(body.professionalId || "")))
    throw appError("Profissional inválida.");
  const appointment = await transaction(async (client) => {
    let clientId = body.clientId;
    if (user.role === "client") {
      const { rows } = await client.query(
        "select id from public.clients where profile_id=$1",
        [user.id],
      );
      clientId = rows[0]?.id;
    }
    if (!clientId) throw appError("Cliente não encontrado.");
    if (!uuidPattern.test(String(clientId))) throw appError("Cliente inválida.");
    const {
      rows: [service],
    } = await client.query(
      "select * from public.services where id=$1 and active",
      [body.serviceId],
    );
    if (!service) throw appError("Serviço não encontrado.");
    if (user.role === "client" && service.show_online_booking === false)
      throw appError("Este serviço não está disponível para agendamento online.");
    const professionalSelect = `select p.id,p.profile_id,pp.full_name,pp.phone,u.email from public.professionals p join public.profiles pp on pp.id=p.profile_id left join auth.users u on u.id=pp.id`;
    const {
      rows: [professional],
    } = await client.query(
      `${professionalSelect}
       join public.professional_services ps on ps.professional_id=p.id and ps.service_id=$2
       where p.id=$1 and p.active`,
      [body.professionalId, body.serviceId],
    );
    if (!professional) throw appError("Profissional não encontrada.");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [
      professional.id,
    ]);
    const endsAt = new Date(
      startsAt.getTime() + service.duration_minutes * 60_000,
    );
    const { period, error: periodError } = schedulePeriod(startsAt, endsAt);
    if (periodError) throw appError(periodError);
    const schedule = await client.query(
      `select starts_at,ends_at,active from public.professional_availability
       where professional_id=$1 and weekday=$2 and active`,
      [professional.id, period.weekday],
    );
    if (!periodFitsSchedule(period, schedule.rows))
      throw appError("O horário escolhido está fora da jornada da profissional.");
    const conflict = await client.query(
      `select 1 from (
      select 1 from public.appointments where professional_id=$1 and status not in ('cancelled','no_show') and tstzrange(starts_at,ends_at,'[)') && tstzrange($2,$3,'[)')
      union all
      select 1 from public.blocked_schedule where professional_id=$1 and tstzrange(starts_at,ends_at,'[)') && tstzrange($2,$3,'[)')
    ) conflicts limit 1`,
      [professional.id, startsAt.toISOString(), endsAt.toISOString()],
    );
    if (conflict.rowCount)
      throw appError(
        "Este horário acabou de ficar indisponível. Escolha outro.",
        409,
      );
    let basePrice = Number(service.base_price || 0);
    if (service.offer_inventory_items && body.inventoryItemId) {
      const inventoryRes = await client.query(
        "select suggested_price from public.hair_inventory where id = $1",
        [body.inventoryItemId]
      );
      if (inventoryRes.rows[0]) {
        basePrice = Number(inventoryRes.rows[0].suggested_price || 0);
      }
    }

    const couponResult = await validateCoupon(client, {
      code: body.couponCode,
      clientId,
      amount: basePrice,
      serviceId: service.id,
    });
    const location = await client.query(
      "select id from public.salon_locations where active order by name limit 1",
    );
    const appointmentId = (
      await client.query("select uuid_generate_v4() as id")
    ).rows[0].id;
    const bookingCode = `CS-${String(appointmentId).replace(/-/g, "").slice(-12).toUpperCase()}`;
    const requiresDeposit = !service.offer_inventory_items && Number(service.deposit_amount || 0) > 0;
    const requestedStatus =
      (user.role === "admin" || user.role === "professional") && appointmentStatuses.includes(body.status)
        ? body.status
        : "";
    const initialStatus =
      requestedStatus || (requiresDeposit ? "awaiting_payment" : "requested");
    const { rows } = await client.query(
      `insert into public.appointments(id,booking_code,client_id,professional_id,service_id,location_id,starts_at,ends_at,status,notes,estimated_value,original_value,discount_amount,coupon_id,intake_data,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning id`,
      [
        appointmentId,
        bookingCode,
        clientId,
        professional.id,
        service.id,
        location.rows[0]?.id || null,
        startsAt.toISOString(),
        endsAt.toISOString(),
        initialStatus,
        body.notes || null,
        couponResult.total,
        basePrice,
        couponResult.discount,
        couponResult.coupon?.id || null,
        JSON.stringify(body.intakeData || {}),
        user.id,
      ],
    );
    let paymentId = null;
    if (
      requiresDeposit &&
      !["confirmed", "in_service", "completed"].includes(initialStatus)
    ) {
      const deposit = Math.min(
        Number(service.deposit_amount || 0),
        couponResult.total,
      );
      const provider =
        body.paymentMethod === "card"
          ? "sumup"
          : body.paymentMethod === "local"
            ? "local"
            : "pix_manual";
      const payment = await client.query(
        `insert into public.payments(appointment_id,client_id,amount,original_amount,discount_amount,coupon_id,method,payment_method,provider,status) values($1,$2,$3,$4,$5,$6,$7,$7,$8,'pending') returning id`,
        [
          rows[0].id,
          clientId,
          deposit,
          service.deposit_amount,
          Math.min(couponResult.discount, Number(service.deposit_amount || 0)),
          couponResult.coupon?.id || null,
          body.paymentMethod || "pix",
          provider,
        ],
      );
      paymentId = payment.rows[0].id;
    }
    await client.query(
      `insert into public.appointment_status_history(appointment_id,to_status,changed_by,note) values($1,$2,$3,'Agendamento criado pelo aplicativo')`,
      [rows[0].id, initialStatus, user.id],
    );
    const clientProfile = await client.query(
      "select profile_id from public.clients where id=$1",
      [clientId],
    );
    const notificationData = JSON.stringify({
      appointment_id: rows[0].id,
      payment_id: paymentId,
    });
    const clientNotification = await client.query(
      `insert into public.notifications(profile_id,kind,title,body,data,action_url,metadata) values($1,'appointment_created','Agendamento enviado',$2,$3,$4,$3) returning id`,
      [
        clientProfile.rows[0].profile_id,
        `Sua solicitação de ${service.name} foi registrada.`,
        notificationData,
        `/cliente/agendamentos/${rows[0].id}`,
      ],
    );
    const profNotification = await client.query(
      `insert into public.notifications(profile_id,kind,title,body,data,action_url,metadata) values($1,'appointment_requested','Novo agendamento recebido',$2,$3,$4,$3) returning id`,
      [
        professional.profile_id,
        `Nova solicitação de ${service.name} para ${startsAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.`,
        notificationData,
        "/profissional/agenda",
      ],
    );
    await client.query(
      `insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_data) values($1,'create','appointment',$2,$3)`,
      [
        user.id,
        rows[0].id,
        JSON.stringify({
          startsAt,
          service: service.name,
          professional: professional.full_name,
        }),
      ],
    );
    const details = await client.query(`${appointmentSelect} where a.id=$1`, [
      rows[0].id,
    ]);
    return {
      ...details.rows[0],
      payment_id: paymentId,
      professional_email: professional.email,
      professional_phone: professional.phone,
      client_notification_id: clientNotification.rows[0]?.id,
      professional_notification_id: profNotification.rows[0]?.id,
    };
  });
  const contact = await query(
    `select u.email,p.phone,p.full_name from public.clients c join public.profiles p on p.id=c.profile_id join auth.users u on u.id=p.id where c.id=$1`,
    [appointment.client_id],
  );
  await notifyAppointment({
    email: contact.rows[0]?.email,
    phone: contact.rows[0]?.phone,
    clientName: contact.rows[0]?.full_name,
    service: appointment.service,
    date: appointment.starts_at,
    professional: appointment.professional,
    professionalEmail: appointment.professional_email,
    professionalPhone: appointment.professional_phone,
    clientNotificationId: appointment.client_notification_id,
    professionalNotificationId: appointment.professional_notification_id,
    notes: appointment.notes || "",
    value: appointment.estimated_value || 0,
  });
  return send(res, 201, { appointment: formatAppointment(appointment) });
}

export async function processReferralReward(client, clientId, appointmentId) {
  const referralResult = await client.query(
    `select id,referrer_client_id from public.referrals
     where referred_client_id=$1 and status='registered'
     order by created_at asc limit 1 for update`,
    [clientId],
  );
  const referral = referralResult.rows[0];
  if (!referral) return null;

  const completed = await client.query(
    `select count(*)::int as count from public.appointments
     where client_id=$1 and status='completed' and id<>$2`,
    [clientId, appointmentId],
  );
  if (Number(completed.rows[0]?.count || 0) > 0) return null;

  const transitioned = await client.query(
    `update public.referrals set status='completed',reward_amount=50.00
     where id=$1 and status='registered' returning id`,
    [referral.id],
  );
  if (!transitioned.rowCount) return null;
  const reward = await client.query(
    `insert into public.referral_rewards(
       referral_id,client_id,kind,amount,status,granted_at
     ) values($1,$2,'discount',50.00,'active',now()) returning id`,
    [referral.id, referral.referrer_client_id],
  );
  await client.query(
    `insert into public.loyalty_points(client_id,points,reason,expires_at)
     values($1,100,$2,(now()+interval '1 year')::date)`,
    [
      referral.referrer_client_id,
      `Indicação concluída — ${referral.id}`,
    ],
  );
  const notificationData = JSON.stringify({
    referral_id: referral.id,
    appointment_id: appointmentId,
    reward_amount: 50,
    points: 100,
  });
  await client.query(
    `insert into public.notifications(profile_id,kind,title,body,data,action_url)
     select c.profile_id,'referral_completed','Indicação concluída!',
       'Sua amiga concluiu o primeiro atendimento. Sua recompensa de R$ 50,00 e 100 pontos já está ativa!',
       $2,'/cliente/indique-e-ganhe'
     from public.clients c where c.id=$1`,
    [referral.referrer_client_id, notificationData],
  );
  return { referralId: referral.id, rewardId: reward.rows[0]?.id || null };
}

async function updateAppointment(req, res, user, body) {
  if (!body.id) throw appError("Agendamento não informado.");
  if (!appointmentStatuses.includes(body.status))
    throw appError("Status inválido.");
  if (!canUpdateAppointmentStatus(user.role, body.status))
    throw appError(
      "A cliente só pode cancelar ou solicitar reagendamento.",
      403,
    );
  const params = [body.status, body.id];
  let scopeSql = "true";
  if (user.role === "client") {
    params.push(user.id);
    scopeSql =
      "a.client_id in (select id from public.clients where profile_id=$3)";
  } else if (user.role === "professional") {
    params.push(user.id);
    scopeSql =
      "a.professional_id in (select id from public.professionals where profile_id=$3)";
  }
  const updated = await transaction(async (client) => {
    const previousSql =
      user.role === "admin"
        ? "select a.status from public.appointments a where a.id=$1 for update"
        : `select a.status from public.appointments a where a.id=$1 and ${scopeSql.replace("$3", "$2")} for update`;
    const previous = await client.query(
      previousSql,
      user.role === "admin" ? [body.id] : [body.id, user.id],
    );
    if (!previous.rows[0]) throw appError("Agendamento não encontrado.", 404);
    const changed = await client.query(
      "update public.appointments set status=$1,updated_at=now() where id=$2 returning id,status,updated_at",
      params.slice(0, 2),
    );
    await client.query(
      `insert into public.appointment_status_history(appointment_id,from_status,to_status,changed_by,note) values($1,$2,$3,$4,$5)`,
      [
        body.id,
        previous.rows[0].status,
        body.status,
        user.id,
        body.note || "Atualizado pelo aplicativo",
      ],
    );
    await client.query(
      `insert into public.audit_logs(actor_id,action,entity_type,entity_id,previous_data,new_data) values($1,'status_change','appointment',$2,$3,$4)`,
      [
        user.id,
        body.id,
        JSON.stringify({ status: previous.rows[0].status }),
        JSON.stringify({ status: body.status }),
      ],
    );
    const target = await client.query(
      `select c.profile_id,a.client_id,a.coupon_id,a.discount_amount,s.name as service from public.appointments a join public.clients c on c.id=a.client_id join public.services s on s.id=a.service_id where a.id=$1`,
      [body.id],
    );
    if (target.rows[0]) {
      const item = target.rows[0];
      const data = JSON.stringify({
        appointment_id: body.id,
        status: body.status,
      });
      await client.query(
        `insert into public.notifications(profile_id,kind,title,body,data,action_url,metadata) values($1,'appointment_status','Agendamento atualizado',$2,$3,$4,$3)`,
        [
          item.profile_id,
          `O status de ${item.service} foi atualizado.`,
          data,
          `/cliente/agendamentos/${body.id}`,
        ],
      );
      if (body.status === "completed" && item.coupon_id)
        await client.query(
          `insert into public.coupon_usage(coupon_id,client_id,appointment_id,discount_amount,status) select $1,$2,$3,$4,'used' where not exists(select 1 from public.coupon_usage where coupon_id=$1 and appointment_id=$3 and status='used')`,
          [item.coupon_id, item.client_id, body.id, item.discount_amount || 0],
        );
      if (
        body.status === "completed" &&
        previous.rows[0].status !== "completed"
      )
        await processReferralReward(client, item.client_id, body.id);
    }
    return changed.rows[0];
  });
  if (!updated) throw appError("Não foi possível atualizar o agendamento.");
  return send(res, 200, { appointment: updated });
}

async function updateAppointmentV2(req, res, user, body) {
  if (!body.id) throw appError("Agendamento nao informado.");
  const hasStatusUpdate = Object.hasOwn(body, "status");
  const hasDetailUpdate = ["startsAt", "serviceId", "professionalId", "notes"].some(
    (key) => Object.hasOwn(body, key),
  );
  if (!hasStatusUpdate && !hasDetailUpdate)
    throw appError("Informe os dados para atualizar o agendamento.");
  if (hasStatusUpdate && !appointmentStatuses.includes(body.status))
    throw appError("Status inválido.");
  if (hasStatusUpdate && !canUpdateAppointmentStatus(user.role, body.status))
    throw appError(
      "A cliente só pode cancelar ou solicitar reagendamento.",
      403,
    );
  const hasRestrictedDetailUpdate = ["startsAt", "serviceId", "professionalId"].some(
    (key) => Object.hasOwn(body, key),
  );
  if (hasRestrictedDetailUpdate && user.role !== "admin")
    throw appError("Somente administradores podem editar dados do agendamento.", 403);

  const updated = await transaction(async (client) => {
    const scopeSql =
      user.role === "admin"
        ? "true"
        : user.role === "client"
          ? "a.client_id in (select id from public.clients where profile_id=$2)"
          : "a.professional_id in (select id from public.professionals where profile_id=$2)";
    const previousSql = `
      select a.*,s.name as service_name
      from public.appointments a
      join public.services s on s.id=a.service_id
      where a.id=$1 and ${scopeSql}
      for update of a
    `;
    const previous = await client.query(
      previousSql,
      user.role === "admin" ? [body.id] : [body.id, user.id],
    );
    if (!previous.rows[0]) throw appError("Agendamento nao encontrado.", 404);
    const current = previous.rows[0];
    const needsScheduleValidation = [
      "startsAt",
      "serviceId",
      "professionalId",
    ].some((key) => Object.hasOwn(body, key));

    let service = {
      id: current.service_id,
      name: current.service_name,
      base_price: current.original_value || current.estimated_value || 0,
    };
    let professionalId = current.professional_id;
    let startsAt = new Date(current.starts_at);
    let endsAt = new Date(current.ends_at);
    if (needsScheduleValidation) {
      const resolved = await resolveAppointmentSlot(client, {
        serviceId: body.serviceId || current.service_id,
        professionalId: body.professionalId || current.professional_id,
        startsAt: body.startsAt || current.starts_at,
        excludeAppointmentId: body.id,
      });
      service = resolved.service;
      professionalId = resolved.professional.id;
      startsAt = resolved.startsAt;
      endsAt = resolved.endsAt;
    }

    const serviceChanged = service.id !== current.service_id;
    const status = hasStatusUpdate ? body.status : current.status;
    const notes = Object.hasOwn(body, "notes")
      ? String(body.notes || "").trim() || null
      : current.notes;
    const cancellationReason =
      ["cancelled", "no_show"].includes(status)
        ? String(
            body.cancellationReason || body.note || current.cancellation_reason || "",
          ).trim() || null
        : null;
    const estimatedValue = serviceChanged
      ? Number(service.base_price || 0)
      : current.estimated_value;
    const originalValue = serviceChanged
      ? Number(service.base_price || 0)
      : current.original_value;
    const discountAmount = serviceChanged ? 0 : current.discount_amount;
    const couponId = serviceChanged ? null : current.coupon_id;

    const changed = await client.query(
      `update public.appointments set
        service_id=$1,professional_id=$2,starts_at=$3,ends_at=$4,status=$5,
        notes=$6,estimated_value=$7,original_value=$8,discount_amount=$9,
        coupon_id=$10,cancellation_reason=$11,updated_at=now()
       where id=$12 returning id,status,updated_at`,
      [
        service.id,
        professionalId,
        startsAt.toISOString(),
        endsAt.toISOString(),
        status,
        notes,
        estimatedValue,
        originalValue,
        discountAmount,
        couponId,
        cancellationReason,
        body.id,
      ],
    );

    if (hasStatusUpdate && current.status !== status)
      await client.query(
        `insert into public.appointment_status_history(appointment_id,from_status,to_status,changed_by,note)
         values($1,$2,$3,$4,$5)`,
        [
          body.id,
          current.status,
          status,
          user.id,
          body.note || cancellationReason || "Atualizado pelo aplicativo",
        ],
      );

    await client.query(
      `insert into public.audit_logs(actor_id,action,entity_type,entity_id,previous_data,new_data)
       values($1,$2,'appointment',$3,$4,$5)`,
      [
        user.id,
        hasDetailUpdate ? "update" : "status_change",
        body.id,
        JSON.stringify({
          status: current.status,
          starts_at: current.starts_at,
          ends_at: current.ends_at,
          service_id: current.service_id,
          professional_id: current.professional_id,
          notes: current.notes,
        }),
        JSON.stringify({
          status,
          starts_at: startsAt,
          ends_at: endsAt,
          service_id: service.id,
          professional_id: professionalId,
          notes,
        }),
      ],
    );

    const target = await client.query(
      `select c.profile_id,a.client_id,a.coupon_id,a.discount_amount,s.name as service
       from public.appointments a
       join public.clients c on c.id=a.client_id
       join public.services s on s.id=a.service_id
       where a.id=$1`,
      [body.id],
    );
    if (target.rows[0]) {
      const item = target.rows[0];
      const data = JSON.stringify({
        appointment_id: body.id,
        status,
      });
      await client.query(
        `insert into public.notifications(profile_id,kind,title,body,data,action_url,metadata)
         values($1,$2,'Agendamento atualizado',$3,$4,$5,$4)`,
        [
          item.profile_id,
          hasDetailUpdate ? "appointment_updated" : "appointment_status",
          hasDetailUpdate
            ? `Seu agendamento de ${item.service} foi atualizado pela equipe.`
            : `O status de ${item.service} foi atualizado.`,
          data,
          `/cliente/agendamentos/${body.id}`,
        ],
      );
      if (status === "completed" && item.coupon_id)
        await client.query(
          `insert into public.coupon_usage(coupon_id,client_id,appointment_id,discount_amount,status)
           select $1,$2,$3,$4,'used'
           where not exists(select 1 from public.coupon_usage where coupon_id=$1 and appointment_id=$3 and status='used')`,
          [item.coupon_id, item.client_id, body.id, item.discount_amount || 0],
        );
      if (status === "completed" && current.status !== "completed")
        await processReferralReward(client, item.client_id, body.id);
    }
    return changed.rows[0];
  });
  if (!updated) throw appError("Nao foi possivel atualizar o agendamento.");
  return send(res, 200, { appointment: updated });
}

async function requestReschedule(res, user, body) {
  if (user.role !== "client")
    throw appError(
      "Somente a cliente pode solicitar reagendamento por este fluxo.",
      403,
    );
  if (!body.appointmentId) throw appError("Agendamento não informado.");
  const requestedStart = new Date(body.startsAt);
  if (
    Number.isNaN(requestedStart.getTime()) ||
    requestedStart.getTime() <= Date.now()
  )
    throw appError("Escolha uma data futura válida.");
  const result = await transaction(async (client) => {
    const appointment = await client.query(
      `
      select a.*,s.name as service,s.duration_minutes,pr.profile_id as professional_profile_id,
        pp.full_name as professional,pp.phone as professional_phone,u.email as professional_email,cp.full_name as client
      from public.appointments a join public.services s on s.id=a.service_id
      join public.professionals pr on pr.id=a.professional_id join public.profiles pp on pp.id=pr.profile_id
      left join auth.users u on u.id=pp.id join public.clients c on c.id=a.client_id join public.profiles cp on cp.id=c.profile_id
      where a.id=$1 and c.profile_id=$2 for update of a
    `,
      [body.appointmentId, user.id],
    );
    const current = appointment.rows[0];
    if (!current) throw appError("Agendamento não encontrado.", 404);
    if (["completed", "cancelled", "no_show"].includes(current.status))
      throw appError("Este agendamento não pode ser remarcado.");
    const existingRequest = await client.query(
      "select 1 from public.reschedule_requests where appointment_id=$1 and status in ('pending','suggested')",
      [current.id],
    );
    if (existingRequest.rowCount)
      throw appError(
        "Já existe uma solicitação de reagendamento aguardando resposta.",
        409,
      );
    const requestedEnd = new Date(
      requestedStart.getTime() + Number(current.duration_minutes) * 60_000,
    );
    const conflict = await client.query(
      `select 1 from (
      select 1 from public.appointments where id<>$4 and professional_id=$1 and status not in ('cancelled','no_show') and tstzrange(starts_at,ends_at,'[)') && tstzrange($2,$3,'[)')
      union all select 1 from public.blocked_schedule where professional_id=$1 and tstzrange(starts_at,ends_at,'[)') && tstzrange($2,$3,'[)')
    ) conflicts limit 1`,
      [
        current.professional_id,
        requestedStart.toISOString(),
        requestedEnd.toISOString(),
        current.id,
      ],
    );
    if (conflict.rowCount)
      throw appError("O novo horário não está mais disponível.", 409);
    const inserted = await client.query(
      `insert into public.reschedule_requests(appointment_id,requested_by,previous_status,old_starts_at,old_ends_at,requested_starts_at,requested_ends_at,reason) values($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
      [
        current.id,
        user.id,
        current.status,
        current.starts_at,
        current.ends_at,
        requestedStart.toISOString(),
        requestedEnd.toISOString(),
        body.reason || null,
      ],
    );
    await client.query(
      `update public.appointments set status='reschedule_requested',updated_at=now() where id=$1`,
      [current.id],
    );
    await client.query(
      `insert into public.appointment_status_history(appointment_id,from_status,to_status,changed_by,note) values($1,$2,'reschedule_requested',$3,$4)`,
      [
        current.id,
        current.status,
        user.id,
        body.reason || "Reagendamento solicitado pela cliente",
      ],
    );
    const data = JSON.stringify({
      appointment_id: current.id,
      reschedule_request_id: inserted.rows[0].id,
    });
    await client.query(
      `insert into public.notifications(profile_id,kind,title,body,data,action_url,metadata) values($1,'reschedule_requested','Reagendamento solicitado',$2,$3,'/profissional/agenda',$3)`,
      [
        current.professional_profile_id,
        `${current.client} solicitou uma nova data para ${current.service}.`,
        data,
      ],
    );
    return { request: inserted.rows[0], ...current };
  });
  const pretty = requestedStart.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  });
  const rescheduleTemplate = await getMessageTemplate('reschedule_request', `{client} solicitou reagendamento de {service} para {date}. Acesse sua agenda para responder.`);
  const rescheduleText = rescheduleTemplate
    .replace('{client}', result.client)
    .replace('{service}', result.service)
    .replace('{date}', pretty);
  await Promise.allSettled([
    sendEmail({
      to: result.professional_email,
      subject: "Solicitação de reagendamento — Carol Sol",
      html: `<p>${rescheduleText}</p>`,
    }),
    sendWhatsApp({
      to: result.professional_phone,
      text: rescheduleText,
    }),
  ]);
  return send(res, 201, { request: result.request });
}

async function respondReschedule(res, user, body) {
  if (!["client", "professional", "admin"].includes(user.role))
    throw appError("Acesso negado.", 403);
  if (!body.id || !["accept", "reject", "suggest"].includes(body.action))
    throw appError("Resposta de reagendamento inválida.");
  const result = await transaction(async (client) => {
    const params = [body.id];
    let scope = "true";
    if (user.role === "professional") {
      params.push(user.id);
      scope = "pr.profile_id=$2";
    } else if (user.role === "client") {
      params.push(user.id);
      scope = "c.profile_id=$2";
    }
    const record = await client.query(
      `
      select rr.*,a.professional_id,a.client_id,a.service_id,s.name as service,cp.id as client_profile_id,
        cp.full_name as client,cp.phone as client_phone,u.email as client_email,
        pp.id as professional_profile_id, pp.full_name as professional, pp.phone as professional_phone, pu.email as professional_email
      from public.reschedule_requests rr join public.appointments a on a.id=rr.appointment_id
      join public.services s on s.id=a.service_id join public.professionals pr on pr.id=a.professional_id
      join public.profiles pp on pp.id=pr.profile_id left join auth.users pu on pu.id=pp.id
      join public.clients c on c.id=a.client_id join public.profiles cp on cp.id=c.profile_id left join auth.users u on u.id=cp.id
      where rr.id=$1 and rr.status in ('pending','suggested') and ${scope} for update of rr
    `,
      params,
    );
    const request = record.rows[0];
    if (!request)
      throw appError("Solicitação não encontrada ou já respondida.", 404);
    if (user.role === "client" && request.status !== "suggested") {
      throw appError("Esta solicitação ainda está pendente de resposta da profissional.", 403);
    }
    let newStatus = request.previous_status;
    let startsAt = request.old_starts_at;
    let endsAt = request.old_ends_at;
    let requestStatus = "rejected";
    if (body.action === "accept") {
      startsAt = user.role === "client" ? request.suggested_starts_at : request.requested_starts_at;
      endsAt = user.role === "client" ? request.suggested_ends_at : request.requested_ends_at;
      newStatus = "confirmed";
      requestStatus = "accepted";
      const conflict = await client.query(
        `select 1 from (
        select 1 from public.appointments where id<>$4 and professional_id=$1 and status not in ('cancelled','no_show') and tstzrange(starts_at,ends_at,'[)') && tstzrange($2,$3,'[)')
        union all select 1 from public.blocked_schedule where professional_id=$1 and tstzrange(starts_at,ends_at,'[)') && tstzrange($2,$3,'[)')
      ) conflicts limit 1`,
        [request.professional_id, startsAt, endsAt, request.appointment_id],
      );
      if (conflict.rowCount)
        throw appError("O horário selecionado não está mais disponível.", 409);
    }
    if (body.action === "suggest") {
      if (user.role === "client")
        throw appError("A cliente não pode sugerir horários alternativos neste fluxo.", 403);
      const suggestion = new Date(body.startsAt);
      if (Number.isNaN(suggestion.getTime()))
        throw appError("Informe um novo horário válido.");
      const duration =
        new Date(request.requested_ends_at).getTime() -
        new Date(request.requested_starts_at).getTime();
      const suggestionEnd = new Date(suggestion.getTime() + duration);
      await client.query(
        `update public.reschedule_requests set status='suggested',suggested_starts_at=$2,suggested_ends_at=$3,response_note=$4,responded_by=$5,responded_at=now(),updated_at=now() where id=$1`,
        [
          request.id,
          suggestion.toISOString(),
          suggestionEnd.toISOString(),
          body.note || null,
          user.id,
        ],
      );
      const data = JSON.stringify({
        appointment_id: request.appointment_id,
        reschedule_request_id: request.id,
      });
      await client.query(
        `insert into public.notifications(profile_id,kind,title,body,data,action_url,metadata) values($1,'reschedule_suggested','Novo horário sugerido',$2,$3,$4,$3)`,
        [
          request.client_profile_id,
          `A profissional sugeriu ${suggestion.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} para ${request.service}.`,
          data,
          `/cliente/agendamentos/${request.appointment_id}`,
        ],
      );
      return { ...request, action: "suggest", finalStart: suggestion };
    }
    await client.query(
      `update public.reschedule_requests set status=$2,response_note=$3,responded_by=$4,responded_at=now(),updated_at=now() where id=$1`,
      [request.id, requestStatus, body.note || null, user.id],
    );
    await client.query(
      `update public.appointments set starts_at=$2,ends_at=$3,status=$4,updated_at=now() where id=$1`,
      [request.appointment_id, startsAt, endsAt, newStatus],
    );
    await client.query(
      `insert into public.appointment_status_history(appointment_id,from_status,to_status,changed_by,note) values($1,'reschedule_requested',$2,$3,$4)`,
      [
        request.appointment_id,
        newStatus,
        user.id,
        body.note || `Reagendamento ${requestStatus}`,
      ],
    );
    const data = JSON.stringify({
      appointment_id: request.appointment_id,
      reschedule_request_id: request.id,
    });
    const recipientProfileId = user.role === "client" ? request.professional_profile_id : request.client_profile_id;
    const notificationKind = user.role === "client"
      ? (requestStatus === "accepted" ? "reschedule_accepted_by_client" : "reschedule_rejected_by_client")
      : (requestStatus === "accepted" ? "reschedule_accepted" : "reschedule_rejected");
    const notificationTitle = requestStatus === "accepted" ? "Reagendamento confirmado" : "Reagendamento recusado";
    const notificationBody = user.role === "client"
      ? (requestStatus === "accepted"
          ? `A cliente confirmou o reagendamento de ${request.service} para ${new Date(startsAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.`
          : `A cliente recusou a sugestão de reagendamento de ${request.service}.`)
      : (requestStatus === "accepted"
          ? `Seu atendimento de ${request.service} foi remarcado.`
          : `A solicitação de reagendamento de ${request.service} não foi aceita.`);

    const actionUrl = user.role === "client" ? "/profissional/agenda" : `/cliente/agendamentos/${request.appointment_id}`;

    await client.query(
      `insert into public.notifications(profile_id,kind,title,body,data,action_url,metadata) values($1,$2,$3,$4,$5,$6,$5)`,
      [
        recipientProfileId,
        notificationKind,
        notificationTitle,
        notificationBody,
        data,
        actionUrl,
      ],
    );
    return { ...request, action: body.action, finalStart: startsAt };
  });
  const accepted = result.action === "accept";
  const recipientEmail = user.role === "client" ? result.professional_email : result.client_email;
  const recipientPhone = user.role === "client" ? result.professional_phone : result.client_phone;
  const subject = accepted
    ? "Reagendamento confirmado — Carol Sol"
    : "Atualização de reagendamento — Carol Sol";

  const prettyTime = new Date(result.finalStart).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

  const text = user.role === "client"
    ? (accepted
        ? `A cliente confirmou o reagendamento de ${result.service} para ${prettyTime}.`
        : `A cliente recusou a sugestão de reagendamento de ${result.service}.`)
    : (accepted
        ? `Seu reagendamento de ${result.service} foi confirmado para ${prettyTime}.`
        : `A profissional respondeu sua solicitação de reagendamento de ${result.service}. Consulte o aplicativo.`);

  await Promise.allSettled([
    sendEmail({
      to: recipientEmail,
      subject,
      html: `<p>${text}</p>`,
    }),
    sendWhatsApp({ to: recipientPhone, text: `Carol Sol: ${text}` }),
  ]);
  return send(res, 200, { ok: true });
}

async function createPhoto(req, res, user, body) {
  if (user.role !== "client")
    throw appError(
      "Apenas a cliente pode adicionar fotos por este fluxo.",
      403,
    );
  if (!isConfiguredCloudinaryUrl(body.url, ["image"]))
    throw appError("A imagem deve ser enviada pelo upload seguro.");
  const { rows: clients } = await query(
    "select id from public.clients where profile_id=$1",
    [user.id],
  );
  const { rows } = await query(
    `insert into public.client_photos(client_id,kind,storage_path) values($1,$2,$3) returning id,kind,storage_path`,
    [clients[0]?.id, body.kind || "evaluation", body.url],
  );
  return send(res, 201, { photo: rows[0] });
}

async function saveInventory(req, res, user, body) {
  await requireUser(req, ["admin"]);
  await query("alter table public.hair_inventory add column if not exists archived boolean default false");
  await query("alter table public.hair_inventory add column if not exists category_id uuid references public.service_categories(id) on delete set null");
  await query("alter table public.hair_inventory add column if not exists hair_method_id uuid references public.hair_methods(id) on delete set null");
  await query("alter table public.hair_inventory add column if not exists active boolean default true");
  await query("alter table public.hair_inventory alter column length_cm type text using length_cm::text").catch(() => {});
  await query("alter table public.technical_records alter column length_cm type text using length_cm::text").catch(() => {});

  if (body.id) {
    const { rows } = await query(
      `update public.hair_inventory
       set code=$1, supplier=$2, category=$3, color=$4, shade=$5, length_cm=$6, texture=$7, weight_grams=$8, lot=$9,
           unit_cost=$10, suggested_price=$11, minimum_stock=$12, archived=$13, category_id=$14, hair_method_id=$15,
           active=$16
       where id=$17 returning *`,
      [
        body.code,
        body.supplier,
        body.category,
        body.color || null,
        body.shade || null,
        body.lengthCm || null,
        body.texture || null,
        body.weightGrams || null,
        body.lot || null,
        body.unitCost || 0,
        body.suggestedPrice || 0,
        body.minimumStock || 0,
        body.archived === true,
        body.categoryId || null,
        body.hairMethodId || null,
        body.active !== false,
        body.id
      ]
    );
    if (!rows[0]) throw appError("Item não encontrado.", 404);

    if (body.quantity !== undefined && Number(body.quantity) !== Number(rows[0].quantity)) {
      const oldQty = Number(rows[0].quantity);
      const newQty = Number(body.quantity);
      await transaction(async (client) => {
        await client.query("update public.hair_inventory set quantity=$1 where id=$2", [newQty, body.id]);
        await client.query(
          `insert into public.inventory_movements(inventory_id, kind, quantity, note, created_by)
           values($1, 'adjustment', $2, $3, $4)`,
          [body.id, newQty, `Ajuste manual de estoque de ${oldQty} para ${newQty}`, user.id]
        );
      });
      rows[0].quantity = newQty;
    }

    return send(res, 200, { item: rows[0] });
  } else {
    const { rows } = await query(
      `insert into public.hair_inventory(code,supplier,category,color,shade,length_cm,texture,weight_grams,lot,unit_cost,suggested_price,quantity,minimum_stock,category_id,hair_method_id,active) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning *`,
      [
        body.code,
        body.supplier,
        body.category,
        body.color || null,
        body.shade || null,
        body.lengthCm || null,
        body.texture || null,
        body.weightGrams || null,
        body.lot || null,
        body.unitCost || 0,
        body.suggestedPrice || 0,
        body.quantity || 0,
        body.minimumStock || 0,
        body.categoryId || null,
        body.hairMethodId || null,
        body.active !== false,
      ],
    );
    if (Number(body.quantity) > 0) {
      await query(
        `insert into public.inventory_movements(inventory_id, kind, quantity, note, created_by)
         values($1, 'entry', $2, 'Saldo inicial do lote', $3)`,
        [rows[0].id, body.quantity, user.id]
      );
    }
    return send(res, 201, { item: rows[0] });
  }
}

async function createInventoryMovement(req, res, user, body) {
  await requireUser(req, ["admin"]);
  const inventoryId = body.inventoryId;
  const kind = body.kind; // 'entry', 'exit', 'adjustment'
  const quantity = Number(body.quantity);
  const note = body.note || "";

  if (!inventoryId) throw appError("ID do item é obrigatório.");
  if (!["entry", "exit", "adjustment"].includes(kind)) throw appError("Tipo de movimentação inválido.");
  if (isNaN(quantity) || quantity <= 0) throw appError("Quantidade deve ser maior que zero.");

  const result = await transaction(async (client) => {
    const itemResult = await client.query(
      "select quantity, unit_cost from public.hair_inventory where id=$1 for update",
      [inventoryId]
    );
    if (!itemResult.rows[0]) throw appError("Item de estoque não encontrado.", 404);
    const oldQty = Number(itemResult.rows[0].quantity);
    const unitCost = Number(itemResult.rows[0].unit_cost || 0);

    let newQty = oldQty;
    if (kind === "entry") {
      newQty = oldQty + quantity;
    } else if (kind === "exit") {
      if (oldQty < quantity) throw appError("Saldo insuficiente para saída.");
      newQty = oldQty - quantity;
    } else if (kind === "adjustment") {
      newQty = quantity;
    }

    await client.query("update public.hair_inventory set quantity=$1 where id=$2", [newQty, inventoryId]);
    const { rows } = await client.query(
      `insert into public.inventory_movements(inventory_id, kind, quantity, unit_cost, note, created_by)
       values($1, $2, $3, $4, $5, $6) returning *`,
      [inventoryId, kind, quantity, unitCost, note, user.id]
    );
    return { movement: rows[0], quantity: newQty };
  });

  return send(res, 201, result);
}

async function createTechnicalRecord(req, res, user, body) {
  await requireUser(req, ["professional", "admin"]);
  const { value, error } = technicalRecordInput(body);
  if (error) throw appError(error);
  if (
    value.photos.some(
      (photo) => !isConfiguredCloudinaryUrl(photo.url, ["image"]),
    )
  )
    throw appError("As fotos técnicas devem ser enviadas pelo upload seguro.");
  const result = await transaction(async (client) => {
    const params = [value.appointmentId];
    let scope = "";
    if (user.role === "professional") {
      params.push(user.id);
      scope = "and pr.profile_id=$2";
    }
    const appointment = await client.query(
      `select a.id,a.client_id,a.professional_id,a.status,s.hair_method_id,c.profile_id as client_profile_id
       from public.appointments a
       join public.professionals pr on pr.id=a.professional_id
       join public.clients c on c.id=a.client_id
       join public.services s on s.id=a.service_id
       where a.id=$1 ${scope}
       for update of a`,
      params,
    );
    const linked = appointment.rows[0];
    if (!linked)
      throw appError(
        user.role === "professional"
          ? "Atendimento não vinculado à profissional."
          : "Atendimento não encontrado.",
        user.role === "professional" ? 403 : 404,
      );
    if (!technicalRecordAppointmentStatuses.has(linked.status))
      throw appError(
        "A ficha só pode ser preenchida em atendimento confirmado, em andamento ou concluído.",
      );
    if (value.photos.length) {
      const consent = await client.query(
        `select 1 from public.privacy_consents
         where profile_id=$1 and consent_type='photos' and accepted and revoked_at is null`,
        [linked.client_profile_id],
      );
      if (!consent.rowCount)
        throw appError("A cliente não autorizou o uso de fotos técnicas.", 403);
    }
    const hairMethodId = linked.hair_method_id || value.hairMethodId;
    if (hairMethodId) {
      const method = await client.query(
        "select 1 from public.hair_methods where id=$1 and active",
        [hairMethodId],
      );
      if (!method.rowCount) throw appError("Método capilar não encontrado.");
    }
    const existing = await client.query(
      "select id,payment_status from public.technical_records where appointment_id=$1",
      [linked.id],
    );
    const paymentStatus =
      user.role === "admin"
        ? value.paymentStatus
        : existing.rows[0]?.payment_status || "pending";

    let oldRecord = null;
    let existingRecordId = null;
    if (existing.rowCount > 0) {
      existingRecordId = existing.rows[0].id;

      const oldMovements = await client.query(
        "select inventory_id, quantity from public.inventory_movements where technical_record_id=$1 and kind='consume'",
        [existingRecordId]
      );
      const oldHairUsage = oldMovements.rows[0];

      const oldRecordQuery = await client.query(
        "select products_used from public.technical_records where id=$1",
        [existingRecordId]
      );
      const rawProductsUsed = oldRecordQuery.rows[0]?.products_used;

      const oldProducts = [];
      if (Array.isArray(rawProductsUsed)) {
        for (const item of rawProductsUsed) {
          if (typeof item === 'object' && item !== null && item.productId) {
            oldProducts.push({ productId: item.productId, quantity: Number(item.quantity) });
          }
        }
      }

      oldRecord = {
        hairInventoryId: oldHairUsage?.inventory_id || null,
        hairInventoryQty: Number(oldHairUsage?.quantity || 0),
        productConsumptions: oldProducts
      };
    }

    const hairLotIdsToLock = [];
    if (oldRecord?.hairInventoryId) hairLotIdsToLock.push(oldRecord.hairInventoryId);
    if (value.hairInventoryId) hairLotIdsToLock.push(value.hairInventoryId);

    const productIdsToLock = [];
    if (oldRecord?.productConsumptions) {
      for (const p of oldRecord.productConsumptions) {
        productIdsToLock.push(p.productId);
      }
    }
    if (value.productConsumptions) {
      for (const p of value.productConsumptions) {
        productIdsToLock.push(p.productId);
      }
    }

    const uniqueHairLotIds = [...new Set(hairLotIdsToLock)];
    const uniqueProductIds = [...new Set(productIdsToLock)];

    let hairInventoryData = [];
    if (uniqueHairLotIds.length > 0) {
      const hairResult = await client.query(
        "select id, quantity, lot, color, shade, length_cm, texture, unit_cost from public.hair_inventory where id = any($1) for update",
        [uniqueHairLotIds]
      );
      hairInventoryData = hairResult.rows;
    }

    let productsData = [];
    if (uniqueProductIds.length > 0) {
      const productsResult = await client.query(
        "select id, name, stock_quantity from public.products where id = any($1) for update",
        [uniqueProductIds]
      );
      productsData = productsResult.rows;
    }

    if (value.hairInventoryId && !hairInventoryData.some(h => h.id === value.hairInventoryId)) {
      throw appError("Lote de estoque selecionado não existe.");
    }
    for (const pc of value.productConsumptions) {
      if (!productsData.some(p => p.id === pc.productId)) {
        throw appError("Produto selecionado não existe.");
      }
    }

    const changes = calculateInventoryChanges({
      oldRecord,
      newRecord: {
        hairInventoryId: value.hairInventoryId,
        hairInventoryQty: value.hairInventoryQty,
        productConsumptions: value.productConsumptions
      },
      hairInventory: hairInventoryData,
      products: productsData
    });

    if (changes.error) {
      throw appError(changes.error);
    }

    for (const update of changes.hairUpdates) {
      await client.query(
        "update public.hair_inventory set quantity = quantity + $1 where id = $2",
        [update.delta, update.id]
      );
    }

    for (const update of changes.productUpdates) {
      await client.query(
        "update public.products set stock_quantity = stock_quantity + $1 where id = $2",
        [update.delta, update.id]
      );
    }

    let hairLotCode = value.hairLot;
    let hairColor = value.color;
    let hairShade = value.shade;
    let hairLengthCm = value.lengthCm;
    let hairTexture = value.texture;

    if (value.hairInventoryId) {
      const selectedLot = hairInventoryData.find(h => h.id === value.hairInventoryId);
      if (selectedLot) {
        hairLotCode = selectedLot.lot || null;
        hairColor = selectedLot.color || null;
        hairShade = selectedLot.shade || null;
        hairLengthCm = selectedLot.length_cm || null;
        hairTexture = selectedLot.texture || null;
      }
    }

    const productsUsedToSave = [];
    for (const pc of value.productConsumptions) {
      const dbProduct = productsData.find(p => p.id === pc.productId);
      productsUsedToSave.push({
        productId: pc.productId,
        name: dbProduct?.name || "Produto Desconhecido",
        quantity: pc.quantity
      });
    }

    const { rows } = await client.query(
      `insert into public.technical_records(
         appointment_id,client_id,professional_id,hair_method_id,strands_count,
         weight_grams,color,shade,length_cm,texture,hair_lot,products_used,
         recommendations,internal_notes,next_maintenance_date,final_value,payment_status
       ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       on conflict(appointment_id) do update set
         hair_method_id=excluded.hair_method_id,
         strands_count=excluded.strands_count,
         weight_grams=excluded.weight_grams,
         color=excluded.color,
         shade=excluded.shade,
         length_cm=excluded.length_cm,
         texture=excluded.texture,
         hair_lot=excluded.hair_lot,
         products_used=excluded.products_used,
         recommendations=excluded.recommendations,
         internal_notes=excluded.internal_notes,
         next_maintenance_date=excluded.next_maintenance_date,
         final_value=excluded.final_value,
         payment_status=excluded.payment_status
       where technical_records.professional_id=excluded.professional_id
       returning *`,
      [
        linked.id,
        linked.client_id,
        linked.professional_id,
        hairMethodId,
        value.strandsCount,
        value.weightGrams,
        hairColor,
        hairShade,
        hairLengthCm,
        hairTexture,
        hairLotCode,
        JSON.stringify(productsUsedToSave),
        value.recommendations,
        value.internalNotes,
        value.nextMaintenanceDate,
        value.finalValue,
        paymentStatus,
      ],
    );
    if (!rows[0])
      throw appError("A ficha existente pertence a outra profissional.", 409);

    const technicalRecordId = rows[0].id;

    for (const mov of changes.movements) {
      const selectedLot = hairInventoryData.find(h => h.id === mov.inventory_id);
      await client.query(
        `insert into public.inventory_movements(
           inventory_id, technical_record_id, kind, quantity, unit_cost, note, created_by
         ) values($1,$2,$3,$4,$5,$6,$7)`,
        [
          mov.inventory_id,
          technicalRecordId,
          mov.kind,
          mov.quantity,
          selectedLot?.unit_cost || 0,
          `Movimentação referente ao atendimento ${linked.id}`,
          user.id
        ]
      );
    }

    const urlsToDelete = [];
    if (value.deletedPhotoIds.length > 0) {
      const photosToDeleteResult = await client.query(
        "select id, storage_path from public.client_photos where id = any($1) and appointment_id = $2",
        [value.deletedPhotoIds, linked.id]
      );

      for (const ph of photosToDeleteResult.rows) {
        urlsToDelete.push(ph.storage_path);
      }

      if (photosToDeleteResult.rowCount > 0) {
        const deletedIds = photosToDeleteResult.rows.map(ph => ph.id);
        await client.query(
          "delete from public.client_photos where id = any($1)",
          [deletedIds]
        );
      }
    }

    const photos = [];
    for (const photo of value.photos) {
      const inserted = await client.query(
        `insert into public.client_photos(client_id,appointment_id,kind,storage_path)
         select $1,$2,$3,$4
         where not exists (
           select 1 from public.client_photos
           where appointment_id=$2 and kind=$3 and storage_path=$4
         )
         returning id,appointment_id,kind,storage_path`,
        [linked.client_id, linked.id, photo.kind, photo.url],
      );
      if (inserted.rows[0]) photos.push(inserted.rows[0]);
    }
    return { record: rows[0], photos, created: !existing.rowCount, urlsToDelete };
  });

  if (result.urlsToDelete && result.urlsToDelete.length > 0) {
    Promise.allSettled(result.urlsToDelete.map(url => deleteFromCloudinary(url)))
      .then(results => {
        results.forEach((res, idx) => {
          if (res.status === "rejected" || (res.value && !res.value.success)) {
            console.error(`Falha ao remover imagem do Cloudinary: ${result.urlsToDelete[idx]}`, res.reason || (res.value && res.value.error));
          } else {
            console.log(`Imagem removida do Cloudinary com sucesso: ${result.urlsToDelete[idx]}`);
          }
        });
      })
      .catch(err => {
        console.error("Erro ao executar limpeza compensatória no Cloudinary", err);
      });
  }

  return send(res, result.created ? 201 : 200, {
    record: result.record,
    photos: result.photos,
  });
}

export default async function handler(req, res) {
  try {
    const user = await requireUser(req);
    const resource = req.query?.resource || "bootstrap";
    if (req.method === "GET")
      return await getResource(req, res, user, resource);
    const body = getBody(req);
    if (req.method === "POST" && resource === "appointments")
      return await createAppointment(req, res, user, body);
    if (req.method === "POST" && resource === "reschedule-requests")
      return await requestReschedule(res, user, body);
    if (req.method === "POST" && resource === "photos")
      return await createPhoto(req, res, user, body);
    if (req.method === "POST" && resource === "inventory")
      return await saveInventory(req, res, user, body);
    if (req.method === "POST" && resource === "inventory-movement")
      return await createInventoryMovement(req, res, user, body);
    if (req.method === "POST" && resource === "technical-records")
      return await createTechnicalRecord(req, res, user, body);
    if (req.method === "PATCH" && resource === "appointments")
      return await updateAppointmentV2(req, res, user, body);
    if (req.method === "PATCH" && resource === "reschedule-requests")
      return await respondReschedule(res, user, body);
    if (req.method === "POST" && resource === "admin-color") {
      await requireUser(req, ["admin"]);
      const name = clean(body.name);
      if (!name) throw appError("Nome da cor é obrigatório.");
      if (body.id) {
        const { rows } = await query(
          "update public.hair_colors set name=$1 where id=$2 returning *",
          [name, body.id]
        );
        return send(res, 200, { color: rows[0] });
      } else {
        const { rows } = await query(
          "insert into public.hair_colors(name) values($1) on conflict (name) do update set name=excluded.name returning *",
          [name]
        );
        return send(res, 201, { color: rows[0] });
      }
    }
    if (req.method === "DELETE" && resource === "admin-color") {
      await requireUser(req, ["admin"]);
      const id = body.id;
      if (!id) throw appError("ID é obrigatório.");
      await query("delete from public.hair_colors where id=$1", [id]);
      return send(res, 200, { success: true });
    }
    return methodNotAllowed(res, ["GET", "POST", "PATCH", "DELETE"]);
  } catch (error) {
    return handleError(res, error);
  }
}
