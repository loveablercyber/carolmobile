export function normalizeBrazilianPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  const local = digits.startsWith("55") ? digits.slice(2) : digits;
  if (!/^\d{10,11}$/.test(local)) return "";
  return `55${local}`;
}

export function brazilianPhoneCandidates(value) {
  const canonical = normalizeBrazilianPhone(value);
  if (!canonical) return [];
  const local = canonical.slice(2);
  return [...new Set([canonical, local])];
}
