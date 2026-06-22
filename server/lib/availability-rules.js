const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(\d{2}):(\d{2})(?::\d{2})?$/;

export function isAvailabilityDate(value) {
  if (!datePattern.test(String(value || ""))) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export function weekdayForDate(value) {
  if (!isAvailabilityDate(value)) return -1;
  return new Date(`${value}T12:00:00.000Z`).getUTCDay();
}

export function timeMinutes(value) {
  const match = String(value || "").match(timePattern);
  if (!match) return -1;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return -1;
  return hour * 60 + minute;
}

function minuteLabel(total) {
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function scheduleSlots(windows, durationMinutes, stepMinutes = 30) {
  const duration = Number(durationMinutes);
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const slots = new Set();
  for (const window of windows || []) {
    if (window.active === false) continue;
    const starts = timeMinutes(window.starts_at);
    const ends = timeMinutes(window.ends_at);
    if (starts < 0 || ends <= starts) continue;
    for (let minute = starts; minute + duration <= ends; minute += stepMinutes)
      slots.add(minuteLabel(minute));
  }
  return [...slots].sort();
}

export function slotsWithConflicts(date, slots, durationMinutes, conflicts) {
  return slots.map((time) => {
    const startsAt = new Date(`${date}T${time}:00-03:00`);
    const endsAt = new Date(startsAt.getTime() + Number(durationMinutes) * 60_000);
    const available = !(conflicts || []).some((conflict) => {
      const conflictStart = new Date(conflict.starts_at);
      const conflictEnd = new Date(conflict.ends_at);
      return conflictStart < endsAt && conflictEnd > startsAt;
    });
    return { time, available };
  });
}

const saoPauloFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function saoPauloParts(value) {
  const parts = Object.fromEntries(
    saoPauloFormatter
      .formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return {
    date,
    weekday: weekdayForDate(date),
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

export function schedulePeriod(startsAt, endsAt) {
  const starts = new Date(startsAt);
  const ends = new Date(endsAt);
  if (
    Number.isNaN(starts.getTime()) ||
    Number.isNaN(ends.getTime()) ||
    ends <= starts
  )
    return { period: null, error: "Período inválido." };
  if (starts.getTime() <= Date.now())
    return { period: null, error: "Escolha um período futuro." };
  if (ends.getTime() - starts.getTime() > 12 * 60 * 60_000)
    return { period: null, error: "O bloqueio não pode exceder 12 horas." };
  const localStart = saoPauloParts(starts);
  const localEnd = saoPauloParts(ends);
  if (localStart.date !== localEnd.date)
    return { period: null, error: "O bloqueio deve começar e terminar no mesmo dia." };
  return {
    period: {
      starts,
      ends,
      date: localStart.date,
      weekday: localStart.weekday,
      startMinute: localStart.minute,
      endMinute: localEnd.minute,
    },
    error: "",
  };
}

export function periodFitsSchedule(period, windows) {
  return (windows || []).some((window) => {
    if (window.active === false) return false;
    const starts = timeMinutes(window.starts_at);
    const ends = timeMinutes(window.ends_at);
    return period.startMinute >= starts && period.endMinute <= ends;
  });
}
