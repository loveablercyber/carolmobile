import { query, transaction } from "../server/lib/db.js";
import { requireUser } from "../server/lib/auth.js";
import {
  appError,
  getBody,
  handleError,
  methodNotAllowed,
  send,
} from "../server/lib/http.js";
import {
  createSumupCheckout,
  mapSumupStatus,
  retrieveSumupCheckout,
  sumupConfig,
} from "../server/lib/sumup.js";

async function paymentFor(user, id) {
  if (!id) throw appError("Pagamento não informado.");
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      String(id),
    )
  )
    throw appError("Pagamento inválido.");
  const params = [id];
  let scope = "true";
  if (user.role === "client") {
    params.push(user.id);
    scope = "c.profile_id=$2";
  }
  const { rows } = await query(
    `select pay.*,cp.full_name as client,s.name as service,pl.name as plan
    from public.payments pay join public.clients c on c.id=pay.client_id join public.profiles cp on cp.id=c.profile_id
    left join public.appointments a on a.id=pay.appointment_id left join public.services s on s.id=a.service_id
    left join public.subscriptions sub on sub.id=pay.subscription_id left join public.plans pl on pl.id=sub.plan_id
    where pay.id=$1 and ${scope}`,
    params,
  );
  if (!rows[0]) throw appError("Pagamento não encontrado.", 404);
  return rows[0];
}

async function applyProviderStatus(
  paymentId,
  providerStatus,
  providerData,
  actorId = null,
) {
  const internalStatus = mapSumupStatus(providerStatus);
  return transaction(async (client) => {
    const locked = await client.query(
      "select * from public.payments where id=$1 for update",
      [paymentId],
    );
    const payment = locked.rows[0];
    if (!payment) throw appError("Pagamento não encontrado.", 404);
    if (payment.status === "paid" && internalStatus === "paid") return payment;
    await client.query(
      `update public.payments set status=$2,provider_status=$3,provider_transaction_id=coalesce($4,provider_transaction_id),failure_reason=$5,webhook_received_at=now(),paid_at=case when $2='paid' then coalesce(paid_at,now()) else paid_at end,paid_amount=case when $2='paid' then amount else paid_amount end,updated_at=now() where id=$1`,
      [
        paymentId,
        internalStatus,
        String(providerStatus || ""),
        providerData?.transaction_id || providerData?.transaction_code || null,
        providerData?.failure_reason || null,
      ],
    );
    await client.query(
      `insert into public.payment_status_history(payment_id,old_status,new_status,changed_by,notes) values($1,$2,$3,$4,$5)`,
      [
        paymentId,
        payment.status,
        internalStatus,
        actorId,
        `Status confirmado pela SumUp: ${providerStatus}`,
      ],
    );
    if (internalStatus === "paid") {
      if (payment.subscription_id) {
        await client.query(
          `update public.subscriptions set status='active',starts_at=coalesce(starts_at,current_date),activated_at=coalesce(activated_at,now()),updated_at=now() where id=$1`,
          [payment.subscription_id],
        );
        await client.query(
          `update public.quotes set status='converted',updated_at=now() where id=(select quote_id from public.subscriptions where id=$1)`,
          [payment.subscription_id],
        );
      }
      if (payment.appointment_id)
        await client.query(
          `update public.appointments set status='confirmed',updated_at=now() where id=$1 and status in ('awaiting_payment','pending_deposit')`,
          [payment.appointment_id],
        );
      if (payment.coupon_id)
        await client.query(
          `insert into public.coupon_usage(coupon_id,client_id,appointment_id,payment_id,quote_id,discount_amount,status) select $1,$2,$3,$4,$5,$6,'used' where not exists(select 1 from public.coupon_usage where coupon_id=$1 and payment_id=$4 and status='used')`,
          [
            payment.coupon_id,
            payment.client_id,
            payment.appointment_id,
            payment.id,
            payment.quote_id,
            payment.discount_amount || 0,
          ],
        );
    }
    const profile = await client.query(
      "select profile_id from public.clients where id=$1",
      [payment.client_id],
    );
    const data = JSON.stringify({
      payment_id: payment.id,
      status: internalStatus,
    });
    await client.query(
      `insert into public.notifications(profile_id,kind,title,body,data,action_url,metadata) values($1,$2,$3,$4,$5,$6,$5)`,
      [
        profile.rows[0].profile_id,
        internalStatus === "paid" ? "payment_confirmed" : "payment_status",
        internalStatus === "paid"
          ? "Pagamento confirmado"
          : "Pagamento atualizado",
        internalStatus === "paid"
          ? "Seu pagamento foi confirmado com segurança."
          : `O pagamento está ${internalStatus}.`,
        data,
        `/cliente/pagamentos/${payment.id}`,
      ],
    );
    return { ...payment, status: internalStatus };
  });
}

async function webhook(req, res, body) {
  const config = sumupConfig();
  if (config.webhookSecret) {
    const supplied = req.headers["x-webhook-secret"] || req.query?.secret;
    if (supplied !== config.webhookSecret)
      throw appError("Webhook não autorizado.", 401);
  }
  const checkoutId = body.id || body.checkout_id || body.checkoutId;
  const log = await query(
    `insert into public.payment_webhook_logs(provider,event_type,provider_checkout_id,payload) values('sumup',$1,$2,$3) returning id`,
    [
      body.event_type || body.type || "checkout.updated",
      checkoutId || null,
      JSON.stringify(body || {}),
    ],
  );
  try {
    if (!checkoutId) throw appError("Checkout não informado.");
    const checkout = await retrieveSumupCheckout(checkoutId);
    const payment = await query(
      "select id from public.payments where provider_checkout_id=$1 or checkout_reference=$2 limit 1",
      [checkoutId, checkout.checkout_reference || ""],
    );
    if (!payment.rows[0])
      throw appError("Pagamento correspondente não encontrado.", 404);
    await applyProviderStatus(payment.rows[0].id, checkout.status, checkout);
    await query(
      "update public.payment_webhook_logs set processed=true,processed_at=now() where id=$1",
      [log.rows[0].id],
    );
    return send(res, 200, { ok: true });
  } catch (error) {
    await query(
      "update public.payment_webhook_logs set processing_error=$2,processed_at=now() where id=$1",
      [log.rows[0].id, error.message],
    );
    throw error;
  }
}

export default async function handler(req, res) {
  try {
    const resource = req.query?.resource || "status";
    const body = getBody(req);
    if (resource === "sumup-webhook" && req.method === "POST")
      return await webhook(req, res, body);
    const user = await requireUser(req);
    if (req.method === "GET" && resource === "status")
      return send(res, 200, { payment: await paymentFor(user, req.query?.id) });
    if (req.method === "GET" && resource === "sumup-integration") {
      if (user.role !== "admin") throw appError("Acesso negado.", 403);
      const config = sumupConfig();
      const stats = await query(
        `select count(*) filter(where status='pending')::int as pending,count(*) filter(where status='failed')::int as failed,count(*) filter(where status='expired')::int as expired,coalesce(sum(amount) filter(where status='paid'),0) as paid_total,max(created_at) filter(where provider='sumup') as last_checkout from public.payments`,
      );
      const webhookInfo = await query(
        `select received_at,processing_error from public.payment_webhook_logs where provider='sumup' order by received_at desc limit 1`,
      );
      return send(res, 200, {
        enabled: config.enabled,
        configured: Boolean(config.apiKey && config.merchantCode),
        environment: config.environment,
        merchantCode: config.merchantCode
          ? `••••${config.merchantCode.slice(-4)}`
          : null,
        stats: stats.rows[0],
        lastWebhook: webhookInfo.rows[0] || null,
      });
    }
    if (req.method === "POST" && resource === "create-sumup-checkout") {
      const payment = await paymentFor(user, body.paymentId);
      if (
        !["pending", "failed", "expired", "awaiting_confirmation"].includes(
          payment.status,
        )
      )
        throw appError("Este pagamento não pode gerar um novo checkout.");
      const reference = `CAROLSOL-${String(payment.id).slice(0, 8).toUpperCase()}-${Date.now()}`;
      const returnUrl = `${sumupConfig().returnUrl}${sumupConfig().returnUrl.includes("?") ? "&" : "?"}payment_id=${encodeURIComponent(payment.id)}`;
      const checkout = await createSumupCheckout({
        reference,
        amount: payment.amount,
        description: payment.service || payment.plan || "Pagamento Carol Sol",
        returnUrl,
      });
      await query(
        `update public.payments set provider='sumup',method='card',payment_method='card',provider_checkout_id=$2,checkout_reference=$3,hosted_checkout_url=$4,provider_status=$5,status='awaiting_confirmation',updated_at=now() where id=$1`,
        [
          payment.id,
          checkout.id,
          reference,
          checkout.hostedUrl,
          checkout.status || "PENDING",
        ],
      );
      if (!checkout.hostedUrl)
        throw appError(
          "A SumUp criou o checkout, mas não retornou uma URL de pagamento. Verifique a modalidade Hosted Checkout.",
          502,
        );
      return send(res, 201, { url: checkout.hostedUrl, paymentId: payment.id });
    }
    if (req.method === "POST" && resource === "payment-method") {
      const payment = await paymentFor(user, body.paymentId);
      if (!["pix_manual", "local"].includes(body.provider))
        throw appError("Método inválido.");
      const method = body.provider === "local" ? "local" : "pix";
      await query(
        `update public.payments set provider=$2,method=$3,payment_method=$3,status='pending',updated_at=now() where id=$1`,
        [payment.id, body.provider, method],
      );
      return send(res, 200, { ok: true });
    }
    if (req.method === "POST" && resource === "receipt") {
      const payment = await paymentFor(user, body.paymentId);
      if (!body.url) throw appError("Comprovante não informado.");
      await transaction(async (client) => {
        await client.query(
          `insert into public.payment_receipts(payment_id,uploaded_by,storage_url) values($1,$2,$3)`,
          [payment.id, user.id, body.url],
        );
        await client.query(
          `update public.payments set receipt_url=$2,status='under_review',updated_at=now() where id=$1`,
          [payment.id, body.url],
        );
        await client.query(
          `insert into public.payment_status_history(payment_id,old_status,new_status,changed_by,notes) values($1,$2,'under_review',$3,'Comprovante enviado')`,
          [payment.id, payment.status, user.id],
        );
      });
      return send(res, 201, { ok: true });
    }
    if (req.method === "POST" && resource === "sync") {
      if (user.role !== "admin") throw appError("Acesso negado.", 403);
      const payment = await paymentFor(user, body.paymentId);
      if (!payment.provider_checkout_id)
        throw appError("Pagamento sem checkout SumUp.");
      const checkout = await retrieveSumupCheckout(
        payment.provider_checkout_id,
      );
      await applyProviderStatus(payment.id, checkout.status, checkout, user.id);
      return send(res, 200, {
        ok: true,
        status: mapSumupStatus(checkout.status),
      });
    }
    return methodNotAllowed(res, ["GET", "POST"]);
  } catch (error) {
    return handleError(res, error);
  }
}
