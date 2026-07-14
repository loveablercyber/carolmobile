import pg from 'pg'

const { Pool } = pg

function shouldUseSsl(connectionString) {
  if (!connectionString) return false
  try {
    const url = new URL(connectionString)
    const sslMode = url.searchParams.get('sslmode')
    if (sslMode) return !['disable', 'allow', 'prefer'].includes(sslMode.toLowerCase())
    return /(neon\.tech|supabase\.(co|com)|amazonaws\.com|render\.com)$/i.test(url.hostname)
  } catch {
    return false
  }
}

const globalStore = globalThis
export const pool = globalStore.__carolSolPool || new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: shouldUseSsl(process.env.DATABASE_URL) ? { rejectUnauthorized: false } : undefined,
  max: 3,
  idleTimeoutMillis: 20_000,
  connectionTimeoutMillis: 10_000
})

if (process.env.NODE_ENV !== 'production') globalStore.__carolSolPool = pool

export async function query(text, params = []) {
  return pool.query(text, params)
}

export async function transaction(work) {
  const client = await pool.connect()
  try {
    await client.query('begin')
    const result = await work(client)
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}
