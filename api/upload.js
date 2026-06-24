import { requireUser } from '../server/lib/auth.js'
import { query, transaction } from '../server/lib/db.js'
import {
  cloudinaryProviderForRotation,
  createCloudinaryUploadSignature,
} from '../server/lib/integrations.js'
import { appError, getBody, handleError, methodNotAllowed, send } from '../server/lib/http.js'

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
const allowedDocumentTypes = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
])

function uploadInput(body) {
  const kind = String(body.kind || 'attachment').trim().toLowerCase()
  const contentType = String(body.contentType || '').trim().toLowerCase()
  const size = Number(body.size || 0)
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(kind))
    throw appError('Tipo de arquivo inválido.')
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_UPLOAD_BYTES)
    throw appError('O arquivo deve ter no máximo 20 MB.')
  const supported =
    contentType.startsWith('image/') ||
    contentType.startsWith('video/') ||
    allowedDocumentTypes.has(contentType)
  if (!supported) throw appError('Formato de arquivo não permitido.')
  if (
    kind !== 'payment-receipt' &&
    kind !== 'attachment' &&
    !contentType.startsWith('image/')
  )
    throw appError('Este campo aceita somente imagens.')
  if (
    kind === 'payment-receipt' &&
    !(contentType.startsWith('image/') || contentType === 'application/pdf')
  )
    throw appError('O comprovante deve ser uma imagem ou PDF.')
  return { kind }
}

async function nextRotationValue() {
  try {
    const { rows } = await query(
      "select nextval('public.cloudinary_upload_rotation_seq')::text as value",
    )
    return rows[0]?.value
  } catch (error) {
    if (error.code === '42P01') {
      return transaction(async (client) => {
        await client.query(
          "select pg_advisory_xact_lock(hashtext('cloudinary_upload_rotation'))",
        )
        await client.query(`create sequence if not exists public.cloudinary_upload_rotation_seq
          as bigint increment by 1 minvalue 1 start with 1 cache 1`)
        await client.query(
          `insert into public._luxe_migrations(version,description)
           values ('010_cloudinary_rotation','Rotação global de uploads entre contas Cloudinary')
           on conflict(version) do nothing`,
        )
        const { rows } = await client.query(
          "select nextval('public.cloudinary_upload_rotation_seq')::text as value",
        )
        return rows[0]?.value
      })
    }
    throw error
  }
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    await requireUser(req)
    const body = getBody(req)
    const { kind } = uploadInput(body)
    const provider = cloudinaryProviderForRotation(await nextRotationValue())
    const baseFolder = String(process.env.CLOUDINARY_DEFAULT_FOLDER || 'carol-sol')
      .replace(/[^a-zA-Z0-9/_-]/g, '-')
      .replace(/^\/+|\/+$/g, '')
    const folder = `${baseFolder}/${kind}`
    const signature = createCloudinaryUploadSignature(provider, { folder })
    return send(res, 200, {
      ...signature,
      uploadUrl: `https://api.cloudinary.com/v1_1/${provider.cloudName}/auto/upload`,
    })
  } catch (error) {
    console.error('Cloudinary upload authorization error', {
      status: error.status || 500,
      message: error.message,
    })
    return handleError(res, error)
  }
}
