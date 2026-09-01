import { createHash, randomBytes } from 'node:crypto'
import { query, transaction } from './db.js'
import { appError } from './http.js'

const productionOrigins = new Set([
  'https://carolsol.com.br',
  'https://www.carolsol.com.br',
  'https://loja.carolsol.com.br',
  'https://academy.carolsol.com.br',
  'https://elo.carolsol.com.br',
  'https://agenda.carolsol.com.br',
])

function allowedOrigins() {
  const configured = String(process.env.SSO_ALLOWED_ORIGINS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
    .map(value => new URL(value).origin)
  return new Set([...productionOrigins, ...configured])
}

function codeHash(code) {
  return createHash('sha256').update(code).digest('hex')
}

export function requestPublicOrigin(req) {
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim()
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
  const host = forwardedHost || String(req.headers.host || '').trim()
  const proto = forwardedProto || (process.env.NODE_ENV === 'production' ? 'https' : 'http')
  return new URL(`${proto}://${host}`).origin
}

export function safeReturnPath(value, fallback = '/') {
  const path = String(value || fallback).trim()
  return path.startsWith('/') && !path.startsWith('//') ? path.slice(0, 1000) : fallback
}

export async function issueSsoCode({ identityId, targetOrigin, returnPath, sourceOrigin }) {
  const target = new URL(targetOrigin).origin
  if (!allowedOrigins().has(target)) throw appError('Destino de acesso não autorizado.', 400)
  const code = randomBytes(32).toString('base64url')
  await transaction(async client => {
    await client.query("delete from public.carolsol_sso_codes where expires_at<now()-interval '1 day'")
    const { rows } = await client.query(
      `select count(*)::int as count from public.carolsol_sso_codes
        where identity_user_id=$1 and created_at>now()-interval '1 minute'`,
      [identityId],
    )
    if (Number(rows[0]?.count || 0) >= 10) throw appError('Muitas trocas de painel. Aguarde um minuto.', 429)
    await client.query(
      `insert into public.carolsol_sso_codes(
         code_hash,identity_user_id,target_origin,return_path,source_origin,expires_at
       ) values($1,$2,$3,$4,$5,now()+interval '60 seconds')`,
      [codeHash(code), identityId, target, safeReturnPath(returnPath), sourceOrigin || null],
    )
  })
  return { code, target }
}

export async function consumeSsoCode({ code, targetOrigin }) {
  const target = new URL(targetOrigin).origin
  if (!allowedOrigins().has(target)) return null
  return transaction(async client => {
    const { rows } = await client.query(
      `select id,identity_user_id,return_path
         from public.carolsol_sso_codes
        where code_hash=$1 and target_origin=$2
          and used_at is null and expires_at>now()
        for update`,
      [codeHash(code), target],
    )
    const record = rows[0]
    if (!record) return null
    await client.query('update public.carolsol_sso_codes set used_at=now() where id=$1', [record.id])
    return {
      identityId: record.identity_user_id,
      returnPath: safeReturnPath(record.return_path, '/'),
    }
  })
}
