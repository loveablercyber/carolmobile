import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { requireUser } from '../server/lib/auth.js'
import { query, transaction } from '../server/lib/db.js'
import {
  cloudinaryProviders,
  cloudinaryProviderForRotation,
  createCloudinaryUploadSignature,
  isMinioConfigured,
  minioConfig,
  uploadBufferToMinio,
} from '../server/lib/integrations.js'
import { appError, getBody, handleError, methodNotAllowed, send } from '../server/lib/http.js'

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
const uploadsRoot = process.env.UPLOAD_DIR || fileURLToPath(new URL('../uploads', import.meta.url))
const allowedDocumentTypes = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
])

const truthy = (value) =>
  ['1', 'true', 'yes', 'on', 'sim'].includes(String(value || '').toLowerCase())

const extensionByType = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
  ['video/mp4', '.mp4'],
  ['application/pdf', '.pdf'],
  ['text/plain', '.txt'],
  ['text/csv', '.csv'],
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

function contentTypeAllowed(contentType, kind) {
  const supported =
    contentType.startsWith('image/') ||
    contentType.startsWith('video/') ||
    allowedDocumentTypes.has(contentType)
  if (!supported) return false
  if (
    kind !== 'payment-receipt' &&
    kind !== 'attachment' &&
    !contentType.startsWith('image/')
  )
    return false
  if (
    kind === 'payment-receipt' &&
    !(contentType.startsWith('image/') || contentType === 'application/pdf')
  )
    return false
  return true
}

async function readRawBody(req) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > MAX_UPLOAD_BYTES + 1024 * 1024)
      throw appError('O arquivo deve ter no maximo 20 MB.', 413)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

function parseMultipart(req, buffer) {
  const contentType = String(req.headers['content-type'] || '')
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.[1] ||
    contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.[2]
  if (!boundary) throw appError('Formulario de upload invalido.')
  const boundaryBuffer = Buffer.from(`--${boundary}`)
  const fields = {}
  let file = null
  let position = 0

  while (position < buffer.length) {
    const boundaryIndex = buffer.indexOf(boundaryBuffer, position)
    if (boundaryIndex === -1) break
    let partStart = boundaryIndex + boundaryBuffer.length
    if (buffer.slice(partStart, partStart + 2).toString() === '--') break
    if (buffer.slice(partStart, partStart + 2).toString() === '\r\n') partStart += 2
    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), partStart)
    if (headerEnd === -1) break
    const headerText = buffer.slice(partStart, headerEnd).toString('utf8')
    let partEnd = buffer.indexOf(boundaryBuffer, headerEnd + 4)
    if (partEnd === -1) partEnd = buffer.length
    let content = buffer.slice(headerEnd + 4, partEnd)
    if (content.slice(-2).toString() === '\r\n') content = content.slice(0, -2)
    const name = headerText.match(/name="([^"]+)"/i)?.[1] || ''
    const filename = headerText.match(/filename="([^"]*)"/i)?.[1] || ''
    const type = headerText.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim().toLowerCase() || ''
    if (filename) {
      file = { name, filename, contentType: type || 'application/octet-stream', buffer: content }
    } else if (name) {
      fields[name] = content.toString('utf8')
    }
    position = partEnd
  }

  return { fields, file }
}

function publicUploadUrl(relativePath) {
  const appUrl = String(process.env.APP_URL || '').replace(/\/+$/, '')
  const path = `/uploads/${relativePath.replace(/^\/+/, '')}`
  return appUrl ? `${appUrl}${path}` : path
}

async function handleLocalUpload(req, res) {
  if (!truthy(process.env.LOCAL_UPLOAD_ENABLED)) {
    throw appError('Upload local nao configurado.', 503)
  }
  const parsed = parseMultipart(req, await readRawBody(req))
  const kind = String(parsed.fields.kind || 'attachment').trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(kind))
    throw appError('Tipo de arquivo invalido.')
  const file = parsed.file
  if (!file?.buffer?.length) throw appError('Arquivo nao informado.')
  if (file.buffer.length > MAX_UPLOAD_BYTES)
    throw appError('O arquivo deve ter no maximo 20 MB.')
  if (!contentTypeAllowed(file.contentType, kind))
    throw appError('Formato de arquivo nao permitido.')

  const baseFolder = String(process.env.LOCAL_UPLOAD_FOLDER || 'carol-sol')
    .replace(/[^a-zA-Z0-9/_-]/g, '-')
    .replace(/^\/+|\/+$/g, '')
  const now = new Date()
  const dateFolder = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
  ].join('/')
  const originalExt = extname(file.filename || '').toLowerCase().replace(/[^a-z0-9.]/g, '')
  const extension = originalExt || extensionByType.get(file.contentType) || ''
  const id = randomUUID()
  const relativePath = `${baseFolder}/${kind}/${dateFolder}/${id}${extension}`
  const target = join(uploadsRoot, ...relativePath.split('/'))
  await mkdir(join(uploadsRoot, baseFolder, kind, dateFolder), { recursive: true })
  await writeFile(target, file.buffer, { flag: 'wx' })
  const resourceType = file.contentType.startsWith('image/')
    ? 'image'
    : file.contentType.startsWith('video/')
      ? 'video'
      : 'raw'
  return send(res, 200, {
    url: publicUploadUrl(relativePath),
    secure_url: publicUploadUrl(relativePath),
    publicId: relativePath,
    public_id: relativePath,
    resourceType,
    resource_type: resourceType,
    format: extension.replace(/^\./, '') || undefined,
    bytes: file.buffer.length,
    provider: 'local',
  })
}

async function handleMinioUpload(req, res) {
  if (!isMinioConfigured()) {
    throw appError('MinIO nao configurado.', 503)
  }
  const parsed = parseMultipart(req, await readRawBody(req))
  const kind = String(parsed.fields.kind || 'attachment').trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(kind))
    throw appError('Tipo de arquivo invalido.')
  const file = parsed.file
  if (!file?.buffer?.length) throw appError('Arquivo nao informado.')
  if (file.buffer.length > MAX_UPLOAD_BYTES)
    throw appError('O arquivo deve ter no maximo 20 MB.')
  if (!contentTypeAllowed(file.contentType, kind))
    throw appError('Formato de arquivo nao permitido.')

  const cfg = minioConfig()
  const now = new Date()
  const dateFolder = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
  ].join('/')
  const originalExt = extname(file.filename || '').toLowerCase().replace(/[^a-z0-9.]/g, '')
  const extension = originalExt || extensionByType.get(file.contentType) || ''
  const id = randomUUID()
  const key = `${cfg.baseFolder}/${kind}/${dateFolder}/${id}${extension}`
  const uploaded = await uploadBufferToMinio({
    key,
    buffer: file.buffer,
    contentType: file.contentType,
  })
  const resourceType = file.contentType.startsWith('image/')
    ? 'image'
    : file.contentType.startsWith('video/')
      ? 'video'
      : 'raw'
  return send(res, 200, {
    url: uploaded.url,
    secure_url: uploaded.url,
    publicId: uploaded.publicId,
    public_id: uploaded.publicId,
    resourceType,
    resource_type: resourceType,
    format: extension.replace(/^\./, '') || undefined,
    bytes: file.buffer.length,
    provider: 'minio',
  })
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
    if (String(req.headers['content-type'] || '').toLowerCase().includes('multipart/form-data')) {
      const url = new URL(req.url || '/api/upload', 'http://localhost')
      if (url.searchParams.get('storage') === 'minio') return await handleMinioUpload(req, res)
      return await handleLocalUpload(req, res)
    }
    const body = getBody(req)
    const { kind } = uploadInput(body)
    if (isMinioConfigured()) {
      return send(res, 200, {
        provider: 'minio',
        uploadUrl: '/api/upload?storage=minio',
      })
    }
    if (truthy(process.env.LOCAL_UPLOAD_ENABLED) && !cloudinaryProviders().length) {
      return send(res, 200, {
        provider: 'local',
        uploadUrl: '/api/upload?storage=local',
      })
    }
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
