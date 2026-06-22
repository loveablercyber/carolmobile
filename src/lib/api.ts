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

export async function uploadImage(file: File, kind = 'client-photo') {
  const signed = await apiFetch<{ cloudName: string; apiKey: string; timestamp: number; folder: string; signature: string }>('/api/upload', {
    method: 'POST', body: JSON.stringify({ kind })
  })
  const form = new FormData()
  form.append('file', file)
  form.append('api_key', signed.apiKey)
  form.append('timestamp', String(signed.timestamp))
  form.append('folder', signed.folder)
  form.append('signature', signed.signature)
  const response = await fetch(`https://api.cloudinary.com/v1_1/${signed.cloudName}/image/upload`, { method: 'POST', body: form })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error?.message || 'Falha ao enviar a imagem.')
  return { url: data.secure_url as string, publicId: data.public_id as string, width: data.width as number, height: data.height as number }
}
