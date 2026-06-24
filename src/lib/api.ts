export type UserRole = 'client' | 'professional' | 'admin'
export type SessionUser = { id: string; role: UserRole; full_name: string; phone?: string; avatar_url?: string }

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    console.error('API request failed', { path, status: response.status, error: data.error })
    throw new Error(data.error || 'Não foi possível concluir a operação.')
  }
  return data as T
}

export type UploadedFile = {
  url: string
  publicId: string
  resourceType: 'image' | 'video' | 'raw'
  format?: string
  bytes?: number
  width?: number
  height?: number
}

const uploadKind = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'attachment'

export async function uploadFile(file: File, kind = 'attachment'): Promise<UploadedFile> {
  const signed = await apiFetch<{
    apiKey: string
    timestamp: number
    folder: string
    signature: string
    uploadUrl: string
  }>('/api/upload', {
    method: 'POST',
    body: JSON.stringify({
      kind: uploadKind(kind),
      contentType: file.type || 'application/octet-stream',
      size: file.size,
      fileName: file.name,
    }),
  })
  const form = new FormData()
  form.append('file', file)
  form.append('api_key', signed.apiKey)
  form.append('timestamp', String(signed.timestamp))
  form.append('folder', signed.folder)
  form.append('signature', signed.signature)
  const response = await fetch(signed.uploadUrl, { method: 'POST', body: form })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    console.error('Cloudinary upload failed', {
      status: response.status,
      error: data.error?.message,
      kind: uploadKind(kind),
    })
    throw new Error(data.error?.message || 'Falha ao enviar o arquivo.')
  }
  return {
    url: data.secure_url as string,
    publicId: data.public_id as string,
    resourceType: data.resource_type as UploadedFile['resourceType'],
    format: data.format as string | undefined,
    bytes: data.bytes as number | undefined,
    width: data.width as number | undefined,
    height: data.height as number | undefined,
  }
}

export async function uploadImage(file: File, kind = 'client-photo') {
  if (!file.type.startsWith('image/')) throw new Error('Selecione uma imagem válida.')
  return uploadFile(file, kind)
}
