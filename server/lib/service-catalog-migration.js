import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { query, transaction } from "./db.js";

const VERSION = "012_service_catalog_2026";
const DESCRIPTION = "Catálogo de serviços e variações Carol Sol 2026";

async function migrationSql() {
  const sql = await readFile(resolve("database/neon-service-catalog-2026.sql"), "utf8");
  return sql
    .replace(/^\s*begin;\s*/i, "")
    .replace(/\s*commit;\s*$/i, "");
}

export async function serviceCatalogMigrationStatus() {
  const { rows } = await query(
    `select
      exists(select 1 from information_schema.tables where table_schema='public' and table_name='service_variants') as has_variants,
      exists(select 1 from information_schema.tables where table_schema='public' and table_name='service_addons') as has_addons,
      exists(select 1 from information_schema.columns where table_schema='public' and table_name='appointments' and column_name='service_variant_id') as has_appointment_variant,
      exists(select 1 from public._luxe_migrations where version=$1) as recorded`,
    [VERSION]
  );
  const catalog = rows[0].has_variants
    ? await query("select count(*)::int as count from public.service_variants where metadata->>'catalog_year'='2026'")
    : { rows: [{ count: 0 }] };
  return { ...rows[0], catalog_variants: catalog.rows[0].count };
}

export async function applyServiceCatalogMigration() {
  const sql = await migrationSql();
  return transaction(async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [VERSION]);
    await client.query(`create table if not exists public._luxe_migrations (
      version text primary key,
      description text not null,
      applied_at timestamptz not null default now()
    )`);
    const recorded = await client.query(
      "select 1 from public._luxe_migrations where version=$1",
      [VERSION],
    );
    if (recorded.rowCount) return { applied: false, version: VERSION };
    await client.query(sql);
    await client.query(
      "insert into public._luxe_migrations(version,description) values($1,$2)",
      [VERSION, DESCRIPTION],
    );
    return { applied: true, version: VERSION };
  });
}
