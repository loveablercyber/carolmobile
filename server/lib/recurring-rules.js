const truthy = (value) =>
  ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());

export function recurringConfig(env = process.env) {
  const environment = String(env.SUMUP_ENVIRONMENT || "sandbox").toLowerCase();
  const mode = String(env.SUMUP_RECURRING_MODE || "disabled").toLowerCase();
  const enabled = truthy(env.SUMUP_RECURRING_ENABLED);
  const sandboxOnly = mode === "sandbox" && environment === "sandbox";
  return {
    enabled,
    mode,
    environment,
    chargeAllowed: enabled && sandboxOnly,
    reason: !enabled
      ? "Cobrança recorrente desabilitada."
      : !sandboxOnly
        ? "Esta versão permite cobranças recorrentes somente em sandbox."
        : null,
  };
}

export function renewalEligibility(item, now = new Date()) {
  if (!item?.auto_renew || !item?.recurring_consent_at)
    return "Renovação automática sem consentimento ativo.";
  if (!["active", "delinquent"].includes(item.status))
    return "Assinatura fora de estado renovável.";
  if (!item.renews_at) return "Assinatura sem data de renovação.";
  if (new Date(`${String(item.renews_at).slice(0, 10)}T00:00:00Z`) > now)
    return "Assinatura ainda não venceu.";
  if (!item.card_id || !item.external_token || !item.provider_customer_id)
    return "Cartão tokenizado indisponível.";
  if (Number(item.amount) <= 0) return "Valor de renovação inválido.";
  if (Number(item.renewal_failures || 0) >= 3)
    return "Limite de retentativas atingido.";
  if (item.next_retry_at && new Date(item.next_retry_at) > now)
    return "Retentativa ainda não liberada.";
  return null;
}

export function renewalPeriod(value) {
  const period = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(period))
    throw new Error("Competência de renovação inválida.");
  return period;
}

export function nextRetryAt(failureCount, now = new Date()) {
  const days = Number(failureCount) === 1 ? 1 : Number(failureCount) === 2 ? 3 : 0;
  if (!days) return null;
  return new Date(now.getTime() + days * 86_400_000).toISOString();
}
