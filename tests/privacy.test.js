import test from "node:test";
import assert from "node:assert/strict";

import {
  anonymizeClientAccount,
  collectClientDataExport,
} from "../api/portal.js";

const ids = {
  profile: "11111111-1111-4111-8111-111111111111",
  client: "22222222-2222-4222-8222-222222222222",
  request: "33333333-3333-4333-8333-333333333333",
  admin: "44444444-4444-4444-8444-444444444444",
};

function mockClient(handler) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const normalized = String(sql).replace(/\s+/g, " ").trim();
      calls.push({ sql: normalized, params });
      return handler(normalized, params);
    },
  };
}

test("builds a broad client export without authentication secrets", async () => {
  const client = mockClient((sql) => {
    if (sql.startsWith("select p.id,p.role"))
      return {
        rows: [
          {
            id: ids.profile,
            client_id: ids.client,
            full_name: "Cliente",
            email: "cliente@example.test",
          },
        ],
      };
    if (sql.includes("from public.appointments where client_id"))
      return { rows: [{ id: "appointment" }] };
    if (sql.includes("from public.loyalty_points"))
      return { rows: [{ points: 100, reason: "Teste" }] };
    return { rows: [] };
  });

  const exported = await collectClientDataExport(client, {
    profileId: ids.profile,
    clientId: ids.client,
  });

  assert.equal(exported.account.email, "cliente@example.test");
  assert.equal(exported.appointments.length, 1);
  assert.equal(exported.loyaltyPoints[0].points, 100);
  assert.ok(Array.isArray(exported.technicalRecords));
  assert.ok(Array.isArray(exported.privacyConsents));
  assert.equal(
    client.calls.some((call) => /encrypted_password|external_token/.test(call.sql)),
    false,
  );
});

test("anonymizes PII while preserving financial relational records", async () => {
  const client = mockClient((sql) => {
    if (sql.startsWith("select dr.id,dr.profile_id"))
      return {
        rows: [
          {
            id: ids.request,
            profile_id: ids.profile,
            client_id: ids.client,
          },
        ],
        rowCount: 1,
      };
    if (sql.startsWith("select storage_path"))
      return { rows: [{ storage_path: "https://cdn.example/photo.jpg" }] };
    if (sql.startsWith("select before_photo_path"))
      return {
        rows: [
          {
            before_photo_path: "https://cdn.example/before.jpg",
            after_photo_path: "https://cdn.example/after.jpg",
          },
        ],
      };
    if (sql.includes("set status='completed'"))
      return {
        rows: [{ id: ids.request, status: "completed" }],
        rowCount: 1,
      };
    return { rows: [], rowCount: 1 };
  });

  const result = await anonymizeClientAccount(client, {
    requestId: ids.request,
    adminId: ids.admin,
  });

  assert.equal(result.request.status, "completed");
  assert.equal(result.mediaUrls.length, 3);
  assert.ok(
    client.calls.some(
      (call) =>
        call.sql.startsWith("update auth.users") &&
        call.params[1].endsWith("@anonymized.invalid"),
    ),
  );
  assert.ok(
    client.calls.some((call) =>
      call.sql.includes("account_status='anonymized'"),
    ),
  );
  assert.ok(
    client.calls.some((call) => call.sql.includes("account_anonymized")),
  );
  assert.equal(
    client.calls.some((call) =>
      /delete from public\.(payments|subscriptions|appointments)/.test(call.sql),
    ),
    false,
  );
});

test("refuses to anonymize a request that is not pending review", async () => {
  const client = mockClient(() => ({ rows: [], rowCount: 0 }));
  await assert.rejects(
    anonymizeClientAccount(client, {
      requestId: ids.request,
      adminId: ids.admin,
    }),
    /não encontrada/,
  );
  assert.equal(client.calls.length, 1);
});
