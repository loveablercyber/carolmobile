import { query, transaction } from "./db.js";
import { normalizeSumupInstrument } from "./card-rules.js";
import { listSumupPaymentInstruments, retrieveSumupCheckout } from "./sumup.js";
import { recurringConfig } from "./recurring-rules.js";
import { recurringPreview } from "./recurring-billing.js";

function assertSandboxReady() {
  const config = recurringConfig();
  if (!config.enabled || config.mode !== "sandbox" || config.environment !== "sandbox")
    throw Object.assign(
      new Error("Cenário recorrente permitido somente com recorrência em sandbox."),
      { status: 409 },
    );
  return config;
}

export async function recurringSandboxOverview() {
  const config = assertSandboxReady();
  const { rows: counts } = await query(`
    select
      (select count(*)::int from public.subscriptions) as subscriptions,
      (select count(*)::int from public.subscriptions where status in ('active','delinquent')) as renewable_subscriptions,
      (select count(*)::int from public.saved_cards where active and provider='sumup' and external_token is not null) as tokenized_cards,
      (select count(*)::int from public.subscriptions where auto_renew and recurring_consent_at is not null) as consented_subscriptions
  `);
  const { rows: possible } = await query(`
    select s.id as subscription_id,
      s.status,
      s.renews_at,
      s.auto_renew,
      s.recurring_consent_at is not null as has_consent,
      s.renewal_failures,
      p.name as plan_name,
      p.price as amount,
      sc.id as card_id,
      sc.last_four,
      sc.brand,
      sc.external_token is not null as has_token,
      coalesce(sc.provider_customer_id,c.sumup_customer_id) is not null as has_customer,
      (
        lower(coalesce(pr.full_name,'')) like '%teste%'
        or lower(coalesce(pr.full_name,'')) like '%test%'
        or lower(coalesce(pr.full_name,'')) like '%sandbox%'
        or lower(coalesce(pr.full_name,'')) like '%demo%'
        or lower(coalesce(au.email,'')) like '%teste%'
        or lower(coalesce(au.email,'')) like '%test%'
        or lower(coalesce(au.email,'')) like '%sandbox%'
        or lower(coalesce(au.email,'')) like '%demo%'
      ) as test_profile
    from public.subscriptions s
    join public.plans p on p.id=s.plan_id
    join public.clients c on c.id=s.client_id
    join public.profiles pr on pr.id=c.profile_id
    left join auth.users au on au.id=pr.id
    left join public.saved_cards sc on sc.client_id=s.client_id
      and sc.active and sc.provider='sumup' and sc.external_token is not null
    where s.status in ('active','delinquent')
    order by
      case when sc.id is not null and coalesce(sc.provider_customer_id,c.sumup_customer_id) is not null then 0 else 1 end,
      s.renews_at nulls last,
      s.created_at desc
    limit 10
  `);
  const { rows: sessions } = await query(`
    select s.id,
      s.status,
      s.customer_id,
      s.checkout_id,
      s.checkout_reference,
      s.expires_at,
      s.completed_at,
      s.card_id,
      pr.full_name,
      au.email
    from public.card_tokenization_sessions s
    join public.clients c on c.id=s.client_id
    join public.profiles pr on pr.id=c.profile_id
    left join auth.users au on au.id=pr.id
    where lower(coalesce(pr.full_name,'')) like '%teste%'
      or lower(coalesce(pr.full_name,'')) like '%test%'
      or lower(coalesce(pr.full_name,'')) like '%sandbox%'
      or lower(coalesce(pr.full_name,'')) like '%demo%'
      or lower(coalesce(au.email,'')) like '%teste%'
      or lower(coalesce(au.email,'')) like '%test%'
      or lower(coalesce(au.email,'')) like '%sandbox%'
      or lower(coalesce(au.email,'')) like '%demo%'
    order by s.created_at desc
    limit 5
  `);
  const safeSessions = [];
  for (const session of sessions) {
    let provider = null;
    try {
      const checkout = await retrieveSumupCheckout(session.checkout_id);
      const providerToken = String(checkout?.payment_instrument?.token || "");
      const listed = providerToken
        ? await listSumupPaymentInstruments(checkout.customer_id)
        : null;
      const instruments = Array.isArray(listed) ? listed : listed?.items || [];
      const matching = instruments.find((item) => item?.token === providerToken);
      provider = {
        status: checkout?.status || null,
        purpose: checkout?.purpose || null,
        hasPaymentInstrument: Boolean(providerToken),
        checkoutInstrument: checkout?.payment_instrument
          ? {
              type: checkout.payment_instrument.type || null,
              active: checkout.payment_instrument.active ?? null,
              brand: checkout.payment_instrument.card?.type || null,
              lastFour: checkout.payment_instrument.card?.last_4_digits || null,
              normalizes: Boolean(
                normalizeSumupInstrument(checkout.payment_instrument),
              ),
            }
          : null,
        customerMatches: checkout?.customer_id === session.customer_id,
        instrumentCount: instruments.length,
        matchingInstrument: matching
          ? {
              type: matching.type || null,
              active: matching.active ?? null,
              brand: matching.card?.type || null,
              lastFour: matching.card?.last_4_digits || null,
              normalizes: Boolean(normalizeSumupInstrument(matching)),
            }
          : null,
      };
    } catch (error) {
      provider = {
        error: error.message,
        providerStatus: error.providerStatus || null,
      };
    }
    safeSessions.push({
      id: session.id,
      status: session.status,
      checkout_reference: session.checkout_reference,
      expires_at: session.expires_at,
      completed_at: session.completed_at,
      has_card: Boolean(session.card_id),
      provider,
    });
  }
  return {
    config,
    counts: counts[0],
    preview: await recurringPreview(5),
    possible,
    cardSessions: safeSessions,
  };
}

export async function prepareRecurringSandboxCandidate() {
  assertSandboxReady();
  return transaction(async (client) => {
    const selected = await client.query(`
      select s.id as subscription_id,
        s.client_id,
        p.name as plan_name,
        p.price as amount,
        sc.id as card_id,
        sc.last_four,
        sc.brand
      from public.subscriptions s
      join public.plans p on p.id=s.plan_id
      join public.clients c on c.id=s.client_id
      join public.profiles pr on pr.id=c.profile_id
      left join auth.users au on au.id=pr.id
      join public.saved_cards sc on sc.client_id=s.client_id
        and sc.active
        and sc.provider='sumup'
        and sc.external_token is not null
        and coalesce(sc.provider_customer_id,c.sumup_customer_id) is not null
      where s.status in ('active','delinquent')
        and (
          lower(coalesce(pr.full_name,'')) like '%teste%'
          or lower(coalesce(pr.full_name,'')) like '%test%'
          or lower(coalesce(pr.full_name,'')) like '%sandbox%'
          or lower(coalesce(pr.full_name,'')) like '%demo%'
          or lower(coalesce(au.email,'')) like '%teste%'
          or lower(coalesce(au.email,'')) like '%test%'
          or lower(coalesce(au.email,'')) like '%sandbox%'
          or lower(coalesce(au.email,'')) like '%demo%'
        )
        and not exists (
          select 1 from public.subscription_renewal_attempts a
          where a.subscription_id=s.id and a.billing_period=current_date
        )
      order by sc.is_default desc, s.renews_at nulls last, s.created_at desc
      limit 1
      for update of s
    `);
    const item = selected.rows[0];
    if (!item)
      return {
        prepared: false,
        reason:
          "Nenhuma assinatura de teste com cartão SumUp tokenizado e customer_id foi encontrada.",
      };
    await client.query(
      `update public.subscriptions
       set status='active',
         auto_renew=true,
         recurring_card_id=$2,
         recurring_consent_at=coalesce(recurring_consent_at,now()),
         recurring_consent_revoked_at=null,
         recurring_consent_version='sandbox-module-11',
         renews_at=current_date,
         expires_at=current_date,
         renewal_failures=0,
         next_retry_at=null,
         updated_at=now()
       where id=$1`,
      [item.subscription_id, item.card_id],
    );
    await client.query(
      `insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_data)
       values(null,'sandbox_prepare_recurring','subscription',$1,$2)`,
      [
        item.subscription_id,
        JSON.stringify({
          module: "11",
          card_last_four: item.last_four,
          plan_name: item.plan_name,
        }),
      ],
    );
    return {
      prepared: true,
      subscription_id: item.subscription_id,
      plan_name: item.plan_name,
      amount: item.amount,
      card: {
        id: item.card_id,
        brand: item.brand,
        last_four: item.last_four,
      },
    };
  });
}
