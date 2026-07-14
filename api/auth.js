import bcrypt from 'bcryptjs'
import { createHash, randomBytes } from 'node:crypto'
import { query, transaction } from '../server/lib/db.js'
import { createSession, readSession, setSessionCookie, clearSessionCookie } from '../server/lib/auth.js'
import { appError, getBody, handleError, methodNotAllowed, send } from '../server/lib/http.js'
import { sendEmail, sendWhatsApp } from '../server/lib/integrations.js'

export async function processReferralCode(client, { refCode, newClientId, fullName, phone, userId }) {
  const code = String(refCode || '').trim().toUpperCase().slice(0, 80)
  if (!code) return null

  const existing = await client.query(
    `select id,referrer_client_id from public.referrals
     where upper(code)=$1 and status='invited' and referred_client_id is null
     for update`,
    [code]
  )
  let referral = existing.rows[0] || null

  if (referral && referral.referrer_client_id !== newClientId) {
    const linked = await client.query(
      `update public.referrals
       set referred_client_id=$1,status='registered'
       where id=$2 and status='invited' and referred_client_id is null
       returning id,referrer_client_id`,
      [newClientId, referral.id]
    )
    referral = linked.rows[0] || null
  } else {
    referral = null
  }

  const generic = code.match(/^CAROL([0-9A-F]{8})$/)
  if (!referral && generic) {
    const referrer = await client.query(
      `select c.id from public.clients c
       join public.profiles p on p.id=c.profile_id
       where replace(p.id::text,'-','') ilike $1
       limit 1`,
      [`${generic[1]}%`]
    )
    const referrerClientId = referrer.rows[0]?.id
    if (referrerClientId && referrerClientId !== newClientId) {
      const uniqueCode = `${code}-${randomBytes(3).toString('hex').toUpperCase()}`
      const inserted = await client.query(
        `insert into public.referrals(
           referrer_client_id,referred_client_id,code,status,invited_name,invited_phone
         ) values($1,$2,$3,'registered',$4,$5)
         returning id,referrer_client_id`,
        [referrerClientId, newClientId, uniqueCode, fullName, phone || null]
      )
      referral = inserted.rows[0] || null
    }
  }

  if (!referral) return null
  await client.query(
    `insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_data)
     values($1,'referral_registered','referral',$2,$3)`,
    [
      userId,
      referral.id,
      JSON.stringify({
        referrer_client_id: referral.referrer_client_id,
        ref_code: code,
      }),
    ]
  )
  return referral
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {})
  try {
    if (req.method === 'GET') {
      const session = await readSession(req)
      if (!session) return send(res, 200, { user: null })
      const { rows } = await query('select id, role, full_name, phone, avatar_url,account_status from public.profiles where id = $1', [session.id])
      if (!rows[0] || ['blocked','anonymized','deleted'].includes(rows[0].account_status)) {
        clearSessionCookie(res)
        return send(res, 200, { user: null })
      }
      return send(res, 200, { user: rows[0] })
    }

    if (req.method !== 'POST') return methodNotAllowed(res, ['GET', 'POST'])
    const body = getBody(req)
    const action = body.action || req.query?.action || 'login'

    if (action === 'logout') {
      clearSessionCookie(res)
      return send(res, 200, { ok: true })
    }

    if (action === 'request_reset') {
      const email = String(body.email || body.identifier || '').trim().toLowerCase()
      const { rows } = await query('select id,email from auth.users where lower(email)=lower($1) limit 1', [email])
      if (rows[0]) {
        const token = randomBytes(32).toString('hex')
        const tokenHash = createHash('sha256').update(token).digest('hex')
        await query(`insert into auth.password_reset_tokens(user_id,token_hash,expires_at) values($1,$2,now()+interval '30 minutes')`, [rows[0].id, tokenHash])
        const url = `${process.env.APP_URL || 'http://localhost:5173'}/redefinir?token=${token}`
        await sendEmail({ to: rows[0].email, subject: 'Redefina sua senha — Carol Sol', html: `<h1>Redefinição de senha</h1><p>Use o botão abaixo em até 30 minutos.</p><p><a href="${url}" style="background:#181511;color:#fff;padding:12px 20px;border-radius:12px;text-decoration:none">Criar nova senha</a></p>` })
      }
      return send(res, 200, { ok: true, message: 'Se o e-mail estiver cadastrado, enviaremos as instruções.' })
    }

    if (action === 'reset_password') {
      const token = String(body.token || '')
      const password = String(body.password || '')
      if (password.length < 8) throw appError('A senha precisa ter pelo menos 8 caracteres.')
      const tokenHash = createHash('sha256').update(token).digest('hex')
      const passwordHash = await bcrypt.hash(password, 12)
      const updated = await transaction(async client => {
        const { rows } = await client.query(`select id,user_id from auth.password_reset_tokens where token_hash=$1 and used_at is null and expires_at>now() for update`, [tokenHash])
        if (!rows[0]) return false
        await client.query('update auth.users set encrypted_password=$1,updated_at=now() where id=$2', [passwordHash, rows[0].user_id])
        await client.query('update auth.password_reset_tokens set used_at=now() where id=$1', [rows[0].id])
        return true
      })
      if (!updated) throw appError('Este link expirou ou já foi utilizado.', 400)
      return send(res, 200, { ok: true })
    }

    if (action === 'register') {
      const fullName = String(body.fullName || '').trim()
      const email = String(body.email || '').trim().toLowerCase()
      const phone = String(body.phone || '').trim() || null
      const refCode = body.refCode
      const password = String(body.password || '')
      if (fullName.length < 3) throw appError('Informe seu nome completo.')
      if (!/^\S+@\S+\.\S+$/.test(email)) throw appError('Informe um e-mail válido.')
      if (password.length < 8) throw appError('A senha precisa ter pelo menos 8 caracteres.')
      const passwordHash = await bcrypt.hash(password, 12)
      const profile = await transaction(async client => {
        const existing = await client.query('select 1 from auth.users where lower(email) = lower($1)', [email])
        if (existing.rowCount) throw appError('Este e-mail já está cadastrado.', 409)
        const { rows: users } = await client.query(`insert into auth.users(email, phone, encrypted_password, email_confirmed_at, raw_user_meta_data) values ($1,$2,$3,now(),$4) returning id`, [email, phone, passwordHash, JSON.stringify({ name: fullName })])
        const userId = users[0].id
        const { rows: profiles } = await client.query(`insert into public.profiles(id, role, full_name, phone, notification_preferences) values ($1,'client',$2,$3,'{"email":true,"whatsapp":true,"push":true}') returning id, role, full_name, phone, avatar_url`, [userId, fullName, phone])
        const { rows: newClients } = await client.query(`insert into public.clients(profile_id, source, preferences) values ($1,'Cadastro pelo aplicativo','{}') returning id`, [userId])
        await processReferralCode(client, { refCode, newClientId: newClients[0].id, fullName, phone, userId })
        await client.query(`insert into public.consent_logs(profile_id, consent_type, granted, policy_version, source) values ($1,'terms_and_lgpd',true,'1.0','app_registration')`, [userId])
        return profiles[0]
      })
      const token = await createSession(profile)
      setSessionCookie(res, token)
      await Promise.allSettled([
        sendEmail({
          to: email,
          subject: 'Conta criada - Carol Sol',
          html: `<p>Ola, ${fullName}. Sua conta Carol Sol foi criada com sucesso.</p><p>Agora voce pode acompanhar agendamentos, pagamentos, beneficios e notificacoes pelo aplicativo.</p>`,
        }).catch((error) =>
          console.error('Falha ao enviar e-mail de boas-vindas:', error.message),
        ),
        (async () => {
          if (phone) {
            await sendWhatsApp({
              to: phone,
              text: `Olá, ${fullName}! Sua conta Carol Sol foi criada com sucesso. Acesse o portal para acompanhar seus agendamentos, pagamentos e benefícios.`,
            }).catch((error) =>
              console.error('Falha ao enviar WhatsApp de boas-vindas:', error.message),
            )
          }
        })()
      ])
      return send(res, 201, { user: profile })
    }

    const identifier = String(body.identifier || body.email || '').trim()
    const password = String(body.password || '')
    if (!identifier || !password) throw appError('Informe e-mail/telefone e senha.')
    const { rows } = await query(`
      select p.id, p.role, p.full_name, p.phone, p.avatar_url, p.account_status, u.email, u.encrypted_password
      from auth.users u join public.profiles p on p.id = u.id
      where lower(u.email) = lower($1) or u.phone = $1 or p.phone = $1
      limit 1
    `, [identifier])
    const user = rows[0]
    if (user && ['blocked','anonymized','deleted'].includes(user.account_status))
      throw appError('Esta conta não possui acesso ativo.', 403)
    if (!user || !user.encrypted_password || !(await bcrypt.compare(password, user.encrypted_password))) throw appError('E-mail/telefone ou senha incorretos.', 401)
    await query('update auth.users set updated_at = now() where id = $1', [user.id])
    const token = await createSession(user)
    setSessionCookie(res, token)
    delete user.encrypted_password
    return send(res, 200, { user })
  } catch (error) {
    return handleError(res, error)
  }
}
