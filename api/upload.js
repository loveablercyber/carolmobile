import { requireUser } from '../server/lib/auth.js'
import { createCloudinarySignature } from '../server/lib/integrations.js'
import { getBody, handleError, methodNotAllowed, send } from '../server/lib/http.js'

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    const user = await requireUser(req)
    const body = getBody(req)
    const signature = createCloudinarySignature(`${user.id}:${body.kind || 'client-photo'}:${Date.now()}`)
    return send(res, 200, signature)
  } catch (error) {
    return handleError(res, error)
  }
}
