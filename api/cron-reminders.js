import { query } from '../server/lib/db.js'
import { sendEmail, sendWhatsApp } from '../server/lib/integrations.js'
import { handleError, send } from '../server/lib/http.js'

function reminderWindow(startsAt) {
  const hours = (new Date(startsAt).getTime() - Date.now()) / 3_600_000
  // A execução diária no plano Hobby usa janelas amplas para não perder lembretes.
  if (hours >= 42 && hours < 54) return { key: '48h', label: 'em aproximadamente 48 horas' }
  if (hours >= 18 && hours < 30) return { key: '24h', label: 'amanhã' }
  return null
}

export default async function handler(req, res) {
  try {
    const expected = process.env.CRON_SECRET
    if (!expected || req.headers.authorization !== `Bearer ${expected}`) return send(res, 401, { error: 'Não autorizado.' })
    const { rows } = await query(`
      select a.id,a.starts_at,s.name as service,cp.id as profile_id,cp.full_name,cp.phone,u.email,pp.full_name as professional
      from public.appointments a
      join public.services s on s.id=a.service_id
      join public.clients c on c.id=a.client_id join public.profiles cp on cp.id=c.profile_id join auth.users u on u.id=cp.id
      join public.professionals pr on pr.id=a.professional_id join public.profiles pp on pp.id=pr.profile_id
      where a.status in ('confirmed','pending_deposit') and a.starts_at between now()+interval '18 hours' and now()+interval '54 hours'
    `)
    let sent = 0
    for (const appointment of rows) {
      const window = reminderWindow(appointment.starts_at)
      if (!window) continue
      const notificationKey = `appointment:${appointment.id}:reminder:${window.key}`
      const text = `Olá, ${appointment.full_name}! Lembrete Carol Sol: seu atendimento de ${appointment.service} com ${appointment.professional} será ${window.label}.`
      const inserted = await query(`insert into public.notifications(profile_id,kind,title,body,data,notification_key,scheduled_at) values($1,'appointment_reminder',$2,$3,$4,$5,now()) on conflict(notification_key) do nothing returning id`, [appointment.profile_id, `Lembrete de agendamento — ${window.key}`, text, JSON.stringify({ appointment_id: appointment.id }), notificationKey])
      if (!inserted.rowCount) continue
      await Promise.allSettled([
        sendEmail({ to: appointment.email, subject: 'Lembrete de agendamento — Carol Sol', html: `<p>${text}</p>` }),
        sendWhatsApp({ to: appointment.phone, text })
      ])
      sent += 1
    }
    return send(res, 200, { ok: true, processed: rows.length, sent })
  } catch (error) {
    return handleError(res, error)
  }
}
