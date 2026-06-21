import bcrypt from 'bcryptjs'
import { createHash, randomBytes } from 'node:crypto'
import { query, transaction } from '../server/lib/db.js'
import { createSession, readSession, setSessionCookie, clearSessionCookie } from '../server/lib/auth.js'
import { appError, getBody, handleError, methodNotAllowed, send } from '../server/lib/http.js'
import { sendEmail } from '../server/lib/integrations.js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {})
  try {
    if (req.method === 'GET') {
      const session = await readSession(req)
      if (!session) return send(res, 200, { user: null })
      const { rows } = await query('select id, role, full_name, phone, avatar_url from public.profiles where id = $1', [session.id])
      return send(res, 200, { user: rows[0] || null })
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
        await client.query(`insert into public.clients(profile_id, source, preferences) values ($1,'Cadastro pelo aplicativo','{}')`, [userId])
        await client.query(`insert into public.consent_logs(profile_id, consent_type, granted, policy_version, source) values ($1,'terms_and_lgpd',true,'1.0','app_registration')`, [userId])
        return profiles[0]
      })
      const token = await createSession(profile)
      setSessionCookie(res, token)
      return send(res, 201, { user: profile })
    }

    const identifier = String(body.identifier || body.email || '').trim()
    const password = String(body.password || '')
    if (!identifier || !password) throw appError('Informe e-mail/telefone e senha.')
    const { rows } = await query(`
      select p.id, p.role, p.full_name, p.phone, p.avatar_url, u.email, u.encrypted_password
      from auth.users u join public.profiles p on p.id = u.id
      where lower(u.email) = lower($1) or u.phone = $1 or p.phone = $1
      limit 1
    `, [identifier])
    const user = rows[0]
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
