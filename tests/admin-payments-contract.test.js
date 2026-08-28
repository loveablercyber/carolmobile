import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const portalApi = await readFile(new URL("../api/portal.js", import.meta.url), "utf8");
const adminUi = await readFile(
  new URL("../src/pages/admin/AdminPortal.tsx", import.meta.url),
  "utf8",
);

test("admin payments expose edit, status, resend and removal operations", () => {
  assert.match(portalApi, /resource === "admin-payment-resend"/);
  assert.match(portalApi, /method === "DELETE"/);
  assert.match(portalApi, /archived_at=now\(\)/);
  assert.match(portalApi, /clean\(body\.action\) === "edit"/);
  assert.match(portalApi, /Novo link SumUp gerado para reenvio/);

  assert.match(adminUi, /title="Editar cobrança"/);
  assert.match(adminUi, /title="Alterar status"/);
  assert.match(adminUi, /title="Reenviar cobrança"/);
  assert.match(adminUi, /title="Remover cobrança"/);
});

test("payment removal preserves financial history instead of deleting rows", () => {
  const start = portalApi.indexOf("async function updateManualPayment");
  const end = portalApi.indexOf("async function logSumupCheckoutAttempt", start);
  const paymentMutation = portalApi.slice(start, end);
  assert.doesNotMatch(paymentMutation, /delete from public\.payments/i);
  assert.match(paymentMutation, /Cobrança removida da operação pelo administrador/);
  assert.match(paymentMutation, /previous_data,new_data/);
});
