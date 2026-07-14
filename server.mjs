import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = fileURLToPath(new URL('.', import.meta.url))
const staticRoot = join(appRoot, 'dist')
const uploadsRoot = process.env.UPLOAD_DIR || join(appRoot, 'uploads')
const port = Number(process.env.PORT || 5173)
const host = process.env.HOST || '0.0.0.0'
const maxBodyBytes = Number(process.env.MAX_BODY_BYTES || 5 * 1024 * 1024)
const internalCronEnabled = ['1', 'true', 'yes', 'sim'].includes(
  String(process.env.INTERNAL_CRON_ENABLED || '').toLowerCase(),
)

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
}

const apiModules = {
  '/api/admin-migrations': () => import('./api/admin-migrations.js'),
  '/api/ai-whatsapp': () => import('./api/ai-whatsapp.js'),
  '/api/auth': () => import('./api/auth.js'),
  '/api/clean-media': () => import('./api/clean-media.js'),
  '/api/cron-tasks': () => import('./api/cron-tasks.js'),
  '/api/data': () => import('./api/data.js'),
  '/api/health': () => import('./api/health.js'),
  '/api/payments': () => import('./api/payments.js'),
  '/api/portal': () => import('./api/portal.js'),
  '/api/recurring-sandbox': () => import('./api/recurring-sandbox.js'),
  '/api/upload': () => import('./api/upload.js'),
  '/api/whatsapp': () => import('./api/whatsapp.js'),
}

function applyVercelRewrite(pathname, searchParams) {
  if (pathname === '/api/cron-renewals') {
    searchParams.set('task', 'renewals')
    return '/api/cron-tasks'
  }
  if (pathname === '/api/cron-reminders') {
    searchParams.set('task', 'reminders')
    return '/api/cron-tasks'
  }
  if (pathname === '/api/cron-billing-whatsapp') {
    searchParams.set('task', 'billing-whatsapp')
    return '/api/cron-tasks'
  }
  if (pathname === '/api/whatsapp-keepalive') {
    searchParams.set('resource', 'keepalive')
    return '/api/whatsapp'
  }
  if (pathname === '/api/webhooks/baileys/carolsol') {
    searchParams.set('resource', 'webhook')
    return '/api/whatsapp'
  }
  return pathname
}

function queryObject(searchParams) {
  const query = {}
  for (const [key, value] of searchParams.entries()) {
    if (Object.prototype.hasOwnProperty.call(query, key)) {
      query[key] = Array.isArray(query[key]) ? [...query[key], value] : [query[key], value]
    } else {
      query[key] = value
    }
  }
  return query
}

async function readBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined
  const contentType = String(req.headers['content-type'] || '').toLowerCase()
  if (contentType.includes('multipart/form-data')) return undefined
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > maxBodyBytes) {
      const error = new Error('Payload muito grande.')
      error.status = 413
      throw error
    }
    chunks.push(chunk)
  }
  if (!chunks.length) return undefined
  const raw = Buffer.concat(chunks).toString('utf8')
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(raw)
    } catch {
      return raw
    }
  }
  return raw
}

function decorateResponse(res) {
  res.status = (statusCode) => {
    res.statusCode = statusCode
    return res
  }
  res.json = (data) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(data))
  }
  return res
}

async function handleApi(req, res, url) {
  const searchParams = new URLSearchParams(url.searchParams)
  const pathname = applyVercelRewrite(url.pathname, searchParams)
  const loadModule = apiModules[pathname]
  if (!loadModule) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: 'Rota de API nao encontrada.' }))
    return
  }

  req.query = queryObject(searchParams)
  req.body = await readBody(req)
  const module = await loadModule()
  await module.default(req, decorateResponse(res))
}

async function handleStatic(req, res, pathname) {
  const relative = normalize(pathname).replace(/^(\.\.(\\|\/|$))+/, '').replace(/^[/\\]+/, '')
  let file = join(staticRoot, relative || 'index.html')
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html')
  } catch {
    file = join(staticRoot, 'index.html')
  }
  const content = await readFile(file)
  const extension = extname(file)
  res.writeHead(200, {
    'Content-Type': mime[extension] || 'application/octet-stream',
    'Cache-Control': extension === '.html' ? 'no-cache' : 'public, max-age=3600',
  })
  res.end(content)
}

async function handleUploadAsset(req, res, pathname) {
  const relative = normalize(pathname.replace(/^\/uploads\/?/, ''))
    .replace(/^(\.\.(\\|\/|$))+/, '')
    .replace(/^[/\\]+/, '')
  if (!relative) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Arquivo nao encontrado.')
    return
  }
  const file = join(uploadsRoot, relative)
  const content = await readFile(file)
  const extension = extname(file)
  res.writeHead(200, {
    'Content-Type': mime[extension] || 'application/octet-stream',
    'Cache-Control': 'public, max-age=31536000, immutable',
  })
  res.end(content)
}

async function runInternalCronJob(job) {
  if (job.running) return
  job.running = true
  try {
    const response = await fetch(job.url(), {
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET || ''}` },
    })
    const text = await response.text()
    const preview = text.replace(/\s+/g, ' ').slice(0, 240)
    if (!response.ok) {
      console.warn(`[cron:${job.name}] status=${response.status} ${preview}`)
    } else {
      console.log(`[cron:${job.name}] status=${response.status} ${preview}`)
    }
  } catch (error) {
    console.warn(`[cron:${job.name}] failed`, error.message)
  } finally {
    job.running = false
  }
}

function startInternalCronScheduler() {
  if (!internalCronEnabled) return
  if (!process.env.CRON_SECRET) {
    console.warn('[cron] INTERNAL_CRON_ENABLED=true, mas CRON_SECRET nao esta configurado.')
    return
  }

  const baseUrl = `http://127.0.0.1:${port}`
  const truthy = (value) => ['1', 'true', 'yes', 'sim'].includes(String(value || '').toLowerCase())
  const whatsappConfigured = truthy(process.env.BAILEYS_ENABLED) &&
    Boolean(process.env.BAILEYS_API_URL && process.env.BAILEYS_API_KEY)
  const emailConfigured = Boolean(process.env.RESEND_API_KEY)
  const jobs = []
  if (whatsappConfigured || emailConfigured) {
    jobs.push({
      name: 'reminders',
      everyMs: 10 * 60 * 1000,
      url: () => `${baseUrl}/api/cron-reminders?execute=1`,
    })
  }
  if (whatsappConfigured) {
    jobs.push({
      name: 'billing-whatsapp',
      everyMs: 5 * 60 * 1000,
      url: () => `${baseUrl}/api/cron-billing-whatsapp?execute=1`,
    })
    jobs.push({
      name: 'whatsapp-keepalive',
      everyMs: 4 * 60 * 1000,
      url: () => `${baseUrl}/api/whatsapp-keepalive?force=1&secret=${encodeURIComponent(process.env.CRON_SECRET || '')}`,
    },
    )
  }
  jobs.push({
    name: 'renewals-dry-run',
    everyMs: 24 * 60 * 60 * 1000,
    url: () => `${baseUrl}/api/cron-renewals`,
  })

  for (const job of jobs) {
    job.running = false
    const timer = setInterval(() => runInternalCronJob(job), job.everyMs)
    timer.unref?.()
  }
  setTimeout(() => {
    for (const job of jobs) runInternalCronJob(job)
  }, 15_000).unref?.()
  console.log('[cron] Scheduler interno ativado.')
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    const pathname = decodeURIComponent(url.pathname)
    if (pathname === '/sw.js') {
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate')
    }
    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, url)
      return
    }
    if (pathname.startsWith('/uploads/')) {
      await handleUploadAsset(req, res, pathname)
      return
    }
    await handleStatic(req, res, pathname)
  } catch (error) {
    const status = error.status || 500
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({
      error: status >= 500
        ? 'Nao foi possivel concluir a operacao.'
        : error.message,
    }))
    if (status >= 500) console.error('Server error', error)
  }
})

server.listen(port, host, () => {
  console.log(`Carol Sol disponivel em http://${host}:${port}`)
  startInternalCronScheduler()
})
