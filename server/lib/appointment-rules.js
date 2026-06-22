export const appointmentStatuses = [
  "requested",
  "awaiting_payment",
  "pending_deposit",
  "confirmed",
  "in_service",
  "completed",
  "cancelled",
  "no_show",
  "rescheduled",
  "reschedule_requested",
];

const clientStatuses = new Set(["cancelled", "rescheduled"]);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function queryValue(value) {
  if (Array.isArray(value)) return value[0] || "";
  return String(value || "");
}

function isCalendarDate(value) {
  if (!datePattern.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export function appointmentRange(query = {}) {
  const dateFrom = queryValue(query.dateFrom);
  const dateTo = queryValue(query.dateTo);
  if (!dateFrom && !dateTo) return { range: null, error: "" };
  if (!dateFrom || !dateTo)
    return { range: null, error: "Informe o início e o fim do período." };
  if (!isCalendarDate(dateFrom) || !isCalendarDate(dateTo))
    return { range: null, error: "Período de agenda inválido." };

  const start = Date.parse(`${dateFrom}T00:00:00.000Z`);
  const end = Date.parse(`${dateTo}T00:00:00.000Z`);
  const days = (end - start) / 86_400_000;
  if (days <= 0)
    return { range: null, error: "O fim do período deve ser posterior ao início." };
  if (days > 93)
    return { range: null, error: "O período máximo da agenda é de 93 dias." };
  return { range: { dateFrom, dateTo }, error: "" };
}

export function canUpdateAppointmentStatus(role, status) {
  if (!appointmentStatuses.includes(status)) return false;
  if (role === "client") return clientStatuses.has(status);
  return role === "professional" || role === "admin";
}
