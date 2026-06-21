import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import pg from 'pg'

const { Client } = pg
const command = process.argv[2] || 'inspect'
const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  console.error('DATABASE_URL não informada.')
  process.exit(1)
}

const expectedTables = [
  'profiles','clients','professionals','admins','services','service_categories','hair_methods','appointments',
  'appointment_status_history','payments','plans','subscriptions','loyalty_points','coupons','campaigns','referrals',
  'client_photos','before_after_gallery','technical_records','hair_inventory','inventory_movements','products',
  'product_sales','commissions','professional_goals','notifications','whatsapp_templates','reviews','salon_locations',
  'chairs_or_rooms','blocked_schedule','waitlist','consent_logs','audit_logs'
]

const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } })

async function getPublicTables() {
  const { rows } = await client.query(`select tablename from pg_tables where schemaname = 'public' order by tablename`)
  return rows.map(row => row.tablename)
}

async function inspect() {
  const { rows: versionRows } = await client.query('select current_database() as database, current_user as user, version() as version')
  const tables = await getPublicTables()
  const missing = expectedTables.filter(table => !tables.includes(table))
  console.log(JSON.stringify({
    connected: true,
    database: versionRows[0].database,
    user: versionRows[0].user,
    engine: versionRows[0].version.split(',')[0],
    publicTableCount: tables.length,
    tables,
    missingExpectedTables: missing
  }, null, 2))
}

async function setup() {
  const bootstrap = await readFile(resolve('database/neon-bootstrap.sql'), 'utf8')
  const schema = await readFile(resolve('supabase/schema.sql'), 'utf8')
  const seed = await readFile(resolve('database/neon-seed.sql'), 'utf8')
  const brandMigration = await readFile(resolve('database/neon-brand-carol-sol.sql'), 'utf8')

  await client.query('begin')
  try {
    await client.query(bootstrap)
    const { rowCount: initialApplied } = await client.query("select 1 from public._luxe_migrations where version = '001_initial_schema'")
    if (!initialApplied) {
      const tables = await getPublicTables()
      if (tables.includes('profiles')) {
        const missing = expectedTables.filter(table => !tables.includes(table))
        if (missing.length) throw new Error(`Schema parcial encontrado. Tabelas ausentes: ${missing.join(', ')}`)
      } else {
        await client.query(schema)
      }
      await client.query("insert into public._luxe_migrations(version, description) values ('001_initial_schema', 'Schema relacional Carol Sol')")
    }

    const { rowCount: seedApplied } = await client.query("select 1 from public._luxe_migrations where version = '002_demo_seed'")
    if (!seedApplied) {
      await client.query(seed)
      await client.query("insert into public._luxe_migrations(version, description) values ('002_demo_seed', 'Dados demonstrativos Carol Sol')")
    }
    const { rowCount: brandApplied } = await client.query("select 1 from public._luxe_migrations where version = '003_brand_carol_sol'")
    if (!brandApplied) {
      await client.query(brandMigration)
      await client.query("insert into public._luxe_migrations(version, description) values ('003_brand_carol_sol', 'Atualização da marca para Carol Sol')")
    }
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  }

  const tables = await getPublicTables()
  const missing = expectedTables.filter(table => !tables.includes(table))
  const { rows: counts } = await client.query(`
    select
      (select count(*)::int from public.profiles) as profiles,
      (select count(*)::int from public.clients) as clients,
      (select count(*)::int from public.professionals) as professionals,
      (select count(*)::int from public.services) as services,
      (select count(*)::int from public.appointments) as appointments,
      (select count(*)::int from public.hair_inventory) as inventory_items
  `)
  const { rows: migrations } = await client.query('select version, description, applied_at from public._luxe_migrations order by version')
  console.log(JSON.stringify({ configured: missing.length === 0, publicTableCount: tables.length, missing, counts: counts[0], migrations }, null, 2))
}

try {
  await client.connect()
  if (command === 'setup') await setup()
  else await inspect()
} catch (error) {
  console.error(`Falha no Neon: ${error.message}`)
  process.exitCode = 1
} finally {
  await client.end().catch(() => {})
}
