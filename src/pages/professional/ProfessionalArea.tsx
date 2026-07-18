import { useEffect, useMemo, useState, FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  BadgeDollarSign,
  BarChart3,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Download,
  ImagePlus,
  MessageCircle,
  Package,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Star,
  TrendingUp,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import { AppShell } from "../../components/AppShell";
import {
  Avatar,
  Badge,
  EmptyState,
  PageHeader,
  SectionHeading,
  StatCard,
  Toast,
  Modal,
} from "../../components/ui";
import { AppointmentCalendar } from "../../components/AppointmentCalendar";
import { clients, images } from "../../data/mock";
import { apiFetch } from "../../lib/api";
import { WhatsAppIntegrationPage } from "../WhatsAppIntegration";
import {
  ProfessionalAvailabilityPage,
  ProfessionalClientDetailPage,
  ProfessionalCommissionsPage,
  ProfessionalDashboardPage,
  ProfessionalProfilePage,
  ProfessionalRecordsPage,
  ProfessionalServicesPage,
  IntakeDetailsModal,
  ProfessionalAppointmentDetailPage,
} from "./ProfessionalPortal";

const professionalAppointmentLabel: Record<string, string> = {
  requested: "Solicitado",
  awaiting_payment: "Aguardando pagamento",
  pending_deposit: "Aguardando sinal",
  confirmed: "Confirmado",
  rescheduled: "Reagendado",
};

const professionalAppointmentTone = (status: string): "green" | "amber" | "rose" | "gold" | "neutral" =>
  status === "confirmed" ? "green" : ["awaiting_payment", "pending_deposit", "requested"].includes(status) ? "amber" : "gold";

const professionalDateTime = (value: unknown) =>
  value ? new Date(String(value)).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "-";

const professionalMoney = (value: unknown) =>
  Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function ProfessionalArea() {
  const path = useLocation().pathname;
  const navigate = useNavigate();
  let page;
  if (["/profissional", "/profissional/", "/profissional/dashboard", "/profissional/hoje"].includes(path))
    page = <ProfessionalDashboardPage />;
  else if (path.match(/\/agenda\/[^/]+$/))
    page = <ProfessionalAppointmentDetailPage />;
  else if (path.includes("/agenda")) page = <ProfessionalAgenda />;
  else if (path.match(/\/clientes\/[^/]+$/))
    page = <ProfessionalClientDetailPage />;
  else if (path.includes("/clientes")) page = <ProfessionalClients />;
  else if (path.includes("/fichas")) page = <ProfessionalRecordsPage />;
  else if (
    path.includes("/comissao") ||
    path.includes("/comissoes") ||
    path.includes("/desempenho")
  )
    page = <ProfessionalCommissionsPage />;
  else if (path.includes("/servicos")) page = <ProfessionalServicesPage />;
  else if (path.includes("/disponibilidade"))
    page = <ProfessionalAvailabilityPage />;
  else if (path.includes("/perfil")) page = <ProfessionalProfilePage />;
  else
    page = (
      <EmptyState
        title="Página não encontrada"
        text="Este endereço não existe na área profissional."
        action={
          <button
            onClick={() => navigate("/profissional/dashboard")}
            className="btn-primary"
          >
            Voltar ao dashboard
          </button>
        }
      />
    );
  return (
    <AppShell role="profissional">
      <ProfessionalNewAppointmentsModal />
      {page}
    </AppShell>
  );
}

function ProfessionalNewAppointmentsModal() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Array<Record<string, any>>>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    apiFetch<{ data?: { appointments?: Array<Record<string, any>> }; appointments?: Array<Record<string, any>> }>(
      "/api/portal?resource=professional-new-appointments",
    )
      .then((result) => {
        if (!alive) return;
        const appointments = result.data?.appointments || result.appointments || [];
        setItems(appointments);
        if (!appointments.length) return;
        const signature = appointments.map((item) => item.id).sort().join("|");
        const storageKey = "professional-new-appointments-modal";
        if (sessionStorage.getItem(storageKey) !== signature) {
          sessionStorage.setItem(storageKey, signature);
          setOpen(true);
        }
      })
      .catch((error) => console.error("Professional new appointments modal error", error));
    return () => {
      alive = false;
    };
  }, []);

  if (!items.length) return null;

  const openAppointment = (id: string) => {
    setOpen(false);
    navigate(`/profissional/agenda/${id}`);
  };

  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Novos agendamentos">
      <div className="space-y-3">
        <p className="muted text-sm">
          Confira os agendamentos recebidos recentemente e acompanhe os detalhes pelo painel.
        </p>
        {items.map((item) => (
          <div key={item.id} className="rounded-2xl border border-black/5 bg-white p-4">
            <div className="flex items-start gap-3">
              <Avatar src={item.avatar_url} name={item.client} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <b className="text-sm">{item.client || "Cliente"}</b>
                  <Badge tone={professionalAppointmentTone(item.status)}>
                    {professionalAppointmentLabel[item.status] || item.status}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-stone-500">{item.service || "Serviço"} • {professionalDateTime(item.starts_at)}</p>
                <div className="mt-3 grid gap-2 text-xs text-stone-600 sm:grid-cols-2">
                  <span>Valor: <b className="text-ink">{professionalMoney(item.estimated_value)}</b></span>
                  {item.payment_amount ? <span>Sinal: <b className="text-ink">{professionalMoney(item.payment_amount)}</b></span> : null}
                  {item.client_phone ? <span>Telefone: <b className="text-ink">{item.client_phone}</b></span> : null}
                  {item.booking_code ? <span>Protocolo: <b className="text-ink">{item.booking_code}</b></span> : null}
                </div>
              </div>
            </div>
            <button type="button" className="btn-primary mt-4 w-full justify-center" onClick={() => openAppointment(item.id)}>
              Abrir agendamento
            </button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function Status({ value }: { value: string }) {
  const tone =
    value === "Confirmado"
      ? "green"
      : [
            "Solicitado",
            "Aguardando pagamento",
            "Aguardando sinal",
            "Reagendamento solicitado",
          ].includes(value)
        ? "amber"
        : value === "Em atendimento"
          ? "gold"
          : value === "Finalizado"
            ? "neutral"
            : "rose";
  return <Badge tone={tone}>{value}</Badge>;
}

function ProfessionalRescheduleRequests() {
  const [items, setItems] = useState<Array<Record<string, any>>>([]);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [suggestingId, setSuggestingId] = useState("");
  const [suggestingDate, setSuggestingDate] = useState("");
  const [suggestingTime, setSuggestingTime] = useState("");
  const [suggestingSlots, setSuggestingSlots] = useState<Record<string, boolean>>({});
  const [loadingSlots, setLoadingSlots] = useState(false);

  const load = () =>
    apiFetch<{ requests: Array<Record<string, any>> }>(
      "/api/data?resource=reschedule-requests",
    ).then((data) =>
      setItems(
        (data.requests || []).filter((item) => item.status === "pending"),
      ),
    );

  useEffect(() => {
    load().catch((error) => console.error("Reschedule requests error", error));
  }, []);

  useEffect(() => {
    if (!suggestingId || !suggestingDate) return;
    const request = items.find((x) => x.id === suggestingId);
    if (!request) return;
    const controller = new AbortController();
    setSuggestingSlots({});
    setSuggestingTime("");
    setLoadingSlots(true);
    const params = new URLSearchParams({
      resource: "availability",
      date: suggestingDate,
      serviceId: String(request.service_id),
      professionalId: String(request.professional_id),
    });
    apiFetch<{ slots: Array<{ time: string; available: boolean }> }>(
      `/api/data?${params}`,
      { signal: controller.signal },
    )
      .then((data) => {
        const slots = Object.fromEntries(
          data.slots.map((x) => [x.time, x.available]),
        );
        setSuggestingSlots(slots);
        const first = data.slots.find((x) => x.available);
        setSuggestingTime(first?.time || "");
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.error("Suggest slots error", error);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingSlots(false);
      });
    return () => controller.abort();
  }, [suggestingId, suggestingDate, items]);

  const respond = async (id: string, action: "accept" | "reject") => {
    setBusy(id);
    try {
      await apiFetch("/api/data?resource=reschedule-requests", {
        method: "PATCH",
        body: JSON.stringify({ id, action }),
      });
      await load();
      setMessage(
        action === "accept"
          ? "Reagendamento aceito e agenda atualizada."
          : "Solicitação recusada e cliente notificada.",
      );
    } catch (error) {
      console.error("Reschedule response error", error);
      setMessage(
        error instanceof Error ? error.message : "Não foi possível responder.",
      );
    } finally {
      setBusy("");
      setTimeout(() => setMessage(""), 2600);
    }
  };

  const sendSuggestion = async (id: string) => {
    if (!suggestingDate || !suggestingTime) return;
    setBusy(id);
    try {
      await apiFetch("/api/data?resource=reschedule-requests", {
        method: "PATCH",
        body: JSON.stringify({
          id,
          action: "suggest",
          startsAt: `${suggestingDate}T${suggestingTime}:00-03:00`,
        }),
      });
      await load();
      setSuggestingId("");
      setMessage("Sugestão de horário enviada com sucesso.");
    } catch (error) {
      console.error("Suggest response error", error);
      setMessage(
        error instanceof Error ? error.message : "Não foi possível sugerir.",
      );
    } finally {
      setBusy("");
      setTimeout(() => setMessage(""), 2600);
    }
  };

  if (!items.length && !message) return null;
  return (
    <section className="surface mb-5 p-6">
      <SectionHeading title="Solicitações de reagendamento" />
      {message && (
        <div className="mb-4 rounded-xl bg-warm p-3 text-xs font-semibold">
          {message}
        </div>
      )}
      {items.map((item) => (
        <div
          key={item.id}
          className="grid gap-3 border-t border-black/5 py-4 sm:grid-cols-[1fr_.8fr_auto]"
        >
          <span>
            <b className="block text-xs">{item.client}</b>
            <small className="text-stone-400">{item.service}</small>
          </span>
          <span className="text-[10px] text-stone-500">
            De {new Date(item.old_starts_at).toLocaleString("pt-BR")}
            <br />
            Para {new Date(item.requested_starts_at).toLocaleString("pt-BR")}
          </span>
          <span className="flex flex-wrap gap-2">
            <button
              disabled={busy === item.id}
              onClick={() => respond(item.id, "accept")}
              className="btn-primary !min-h-9 !px-3"
            >
              <Check size={14} />
              Aceitar
            </button>
            <button
              disabled={busy === item.id}
              onClick={() => respond(item.id, "reject")}
              className="btn-secondary !min-h-9 !px-3"
            >
              <X size={14} />
              Recusar
            </button>
            <button
              disabled={busy === item.id}
              onClick={() => {
                setSuggestingId(suggestingId === item.id ? "" : item.id);
                setSuggestingDate(new Date(Date.now() + 86400000).toISOString().slice(0, 10));
                setSuggestingTime("");
                setSuggestingSlots({});
              }}
              className="btn-secondary !min-h-9 !px-3 text-champagne border-champagne/30"
            >
              Sugerir horário
            </button>
          </span>
          {suggestingId === item.id && (
            <div className="col-span-full border-t border-black/5 mt-3 pt-3 space-y-3 bg-warm/30 p-3 rounded-xl animate-fade-down">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-[11px] font-bold text-stone-500">
                  Selecione a data
                  <input
                    type="date"
                    min={new Date(Date.now() + 86400000).toISOString().slice(0, 10)}
                    value={suggestingDate}
                    onChange={(e) => setSuggestingDate(e.target.value)}
                    className="field mt-1"
                  />
                </label>
                <div>
                  <span className="block text-[11px] font-bold text-stone-500 mb-1">
                    Horários disponíveis
                  </span>
                  {loadingSlots ? (
                    <small className="text-stone-400">Consultando agenda...</small>
                  ) : Object.keys(suggestingSlots).length > 0 ? (
                    <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                      {Object.entries(suggestingSlots).map(([time, available]) => (
                        <button
                          key={time}
                          type="button"
                          disabled={!available}
                          onClick={() => setSuggestingTime(time)}
                          className={`rounded-lg border px-2 py-1 text-[10px] font-bold disabled:opacity-35 ${suggestingTime === time ? "border-champagne bg-champagne/10 text-champagne" : "border-black/10 bg-white"}`}
                        >
                          {time}
                        </button>
                      ))}
                    </div>
                  ) : (
                    suggestingDate && <small className="text-rose-600 font-semibold">Nenhum horário disponível nesta data.</small>
                  )}
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSuggestingId("")}
                  className="btn-secondary !min-h-8 !px-3 text-[11px]"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={busy === item.id || !suggestingTime}
                  onClick={() => sendSuggestion(item.id)}
                  className="btn-primary !min-h-8 !px-3 text-[11px]"
                >
                  Confirmar Sugestão
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

function ProfessionalAgenda() {
  const [view, setView] = useState("Mês");
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [updating, setUpdating] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState(false);
  const [toastMessage, setToastMessage] = useState("Agenda atualizada");
  const [remote, setRemote] = useState<Array<Record<string, any>>>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedIntake, setSelectedIntake] = useState<any>(null);
  const [selectedIntakeClient, setSelectedIntakeClient] = useState("");
  const [appointmentOpen, setAppointmentOpen] = useState(false);
  const [appointmentSaving, setAppointmentSaving] = useState(false);
  const [appointmentForm, setAppointmentForm] = useState({
    clientId: "",
    serviceId: "",
    professionalId: "",
    date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    time: "09:00",
    status: "confirmed",
    notes: "",
    paymentMethod: "pix",
  });
  const [clientsList, setClientsList] = useState<any[]>([]);
  const [servicesList, setServicesList] = useState<any[]>([]);
  const [professionalsList, setProfessionalsList] = useState<any[]>([]);
  const [locationsList, setLocationsList] = useState<any[]>([]);

  useEffect(() => {
    if (!appointmentOpen) return;
    apiFetch<{ clients: any[] }>("/api/data?resource=clients")
      .then((data) => setClientsList(data.clients || []))
      .catch((err) => console.error("Error loading clients", err));

    apiFetch<any>("/api/data?resource=bootstrap")
      .then((data) => {
        setServicesList(data.services || []);
        setProfessionalsList(data.professionals || []);
        setLocationsList(data.locations || []);
        if (data.professionals && data.professionals.length > 0) {
          setAppointmentForm(prev => ({ ...prev, professionalId: prev.professionalId || data.professionals[0].id }));
        }
      })
      .catch((err) => console.error("Error loading bootstrap data", err));
  }, [appointmentOpen]);

  const saveAppointment = async (event: FormEvent) => {
    event.preventDefault();
    setAppointmentSaving(true);
    const payload = {
      clientId: appointmentForm.clientId,
      serviceId: appointmentForm.serviceId,
      professionalId: appointmentForm.professionalId,
      startsAt: `${appointmentForm.date}T${appointmentForm.time}:00-03:00`,
      status: appointmentForm.status,
      notes: appointmentForm.notes,
      paymentMethod: appointmentForm.paymentMethod,
    };
    try {
      await apiFetch("/api/data?resource=appointments", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const data = await apiFetch<{ appointments: Array<Record<string, any>> }>(periodUrl);
      setRemote(data.appointments || []);
      setAppointmentOpen(false);
      setAppointmentForm({
        clientId: "",
        serviceId: "",
        professionalId: professionalsList[0]?.id || "",
        date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
        time: "09:00",
        status: "confirmed",
        notes: "",
        paymentMethod: "pix",
      });
      setToastMessage("Agendamento criado com sucesso.");
      setToast(true);
      setTimeout(() => setToast(false), 2400);
    } catch (e) {
      console.error("Save appointment error", e);
      setToastMessage(e instanceof Error ? e.message : "Não foi possível criar o agendamento.");
      setToast(true);
      setTimeout(() => setToast(false), 2400);
    } finally {
      setAppointmentSaving(false);
    }
  };

  const labelMap: Record<string, string> = {
    requested: "Solicitado",
    awaiting_payment: "Aguardando pagamento",
    confirmed: "Confirmado",
    pending_deposit: "Aguardando sinal",
    reschedule_requested: "Reagendamento solicitado",
    in_service: "Em atendimento",
    completed: "Finalizado",
    cancelled: "Cancelado",
    no_show: "Faltou",
    rescheduled: "Reagendado",
  };
  const apiMap: Record<string, string> = Object.fromEntries(
    Object.entries(labelMap).map(([key, value]) => [value, key]),
  );
  const statusOptions = Object.entries(labelMap).map(([value, label]) => ({
    value,
    label,
  }));
  const period = useMemo(() => {
    const start = new Date(anchorDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    if (view === "Semana") {
      start.setDate(start.getDate() - start.getDay());
      end.setTime(start.getTime());
      end.setDate(end.getDate() + 7);
    } else if (view === "Mês") {
      start.setDate(1);
      end.setFullYear(start.getFullYear(), start.getMonth() + 1, 1);
    } else {
      end.setDate(end.getDate() + 1);
    }
    return { start, end };
  }, [anchorDate, view]);
  const periodUrl = useMemo(() => {
    const dateKey = (value: Date) =>
      [
        value.getFullYear(),
        String(value.getMonth() + 1).padStart(2, "0"),
        String(value.getDate()).padStart(2, "0"),
      ].join("-");
    const params = new URLSearchParams({
      resource: "appointments",
      dateFrom: dateKey(period.start),
      dateTo: dateKey(period.end),
    });
    return `/api/data?${params}`;
  }, [period]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError("");
    apiFetch<{ appointments: Array<Record<string, any>> }>(periodUrl, {
      signal: controller.signal,
    })
      .then((data) => setRemote(data.appointments || []))
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.error("Professional agenda error", error);
        setLoadError(
          error instanceof Error
            ? error.message
            : "Não foi possível carregar a agenda.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [periodUrl]);
  const agendaItems: Array<Record<string, any>> = remote
    .sort(
      (left, right) =>
        new Date(String(left.starts_at)).getTime() -
        new Date(String(right.starts_at)).getTime(),
    )
    .map((a) => ({
        ...a,
        client: a.client,
        service: a.service,
        duration: a.duration,
        status: labelMap[a.status] || a.status,
        value: a.value,
        photo: a.client_avatar_url,
      }));
  const periodLabel =
    view === "Mês"
      ? anchorDate.toLocaleDateString("pt-BR", {
          month: "long",
          year: "numeric",
        })
      : view === "Semana"
        ? `${period.start.toLocaleDateString("pt-BR")} – ${new Date(period.end.getTime() - 1).toLocaleDateString("pt-BR")}`
        : anchorDate.toLocaleDateString("pt-BR", {
            day: "2-digit",
            month: "long",
            year: "numeric",
          });
  const movePeriod = (direction: -1 | 1) => {
    setAnchorDate((current) => {
      const next = new Date(current);
      if (view === "Mês") next.setMonth(next.getMonth() + direction);
      else next.setDate(next.getDate() + direction * (view === "Semana" ? 7 : 1));
      return next;
    });
  };
  const updateAppointmentStatus = async (id: string, status: string) => {
    if (!id) return;
    setUpdating((current) => ({
      ...current,
      [id]: true,
    }));
    try {
      const result = await apiFetch<{
        appointment: { id: string; status: string };
      }>("/api/data?resource=appointments", {
        method: "PATCH",
        body: JSON.stringify({ id, status }),
      });
      setRemote((current) =>
        current.map((item) =>
          item.id === result.appointment.id
            ? { ...item, status: result.appointment.status }
            : item,
        ),
      );
      setToastMessage("Agendamento atualizado com sucesso.");
    } catch (error) {
      console.error("Appointment status error", error);
      setToastMessage(
        error instanceof Error
          ? error.message
          : "Não foi possível atualizar o status.",
      );
    } finally {
      setUpdating((current) => ({
        ...current,
        [id]: false,
      }));
      setToast(true);
      setTimeout(() => setToast(false), 2400);
    }
  };
  return (
    <div className="animate-fade-up">
      <Toast show={toast} message={toastMessage} />
      <PageHeader
        eyebrow="GESTÃO DE TEMPO"
        title="Agenda profissional"
        subtitle="Organize atendimentos, bloqueios e encaixes sem perder o ritmo do salão."
        action={
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setAppointmentOpen(true)} className="btn-primary">
              <Plus size={15} />
              Novo Agendamento
            </button>
            <a href="/profissional/disponibilidade" className="btn-secondary">
              <X size={16} />
              Bloquear horário
            </a>
          </div>
        }
      />
      <ProfessionalRescheduleRequests />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-2xl bg-warm p-1">
          {["Dia", "Semana", "Mês"].map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-xl px-5 py-2 text-xs font-bold ${view === v ? "bg-white shadow-sm" : "text-stone-400"}`}
            >
              {v}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Período anterior"
            onClick={() => movePeriod(-1)}
            className="btn-secondary !min-h-10 !px-3"
          >
            ‹
          </button>
          <div className="text-sm font-bold capitalize">{periodLabel}</div>
          <button
            type="button"
            aria-label="Próximo período"
            onClick={() => movePeriod(1)}
            className="btn-secondary !min-h-10 !px-3"
          >
            ›
          </button>
        </div>
      </div>
      <div className="mb-5">
        <AppointmentCalendar
          month={anchorDate}
          items={remote as any}
          statusLabels={labelMap}
          statusOptions={statusOptions}
          updatingId={
            Object.entries(updating).find(([, value]) => value)?.[0] || ""
          }
          onStatusChange={updateAppointmentStatus}
        />
      </div>
      <section className="surface overflow-hidden">
        <div className="grid grid-cols-[64px_1fr] border-b border-black/[.05] bg-warm/60 p-4 text-[10px] font-bold uppercase tracking-wider text-stone-400">
          <span>Hora</span>
          <span>Atendimento</span>
        </div>
        {loading ? (
          <div className="p-10 text-center text-xs text-stone-400">
            Carregando agenda…
          </div>
        ) : loadError ? (
          <div className="p-10 text-center text-xs font-semibold text-rose-700">
            {loadError}
          </div>
        ) : agendaItems.length ? (
          agendaItems.map((a, i) => {
            const statusKey = String(a.id || i);
            const s = a.status;
            return (
              <div
                key={statusKey}
                className="grid grid-cols-[64px_1fr] border-b border-black/[.05] last:border-0"
              >
                <div className="border-r border-black/[.05] p-4 text-xs font-bold">
                  {a.time}
                </div>
                <div className="m-2 flex flex-col gap-3 rounded-2xl bg-warm/60 p-4 sm:flex-row sm:items-center">
                  <Avatar src={a.photo} name={a.client} />
                  <div className="min-w-0 flex-1">
                    <a
                      href={`/profissional/agenda/${a.id}`}
                      className="text-xs font-bold text-champagne hover:underline block"
                    >
                      {a.client}
                    </a>
                    <div className="mt-1 text-[10px] text-stone-400">
                      {a.service} • {a.duration} • {a.value}
                    </div>
                    {a.intake_data && a.intake_data.answers && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedIntake(a.intake_data);
                          setSelectedIntakeClient(a.client);
                        }}
                        className="mt-1 block text-[10px] font-bold text-champagne hover:underline text-left"
                      >
                        [Ver Diagnóstico]
                      </button>
                    )}
                  </div>
                  <Status value={s} />
                  <select
                    disabled={updating[statusKey]}
                    value={s}
                    onChange={async (e) => {
                      const next = e.target.value;
                      setUpdating((current) => ({
                        ...current,
                        [statusKey]: true,
                      }));
                      try {
                        if (a.id) {
                          const result = await apiFetch<{
                            appointment: { id: string; status: string };
                          }>("/api/data?resource=appointments", {
                            method: "PATCH",
                            body: JSON.stringify({
                              id: a.id,
                              status: apiMap[next],
                            }),
                          });
                          setRemote((current) =>
                            current.map((item) =>
                              item.id === result.appointment.id
                                ? { ...item, status: result.appointment.status }
                                : item,
                            ),
                          );
                        }
                        setToastMessage("Agendamento atualizado com sucesso.");
                      } catch (error) {
                        console.error("Appointment status error", error);
                        setToastMessage(
                          error instanceof Error
                            ? error.message
                            : "Não foi possível atualizar o status.",
                        );
                      } finally {
                        setUpdating((current) => ({
                          ...current,
                          [statusKey]: false,
                        }));
                        setToast(true);
                        setTimeout(() => setToast(false), 2400);
                      }
                    }}
                    className="rounded-xl border border-black/[.07] bg-white px-3 py-2 text-[10px] font-semibold outline-none disabled:opacity-50"
                  >
                    <option>Solicitado</option>
                    <option>Aguardando pagamento</option>
                    <option>Confirmado</option>
                    <option>Aguardando sinal</option>
                    <option>Reagendamento solicitado</option>
                    <option>Em atendimento</option>
                    <option>Finalizado</option>
                    <option>Cancelado</option>
                    <option>Faltou</option>
                    <option>Reagendado</option>
                  </select>
                </div>
              </div>
            );
          })
        ) : (
          <div className="p-10 text-center text-xs text-stone-400">
            Nenhum agendamento encontrado neste período.
          </div>
        )}
      </section>
      <Modal
        open={appointmentOpen}
        onClose={() => {
          if (!appointmentSaving) setAppointmentOpen(false);
        }}
        title="Novo Agendamento"
      >
        <form onSubmit={saveAppointment} className="space-y-4">
          <label className="block text-stone-700">
            <span className="mb-2 block text-xs font-bold font-sans">Cliente</span>
            <select
              value={appointmentForm.clientId}
              onChange={(e) => setAppointmentForm({ ...appointmentForm, clientId: e.target.value })}
              required
              className="field bg-white"
            >
              <option value="">Selecione a cliente...</option>
              {clientsList.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.phone || c.email})
                </option>
              ))}
            </select>
          </label>

          <label className="block text-stone-700">
            <span className="mb-2 block text-xs font-bold font-sans">Serviço</span>
            <select
              value={appointmentForm.serviceId}
              onChange={(e) => setAppointmentForm({ ...appointmentForm, serviceId: e.target.value })}
              required
              className="field bg-white"
            >
              <option value="">Selecione o serviço...</option>
              {servicesList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} - {Number(s.base_price || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} ({s.duration_minutes} min)
                </option>
              ))}
            </select>
          </label>

          <label className="block text-stone-700">
            <span className="mb-2 block text-xs font-bold font-sans">Profissional</span>
            <select
              value={appointmentForm.professionalId}
              onChange={(e) => setAppointmentForm({ ...appointmentForm, professionalId: e.target.value })}
              required
              className="field bg-white"
            >
              <option value="">Selecione a profissional...</option>
              {professionalsList.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-stone-700">
              <span className="mb-2 block text-xs font-bold font-sans">Data</span>
              <input
                type="date"
                value={appointmentForm.date}
                onChange={(e) => setAppointmentForm({ ...appointmentForm, date: e.target.value })}
                required
                className="field bg-white"
              />
            </label>
            <label className="block text-stone-700">
              <span className="mb-2 block text-xs font-bold font-sans">Horário</span>
              <input
                type="time"
                value={appointmentForm.time}
                onChange={(e) => setAppointmentForm({ ...appointmentForm, time: e.target.value })}
                required
                className="field bg-white"
              />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-stone-700">
              <span className="mb-2 block text-xs font-bold font-sans">Status Inicial</span>
              <select
                value={appointmentForm.status}
                onChange={(e) => setAppointmentForm({ ...appointmentForm, status: e.target.value })}
                className="field bg-white"
              >
                <option value="confirmed">Confirmado</option>
                <option value="pending_deposit">Aguardando Sinal</option>
                <option value="requested">Solicitado</option>
              </select>
            </label>
            <label className="block text-stone-700">
              <span className="mb-2 block text-xs font-bold font-sans">Forma de Pagamento (Sinal)</span>
              <select
                value={appointmentForm.paymentMethod}
                onChange={(e) => setAppointmentForm({ ...appointmentForm, paymentMethod: e.target.value })}
                className="field bg-white"
              >
                <option value="pix">Pix</option>
                <option value="card">Cartão de Crédito (SumUp)</option>
                <option value="local">Pagar no local</option>
              </select>
            </label>
          </div>

          <label className="block text-stone-700">
            <span className="mb-2 block text-xs font-bold font-sans">Observações</span>
            <textarea
              value={appointmentForm.notes}
              onChange={(e) => setAppointmentForm({ ...appointmentForm, notes: e.target.value })}
              className="field min-h-20 py-2 bg-white"
              placeholder="Anotações internas sobre o agendamento"
            />
          </label>

          <button
            disabled={appointmentSaving || !appointmentForm.clientId || !appointmentForm.serviceId || !appointmentForm.professionalId}
            className="btn-primary w-full disabled:opacity-50"
          >
            {appointmentSaving ? "Salvando..." : "Salvar Agendamento"}
          </button>
        </form>
      </Modal>
      <IntakeDetailsModal
        open={!!selectedIntake}
        onClose={() => {
          setSelectedIntake(null);
          setSelectedIntakeClient("");
        }}
        intakeData={selectedIntake}
        clientName={selectedIntakeClient}
      />
    </div>
  );
}

function ProfessionalClients() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [remote, setRemote] = useState<Array<Record<string, any>>>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [form, setForm] = useState({
    fullName: "",
    whatsapp: "",
    email: "",
    cpf: "",
    birthDate: "",
    notes: "",
    password: "",
  });

  useEffect(() => {
    apiFetch<{ clients: Array<Record<string, any>> }>(
      "/api/data?resource=clients",
    )
      .then((data) => setRemote(data.clients))
      .catch((error) => console.error("Professional clients error", error))
      .finally(() => setLoaded(true));
  }, []);

  const createClient = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await apiFetch("/api/portal?resource=admin-client", {
        method: "POST",
        body: JSON.stringify(form),
      });
      const data = await apiFetch<{ clients: Array<Record<string, any>> }>(
        "/api/data?resource=clients",
      );
      setRemote(data.clients || []);
      setOpen(false);
      setForm({
        fullName: "",
        whatsapp: "",
        email: "",
        cpf: "",
        birthDate: "",
        notes: "",
        password: "",
      });
      setToast("Cliente cadastrada com sucesso.");
    } catch (error) {
      console.error("Create client error", error);
      setToast(
        error instanceof Error ? error.message : "Não foi possível cadastrar a cliente.",
      );
    } finally {
      setSaving(false);
      setTimeout(() => setToast(""), 2600);
    }
  };

  const filtered = remote.filter((c) =>
    String(c.name).toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="animate-fade-up">
      <Toast show={!!toast} message={toast} />
      <PageHeader
        eyebrow="RELACIONAMENTO"
        title="Suas clientes"
        subtitle="Informações importantes para um atendimento atento e consistente."
        action={
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setOpen(true)} className="btn-primary">
              <Plus size={15} />
              Novo Cliente
            </button>
            <div className="relative">
              <Search
                className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400"
                size={16}
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="field pl-11 sm:w-72"
                placeholder="Buscar cliente"
              />
            </div>
          </div>
        }
      />
      {!loaded ? (
        <div className="surface p-8 text-center text-xs text-stone-400">
          Carregando clientes…
        </div>
      ) : filtered.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((c) => (
            <button
              key={c.id || c.name}
              onClick={() => navigate(`/profissional/clientes/${c.id}`)}
              className="surface p-5 text-left transition hover:-translate-y-1"
            >
              <div className="flex items-center gap-3">
                <Avatar src={c.avatar_url} name={c.name} size="lg" />
                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-display text-2xl font-semibold">
                    {c.name}
                  </h3>
                  <p className="text-[10px] text-stone-400">
                    {c.phone || "Telefone não informado"}
                  </p>
                </div>
                <Badge
                  tone={c.account_status === "active" ? "green" : "neutral"}
                >
                  {c.account_status === "active" ? "Ativa" : "Inativa"}
                </Badge>
              </div>
              <div className="mt-5 grid grid-cols-3 rounded-2xl bg-warm p-4 text-center">
                <div>
                  <b className="text-xs">
                    {c.last_appointment
                      ? new Date(c.last_appointment).toLocaleDateString("pt-BR")
                      : "—"}
                  </b>
                  <span className="mt-1 block text-[8px] text-stone-400">
                    Última visita
                  </span>
                </div>
                <div className="border-x border-black/[.06]">
                  <b className="text-xs">
                    {Number(c.lifetime_value || 0).toLocaleString("pt-BR", {
                      style: "currency",
                      currency: "BRL",
                    })}
                  </b>
                  <span className="mt-1 block text-[8px] text-stone-400">
                    Valor acumulado
                  </span>
                </div>
                <div>
                  <b className="text-xs">{c.points || 0}</b>
                  <span className="mt-1 block text-[8px] text-stone-400">
                    Pontos
                  </span>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between text-[10px] text-stone-400">
                <span>
                  Próxima:{" "}
                  {c.next_appointment
                    ? new Date(c.next_appointment).toLocaleDateString("pt-BR")
                    : "—"}
                </span>
                <span className="font-bold text-champagne">Ver ficha →</span>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="surface p-8 text-center">
          <h3 className="font-display text-2xl">Nenhuma cliente vinculada</h3>
          <p className="muted mt-2">
            Somente clientes com atendimento atribuído aparecem aqui.
          </p>
        </div>
      )}

      <Modal
        open={open}
        onClose={() => {
          if (!saving) setOpen(false);
        }}
        title="Novo Cliente"
      >
        <form onSubmit={createClient} className="space-y-4">
          <Input
            label="Nome completo"
            value={form.fullName}
            set={(value) => setForm({ ...form, fullName: value })}
          />
          <Input
            label="WhatsApp"
            value={form.whatsapp}
            set={(value) => setForm({ ...form, whatsapp: value })}
          />
          <Input
            label="E-mail"
            type="email"
            value={form.email}
            set={(value) => setForm({ ...form, email: value })}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <OptionalInput
              label="CPF"
              value={form.cpf}
              set={(value) => setForm({ ...form, cpf: value })}
            />
            <OptionalInput
              label="Data de nascimento"
              type="date"
              value={form.birthDate}
              set={(value) => setForm({ ...form, birthDate: value })}
            />
          </div>
          <Input
            label="Senha de acesso"
            type="password"
            value={form.password}
            set={(value) => setForm({ ...form, password: value })}
          />
          <label className="block text-stone-700">
            <span className="mb-2 block text-xs font-bold font-sans">Observações</span>
            <textarea
              className="field min-h-24 py-3 bg-white"
              value={form.notes}
              onChange={(event) =>
                setForm({ ...form, notes: event.target.value })
              }
            />
          </label>
          <button
            disabled={saving || !form.fullName.trim() || !form.email.trim()}
            className="btn-primary w-full disabled:opacity-50"
          >
            {saving ? "Salvando..." : "Salvar cliente"}
          </button>
        </form>
      </Modal>
    </div>
  );
}

function Performance() {
  return (
    <div className="animate-fade-up">
      <PageHeader
        eyebrow="RESULTADOS"
        title="Comissão e desempenho"
        subtitle="Acompanhe seus números e identifique as melhores oportunidades do mês."
        action={
          <button className="btn-secondary">
            <Download size={16} />
            Exportar extrato
          </button>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Comissão em junho"
          value="R$ 5.526"
          trend="+12,4% vs. maio"
          icon={<BadgeDollarSign size={19} />}
          tone="dark"
        />
        <StatCard
          label="Ticket médio"
          value="R$ 768"
          trend="+R$ 82 neste mês"
          icon={<TrendingUp size={19} />}
        />
        <StatCard
          label="Produtos vendidos"
          value="R$ 2.480"
          trend="18 kits Home Care"
          icon={<Package size={19} />}
        />
        <StatCard
          label="Clientes recorrentes"
          value="68%"
          trend="Meta: 72%"
          icon={<UserCheck size={19} />}
        />
      </div>
      <div className="mt-6 grid gap-5 xl:grid-cols-[1.3fr_.7fr]">
        <section className="surface p-6">
          <SectionHeading title="Evolução mensal" link="Últimos 6 meses" />
          <div className="mt-8 flex h-64 items-end gap-3 border-b border-black/[.06]">
            {[
              ["Jan", 46],
              ["Fev", 58],
              ["Mar", 52],
              ["Abr", 70],
              ["Mai", 76],
              ["Jun", 88],
            ].map(([m, h]) => (
              <div key={m} className="flex flex-1 flex-col items-center gap-2">
                <div
                  className="relative flex w-full items-end justify-center"
                  style={{ height: "210px" }}
                >
                  <div
                    className="w-full max-w-12 rounded-t-xl bg-gradient-to-t from-[#9e762e] to-[#dec17e]"
                    style={{ height: `${h}%` }}
                  />
                  <span className="absolute -top-5 text-[9px] font-bold">
                    {h}%
                  </span>
                </div>
                <span className="text-[9px] text-stone-400">{m}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="surface p-6">
          <SectionHeading title="Meta do mês" />
          <div className="mx-auto mt-6 grid h-44 w-44 place-items-center rounded-full progress-ring">
            <div className="grid h-32 w-32 place-items-center rounded-full bg-white text-center">
              <div>
                <b className="font-display text-4xl">74%</b>
                <span className="block text-[9px] text-stone-400">
                  R$ 18.420 / R$ 25.000
                </span>
              </div>
            </div>
          </div>
          <div className="mt-6 flex justify-between rounded-2xl bg-warm p-4 text-xs">
            <span className="text-stone-500">Faltam</span>
            <b>R$ 6.580</b>
          </div>
        </section>
      </div>
    </div>
  );
}

function ProfessionalServices() {
  return (
    <div className="animate-fade-up">
      <PageHeader
        eyebrow="PORTFÓLIO"
        title="Seus serviços"
        subtitle="Procedimentos habilitados, duração, comissão e disponibilidade."
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[
          ["Fita Adesiva", "3h30", "30%", "Ativo"],
          ["Microlink", "4h", "30%", "Ativo"],
          ["Manutenção", "2h30", "35%", "Ativo"],
          ["Avaliação", "45min", "40%", "Ativo"],
          ["Remoção segura", "1h30", "30%", "Ativo"],
          ["Queratina", "5h", "—", "Em treinamento"],
        ].map((x) => (
          <div key={x[0]} className="surface p-6">
            <div className="flex justify-between">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-warm text-champagne">
                <Sparkles size={19} />
              </span>
              <Badge tone={x[3] === "Ativo" ? "green" : "amber"}>{x[3]}</Badge>
            </div>
            <h3 className="mt-4 font-display text-3xl font-semibold">{x[0]}</h3>
            <div className="mt-5 grid grid-cols-2 rounded-2xl bg-warm p-4 text-xs">
              <span>
                <span className="block text-[9px] text-stone-400">Duração</span>
                <b>{x[1]}</b>
              </span>
              <span>
                <span className="block text-[9px] text-stone-400">
                  Comissão
                </span>
                <b>{x[2]}</b>
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
function ProfessionalProfile() {
  return (
    <div className="animate-fade-up">
      <PageHeader
        eyebrow="PERFIL PROFISSIONAL"
        title="Juliana Almeida"
        subtitle="Especialista em extensões • Unidade Jardins"
        action={
          <button className="btn-secondary">
            <Pencil size={16} />
            Editar perfil
          </button>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
        <div className="surface p-7 text-center">
          <Avatar src={images.stylist2} name="Juliana Almeida" size="lg" />
          <h2 className="mt-4 font-display text-3xl font-semibold">
            Juliana Almeida
          </h2>
          <p className="text-xs text-stone-400">
            Profissional sênior desde 2022
          </p>
          <div className="mt-5 flex justify-center gap-1 text-champagne">
            <Star fill="currentColor" size={16} />
            <b className="text-xs text-ink">4,9</b>
            <span className="text-[10px] text-stone-400">(284 avaliações)</span>
          </div>
        </div>
        <div className="surface p-6">
          <SectionHeading title="Preferências de trabalho" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Info label="Unidade padrão" value="Carol Sol Jardins" />
            <Info label="Jornada" value="Terça a sábado • 09h–19h" />
            <Info label="Comissão base" value="30% em serviços" />
            <Info label="Especialidades" value="Fita Adesiva, Microlink" />
          </div>
        </div>
      </div>
    </div>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-warm p-4">
      <span className="text-[9px] font-bold uppercase tracking-wider text-stone-400">
        {label}
      </span>
      <b className="mt-2 block text-xs">{value}</b>
    </div>
  );
}

function Input({
  label,
  value,
  set,
  type = "text",
  required = true,
}: {
  label: string;
  value: string;
  set: (v: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block text-stone-700">
      <span className="mb-2 block text-xs font-bold">{label}</span>
      <input
        className="field bg-white"
        required={required}
        type={type}
        value={value}
        onChange={(e) => set(e.target.value)}
      />
    </label>
  );
}

function OptionalInput({
  label,
  value,
  set,
  type = "text",
  required = false,
}: {
  label: string;
  value: string;
  set: (v: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block text-stone-700">
      <span className="mb-2 block text-xs font-bold">{label}</span>
      <input
        className="field bg-white"
        required={required}
        type={type}
        value={value}
        onChange={(e) => set(e.target.value)}
      />
    </label>
  );
}
