import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { CalendarDays, Clock3, MapPin, Phone } from "lucide-react";
import { Badge, Modal } from "./ui";

export type AppointmentCalendarItem = {
  id: string;
  booking_code?: string | null;
  starts_at: string;
  ends_at?: string | null;
  status: string;
  client?: string | null;
  client_phone?: string | null;
  service?: string | null;
  professional?: string | null;
  professional_phone?: string | null;
  duration?: string | null;
  value?: string | null;
  estimated_value?: number | string | null;
  location?: string | null;
  notes?: string | null;
  intake_data?: any;
};

type StatusOption = {
  value: string;
  label: string;
};

type AppointmentCalendarProps = {
  month: Date;
  items: AppointmentCalendarItem[];
  statusLabels: Record<string, string>;
  statusOptions?: StatusOption[];
  updatingId?: string;
  onStatusChange?: (id: string, status: string) => void | Promise<void>;
  onOpenDetails?: (item: AppointmentCalendarItem) => void;
  onOpenDiagnosis?: (item: AppointmentCalendarItem) => void;
};

const terminalStatuses = new Set([
  "completed",
  "cancelled",
  "no_show",
  "rescheduled",
]);

const dateKey = (value: Date) =>
  [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");

const appointmentDateKey = (value: string) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
};

const time = (value: string) =>
  new Date(value).toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  });

const dateTime = (value?: string | null) =>
  value
    ? new Date(value).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        dateStyle: "short",
        timeStyle: "short",
      })
    : "-";

const currency = (value: unknown) => {
  if (typeof value === "string" && value.trim().startsWith("R$")) return value;
  const number = Number(value || 0);
  return number
    ? number.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    : "-";
};

function visualStatus(item: AppointmentCalendarItem) {
  const status = String(item.status || "");
  if (status === "blocked")
    return {
      key: "blocked",
      label: "Bloqueado",
      chip: "border-stone-300 bg-stone-100 text-stone-600 line-through opacity-85",
      dot: "bg-stone-400",
      badge: "neutral" as const,
    };
  const expired =
    new Date(item.starts_at).getTime() < Date.now() &&
    !terminalStatuses.has(status);
  if (expired)
    return {
      key: "expired",
      label: "Expirado",
      chip: "border-stone-700 bg-stone-800 text-white",
      dot: "bg-stone-800",
      badge: "neutral" as const,
    };
  if (["cancelled", "no_show"].includes(status))
    return {
      key: "cancelled",
      label: status === "no_show" ? "Faltou" : "Cancelado",
      chip: "border-rose-200 bg-rose-50 text-rose-800",
      dot: "bg-rose-500",
      badge: "rose" as const,
    };
  if (["confirmed", "rescheduled"].includes(status))
    return {
      key: "scheduled",
      label: status === "rescheduled" ? "Reagendado" : "Agendado",
      chip: "border-emerald-200 bg-emerald-50 text-emerald-800",
      dot: "bg-emerald-500",
      badge: "green" as const,
    };
  if (status === "completed")
    return {
      key: "completed",
      label: "Finalizado",
      chip: "border-stone-200 bg-stone-100 text-stone-700",
      dot: "bg-stone-400",
      badge: "neutral" as const,
    };
  return {
    key: "pending",
    label: "Pendente",
    chip: "border-amber-200 bg-amber-50 text-amber-800",
    dot: "bg-amber-500",
    badge: "amber" as const,
  };
}

export function AppointmentCalendar({
  month,
  items,
  statusLabels,
  statusOptions = [],
  updatingId = "",
  onStatusChange,
  onOpenDetails,
  onOpenDiagnosis,
}: AppointmentCalendarProps) {
  const [selected, setSelected] = useState<AppointmentCalendarItem | null>(null);
  const days = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const start = new Date(first);
    start.setDate(first.getDate() - first.getDay());
    return Array.from({ length: 42 }, (_, index) => {
      const day = new Date(start);
      day.setDate(start.getDate() + index);
      return day;
    });
  }, [month]);
  const grouped = useMemo(() => {
    const map = new Map<string, AppointmentCalendarItem[]>();
    for (const item of items) {
      const key = appointmentDateKey(item.starts_at);
      const list = map.get(key) || [];
      list.push(item);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort(
        (left, right) =>
          new Date(left.starts_at).getTime() -
          new Date(right.starts_at).getTime(),
      );
    }
    return map;
  }, [items]);
  const selectedVisual = selected ? visualStatus(selected) : null;
  const selectedHasDiagnosis = Boolean(selected?.intake_data?.answers);

  const changeSelectedStatus = (status: string) => {
    if (!selected || !onStatusChange) return;
    setSelected({ ...selected, status });
    void onStatusChange(selected.id, status);
  };

  return (
    <section className="surface overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/5 p-5">
        <div>
          <h2 className="font-display text-2xl font-semibold text-ink">
            Calendario visual
          </h2>
          <p className="muted text-sm">
            Cores mostram agendados, pendentes, expirados e cancelados.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-[10px] font-bold text-stone-500">
          {[
            ["bg-emerald-500", "Agendado"],
            ["bg-amber-500", "Pendente"],
            ["bg-stone-800", "Expirado"],
            ["bg-rose-500", "Cancelado"],
          ].map(([color, label]) => (
            <span key={label} className="inline-flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
              {label}
            </span>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[760px]">
          <div className="grid grid-cols-7 border-b border-black/5 bg-warm/70 text-center text-[10px] font-bold uppercase tracking-wider text-stone-400">
            {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"].map((day) => (
              <div key={day} className="p-3">
                {day}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((day) => {
              const key = dateKey(day);
              const dayItems = grouped.get(key) || [];
              const currentMonth = day.getMonth() === month.getMonth();
              const today = key === dateKey(new Date());
              return (
                <div
                  key={key}
                  className={`min-h-32 border-b border-r border-black/5 p-2 last:border-r-0 ${
                    currentMonth ? "bg-white" : "bg-stone-50/70"
                  }`}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span
                      className={`grid h-7 w-7 place-items-center rounded-full text-xs font-bold ${
                        today
                          ? "bg-ink text-white"
                          : currentMonth
                            ? "text-ink"
                            : "text-stone-300"
                      }`}
                    >
                      {day.getDate()}
                    </span>
                    {dayItems.length > 2 && (
                      <span className="text-[9px] font-bold text-stone-400">
                        {dayItems.length}
                      </span>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {dayItems.slice(0, 4).map((item) => {
                      const visual = visualStatus(item);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setSelected(item)}
                          className={`w-full rounded-lg border px-2 py-1.5 text-left text-[10px] font-bold leading-tight ${visual.chip}`}
                        >
                          <span className="block">{time(item.starts_at)}</span>
                          <span className="block truncate">
                            {item.client || item.service || "Agendamento"}
                          </span>
                        </button>
                      );
                    })}
                    {dayItems.length > 4 && (
                      <span className="block px-1 text-[10px] font-bold text-stone-400">
                        +{dayItems.length - 4} outros
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title="Detalhes do agendamento"
      >
        {selected && selectedVisual && (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <span>
                <b className="block font-display text-3xl leading-none">
                  {(selected as any).client_whatsapp_title || selected.client || "Cliente"}
                </b>
                {selected.client && selected.client !== (selected as any).client_whatsapp_title && (
                  <span className="mt-1 block text-sm font-semibold text-stone-600">
                    Nome: {selected.client}
                  </span>
                )}
                <span className="mt-2 block text-xs text-stone-500">
                  {selected.service || "Servico nao informado"}
                </span>
              </span>
              <Badge tone={selectedVisual.badge}>
                {selectedVisual.label}
              </Badge>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Detail
                icon={<CalendarDays size={15} />}
                label="Data e hora"
                value={dateTime(selected.starts_at)}
              />
              <Detail
                icon={<Clock3 size={15} />}
                label="Fim previsto"
                value={dateTime(selected.ends_at)}
              />
              <Detail
                label="Profissional"
                value={selected.professional || "-"}
              />
              <Detail label="Valor" value={selected.value || currency(selected.estimated_value)} />
              <Detail
                icon={<MapPin size={15} />}
                label="Local"
                value={selected.location || "Carol Sol"}
              />
              <Detail
                icon={<Phone size={15} />}
                label="Contato"
                value={selected.client_phone || selected.professional_phone || "-"}
              />
            </div>
            {selected.booking_code && (
              <div className="rounded-2xl bg-warm p-4 text-xs">
                <span className="text-stone-400">Codigo</span>
                <b className="mt-1 block">{selected.booking_code}</b>
              </div>
            )}
            {selected.notes && (
              <div className="rounded-2xl bg-warm p-4 text-xs">
                <span className="text-stone-400">Observacoes</span>
                <p className="mt-1 font-semibold">{selected.notes}</p>
              </div>
            )}
            {selectedHasDiagnosis && onOpenDiagnosis && (
              <button
                type="button"
                onClick={() => {
                  onOpenDiagnosis(selected);
                  setSelected(null);
                }}
                className="text-xs font-bold text-champagne hover:underline"
              >
                [Ver Diagnóstico]
              </button>
            )}
            {onStatusChange && statusOptions.length > 0 && (
              <label className="block">
                <span className="mb-2 block text-xs font-bold">
                  Atualizar status
                </span>
                <select
                  disabled={updatingId === selected.id}
                  value={selected.status}
                  onChange={(event) => changeSelectedStatus(event.target.value)}
                  className="field"
                >
                  {statusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {onOpenDetails && (
              <button
                type="button"
                onClick={() => {
                  onOpenDetails(selected);
                  setSelected(null);
                }}
                className="btn-primary w-full"
              >
                Abrir detalhes completos
              </button>
            )}
            <div className="rounded-2xl bg-warm p-4 text-xs">
              <span className="text-stone-400">Status original</span>
              <b className="mt-1 block">
                {statusLabels[selected.status] || selected.status}
              </b>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}

function Detail({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-warm p-4 text-xs">
      <span className="flex items-center gap-1.5 text-stone-400">
        {icon}
        {label}
      </span>
      <b className="mt-1 block">{value}</b>
    </div>
  );
}
