import { SignJWT, jwtVerify } from 'jose'
import { createHash } from 'node:crypto'
import { getCookie, appError } from './http.js'
import { query } from './db.js'

const COOKIE_NAME = 'carol_sol_session'
const key = () => new TextEncoder().encode(process.env.JWT_SECRET || 'development-only-change-me')

function credentialVersion(passwordHash) {
  return createHash('sha256').update(String(passwordHash || '')).digest('base64url').slice(0, 22)
}

export function shouldUseSecureSessionCookie() {
  const override = String(process.env.SESSION_COOKIE_SECURE || '').trim().toLowerCase()
  if (['1', 'true', 'yes', 'sim'].includes(override)) return true
  if (['0', 'false', 'no', 'nao', 'não'].includes(override)) return false

  const appUrl = String(process.env.APP_URL || '').trim()
  if (appUrl) {
    try {
      return new URL(appUrl).protocol === 'https:'
    } catch {
      // Fall through to the production-safe default for malformed URLs.
    }
  }
  return process.env.NODE_ENV === 'production'
}

export async function createSession(user) {
  const { rows } = await query(
    `select u.encrypted_password,u.email,p.role,p.full_name,p.account_status
       from auth.users u join public.profiles p on p.id=u.id
      where u.id=$1 limit 1`,
    [user.id],
  )
  const identity = rows[0]
  if (!identity?.encrypted_password || ['blocked', 'anonymized', 'deleted'].includes(identity.account_status)) {
    throw appError('Conta de autenticação não encontrada.', 401)
  }
  return new SignJWT({
    role: identity.role,
    profileId: user.id,
    name: identity.full_name,
    email: identity.email,
    cv: credentialVersion(identity.encrypted_password),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(key())
}

export async function readSession(req) {
  const token = getCookie(req, COOKIE_NAME)
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, key())
    if (!payload.sub) return null
    const { rows } = await query(
      `select u.encrypted_password,p.role,p.full_name,p.account_status
         from auth.users u join public.profiles p on p.id=u.id
        where u.id=$1 limit 1`,
      [payload.sub],
    )
    const identity = rows[0]
    if (!identity || ['blocked', 'anonymized', 'deleted'].includes(identity.account_status)) return null
    if (!payload.cv || payload.cv !== credentialVersion(identity.encrypted_password)) return null
    return { id: payload.sub, role: identity.role, name: identity.full_name }
  } catch {
    return null
  }
}

export async function requireUser(req, roles = []) {
  const user = await readSession(req)
  if (!user) throw appError('Faça login para continuar.', 401)
  const { rows } = await query('select role,full_name,account_status from public.profiles where id=$1', [user.id])
  const profile = rows[0]
  if (!profile) throw appError('Conta não encontrada.', 401)
  if (['blocked', 'anonymized', 'deleted'].includes(profile.account_status))
    throw appError('Esta conta não possui acesso ativo.', 403)
  if (roles.length && !roles.includes(profile.role)) throw appError('Você não tem permissão para esta ação.', 403)
  return { id: user.id, role: profile.role, name: profile.full_name }
}

export function setSessionCookie(res, token) {
  const secure = shouldUseSecureSessionCookie() ? '; Secure' : ''
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800${secure}`)
}

export function clearSessionCookie(res) {
  const secure = shouldUseSecureSessionCookie() ? '; Secure' : ''
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`)
}
