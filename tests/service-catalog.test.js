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
