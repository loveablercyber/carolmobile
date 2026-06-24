import { SignJWT, jwtVerify } from 'jose'
import { getCookie, appError } from './http.js'
import { query } from './db.js'

const COOKIE_NAME = 'carol_sol_session'
const key = () => new TextEncoder().encode(process.env.JWT_SECRET || 'development-only-change-me')

export async function createSession(user) {
  return new SignJWT({ role: user.role, profileId: user.id, name: user.full_name })
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
    return { id: payload.sub, role: payload.role, name: payload.name }
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
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800${secure}`)
}

export function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`)
}
