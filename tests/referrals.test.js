import test from "node:test";
import assert from "node:assert/strict";

import { processReferralCode } from "../api/auth.js";
import { processReferralReward } from "../api/data.js";

const ids = {
  client: "11111111-1111-4111-8111-111111111111",
  referrer: "22222222-2222-4222-8222-222222222222",
  referral: "33333333-3333-4333-8333-333333333333",
  user: "44444444-4444-4444-8444-444444444444",
  appointment: "55555555-5555-4555-8555-555555555555",
  reward: "66666666-6666-4666-8666-666666666666",
};

function mockClient(handler) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const normalized = String(sql).replace(/\s+/g, " ").trim();
      calls.push({ sql: normalized, params });
      return handler(normalized, params, calls.length - 1);
    },
  };
}

test("links an existing invitation and writes its audit log", async () => {
  const client = mockClient((sql) => {
    if (sql.startsWith("select id,referrer_client_id from public.referrals"))
      return { rows: [{ id: ids.referral, referrer_client_id: ids.referrer }], rowCount: 1 };
    if (sql.startsWith("update public.referrals"))
      return { rows: [{ id: ids.referral, referrer_client_id: ids.referrer }], rowCount: 1 };
    if (sql.startsWith("insert into public.audit_logs"))
      return { rows: [], rowCount: 1 };
    throw new Error(`Unexpected query: ${sql}`);
  });

  const result = await processReferralCode(client, {
    refCode: " carol8c7d8a12-a1b2c3 ",
    newClientId: ids.client,
    fullName: "Cliente Indicada",
    phone: null,
    userId: ids.user,
  });

  assert.equal(result.id, ids.referral);
  assert.match(client.calls[0].sql, /for update$/i);
  assert.equal(client.calls[0].params[0], "CAROL8C7D8A12-A1B2C3");
  assert.match(client.calls[1].sql, /status='registered'/);
  assert.match(client.calls[2].sql, /referral_registered/);
  assert.match(client.calls[2].params[2], /referrer_client_id/);
});

test("resolves a generic referral code and creates a unique invitation", async () => {
  const client = mockClient((sql) => {
    if (sql.startsWith("select id,referrer_client_id from public.referrals"))
      return { rows: [], rowCount: 0 };
    if (sql.startsWith("select c.id from public.clients"))
      return { rows: [{ id: ids.referrer }], rowCount: 1 };
    if (sql.startsWith("insert into public.referrals"))
      return { rows: [{ id: ids.referral, referrer_client_id: ids.referrer }], rowCount: 1 };
    if (sql.startsWith("insert into public.audit_logs"))
      return { rows: [], rowCount: 1 };
    throw new Error(`Unexpected query: ${sql}`);
  });

  await processReferralCode(client, {
    refCode: "carol8c7d8a12",
    newClientId: ids.client,
    fullName: "Cliente Indicada",
    phone: "11999999999",
    userId: ids.user,
  });

  assert.equal(client.calls[1].params[0], "8C7D8A12%");
  assert.match(client.calls[2].params[2], /^CAROL8C7D8A12-[0-9A-F]{6}$/);
  assert.equal(client.calls[2].params[0], ids.referrer);
  assert.match(client.calls[3].sql, /referral_registered/);
});

test("grants discount, points and notification on the first completed appointment", async () => {
  const client = mockClient((sql) => {
    if (sql.startsWith("select id,referrer_client_id from public.referrals"))
      return { rows: [{ id: ids.referral, referrer_client_id: ids.referrer }], rowCount: 1 };
    if (sql.startsWith("select count(*)::int as count"))
      return { rows: [{ count: 0 }], rowCount: 1 };
    if (sql.startsWith("update public.referrals"))
      return { rows: [{ id: ids.referral }], rowCount: 1 };
    if (sql.startsWith("insert into public.referral_rewards"))
      return { rows: [{ id: ids.reward }], rowCount: 1 };
    if (sql.startsWith("insert into public.loyalty_points"))
      return { rows: [], rowCount: 1 };
    if (sql.startsWith("insert into public.notifications"))
      return { rows: [], rowCount: 1 };
    throw new Error(`Unexpected query: ${sql}`);
  });

  const result = await processReferralReward(
    client,
    ids.client,
    ids.appointment,
  );

  assert.deepEqual(result, { referralId: ids.referral, rewardId: ids.reward });
  assert.match(client.calls[0].sql, /status='registered'.*for update/i);
  assert.match(client.calls[2].sql, /reward_amount=50\.00/);
  assert.match(client.calls[3].sql, /'discount',50\.00,'active'/);
  assert.equal(client.calls[4].params[0], ids.referrer);
  assert.match(client.calls[4].sql, /values\(\$1,100/);
  assert.match(client.calls[5].sql, /referral_completed/);
});

test("does not grant another reward after a previous completed appointment", async () => {
  const client = mockClient((sql) => {
    if (sql.startsWith("select id,referrer_client_id from public.referrals"))
      return { rows: [{ id: ids.referral, referrer_client_id: ids.referrer }], rowCount: 1 };
    if (sql.startsWith("select count(*)::int as count"))
      return { rows: [{ count: 1 }], rowCount: 1 };
    throw new Error(`Unexpected query: ${sql}`);
  });

  const result = await processReferralReward(
    client,
    ids.client,
    ids.appointment,
  );

  assert.equal(result, null);
  assert.equal(client.calls.length, 2);
  assert.equal(
    client.calls.some((call) => call.sql.includes("referral_rewards")),
    false,
  );
  assert.equal(
    client.calls.some((call) => call.sql.includes("loyalty_points")),
    false,
  );
});
