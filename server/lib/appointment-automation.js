import { query } from "./db.js";

export const DEFAULT_APPOINTMENT_AUTOMATION_SETTINGS = Object.freeze({
  bookingEnabled: true,
  notifyClientOnCreate: true,
  notifyProfessionalOnCreate: true,
  reminder24hEnabled: true,
  reminder24hHoursBefore: 24,
  reminder2hEnabled: true,
  reminder2hHoursBefore: 2,
  notifyClientOnReschedule: true,
  notifyProfessionalOnReschedule: true,
  notifyClientOnCancel: true,
  notifyProfessionalOnCancel: true,
  googleCalendarLinkEnabled: true,
  reminderRetryWindowMinutes: 90,
  maxDeliveryAttempts: 3,
  timezone: "America/Sao_Paulo",
});

const booleanValue = (value, fallback) =>
  typeof value === "boolean" ? value : fallback;

const boundedInteger = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
};

export function normalizeAppointmentAutomationSettings(value = {}) {
  const defaults = DEFAULT_APPOINTMENT_AUTOMATION_SETTINGS;
  const input = value && typeof value === "object" ? value : {};
  return {
    bookingEnabled: booleanValue(input.bookingEnabled, defaults.bookingEnabled),
    notifyClientOnCreate: booleanValue(
      input.notifyClientOnCreate,
      defaults.notifyClientOnCreate,
    ),
    notifyProfessionalOnCreate: booleanValue(
      input.notifyProfessionalOnCreate,
      defaults.notifyProfessionalOnCreate,
    ),
    reminder24hEnabled: booleanValue(
      input.reminder24hEnabled,
      defaults.reminder24hEnabled,
    ),
    reminder24hHoursBefore: boundedInteger(
      input.reminder24hHoursBefore,
      defaults.reminder24hHoursBefore,
      3,
      168,
    ),
    reminder2hEnabled: booleanValue(
      input.reminder2hEnabled,
      defaults.reminder2hEnabled,
    ),
    reminder2hHoursBefore: boundedInteger(
      input.reminder2hHoursBefore,
      defaults.reminder2hHoursBefore,
      1,
      12,
    ),
    notifyClientOnReschedule: booleanValue(
      input.notifyClientOnReschedule,
      defaults.notifyClientOnReschedule,
    ),
    notifyProfessionalOnReschedule: booleanValue(
      input.notifyProfessionalOnReschedule,
      defaults.notifyProfessionalOnReschedule,
    ),
    notifyClientOnCancel: booleanValue(
      input.notifyClientOnCancel,
      defaults.notifyClientOnCancel,
    ),
    notifyProfessionalOnCancel: booleanValue(
      input.notifyProfessionalOnCancel,
      defaults.notifyProfessionalOnCancel,
    ),
    googleCalendarLinkEnabled: booleanValue(
      input.googleCalendarLinkEnabled,
      defaults.googleCalendarLinkEnabled,
    ),
    reminderRetryWindowMinutes: boundedInteger(
      input.reminderRetryWindowMinutes,
      defaults.reminderRetryWindowMinutes,
      20,
      180,
    ),
    maxDeliveryAttempts: boundedInteger(
      input.maxDeliveryAttempts,
      defaults.maxDeliveryAttempts,
      1,
      5,
    ),
    timezone:
      String(input.timezone || defaults.timezone).trim() || defaults.timezone,
  };
}

export async function loadAppointmentAutomationSettings(queryer = query) {
  try {
    const { rows } = await queryer(
      "select value from public.business_settings where key='appointment_automation' limit 1",
    );
    return normalizeAppointmentAutomationSettings(rows[0]?.value || {});
  } catch (error) {
    if (error?.code !== "42P01" && error?.code !== "42703") throw error;
    return normalizeAppointmentAutomationSettings();
  }
}

export async function loadAppointmentAutomationContext(queryer = query) {
  const [settings, profileResult] = await Promise.all([
    loadAppointmentAutomationSettings(queryer),
    queryer(
      "select value from public.business_settings where key='business_profile' limit 1",
    ).catch(() => ({ rows: [] })),
  ]);
  const profile = profileResult.rows[0]?.value || {};
  return {
    settings: normalizeAppointmentAutomationSettings({
      ...settings,
      timezone: profile.timezone || settings.timezone,
    }),
    businessName: String(profile.businessName || "Carol Sol").trim() || "Carol Sol",
    address: String(profile.address || "").trim(),
  };
}

const calendarDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
};

export function generateGoogleCalendarUrl(
  appointment = {},
  { businessName = "Carol Sol", timezone = "America/Sao_Paulo", address = "" } = {},
) {
  const startsAt = calendarDate(appointment.starts_at || appointment.startsAt);
  const endsAt = calendarDate(appointment.ends_at || appointment.endsAt);
  if (!startsAt || !endsAt) return "";
  const service = String(appointment.service || appointment.serviceName || "Atendimento").trim();
  const professional = String(
    appointment.professional || appointment.professionalName || "",
  ).trim();
  const client = String(appointment.client || appointment.clientName || "").trim();
  const durationMinutes = Math.max(
    0,
    Math.round(
      (new Date(appointment.ends_at || appointment.endsAt).getTime() -
        new Date(appointment.starts_at || appointment.startsAt).getTime()) /
        60_000,
    ),
  );
  const details = [
    `Serviço: ${service}`,
    professional ? `Profissional: ${professional}` : "",
    client ? `Cliente: ${client}` : "",
    durationMinutes ? `Duração: ${durationMinutes} minutos` : "",
    appointment.booking_code ? `Código: ${appointment.booking_code}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `${service} - ${businessName}`,
    dates: `${startsAt}/${endsAt}`,
    details,
    ctz: timezone || "America/Sao_Paulo",
  });
  const location = String(appointment.location || address || "").trim();
  if (location) params.set("location", location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function appointmentReminderWindows(settingsInput = {}) {
  const settings = normalizeAppointmentAutomationSettings(settingsInput);
  return [
    settings.reminder24hEnabled
      ? { key: "24h", hoursBefore: settings.reminder24hHoursBefore }
      : null,
    settings.reminder2hEnabled
      ? { key: "2h", hoursBefore: settings.reminder2hHoursBefore }
      : null,
  ].filter(Boolean);
}

export function dueAppointmentReminderWindows(
  startsAt,
  { now = new Date(), settings: settingsInput = {} } = {},
) {
  const settings = normalizeAppointmentAutomationSettings(settingsInput);
  const appointmentTime = new Date(startsAt).getTime();
  const nowTime = new Date(now).getTime();
  if (!Number.isFinite(appointmentTime) || !Number.isFinite(nowTime) || appointmentTime <= nowTime)
    return [];
  const retryWindowMs = settings.reminderRetryWindowMinutes * 60_000;
  return appointmentReminderWindows(settings).filter((window) => {
    const target = appointmentTime - window.hoursBefore * 60 * 60_000;
    return nowTime >= target && nowTime <= target + retryWindowMs;
  });
}

export function appointmentNotificationVersion(appointment = {}) {
  const value = appointment.updated_at || appointment.updatedAt || appointment.created_at;
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) && timestamp > 0 ? String(timestamp) : "1";
}

const appointmentStatusMessages = Object.freeze({
  requested: "recebemos sua solicitação de agendamento",
  awaiting_payment: "seu agendamento está aguardando o pagamento",
  pending_deposit: "seu agendamento está aguardando a confirmação do sinal",
  confirmed: "seu agendamento foi confirmado",
  in_service: "seu atendimento foi iniciado",
  completed: "seu atendimento foi concluído",
  cancelled: "seu agendamento foi cancelado",
  no_show: "seu agendamento foi registrado como não comparecimento",
  rescheduled: "seu agendamento foi reagendado",
  reschedule_requested: "sua solicitação de reagendamento está em análise",
  updated: "os dados do seu agendamento foram atualizados",
});

export function appointmentChangeMessage({
  status = "updated",
  service = "Atendimento",
  startsAt,
  professional = "",
  timezone = "America/Sao_Paulo",
  calendarUrl = "",
} = {}) {
  const eventText = appointmentStatusMessages[status] || appointmentStatusMessages.updated;
  const parsedDate = new Date(startsAt || "");
  const prettyDate = Number.isNaN(parsedDate.getTime())
    ? ""
    : parsedDate.toLocaleString("pt-BR", {
        timeZone: timezone,
        dateStyle: "short",
        timeStyle: "short",
      });
  const title = status === "cancelled"
    ? "Agendamento cancelado"
    : status === "confirmed"
      ? "Agendamento confirmado"
      : status === "rescheduled"
        ? "Agendamento reagendado"
        : "Atualização do agendamento";
  const text = [
    `Olá! ${eventText.charAt(0).toUpperCase()}${eventText.slice(1)}.`,
    `Serviço: ${String(service || "Atendimento").trim() || "Atendimento"}`,
    prettyDate && !["cancelled", "completed", "no_show"].includes(status)
      ? `Data/Horário: ${prettyDate}`
      : "",
    professional ? `Profissional: ${professional}` : "",
    calendarUrl && !["cancelled", "completed", "no_show"].includes(status)
      ? `Adicionar ao Google Calendar:\n${calendarUrl}`
      : "",
  ].filter(Boolean).join("\n");
  return { title, text, prettyDate };
}

export function whatsappAppointmentIdempotencyKey(conversationId, previousAppointmentId = "") {
  const conversation = String(conversationId || "").trim();
  if (!conversation) throw new Error("Conversa obrigatória para idempotência.");
  return `whatsapp:${conversation}:${String(previousAppointmentId || "first")}`;
}
