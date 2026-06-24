const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sumupCustomerReference(clientId) {
  const value = String(clientId || "");
  if (!uuidPattern.test(value)) return null;
  return `CAROLSOL-${value.replace(/-/g, "").toUpperCase()}`;
}

export function successfulCardSetupStatus(status) {
  return ["PAID", "SUCCESSFUL"].includes(String(status || "").toUpperCase());
}

export function normalizeSumupInstrument(instrument) {
  const token = String(instrument?.token || "").trim();
  const lastFour = String(instrument?.card?.last_4_digits || "").trim();
  const brand = String(instrument?.card?.type || "").trim().toUpperCase();
  if (
    !token ||
    token.length > 255 ||
    instrument?.type !== "card" ||
    instrument?.active !== true ||
    !/^\d{4}$/.test(lastFour) ||
    !/^[A-Z0-9 _-]{2,30}$/.test(brand)
  )
    return null;
  return { token, lastFour, brand };
}
