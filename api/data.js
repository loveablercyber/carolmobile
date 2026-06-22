import { query, transaction } from "../server/lib/db.js";
import { requireUser } from "../server/lib/auth.js";
import {
  notifyAppointment,
  sendEmail,
  sendWhatsApp,
} from "../server/lib/integrations.js";
import {
  appError,
  getBody,
  handleError,
  methodNotAllowed,
  send,
} from "../server/lib/http.js";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const appointmentSelect = `
  select a.id, a.booking_code, a.starts_at, a.ends_at, a.status, a.notes, a.estimated_value,
    a.original_value, a.discount_amount, a.intake_data,
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
`;

function formatAppointment(row) {
  return {
    ...row,
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
    const [services, professionals, locations, points] = await Promise.all([
      query(
        `select id, name, description, duration_minutes, base_price, deposit_amount from public.services where active order by base_price`,
      ),
      query(
        `select p.id, pp.full_name as name, p.specialties, coalesce(round(avg(r.rating)::numeric,1),5) as rating from public.professionals p join public.profiles pp on pp.id=p.profile_id left join public.reviews r on r.professional_id=p.id where p.active group by p.id,pp.full_name order by pp.full_name`,
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
    ]);
    return send(res, 200, {
      services: services.rows,
      professionals: professionals.rows,
      locations: locations.rows,
      points: points.rows[0].points,
    });
  }

  if (resource === "appointments") {
    const scope = await appointmentScope(user);
    const { rows } = await query(
      `${appointmentSelect} where ${scope.sql} order by a.starts_at desc limit 100`,
      scope.params,
    );
    return send(res, 200, { appointments: rows.map(formatAppointment) });
  }

  if (resource === "availability") {
    const date = String(req.query?.date || "");
    const serviceId = String(req.query?.serviceId || "");
    const serviceName = String(req.query?.serviceName || "");
    const professionalId = String(req.query?.professionalId || "");
    const requestedProfessional = String(req.query?.professionalName || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw appError("Data inválida.");
    if (serviceId && !uuidPattern.test(serviceId))
      throw appError("Serviço inválido.");
    if (professionalId && !uuidPattern.test(professionalId))
      throw appError("Profissional inválida.");
    const { rows: services } = serviceId
      ? await query(
          "select id,duration_minutes from public.services where id=$1 and active limit 1",
          [serviceId],
        )
      : await query(
          "select id,duration_minutes from public.services where lower(name)=lower($1) and active limit 1",
          [serviceName],
        );
    if (!services[0]) throw appError("Serviço não encontrado.");
    const professionalSql = professionalId
      ? `select p.id,pp.full_name from public.professionals p join public.profiles pp on pp.id=p.profile_id where p.id=$1 and p.active limit 1`
      : requestedProfessional === "Primeira disponível"
        ? `select p.id,pp.full_name from public.professionals p join public.profiles pp on pp.id=p.profile_id where p.active order by pp.full_name limit 1`
        : `select p.id,pp.full_name from public.professionals p join public.profiles pp on pp.id=p.profile_id where p.active and lower(pp.full_name)=lower($1) limit 1`;
    const professionalParams = professionalId
      ? [professionalId]
      : requestedProfessional === "Primeira disponível"
        ? []
        : [requestedProfessional];
    const { rows: professionals } = await query(
      professionalSql,
      professionalParams,
    );
    if (!professionals[0]) throw appError("Profissional não encontrada.");
    const slots = ["09:00", "10:30", "14:00", "16:00"];
    const result = [];
    for (const time of slots) {
      const startsAt = new Date(`${date}T${time}:00-03:00`);
      const endsAt = new Date(
        startsAt.getTime() + services[0].duration_minutes * 60_000,
      );
      const { rowCount } = await query(
        `select 1 from (
        select 1 from public.appointments where professional_id=$1 and status not in ('cancelled','no_show') and tstzrange(starts_at,ends_at,'[)') && tstzrange($2,$3,'[)')
        union all
        select 1 from public.blocked_schedule where professional_id=$1 and tstzrange(starts_at,ends_at,'[)') && tstzrange($2,$3,'[)')
      ) conflicts limit 1`,
        [professionals[0].id, startsAt.toISOString(), endsAt.toISOString()],
      );
      result.push({ time, available: rowCount === 0 });
    }
    return send(res, 200, { professional: professionals[0], slots: result });
  }

  if (resource === "clients") {
    await requireUser(req, ["professional", "admin"]);
    const clientParams = [];
    let clientWhere = "";
    if (user.role === "professional") {
      clientParams.push(user.id);
      clientWhere = `where exists(select 1 from public.appointments a join public.professionals pr on pr.id=a.professional_id where a.client_id=c.id and pr.profile_id=$1)`;
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
    const { rows } = await query(
      `select id, code, supplier, category as item, concat_ws(' • ',color,shade,length_cm||' cm',texture) as detail, lot, quantity as qty, minimum_stock as min, unit_cost, suggested_price, case when quantity<=minimum_stock then 'Estoque baixo' else 'Em estoque' end as status from public.hair_inventory order by category,color`,
    );
    return send(res, 200, {
      inventory: rows.map((row) => ({
        ...row,
        cost: Number(row.unit_cost || 0).toLocaleString("pt-BR", {
          style: "currency",
          currency: "BRL",
        }),
        margin: row.suggested_price
          ? `${Math.round((1 - Number(row.unit_cost) / Number(row.suggested_price)) * 100)}%`
          : "—",
      })),
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
    from public.coupons c where upper(c.code)=upper($1) and c.active limit 1
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

async function createAppointment(req, res, user, body) {
  if (!["client", "admin"].includes(user.role))
    throw appError(
      "Somente clientes e administradores podem criar agendamentos.",
      403,
    );
  const startsAt = new Date(body.startsAt);
  if (Number.isNaN(startsAt.getTime()))
    throw appError("Data e horário inválidos.");
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
    let service;
    if (body.serviceId)
      ({
        rows: [service],
      } = await client.query(
        "select * from public.services where id=$1 and active",
        [body.serviceId],
      ));
    else
      ({
        rows: [service],
      } = await client.query(
        "select * from public.services where lower(name)=lower($1) and active limit 1",
        [body.serviceName],
      ));
    if (!service) throw appError("Serviço não encontrado.");
    let professional;
    const professionalSelect = `select p.id,p.profile_id,pp.full_name,pp.phone,u.email from public.professionals p join public.profiles pp on pp.id=p.profile_id left join auth.users u on u.id=pp.id`;
    if (body.professionalId)
      ({
        rows: [professional],
      } = await client.query(
        `${professionalSelect} where p.id=$1 and p.active`,
        [body.professionalId],
      ));
    else if (body.professionalName === "Primeira disponível")
      ({
        rows: [professional],
      } = await client.query(
        `${professionalSelect} where p.active order by pp.full_name limit 1`,
      ));
    else
      ({
        rows: [professional],
      } = await client.query(
        `${professionalSelect} where lower(pp.full_name)=lower($1) and p.active limit 1`,
        [body.professionalName],
      ));
    if (!professional) throw appError("Profissional não encontrada.");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [
      professional.id,
    ]);
    const endsAt = new Date(
      startsAt.getTime() + service.duration_minutes * 60_000,
    );
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
    const couponResult = await validateCoupon(client, {
      code: body.couponCode,
      clientId,
      amount: Number(service.base_price || 0),
      serviceId: service.id,
    });
    const location = await client.query(
      "select id from public.salon_locations where active order by name limit 1",
    );
    const appointmentId = (
      await client.query("select uuid_generate_v4() as id")
    ).rows[0].id;
    const bookingCode = `CS-${String(appointmentId).replace(/-/g, "").slice(-12).toUpperCase()}`;
    const requiresDeposit = Number(service.deposit_amount || 0) > 0;
    const initialStatus = requiresDeposit ? "awaiting_payment" : "requested";
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
        service.base_price,
        couponResult.discount,
        couponResult.coupon?.id || null,
        JSON.stringify(body.intakeData || {}),
        user.id,
      ],
    );
    let paymentId = null;
    if (requiresDeposit) {
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
    await client.query(
      `insert into public.notifications(profile_id,kind,title,body,data,action_url,metadata) values($1,'appointment_created','Agendamento enviado',$2,$3,$4,$3)`,
      [
        clientProfile.rows[0].profile_id,
        `Sua solicitação de ${service.name} foi registrada.`,
        notificationData,
        `/cliente/agendamentos/${rows[0].id}`,
      ],
    );
    await client.query(
      `insert into public.notifications(profile_id,kind,title,body,data,action_url,metadata) values($1,'appointment_requested','Novo agendamento recebido',$2,$3,$4,$3)`,
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
      professional_email: professional.email,
      professional_phone: professional.phone,
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
  });
  return send(res, 201, { appointment: formatAppointment(appointment) });
}

async function updateAppointment(req, res, user, body) {
  if (!body.id) throw appError("Agendamento não informado.");
  const allowed = [
    "requested",
    "awaiting_payment",
    "pending_deposit",
    "confirmed",
    "in_service",
    "completed",
    "cancelled",
    "no_show",
    "rescheduled",
    "reschedule_requested",
  ];
  if (!allowed.includes(body.status)) throw appError("Status inválido.");
  if (
    user.role === "client" &&
    !["cancelled", "rescheduled"].includes(body.status)
  )
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
    await client.query(
      "update public.appointments set status=$1,updated_at=now() where id=$2",
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
    }
    return true;
  });
  if (!updated) throw appError("Não foi possível atualizar o agendamento.");
  return send(res, 200, { ok: true });
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
  await Promise.allSettled([
    sendEmail({
      to: result.professional_email,
      subject: "Solicitação de reagendamento — Carol Sol",
      html: `<p>${result.client} solicitou reagendamento de ${result.service} para ${pretty}.</p>`,
    }),
    sendWhatsApp({
      to: result.professional_phone,
      text: `Carol Sol: ${result.client} solicitou reagendamento de ${result.service} para ${pretty}. Acesse sua agenda para responder.`,
    }),
  ]);
  return send(res, 201, { request: result.request });
}

async function respondReschedule(res, user, body) {
  if (!["professional", "admin"].includes(user.role))
    throw appError(
      "Somente a profissional ou administradora pode responder.",
      403,
    );
  if (!body.id || !["accept", "reject", "suggest"].includes(body.action))
    throw appError("Resposta de reagendamento inválida.");
  const result = await transaction(async (client) => {
    const params = [body.id];
    let scope = "true";
    if (user.role === "professional") {
      params.push(user.id);
      scope = "pr.profile_id=$2";
    }
    const record = await client.query(
      `
      select rr.*,a.professional_id,a.client_id,a.service_id,s.name as service,cp.id as client_profile_id,
        cp.full_name as client,cp.phone as client_phone,u.email as client_email
      from public.reschedule_requests rr join public.appointments a on a.id=rr.appointment_id
      join public.services s on s.id=a.service_id join public.professionals pr on pr.id=a.professional_id
      join public.clients c on c.id=a.client_id join public.profiles cp on cp.id=c.profile_id left join auth.users u on u.id=cp.id
      where rr.id=$1 and rr.status in ('pending','suggested') and ${scope} for update of rr
    `,
      params,
    );
    const request = record.rows[0];
    if (!request)
      throw appError("Solicitação não encontrada ou já respondida.", 404);
    let newStatus = request.previous_status;
    let startsAt = request.old_starts_at;
    let endsAt = request.old_ends_at;
    let requestStatus = "rejected";
    if (body.action === "accept") {
      startsAt = request.requested_starts_at;
      endsAt = request.requested_ends_at;
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
        throw appError("O horário solicitado não está mais disponível.", 409);
    }
    if (body.action === "suggest") {
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
    await client.query(
      `insert into public.notifications(profile_id,kind,title,body,data,action_url,metadata) values($1,$2,$3,$4,$5,$6,$5)`,
      [
        request.client_profile_id,
        requestStatus === "accepted"
          ? "reschedule_accepted"
          : "reschedule_rejected",
        requestStatus === "accepted"
          ? "Reagendamento confirmado"
          : "Reagendamento recusado",
        requestStatus === "accepted"
          ? `Seu atendimento de ${request.service} foi remarcado.`
          : `A solicitação de reagendamento de ${request.service} não foi aceita.`,
        data,
        `/cliente/agendamentos/${request.appointment_id}`,
      ],
    );
    return { ...request, action: body.action, finalStart: startsAt };
  });
  const accepted = result.action === "accept";
  const text = accepted
    ? `Seu reagendamento de ${result.service} foi confirmado para ${new Date(result.finalStart).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.`
    : `A profissional respondeu sua solicitação de reagendamento de ${result.service}. Consulte o aplicativo.`;
  await Promise.allSettled([
    sendEmail({
      to: result.client_email,
      subject: "Atualização de reagendamento — Carol Sol",
      html: `<p>${text}</p>`,
    }),
    sendWhatsApp({ to: result.client_phone, text: `Carol Sol: ${text}` }),
  ]);
  return send(res, 200, { ok: true });
}

async function createPhoto(req, res, user, body) {
  if (user.role !== "client")
    throw appError(
      "Apenas a cliente pode adicionar fotos por este fluxo.",
      403,
    );
  if (!body.url) throw appError("Imagem não informada.");
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

async function createInventory(req, res, user, body) {
  await requireUser(req, ["admin"]);
  const { rows } = await query(
    `insert into public.hair_inventory(code,supplier,category,color,shade,length_cm,texture,weight_grams,lot,unit_cost,suggested_price,quantity,minimum_stock) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`,
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
    ],
  );
  return send(res, 201, { item: rows[0] });
}

async function createTechnicalRecord(req, res, user, body) {
  await requireUser(req, ["professional", "admin"]);
  const professional =
    user.role === "professional"
      ? await query("select id from public.professionals where profile_id=$1", [
          user.id,
        ])
      : { rows: [{ id: body.professionalId }] };
  const { rows } = await query(
    `insert into public.technical_records(appointment_id,client_id,professional_id,hair_method_id,strands_count,weight_grams,color,shade,length_cm,texture,hair_lot,products_used,recommendations,internal_notes,next_maintenance_date,final_value,payment_status) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) on conflict(appointment_id) do update set strands_count=excluded.strands_count,weight_grams=excluded.weight_grams,color=excluded.color,shade=excluded.shade,length_cm=excluded.length_cm,texture=excluded.texture,hair_lot=excluded.hair_lot,products_used=excluded.products_used,recommendations=excluded.recommendations,internal_notes=excluded.internal_notes,next_maintenance_date=excluded.next_maintenance_date,final_value=excluded.final_value,payment_status=excluded.payment_status returning *`,
    [
      body.appointmentId,
      body.clientId,
      professional.rows[0]?.id,
      body.hairMethodId || null,
      body.strandsCount || null,
      body.weightGrams || null,
      body.color || null,
      body.shade || null,
      body.lengthCm || null,
      body.texture || null,
      body.hairLot || null,
      JSON.stringify(body.productsUsed || []),
      body.recommendations || null,
      body.internalNotes || null,
      body.nextMaintenanceDate || null,
      body.finalValue || null,
      body.paymentStatus || "pending",
    ],
  );
  return send(res, 201, { record: rows[0] });
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
      return await createInventory(req, res, user, body);
    if (req.method === "POST" && resource === "technical-records")
      return await createTechnicalRecord(req, res, user, body);
    if (req.method === "PATCH" && resource === "appointments")
      return await updateAppointment(req, res, user, body);
    if (req.method === "PATCH" && resource === "reschedule-requests")
      return await respondReschedule(res, user, body);
    return methodNotAllowed(res, ["GET", "POST", "PATCH"]);
  } catch (error) {
    return handleError(res, error);
  }
}
