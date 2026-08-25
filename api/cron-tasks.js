import { query } from '../server/lib/db.js'
import { sendEmail, sendWhatsApp } from '../server/lib/integrations.js'
import { handleError, send } from '../server/lib/http.js'
import { runRecurringRenewals } from "../server/lib/recurring-billing.js";
import {
  appointmentNotificationVersion,
  dueAppointmentReminderWindows,
  generateGoogleCalendarUrl,
  loadAppointmentAutomationContext,
} from "../server/lib/appointment-automation.js";
import { resumeDueHumanConversations } from "../server/lib/whatsapp-ai-engine.js";

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
  await query("alter table public.notifications add column if not exists appointment_id uuid references public.appointments(id) on delete cascade");
  await query("alter table public.notifications add column if not exists delivery_status text not null default 'pending'");
  await query("alter table public.notifications add column if not exists delivery_attempts integer not null default 0");
  await query("alter table public.notifications add column if not exists last_delivery_error text");
  await query("alter table public.notifications add column if not exists delivered_at timestamptz");
  await query("alter table public.notifications add column if not exists cancelled_at timestamptz");
  await query("alter table public.notifications add column if not exists updated_at timestamptz not null default now()");
}

const reminderLabel = (window) => window.key === "24h" ? "em aproximadamente 24 horas" : "em aproximadamente 2 horas";

async function deliverReminder({ notificationId, channel, recipient, sendDelivery }) {
  if (!recipient) return { delivered: false, error: "Destinatário não informado." };
  const previous = await query(
    `select 1 from public.notification_delivery_logs
      where notification_id=$1 and channel=$2 and status='delivered' limit 1`,
    [notificationId, channel],
  );
  if (previous.rowCount) return { delivered: true, reused: true };
  try {
    const result = await sendDelivery();
    if (result?.skipped) throw new Error("Canal não configurado no ambiente.");
    await query(
      `insert into public.notification_delivery_logs(notification_id,channel,recipient,status,provider_reference)
       values($1,$2,$3,'delivered',$4)`,
      [notificationId, channel, recipient, result?.id || result?.messageId || result?.provider || null],
    );
    return { delivered: true };
  } catch (error) {
    await query(
      `insert into public.notification_delivery_logs(notification_id,channel,recipient,status,error_message)
       values($1,$2,$3,'failed',$4)`,
      [notificationId, channel, recipient, error.message],
    );
    return { delivered: false, error: error.message };
  }
}

async function handleReminders(req, res) {
  await ensureNotificationRuntimeSchema();
  const automation = await loadAppointmentAutomationContext();
  const settings = automation.settings;
  const maxHours = Math.max(settings.reminder24hHoursBefore, settings.reminder2hHoursBefore) + 3;
  const { rows } = await query(`
    select a.id,a.booking_code,a.starts_at,a.ends_at,a.updated_at,s.name as service,l.name as location,
      cp.id as client_profile_id,cp.full_name as client_name,cp.phone as client_phone,cu.email as client_email,
      pp.id as professional_profile_id,pp.full_name as professional_name,pp.phone as professional_phone,pu.email as professional_email,
      coalesce(cnp.email,true) as client_wants_email,
      coalesce(cnp.whatsapp,true) as client_wants_whatsapp,
      coalesce(cnp.reminders,true) as client_wants_reminders,
      coalesce(pnp.email,true) as professional_wants_email,
      coalesce(pnp.whatsapp,true) as professional_wants_whatsapp,
      coalesce(pnp.reminders,true) as professional_wants_reminders
    from public.appointments a
    join public.services s on s.id=a.service_id
    join public.clients c on c.id=a.client_id join public.profiles cp on cp.id=c.profile_id join auth.users cu on cu.id=cp.id
    join public.professionals pr on pr.id=a.professional_id join public.profiles pp on pp.id=pr.profile_id
    left join auth.users pu on pu.id=pp.id
    left join public.salon_locations l on l.id=a.location_id
    left join public.notification_preferences cnp on cnp.profile_id=cp.id
    left join public.notification_preferences pnp on pnp.profile_id=pp.id
    where a.status in ('confirmed','pending_deposit')
      and a.starts_at between now() and now()+($1::text || ' hours')::interval
  `, [String(maxHours)])
  let sent = 0
  let failed = 0
  for (const appointment of rows) {
    const windows = dueAppointmentReminderWindows(appointment.starts_at, { settings });
    for (const window of windows) {
      const calendarUrl = settings.googleCalendarLinkEnabled ? generateGoogleCalendarUrl({
        ...appointment,
        professional: appointment.professional_name,
        client: appointment.client_name,
      }, automation) : "";
      const recipients = [
        {
          type: "client", profileId: appointment.client_profile_id, name: appointment.client_name,
          phone: appointment.client_phone, email: appointment.client_email,
          wantsEmail: appointment.client_wants_email, wantsWhatsapp: appointment.client_wants_whatsapp,
          enabled: appointment.client_wants_reminders,
          text: `🔔 Lembrete de agendamento\n\nOlá, ${appointment.client_name}! Seu atendimento de ${appointment.service} com ${appointment.professional_name} será ${reminderLabel(window)}.\nData e horário: ${prettyDateTime(appointment.starts_at)}${calendarUrl ? `\n\n📅 Adicionar ao Google Calendar:\n${calendarUrl}` : ""}`,
        },
        {
          type: "professional", profileId: appointment.professional_profile_id, name: appointment.professional_name,
          phone: appointment.professional_phone, email: appointment.professional_email,
          wantsEmail: appointment.professional_wants_email, wantsWhatsapp: appointment.professional_wants_whatsapp,
          enabled: appointment.professional_wants_reminders,
          text: `🔔 Lembrete de atendimento\n\nVocê possui um atendimento ${reminderLabel(window)}.\nCliente: ${appointment.client_name}\nServiço: ${appointment.service}\nData e horário: ${prettyDateTime(appointment.starts_at)}${calendarUrl ? `\n\n📅 Adicionar ao Google Calendar:\n${calendarUrl}` : ""}`,
        },
      ];
      for (const recipient of recipients) {
        if (!recipient.enabled) continue;
        const version = appointmentNotificationVersion(appointment);
        const notificationKey = `appointment:${appointment.id}:${recipient.type}:reminder:${window.key}:v${version}`;
        const claimed = await query(
          `insert into public.notifications(profile_id,appointment_id,kind,title,body,data,metadata,notification_key,scheduled_at,delivery_status,delivery_attempts)
           values($1,$2,'appointment_reminder',$3,$4,$5,$5,$6,now(),'processing',1)
           on conflict(notification_key) where notification_key is not null do update
             set delivery_status='processing',delivery_attempts=public.notifications.delivery_attempts+1,
                 last_delivery_error=null,updated_at=now()
             where public.notifications.delivery_status='failed'
               and public.notifications.delivery_attempts < $7
           returning id`,
          [recipient.profileId, appointment.id, `Lembrete de agendamento — ${window.key}`, recipient.text,
            JSON.stringify({ appointment_id: appointment.id, recipient_type: recipient.type, reminder: window.key, version }),
            notificationKey, settings.maxDeliveryAttempts],
        );
        const notificationId = claimed.rows[0]?.id;
        if (!notificationId) continue;
        const results = [];
        if (recipient.wantsEmail) results.push(await deliverReminder({ notificationId, channel: "email", recipient: recipient.email, sendDelivery: () => sendEmail({ to: recipient.email, subject: "Lembrete de agendamento — Carol Sol", html: `<p style="white-space:pre-line">${recipient.text}</p>` }) }));
        if (recipient.wantsWhatsapp) results.push(await deliverReminder({ notificationId, channel: "whatsapp", recipient: recipient.phone, sendDelivery: () => sendWhatsApp({ to: recipient.phone, text: recipient.text }) }));
        const hasFailure = results.length === 0 || results.some((result) => !result.delivered);
        const errorMessage = results.filter((result) => result.error).map((result) => result.error).join(" | ") || null;
        await query(
          `update public.notifications set delivery_status=$2,last_delivery_error=$3,
             delivered_at=case when $2='sent' then coalesce(delivered_at,now()) else delivered_at end,updated_at=now()
           where id=$1`,
          [notificationId, hasFailure ? "failed" : "sent", errorMessage],
        );
        if (hasFailure) failed += 1; else sent += 1;
      }
    }
  }
  const health = { lastRunAt: new Date().toISOString(), processed: rows.length, sent, failed };
  await query(
    `insert into public.business_settings(key,value,updated_at) values('appointment_reminder_health',$1,now())
     on conflict(key) do update set value=excluded.value,updated_at=now()`,
    [JSON.stringify(health)],
  ).catch(() => null);
  return send(res, 200, { ok: true, ...health })
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
       on conflict(notification_key) where notification_key is not null do nothing returning id`,
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
    } else if (task === "ai-human-resume") {
      const result = await resumeDueHumanConversations({ limit: 50 });
      return send(res, 200, { ok: true, ...result });
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
