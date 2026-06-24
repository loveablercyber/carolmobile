import { query, transaction } from "./db.js";
import {
  createSumupCheckout,
  mapSumupStatus,
  processSumupCheckout,
  retrieveSumupCheckout,
} from "./sumup.js";
import {
  nextRetryAt,
  recurringConfig,
  renewalEligibility,
  renewalPeriod,
} from "./recurring-rules.js";

const MAX_ATTEMPTS = 3;

async function reserveAttempt(subscriptionId) {
  return transaction(async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [
      `subscription-renewal:${subscriptionId}`,
    ]);
    const selected = await client.query(
      `select s.id,s.client_id,s.status,s.renews_at,s.auto_renew,s.recurring_consent_at,
       s.renewal_failures,s.next_retry_at,p.name as plan_name,p.price as amount,
       sc.id as card_id,sc.external_token,coalesce(sc.provider_customer_id,c.sumup_customer_id) as provider_customer_id
       from public.subscriptions s join public.plans p on p.id=s.plan_id
       join public.clients c on c.id=s.client_id
       left join public.saved_cards sc on sc.id=s.recurring_card_id and sc.client_id=s.client_id
         and sc.active and sc.provider='sumup' and sc.external_token is not null
       where s.id=$1 for update of s`,
      [subscriptionId],
    );
    const subscription = selected.rows[0];
    if (!subscription) return { skipped: "Assinatura não encontrada." };
    const error = renewalEligibility(subscription);
    if (error) return { skipped: error };
    const period = renewalPeriod(subscription.renews_at);
    const existing = await client.query(
      `select a.*,pay.status as payment_status from public.subscription_renewal_attempts a
       left join public.payments pay on pay.id=a.payment_id
       where a.subscription_id=$1 and a.billing_period=$2 order by a.attempt_number desc for update of a`,
      [subscriptionId, period],
    );
    const paid = existing.rows.find((item) => item.status === "paid");
    if (paid) return { skipped: "Competência já paga.", attempt: paid };
    const processing = existing.rows.find((item) =>
      ["reserved", "processing"].includes(item.status),
    );
    if (processing) return { attempt: processing, subscription, reconcile: true };
    const attemptNumber = existing.rows.length + 1;
    if (attemptNumber > MAX_ATTEMPTS)
      return { skipped: "Limite de retentativas atingido." };
    const idempotencyKey = `renewal:${subscription.id}:${period}:${attemptNumber}`;
    const attempt = await client.query(
      `insert into public.subscription_renewal_attempts
       (subscription_id,client_id,card_id,billing_period,attempt_number,idempotency_key,amount)
       values($1,$2,$3,$4,$5,$6,$7) returning *`,
      [
        subscription.id,
        subscription.client_id,
        subscription.card_id,
        period,
        attemptNumber,
        idempotencyKey,
        subscription.amount,
      ],
    );
    const payment = await client.query(
      `insert into public.payments
       (client_id,subscription_id,renewal_attempt_id,amount,original_amount,discount_amount,method,payment_method,provider,status)
       values($1,$2,$3,$4,$4,0,'card','card','sumup','processing') returning id`,
      [
        subscription.client_id,
        subscription.id,
        attempt.rows[0].id,
        subscription.amount,
      ],
    );
    await client.query(
      "update public.subscription_renewal_attempts set payment_id=$2 where id=$1",
      [attempt.rows[0].id, payment.rows[0].id],
    );
    return {
      attempt: { ...attempt.rows[0], payment_id: payment.rows[0].id },
      subscription,
      reconcile: false,
    };
  });
}

async function recordFailure(attemptId, error) {
  const reason = String(error?.message || "Falha ao processar renovação").slice(0, 500);
  return transaction(async (client) => {
    const locked = await client.query(
      `select a.*,s.renewal_failures from public.subscription_renewal_attempts a
       join public.subscriptions s on s.id=a.subscription_id where a.id=$1 for update of a,s`,
      [attemptId],
    );
    const attempt = locked.rows[0];
    if (!attempt || attempt.status === "paid") return;
    const failures = Math.min(Number(attempt.renewal_failures || 0) + 1, MAX_ATTEMPTS);
    await client.query(
      `update public.subscription_renewal_attempts set status='failed',failure_reason=$2,processed_at=now(),updated_at=now() where id=$1`,
      [attempt.id, reason],
    );
    await client.query(
      `update public.payments set status='failed',failure_reason=$2,updated_at=now() where id=$1 and status<>'paid'`,
      [attempt.payment_id, reason],
    );
    await client.query(
      `update public.subscriptions set renewal_failures=$2,next_retry_at=$3,
       status=case when $2>=3 then 'delinquent' else status end,updated_at=now() where id=$1`,
      [attempt.subscription_id, failures, nextRetryAt(failures)],
    );
  });
}

export async function applyRecurringCheckout(paymentId, checkout) {
  const internalStatus = mapSumupStatus(checkout?.status);
  if (!["paid", "failed", "expired", "cancelled", "pending", "processing"].includes(internalStatus))
    return { status: internalStatus, changed: false };
  return transaction(async (client) => {
    const locked = await client.query(
      `select pay.id as payment_id,pay.status as payment_status,pay.subscription_id,
       a.id as attempt_id,a.status as attempt_status,a.billing_period,a.attempt_number
       from public.payments pay join public.subscription_renewal_attempts a on a.id=pay.renewal_attempt_id
       where pay.id=$1 for update of pay,a`,
      [paymentId],
    );
    const item = locked.rows[0];
    if (!item) throw Object.assign(new Error("Tentativa recorrente não encontrada."), { status: 404 });
    if (item.attempt_status === "paid") return { status: "paid", changed: false };
    const providerTransaction = checkout?.transaction_id || checkout?.transaction_code || null;
    if (internalStatus === "paid") {
      await client.query(
        `update public.payments set status='paid',provider_status=$2,provider_transaction_id=coalesce($3,provider_transaction_id),
         paid_at=coalesce(paid_at,now()),paid_amount=amount,failure_reason=null,updated_at=now() where id=$1`,
        [paymentId, String(checkout.status || ""), providerTransaction],
      );
      await client.query(
        `update public.subscription_renewal_attempts set status='paid',provider_status=$2,
         provider_transaction_id=coalesce($3,provider_transaction_id),failure_reason=null,processed_at=now(),updated_at=now() where id=$1`,
        [item.attempt_id, String(checkout.status || ""), providerTransaction],
      );
      const renewed = await client.query(
        `update public.subscriptions s set status='active',last_renewal_at=now(),renewal_failures=0,next_retry_at=null,
         renews_at=(greatest(current_date,$2::date)+interval '1 month')::date,
         expires_at=(greatest(current_date,$2::date)+interval '1 month')::date,
         remaining_maintenances=(select case when p.name='Essencial' then 1 when p.name='Completo' then 2 when p.name='VIP' then 3 else 4 end from public.plans p where p.id=s.plan_id),
         updated_at=now() where s.id=$1 returning client_id,renews_at`,
        [item.subscription_id, item.billing_period],
      );
      const profile = await client.query("select profile_id from public.clients where id=$1", [renewed.rows[0].client_id]);
      await client.query(
        `insert into public.notifications(profile_id,kind,title,body,data,action_url,metadata,notification_key)
         values($1,'subscription_renewed','Plano renovado','Sua renovação automática foi confirmada.',$2,'/cliente/beneficios',$2,$3)
         on conflict(notification_key) do nothing`,
        [
          profile.rows[0].profile_id,
          JSON.stringify({ subscription_id: item.subscription_id, payment_id: paymentId }),
          `subscription:${item.subscription_id}:renewal:${item.billing_period}`,
        ],
      );
      return { status: "paid", changed: true };
    }
    if (["failed", "expired", "cancelled"].includes(internalStatus)) {
      const failures = Math.min(item.attempt_number, MAX_ATTEMPTS);
      const reason = checkout?.failure_reason || `SumUp: ${checkout?.status || internalStatus}`;
      await client.query(
        `update public.payments set status='failed',provider_status=$2,failure_reason=$3,updated_at=now() where id=$1 and status<>'paid'`,
        [paymentId, String(checkout?.status || ""), reason],
      );
      await client.query(
        `update public.subscription_renewal_attempts set status='failed',provider_status=$2,failure_reason=$3,processed_at=now(),updated_at=now() where id=$1`,
        [item.attempt_id, String(checkout?.status || ""), reason],
      );
      await client.query(
        `update public.subscriptions set renewal_failures=$2,next_retry_at=$3,
         status=case when $2>=3 then 'delinquent' else status end,updated_at=now() where id=$1`,
        [item.subscription_id, failures, nextRetryAt(failures)],
      );
      return { status: "failed", changed: true };
    }
    await client.query(
      `update public.payments set status='processing',provider_status=$2,updated_at=now() where id=$1 and status<>'paid'`,
      [paymentId, String(checkout?.status || "")],
    );
    await client.query(
      `update public.subscription_renewal_attempts set status='processing',provider_status=$2,updated_at=now() where id=$1`,
      [item.attempt_id, String(checkout?.status || "")],
    );
    return { status: "processing", changed: item.attempt_status !== "processing" };
  });
}

async function processSubscription(subscriptionId) {
  const reserved = await reserveAttempt(subscriptionId);
  if (!reserved.attempt || reserved.skipped) return reserved;
  const { attempt, subscription } = reserved;
  try {
    if (attempt.provider_checkout_id) {
      const checkout = await retrieveSumupCheckout(attempt.provider_checkout_id);
      return { attemptId: attempt.id, ...(await applyRecurringCheckout(attempt.payment_id, checkout)) };
    }
    const reference = `RENEW-${String(attempt.id).slice(0, 8).toUpperCase()}-${attempt.attempt_number}`;
    const checkout = await createSumupCheckout({
      reference,
      amount: attempt.amount,
      description: `Renovação ${subscription.plan_name}`,
      customerId: subscription.provider_customer_id,
      useDefaultReturnUrl: false,
    });
    if (!checkout.id) throw new Error("A SumUp não retornou o checkout recorrente.");
    await transaction(async (client) => {
      await client.query(
        `update public.subscription_renewal_attempts set status='processing',provider_checkout_id=$2,provider_status=$3,updated_at=now() where id=$1`,
        [attempt.id, checkout.id, checkout.status || "PENDING"],
      );
      await client.query(
        `update public.payments set provider_checkout_id=$2,checkout_reference=$3,provider_status=$4,status='processing',updated_at=now() where id=$1`,
        [attempt.payment_id, checkout.id, reference, checkout.status || "PENDING"],
      );
    });
    const processed = await processSumupCheckout({
      checkoutId: checkout.id,
      token: subscription.external_token,
      customerId: subscription.provider_customer_id,
    });
    return { attemptId: attempt.id, ...(await applyRecurringCheckout(attempt.payment_id, processed)) };
  } catch (error) {
    await recordFailure(attempt.id, error);
    console.error("Recurring charge failed", {
      subscriptionId,
      attemptId: attempt.id,
      message: error.message,
      providerStatus: error.providerStatus || null,
    });
    return { attemptId: attempt.id, status: "failed", error: error.message };
  }
}

export async function recurringPreview(limit = 10) {
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 25);
  const { rows } = await query(
    `select s.id as subscription_id,s.renews_at,s.status,p.name as plan_name,p.price as amount,
     pr.full_name,sc.last_four,s.renewal_failures,s.next_retry_at
     from public.subscriptions s join public.plans p on p.id=s.plan_id
     join public.clients c on c.id=s.client_id join public.profiles pr on pr.id=c.profile_id
     left join public.saved_cards sc on sc.id=s.recurring_card_id
     where s.auto_renew and s.recurring_consent_at is not null and s.renews_at<=current_date
       and s.status in ('active','delinquent') and s.renewal_failures<3
       and (s.next_retry_at is null or s.next_retry_at<=now())
     order by s.renews_at,s.created_at limit $1`,
    [safeLimit],
  );
  return rows;
}

export async function runRecurringRenewals({ limit = 5, execute = false } = {}) {
  const config = recurringConfig();
  const candidates = await recurringPreview(limit);
  if (!execute)
    return {
      dryRun: true,
      config: {
        ...config,
        chargeAllowed: false,
        reason: "Execução de cobrança requer confirmação manual explícita.",
      },
      candidates,
      processed: [],
    };
  if (!config.chargeAllowed)
    return { dryRun: true, config, candidates, processed: [] };
  const processed = [];
  for (const candidate of candidates)
    processed.push(await processSubscription(candidate.subscription_id));
  return { dryRun: false, config, candidates: candidates.length, processed };
}
