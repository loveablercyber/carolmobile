import { query } from '../server/lib/db.js'
import { sendEmail, sendWhatsApp, getMessageTemplate } from '../server/lib/integrations.js'
import { handleError, send } from '../server/lib/http.js'
import { runRecurringRenewals } from "../server/lib/recurring-billing.js";

const APP_URL = process.env.APP_URL || "https://carolmobile.vercel.app";

function money(value) {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function prettyDateTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  });
}

async function ensureNotificationRuntimeSchema() {
  await query("alter table public.notifications add column if not exists action_url text");
  await query("alter table public.notifications add column if not exists metadata jsonb not null default '{}'");
  await query("alter table public.notifications add column if not exists notification_key text");
  await query("create unique index if not exists notifications_key_unique on public.notifications(notification_key) where notification_key is not null");
}

function reminderWindow(startsAt) {
  const appointmentTime = new Date(startsAt).getTime()
  if (appointmentTime <= Date.now()) return null
  const diffMs = appointmentTime - Date.now()
  const diffHours = diffMs / (1000 * 60 * 60)
  if (diffHours >= 1.5 && diffHours <= 2.5) {
    return { key: '2h', label: 'em duas horas' }
  }
  const appointmentDay = saoPauloDateKey(startsAt)
  const today = saoPauloDateKey(new Date())
  if (appointmentDay === today) return { key: 'today', label: 'hoje' }
  if (appointmentDay === addDaysToKey(today, 1)) return { key: '24h', label: 'amanhã' }
  if (appointmentDay === addDaysToKey(today, 2)) return { key: '48h', label: 'em dois dias' }
  return null
}

function saoPauloDateKey(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value))
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${byType.year}-${byType.month}-${byType.day}`
}

function addDaysToKey(key, days) {
  const [year, month, day] = key.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-')
}

async function handleReminders(req, res) {
  await ensureNotificationRuntimeSchema();
  const { rows } = await query(`
    select a.id,a.starts_at,s.name as service,cp.id as profile_id,cp.full_name,cp.phone,u.email,pp.full_name as professional,
      coalesce(np.email,true) as wants_email,
      coalesce(np.whatsapp,true) as wants_whatsapp,
      coalesce(np.reminders,true) as wants_reminders
    from public.appointments a
    join public.services s on s.id=a.service_id
    join public.clients c on c.id=a.client_id join public.profiles cp on cp.id=c.profile_id join auth.users u on u.id=cp.id
    join public.professionals pr on pr.id=a.professional_id join public.profiles pp on pp.id=pr.profile_id
    left join public.notification_preferences np on np.profile_id=cp.id
    where a.status in ('confirmed','pending_deposit') and a.starts_at between now() and now()+interval '3 days'
  `)
  let sent = 0
  for (const appointment of rows) {
    const window = reminderWindow(appointment.starts_at)
    if (!window) continue
    if (!appointment.wants_reminders) continue
    const notificationKey = `appointment:${appointment.id}:reminder:${window.key}`
    const reminderTemplate = await getMessageTemplate('reminder', `Olá, {name}! Lembrete Carol Sol: seu atendimento de {service} com {professional} será {window}.`);
    const text = reminderTemplate
      .replace('{name}', appointment.full_name)
      .replace('{service}', appointment.service)
      .replace('{professional}', appointment.professional)
      .replace('{window}', window.label);
    const inserted = await query(`insert into public.notifications(profile_id,kind,title,body,data,notification_key,scheduled_at) values($1,'appointment_reminder',$2,$3,$4,$5,now()) on conflict(notification_key) do nothing returning id`, [appointment.profile_id, `Lembrete de agendamento — ${window.key}`, text, JSON.stringify({ appointment_id: appointment.id }), notificationKey])
    const notificationId = inserted.rows[0]?.id
    if (!notificationId) continue
    const deliveries = []
    if (appointment.wants_email) {
      deliveries.push((async () => {
        try {
          const res = await sendEmail({ to: appointment.email, subject: 'Lembrete de agendamento — Carol Sol', html: `<p>${text}</p>` })
          await query(`insert into public.notification_delivery_logs(notification_id, channel, recipient, status, provider_reference) values($1, 'email', $2, 'delivered', $3)`, [notificationId, appointment.email, res.id || 'resend-ok'])
        } catch (err) {
          await query(`insert into public.notification_delivery_logs(notification_id, channel, recipient, status, error_message) values($1, 'email', $2, 'failed', $3)`, [notificationId, appointment.email, err.message])
        }
      })())
    }
    if (appointment.wants_whatsapp) {
      deliveries.push((async () => {
        try {
          const res = await sendWhatsApp({ to: appointment.phone, text })
          await query(`insert into public.notification_delivery_logs(notification_id, channel, recipient, status, provider_reference) values($1, 'whatsapp', $2, 'delivered', $3)`, [notificationId, appointment.phone, res.messageId || 'baileys-ok'])
        } catch (err) {
          await query(`insert into public.notification_delivery_logs(notification_id, channel, recipient, status, error_message) values($1, 'whatsapp', $2, 'failed', $3)`, [notificationId, appointment.phone, err.message])
        }
      })())
    }
    await Promise.allSettled(deliveries)
    sent += 1
  }
  return send(res, 200, { ok: true, processed: rows.length, sent })
}

function billingWhatsappText(payment) {
  const panelUrl = `${APP_URL}/cliente/pagamentos/${payment.id}`;
  const lines = [
    `Ola, ${payment.full_name || "cliente"}.`,
    "",
    "Sua cobranca Carol Sol ja esta disponivel no painel.",
    "",
    `Motivo: ${payment.billing_reason || payment.service || "Pagamento do atendimento"}`,
    payment.service ? `Servico: ${payment.service}` : "",
    payment.professional ? `Profissional: ${payment.professional}` : "",
    payment.starts_at ? `Data/Horario: ${prettyDateTime(payment.starts_at)}` : "",
    `Valor: ${money(payment.amount)}`,
    "",
    `Pagar pelo painel: ${panelUrl}`,
  ];
  if (payment.hosted_checkout_url) {
    lines.push("", `Link seguro SumUp: ${payment.hosted_checkout_url}`);
  }
  lines.push("", "Qualquer duvida, responda por aqui.");
  return lines.filter((line) => line !== "").join("\n");
}

async function handleBillingWhatsapp(req, res) {
  await ensureNotificationRuntimeSchema();
  await query("alter table public.payments add column if not exists billing_reason text");

  const { rows } = await query(`
    select pay.id,pay.amount,pay.status,pay.created_at,pay.hosted_checkout_url,pay.billing_reason,
      c.id as client_id,cp.id as profile_id,cp.full_name,cp.phone,u.email,
      a.id as appointment_id,a.starts_at,s.name as service,pp.full_name as professional,
      coalesce(np.whatsapp,true) as wants_whatsapp
    from public.payments pay
    join public.clients c on c.id=pay.client_id
    join public.profiles cp on cp.id=c.profile_id
    join auth.users u on u.id=cp.id
    left join public.appointments a on a.id=pay.appointment_id
    left join public.services s on s.id=a.service_id
    left join public.professionals pr on pr.id=a.professional_id
    left join public.profiles pp on pp.id=pr.profile_id
    left join public.notification_preferences np on np.profile_id=cp.id
    where pay.status in ('pending','failed','expired','awaiting_confirmation','processing')
      and pay.created_at <= now() - interval '5 minutes'
      and coalesce(cp.phone,'') <> ''
      and coalesce(np.whatsapp,true)
      and not exists (
        select 1 from public.notifications n
         where n.notification_key = 'payment:' || pay.id::text || ':whatsapp_5m'
      )
    order by pay.created_at asc
    limit 25
  `);

  let sent = 0;
  for (const payment of rows) {
    const notificationKey = `payment:${payment.id}:whatsapp_5m`;
    const text = billingWhatsappText(payment);
    const data = JSON.stringify({
      payment_id: payment.id,
      appointment_id: payment.appointment_id || null,
      reason: "billing_whatsapp_5m",
    });
    const inserted = await query(
      `insert into public.notifications(profile_id,kind,title,body,data,action_url,metadata,notification_key,scheduled_at)
       values($1,'payment_whatsapp_followup','Cobranca disponivel',$2,$3,$4,$3,$5,now())
       on conflict(notification_key) do nothing returning id`,
      [
        payment.profile_id,
        text,
        data,
        `/cliente/pagamentos/${payment.id}`,
        notificationKey,
      ],
    );
    const notificationId = inserted.rows[0]?.id;
    if (!notificationId) continue;
    try {
      const result = await sendWhatsApp({ to: payment.phone, text });
      await query(
        `insert into public.notification_delivery_logs(notification_id, channel, recipient, status, provider_reference)
         values($1, 'whatsapp', $2, $3, $4)`,
        [
          notificationId,
          payment.phone,
          result.skipped ? "skipped" : "delivered",
          result.messageId || "baileys-ok",
        ],
      );
      if (!result.skipped) sent += 1;
    } catch (err) {
      await query(
        `insert into public.notification_delivery_logs(notification_id, channel, recipient, status, error_message)
         values($1, 'whatsapp', $2, 'failed', $3)`,
        [notificationId, payment.phone, err.message],
      );
    }
  }
  return send(res, 200, { ok: true, processed: rows.length, sent });
}

async function handleRenewals(req, res) {
  const execute =
    req.method === "POST" &&
    (req.query?.execute === "1" ||
      req.headers["x-recurring-execute"] === "true");
  const result = await runRecurringRenewals({
    limit: process.env.RECURRING_BATCH_LIMIT || 5,
    execute,
  });
  return send(res, 200, { ok: true, ...result });
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET" && req.method !== "POST")
      return send(res, 405, { error: "Método não permitido." });
    
    const expected = process.env.CRON_SECRET;
    if (!expected || req.headers.authorization !== `Bearer ${expected}`) {
      return send(res, 401, { error: "Não autorizado." });
    }

    const task = req.query?.task || (req.url && req.url.includes("renewals") ? "renewals" : "reminders");
    if (task === "renewals") {
      return await handleRenewals(req, res);
    } else if (task === "billing-whatsapp") {
      return await handleBillingWhatsapp(req, res);
    } else {
      return await handleReminders(req, res);
    }
  } catch (error) {
    console.error("Cron task execution error", {
      method: req.method,
      task: req.query?.task,
      status: error.status || 500,
      message: error.message,
    });
    return handleError(res, error);
  }
}
