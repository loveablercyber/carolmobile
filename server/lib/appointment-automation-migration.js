import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { query, transaction } from "./db.js";

const VERSION = "014_appointment_automation";
const DESCRIPTION = "Agendamentos idempotentes, notificações, lembretes e Google Calendar";

async function migrationSql() {
  return readFile(resolve("database/neon-appointment-automation.sql"), "utf8");
}

export async function appointmentAutomationMigrationStatus() {
  const { rows } = await query(
    `select
      exists(select 1 from information_schema.columns where table_schema='public' and table_name='appointments' and column_name='idempotency_key') as has_idempotency,
      exists(select 1 from information_schema.columns where table_schema='public' and table_name='appointments' and column_name='source') as has_source,
      exists(select 1 from information_schema.columns where table_schema='public' and table_name='notifications' and column_name='delivery_status') as has_delivery_status,
      exists(select 1 from public.business_settings where key='appointment_automation') as has_settings,
      exists(select 1 from public._luxe_migrations where version=$1) as recorded`,
    [VERSION],
  );
  return rows[0];
}

export async function applyAppointmentAutomationMigration() {
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
