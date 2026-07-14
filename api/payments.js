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
  createSumupCustomer,
  listSumupPaymentInstruments,
  mapSumupStatus,
  retrieveSumupCheckout,
  retrieveSumupCustomer,
  sumupConfig,
} from "../server/lib/sumup.js";
import {
  isConfiguredCloudinaryUrl,
  sendEmail,
  notifyAppointment,
} from "../server/lib/integrations.js";
import {
  receiptSubmissionError,
  resolveProviderTransition,
} from "../server/lib/payment-rules.js";
import {
  normalizeSumupInstrument,
  successfulCardSetupStatus,
  sumupCustomerReference,
} from "../server/lib/card-rules.js";
import {
  applyRecurringCheckout,
  recurringPreview,
} from "../server/lib/recurring-billing.js";
import { recurringConfig } from "../server/lib/recurring-rules.js";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validUuid(value, label) {
  const id = String(value || "").trim();
  if (!uuidPattern.test(id)) throw appError(`${label} inválido.`);
  return id;
}

async function cardClientFor(user) {
  if (user.role !== "client") throw appError("Acesso negado.", 403);
  const { rows } = await query(
    `select c.id,c.sumup_customer_id,p.full_name,p.phone,u.email
     from public.clients c join public.profiles p on p.id=c.profile_id
     join auth.users u on u.id=p.id where c.profile_id=$1`,
    [user.id],
  );
  if (!rows[0]) throw appError("Perfil de cliente não encontrado.", 404);
  return rows[0];
}

function customerDetails(item) {
  const parts = String(item.full_name || "Cliente").trim().split(/\s+/);
  return {
    first_name: parts.shift() || "Cliente",
    last_name: parts.join(" ") || "Carol Sol",
    email: item.email || undefined,
    phone: item.phone || undefined,
  };
}

async function startCardSetup(user) {
  const client = await cardClientFor(user);
  const customerId =
    client.sumup_customer_id || sumupCustomerReference(client.id);
  if (!customerId) throw appError("Não foi possível identificar a cliente.");
  const reusable = await query(
    `select id,checkout_id,expires_at from public.card_tokenization_sessions
     where client_id=$1 and status='pending' and expires_at>now()
     order by created_at desc limit 1`,
    [client.id],
  );
  if (reusable.rows[0])
    return {
      sessionId: reusable.rows[0].id,
      checkoutId: reusable.rows[0].checkout_id,
      expiresAt: reusable.rows[0].expires_at,
      reused: true,
    };
  if (!client.sumup_customer_id) {
    try {
      await createSumupCustomer({
        customerId,
        personalDetails: customerDetails(client),
      });
    } catch (error) {
      if (error.providerStatus !== 409) throw error;
      await retrieveSumupCustomer(customerId);
    }
    await query(
      "update public.clients set sumup_customer_id=$1 where id=$2 and sumup_customer_id is null",
      [customerId, client.id],
    );
  }
  const reference = `CARD-${String(client.id).slice(0, 8).toUpperCase()}-${Date.now()}`;
  const checkout = await createSumupCheckout({
    reference,
    amount: 0,
    description: "Tokenização segura de cartão Carol Sol",
    customerId,
    purpose: "SETUP_RECURRING_PAYMENT",
  });
  if (!checkout.id) throw appError("A SumUp não retornou o checkout.", 502);
  const { rows } = await query(
    `insert into public.card_tokenization_sessions(client_id,customer_id,checkout_id,checkout_reference)
     values($1,$2,$3,$4) returning id,checkout_id,expires_at`,
    [client.id, customerId, checkout.id, reference],
  );
  return {
    sessionId: rows[0].id,
    checkoutId: rows[0].checkout_id,
    expiresAt: rows[0].expires_at,
  };
}

async function completeCardSetup(user, body) {
  const client = await cardClientFor(user);
  const sessionId = validUuid(body.sessionId, "Sessão de tokenização");
  const found = await query(
    `select s.*,p.full_name from public.card_tokenization_sessions s
     join public.clients c on c.id=s.client_id join public.profiles p on p.id=c.profile_id
     where s.id=$1 and s.client_id=$2`,
    [sessionId, client.id],
  );
  const session = found.rows[0];
  if (!session) throw appError("Sessão de tokenização não encontrada.", 404);
  if (session.status === "completed" && session.card_id) {
    const existing = await query(
      `select id,brand,last_four,holder_name,active,is_default,created_at
       from public.saved_cards where id=$1 and client_id=$2`,
      [session.card_id, client.id],
    );
    if (existing.rows[0]) return existing.rows[0];
  }
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    await query(
      "update public.card_tokenization_sessions set status='expired',updated_at=now() where id=$1 and status='pending'",
      [session.id],
    );
    throw appError("A sessão de tokenização expirou. Inicie novamente.", 409);
  }
  const checkout = await retrieveSumupCheckout(session.checkout_id);
  if (
    checkout.customer_id !== session.customer_id ||
    checkout.purpose !== "SETUP_RECURRING_PAYMENT"
  )
    throw appError("A confirmação da SumUp não corresponde à sessão.", 409);
  const checkoutStatus = String(checkout.status || "").toUpperCase();
  const providerToken = String(checkout.payment_instrument?.token || "");
  if (!providerToken) {
    if (!successfulCardSetupStatus(checkoutStatus)) {
      if (
        ["FAILED", "DECLINED", "CANCELLED", "EXPIRED"].includes(
          checkoutStatus,
        )
      )
        await query(
          "update public.card_tokenization_sessions set status='failed',updated_at=now() where id=$1 and status='pending'",
          [session.id],
        );
      throw appError(
        "A tokenização ainda não foi confirmada pela SumUp.",
        409,
      );
    }
    throw appError("A SumUp confirmou o checkout sem retornar o instrumento.", 502);
  }
  if (
    !successfulCardSetupStatus(checkoutStatus) &&
    ["DECLINED", "CANCELLED", "EXPIRED"].includes(checkoutStatus)
  ) {
    if (session.status === "pending")
      await query(
        "update public.card_tokenization_sessions set status='failed',updated_at=now() where id=$1 and status='pending'",
        [session.id],
      );
    throw appError("A tokenização foi recusada pela SumUp.", 409);
  }
  const listed = await listSumupPaymentInstruments(session.customer_id);
  const instruments = Array.isArray(listed) ? listed : listed?.items || [];
  const instrument = normalizeSumupInstrument(
    instruments.find((item) => item?.token === providerToken),
  );
  if (!instrument)
    throw appError("O instrumento retornado pela SumUp não está ativo.", 409);

  return transaction(async (db) => {
    const locked = await db.query(
      "select * from public.card_tokenization_sessions where id=$1 and client_id=$2 for update",
      [session.id, client.id],
    );
    if (locked.rows[0]?.status === "completed" && locked.rows[0].card_id) {
      const existing = await db.query(
        `select id,brand,last_four,holder_name,active,is_default,created_at
         from public.saved_cards where id=$1 and client_id=$2`,
        [locked.rows[0].card_id, client.id],
      );
      return existing.rows[0];
    }
    if (!["pending", "failed"].includes(locked.rows[0]?.status))
      throw appError("Esta sessão não pode mais ser concluída.", 409);
    const tokenized = await db.query(
      "select * from public.saved_cards where provider='sumup' and external_token=$1 for update",
      [instrument.token],
    );
    if (tokenized.rows[0] && tokenized.rows[0].client_id !== client.id)
      throw appError("Instrumento de pagamento já vinculado a outra conta.", 409);
    await db.query(
      "update public.saved_cards set is_default=false,updated_at=now() where client_id=$1 and active",
      [client.id],
    );
    let card;
    if (tokenized.rows[0]) {
      const updated = await db.query(
        `update public.saved_cards set brand=$1,last_four=$2,holder_name=$3,provider_customer_id=$4,
         active=true,is_default=true,tokenized_at=coalesce(tokenized_at,now()),updated_at=now()
         where id=$5 returning id,brand,last_four,holder_name,active,is_default,created_at`,
        [
          instrument.brand,
          instrument.lastFour,
          session.full_name,
          session.customer_id,
          tokenized.rows[0].id,
        ],
      );
      card = updated.rows[0];
    } else {
      const inserted = await db.query(
        `insert into public.saved_cards(client_id,brand,last_four,holder_name,external_token,provider,
         provider_customer_id,active,is_default,tokenized_at,updated_at)
         values($1,$2,$3,$4,$5,'sumup',$6,true,true,now(),now())
         returning id,brand,last_four,holder_name,active,is_default,created_at`,
        [
          client.id,
          instrument.brand,
          instrument.lastFour,
          session.full_name,
          instrument.token,
          session.customer_id,
        ],
      );
      card = inserted.rows[0];
    }
    await db.query(
      `update public.card_tokenization_sessions set status='completed',card_id=$2,completed_at=now(),updated_at=now()
       where id=$1`,
      [session.id, card.id],
    );
    await db.query(
      `insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_data)
       values($1,'card_tokenized','saved_card',$2,$3)`,
      [
        user.id,
        card.id,
        JSON.stringify({
          provider: "sumup",
          brand: card.brand,
          lastFour: card.last_four,
        }),
      ],
    );
    return card;
  });
}

async function paymentFor(user, id) {
  if (!["client", "admin"].includes(user.role))
    throw appError("Você não tem permissão para acessar pagamentos.", 403);
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

async function syncPaymentFromProviderIfPending(user, payment) {
  if (
    payment.provider !== "sumup" ||
    !payment.provider_checkout_id ||
    !["pending", "processing", "awaiting_confirmation"].includes(payment.status)
  ) {
    return payment;
  }
  try {
    const checkout = await retrieveSumupCheckout(payment.provider_checkout_id);
    await applyProviderStatus(payment.id, checkout.status, checkout, user.id);
    return await paymentFor(user, payment.id);
  } catch (error) {
    console.error("Failed to sync SumUp status on payment return", {
      paymentId: payment.id,
      checkoutId: payment.provider_checkout_id,
      message: error.message,
    });
    return payment;
  }
}

async function applyProviderStatus(
  paymentId,
  providerStatus,
  providerData,
  actorId = null,
) {
  const recurring = await query(
    "select renewal_attempt_id from public.payments where id=$1",
    [paymentId],
  );
  if (recurring.rows[0]?.renewal_attempt_id)
    return applyRecurringCheckout(paymentId, {
      ...providerData,
      status: providerStatus,
    });
  const internalStatus = mapSumupStatus(providerStatus);
  const result = await transaction(async (client) => {
    const locked = await client.query(
      "select * from public.payments where id=$1 for update",
      [paymentId],
    );
    const payment = locked.rows[0];
    if (!payment) throw appError("Pagamento não encontrado.", 404);
    const transition = resolveProviderTransition(
      payment.status,
      internalStatus,
    );
    if (!transition.changed) {
      if (!transition.ignored)
        await client.query(
          `update public.payments set provider_status=$2,provider_transaction_id=coalesce($3,provider_transaction_id),failure_reason=$4,webhook_received_at=now(),updated_at=now() where id=$1`,
          [
            paymentId,
            String(providerStatus || ""),
            providerData?.transaction_id ||
              providerData?.transaction_code ||
              null,
            providerData?.failure_reason || null,
          ],
        );
      return { payment: { ...payment, status: transition.status }, contact: null };
    }
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
    let contactInfo = null;
    if (internalStatus === "paid") {
      if (payment.subscription_id) {
        const subscription = await client.query(
          `update public.subscriptions s set status='active',starts_at=coalesce(starts_at,current_date),activated_at=coalesce(activated_at,now()),renews_at=coalesce(renews_at,current_date+interval '1 month'),expires_at=coalesce(expires_at,current_date+interval '1 month'),remaining_maintenances=coalesce(nullif(remaining_maintenances,0),(select case when p.name='Essencial' then 1 when p.name='Completo' then 2 when p.name='VIP' then 3 else 4 end from public.plans p where p.id=s.plan_id)),updated_at=now() where s.id=$1 returning s.client_id,s.plan_id`,
          [payment.subscription_id],
        );
        await client.query(
          `update public.quotes set status='converted',updated_at=now() where id=(select quote_id from public.subscriptions where id=$1)`,
          [payment.subscription_id],
        );
        if (subscription.rows[0]) {
          const contact = await client.query(
            `select p.id,p.full_name,u.email,pl.name from public.clients c join public.profiles p on p.id=c.profile_id join auth.users u on u.id=p.id join public.plans pl on pl.id=$2 where c.id=$1`,
            [subscription.rows[0].client_id, subscription.rows[0].plan_id],
          );
          if (contact.rows[0]) {
            await client.query(
              `insert into public.notifications(profile_id,kind,title,body,data,action_url,metadata) values($1,'plan_activated','Plano ativado',$2,$3,'/cliente/beneficios',$3)`,
              [
                contact.rows[0].id,
                `Seu plano ${contact.rows[0].name} está ativo.`,
                JSON.stringify({ subscription_id: payment.subscription_id }),
              ],
            );
            contactInfo = contact.rows[0];
          }
        }
      }
      if (payment.appointment_id) {
        const appointmentResult = await client.query(
          `select a.status,a.starts_at,a.estimated_value,
                  s.name as service_name,
                  cp.id as client_profile_id,cp.full_name as client_name,cp.phone as client_phone,cu.email as client_email,
                  pp.id as professional_profile_id,pp.full_name as professional_name,pp.phone as professional_phone,pu.email as professional_email
             from public.appointments a
             join public.services s on s.id=a.service_id
             join public.clients c on c.id=a.client_id
             join public.profiles cp on cp.id=c.profile_id
             join auth.users cu on cu.id=cp.id
             join public.professionals pr on pr.id=a.professional_id
             join public.profiles pp on pp.id=pr.profile_id
             left join auth.users pu on pu.id=pp.id
            where a.id=$1`,
          [payment.appointment_id],
        );
        const app = appointmentResult.rows[0];
        const updatedApp = await client.query(
          `update public.appointments set status='confirmed',updated_at=now()
             where id=$1 and status in ('requested','awaiting_payment','pending_deposit') returning id`,
          [payment.appointment_id],
        );
        if (updatedApp.rowCount > 0 && app?.client_profile_id) {
          await client.query(
            `insert into public.appointment_status_history(appointment_id,from_status,to_status,changed_by,note)
             values($1,$2,'confirmed',$3,'Pagamento confirmado automaticamente pela SumUp')`,
            [payment.appointment_id, app.status || null, actorId],
          ).catch((error) =>
            console.error("Failed to write appointment confirmation history:", error.message),
          );
          const prettyDate = new Date(app.starts_at).toLocaleString("pt-BR", {
            timeZone: "America/Sao_Paulo",
            dateStyle: "short",
            timeStyle: "short",
          });
          const text = `Seu sinal foi recebido! Seu agendamento de ${app.service_name} com ${app.professional_name} para ${prettyDate} esta confirmado!`;
          const notificationData = JSON.stringify({
            appointment_id: payment.appointment_id,
            payment_id: payment.id,
          });
          const clientNotif = await client.query(
            `insert into public.notifications(profile_id,kind,title,body,data,action_url,metadata)
             values($1,'appointment_confirmed','Agendamento confirmado',$2,$3,$4,$3) returning id`,
            [
              app.client_profile_id,
              text,
              notificationData,
              `/cliente/agendamentos/${payment.appointment_id}`,
            ],
          );
          const professionalNotif = app.professional_profile_id ? await client.query(
            `insert into public.notifications(profile_id,kind,title,body,data,action_url,metadata)
             values($1,'appointment_confirmed','Agendamento confirmado por pagamento',$2,$3,'/profissional/agenda',$3) returning id`,
            [
              app.professional_profile_id,
              `Pagamento confirmado: ${app.client_name || "Cliente"} em ${prettyDate}.`,
              notificationData,
            ],
          ) : { rows: [] };
          await notifyAppointment({
            email: app.client_email,
            phone: app.client_phone,
            clientName: app.client_name,
            service: app.service_name,
            date: app.starts_at,
            professional: app.professional_name,
            professionalEmail: app.professional_email,
            professionalPhone: app.professional_phone,
            clientNotificationId: clientNotif.rows[0]?.id,
            professionalNotificationId: professionalNotif.rows[0]?.id,
            value: payment.amount || app.estimated_value || 0,
            notes: "Pagamento confirmado automaticamente pela SumUp.",
          }).catch(err =>
            console.error("Immediate confirm notification failed:", err.message),
          );
        }
      }
      /* Legacy appointment-confirmation notifier disabled after the provider-sync rewrite.
        const clientProfile = await client.query(
          "select profile_id from public.clients where id=$1",
          [payment.client_id],
        );
        const profileId = clientProfile.rows[0]?.profile_id;

        const appointmentResult = await client.query(
          `select a.starts_at, s.name as service_name, p.full_name as professional_name
           from public.appointments a
           join public.services s on s.id=a.service_id
           join public.professionals pr on pr.id=a.professional_id
           join public.profiles p on p.id=pr.profile_id
           where a.id=$1`,
          [payment.appointment_id]
        );
        const app = appointmentResult.rows[0];

        const updatedApp = await client.query(
          `update public.appointments set status='confirmed',updated_at=now() where id=$1 and status in ('awaiting_payment','pending_deposit') returning id`,
          [payment.appointment_id],
        );

        if (updatedApp.rowCount > 0 && app && profileId) {
          const prettyDate = new Date(app.starts_at).toLocaleString("pt-BR", {
            timeZone: "America/Sao_Paulo",
            dateStyle: "short",
            timeStyle: "short",
          });
          const text = `Seu sinal foi recebido! Seu agendamento de ${app.service_name} com ${app.professional_name} para ${prettyDate} está confirmado!`;

          const notif = await client.query(
            `insert into public.notifications(profile_id,kind,title,body,data,action_url,metadata)
             values($1,'appointment_confirmed','Agendamento Confirmado',$2,$3,$4,$3) returning id`,
            [
              profileId,
              text,
              JSON.stringify({ appointment_id: payment.appointment_id, payment_id: payment.id }),
              `/cliente/agendamentos/${payment.appointment_id}`
            ]
          );

          const clientProfileInfo = await client.query(
            `select u.email, p.phone, p.full_name from public.profiles p join auth.users u on u.id=p.id where p.id=$1`,
            [profileId]
          );
          if (clientProfileInfo.rows[0]) {
            await notifyAppointment({
              email: clientProfileInfo.rows[0].email,
              phone: clientProfileInfo.rows[0].phone,
              clientName: clientProfileInfo.rows[0].full_name,
              service: app.service_name,
              date: app.starts_at,
              professional: app.professional_name,
              clientNotificationId: notif.rows[0]?.id
            }).catch(err => console.error("Immediate confirm notification failed:", err.message));
          }
        }
      }
      */
      if (payment.coupon_id) {
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
    return { payment: { ...payment, status: internalStatus }, contact: contactInfo };
  });

  if (result.contact?.email) {
    await sendEmail({
      to: result.contact.email,
      subject: "Plano Carol Sol ativado",
      html: `<p>Olá, ${result.contact.full_name}. Seu plano foi ativado com sucesso.</p>`,
    }).catch((error) =>
      console.error("Falha ao enviar ativação:", error.message),
    );
  }
  return result.payment;
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

async function logSumupCheckoutAttempt({
  paymentId,
  eventType = "checkout.create",
  checkout = null,
  requestPayload = null,
  responsePayload = null,
  error = null,
}) {
  try {
    await query(
      `insert into public.payment_webhook_logs(provider,event_type,provider_checkout_id,payload,processing_error,processed,processed_at)
       values('sumup',$1,$2,$3,$4,true,now())`,
      [
        eventType,
        checkout?.id || responsePayload?.id || null,
        JSON.stringify({
          payment_id: paymentId || null,
          request: requestPayload || checkout?.requestPayload || error?.requestPayload || null,
          response: responsePayload || checkout?.rawResponse || checkout || error?.providerResponse || null,
          hosted_checkout_url: checkout?.hostedUrl || checkout?.hosted_checkout_url || null,
          transaction_id:
            checkout?.transaction_id ||
            checkout?.transaction_code ||
            responsePayload?.transaction_id ||
            responsePayload?.transaction_code ||
            null,
        }),
        error ? error.message : null,
      ],
    );
  } catch (logError) {
    console.error("Failed to log SumUp checkout attempt:", logError.message);
  }
}

export default async function handler(req, res) {
  try {
    const resource = req.query?.resource || "status";
    const body = getBody(req);
    if (resource === "sumup-webhook" && req.method === "POST")
      return await webhook(req, res, body);
    const user = await requireUser(req);
    if (req.method === "POST" && resource === "card-setup")
      return send(res, 201, await startCardSetup(user));
    if (req.method === "POST" && resource === "card-setup-complete")
      return send(res, 200, { card: await completeCardSetup(user, body) });
    if (req.method === "GET" && resource === "status") {
      const payment = await paymentFor(user, req.query?.id);
      return send(res, 200, {
        payment: await syncPaymentFromProviderIfPending(user, payment),
      });
    }
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
        recurring: recurringConfig(),
        merchantCode: config.merchantCode
          ? `••••${config.merchantCode.slice(-4)}`
          : null,
        stats: stats.rows[0],
        lastWebhook: webhookInfo.rows[0] || null,
      });
    }
    if (req.method === "GET" && resource === "recurring-preview") {
      if (user.role !== "admin") throw appError("Acesso negado.", 403);
      return send(res, 200, {
        config: recurringConfig(),
        candidates: await recurringPreview(req.query?.limit),
      });
    }
    if (req.method === "POST" && resource === "create-sumup-checkout") {
      if (user.role !== "client") throw appError("Acesso negado.", 403);
      const payment = await paymentFor(user, body.paymentId);
      if (
        !["pending", "failed", "expired", "awaiting_confirmation"].includes(
          payment.status,
        )
      )
        throw appError("Este pagamento não pode gerar um novo checkout.");
      if (
        payment.status === "awaiting_confirmation" &&
        payment.provider === "sumup" &&
        payment.provider_checkout_id &&
        payment.hosted_checkout_url
      )
        return send(res, 200, {
          url: payment.hosted_checkout_url,
          paymentId: payment.id,
          reused: true,
        });
      const reference = `CAROLSOL-${String(payment.id).slice(0, 8).toUpperCase()}-${Date.now()}`;
      const returnUrl = `${sumupConfig().returnUrl}${sumupConfig().returnUrl.includes("?") ? "&" : "?"}payment_id=${encodeURIComponent(payment.id)}`;
      let checkout;
      try {
        checkout = await createSumupCheckout({
          reference,
          amount: payment.amount,
          description: payment.service || payment.plan || "Pagamento Carol Sol",
          returnUrl,
          hostedCheckout: true,
        });
        await logSumupCheckoutAttempt({ paymentId: payment.id, checkout });
      } catch (error) {
        await logSumupCheckoutAttempt({ paymentId: payment.id, error });
        console.error("SumUp checkout creation failed", {
          paymentId: payment.id,
          message: error.message,
          providerStatus: error.providerStatus,
          providerCode: error.providerCode,
        });
        throw appError(
          "Não foi possível gerar o link de pagamento neste momento. A equipe foi notificada automaticamente. Tente novamente em alguns minutos.",
          502,
        );
      }
      if (!checkout.hostedUrl) {
        await logSumupCheckoutAttempt({
          paymentId: payment.id,
          eventType: "checkout.create.missing_url",
          checkout,
          error: new Error("SumUp response missing hosted checkout URL"),
        });
        throw appError(
          "Não foi possível gerar o link de pagamento neste momento. A equipe foi notificada automaticamente. Tente novamente em alguns minutos.",
          502,
        );
      }
      const persisted = await query(
        `update public.payments set provider='sumup',method='card',payment_method='card',provider_checkout_id=$2,checkout_reference=$3,hosted_checkout_url=$4,provider_status=$5,provider_transaction_id=coalesce($6,provider_transaction_id),failure_reason=null,status='awaiting_confirmation',updated_at=now() where id=$1 and status in ('pending','failed','expired','awaiting_confirmation') returning id`,
        [
          payment.id,
          checkout.id,
          reference,
          checkout.hostedUrl,
          checkout.status || "PENDING",
          checkout.transaction_id || checkout.transaction_code || null,
        ],
      );
      if (!persisted.rows[0])
        throw appError("O pagamento mudou de status durante o checkout.", 409);
      return send(res, 201, { url: checkout.hostedUrl, paymentId: payment.id });
    }
    if (req.method === "POST" && resource === "payment-method") {
      if (user.role !== "client") throw appError("Acesso negado.", 403);
      const payment = await paymentFor(user, body.paymentId);
      if (!["pix_manual", "local"].includes(body.provider))
        throw appError("Método inválido.");
      if (
        !["pending", "failed", "expired", "awaiting_confirmation"].includes(
          payment.status,
        )
      )
        throw appError("Este pagamento não permite trocar o método.", 409);
      const method = body.provider === "local" ? "local" : "pix";
      const updated = await query(
        `update public.payments set provider=$2,method=$3,payment_method=$3,status='pending',updated_at=now() where id=$1 and status in ('pending','failed','expired','awaiting_confirmation') returning id`,
        [payment.id, body.provider, method],
      );
      if (!updated.rows[0])
        throw appError("O pagamento mudou de status. Atualize a página.", 409);
      return send(res, 200, { ok: true });
    }
    if (req.method === "POST" && resource === "receipt") {
      if (user.role !== "client") throw appError("Acesso negado.", 403);
      const payment = await paymentFor(user, body.paymentId);
      await transaction(async (client) => {
        const locked = await client.query(
          "select id,status,provider from public.payments where id=$1 for update",
          [payment.id],
        );
        const active = await client.query(
          "select id from public.payment_receipts where payment_id=$1 and status='under_review' limit 1",
          [payment.id],
        );
        const validationError = receiptSubmissionError({
          role: user.role,
          provider: locked.rows[0]?.provider,
          paymentStatus: locked.rows[0]?.status,
          url: body.url,
          hasActiveReceipt: Boolean(active.rows[0]),
        });
        if (validationError) throw appError(validationError, 409);
        if (!isConfiguredCloudinaryUrl(body.url, ["image", "raw"]))
          throw appError("O comprovante deve ser enviado pelo upload seguro.");
        const receipt = await client.query(
          `insert into public.payment_receipts(payment_id,uploaded_by,storage_url) values($1,$2,$3) returning id`,
          [payment.id, user.id, body.url],
        );
        await client.query(
          `update public.payments set receipt_url=$2,status='under_review',updated_at=now() where id=$1`,
          [payment.id, body.url],
        );
        await client.query(
          `insert into public.payment_status_history(payment_id,old_status,new_status,changed_by,notes) values($1,$2,'under_review',$3,'Comprovante enviado')`,
          [payment.id, locked.rows[0].status, user.id],
        );
        await client.query(
          `insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_data) values($1,'create','payment_receipt',$2,$3)`,
          [
            user.id,
            receipt.rows[0].id,
            JSON.stringify({
              paymentId: payment.id,
              status: "under_review",
            }),
          ],
        );
        return receipt;
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
    console.error("Payments API error", {
      method: req.method,
      resource: req.query?.resource,
      status: error.status || 500,
      message: error.message,
    });
    return handleError(res, error);
  }
}
