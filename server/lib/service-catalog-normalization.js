import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { query, transaction } from "./db.js";

const VERSION = "013_service_catalog_2026_normalization";
const DESCRIPTION = "Normalização segura do catálogo 2026 e arquivamento do legado";

async function normalizationSql() {
  return readFile(resolve("database/neon-service-catalog-2026-normalization.sql"), "utf8");
}

export async function serviceCatalogNormalizationStatus() {
  const { rows } = await query(`select
    exists(select 1 from public._luxe_migrations where version=$1) as recorded,
    (select count(*)::int from public.services where catalog_code is not null) as catalog_services,
    (select count(*)::int from public.services where catalog_code is not null and active and coalesce(show_online_booking,true)) as catalog_services_available,
    (select count(*)::int from public.services where catalog_code is null) as legacy_services,
    (select count(*)::int from public.services where catalog_code is null and (active or coalesce(show_online_booking,true))) as legacy_services_available,
    (select count(*)::int from public.service_variants where metadata->>'catalog_year'='2026') as catalog_variants,
    (select count(*)::int from public.service_variants v join public.services s on s.id=v.service_id where v.metadata->>'catalog_year'='2026' and v.active and v.show_online_booking and v.allow_whatsapp_booking and s.active) as catalog_variants_available,
    (select count(*)::int from public.service_variants v left join public.services s on s.id=v.service_id where v.metadata->>'catalog_year'='2026' and (s.catalog_code is null or s.id is null)) as variants_linked_outside_catalog,
    (select count(*)::int from public.professionals p cross join public.services s left join public.professional_services ps on ps.professional_id=p.id and ps.service_id=s.id where p.active and s.active and s.catalog_code is not null and ps.service_id is null) as missing_professional_links,
    (select count(*)::int from public.appointments a join public.services s on s.id=a.service_id where s.catalog_code is null) as historical_appointments` , [VERSION]);
  return rows[0];
}

export async function applyServiceCatalogNormalization() {
  const sql = await normalizationSql();
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

