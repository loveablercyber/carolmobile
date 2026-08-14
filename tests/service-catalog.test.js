import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  catalogSnapshot,
  totalCatalogDuration,
  totalCatalogPrice,
  variantDepositAmount,
} from "../server/lib/service-catalog.js";

test("variantDepositAmount supports fixed, percentage and deferred material cost", () => {
  assert.equal(variantDepositAmount({ deposit_type: "fixed", deposit_value: 50 }, 40), 40);
  assert.equal(variantDepositAmount({ deposit_type: "percentage", deposit_value: 50 }, 1035), 517.5);
  assert.equal(variantDepositAmount({ deposit_type: "full", deposit_value: 0 }, 440), 440);
  assert.equal(variantDepositAmount({ deposit_type: "material_cost", deposit_value: 0 }, 440), 0);
});

test("catalog totals include selected addons without mutating the variant", () => {
  const variant = { price: 690, duration_minutes: 600 };
  const addons = [{ price: 50, duration_minutes: 60 }];
  assert.equal(totalCatalogPrice(variant, addons), 740);
  assert.equal(totalCatalogDuration(variant, addons), 660);
  assert.equal(variant.price, 690);
});

test("catalog snapshot preserves the booked commercial values", () => {
  const snapshot = catalogSnapshot({
    service: { id: "service", catalog_code: "combo-micro", name: "Micro" },
    variant: {
      id: "variant", code: "combo-micro-75-150", label: "75/80 cm — 150 g",
      price: 1035, duration_minutes: 600, material_mode: "included",
      deposit_type: "percentage", deposit_value: 50, deposit_non_refundable: true,
      requires_assessment: true, requires_human_confirmation: true,
    },
    addons: [], total: 1035, deposit: 517.5,
  });
  assert.equal(snapshot.variant.code, "combo-micro-75-150");
  assert.equal(snapshot.total, 1035);
  assert.equal(snapshot.deposit, 517.5);
  assert.equal(snapshot.variant.depositNonRefundable, true);
});

test("2026 migration is idempotent and keeps commercial variants separate from inventory", async () => {
  const sql = await readFile(new URL("../database/neon-service-catalog-2026.sql", import.meta.url), "utf8");
  assert.match(sql, /create table if not exists public\.service_variants/i);
  assert.match(sql, /on conflict\(code\) do update/i);
  assert.match(sql, /combo-ponto-60-150[^\n]+410/i);
  assert.match(sql, /combo-micro-75-350[^\n]+2415/i);
  assert.doesNotMatch(sql, /insert into public\.hair_inventory/i);
});

test("2026 normalization preserves history and restores the official catalog links", async () => {
  const sql = await readFile(
    new URL("../database/neon-service-catalog-2026-normalization.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /service_catalog_normalization_backups/i);
  assert.match(sql, /where catalog_code is null/i);
  assert.match(sql, /where catalog_code is not null/i);
  assert.match(sql, /combo-ponto-[^']*'\s*,\s*'combo-ponto'/i);
  assert.match(sql, /update public\.service_variants/i);
  assert.doesNotMatch(sql, /delete\s+from\s+public\.services/i);
  assert.doesNotMatch(sql, /delete\s+from\s+public\.appointments/i);
  const rollback = await readFile(
    new URL("../database/neon-service-catalog-2026-normalization-rollback.sql", import.meta.url),
    "utf8",
  );
  assert.match(rollback, /service_catalog_normalization_backups/i);
  assert.doesNotMatch(rollback, /delete\s+from\s+public\.appointments/i);
});

test("WhatsApp only loads variants whose parent service is active", async () => {
  const source = await readFile(
    new URL("../server/lib/ai-whatsapp.js", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /from public\.service_variants v\s+join public\.services s on s\.id=v\.service_id\s+where v\.active and v\.allow_whatsapp_booking and s\.active/i,
  );
});

test("AI commercial base lists every active service without parallel AI activation", async () => {
  const source = await readFile(
    new URL("../server/lib/ai-whatsapp.js", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("export async function getAiCommercialBase");
  const end = source.indexOf("export async function getAiBase", start);
  const commercialBase = source.slice(start, end);
  assert.match(commercialBase, /from public\.services s\s+where s\.active=true/i);
  assert.match(commercialBase, /true as ai_active/i);
  assert.doesNotMatch(commercialBase, /join public\.ai_service_settings/i);
  assert.doesNotMatch(commercialBase, /catalog_code is (?:not )?null/i);
});

test("WhatsApp admin service list is read-only and delegates edits to admin services", async () => {
  const page = await readFile(
    new URL("../src/pages/WhatsAppIntegration.tsx", import.meta.url),
    "utf8",
  );
  const start = page.indexOf("function BaseKnowledgeTab");
  const end = page.indexOf("function serviceToForm", start);
  const section = page.slice(start, end);
  assert.match(section, /service\.active !== false/);
  assert.match(section, /Lista automática e somente leitura/);
  assert.match(section, /Gerenciar em Serviços/);
  assert.doesNotMatch(section, /service-settings/);
  assert.doesNotMatch(section, />Editar</);

  const api = await readFile(new URL("../api/ai-whatsapp.js", import.meta.url), "utf8");
  assert.doesNotMatch(api, /resource === "service-settings"/);
});
