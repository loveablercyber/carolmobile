export function send(res, status, data) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(data))
}

export function methodNotAllowed(res, allowed) {
  res.setHeader('Allow', allowed.join(', '))
  return send(res, 405, { error: 'Método não permitido.' })
}

export function getBody(req) {
  if (!req.body) return {}
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body) } catch { return {} }
  }
  return req.body
}

export function getCookie(req, name) {
  const cookies = String(req.headers.cookie || '').split(';')
  for (const cookie of cookies) {
    const [key, ...parts] = cookie.trim().split('=')
    if (key === name) return decodeURIComponent(parts.join('='))
  }
  return null
}

export function handleError(res, error) {
  const status = error.status || 500
  if (status >= 500) {
    console.error('API error', {
      status,
      message: error.message,
      code: error.code || null,
      stack: process.env.NODE_ENV === 'production' ? undefined : error.stack
    })
  }
  return send(res, status, {
    error:
      status >= 500 && error.expose !== true
        ? 'Não foi possível concluir a operação.'
        : error.message,
  })
}

export function appError(message, status = 400) {
  const error = new Error(message)
  error.status = status
  return error
}
