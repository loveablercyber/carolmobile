import { FormEvent, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Archive,
  ArrowUpDown,
  BarChart3,
  Boxes,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Check,
  CircleDollarSign,
  CreditCard,
  Download,
  LayoutGrid,
  List,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldAlert,
  Tag,
  Trash2,
  Users,
  WalletCards,
} from "lucide-react";
import {
  Avatar,
  Badge,
  EmptyState,
  LoadingState,
  Modal,
  PageHeader,
  SectionHeading,
  StatCard,
  Toast,
} from "../../components/ui";
import { AppointmentCalendar } from "../../components/AppointmentCalendar";
import { apiFetch } from "../../lib/api";

type Result<T> = { data: T };
const brl = (v: unknown) =>
  Number(v || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
const servicePriceLabel = (service: Record<string, any>) =>
  service?.is_free ? "Sem custo" : brl(service?.base_price);
const dt = (v: unknown) =>
  v
    ? new Date(String(v)).toLocaleString("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "—";
const dateKey = (value = new Date()) =>
  [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");
const saoPauloDateKey = (value: unknown) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(String(value)));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
};
const generateNextCode = (catName: string, itemsList: any[]) => {
  if (!catName) return "";
  const normalized = catName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z]/g, "");
  if (normalized.length < 2) return "";
  const prefix = normalized.substring(0, 3).toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  
  const regex = new RegExp(`^${prefix}-(\\d+)$`);
  let maxNum = 0;
  for (const item of itemsList) {
    if (item.code) {
      const match = item.code.match(regex);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) {
          maxNum = num;
        }
      }
    }
  }
  
  const nextNum = maxNum + 1;
  const padded = String(nextNum).padStart(3, "0");
  return `${prefix}-${padded}`;
};
const buildCategoryTreeOptions = (categoriesList: any[]) => {
  const roots = categoriesList.filter(c => !c.parent_id);
  const result: { id: string, name: string, level: number }[] = [];
  
  const traverse = (node: any, level: number) => {
    result.push({ id: node.id, name: node.name, level });
    const children = categoriesList.filter(c => c.parent_id === node.id);
    for (const child of children) {
      traverse(child, level + 1);
    }
  };

  for (const root of roots) {
    traverse(root, 0);
  }

  for (const cat of categoriesList) {
    if (cat.parent_id && !result.some(r => r.id === cat.id)) {
      traverse(cat, 0);
    }
  }
  
  return result;
};
const buildMethodTreeOptions = (methodsList: any[]) => {
  const roots = methodsList.filter(m => !m.parent_id);
  const result: { id: string, name: string, level: number }[] = [];
  
  const traverse = (node: any, level: number) => {
    result.push({ id: node.id, name: node.name, level });
    const children = methodsList.filter(m => m.parent_id === node.id);
    for (const child of children) {
      traverse(child, level + 1);
    }
  };

  for (const root of roots) {
    traverse(root, 0);
  }

  for (const met of methodsList) {
    if (met.parent_id && !result.some(r => r.id === met.id)) {
      traverse(met, 0);
    }
  }
  
  return result;
};
const saoPauloTimeKey = (value: unknown) =>
  new Date(String(value)).toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  });
const csvCell = (value: unknown) =>
  `"${String(value ?? "").replace(/"/g, '""')}"`;
const labels: Record<string, string> = {
  requested: "Solicitado",
  pending: "Pendente",
  under_review: "Em análise",
  approved: "Aprovado",
  paid: "Pago",
  partial: "Parcial",
  cancelled: "Cancelado",
  refunded: "Reembolsado",
  active: "Ativo",
  awaiting_payment: "Aguardando pagamento",
  blocked: "Bloqueada",
  deletion_requested: "Exclusão solicitada",
  rejected: "Rejeitada",
  anonymized: "Anonimizada",
  confirmed: "Confirmado",
  pending_deposit: "Aguardando sinal",
  reschedule_requested: "Reagendamento solicitado",
  in_service: "Em atendimento",
  completed: "Finalizado",
  no_show: "Faltou",
  rescheduled: "Reagendado",
};
const appointmentStatusOptions = [
  { value: "requested", label: "Solicitado" },
  { value: "awaiting_payment", label: "Aguardando pagamento" },
  { value: "pending_deposit", label: "Aguardando sinal" },
  { value: "confirmed", label: "Confirmado" },
  { value: "in_service", label: "Em atendimento" },
  { value: "completed", label: "Finalizado" },
  { value: "rescheduled", label: "Reagendado" },
  { value: "reschedule_requested", label: "Reagendamento solicitado" },
  { value: "cancelled", label: "Cancelado" },
  { value: "no_show", label: "Faltou" },
];
const tone = (s: string): "green" | "amber" | "rose" | "gold" | "neutral" =>
  ["paid", "active", "confirmed", "completed"].includes(s)
    ? "green"
    : [
          "pending",
          "under_review",
          "awaiting_payment",
          "pending_deposit",
        ].includes(s)
      ? "amber"
      : [
            "cancelled",
            "refunded",
            "blocked",
            "deletion_requested",
            "rejected",
            "no_show",
          ].includes(s)
        ? "rose"
        : "neutral";
function useLoad<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reload = () => {
    setLoading(true);
    return apiFetch<Result<T> | T>(url)
      .then((r) => {
        setData(((r as Result<T>).data ?? r) as T);
        setError("");
      })
      .catch((e) => {
        console.error("Admin portal load error", e);
        setError(e.message);
      })
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    reload();
  }, [url]);
  return { data, loading, error, reload };
}
function ErrorBox({ text }: { text: string }) {
  return text ? (
    <div className="rounded-2xl bg-rose-50 p-4 text-xs font-bold text-rose-700">
      {text}
    </div>
  ) : null;
}

export function AdminDashboardPage() {
  const p = useLoad<any>("/api/portal?resource=admin-dashboard");
  if (p.loading) return <LoadingState />;
  if (!p.data) return <ErrorBox text={p.error} />;
  const m = p.data.metrics;
  const total = Number(m.appointments_week || 0);
  return (
    <div>
      <PageHeader
        eyebrow="VISÃO EXECUTIVA"
        title="Dashboard operacional"
        subtitle="Indicadores calculados em tempo real no Neon."
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Faturamento do mês"
          value={brl(m.monthly_revenue)}
          icon={<CircleDollarSign />}
          tone="dark"
        />
        <StatCard
          label="Agendamentos hoje"
          value={String(m.appointments_today)}
          icon={<CalendarDays />}
        />
        <StatCard
          label="Agendamentos na semana"
          value={String(total)}
          icon={<CalendarDays />}
        />
        <StatCard
          label="Pagamentos pendentes"
          value={String(m.pending_payments)}
          icon={<CreditCard />}
          tone="gold"
        />
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Novas clientes"
          value={String(m.new_clients)}
          icon={<Users />}
        />
        <StatCard
          label="Planos ativos"
          value={String(m.active_plans)}
          icon={<Check />}
        />
        <StatCard
          label="Cancelamentos"
          value={
            total
              ? `${((Number(m.cancelled_month) / total) * 100).toFixed(1)}%`
              : "0%"
          }
          icon={<ShieldAlert />}
        />
        <StatCard
          label="Não comparecimento"
          value={
            total
              ? `${((Number(m.no_show_month) / total) * 100).toFixed(1)}%`
              : "0%"
          }
          icon={<ShieldAlert />}
        />
      </div>
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <section className="surface p-6">
          <SectionHeading title="Serviços mais vendidos" />
          {p.data.topServices.length ? (
            p.data.topServices.map((x: any, i: number) => (
              <div
                key={x.name}
                className="flex justify-between border-b border-black/5 py-3 text-xs"
              >
                <span>
                  {i + 1}. {x.name}
                </span>
                <b>{x.total}</b>
              </div>
            ))
          ) : (
            <EmptyState
              title="Sem serviços no período"
              text="Os dados aparecerão após os agendamentos."
            />
          )}
        </section>
        <section className="surface p-6">
          <SectionHeading title="Profissionais por atendimentos" />
          {p.data.topProfessionals.length ? (
            p.data.topProfessionals.map((x: any, i: number) => (
              <div
                key={x.full_name}
                className="flex justify-between border-b border-black/5 py-3 text-xs"
              >
                <span>
                  {i + 1}. {x.full_name}
                </span>
                <b>{x.total}</b>
              </div>
            ))
          ) : (
            <EmptyState
              title="Sem atendimentos"
              text="Nenhum ranking disponível."
            />
          )}
        </section>
      </div>
    </div>
  );
}

export function AdminClientsPage() {
  const nav = useNavigate();
  const p = useLoad<any[]>("/api/portal?resource=clients");
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<any>(null);
  const [removingBusy, setRemovingBusy] = useState(false);
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
  if (p.loading) return <LoadingState />;
  const list = (p.data || []).filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()),
  );
  const createClient = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await apiFetch("/api/portal?resource=admin-client", {
        method: "POST",
        body: JSON.stringify(form),
      });
      await p.reload();
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
      setToast("Cliente cadastrada e acesso temporário enviado.");
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
  const removeClient = async () => {
    if (!removing?.id) return;
    setRemovingBusy(true);
    try {
      const result = await apiFetch<{ data: { cleanup?: { failed: number } } }>(
        "/api/portal?resource=admin-client-removal",
        {
          method: "DELETE",
          body: JSON.stringify({
            clientId: removing.id,
            reason: "Remoção manual pelo painel administrativo",
          }),
        },
      );
      await p.reload();
      setRemoving(null);
      setToast(
        result.data.cleanup?.failed
          ? "Cliente removida, mas algumas limpezas externas exigem revisão."
          : "Cliente removida com segurança.",
      );
    } catch (error) {
      console.error("Remove client error", error);
      setToast(
        error instanceof Error ? error.message : "Não foi possível remover a cliente.",
      );
    } finally {
      setRemovingBusy(false);
      setTimeout(() => setToast(""), 3000);
    }
  };
  return (
    <div>
      <Toast show={!!toast} message={toast} />
      <PageHeader
        eyebrow="CRM"
        title="Clientes"
        subtitle="Cadastros reais, conta e relacionamento."
        action={
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex border border-black/10 rounded-2xl overflow-hidden bg-white">
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                className={`p-2 transition ${viewMode === "grid" ? "bg-ink text-white" : "bg-warm text-stone-500 hover:bg-stone-100"}`}
                title="Visualização em Grade"
              >
                <LayoutGrid size={16} />
              </button>
              <button
                type="button"
                onClick={() => setViewMode("list")}
                className={`p-2 transition ${viewMode === "list" ? "bg-ink text-white" : "bg-warm text-stone-500 hover:bg-stone-100"}`}
                title="Visualização em Lista"
              >
                <List size={16} />
              </button>
            </div>
            <button onClick={() => setOpen(true)} className="btn-primary">
              <Plus size={15} />
              Novo Cliente
            </button>
            <div className="relative">
              <Search
                className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400"
                size={15}
              />
              <input
                className="field pl-10"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar cliente"
              />
            </div>
          </div>
        }
      />
      {list.length ? (
        viewMode === "grid" ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {list.map((c) => (
              <div key={c.id} className="surface p-5">
                <button
                  type="button"
                  onClick={() => nav(`/admin/clientes/${c.id}`)}
                  className="w-full text-left"
                >
                  <div className="flex items-center gap-3">
                    <Avatar src={c.avatar_url} name={c.name} size="lg" />
                    <span className="flex-1">
                      <b className="block font-display text-2xl">{c.name}</b>
                      <span className="text-[10px] text-stone-400">
                        {c.email}
                        <br />
                        {c.phone}
                      </span>
                    </span>
                    <Badge tone={tone(c.account_status)}>
                      {labels[c.account_status] || c.account_status}
                    </Badge>
                  </div>
                  <div className="mt-5 grid grid-cols-3 rounded-2xl bg-warm p-4 text-center text-xs">
                    <span>
                      <b className="block">{c.points}</b>
                      <small>Pontos</small>
                    </span>
                    <span>
                      <b className="block">{brl(c.lifetime_value)}</b>
                      <small>LTV</small>
                    </span>
                    <span>
                      <b className="block">{dt(c.next_appointment)}</b>
                      <small>Próximo</small>
                    </span>
                  </div>
                </button>
                <button
                  type="button"
                  disabled={c.account_status === "anonymized"}
                  onClick={() => setRemoving(c)}
                  className="mt-4 inline-flex min-h-9 items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 text-xs font-bold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
                >
                  <Trash2 size={14} />
                  Remover
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="surface overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-black/10 text-stone-450 uppercase tracking-wider text-[10px]">
                  <th className="p-4 font-bold">Cliente</th>
                  <th className="p-4 font-bold">Contato</th>
                  <th className="p-4 font-bold">Status</th>
                  <th className="p-4 font-bold">Pontos</th>
                  <th className="p-4 font-bold">LTV</th>
                  <th className="p-4 font-bold">Próximo</th>
                  <th className="p-4 font-bold text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id} className="border-b border-black/5 hover:bg-stone-50/40 transition">
                    <td className="p-4">
                      <button
                        type="button"
                        onClick={() => nav(`/admin/clientes/${c.id}`)}
                        className="flex items-center gap-3 text-left hover:underline"
                      >
                        <Avatar src={c.avatar_url} name={c.name} size="sm" />
                        <b className="font-display text-lg text-ink">{c.name}</b>
                      </button>
                    </td>
                    <td className="p-4 text-stone-500">
                      <div className="font-medium">{c.email}</div>
                      <div className="text-[10px] text-stone-400">{c.phone}</div>
                    </td>
                    <td className="p-4">
                      <Badge tone={tone(c.account_status)}>
                        {labels[c.account_status] || c.account_status}
                      </Badge>
                    </td>
                    <td className="p-4 font-semibold text-ink">{c.points}</td>
                    <td className="p-4 font-semibold text-ink">{brl(c.lifetime_value)}</td>
                    <td className="p-4 text-stone-500">{dt(c.next_appointment)}</td>
                    <td className="p-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => nav(`/admin/clientes/${c.id}`)}
                          className="rounded-full border border-black/10 p-1.5 text-stone-500 hover:border-champagne hover:text-champagne transition"
                          title="Ver ficha"
                        >
                          <Search size={13} />
                        </button>
                        <button
                          type="button"
                          disabled={c.account_status === "anonymized"}
                          onClick={() => setRemoving(c)}
                          className="rounded-full border border-rose-200 bg-rose-50 p-1.5 text-rose-700 hover:bg-rose-100 transition disabled:opacity-50"
                          title="Remover"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <EmptyState
          title="Nenhuma cliente encontrada"
          text="Ajuste a busca ou cadastre uma nova cliente."
        />
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
            label="Nome"
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
            <Input
              label="CPF"
              value={form.cpf}
              set={(value) => setForm({ ...form, cpf: value })}
            />
            <Input
              label="Data nascimento"
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
            placeholder="Defina a senha de acesso"
          />
          <label className="block">
            <span className="mb-2 block text-xs font-bold">Observações</span>
            <textarea
              className="field min-h-24 py-3"
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
      <Modal
        open={Boolean(removing)}
        onClose={() => {
          if (!removingBusy) setRemoving(null);
        }}
        title="Remover cliente"
      >
        <p className="muted">
          Esta ação anonimiza os dados pessoais de {removing?.name}, remove acesso,
          notificações, fotos e cartões salvos, preservando histórico financeiro e
          agendamentos para auditoria.
        </p>
        <button
          disabled={removingBusy}
          onClick={removeClient}
          className="mt-5 inline-flex w-full min-h-12 items-center justify-center gap-2 rounded-2xl bg-rose-600 px-5 text-xs font-bold uppercase tracking-[0.18em] text-white transition hover:bg-rose-700 disabled:opacity-50"
        >
          <Trash2 size={15} />
          {removingBusy ? "Removendo..." : "Confirmar remoção"}
        </button>
      </Modal>
    </div>
  );
}

export function AdminClientDetailPage() {
  const id = useLocation().pathname.split("/clientes/")[1];
  const p = useLoad<any>(
    `/api/portal?resource=client-detail&id=${encodeURIComponent(id || "")}`,
  );
  const [tab, setTab] = useState("Resumo");
  const [note, setNote] = useState("");
  const [toast, setToast] = useState("");
  const [reviewAction, setReviewAction] = useState<"approve" | "reject" | "">("");
  const [reviewing, setReviewing] = useState(false);

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    cpf: "",
    instagram: "",
    birthDate: "",
    password: "",
  });

  if (p.loading) return <LoadingState />;
  if (!p.data) return <ErrorBox text={p.error} />;
  const d = p.data,
    profile = d.profile;

  const handleOpenEdit = () => {
    setEditForm({
      fullName: profile.full_name || "",
      email: profile.email || "",
      phone: profile.phone || "",
      cpf: profile.cpf || "",
      instagram: profile.instagram || "",
      birthDate: profile.birth_date ? profile.birth_date.split("T")[0] : "",
      password: "",
    });
    setEditModalOpen(true);
  };

  const saveClientEdit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch("/api/portal?resource=admin-client", {
        method: "POST",
        body: JSON.stringify({
          id,
          ...editForm,
        }),
      });
      setEditModalOpen(false);
      setToast("Cadastro atualizado com sucesso.");
      await p.reload();
    } catch (err) {
      console.error("Save client edit error", err);
      setToast(
        err instanceof Error ? err.message : "Não foi possível atualizar o cadastro."
      );
    } finally {
      setTimeout(() => setToast(""), 2200);
    }
  };

  const saveNote = async () => {
    try {
      await apiFetch("/api/portal?resource=client-note", {
        method: "POST",
        body: JSON.stringify({ clientId: id, note }),
      });
      setNote("");
      await p.reload();
      setToast("Observação adicionada com sucesso.");
    } catch (e) {
      console.error("Client note error", e);
      setToast(
        e instanceof Error ? e.message : "Não foi possível concluir a ação.",
      );
    } finally {
      setTimeout(() => setToast(""), 2200);
    }
  };

  const status = async (value: string) => {
    try {
      await apiFetch("/api/portal?resource=client-status", {
        method: "PATCH",
        body: JSON.stringify({ clientId: id, status: value }),
      });
      await p.reload();
      setToast("Status da conta atualizado.");
    } catch (e) {
      console.error("Client status error", e);
      setToast("Não foi possível concluir a ação.");
    } finally {
      setTimeout(() => setToast(""), 2200);
    }
  };

  const reviewDeletion = async () => {
    if (!d.deletion?.id || !reviewAction) return;
    setReviewing(true);
    try {
      const result = await apiFetch<{data:{cleanup?:{failed:number}}}>("/api/portal?resource=deletion-review", {
        method: "POST",
        body: JSON.stringify({ requestId: d.deletion.id, action: reviewAction }),
      });
      await p.reload();
      setReviewAction("");
      setToast(result.data.cleanup?.failed ? "Conta anonimizada, mas algumas mídias exigem limpeza manual." : reviewAction === "approve" ? "Conta anonimizada com sucesso." : "Solicitação rejeitada.");
    } catch (e) {
      console.error("Deletion review error", e);
      setToast(e instanceof Error ? e.message : "Não foi possível concluir a análise.");
    } finally {
      setReviewing(false);
      setTimeout(() => setToast(""), 2600);
    }
  };

  const getTimelineEvents = () => {
    const events: any[] = [];

    // Appointments
    if (d.appointments) {
      d.appointments.forEach((a: any) => {
        events.push({
          date: new Date(a.starts_at),
          type: "Agendamento",
          title: a.service,
          detail: `Profissional: ${a.professional} • Status: ${labels[a.status] || a.status}`,
          badge: a.status,
        });
      });
    }

    // Payments
    if (d.payments) {
      d.payments.forEach((py: any) => {
        events.push({
          date: new Date(py.created_at || py.paid_at),
          type: "Pagamento",
          title: `Pagamento de ${brl(py.amount)}`,
          detail: `Método: ${py.method || "—"} • Status: ${labels[py.status] || py.status}`,
          badge: py.status,
        });
      });
    }

    // Loyalty History
    if (d.loyalty?.history) {
      d.loyalty.history.forEach((l: any) => {
        events.push({
          date: new Date(l.created_at),
          type: "Fidelidade",
          title: `${l.points > 0 ? "+" : ""}${l.points} pontos`,
          detail: l.reason,
        });
      });
    }

    // Photos
    if (d.photos) {
      d.photos.forEach((ph: any) => {
        events.push({
          date: new Date(ph.created_at),
          type: "Foto",
          title: `Foto (${ph.kind})`,
          detail: (
            <a href={ph.storage_path} target="_blank" rel="noreferrer" className="text-stone-400 hover:text-stone-300 underline font-medium">
              Ver imagem anexada
            </a>
          ),
        });
      });
    }

    // Internal Notes
    if (d.notes) {
      d.notes.forEach((n: any) => {
        events.push({
          date: new Date(n.created_at),
          type: "Nota Interna",
          title: `Nota por ${n.author}`,
          detail: `"${n.note}"`,
        });
      });
    }

    return events.sort((a, b) => b.date.getTime() - a.date.getTime());
  };

  const tabs = [
    "Resumo",
    "Linha do Tempo",
    "Agendamentos",
    "Pagamentos",
    "Planos",
    "Cupons",
    "Fidelidade",
    "Fotos",
    "Privacidade",
    "Histórico",
  ];

  return (
    <div>
      <Toast show={!!toast} message={toast} />
      <PageHeader
        eyebrow="FICHA COMPLETA"
        title={profile.full_name}
        subtitle={`${profile.email} • ${profile.phone}`}
        action={["active", "blocked"].includes(profile.account_status) ?
          <div className="flex gap-2">
            <button
              onClick={handleOpenEdit}
              className="btn-secondary"
            >
              Editar Cadastro
            </button>
            <button
              onClick={() =>
                status(
                  profile.account_status === "blocked" ? "active" : "blocked",
                )
              }
              className="btn-secondary"
            >
              {profile.account_status === "blocked"
                ? "Desbloquear"
                : "Bloquear conta"}
            </button>
            <a href="/admin/agendamentos" className="btn-primary">
              <Plus size={15} />
              Novo agendamento
            </a>
          </div> : undefined
        }
      />
      <section className="surface p-6">
        <div className="flex flex-col gap-5 sm:flex-row">
          <Avatar src={profile.avatar_url} name={profile.full_name} size="lg" />
          <div className="grid flex-1 gap-3 sm:grid-cols-4">
            <Mini
              label="Nascimento"
              value={
                profile.birth_date
                  ? new Date(profile.birth_date).toLocaleDateString("pt-BR")
                  : "—"
              }
            />
            <Mini label="CPF" value={profile.cpf || "Não informado"} />
            <Mini label="Instagram" value={profile.instagram || "—"} />
            <Mini label="Cadastro" value={dt(profile.created_at)} />
          </div>
          <Badge tone={tone(profile.account_status)}>
            {labels[profile.account_status] || profile.account_status}
          </Badge>
        </div>
      </section>
      <div className="no-scrollbar mt-5 flex gap-2 overflow-x-auto">
        {tabs.map((x) => (
          <button
            key={x}
            onClick={() => setTab(x)}
            className={`rounded-xl px-4 py-2 text-xs font-bold ${tab === x ? "bg-ink text-white" : "bg-white text-stone-500"}`}
          >
            {x}
          </button>
        ))}
      </div>
      <section className="surface mt-4 p-6">
        {tab === "Resumo" && (
          <div className="grid gap-4 sm:grid-cols-4">
            <Mini label="Pontos" value={String(d.loyalty.balance || 0)} />
            <Mini label="Valor vitalício" value={brl(profile.lifetime_value)} />
            <Mini
              label="Último atendimento"
              value={dt(d.appointments[0]?.starts_at)}
            />
            <Mini
              label="Próxima manutenção"
              value={dt(
                d.appointments.find(
                  (a: any) => new Date(a.starts_at) > new Date(),
                )?.starts_at,
              )}
            />
          </div>
        )}
        {tab === "Linha do Tempo" && (
          <div className="space-y-6 relative before:absolute before:left-4 before:top-2 before:bottom-2 before:w-[2px] before:bg-stone-850">
            {getTimelineEvents().map((ev: any, idx: number) => (
              <div key={idx} className="relative pl-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="absolute left-[11px] top-1.5 w-3 h-3 rounded-full bg-stone-500 border-2 border-stone-900" />
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-stone-500 font-bold block mb-0.5">
                    {ev.type} • {dt(ev.date)}
                  </span>
                  <h4 className="font-display text-lg text-white">{ev.title}</h4>
                  <div className="text-xs text-stone-450 mt-1">{ev.detail}</div>
                </div>
                {ev.badge && (
                  <div>
                    <Badge tone={tone(ev.badge)}>
                      {labels[ev.badge] || ev.badge}
                    </Badge>
                  </div>
                )}
              </div>
            ))}
            {getTimelineEvents().length === 0 && (
              <EmptyState title="Linha do tempo vazia" text="Nenhum evento registrado para esta cliente." />
            )}
          </div>
        )}
        {tab === "Agendamentos" && (
          <TableEmpty
            rows={d.appointments}
            render={(a: any) => (
              <Row
                key={a.id}
                title={a.service}
                detail={`${dt(a.starts_at)} • ${a.professional}`}
                value={
                  <Badge tone={tone(a.status)}>
                    {labels[a.status] || a.status}
                  </Badge>
                }
              />
            )}
          />
        )}
        {tab === "Pagamentos" && (
          <TableEmpty
            rows={d.payments}
            render={(x: any) => (
              <Row
                key={x.id}
                title={brl(x.amount)}
                detail={`${x.method} • ${dt(x.created_at)}`}
                value={
                  <Badge tone={tone(x.status)}>
                    {labels[x.status] || x.status}
                  </Badge>
                }
              />
            )}
          />
        )}
        {tab === "Planos" && (
          <TableEmpty
            rows={d.subscriptions}
            render={(x: any) => (
              <Row
                key={x.id}
                title={x.name}
                detail={`${brl(x.price)} • ${dt(x.starts_at)}`}
                value={
                  <Badge tone={tone(x.status)}>
                    {labels[x.status] || x.status}
                  </Badge>
                }
              />
            )}
          />
        )}
        {tab === "Cupons" && (
          <TableEmpty
            rows={d.coupons}
            render={(x: any) => (
              <Row
                key={`${x.code}-${x.used_at}`}
                title={x.code}
                detail={x.description}
                value={brl(x.discount_amount)}
              />
            )}
          />
        )}
        {tab === "Fidelidade" && (
          <TableEmpty
            rows={d.loyalty.history || []}
            render={(x: any, i: number) => (
              <Row
                key={i}
                title={`${x.points} pontos`}
                detail={x.reason}
                value={dt(x.created_at)}
              />
            )}
          />
        )}
        {tab === "Fotos" && (
          <TableEmpty
            rows={d.photos}
            render={(x: any) => (
              <Row
                key={x.id}
                title={x.kind}
                detail={dt(x.created_at)}
                value={
                  <a href={x.storage_path} target="_blank" rel="noreferrer">
                    Abrir
                  </a>
                }
              />
            )}
          />
        )}
        {tab === "Privacidade" && (<>
          {d.deletion&&<div className="mb-5 rounded-2xl bg-warm p-5"><div className="flex flex-wrap items-center justify-between gap-3"><span><b className="block text-xs">Solicitação de exclusão</b><small className="text-stone-400">{dt(d.deletion.requested_at)} • {d.deletion.reason||'Sem motivo informado'}</small></span><Badge tone={tone(d.deletion.status)}>{labels[d.deletion.status]||d.deletion.status}</Badge></div>{['requested','under_review'].includes(d.deletion.status)&&<div className="mt-4 flex gap-2"><button onClick={()=>setReviewAction('reject')} className="btn-secondary">Rejeitar</button><button onClick={()=>setReviewAction('approve')} className="btn-primary">Aprovar e anonimizar</button></div>}</div>}
          <TableEmpty rows={d.consents} render={(x: any) => (<Row key={x.consent_type} title={x.consent_type} detail={`Política ${x.policy_version}`} value={<Badge tone={x.accepted ? "green" : "rose"}>{x.accepted ? "Aceito" : "Revogado"}</Badge>}/>)}/>
        </>)}
        {tab === "Histórico" && (
          <>
            <TableEmpty
              rows={d.notes}
              render={(x: any) => (
                <Row
                  key={x.id}
                  title={x.author}
                  detail={x.note}
                  value={dt(x.created_at)}
                />
              )}
            />
            <div className="mt-5 flex gap-2">
              <input
                className="field"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Observação interna"
              />
              <button
                disabled={note.trim().length < 3}
                onClick={saveNote}
                className="btn-primary"
              >
                Adicionar
              </button>
            </div>
          </>
        )}
      </section>

      <Modal open={editModalOpen} onClose={() => setEditModalOpen(false)} title="Editar Cadastro">
        <form onSubmit={saveClientEdit} className="space-y-4">
          <Input
            label="Nome Completo"
            value={editForm.fullName}
            set={(v) => setEditForm({ ...editForm, fullName: v })}
          />
          <Input
            label="E-mail"
            type="email"
            value={editForm.email}
            set={(v) => setEditForm({ ...editForm, email: v })}
          />
          <Input
            label="WhatsApp"
            value={editForm.phone}
            set={(v) => setEditForm({ ...editForm, phone: v })}
          />
          <Input
            label="CPF"
            value={editForm.cpf}
            set={(v) => setEditForm({ ...editForm, cpf: v })}
            placeholder="000.000.000-00"
          />
          <Input
            label="Instagram"
            value={editForm.instagram}
            set={(v) => setEditForm({ ...editForm, instagram: v })}
            placeholder="@carolsolmega"
          />
          <Input
            label="Data de Nascimento"
            type="date"
            value={editForm.birthDate}
            set={(v) => setEditForm({ ...editForm, birthDate: v })}
          />
          <Input
            label="Senha (Opcional)"
            type="password"
            value={editForm.password}
            set={(v) => setEditForm({ ...editForm, password: v })}
            placeholder="Defina a senha ou deixe em branco"
          />
          <button className="btn-primary w-full">Salvar alterações</button>
        </form>
      </Modal>

      <Modal open={!!reviewAction} onClose={()=>{if(!reviewing)setReviewAction("")}} title={reviewAction==='approve'?"Aprovar exclusão":"Rejeitar exclusão"}>
        <p className="muted">{reviewAction==='approve'?"Esta ação remove dados pessoais, mídias e acesso da conta, preservando registros financeiros anonimizados. Não pode ser desfeita.":"A conta voltará ao estado ativo e a solicitação será encerrada."}</p>
        <button disabled={reviewing} onClick={reviewDeletion} className="btn-primary mt-5 w-full disabled:opacity-50">{reviewing?'Processando…':reviewAction==='approve'?'Confirmar anonimização':'Confirmar rejeição'}</button>
      </Modal>
    </div>
  );
}

export function AdminPaymentsPage() {
  const p = useLoad<any[]>("/api/portal?resource=admin-payments");
  const clientsLoad = useLoad<any[]>("/api/portal?resource=clients");
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");
  const [review, setReview] = useState<any>(null);
  const [rejectionReason, setRejectionReason] = useState("");

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    clientId: "",
    amount: "",
    paidAmount: "",
    method: "money",
    status: "pending",
    notes: "",
  });

  const [partialModalOpen, setPartialModalOpen] = useState(false);
  const [partialPayment, setPartialPayment] = useState<any>(null);
  const [partialForm, setPartialForm] = useState({
    paidAmount: "",
    notes: "",
  });

  const [billingModalOpen, setBillingModalOpen] = useState(false);
  const [billingForm, setBillingForm] = useState({
    clientId: "",
    amount: "",
    reason: "Sinal",
    notes: "",
  });

  if (p.loading) return <LoadingState />;
  if (!p.data) return <ErrorBox text={p.error} />;

  const clients = clientsLoad.data || [];

  const confirm = async (id: string) => {
    setBusy(id);
    try {
      await apiFetch("/api/portal?resource=admin-payment", {
        method: "PATCH",
        body: JSON.stringify({ id, status: "paid" }),
      });
      await p.reload();
      setToast("Pagamento registrado com sucesso.");
    } catch (e) {
      console.error("Payment confirmation error", e);
      setToast(
        e instanceof Error ? e.message : "Não foi possível concluir a ação.",
      );
    } finally {
      setBusy("");
      setTimeout(() => setToast(""), 2200);
    }
  };

  const sync = async (id: string) => {
    setBusy(id);
    try {
      await apiFetch("/api/payments?resource=sync", {
        method: "POST",
        body: JSON.stringify({ paymentId: id }),
      });
      await p.reload();
      setToast("Status sincronizado com a SumUp.");
    } catch (error) {
      console.error("SumUp sync error", error);
      setToast(
        error instanceof Error
          ? error.message
          : "Não foi possível sincronizar.",
      );
    } finally {
      setBusy("");
      setTimeout(() => setToast(""), 2600);
    }
  };

  const reviewReceipt = async () => {
    if (!review) return;
    setBusy(review.id);
    try {
      await apiFetch("/api/portal?resource=admin-payment", {
        method: "PATCH",
        body: JSON.stringify({
          id: review.id,
          receiptId: review.receiptId,
          receiptAction: review.action,
          rejectionReason,
        }),
      });
      await p.reload();
      setReview(null);
      setRejectionReason("");
      setToast(
        review.action === "approve"
          ? "Comprovante aprovado e pagamento confirmado."
          : "Comprovante rejeitado. A cliente poderá enviar outro.",
      );
    } catch (error) {
      console.error("Payment receipt review error", error);
      setToast(
        error instanceof Error
          ? error.message
          : "Não foi possível analisar o comprovante.",
      );
    } finally {
      setBusy("");
      setTimeout(() => setToast(""), 3000);
    }
  };

  const submitCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!createForm.clientId) {
      setToast("Selecione um cliente.");
      setTimeout(() => setToast(""), 2200);
      return;
    }
    const amt = Number(createForm.amount);
    if (isNaN(amt) || amt <= 0) {
      setToast("O valor da cobrança deve ser maior que zero.");
      setTimeout(() => setToast(""), 2200);
      return;
    }
    try {
      await apiFetch("/api/portal?resource=admin-payment", {
        method: "POST",
        body: JSON.stringify({
          clientId: createForm.clientId,
          amount: amt,
          paidAmount: createForm.status === "partial" ? Number(createForm.paidAmount) : 0,
          method: createForm.method,
          status: createForm.status,
          notes: createForm.notes,
        }),
      });
      setCreateModalOpen(false);
      setCreateForm({
        clientId: "",
        amount: "",
        paidAmount: "",
        method: "money",
        status: "pending",
        notes: "",
      });
      setToast("Cobrança manual criada.");
      await p.reload();
    } catch (err) {
      console.error("Create manual payment error", err);
      setToast(err instanceof Error ? err.message : "Erro ao criar cobrança.");
    } finally {
      setTimeout(() => setToast(""), 2200);
    }
  };

  const submitBilling = async (e: FormEvent) => {
    e.preventDefault();
    if (!billingForm.clientId) {
      setToast("Selecione uma cliente.");
      setTimeout(() => setToast(""), 2200);
      return;
    }
    const amt = Number(billingForm.amount);
    if (isNaN(amt) || amt <= 0) {
      setToast("O valor deve ser maior que zero.");
      setTimeout(() => setToast(""), 2200);
      return;
    }
    setBusy("billing");
    try {
      await apiFetch("/api/portal?resource=admin-billing", {
        method: "POST",
        body: JSON.stringify({
          clientId: billingForm.clientId,
          amount: amt,
          reason: billingForm.reason,
          notes: billingForm.notes,
        }),
      });
      setBillingModalOpen(false);
      setBillingForm({
        clientId: "",
        amount: "",
        reason: "Sinal",
        notes: "",
      });
      setToast("Cobrança enviada com sucesso!");
      await p.reload();
    } catch (err) {
      console.error("Billing SumUp error", err);
      setToast(err instanceof Error ? err.message : "Erro ao enviar cobrança.");
    } finally {
      setBusy("");
      setTimeout(() => setToast(""), 2600);
    }
  };

  const submitPartial = async (e: FormEvent) => {
    e.preventDefault();
    if (!partialPayment) return;
    const paidAmt = Number(partialForm.paidAmount);
    if (isNaN(paidAmt) || paidAmt < 0) {
      setToast("Valor pago inválido.");
      setTimeout(() => setToast(""), 2200);
      return;
    }
    if (paidAmt > partialPayment.amount) {
      setToast("O valor pago não pode ser maior que o total da cobrança.");
      setTimeout(() => setToast(""), 2200);
      return;
    }
    try {
      await apiFetch("/api/portal?resource=admin-payment", {
        method: "PATCH",
        body: JSON.stringify({
          id: partialPayment.id,
          status: paidAmt === partialPayment.amount ? "paid" : "partial",
          paidAmount: paidAmt,
          notes: partialForm.notes || "Pagamento parcial registrado",
        }),
      });
      setPartialModalOpen(false);
      setPartialPayment(null);
      setPartialForm({ paidAmount: "", notes: "" });
      setToast("Pagamento parcial registrado.");
      await p.reload();
    } catch (err) {
      console.error("Partial payment error", err);
      setToast(err instanceof Error ? err.message : "Erro ao registrar pagamento parcial.");
    } finally {
      setTimeout(() => setToast(""), 2200);
    }
  };

  return (
    <div>
      <Toast show={!!toast} message={toast} />
      <PageHeader
        eyebrow="FINANCEIRO"
        title="Pagamentos"
        subtitle="Confirmação manual, pagamentos parciais e histórico."
        action={
          <div className="flex gap-2">
            <button
              onClick={() => setCreateModalOpen(true)}
              className="btn-secondary"
            >
              <Plus size={15} />
              Cobrança Manual
            </button>
            <button
              onClick={() => setBillingModalOpen(true)}
              className="btn-primary"
            >
              <WalletCards size={15} />
              Enviar Cobrança SumUp
            </button>
          </div>
        }
      />
      {p.data?.length ? (
        <section className="surface overflow-hidden">
          {p.data.map((x) => (
            <div
              key={x.id}
              className="grid grid-cols-[1fr_auto] gap-3 border-b border-black/5 p-5 sm:grid-cols-[1.3fr_.8fr_.7fr_.6fr_auto]"
            >
              <span>
                <b className="block text-xs">{x.client}</b>
                <span className="text-[10px] text-stone-400">
                  {x.service || x.plan || x.notes || "Pagamento manual"}
                </span>
                {x.latest_receipt_url && (
                  <a
                    href={x.latest_receipt_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 block text-[10px] font-bold underline"
                  >
                    Ver comprovante
                  </a>
                )}
                {x.latest_receipt_rejection_reason && (
                  <small className="mt-1 block text-rose-700">
                    Motivo: {x.latest_receipt_rejection_reason}
                  </small>
                )}
              </span>
              <span className="hidden text-xs sm:block">
                {x.provider || "manual"}
                <small className="block text-stone-400">{x.method}</small>
              </span>
              <span className="text-xs">
                <b className="block">{brl(x.amount)}</b>
                {x.status === "partial" && (
                  <small className="block text-amber-600 font-bold">
                    Pago: {brl(x.paid_amount || 0)}
                  </small>
                )}
              </span>
              <Badge tone={tone(x.status)}>
                {labels[x.status] || x.status}
              </Badge>
              {x.latest_receipt_status === "under_review" ? (
                <span className="flex flex-wrap justify-end gap-2">
                  <button
                    disabled={busy === x.id}
                    onClick={() =>
                      setReview({
                        id: x.id,
                        receiptId: x.latest_receipt_id,
                        action: "reject",
                      })
                    }
                    className="btn-secondary !min-h-9 !px-3"
                  >
                    Rejeitar
                  </button>
                  <button
                    disabled={busy === x.id}
                    onClick={() =>
                      setReview({
                        id: x.id,
                        receiptId: x.latest_receipt_id,
                        action: "approve",
                      })
                    }
                    className="btn-primary !min-h-9 !px-3"
                  >
                    Aprovar
                  </button>
                </span>
              ) : x.provider === "sumup" && x.provider_checkout_id ? (
                <button
                  disabled={busy === x.id}
                  onClick={() => sync(x.id)}
                  className="btn-secondary !min-h-9 !px-3"
                >
                  {busy === x.id ? "Sincronizando…" : "Atualizar status"}
                </button>
              ) : (x.provider === "local" || x.provider === "manual") && x.status !== "paid" ? (
                <div className="flex gap-2">
                  <button
                    disabled={busy === x.id}
                    onClick={() => {
                      setPartialPayment(x);
                      setPartialForm({
                        paidAmount: String(x.paid_amount || 0),
                        notes: "",
                      });
                      setPartialModalOpen(true);
                    }}
                    className="btn-secondary !min-h-9 !px-3"
                  >
                    Parcial
                  </button>
                  <button
                    disabled={busy === x.id}
                    onClick={() => confirm(x.id)}
                    className="btn-primary !min-h-9 !px-3"
                  >
                    {busy === x.id ? "Confirmando…" : "Confirmar"}
                  </button>
                </div>
              ) : x.provider === "pix_manual" && x.status !== "paid" ? (
                <small className="max-w-28 text-right text-stone-400">
                  Aguardando comprovante
                </small>
              ) : <span />}
            </div>
          ))}
        </section>
      ) : (
        <EmptyState
          title="Nenhum pagamento"
          text="Os pagamentos aparecerão aqui."
        />
      )}

      {/* Modal Criar Cobrança */}
      <Modal open={createModalOpen} onClose={() => setCreateModalOpen(false)} title="Criar cobrança manual">
        <form onSubmit={submitCreate} className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-xs font-bold">Cliente</span>
            <select
              className="field"
              value={createForm.clientId}
              onChange={(e) => setCreateForm({ ...createForm, clientId: e.target.value })}
              required
            >
              <option value="">Selecione um cliente...</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.phone || c.email})
                </option>
              ))}
            </select>
          </label>

          <Input
            label="Valor Total (R$)"
            type="number"
            value={createForm.amount}
            set={(v) => setCreateForm({ ...createForm, amount: v })}
          />

          <label className="block">
            <span className="mb-2 block text-xs font-bold">Método de pagamento</span>
            <select
              className="field"
              value={createForm.method}
              onChange={(e) => setCreateForm({ ...createForm, method: e.target.value })}
            >
              <option value="money">Dinheiro (Espécie)</option>
              <option value="pix">Pix (Local)</option>
              <option value="credit">Cartão de Crédito</option>
              <option value="debit">Cartão de Débito</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-bold">Status inicial</span>
            <select
              className="field"
              value={createForm.status}
              onChange={(e) => setCreateForm({ ...createForm, status: e.target.value })}
            >
              <option value="pending">Pendente</option>
              <option value="partial">Pagamento Parcial</option>
              <option value="paid">Pago (Confirmado)</option>
            </select>
          </label>

          {createForm.status === "partial" && (
            <Input
              label="Valor já pago (R$)"
              type="number"
              value={createForm.paidAmount}
              set={(v) => setCreateForm({ ...createForm, paidAmount: v })}
            />
          )}

          <Input
            label="Observação / Descrição (Opcional)"
            value={createForm.notes}
            set={(v) => setCreateForm({ ...createForm, notes: v })}
            placeholder="Ex: Venda de escova de cabelo, Mega Hair lote B"
          />

          <button className="btn-primary w-full">Criar cobrança</button>
        </form>
      </Modal>

      {/* Modal Enviar Cobrança SumUp */}
      <Modal open={billingModalOpen} onClose={() => { if (busy !== "billing") setBillingModalOpen(false); }} title="Enviar cobrança via SumUp">
        <form onSubmit={submitBilling} className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-xs font-bold">Cliente</span>
            <select
              className="field"
              value={billingForm.clientId}
              onChange={(e) => setBillingForm({ ...billingForm, clientId: e.target.value })}
              required
            >
              <option value="">Selecione um cliente...</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.phone || c.email})
                </option>
              ))}
            </select>
          </label>

          <Input
            label="Valor da cobrança (R$)"
            type="number"
            value={billingForm.amount}
            set={(v) => setBillingForm({ ...billingForm, amount: v })}
            placeholder="0.00"
          />

          <label className="block">
            <span className="mb-2 block text-xs font-bold">Motivo da cobrança</span>
            <select
              className="field"
              value={billingForm.reason}
              onChange={(e) => setBillingForm({ ...billingForm, reason: e.target.value })}
              required
            >
              <option value="Sinal">Sinal</option>
              <option value="Entrada">Entrada</option>
              <option value="Restante do pagamento">Restante do pagamento</option>
              <option value="Multa">Multa</option>
              <option value="Taxa de reagendamento">Taxa de reagendamento</option>
              <option value="Serviço adicional">Serviço adicional</option>
              <option value="Produto">Produto</option>
              <option value="Outro">Outro</option>
            </select>
          </label>

          <Input
            label="Observação (Opcional)"
            value={billingForm.notes}
            set={(v) => setBillingForm({ ...billingForm, notes: v })}
            placeholder="Ex: Pagamento pendente referente ao Mega Hair de ontem"
          />

          <button disabled={busy === "billing"} className="btn-primary w-full mt-4">
            {busy === "billing" ? "Gerando link e enviando..." : "Enviar Cobrança (WhatsApp e E-mail)"}
          </button>
        </form>
      </Modal>

      {/* Modal Pagamento Parcial */}
      <Modal open={partialModalOpen} onClose={() => setPartialModalOpen(false)} title="Registrar pagamento parcial">
        {partialPayment && (
          <form onSubmit={submitPartial} className="space-y-4">
            <div className="rounded-2xl bg-warm p-4 text-xs space-y-1">
              <p><strong>Cliente:</strong> {partialPayment.client}</p>
              <p><strong>Valor total da cobrança:</strong> {brl(partialPayment.amount)}</p>
              <p><strong>Valor pago anteriormente:</strong> {brl(partialPayment.paid_amount || 0)}</p>
            </div>

            <Input
              label="Valor pago acumulado (R$)"
              type="number"
              value={partialForm.paidAmount}
              set={(v) => setPartialForm({ ...partialForm, paidAmount: v })}
            />

            <Input
              label="Observação (Opcional)"
              value={partialForm.notes}
              set={(v) => setPartialForm({ ...partialForm, notes: v })}
              placeholder="Ex: Recebido via Pix, em dinheiro"
            />

            <button className="btn-primary w-full">Salvar pagamento parcial</button>
          </form>
        )}
      </Modal>

      <Modal
        open={Boolean(review)}
        onClose={() => {
          if (!busy) {
            setReview(null);
            setRejectionReason("");
          }
        }}
        title={review?.action === "approve" ? "Aprovar comprovante" : "Rejeitar comprovante"}
      >
        <p className="muted">
          {review?.action === "approve"
            ? "A aprovação confirma o pagamento e libera os vínculos associados."
            : "Informe o motivo para que a cliente possa corrigir e reenviar."}
        </p>
        {review?.action === "reject" && (
          <textarea
            className="field mt-4 min-h-24 py-3"
            value={rejectionReason}
            onChange={(event) => setRejectionReason(event.target.value)}
            placeholder="Motivo da rejeição"
          />
        )}
        <button
          disabled={Boolean(busy) || (review?.action === "reject" && rejectionReason.trim().length < 3)}
          onClick={reviewReceipt}
          className="btn-primary mt-5 w-full disabled:opacity-50"
        >
          {busy
            ? "Salvando…"
            : review?.action === "approve"
              ? "Confirmar aprovação"
              : "Confirmar rejeição"}
        </button>
      </Modal>
    </div>
  );
}

export function AdminPlansPage() {
  const p = useLoad<any[]>("/api/portal?resource=admin-plans");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({
    name: "",
    price: "",
    benefits: "",
    active: true,
    billingCycle: "monthly",
  });
  const [toast, setToast] = useState("");

  const handleCreate = () => {
    setEditing(null);
    setForm({
      name: "",
      price: "",
      benefits: "",
      active: true,
      billingCycle: "monthly",
    });
    setOpen(true);
  };

  const handleEdit = (plan: any) => {
    setEditing(plan);
    setForm({
      name: plan.name,
      price: String(plan.price),
      benefits: Array.isArray(plan.benefits) ? plan.benefits.join("\n") : "",
      active: plan.active !== false,
      billingCycle: plan.billing_cycle || "monthly",
    });
    setOpen(true);
  };

  const toggleActive = async (plan: any) => {
    try {
      await apiFetch("/api/portal?resource=admin-plan", {
        method: "POST",
        body: JSON.stringify({
          id: plan.id,
          name: plan.name,
          price: Number(plan.price),
          benefits: plan.benefits,
          billingCycle: plan.billing_cycle || "monthly",
          active: !plan.active,
        }),
      });
      await p.reload();
      setToast(`Plano ${!plan.active ? "ativado" : "pausado"} com sucesso.`);
    } catch (err) {
      console.error("Toggle active error", err);
      setToast("Não foi possível alterar o status do plano.");
    } finally {
      setTimeout(() => setToast(""), 2200);
    }
  };

  const handleArchive = async (plan: any) => {
    if (!confirm(`Tem certeza de que deseja arquivar o plano "${plan.name}"? Esta ação não afetará assinaturas existentes, mas impedirá novas adesões.`))
      return;
    try {
      await apiFetch("/api/portal?resource=admin-plan", {
        method: "POST",
        body: JSON.stringify({
          id: plan.id,
          name: plan.name,
          price: Number(plan.price),
          benefits: plan.benefits,
          billingCycle: plan.billing_cycle || "monthly",
          active: plan.active,
          archived: true,
        }),
      });
      await p.reload();
      setToast("Plano arquivado com sucesso.");
    } catch (err) {
      console.error("Archive plan error", err);
      setToast("Não foi possível arquivar o plano.");
    } finally {
      setTimeout(() => setToast(""), 2200);
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch("/api/portal?resource=admin-plan", {
        method: "POST",
        body: JSON.stringify({
          id: editing?.id || undefined,
          name: form.name,
          price: Number(form.price),
          benefits: form.benefits.split("\n"),
          active: form.active,
          billingCycle: form.billingCycle,
        }),
      });
      await p.reload();
      setOpen(false);
      setToast(editing ? "Plano atualizado com sucesso." : "Plano criado com sucesso.");
    } catch (err) {
      console.error("Plan save error", err);
      setToast(
        err instanceof Error
          ? err.message
          : "Ocorreu um erro ao salvar os dados.",
      );
    } finally {
      setTimeout(() => setToast(""), 2200);
    }
  };

  if (p.loading) return <LoadingState />;
  return (
    <div>
      <Toast show={!!toast} message={toast} />
      <PageHeader
        eyebrow="ASSINATURAS"
        title="Administração de planos"
        subtitle="Planos e quantidade real de assinantes."
        action={
          <button onClick={handleCreate} className="btn-primary">
            <Plus size={15} />
            Criar plano
          </button>
        }
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {p.data?.map((x) => (
          <div key={x.id} className="surface p-6 flex flex-col justify-between">
            <div>
              <div className="flex justify-between items-center">
                <Badge tone={x.active ? "green" : "neutral"}>
                  {x.active ? "ATIVO" : "PAUSADO"}
                </Badge>
                <span className="text-[10px] text-stone-500 uppercase tracking-wider font-semibold">
                  {x.billing_cycle === "monthly" ? "Mensal" : x.billing_cycle === "yearly" ? "Anual" : x.billing_cycle}
                </span>
              </div>
              <h2 className="mt-3 font-display text-3xl">{x.name}</h2>
              <b>{brl(x.price)}</b>
              <p className="mt-4 text-xs text-stone-400">
                {x.active_subscribers} assinantes ativos
              </p>
              {x.benefits && Array.isArray(x.benefits) && x.benefits.length > 0 && (
                <ul className="mt-4 space-y-1 text-xs text-stone-400 list-disc pl-4">
                  {x.benefits.slice(0, 3).map((benefit: string, idx: number) => (
                    <li key={idx}>{benefit}</li>
                  ))}
                  {x.benefits.length > 3 && <li>+{x.benefits.length - 3} mais...</li>}
                </ul>
              )}
            </div>
            <div className="mt-6 flex flex-wrap gap-2 border-t border-stone-800 pt-4">
              <button
                onClick={() => handleEdit(x)}
                className="btn-secondary !min-h-9 !px-2.5 flex items-center gap-1.5 text-xs"
                title="Editar"
              >
                <Pencil size={13} />
                Editar
              </button>
              <button
                onClick={() => toggleActive(x)}
                className="btn-secondary !min-h-9 !px-2.5 flex items-center gap-1.5 text-xs"
                title={x.active ? "Pausar" : "Reativar"}
              >
                {x.active ? <Pause size={13} /> : <Play size={13} />}
                {x.active ? "Pausar" : "Reativar"}
              </button>
              <button
                onClick={() => handleArchive(x)}
                className="btn-secondary !min-h-9 !px-2.5 flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 hover:border-red-900 ml-auto"
                title="Arquivar"
              >
                <Archive size={13} />
                Arquivar
              </button>
            </div>
          </div>
        ))}
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Editar plano" : "Criar plano"}>
        <form onSubmit={save} className="space-y-4">
          <Input
            label="Nome"
            value={form.name}
            set={(v) => setForm({ ...form, name: v })}
          />
          <Input
            label="Preço"
            type="number"
            value={form.price}
            set={(v) => setForm({ ...form, price: v })}
          />
          <label className="block">
            <span className="mb-2 block text-xs font-bold">Ciclo de Cobrança</span>
            <select
              className="field"
              value={form.billingCycle}
              onChange={(e) => setForm({ ...form, billingCycle: e.target.value })}
            >
              <option value="monthly">Mensal</option>
              <option value="yearly">Anual</option>
              <option value="quarterly">Trimestral</option>
              <option value="semiannually">Semestral</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-2 block text-xs font-bold">
              Benefícios, um por linha
            </span>
            <textarea
              className="field min-h-28 py-3"
              value={form.benefits}
              onChange={(e) => setForm({ ...form, benefits: e.target.value })}
            />
          </label>
          <label className="flex items-center gap-3 rounded-2xl bg-warm p-4 text-xs font-bold">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(event) =>
                setForm({ ...form, active: event.target.checked })
              }
            />
            Plano ativo para novas assinaturas
          </label>
          <button className="btn-primary w-full">Salvar plano</button>
        </form>
      </Modal>
    </div>
  );
}

const formatDatetimeLocal = (isoString: string | null | undefined) => {
  if (!isoString) return "";
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const formatDateInput = (value: string | null | undefined) =>
  value ? String(value).slice(0, 10) : "";

const shortDate = (value: string | null | undefined) => {
  const date = formatDateInput(value);
  if (!date) return "";
  return new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR");
};

export function AdminCouponsPage() {
  const p = useLoad<any[]>("/api/portal?resource=admin-coupons");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({
    code: "",
    description: "",
    discountValue: "15",
    discountType: "percentage",
    startsAt: "",
    endsAt: "",
    usageLimit: "",
    active: true,
  });
  const [toast, setToast] = useState("");

  const handleCreate = () => {
    setEditing(null);
    setForm({
      code: "",
      description: "",
      discountValue: "15",
      discountType: "percentage",
      startsAt: "",
      endsAt: "",
      usageLimit: "",
      active: true,
    });
    setOpen(true);
  };

  const handleEdit = (coupon: any) => {
    setEditing(coupon);
    setForm({
      code: coupon.code,
      description: coupon.description || "",
      discountValue: String(coupon.discount_value),
      discountType: coupon.discount_type || "percentage",
      startsAt: formatDatetimeLocal(coupon.starts_at),
      endsAt: formatDatetimeLocal(coupon.ends_at),
      usageLimit: coupon.usage_limit ? String(coupon.usage_limit) : "",
      active: coupon.active !== false,
    });
    setOpen(true);
  };

  const toggleActive = async (coupon: any) => {
    try {
      await apiFetch("/api/portal?resource=admin-coupon", {
        method: "POST",
        body: JSON.stringify({
          id: coupon.id,
          code: coupon.code,
          description: coupon.description,
          discountValue: Number(coupon.discount_value),
          discountType: coupon.discount_type,
          startsAt: coupon.starts_at || null,
          endsAt: coupon.ends_at || null,
          usageLimit: coupon.usage_limit ? Number(coupon.usage_limit) : null,
          active: !coupon.active,
        }),
      });
      await p.reload();
      setToast(`Cupom ${!coupon.active ? "ativado" : "pausado"} com sucesso.`);
    } catch (err) {
      console.error("Toggle active error", err);
      setToast("Não foi possível alterar o status do cupom.");
    } finally {
      setTimeout(() => setToast(""), 2200);
    }
  };

  const handleArchive = async (coupon: any) => {
    if (!confirm(`Tem certeza de que deseja arquivar o cupom "${coupon.code}"? Esta ação não afetará o histórico de uso existente, mas impedirá novas utilizações.`))
      return;
    try {
      await apiFetch("/api/portal?resource=admin-coupon", {
        method: "POST",
        body: JSON.stringify({
          id: coupon.id,
          code: coupon.code,
          description: coupon.description,
          discountValue: Number(coupon.discount_value),
          discountType: coupon.discount_type,
          startsAt: coupon.starts_at || null,
          endsAt: coupon.ends_at || null,
          usageLimit: coupon.usage_limit ? Number(coupon.usage_limit) : null,
          active: coupon.active,
          archived: true,
        }),
      });
      await p.reload();
      setToast("Cupom arquivado com sucesso.");
    } catch (err) {
      console.error("Archive coupon error", err);
      setToast("Não foi possível arquivar o cupom.");
    } finally {
      setTimeout(() => setToast(""), 2200);
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch("/api/portal?resource=admin-coupon", {
        method: "POST",
        body: JSON.stringify({
          id: editing?.id || undefined,
          code: form.code,
          description: form.description,
          discountValue: Number(form.discountValue),
          discountType: form.discountType,
          startsAt: form.startsAt || null,
          endsAt: form.endsAt || null,
          usageLimit: form.usageLimit ? Number(form.usageLimit) : null,
          active: form.active,
        }),
      });
      await p.reload();
      setOpen(false);
      setToast(editing ? "Cupom atualizado com sucesso." : "Cupom criado com sucesso.");
    } catch (err) {
      console.error("Coupon save error", err);
      setToast(
        err instanceof Error
          ? err.message
          : "Não foi possível concluir a ação.",
      );
    } finally {
      setTimeout(() => setToast(""), 2200);
    }
  };

  if (p.loading) return <LoadingState />;
  return (
    <div>
      <Toast show={!!toast} message={toast} />
      <PageHeader
        eyebrow="PROMOÇÕES"
        title="Cupons"
        subtitle="Validade, limite e status reais."
        action={
          <button onClick={handleCreate} className="btn-primary">
            <Plus size={15} />
            Criar cupom
          </button>
        }
      />
      <div className="grid gap-4 md:grid-cols-2">
        {p.data?.length ? (
          p.data.map((x) => (
            <div key={x.id} className="surface p-6 flex flex-col justify-between">
              <div>
                <div className="flex justify-between">
                  <Badge tone={x.active ? "green" : "neutral"}>
                    {x.active ? "ATIVO" : "PAUSADO"}
                  </Badge>
                  <Tag className="text-champagne" />
                </div>
                <h2 className="mt-3 font-display text-3xl">{x.code}</h2>
                <p className="muted mt-2">{x.description}</p>
                <div className="mt-4 text-xs space-y-1 text-stone-400">
                  <div>
                    <b>Desconto:</b>{" "}
                    {x.discount_value}
                    {x.discount_type === "percentage"
                      ? "%"
                      : ` ${brl(x.discount_value)}`}
                  </div>
                  {x.starts_at && <div><b>Inicia em:</b> {dt(x.starts_at)}</div>}
                  {x.ends_at && <div><b>Expira em:</b> {dt(x.ends_at)}</div>}
                  {x.usage_limit && <div><b>Limite de Uso:</b> {x.usage_limit} utilizações</div>}
                </div>
              </div>
              <div className="mt-6 flex flex-wrap gap-2 border-t border-stone-800 pt-4">
                <button
                  onClick={() => handleEdit(x)}
                  className="btn-secondary !min-h-9 !px-2.5 flex items-center gap-1.5 text-xs"
                  title="Editar"
                >
                  <Pencil size={13} />
                  Editar
                </button>
                <button
                  onClick={() => toggleActive(x)}
                  className="btn-secondary !min-h-9 !px-2.5 flex items-center gap-1.5 text-xs"
                  title={x.active ? "Pausar" : "Reativar"}
                >
                  {x.active ? <Pause size={13} /> : <Play size={13} />}
                  {x.active ? "Pausar" : "Reativar"}
                </button>
                <button
                  onClick={() => handleArchive(x)}
                  className="btn-secondary !min-h-9 !px-2.5 flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 hover:border-red-900 ml-auto"
                  title="Arquivar"
                >
                  <Archive size={13} />
                  Arquivar
                </button>
              </div>
            </div>
          ))
        ) : (
          <EmptyState
            title="Nenhum cupom"
            text="Crie o primeiro cupom da Carol Sol."
          />
        )}
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Editar cupom" : "Criar cupom"}>
        <form onSubmit={save} className="space-y-4">
          <Input
            label="Código"
            value={form.code}
            set={(v) => setForm({ ...form, code: v })}
          />
          <Input
            label="Descrição"
            value={form.description}
            set={(v) => setForm({ ...form, description: v })}
          />
          <label className="block">
            <span className="mb-2 block text-xs font-bold">Tipo de Desconto</span>
            <select
              className="field"
              value={form.discountType}
              onChange={(e) => setForm({ ...form, discountType: e.target.value })}
            >
              <option value="percentage">Porcentagem (%)</option>
              <option value="fixed">Valor Fixo (R$)</option>
            </select>
          </label>
          <Input
            label={form.discountType === "percentage" ? "Desconto (%)" : "Desconto (R$)"}
            type="number"
            value={form.discountValue}
            set={(v) => setForm({ ...form, discountValue: v })}
          />
          <Input
            label="Inicia em (Opcional)"
            type="datetime-local"
            value={form.startsAt}
            set={(v) => setForm({ ...form, startsAt: v })}
          />
          <Input
            label="Expira em (Opcional)"
            type="datetime-local"
            value={form.endsAt}
            set={(v) => setForm({ ...form, endsAt: v })}
          />
          <Input
            label="Limite de Uso Total (Opcional)"
            type="number"
            value={form.usageLimit}
            set={(v) => setForm({ ...form, usageLimit: v })}
          />
          <label className="flex items-center gap-3 rounded-2xl bg-warm p-4 text-xs font-bold">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(event) =>
                setForm({ ...form, active: event.target.checked })
              }
            />
            Cupom ativo para uso
          </label>
          <button className="btn-primary w-full">Salvar cupom</button>
        </form>
      </Modal>
    </div>
  );
}

export function AdminPromotionsPage() {
  const p = useLoad<any[]>("/api/portal?resource=admin-promotions");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const emptyForm = {
    title: "",
    description: "",
    promotionalValue: "",
    originalValue: "",
    startsAt: "",
    endsAt: "",
    active: true,
    showOnSite: false,
    whatsappOnly: true,
    keywords: "",
  };
  const [form, setForm] = useState<any>(emptyForm);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  };

  const openEdit = (promotion: any) => {
    setEditing(promotion);
    setForm({
      title: promotion.title || "",
      description: promotion.description || "",
      promotionalValue: String(promotion.promotional_value || ""),
      originalValue:
        promotion.original_value == null ? "" : String(promotion.original_value),
      startsAt: formatDateInput(promotion.starts_at),
      endsAt: formatDateInput(promotion.ends_at),
      active: promotion.active !== false,
      showOnSite: promotion.show_on_site === true,
      whatsappOnly: promotion.whatsapp_only !== false,
      keywords: Array.isArray(promotion.keywords)
        ? promotion.keywords.join(", ")
        : "",
    });
    setOpen(true);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await apiFetch("/api/portal?resource=admin-promotion", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify({
          id: editing?.id,
          title: form.title,
          description: form.description,
          promotionalValue: Number(form.promotionalValue),
          originalValue: form.originalValue ? Number(form.originalValue) : null,
          startsAt: form.startsAt || null,
          endsAt: form.endsAt || null,
          active: form.active,
          showOnSite: form.showOnSite,
          whatsappOnly: form.whatsappOnly,
          keywords: form.keywords,
        }),
      });
      await p.reload();
      setOpen(false);
      setEditing(null);
      setToast(editing ? "Promocao atualizada." : "Promocao criada.");
    } catch (err) {
      console.error("Promotion save error", err);
      setToast(
        err instanceof Error ? err.message : "Nao foi possivel salvar a promocao.",
      );
    } finally {
      setSaving(false);
      setTimeout(() => setToast(""), 2400);
    }
  };

  const toggleActive = async (promotion: any) => {
    setSaving(true);
    try {
      await apiFetch("/api/portal?resource=admin-promotion", {
        method: "PATCH",
        body: JSON.stringify({
          id: promotion.id,
          title: promotion.title,
          description: promotion.description || "",
          promotionalValue: Number(promotion.promotional_value),
          originalValue:
            promotion.original_value == null ? null : Number(promotion.original_value),
          startsAt: promotion.starts_at || null,
          endsAt: promotion.ends_at || null,
          active: !promotion.active,
          showOnSite: promotion.show_on_site === true,
          whatsappOnly: promotion.whatsapp_only !== false,
          keywords: Array.isArray(promotion.keywords)
            ? promotion.keywords.join(", ")
            : "",
        }),
      });
      await p.reload();
      setToast(promotion.active ? "Promocao pausada." : "Promocao ativada.");
    } catch (err) {
      console.error("Promotion status error", err);
      setToast("Nao foi possivel alterar a promocao.");
    } finally {
      setSaving(false);
      setTimeout(() => setToast(""), 2200);
    }
  };

  const remove = async (promotion: any) => {
    if (!confirm(`Remover a promocao "${promotion.title}"?`)) return;
    setSaving(true);
    try {
      await apiFetch("/api/portal?resource=admin-promotion", {
        method: "DELETE",
        body: JSON.stringify({ id: promotion.id }),
      });
      await p.reload();
      setToast("Promocao removida.");
    } catch (err) {
      console.error("Promotion remove error", err);
      setToast("Nao foi possivel remover a promocao.");
    } finally {
      setSaving(false);
      setTimeout(() => setToast(""), 2400);
    }
  };

  if (p.loading) return <LoadingState />;
  return (
    <div>
      <Toast show={!!toast} message={toast} />
      <PageHeader
        eyebrow="MARKETING"
        title="Promocoes"
        subtitle="Campanhas consultadas pelo bot sem aparecer como servico."
        action={
          <button onClick={openCreate} className="btn-primary">
            <Plus size={15} />
            Nova promocao
          </button>
        }
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {p.data?.length ? (
          p.data.map((promotion) => {
            const keywords = Array.isArray(promotion.keywords)
              ? promotion.keywords
              : [];
            return (
              <article key={promotion.id} className="surface p-6">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-wrap gap-2">
                    <Badge tone={promotion.active ? "green" : "neutral"}>
                      {promotion.active ? "ATIVA" : "PAUSADA"}
                    </Badge>
                    {promotion.whatsapp_only && <Badge tone="gold">WHATSAPP</Badge>}
                    {promotion.show_on_site && <Badge tone="green">SITE</Badge>}
                  </div>
                  <Tag className="text-champagne" />
                </div>
                <h2 className="mt-4 font-display text-3xl">{promotion.title}</h2>
                <p className="muted mt-2">
                  {promotion.description || "Sem descricao cadastrada."}
                </p>
                <div className="mt-5 grid grid-cols-2 rounded-2xl bg-warm p-4 text-xs">
                  <span>
                    <b className="block">{brl(promotion.promotional_value)}</b>
                    <small>Promocional</small>
                  </span>
                  <span>
                    <b className="block">
                      {promotion.original_value ? brl(promotion.original_value) : "-"}
                    </b>
                    <small>Original</small>
                  </span>
                </div>
                <div className="mt-4 space-y-1 text-xs text-stone-500">
                  {promotion.starts_at && (
                    <div>Inicio: {shortDate(promotion.starts_at)}</div>
                  )}
                  {promotion.ends_at && (
                    <div>Termino: {shortDate(promotion.ends_at)}</div>
                  )}
                </div>
                {keywords.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {keywords.slice(0, 6).map((keyword: string) => (
                      <span key={keyword} className="chip">
                        {keyword}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-6 flex flex-wrap gap-2 border-t border-black/10 pt-4">
                  <button
                    type="button"
                    onClick={() => openEdit(promotion)}
                    className="btn-secondary !min-h-9 !px-2.5 text-xs"
                  >
                    <Pencil size={13} />
                    Editar
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => toggleActive(promotion)}
                    className="btn-secondary !min-h-9 !px-2.5 text-xs disabled:opacity-50"
                  >
                    {promotion.active ? <Pause size={13} /> : <Play size={13} />}
                    {promotion.active ? "Pausar" : "Ativar"}
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => remove(promotion)}
                    className="btn-secondary !min-h-9 !px-2.5 text-xs text-red-500 disabled:opacity-50"
                  >
                    <Trash2 size={13} />
                    Remover
                  </button>
                </div>
              </article>
            );
          })
        ) : (
          <EmptyState
            title="Nenhuma promocao"
            text="Crie campanhas para o bot consultar no WhatsApp."
          />
        )}
      </div>
      <Modal
        open={open}
        onClose={() => {
          if (!saving) setOpen(false);
        }}
        title={editing ? "Editar promocao" : "Nova promocao"}
      >
        <form onSubmit={save} className="space-y-4">
          <Input
            label="Titulo"
            value={form.title}
            set={(v) => setForm({ ...form, title: v })}
          />
          <label className="block">
            <span className="mb-2 block text-xs font-bold">Descricao</span>
            <textarea
              className="field min-h-24 py-3"
              value={form.description}
              onChange={(event) =>
                setForm({ ...form, description: event.target.value })
              }
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Valor promocional"
              type="number"
              value={form.promotionalValue}
              set={(v) => setForm({ ...form, promotionalValue: v })}
            />
            <Input
              label="Valor original"
              type="number"
              value={form.originalValue}
              set={(v) => setForm({ ...form, originalValue: v })}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Inicio"
              type="date"
              value={form.startsAt}
              set={(v) => setForm({ ...form, startsAt: v })}
            />
            <Input
              label="Termino"
              type="date"
              value={form.endsAt}
              set={(v) => setForm({ ...form, endsAt: v })}
            />
          </div>
          <label className="block">
            <span className="mb-2 block text-xs font-bold">
              Palavras-chave
            </span>
            <textarea
              className="field min-h-20 py-3"
              value={form.keywords}
              onChange={(event) =>
                setForm({ ...form, keywords: event.target.value })
              }
              placeholder="promocao, desconto, fita adesiva, mega hair"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex items-center gap-3 rounded-2xl bg-warm p-4 text-xs font-bold">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(event) =>
                  setForm({ ...form, active: event.target.checked })
                }
              />
              Ativa
            </label>
            <label className="flex items-center gap-3 rounded-2xl bg-warm p-4 text-xs font-bold">
              <input
                type="checkbox"
                checked={form.showOnSite}
                onChange={(event) =>
                  setForm({ ...form, showOnSite: event.target.checked })
                }
              />
              Exibir no site
            </label>
            <label className="flex items-center gap-3 rounded-2xl bg-warm p-4 text-xs font-bold">
              <input
                type="checkbox"
                checked={form.whatsappOnly}
                onChange={(event) =>
                  setForm({ ...form, whatsappOnly: event.target.checked })
                }
              />
              So WhatsApp
            </label>
          </div>
          <button
            disabled={saving || !form.title.trim() || !form.promotionalValue}
            className="btn-primary w-full disabled:opacity-50"
          >
            {saving ? "Salvando..." : "Salvar promocao"}
          </button>
        </form>
      </Modal>
    </div>
  );
}

export function AdminAppointmentsPage() {
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const monthStart = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
  const monthEnd = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 1);
  const p = useLoad<{ appointments: any[] }>(
    `/api/data?resource=appointments&dateFrom=${dateKey(monthStart)}&dateTo=${dateKey(monthEnd)}`,
  );
  const bootstrap = useLoad<{ services: any[]; professionals: any[] }>(
    "/api/data?resource=bootstrap",
  );
  const clientsLoad = useLoad<any[]>("/api/portal?resource=clients");
  const schedule = useLoad<{ professionals: any[]; blocked: any[] }>(
    "/api/portal?resource=admin-schedule",
  );
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");
  const [appointmentOpen, setAppointmentOpen] = useState(false);
  const [appointmentSaving, setAppointmentSaving] = useState(false);
  const [editingAppointment, setEditingAppointment] = useState<any>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailData, setDetailData] = useState<any>(null);
  const [filters, setFilters] = useState({
    professionalId: "",
    serviceId: "",
    status: "",
  });
  const [appointmentForm, setAppointmentForm] = useState({
    clientId: "",
    serviceId: "",
    professionalId: "",
    date: dateKey(),
    time: "09:00",
    status: "requested",
    notes: "",
    cancellationReason: "",
  });
  const [blockOpen, setBlockOpen] = useState(false);
  const [blockSaving, setBlockSaving] = useState(false);
  const [blockForm, setBlockForm] = useState({
    professionalId: "",
    date: dateKey(),
    start: "09:00",
    end: "10:00",
    reason: "",
  });
  useEffect(() => {
    const first =
      schedule.data?.professionals?.find((item: any) => item.active !== false) ||
      schedule.data?.professionals?.[0];
    if (first && !blockForm.professionalId) {
      setBlockForm((current) => ({ ...current, professionalId: first.id }));
    }
  }, [schedule.data, blockForm.professionalId]);
  if (p.loading || schedule.loading || bootstrap.loading || clientsLoad.loading)
    return <LoadingState />;
  const blockedItems = (schedule.data?.blocked || []).map((b: any) => ({
    id: b.id,
    starts_at: b.starts_at,
    ends_at: b.ends_at,
    status: "blocked",
    client: b.reason || "Bloqueio",
    service: "Horário Bloqueado",
    professional: b.professional,
    duration: "",
    value: ""
  }));
  const items = [...(p.data?.appointments || []), ...blockedItems];
  const professionals = schedule.data?.professionals || [];
  const activeProfessionals = bootstrap.data?.professionals || [];
  const services = bootstrap.data?.services || [];
  const clients = clientsLoad.data || [];
  const blocked = schedule.data?.blocked || [];
  const professionalFilterOptions = [
    ...professionals.map((professional: any) => ({
      id: professional.id,
      name: professional.name,
    })),
    ...items
      .filter(
        (item: any) =>
          item.professional_id &&
          !professionals.some((professional: any) => professional.id === item.professional_id),
      )
      .map((item: any) => ({
        id: item.professional_id,
        name: item.professional || "Profissional",
      })),
  ];
  const serviceFilterOptions = [
    ...services.map((service: any) => ({ id: service.id, name: service.name })),
    ...items
      .filter(
        (item: any) =>
          item.service_id &&
          !services.some((service: any) => service.id === item.service_id),
      )
      .map((item: any) => ({
        id: item.service_id,
        name: item.service || "Serviço",
      })),
  ];
  const filteredItems = items.filter((item: any) => {
    if (filters.professionalId && item.professional_id !== filters.professionalId)
      return false;
    if (filters.serviceId && item.service_id !== filters.serviceId) return false;
    if (filters.status && item.status !== filters.status) return false;
    return true;
  });
  const filteredBlocked = blocked.filter((block: any) =>
    filters.professionalId ? block.professional_id === filters.professionalId : true,
  );
  const hasFilters = Boolean(
    filters.professionalId || filters.serviceId || filters.status,
  );
  const monthLabel = anchorDate.toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
  const moveMonth = (direction: -1 | 1) => {
    setAnchorDate((current) => {
      const next = new Date(current);
      next.setMonth(current.getMonth() + direction, 1);
      return next;
    });
  };
  const openNewAppointment = () => {
    setEditingAppointment(null);
    setAppointmentForm({
      clientId: clients[0]?.id || "",
      serviceId: services[0]?.id || "",
      professionalId: activeProfessionals[0]?.id || professionals[0]?.id || "",
      date: dateKey(),
      time: "09:00",
      status: "requested",
      notes: "",
      cancellationReason: "",
    });
    setAppointmentOpen(true);
  };
  const openEditAppointment = (appointment: any) => {
    setEditingAppointment(appointment);
    setAppointmentForm({
      clientId: appointment.client_id || "",
      serviceId: appointment.service_id || "",
      professionalId: appointment.professional_id || "",
      date: saoPauloDateKey(appointment.starts_at),
      time: saoPauloTimeKey(appointment.starts_at),
      status: appointment.status || "requested",
      notes: appointment.notes || "",
      cancellationReason: appointment.cancellation_reason || "",
    });
    setAppointmentOpen(true);
  };
  const openAppointmentDetail = async (appointment: any) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailData(null);
    try {
      const data = await apiFetch<any>(
        `/api/data?resource=appointment-detail&id=${encodeURIComponent(appointment.id)}`,
      );
      setDetailData(data);
    } catch (e) {
      console.error("Admin appointment detail error", e);
      setToast(e instanceof Error ? e.message : "Nao foi possivel carregar o detalhe.");
      setDetailOpen(false);
      setTimeout(() => setToast(""), 2600);
    } finally {
      setDetailLoading(false);
    }
  };
  const exportAppointments = () => {
    const header = [
      "Data",
      "Hora",
      "Cliente",
      "Telefone cliente",
      "Servico",
      "Profissional",
      "Telefone profissional",
      "Status",
      "Valor",
      "Duracao",
      "Local",
      "Codigo",
      "Observacoes",
    ];
    const rows = filteredItems.map((item: any) => [
      item.date,
      item.time,
      item.client,
      item.client_phone,
      item.service,
      item.professional,
      item.professional_phone,
      labels[item.status] || item.status,
      item.value || brl(item.estimated_value),
      item.duration,
      item.location || "Carol Sol",
      item.booking_code || item.id,
      item.notes || "",
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map(csvCell).join(";"))
      .join("\r\n");
    const blob = new Blob([`\uFEFF${csv}`], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `agenda-carol-sol-${dateKey(monthStart)}-${dateKey(monthEnd)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setToast("Agenda exportada em CSV.");
    setTimeout(() => setToast(""), 2200);
  };
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
      cancellationReason: appointmentForm.cancellationReason,
    };
    try {
      await apiFetch("/api/data?resource=appointments", {
        method: editingAppointment ? "PATCH" : "POST",
        body: JSON.stringify(
          editingAppointment
            ? { id: editingAppointment.id, ...payload }
            : payload,
        ),
      });
      await p.reload();
      setAppointmentOpen(false);
      setEditingAppointment(null);
      setToast(
        editingAppointment
          ? "Agendamento atualizado com sucesso."
          : "Agendamento criado com sucesso.",
      );
    } catch (e) {
      console.error("Admin appointment save error", e);
      setToast(e instanceof Error ? e.message : "Nao foi possivel salvar o agendamento.");
    } finally {
      setAppointmentSaving(false);
      setTimeout(() => setToast(""), 2600);
    }
  };
  const change = async (id: string, status: string) => {
    let note = "";
    if (["cancelled", "no_show"].includes(status)) {
      const msg = status === "no_show"
        ? "Registrar Ausência: informe o motivo da ausência da cliente (ex: não respondeu, imprevisto...):"
        : "Cancelar Agendamento: informe o motivo do cancelamento:";
      const res = prompt(msg);
      if (res === null) return;
      note = res;
    }
    setBusy(id);
    try {
      await apiFetch("/api/data?resource=appointments", {
        method: "PATCH",
        body: JSON.stringify({ id, status, note, cancellationReason: note, statusNote: note }),
      });
      await p.reload();
      setToast("Agendamento atualizado com sucesso.");
    } catch (e) {
      console.error("Admin appointment update error", e);
      setToast(e instanceof Error ? e.message : "Não foi possível atualizar o status.");
    } finally {
      setBusy("");
      setTimeout(() => setToast(""), 2600);
    }
  };
  const saveBlock = async (event: FormEvent) => {
    event.preventDefault();
    setBlockSaving(true);
    try {
      await apiFetch("/api/portal?resource=blocked-schedule", {
        method: "POST",
        body: JSON.stringify({
          professionalId: blockForm.professionalId,
          startsAt: `${blockForm.date}T${blockForm.start}:00-03:00`,
          endsAt: `${blockForm.date}T${blockForm.end}:00-03:00`,
          reason: blockForm.reason,
        }),
      });
      await schedule.reload();
      setBlockOpen(false);
      setToast("Horário bloqueado com sucesso.");
    } catch (e) {
      console.error("Admin blocked schedule error", e);
      setToast(e instanceof Error ? e.message : "Não foi possível bloquear o horário.");
    } finally {
      setBlockSaving(false);
      setTimeout(() => setToast(""), 2600);
    }
  };
  const removeBlock = async (id: string) => {
    setBusy(id);
    try {
      await apiFetch("/api/portal?resource=blocked-schedule", {
        method: "DELETE",
        body: JSON.stringify({ id }),
      });
      await schedule.reload();
      setToast("Bloqueio removido.");
    } catch (e) {
      console.error("Admin blocked schedule delete error", e);
      setToast(e instanceof Error ? e.message : "Não foi possível remover o bloqueio.");
    } finally {
      setBusy("");
      setTimeout(() => setToast(""), 2600);
    }
  };
  return (
    <div>
      <Toast show={!!toast} message={toast} />
      <PageHeader
        eyebrow="OPERAÇÃO"
        title="Agendamentos"
        subtitle="Agenda global persistida no Neon."
        action={
          <button onClick={openNewAppointment} className="btn-primary">
            <Plus size={15} />
            Novo agendamento
          </button>
        }
      />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm font-bold capitalize">{monthLabel}</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Mes anterior"
            onClick={() => moveMonth(-1)}
            className="btn-secondary !min-h-10 !px-3"
          >
            <ChevronLeft size={15} />
          </button>
          <button
            type="button"
            onClick={() => setAnchorDate(new Date())}
            className="btn-secondary !min-h-10 !px-4"
          >
            Hoje
          </button>
          <button
            type="button"
            disabled={!filteredItems.length}
            onClick={exportAppointments}
            className="btn-secondary !min-h-10 !px-4 disabled:opacity-50"
          >
            <Download size={15} />
            Exportar CSV
          </button>
          <button
            type="button"
            aria-label="Proximo mes"
            onClick={() => moveMonth(1)}
            className="btn-secondary !min-h-10 !px-3"
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
      <section className="surface mb-5 p-5">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto]">
          <label className="block">
            <span className="mb-2 block text-xs font-bold">Profissional</span>
            <select
              className="field"
              value={filters.professionalId}
              onChange={(event) =>
                setFilters({ ...filters, professionalId: event.target.value })
              }
            >
              <option value="">Todas</option>
              {professionalFilterOptions.map((professional: any) => (
                <option key={professional.id} value={professional.id}>
                  {professional.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-2 block text-xs font-bold">Serviço</span>
            <select
              className="field"
              value={filters.serviceId}
              onChange={(event) =>
                setFilters({ ...filters, serviceId: event.target.value })
              }
            >
              <option value="">Todos</option>
              {serviceFilterOptions.map((service: any) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-2 block text-xs font-bold">Status</span>
            <select
              className="field"
              value={filters.status}
              onChange={(event) =>
                setFilters({ ...filters, status: event.target.value })
              }
            >
              <option value="">Todos</option>
              {appointmentStatusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <button
              type="button"
              disabled={!hasFilters}
              onClick={() =>
                setFilters({ professionalId: "", serviceId: "", status: "" })
              }
              className="btn-secondary w-full disabled:opacity-50"
            >
              Limpar
            </button>
          </div>
        </div>
        <p className="mt-3 text-xs text-stone-400">
          Mostrando {filteredItems.length} de {items.length} agendamentos do mês.
        </p>
      </section>
      <div className="mb-5">
        <AppointmentCalendar
          month={anchorDate}
          items={filteredItems}
          statusLabels={labels}
          statusOptions={appointmentStatusOptions}
          updatingId={busy}
          onStatusChange={change}
          onOpenDetails={openAppointmentDetail}
        />
      </div>

      {filteredItems.length ? (
        <section className="surface overflow-hidden">
          {filteredItems.map((a: any) => (
            <div
              key={a.id}
              className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-black/5 p-5 sm:grid-cols-[.6fr_1fr_1fr_.8fr_auto]"
            >
              <span className="text-xs">
                {a.date} {a.time}
              </span>
              <b className="hidden text-xs sm:block">{a.client}</b>
              <span className="hidden text-xs sm:block">
                {a.service} • {a.professional}
              </span>
              <Badge tone={tone(a.status)}>
                {labels[a.status] || a.status}
              </Badge>
              <span className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  disabled={busy === a.id}
                  onClick={() => openAppointmentDetail(a)}
                  className="btn-secondary !min-h-9 !px-3"
                >
                  Detalhes
                </button>
                <button
                  type="button"
                  disabled={busy === a.id}
                  onClick={() => openEditAppointment(a)}
                  className="btn-secondary !min-h-9 !px-3"
                >
                  <Pencil size={14} />
                  Editar
                </button>
                <select
                  disabled={busy === a.id}
                  value={a.status}
                  onChange={(e) => change(a.id, e.target.value)}
                  className="rounded-xl border border-black/10 bg-white p-2 text-xs"
                >
                  <option value="requested">Solicitado</option>
                  <option value="awaiting_payment">Aguardando pagamento</option>
                  <option value="pending_deposit">Aguardando sinal</option>
                  <option value="confirmed">Confirmado</option>
                  <option value="in_service">Em atendimento</option>
                  <option value="completed">Finalizado</option>
                  <option value="rescheduled">Reagendado</option>
                  <option value="reschedule_requested">
                    Reagendamento solicitado
                  </option>
                  <option value="cancelled">Cancelado</option>
                  <option value="no_show">Faltou</option>
                </select>
              </span>
            </div>
          ))}
        </section>
      ) : (
        <EmptyState
          title="Nenhum agendamento"
          text={hasFilters ? "Nenhum registro encontrado com os filtros atuais." : "A agenda está vazia."}
        />
      )}
      <Modal
        open={detailOpen}
        onClose={() => {
          setDetailOpen(false);
          setDetailData(null);
        }}
        title="Detalhes do agendamento"
      >
        {detailLoading ? (
          <div className="p-8 text-center text-xs text-stone-400">
            Carregando detalhes...
          </div>
        ) : detailData?.appointment ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <span>
                <b className="block font-display text-3xl leading-none">
                  {detailData.appointment.client_whatsapp_title || detailData.appointment.client || "Cliente"}
                </b>
                {detailData.appointment.client && detailData.appointment.client !== detailData.appointment.client_whatsapp_title && (
                  <span className="mt-1 block text-sm font-semibold text-stone-600">
                    Nome: {detailData.appointment.client}
                  </span>
                )}
                <span className="mt-2 block text-xs text-stone-500">
                  {detailData.appointment.service} -{" "}
                  {dt(detailData.appointment.starts_at)}
                </span>
              </span>
              <Badge tone={tone(detailData.appointment.status)}>
                {labels[detailData.appointment.status] ||
                  detailData.appointment.status}
              </Badge>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Mini label="Profissional" value={detailData.appointment.professional || "-"} />
              <Mini label="Valor" value={detailData.appointment.value || brl(detailData.appointment.estimated_value)} />
              <Mini label="Duração" value={detailData.appointment.duration || "-"} />
              <Mini label="Local" value={detailData.appointment.location || "Carol Sol"} />
              <Mini label="Telefone cliente" value={detailData.appointment.client_phone || "-"} />
              <Mini label="Código" value={detailData.appointment.booking_code || detailData.appointment.id} />
            </div>
            {detailData.appointment.notes && (
              <div className="rounded-2xl bg-warm p-4 text-xs">
                <span className="text-stone-400">Observações</span>
                <p className="mt-1 font-semibold">{detailData.appointment.notes}</p>
              </div>
            )}
            <section>
              <SectionHeading title="Pagamentos vinculados" />
              {detailData.payments?.length ? (
                <div className="space-y-3">
                  {detailData.payments.map((payment: any) => (
                    <div key={payment.id} className="rounded-2xl bg-warm p-4 text-xs">
                      <div className="flex items-center justify-between gap-3">
                        <b>{brl(payment.amount)}</b>
                        <Badge tone={tone(payment.status)}>
                          {labels[payment.status] || payment.status}
                        </Badge>
                      </div>
                      <p className="mt-1 text-stone-500">
                        {payment.provider || payment.method || "manual"} - {dt(payment.created_at)}
                      </p>
                      {payment.history?.length ? (
                        <div className="mt-3 space-y-2">
                          {payment.history.map((h: any, index: number) => (
                            <p key={index} className="text-[10px] text-stone-500">
                              {dt(h.created_at)}: {h.old_status || "-"} {" -> "} {h.new_status}
                              {h.actor ? ` por ${h.actor}` : ""}
                              {h.notes ? ` - ${h.notes}` : ""}
                            </p>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-2xl bg-warm p-4 text-xs text-stone-500">
                  Nenhum pagamento vinculado.
                </p>
              )}
            </section>
            <section>
              <SectionHeading title="Histórico de status" />
              {detailData.history?.length ? (
                <div className="space-y-2">
                  {detailData.history.map((item: any) => (
                    <div key={item.id} className="rounded-2xl bg-warm p-4 text-xs">
                      <b>
                        {labels[item.from_status] || item.from_status || "Novo"} {" -> "}
                        {labels[item.to_status] || item.to_status}
                      </b>
                      <p className="mt-1 text-stone-500">
                        {dt(item.created_at)}
                        {item.actor ? ` por ${item.actor}` : ""}
                        {item.note ? ` - ${item.note}` : ""}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-2xl bg-warm p-4 text-xs text-stone-500">
                  Nenhum histórico registrado.
                </p>
              )}
            </section>
            {detailData.technicalRecord && (
              <section>
                <SectionHeading title="Ficha técnica" />
                <div className="rounded-2xl bg-warm p-4 text-xs">
                  <b>{detailData.technicalRecord.method || "Método não informado"}</b>
                  <p className="mt-1 text-stone-500">
                    Próxima manutenção: {dt(detailData.technicalRecord.next_maintenance_date)}
                  </p>
                  <p className="mt-1 text-stone-500">
                    Valor final: {brl(detailData.technicalRecord.final_value)}
                  </p>
                </div>
              </section>
            )}
            <section>
              <SectionHeading title="Notificações" />
              {detailData.notifications?.length ? (
                <div className="space-y-2">
                  {detailData.notifications.map((n: any) => (
                    <div key={n.id} className="rounded-2xl bg-warm p-4 text-xs">
                      <b>{n.title}</b>
                      <p className="mt-1 text-stone-500">{n.body}</p>
                      <p className="mt-1 text-[10px] text-stone-400">
                        {dt(n.created_at)} {n.read_at ? "- lida" : "- não lida"}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-2xl bg-warm p-4 text-xs text-stone-500">
                  Nenhuma notificação vinculada.
                </p>
              )}
            </section>
            {detailData.photos?.length ? (
              <section>
                <SectionHeading title="Fotos" />
                <div className="grid grid-cols-3 gap-2">
                  {detailData.photos.map((photo: any) => (
                    <a
                      key={photo.id}
                      href={photo.storage_path}
                      target="_blank"
                      rel="noreferrer"
                      className="aspect-square overflow-hidden rounded-2xl bg-warm"
                    >
                      <img
                        src={photo.storage_path}
                        alt={photo.kind}
                        className="h-full w-full object-cover"
                      />
                    </a>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        ) : (
          <p className="p-6 text-center text-xs text-stone-400">
            Nenhum detalhe disponível.
          </p>
        )}
      </Modal>
      <Modal
        open={appointmentOpen}
        onClose={() => {
          if (!appointmentSaving) {
            setAppointmentOpen(false);
            setEditingAppointment(null);
          }
        }}
        title={editingAppointment ? "Editar agendamento" : "Novo agendamento"}
      >
        <form onSubmit={saveAppointment} className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-xs font-bold">Cliente</span>
            <select
              className="field disabled:opacity-60"
              value={appointmentForm.clientId}
              disabled={Boolean(editingAppointment)}
              onChange={(event) =>
                setAppointmentForm({
                  ...appointmentForm,
                  clientId: event.target.value,
                })
              }
            >
              <option value="">Selecione a cliente</option>
              {clients.map((client: any) => (
                <option key={client.id} value={client.id}>
                  {client.name} {client.phone ? `- ${client.phone}` : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-xs font-bold">Serviço</span>
              <select
                className="field"
                value={appointmentForm.serviceId}
                onChange={(event) =>
                  setAppointmentForm({
                    ...appointmentForm,
                    serviceId: event.target.value,
                  })
                }
              >
                <option value="">Selecione</option>
                {services.map((service: any) => (
                  <option key={service.id} value={service.id}>
                    {service.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-2 block text-xs font-bold">Profissional</span>
              <select
                className="field"
                value={appointmentForm.professionalId}
                onChange={(event) =>
                  setAppointmentForm({
                    ...appointmentForm,
                    professionalId: event.target.value,
                  })
                }
              >
                <option value="">Selecione</option>
                {activeProfessionals.map((professional: any) => (
                  <option key={professional.id} value={professional.id}>
                    {professional.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Data"
              type="date"
              value={appointmentForm.date}
              set={(value) =>
                setAppointmentForm({ ...appointmentForm, date: value })
              }
            />
            <Input
              label="Horário"
              type="time"
              value={appointmentForm.time}
              set={(value) =>
                setAppointmentForm({ ...appointmentForm, time: value })
              }
            />
          </div>
          <label className="block">
            <span className="mb-2 block text-xs font-bold">Status</span>
            <select
              className="field"
              value={appointmentForm.status}
              onChange={(event) =>
                setAppointmentForm({
                  ...appointmentForm,
                  status: event.target.value,
                })
              }
            >
              {appointmentStatusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {["cancelled", "no_show"].includes(appointmentForm.status) && (
            <label className="block">
              <span className="mb-2 block text-xs font-bold">Motivo</span>
              <textarea
                className="field min-h-20 py-3"
                value={appointmentForm.cancellationReason}
                onChange={(event) =>
                  setAppointmentForm({
                    ...appointmentForm,
                    cancellationReason: event.target.value,
                  })
                }
              />
            </label>
          )}
          <label className="block">
            <span className="mb-2 block text-xs font-bold">Observações</span>
            <textarea
              className="field min-h-24 py-3"
              value={appointmentForm.notes}
              onChange={(event) =>
                setAppointmentForm({
                  ...appointmentForm,
                  notes: event.target.value,
                })
              }
            />
          </label>
          <button
            disabled={
              appointmentSaving ||
              !appointmentForm.clientId ||
              !appointmentForm.serviceId ||
              !appointmentForm.professionalId ||
              !appointmentForm.date ||
              !appointmentForm.time
            }
            className="btn-primary w-full disabled:opacity-50"
          >
            {appointmentSaving
              ? "Salvando..."
              : editingAppointment
                ? "Salvar alterações"
                : "Criar agendamento"}
          </button>
        </form>
      </Modal>

    </div>
  );
}

export function AdminProfessionalsPage() {
  const p = useLoad<any[]>("/api/portal?resource=admin-professionals");
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const [profileForm, setProfileForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    bio: "",
    specialties: "",
    commissionRate: "30",
    password: "",
    active: true,
  });

  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleProfessionalId, setScheduleProfessionalId] = useState("");
  const [scheduleSlots, setScheduleSlots] = useState<any[]>([]);
  const [toast, setToast] = useState("");

  const handleCreate = () => {
    setEditing(null);
    setProfileForm({
      fullName: "",
      email: "",
      phone: "",
      bio: "",
      specialties: "",
      commissionRate: "30",
      password: "",
      active: true,
    });
    setProfileModalOpen(true);
  };

  const handleEditProfile = (professional: any) => {
    setEditing(professional);
    setProfileForm({
      fullName: professional.full_name,
      email: professional.email || "",
      phone: professional.phone || "",
      bio: professional.bio || "",
      specialties: Array.isArray(professional.specialties)
        ? professional.specialties.join(", ")
        : "",
      commissionRate: String(professional.commission_rate),
      password: "",
      active: professional.active !== false,
    });
    setProfileModalOpen(true);
  };

  const handleOpenSchedule = async (professional: any) => {
    setScheduleProfessionalId(professional.id);
    setScheduleLoading(true);
    setScheduleModalOpen(true);
    try {
      const result = (await apiFetch(`/api/portal?resource=admin-professional&id=${professional.id}`)) as any;
      const availability = result.data.availability || [];
      const slots = Array.from({ length: 7 }, (_, i) => {
        const existing = availability.find((s: any) => s.weekday === i);
        return {
          weekday: i,
          active: !!existing && existing.active !== false,
          startsAt: existing ? existing.starts_at.slice(0, 5) : "09:00",
          endsAt: existing ? existing.ends_at.slice(0, 5) : "18:00",
        };
      });
      setScheduleSlots(slots);
    } catch (err) {
      console.error("Load schedule error", err);
      setToast("Não foi possível carregar a jornada.");
      setScheduleModalOpen(false);
    } finally {
      setScheduleLoading(false);
    }
  };

  const toggleActive = async (professional: any) => {
    try {
      await apiFetch("/api/portal?resource=admin-professional", {
        method: "POST",
        body: JSON.stringify({
          id: professional.id,
          fullName: professional.full_name,
          email: professional.email,
          phone: professional.phone,
          bio: professional.bio,
          specialties: professional.specialties,
          commissionRate: professional.commission_rate,
          active: !professional.active,
        }),
      });
      await p.reload();
      setToast(`Profissional ${!professional.active ? "ativada" : "desativada"} com sucesso.`);
    } catch (err) {
      console.error("Toggle active error", err);
      setToast("Não foi possível alterar o status da profissional.");
    } finally {
      setTimeout(() => setToast(""), 2200);
    }
  };

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const specialtiesArray = profileForm.specialties
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      await apiFetch("/api/portal?resource=admin-professional", {
        method: "POST",
        body: JSON.stringify({
          id: editing?.id || undefined,
          fullName: profileForm.fullName,
          email: profileForm.email,
          phone: profileForm.phone || null,
          bio: profileForm.bio,
          specialties: specialtiesArray,
          commissionRate: Number(profileForm.commissionRate),
          password: profileForm.password || undefined,
          active: profileForm.active,
        }),
      });
      await p.reload();
      setProfileModalOpen(false);
      setToast(editing ? "Perfil atualizado com sucesso." : "Profissional cadastrada com sucesso.");
    } catch (err) {
      console.error("Save profile error", err);
      setToast(
        err instanceof Error ? err.message : "Não foi possível concluir a ação."
      );
    } finally {
      setTimeout(() => setToast(""), 2200);
    }
  };

  const saveSchedule = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch("/api/portal?resource=admin-professional-availability", {
        method: "POST",
        body: JSON.stringify({
          professionalId: scheduleProfessionalId,
          availability: scheduleSlots.filter((s) => s.active),
        }),
      });
      setScheduleModalOpen(false);
      setToast("Jornada semanal salva com sucesso.");
    } catch (err) {
      console.error("Save schedule error", err);
      setToast(
        err instanceof Error ? err.message : "Não foi possível salvar a jornada."
      );
    } finally {
      setTimeout(() => setToast(""), 2200);
    }
  };

  if (p.loading) return <LoadingState />;
  return (
    <div>
      <Toast show={!!toast} message={toast} />
      <PageHeader
        eyebrow="EQUIPE"
        title="Profissionais"
        subtitle="Equipe, avaliações e atendimentos reais."
        action={
          <button onClick={handleCreate} className="btn-primary">
            <Plus size={15} />
            Cadastrar profissional
          </button>
        }
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {p.data?.length ? (
          p.data.map((x) => (
            <div key={x.id} className="surface p-6 flex flex-col justify-between">
              <div>
                <div className="flex gap-3">
                  <Avatar src={x.avatar_url} name={x.full_name} size="lg" />
                  <span className="flex-1">
                    <h2 className="font-display text-2xl">{x.full_name}</h2>
                    <p className="text-[10px] text-stone-400">{x.phone || "Sem telefone"}</p>
                    <p className="text-[10px] text-stone-500">{x.email}</p>
                  </span>
                  <Badge tone={x.active ? "green" : "neutral"}>
                    {x.active ? "ATIVA" : "INATIVA"}
                  </Badge>
                </div>
                <p className="muted mt-4 text-xs line-clamp-3">
                  {x.bio || "Sem biografia cadastrada."}
                </p>
                {x.specialties && Array.isArray(x.specialties) && x.specialties.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {x.specialties.map((s: string, idx: number) => (
                      <span key={idx} className="bg-stone-800 text-[10px] text-stone-300 px-2 py-0.5 rounded-md font-medium">
                        {s}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-4 grid grid-cols-3 rounded-2xl bg-warm p-4 text-center text-xs">
                  <span>
                    <b className="block">{x.appointments}</b>
                    <small>Atendimentos</small>
                  </span>
                  <span>
                    <b className="block">{x.rating}</b>
                    <small>Avaliação</small>
                  </span>
                  <span>
                    <b className="block">{x.commission_rate}%</b>
                    <small>Comissão</small>
                  </span>
                </div>
              </div>
              <div className="mt-6 flex flex-wrap gap-2 border-t border-stone-800 pt-4">
                <button
                  onClick={() => handleEditProfile(x)}
                  className="btn-secondary !min-h-9 !px-2.5 flex items-center gap-1.5 text-xs"
                  title="Editar Perfil"
                >
                  <Pencil size={13} />
                  Perfil
                </button>
                <button
                  onClick={() => handleOpenSchedule(x)}
                  className="btn-secondary !min-h-9 !px-2.5 flex items-center gap-1.5 text-xs"
                  title="Jornada Semanal"
                >
                  <CalendarDays size={13} />
                  Jornada
                </button>
                <button
                  onClick={() => toggleActive(x)}
                  className="btn-secondary !min-h-9 !px-2.5 flex items-center gap-1.5 text-xs"
                  title={x.active ? "Desativar" : "Ativar"}
                >
                  {x.active ? <Pause size={13} /> : <Play size={13} />}
                  {x.active ? "Desativar" : "Ativar"}
                </button>
              </div>
            </div>
          ))
        ) : (
          <EmptyState
            title="Nenhuma profissional"
            text="Cadastre a equipe para iniciar."
          />
        )}
      </div>

      <Modal open={profileModalOpen} onClose={() => setProfileModalOpen(false)} title={editing ? "Editar profissional" : "Cadastrar profissional"}>
        <form onSubmit={saveProfile} className="space-y-4">
          <Input
            label="Nome Completo"
            value={profileForm.fullName}
            set={(v) => setProfileForm({ ...profileForm, fullName: v })}
          />
          <Input
            label="E-mail"
            type="email"
            value={profileForm.email}
            set={(v) => setProfileForm({ ...profileForm, email: v })}
          />
          <Input
            label="Telefone (Opcional)"
            value={profileForm.phone}
            set={(v) => setProfileForm({ ...profileForm, phone: v })}
          />
          <Input
            label="Senha (Mínimo 8 caracteres)"
            type="password"
            value={profileForm.password}
            set={(v) => setProfileForm({ ...profileForm, password: v })}
            placeholder={editing ? "Deixe em branco para não alterar" : "CarolSol@2026"}
          />
          <Input
            label="Comissão (%)"
            type="number"
            value={profileForm.commissionRate}
            set={(v) => setProfileForm({ ...profileForm, commissionRate: v })}
          />
          <Input
            label="Especialidades (separadas por vírgula)"
            value={profileForm.specialties}
            set={(v) => setProfileForm({ ...profileForm, specialties: v })}
            placeholder="Queratina, Ponto Americano, Mega Hair"
          />
          <label className="block">
            <span className="mb-2 block text-xs font-bold">Biografia</span>
            <textarea
              className="field min-h-20 py-2.5"
              value={profileForm.bio}
              onChange={(e) => setProfileForm({ ...profileForm, bio: e.target.value })}
              placeholder="Fale brevemente sobre a profissional..."
            />
          </label>
          <label className="flex items-center gap-3 rounded-2xl bg-warm p-4 text-xs font-bold">
            <input
              type="checkbox"
              checked={profileForm.active}
              onChange={(event) =>
                setProfileForm({ ...profileForm, active: event.target.checked })
              }
            />
            Profissional ativa para novos agendamentos
          </label>
          <button className="btn-primary w-full">Salvar profissional</button>
        </form>
      </Modal>

      <Modal open={scheduleModalOpen} onClose={() => setScheduleModalOpen(false)} title="Jornada semanal">
        {scheduleLoading ? (
          <LoadingState />
        ) : (
          <form onSubmit={saveSchedule} className="space-y-4">
            <div className="space-y-3">
              {["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"].map((dayName, i) => {
                const slot = scheduleSlots.find((s) => s.weekday === i);
                if (!slot) return null;
                return (
                  <div key={i} className="flex items-center justify-between gap-4 rounded-xl border border-black/10 p-3 bg-stone-900/10">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={slot.active}
                        onChange={(e) => {
                          const updated = [...scheduleSlots];
                          updated[i].active = e.target.checked;
                          setScheduleSlots(updated);
                        }}
                      />
                      <span className="text-xs font-bold">{dayName}</span>
                    </label>
                    {slot.active && (
                      <div className="flex items-center gap-2">
                        <input
                          type="time"
                          className="field !py-1 !px-2 text-xs !min-h-0 w-20"
                          value={slot.startsAt}
                          onChange={(e) => {
                            const updated = [...scheduleSlots];
                            updated[i].startsAt = e.target.value;
                            setScheduleSlots(updated);
                          }}
                        />
                        <span className="text-stone-400 text-xs">às</span>
                        <input
                          type="time"
                          className="field !py-1 !px-2 text-xs !min-h-0 w-20"
                          value={slot.endsAt}
                          onChange={(e) => {
                            const updated = [...scheduleSlots];
                            updated[i].endsAt = e.target.value;
                            setScheduleSlots(updated);
                          }}
                        />
                      </div>
                    )}
                    {!slot.active && (
                      <span className="text-xs text-stone-500 italic font-semibold">Não atende</span>
                    )}
                  </div>
                );
              })}
            </div>
            <button className="btn-primary w-full">Salvar jornada</button>
          </form>
        )}
      </Modal>
    </div>
  );
}

export function AdminServicesPage() {
  const p = useLoad<any>("/api/portal?resource=admin-services");
  const [open, setOpen] = useState(false);
  const [editingService, setEditingService] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const emptyForm = {
    name: "",
    description: "",
    durationMinutes: "120",
    basePrice: "",
    depositAmount: "0",
    categoryId: "",
    hairMethodId: "",
    active: true,
    showOnlineBooking: true,
    isFree: false,
    offerInventoryItems: false,
    professionalLinks: [] as any[],
  };
  const [form, setForm] = useState<any>(emptyForm);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [manageCategoryOpen, setManageCategoryOpen] = useState(false);
  const [manageMethodOpen, setManageMethodOpen] = useState(false);
  const [categoryForm, setCategoryForm] = useState({ id: "", name: "", sortOrder: "0", parentId: "" });
  const [parentCategoryForSub, setParentCategoryForSub] = useState<any>(null);
  const [methodForm, setMethodForm] = useState({ id: "", name: "", description: "", maintenanceDays: "", active: true, categoryId: "", parentId: "" });
  const [parentMethodForSub, setParentMethodForSub] = useState<any>(null);
  const [filterCategoryId, setFilterCategoryId] = useState("");


  const renderMethodNode = (met: any, level: number = 0) => {
    const children = methods.filter((m: any) => m.parent_id === met.id);
    const cat = categories.find((c: any) => c.id === met.category_id);
    return (
      <div key={met.id} className="space-y-1">
        <div className="flex items-center justify-between py-1.5 px-2 hover:bg-black/5 rounded transition text-xs">
          <div className="flex items-center gap-2 flex-wrap" style={{ paddingLeft: `${level * 16}px` }}>
            {level > 0 && <span className="text-stone-400">↳</span>}
            <span className="font-semibold text-ink">{met.name}</span>
            {!met.active && <span className="scale-75 inline-block"><Badge tone="neutral">Inativo</Badge></span>}
            {cat && (
              <span className="text-[10px] bg-champagne/10 text-champagne px-1.5 py-0.5 rounded font-bold">
                {cat.name}
              </span>
            )}
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => {
                setMethodForm({
                  id: "",
                  name: "",
                  description: "",
                  maintenanceDays: "",
                  active: true,
                  categoryId: met.category_id || "",
                  parentId: met.id
                });
                setParentMethodForSub(met);
              }}
              className="rounded-full p-1 text-stone-500 hover:bg-black/10 hover:text-champagne transition"
              title="Adicionar Sub-método"
            >
              <Plus size={13} />
            </button>
            <button
              type="button"
              onClick={() => setMethodForm({
                id: met.id,
                name: met.name,
                description: met.description || "",
                maintenanceDays: met.maintenance_days ? String(met.maintenance_days) : "",
                active: met.active !== false,
                categoryId: met.category_id || "",
                parentId: met.parent_id || ""
              })}
              className="rounded-full p-1 text-stone-500 hover:bg-black/10 hover:text-champagne transition"
              title="Editar"
            >
              <Pencil size={13} />
            </button>
            <button
              type="button"
              onClick={() => deleteMethod(met)}
              className="rounded-full p-1 text-rose-600 hover:bg-rose-50 transition"
              title="Excluir"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
        {children.length > 0 && (
          <div className="space-y-1">
            {children.map((child: any) => renderMethodNode(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  const renderCategoryNode = (cat: any, level: number = 0) => {
    const children = categories.filter((c: any) => c.parent_id === cat.id);
    return (
      <div key={cat.id} className="space-y-1">
        <div className="flex items-center justify-between py-1.5 px-2 hover:bg-black/5 rounded transition text-xs">
          <div className="flex items-center gap-2" style={{ paddingLeft: `${level * 16}px` }}>
            {level > 0 && <span className="text-stone-400">↳</span>}
            <span className="font-semibold text-ink">{cat.name}</span>
            <span className="text-[10px] text-stone-450">(Ordem: {cat.sort_order || 0})</span>
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => {
                setCategoryForm({ id: "", name: "", sortOrder: "0", parentId: cat.id });
                setParentCategoryForSub(cat);
              }}
              className="rounded-full p-1 text-stone-500 hover:bg-black/10 hover:text-champagne transition"
              title="Adicionar Subcategoria"
            >
              <Plus size={13} />
            </button>
            <button
              type="button"
              onClick={() => {
                setManageCategoryOpen(false);
                setManageMethodOpen(true);
                setMethodForm({ id: "", name: "", description: "", maintenanceDays: "", active: true, categoryId: cat.id, parentId: "" });
              }}
              className="rounded-full p-1 text-stone-500 hover:bg-black/10 hover:text-champagne transition"
              title="Adicionar Método"
            >
              <Boxes size={13} />
            </button>
            <button
              type="button"
              onClick={() => setCategoryForm({ id: cat.id, name: cat.name, sortOrder: String(cat.sort_order || 0), parentId: cat.parent_id || "" })}
              className="rounded-full p-1 text-stone-500 hover:bg-black/10 hover:text-champagne transition"
              title="Editar"
            >
              <Pencil size={13} />
            </button>
            <button
              type="button"
              onClick={() => deleteCategory(cat)}
              className="rounded-full p-1 text-rose-600 hover:bg-rose-50 transition"
              title="Excluir"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
        {children.length > 0 && (
          <div className="space-y-1">
            {children.map((child: any) => renderCategoryNode(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  const saveCategory = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch("/api/portal?resource=admin-category", {
        method: "POST",
        body: JSON.stringify({
          id: categoryForm.id || undefined,
          name: categoryForm.name,
          sortOrder: Number(categoryForm.sortOrder),
          parentId: parentCategoryForSub?.id || categoryForm.parentId || undefined,
        }),
      });
      await p.reload();
      setCategoryForm({ id: "", name: "", sortOrder: "0", parentId: "" });
      setParentCategoryForSub(null);
      setToast("Categoria salva.");
    } catch (err) {
      console.error(err);
      setToast("Erro ao salvar categoria.");
    } finally {
      setSaving(false);
      setTimeout(() => setToast(""), 2200);
    }
  };

  const deleteCategory = async (cat: any) => {
    if (!window.confirm(`Excluir categoria "${cat.name}"?`)) return;
    setSaving(true);
    try {
      await apiFetch("/api/portal?resource=admin-category", {
        method: "DELETE",
        body: JSON.stringify({ id: cat.id }),
      });
      await p.reload();
      setToast("Categoria excluída.");
    } catch (err) {
      console.error(err);
      setToast(err instanceof Error ? err.message : "Erro ao excluir categoria.");
    } finally {
      setSaving(false);
      setTimeout(() => setToast(""), 2200);
    }
  };

  const saveMethod = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch("/api/portal?resource=admin-method", {
        method: "POST",
        body: JSON.stringify({
          id: methodForm.id || undefined,
          name: methodForm.name,
          description: methodForm.description,
          maintenanceDays: methodForm.maintenanceDays ? Number(methodForm.maintenanceDays) : null,
          active: methodForm.active,
          categoryId: methodForm.categoryId || undefined,
          parentId: parentMethodForSub?.id || methodForm.parentId || undefined,
        }),
      });
      await p.reload();
      setMethodForm({ id: "", name: "", description: "", maintenanceDays: "", active: true, categoryId: "", parentId: "" });
      setParentMethodForSub(null);
      setToast("Método salvo.");
    } catch (err) {
      console.error(err);
      setToast("Erro ao salvar método.");
    } finally {
      setSaving(false);
      setTimeout(() => setToast(""), 2200);
    }
  };

  const deleteMethod = async (met: any) => {
    if (!window.confirm(`Excluir método "${met.name}"?`)) return;
    setSaving(true);
    try {
      await apiFetch("/api/portal?resource=admin-method", {
        method: "DELETE",
        body: JSON.stringify({ id: met.id }),
      });
      await p.reload();
      setToast("Método excluído.");
    } catch (err) {
      console.error(err);
      setToast(err instanceof Error ? err.message : "Erro ao excluir método.");
    } finally {
      setSaving(false);
      setTimeout(() => setToast(""), 2200);
    }
  };

  if (p.loading) return <LoadingState />;
  const payload = p.data || {};
  const services = payload.services || [];
  const categories = payload.categories || [];
  const methods = payload.methods || [];
  const professionals = payload.professionals || [];
  const linksFor = (service?: any) =>
    professionals.map((professional: any) => {
      const existing = service?.professionals?.find(
        (item: any) => item.professional_id === professional.id,
      );
      return {
        professionalId: professional.id,
        name: professional.name,
        active: professional.active,
        enabled: Boolean(existing),
        customPrice:
          existing?.custom_price == null ? "" : String(existing.custom_price),
        commissionRate:
          existing?.commission_rate == null
            ? String(professional.commission_rate ?? "")
            : String(existing.commission_rate),
      };
    });
  const openNew = () => {
    setEditingService(null);
    setForm({ ...emptyForm, professionalLinks: linksFor() });
    setOpen(true);
  };
  const openEdit = (service: any) => {
    setEditingService(service);
    setForm({
      name: service.name || "",
      description: service.description || "",
      durationMinutes: String(service.duration_minutes || 120),
      basePrice: service.is_free ? "0" : String(service.base_price || ""),
      depositAmount: String(service.deposit_amount || 0),
      categoryId: service.category_id || "",
      hairMethodId: service.hair_method_id || "",
      active: service.active !== false,
      showOnlineBooking: service.show_online_booking !== false,
      isFree: service.is_free === true,
      offerInventoryItems: service.offer_inventory_items === true,
      professionalLinks: linksFor(service),
    });
    setOpen(true);
  };
  const updateLink = (professionalId: string, patch: any) => {
    setForm({
      ...form,
      professionalLinks: form.professionalLinks.map((item: any) =>
        item.professionalId === professionalId ? { ...item, ...patch } : item,
      ),
    });
  };
  const saveService = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await apiFetch("/api/portal?resource=admin-service", {
        method: editingService ? "PATCH" : "POST",
        body: JSON.stringify({
          id: editingService?.id,
          name: form.name,
          description: form.description,
          durationMinutes: Number(form.durationMinutes),
          basePrice: form.isFree ? 0 : Number(form.basePrice),
          depositAmount: form.isFree ? 0 : Number(form.depositAmount || 0),
          categoryId: form.categoryId || null,
          hairMethodId: form.hairMethodId || null,
          active: form.active,
          showOnlineBooking: form.showOnlineBooking,
          isFree: form.isFree,
          offerInventoryItems: form.offerInventoryItems,
          professionalLinks: form.professionalLinks
            .filter((item: any) => item.enabled)
            .map((item: any) => ({
              professionalId: item.professionalId,
              customPrice: form.isFree || item.customPrice === "" ? null : Number(item.customPrice),
              commissionRate:
                item.commissionRate === "" ? null : Number(item.commissionRate),
            })),
        }),
      });
      await p.reload();
      setOpen(false);
      setEditingService(null);
      setToast("Serviço salvo com sucesso.");
    } catch (err) {
      console.error("Service save error", err);
      setToast(
        err instanceof Error
          ? err.message
          : "Não foi possível salvar o serviço.",
      );
    } finally {
      setSaving(false);
      setTimeout(() => setToast(""), 2200);
    }
  };
  const toggleActive = async (service: any) => {
    setSaving(true);
    try {
      await apiFetch("/api/portal?resource=admin-service", {
        method: "PATCH",
        body: JSON.stringify({
          id: service.id,
          name: service.name,
          description: service.description || "",
          durationMinutes: Number(service.duration_minutes),
          basePrice: Number(service.base_price),
          depositAmount: Number(service.deposit_amount || 0),
          categoryId: service.category_id || null,
          hairMethodId: service.hair_method_id || null,
          active: !service.active,
          showOnlineBooking: service.show_online_booking !== false,
          isFree: service.is_free === true,
        }),
      });
      await p.reload();
      setToast(service.active ? "Serviço pausado." : "Serviço reativado.");
    } catch (err) {
      console.error("Service status error", err);
      setToast(
        err instanceof Error
          ? err.message
          : "Não foi possível alterar o status.",
      );
    } finally {
      setSaving(false);
      setTimeout(() => setToast(""), 2200);
    }
  };
  const deleteService = async (service: any) => {
    if (!window.confirm(`Tem certeza de que deseja remover permanentemente o serviço "${service.name}"?`)) {
      return;
    }
    setSaving(true);
    try {
      await apiFetch("/api/portal?resource=admin-service", {
        method: "DELETE",
        body: JSON.stringify({ id: service.id }),
      });
      await p.reload();
      setToast("Serviço excluído com sucesso.");
    } catch (err) {
      console.error("Service delete error", err);
      setToast(
        err instanceof Error
          ? err.message
          : "Não foi possível excluir o serviço.",
      );
    } finally {
      setSaving(false);
      setTimeout(() => setToast(""), 3000);
    }
  };
  return (
    <div>
      <Toast show={!!toast} message={toast} />
      <PageHeader
        eyebrow="CATÁLOGO"
        title="Serviços e métodos"
        subtitle="Preços, duração e demanda registrados no Neon."
        action={
          <div className="flex items-center gap-3">
            <div className="flex border border-black/10 rounded-2xl overflow-hidden bg-white">
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                className={`p-2 transition ${viewMode === "grid" ? "bg-ink text-white" : "bg-warm text-stone-500 hover:bg-stone-100"}`}
                title="Visualização em Grade"
              >
                <LayoutGrid size={16} />
              </button>
              <button
                type="button"
                onClick={() => setViewMode("list")}
                className={`p-2 transition ${viewMode === "list" ? "bg-ink text-white" : "bg-warm text-stone-500 hover:bg-stone-100"}`}
                title="Visualização em Lista"
              >
                <List size={16} />
              </button>
            </div>
            <button onClick={openNew} className="btn-primary">
              <Plus size={15} />
              Criar serviço
            </button>
          </div>
        }
      />
      {/* Filtro por categoria */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <label className="text-xs font-bold text-stone-500 shrink-0">Filtrar por categoria:</label>
        <select
          className="field text-xs max-w-xs"
          value={filterCategoryId}
          onChange={(e) => setFilterCategoryId(e.target.value)}
        >
          <option value="">Todas as categorias</option>
          {buildCategoryTreeOptions(categories).map((c) => (
            <option key={c.id} value={c.id}>
              {"\u00A0\u00A0".repeat(c.level) + (c.level > 0 ? "↳ " : "") + c.name}
            </option>
          ))}
        </select>
        {filterCategoryId && (
          <button
            type="button"
            onClick={() => setFilterCategoryId("")}
            className="text-[10px] text-champagne font-bold uppercase tracking-wider hover:underline"
          >
            Limpar filtro
          </button>
        )}
      </div>
      {(() => {
        const filteredServices = filterCategoryId
          ? services.filter((x: any) => x.category_id === filterCategoryId)
          : services;
        return filteredServices.length ? (
        viewMode === "grid" ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredServices.map((x: any) => (
              <div key={x.id} className="surface p-6">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-wrap gap-2">
                    <Badge tone={x.active ? "green" : "neutral"}>
                      {x.active ? "ATIVO" : "INATIVO"}
                    </Badge>
                    <Badge tone={x.show_online_booking !== false ? "green" : "neutral"}>
                      {x.show_online_booking !== false ? "ONLINE" : "INTERNO"}
                    </Badge>
                    {x.is_free && <Badge tone="green">SEM CUSTO</Badge>}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => openEdit(x)}
                      className="rounded-full border border-black/10 p-2 text-stone-500 transition hover:border-champagne hover:text-champagne"
                      title="Editar serviço"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => toggleActive(x)}
                      className="rounded-full border border-black/10 p-2 text-stone-500 transition hover:border-champagne hover:text-champagne disabled:opacity-50"
                      title={x.active ? "Pausar serviço" : "Reativar serviço"}
                    >
                      {x.active ? <Pause size={15} /> : <Play size={15} />}
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => deleteService(x)}
                      className="rounded-full border border-black/10 p-2 text-stone-500 transition hover:border-rose-600 hover:text-rose-600 disabled:opacity-50"
                      title="Excluir serviço"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
                <h2 className="mt-3 font-display text-3xl">{x.name}</h2>
                <p className="muted mt-2">{x.description}</p>
                <div className="mt-4 flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-stone-400">
                  <span>{x.category || "Sem categoria"}</span>
                  <span>{x.method || "Sem método"}</span>
                </div>
                <div className="mt-5 grid grid-cols-3 rounded-2xl bg-warm p-4 text-center text-xs">
                  <span>
                    <b className="block">{x.duration_minutes}min</b>
                    <small>Duração</small>
                  </span>
                  <span>
                    <b className="block">{servicePriceLabel(x)}</b>
                    <small>Preço</small>
                  </span>
                  <span>
                    <b className="block">{x.appointments}</b>
                    <small>Reservas</small>
                  </span>
                </div>
                <p className="mt-4 text-[10px] text-stone-400">
                  {x.professionals?.length || 0} profissionais vinculadas
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="surface overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-black/10 text-stone-450 uppercase tracking-wider text-[10px]">
                  <th className="p-4 font-bold">Serviço</th>
                  <th className="p-4 font-bold">Categoria/Método</th>
                  <th className="p-4 font-bold">Duração</th>
                  <th className="p-4 font-bold">Preço</th>
                  <th className="p-4 font-bold">Reservas</th>
                  <th className="p-4 font-bold">Profissionais</th>
                  <th className="p-4 font-bold text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filteredServices.map((x: any) => (
                  <tr key={x.id} className="border-b border-black/5 hover:bg-stone-50/40 transition">
                    <td className="p-4 max-w-xs">
                      <div className="font-display text-lg font-bold text-ink">{x.name}</div>
                      {x.description && <div className="text-stone-450 mt-1 text-[11px] line-clamp-1">{x.description}</div>}
                      <div className="mt-2 flex flex-wrap gap-1">
                        <Badge tone={x.active ? "green" : "neutral"}>
                          {x.active ? "ATIVO" : "INATIVO"}
                        </Badge>
                        <Badge tone={x.show_online_booking !== false ? "green" : "neutral"}>
                          {x.show_online_booking !== false ? "ONLINE" : "INTERNO"}
                        </Badge>
                        {x.is_free && <Badge tone="green">SEM CUSTO</Badge>}
                      </div>
                    </td>
                    <td className="p-4 text-stone-500">
                      <div className="font-semibold">{x.category || "Sem categoria"}</div>
                      <div className="text-[10px] text-stone-450 mt-0.5">{x.method || "Sem método"}</div>
                    </td>
                    <td className="p-4 font-semibold text-ink">{x.duration_minutes} min</td>
                    <td className="p-4 font-semibold text-ink">{servicePriceLabel(x)}</td>
                    <td className="p-4 font-semibold text-ink">{x.appointments}</td>
                    <td className="p-4 text-stone-500">{x.professionals?.length || 0} vinculadas</td>
                    <td className="p-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openEdit(x)}
                          className="rounded-full border border-black/10 p-1.5 text-stone-500 transition hover:border-champagne hover:text-champagne"
                          title="Editar serviço"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => toggleActive(x)}
                          className="rounded-full border border-black/10 p-1.5 text-stone-500 transition hover:border-champagne hover:text-champagne disabled:opacity-50"
                          title={x.active ? "Pausar serviço" : "Reativar serviço"}
                        >
                          {x.active ? <Pause size={13} /> : <Play size={13} />}
                        </button>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => deleteService(x)}
                          className="rounded-full border border-black/10 p-1.5 text-rose-700 transition hover:border-rose-650 hover:text-rose-650 disabled:opacity-50"
                          title="Excluir serviço"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <EmptyState title="Nenhum serviço" text={filterCategoryId ? "Nenhum serviço nesta categoria." : "O catálogo está vazio."} />
      );
      })()}
      <Modal
        open={open}
        onClose={() => {
          if (!saving) {
            setOpen(false);
            setEditingService(null);
          }
        }}
        title={editingService ? "Editar serviço" : "Criar serviço"}
      >
        <form onSubmit={saveService} className="space-y-4">
          <Input
            label="Nome"
            value={form.name}
            set={(v) => setForm({ ...form, name: v })}
          />
          <label className="block">
            <span className="mb-2 block text-xs font-bold">Descrição</span>
            <textarea
              className="field min-h-24 py-3"
              value={form.description}
              onChange={(event) =>
                setForm({ ...form, description: event.target.value })
              }
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <Input
              label="Duração (min)"
              type="number"
              value={form.durationMinutes}
              set={(v) => setForm({ ...form, durationMinutes: v })}
            />
            <Input
              label="Preço"
              type="number"
              value={form.basePrice}
              disabled={form.isFree}
              set={(v) => setForm({ ...form, basePrice: v })}
            />
            <Input
              label="Sinal"
              type="number"
              value={form.depositAmount}
              disabled={form.isFree}
              set={(v) => setForm({ ...form, depositAmount: v })}
            />
          </div>
          <label className="flex items-center gap-3 rounded-2xl bg-warm p-4 text-xs font-bold">
            <input
              type="checkbox"
              checked={form.isFree}
              onChange={(event) =>
                setForm({
                  ...form,
                  isFree: event.target.checked,
                  basePrice: event.target.checked
                    ? "0"
                    : form.basePrice === "0"
                      ? ""
                      : form.basePrice,
                  depositAmount: event.target.checked ? "0" : form.depositAmount,
                })
              }
            />
            Servico gratis / sem custo
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="block">
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-bold">Categoria</span>
                <button
                  type="button"
                  onClick={() => setManageCategoryOpen(true)}
                  className="text-[10px] text-champagne font-bold uppercase tracking-wider hover:underline"
                >
                  Gerenciar
                </button>
              </div>
              <select
                className="field"
                value={form.categoryId}
                onChange={(event) => {
                  const catId = event.target.value;
                  const matchingMethod = methods.find((m: any) => m.category_id === catId);
                  setForm({
                    ...form,
                    categoryId: catId,
                    hairMethodId: matchingMethod ? matchingMethod.id : ""
                  });
                }}
              >
                <option value="">Sem categoria</option>
                {buildCategoryTreeOptions(categories).map((c) => (
                  <option key={c.id} value={c.id}>
                    {"\u00A0\u00A0".repeat(c.level) + (c.level > 0 ? "↳ " : "") + c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="block">
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-bold">Método</span>
                <button
                  type="button"
                  onClick={() => setManageMethodOpen(true)}
                  className="text-[10px] text-champagne font-bold uppercase tracking-wider hover:underline"
                >
                  Gerenciar
                </button>
              </div>
              <select
                className="field"
                value={form.hairMethodId}
                onChange={(event) =>
                  setForm({ ...form, hairMethodId: event.target.value })
                }
              >
                <option value="">Sem método</option>
                {buildMethodTreeOptions(
                  form.categoryId
                    ? methods.filter((m: any) => m.category_id === form.categoryId)
                    : []
                ).map((m) => (
                  <option key={m.id} value={m.id}>
                    {"\u00A0\u00A0".repeat(m.level) + (m.level > 0 ? "↳ " : "") + m.name}
                  </option>
                ))}
              </select>
              {!form.categoryId && (
                <p className="mt-1 text-[10px] text-stone-400 italic">Selecione uma categoria para ver os métodos disponíveis.</p>
              )}
              {form.categoryId && buildMethodTreeOptions(methods.filter((m: any) => m.category_id === form.categoryId)).length === 0 && (
                <p className="mt-1 text-[10px] text-stone-400 italic">Nenhum método cadastrado para esta categoria.</p>
              )}
            </div>
          </div>
          <label className="flex items-center gap-3 rounded-2xl bg-warm p-4 text-xs font-bold">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(event) =>
                setForm({ ...form, active: event.target.checked })
              }
            />
            Serviço ativo para novos agendamentos
          </label>
          <label className="flex items-center gap-3 rounded-2xl bg-warm p-4 text-xs font-bold">
            <input
              type="checkbox"
              checked={form.showOnlineBooking}
              onChange={(event) =>
                setForm({ ...form, showOnlineBooking: event.target.checked })
              }
            />
            Mostrar no agendamento online
          </label>
          <label className="flex items-center gap-3 rounded-2xl bg-warm p-4 text-xs font-bold">
            <input
              type="checkbox"
              checked={form.offerInventoryItems}
              onChange={(event) =>
                setForm({ ...form, offerInventoryItems: event.target.checked })
              }
            />
            Oferecer itens de estoque desta categoria para o cliente
          </label>
          <section>
            <SectionHeading title="Profissionais vinculadas" />
            <div className="space-y-3">
              {form.professionalLinks.length ? (
                form.professionalLinks.map((item: any) => (
                  <div
                    key={item.professionalId}
                    className="rounded-2xl border border-black/10 p-4"
                  >
                    <label className="flex items-center justify-between gap-3 text-xs font-bold">
                      <span>
                        {item.name}
                        {!item.active && (
                          <small className="ml-2 text-stone-400">inativa</small>
                        )}
                      </span>
                      <input
                        type="checkbox"
                        checked={item.enabled}
                        onChange={(event) =>
                          updateLink(item.professionalId, {
                            enabled: event.target.checked,
                          })
                        }
                      />
                    </label>
                    {item.enabled && (
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <Input
                          label="Preço personalizado"
                          type="number"
                          value={item.customPrice}
                          set={(v) =>
                            updateLink(item.professionalId, { customPrice: v })
                          }
                        />
                        <Input
                          label="Comissão (%)"
                          type="number"
                          value={item.commissionRate}
                          set={(v) =>
                            updateLink(item.professionalId, {
                              commissionRate: v,
                            })
                          }
                        />
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <p className="rounded-2xl bg-warm p-4 text-xs text-stone-500">
                  Cadastre profissionais antes de vincular este serviço.
                </p>
              )}
            </div>
          </section>
          <button
            disabled={
              saving ||
              !form.name.trim() ||
              !form.durationMinutes ||
              (!form.isFree && !form.basePrice)
            }
            className="btn-primary w-full disabled:opacity-50"
          >
            {saving ? "Salvando..." : "Salvar serviço"}
          </button>
        </form>
      </Modal>

      <Modal
        open={manageCategoryOpen}
        onClose={() => {
          setManageCategoryOpen(false);
          setCategoryForm({ id: "", name: "", sortOrder: "0", parentId: "" });
          setParentCategoryForSub(null);
        }}
        title="Gerenciar Categorias"
      >
        <div className="space-y-6">
          <form onSubmit={saveCategory} className="space-y-3 rounded-2xl bg-warm p-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-stone-500">
              {categoryForm.id ? "Editar Categoria" : "Nova Categoria"}
            </h3>
            {parentCategoryForSub && (
              <div className="flex items-center justify-between text-[11px] bg-champagne/15 text-champagne p-2.5 rounded-xl font-bold">
                <span>Subcategoria de: <b className="text-ink">{parentCategoryForSub.name}</b></span>
                <button
                  type="button"
                  onClick={() => {
                    setCategoryForm({ ...categoryForm, parentId: "" });
                    setParentCategoryForSub(null);
                  }}
                  className="underline text-[10px] text-stone-500 hover:text-ink transition"
                >
                  Remover
                </button>
              </div>
            )}
            <Input
              label="Nome da Categoria"
              value={categoryForm.name}
              set={(v) => setCategoryForm({ ...categoryForm, name: v })}
            />
            <Input
              label="Ordem de Exibição"
              type="number"
              value={categoryForm.sortOrder}
              set={(v) => setCategoryForm({ ...categoryForm, sortOrder: v })}
            />
            <div className="flex gap-2">
              <button
                disabled={saving || !categoryForm.name.trim()}
                className="btn-primary flex-1 text-xs"
              >
                {saving ? "Salvando..." : "Salvar"}
              </button>
              {(categoryForm.id || parentCategoryForSub) && (
                <button
                  type="button"
                  onClick={() => {
                    setCategoryForm({ id: "", name: "", sortOrder: "0", parentId: "" });
                    setParentCategoryForSub(null);
                  }}
                  className="btn-secondary text-xs"
                >
                  Cancelar
                </button>
              )}
            </div>
          </form>

          <div className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-stone-500">Categorias Cadastradas</h3>
            {categories.length ? (
              <div className="divide-y divide-black/5 max-h-80 overflow-y-auto pr-1">
                {(() => {
                  const rootCategories = categories.filter((cat: any) => !cat.parent_id);
                  const orphanCategories = categories.filter((cat: any) => cat.parent_id && !categories.some((p: any) => p.id === cat.parent_id));
                  const topLevel = [...rootCategories, ...orphanCategories];
                  return topLevel.map((cat: any) => renderCategoryNode(cat, 0));
                })()}
              </div>
            ) : (
              <p className="text-xs text-stone-400 italic">Nenhuma categoria cadastrada.</p>
            )}
          </div>
        </div>
      </Modal>

      <Modal
        open={manageMethodOpen}
        onClose={() => {
          setManageMethodOpen(false);
          setMethodForm({ id: "", name: "", description: "", maintenanceDays: "", active: true, categoryId: "", parentId: "" });
          setParentMethodForSub(null);
        }}
        title="Gerenciar Métodos"
      >
        <div className="space-y-6">
          <form onSubmit={saveMethod} className="space-y-3 rounded-2xl bg-warm p-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-stone-500">
              {methodForm.id ? "Editar Método" : "Novo Método"}
            </h3>
            {parentMethodForSub && (
              <div className="flex items-center justify-between text-[11px] bg-champagne/15 text-champagne p-2.5 rounded-xl font-bold">
                <span>Sub-método de: <b className="text-ink">{parentMethodForSub.name}</b></span>
                <button
                  type="button"
                  onClick={() => {
                    setMethodForm({ ...methodForm, parentId: "" });
                    setParentMethodForSub(null);
                  }}
                  className="underline text-[10px] text-stone-500 hover:text-ink transition"
                >
                  Remover
                </button>
              </div>
            )}
            <Input
              label="Nome do Método"
              value={methodForm.name}
              set={(v) => setMethodForm({ ...methodForm, name: v })}
            />
            <div className="block">
              <span className="mb-2 block text-xs font-bold">Vincular à Categoria</span>
              <select
                className="field text-xs"
                value={methodForm.categoryId || ""}
                onChange={(e) => setMethodForm({ ...methodForm, categoryId: e.target.value })}
              >
                <option value="">Sem Categoria (Geral)</option>
                {buildCategoryTreeOptions(categories).map((c) => (
                  <option key={c.id} value={c.id}>
                    {"\u00A0\u00A0".repeat(c.level) + (c.level > 0 ? "↳ " : "") + c.name}
                  </option>
                ))}
              </select>
            </div>
            <label className="block">
              <span className="mb-2 block text-xs font-bold">Descrição</span>
              <textarea
                className="field min-h-16 py-2 text-xs"
                value={methodForm.description}
                onChange={(e) => setMethodForm({ ...methodForm, description: e.target.value })}
              />
            </label>
            <Input
              label="Dias recomendados para manutenção"
              type="number"
              value={methodForm.maintenanceDays}
              set={(v) => setMethodForm({ ...methodForm, maintenanceDays: v })}
            />
            <label className="flex items-center gap-2 text-xs font-semibold py-1">
              <input
                type="checkbox"
                checked={methodForm.active}
                onChange={(e) => setMethodForm({ ...methodForm, active: e.target.checked })}
              />
              Método ativo
            </label>
            <div className="flex gap-2">
              <button
                disabled={saving || !methodForm.name.trim()}
                className="btn-primary flex-1 text-xs"
              >
                {saving ? "Salvando..." : "Salvar"}
              </button>
              {(methodForm.id || parentMethodForSub || methodForm.categoryId) && (
                <button
                  type="button"
                  onClick={() => {
                    setMethodForm({ id: "", name: "", description: "", maintenanceDays: "", active: true, categoryId: "", parentId: "" });
                    setParentMethodForSub(null);
                  }}
                  className="btn-secondary text-xs"
                >
                  Cancelar
                </button>
              )}
            </div>
          </form>

          <div className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-stone-500">Métodos Cadastrados</h3>
            {methods.length ? (
              <div className="divide-y divide-black/5 max-h-80 overflow-y-auto pr-1">
                {(() => {
                  const rootMethods = methods.filter((m: any) => !m.parent_id);
                  const orphanMethods = methods.filter((m: any) => m.parent_id && !methods.some((p: any) => p.id === m.parent_id));
                  const topLevel = [...rootMethods, ...orphanMethods];
                  return topLevel.map((met: any) => renderMethodNode(met, 0));
                })()}
              </div>
            ) : (
              <p className="text-xs text-stone-400 italic">Nenhum método cadastrado.</p>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}

export function AdminInventoryPage() {
  const p = useLoad<{ inventory: any[], categories?: any[], methods?: any[], colors?: any[] }>("/api/data?resource=inventory");
  const [open, setOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);

  const [movementModalOpen, setMovementModalOpen] = useState(false);
  const [movementItem, setMovementItem] = useState<any>(null);
  const [movementForm, setMovementForm] = useState({
    kind: "entry", // 'entry', 'exit', 'adjustment'
    quantity: "",
    note: "",
  });

  const [form, setForm] = useState<any>({
    code: "",
    supplier: "",
    category: "Cabelo humano",
    categoryId: "",
    hairMethodId: "",
    color: "",
    shade: "",
    lengthCm: "",
    texture: "",
    lot: "",
    unitCost: "",
    suggestedPrice: "",
    quantity: "",
    minimumStock: "",
    weightGrams: "",
    active: true,
  });
  const [toast, setToast] = useState("");

  const [manageColorOpen, setManageColorOpen] = useState(false);
  const [colorForm, setColorForm] = useState({ id: "", name: "" });
  const [savingColor, setSavingColor] = useState(false);

  const saveColor = async (e: FormEvent) => {
    e.preventDefault();
    setSavingColor(true);
    try {
      await apiFetch("/api/data?resource=admin-color", {
        method: "POST",
        body: JSON.stringify({
          id: colorForm.id || undefined,
          name: colorForm.name
        }),
      });
      await p.reload();
      setColorForm({ id: "", name: "" });
      setToast("Cor salva com sucesso.");
    } catch (err) {
      console.error(err);
      setToast("Erro ao salvar cor.");
    } finally {
      setSavingColor(false);
      setTimeout(() => setToast(""), 2200);
    }
  };

  const deleteColor = async (c: any) => {
    if (!window.confirm(`Excluir cor "${c.name}"?`)) return;
    setSavingColor(true);
    try {
      await apiFetch("/api/data?resource=admin-color", {
        method: "DELETE",
        body: JSON.stringify({ id: c.id }),
      });
      await p.reload();
      setToast("Cor excluída.");
    } catch (err) {
      console.error(err);
      setToast(err instanceof Error ? err.message : "Erro ao excluir cor.");
    } finally {
      setSavingColor(false);
      setTimeout(() => setToast(""), 2200);
    }
  };

  if (p.loading) return <LoadingState />;
  const list = p.data?.inventory || [];
  const categories = p.data?.categories || [];
  const methods = p.data?.methods || [];
  const colors = p.data?.colors || [];
  const total = list.reduce(
    (s, x) => s + Number(x.unit_cost || 0) * Number(x.qty || 0),
    0,
  );
  const low = list.filter((x) => Number(x.qty) <= Number(x.min));

  const handleCreate = () => {
    setEditingItem(null);
    setForm({
      code: "",
      supplier: "",
      category: "Cabelo humano",
      categoryId: "",
      hairMethodId: "",
      color: "",
      shade: "",
      lengthCm: "",
      texture: "",
      lot: "",
      unitCost: "",
      suggestedPrice: "",
      quantity: "",
      minimumStock: "",
      weightGrams: "",
      active: true,
    });
    setOpen(true);
  };

  const handleEdit = (item: any) => {
    setEditingItem(item);
    setForm({
      code: item.code || "",
      supplier: item.supplier || "",
      category: item.category || "",
      categoryId: item.category_id || "",
      hairMethodId: item.hair_method_id || "",
      color: item.color || "",
      shade: item.shade || "",
      lengthCm: item.length_cm ? String(item.length_cm) : "",
      texture: item.texture || "",
      lot: item.lot || "",
      unitCost: String(item.unit_cost || 0),
      suggestedPrice: String(item.suggested_price || 0),
      quantity: String(item.qty || 0),
      minimumStock: String(item.min || 0),
      weightGrams: item.weight_grams ? String(item.weight_grams) : "",
      active: item.active !== false,
    });
    setOpen(true);
  };

  const handleOpenMovement = (item: any) => {
    setMovementItem(item);
    setMovementForm({
      kind: "entry",
      quantity: "",
      note: "",
    });
    setMovementModalOpen(true);
  };

  const handleArchive = async (item: any) => {
    if (!confirm(`Tem certeza que deseja arquivar o item "${item.item} (${item.code})"?`)) return;
    try {
      await apiFetch("/api/data?resource=inventory", {
        method: "POST",
        body: JSON.stringify({
          id: item.id,
          code: item.code,
          supplier: item.supplier,
          category: item.item,
          color: item.color,
          shade: item.shade,
          lengthCm: item.length_cm,
          texture: item.texture,
          lot: item.lot,
          unitCost: Number(item.unit_cost),
          suggestedPrice: Number(item.suggested_price),
          minimumStock: Number(item.min),
          quantity: Number(item.qty),
          archived: true,
        }),
      });
      await p.reload();
      setToast("Item arquivado com sucesso.");
    } catch (err) {
      console.error("Archive inventory error", err);
      setToast("Não foi possível arquivar o item.");
    } finally {
      setTimeout(() => setToast(""), 2200);
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch("/api/data?resource=inventory", {
        method: "POST",
        body: JSON.stringify({
          id: editingItem?.id || undefined,
          ...form,
          lengthCm: Number(form.lengthCm) || null,
          weightGrams: Number(form.weightGrams) || null,
          unitCost: Number(form.unitCost),
          suggestedPrice: Number(form.suggestedPrice),
          quantity: Number(form.quantity),
          minimumStock: Number(form.minimumStock),
          active: form.active,
        }),
      });
      await p.reload();
      setOpen(false);
      setToast(editingItem ? "Item atualizado com sucesso." : "Item criado com sucesso.");
    } catch (err) {
      console.error("Inventory save error", err);
      setToast(
        err instanceof Error
          ? err.message
          : "Não foi possível concluir a ação.",
      );
    } finally {
      setTimeout(() => setToast(""), 2200);
    }
  };

  const submitMovement = async (e: FormEvent) => {
    e.preventDefault();
    const qtyNum = Number(movementForm.quantity);
    if (isNaN(qtyNum) || qtyNum <= 0) {
      setToast("Quantidade inválida.");
      setTimeout(() => setToast(""), 2200);
      return;
    }
    try {
      await apiFetch("/api/data?resource=inventory-movement", {
        method: "POST",
        body: JSON.stringify({
          inventoryId: movementItem.id,
          kind: movementForm.kind,
          quantity: qtyNum,
          note: movementForm.note,
        }),
      });
      await p.reload();
      setMovementModalOpen(false);
      setToast("Movimentação registrada com sucesso.");
    } catch (err) {
      console.error("Movement error", err);
      setToast(
        err instanceof Error
          ? err.message
          : "Não foi possível registrar a movimentação.",
      );
    } finally {
      setTimeout(() => setToast(""), 2200);
    }
  };

  return (
    <div>
      <Toast show={!!toast} message={toast} />
      <PageHeader
        eyebrow="ESTOQUE"
        title="Cabelos e produtos"
        subtitle="Quantidade, custo e alertas reais."
        action={
          <button onClick={handleCreate} className="btn-primary">
            <Plus size={15} />
            Novo item
          </button>
        }
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Valor em estoque"
          value={brl(total)}
          icon={<Boxes />}
        />
        <StatCard
          label="Itens cadastrados"
          value={String(list.length)}
          icon={<Boxes />}
        />
        <StatCard
          label="Estoque baixo"
          value={String(low.length)}
          icon={<AlertTriangle />}
          tone="gold"
        />
      </div>
      <section className="surface mt-5 overflow-hidden">
        {list.length ? (
          list.map((x) => (
            <div
              key={x.id}
              className="grid grid-cols-[1fr_auto] gap-3 border-b border-black/5 p-5 sm:grid-cols-[.6fr_1.2fr_1fr_.6fr_.6fr_1fr] items-center"
            >
              <span className="text-xs">
                {x.code}
                {x.active === false && (
                  <span className="ml-1.5 scale-75 inline-block align-middle">
                    <Badge tone="neutral">Inativo</Badge>
                  </span>
                )}
                <small className="block text-stone-400">{x.lot}</small>
              </span>
              <b className="text-xs">
                {x.item}
                {x.hair_method_id && methods.find((m: any) => m.id === x.hair_method_id) && (
                  <span className="block text-[10px] text-stone-400 font-normal">
                    Método: {methods.find((m: any) => m.id === x.hair_method_id).name}
                  </span>
                )}
              </b>
              <span className="hidden text-xs sm:block">{x.detail || "—"}</span>
              <span className="text-xs">
                {x.qty} / {x.min}
              </span>
              <Badge tone={Number(x.qty) <= Number(x.min) ? "amber" : "green"}>
                {x.status}
              </Badge>
              <div className="flex gap-1.5 justify-end">
                <button
                  onClick={() => handleEdit(x)}
                  className="btn-secondary !min-h-8 !py-1 !px-2 flex items-center gap-1 text-[10px]"
                  title="Editar propriedades"
                >
                  <Pencil size={11} />
                  Editar
                </button>
                <button
                  onClick={() => handleOpenMovement(x)}
                  className="btn-secondary !min-h-8 !py-1 !px-2 flex items-center gap-1 text-[10px]"
                  title="Movimentação de estoque"
                >
                  <ArrowUpDown size={11} />
                  Movimentar
                </button>
                <button
                  onClick={() => handleArchive(x)}
                  className="btn-secondary !min-h-8 !py-1 !px-2 flex items-center gap-1 text-[10px] text-red-500 hover:text-red-600"
                  title="Arquivar item"
                >
                  <Archive size={11} />
                  Arquivar
                </button>
              </div>
            </div>
          ))
        ) : (
          <EmptyState
            title="Nenhum item"
            text="Cadastre o primeiro item do estoque."
          />
        )}
      </section>

      <Modal open={open} onClose={() => setOpen(false)} title={editingItem ? "Editar item" : "Cadastrar item"}>
        <form onSubmit={save} className="grid grid-cols-2 gap-3">
          <Input
            label="Código"
            value={form.code}
            set={(v) => setForm({ ...form, code: v })}
          />
          <Input
            label="Fornecedor"
            value={form.supplier}
            set={(v) => setForm({ ...form, supplier: v })}
          />
          <div className="col-span-2 block">
            <span className="mb-2 block text-xs font-bold text-stone-500">Categoria</span>
            <select
              className="field text-xs"
              value={form.categoryId || ""}
              onChange={(e) => {
                const val = e.target.value;
                const cat = categories.find((c: any) => c.id === val);
                const matchingMethod = methods.find((m: any) => m.category_id === val);
                
                let nextCode = form.code;
                if (!editingItem && cat) {
                  nextCode = generateNextCode(cat.name, list);
                }
                
                setForm({
                  ...form,
                  categoryId: val,
                  category: cat ? cat.name : "Cabelo humano",
                  hairMethodId: matchingMethod ? matchingMethod.id : "",
                  code: nextCode
                });
              }}
            >
              <option value="">Sem Categoria (Geral)</option>
              {buildCategoryTreeOptions(categories).map((c) => (
                <option key={c.id} value={c.id}>
                  {"\u00A0\u00A0".repeat(c.level) + (c.level > 0 ? "↳ " : "") + c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2 block">
            <span className="mb-2 block text-xs font-bold text-stone-500">Método</span>
            <select
              className="field text-xs"
              value={form.hairMethodId || ""}
              onChange={(e) => {
                const val = e.target.value;
                setForm({ ...form, hairMethodId: val });
              }}
            >
              <option value="">Sem Método (Geral)</option>
              {buildMethodTreeOptions(
                form.categoryId
                  ? methods.filter((m: any) => m.category_id === form.categoryId)
                  : []
              ).map((m) => (
                <option key={m.id} value={m.id}>
                  {"\u00A0\u00A0".repeat(m.level) + (m.level > 0 ? "↳ " : "") + m.name}
                </option>
              ))}
            </select>
            {!form.categoryId && (
              <p className="mt-1 text-[10px] text-stone-400 italic">Selecione uma categoria para ver os métodos disponíveis.</p>
            )}
            {form.categoryId && buildMethodTreeOptions(methods.filter((m: any) => m.category_id === form.categoryId)).length === 0 && (
              <p className="mt-1 text-[10px] text-stone-400 italic">Nenhum método cadastrado para esta categoria.</p>
            )}
          </div>
          <div className="col-span-2 block">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-bold text-stone-500">Cor</span>
              <button
                type="button"
                onClick={() => setManageColorOpen(true)}
                className="text-[10px] text-champagne font-bold uppercase tracking-wider hover:underline"
              >
                Gerenciar Cores
              </button>
            </div>
            <select
              className="field text-xs"
              value={form.color}
              onChange={(e) => setForm({ ...form, color: e.target.value })}
            >
              <option value="">Selecione uma cor</option>
              {colors.map((c: any) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <Input
            label="Comprimento (cm)"
            type="number"
            value={form.lengthCm}
            set={(v) => setForm({ ...form, lengthCm: v })}
          />
          <Input
            label="Peso (g)"
            type="number"
            value={form.weightGrams}
            set={(v) => setForm({ ...form, weightGrams: v })}
          />
          <Input
            label="Lote"
            value={form.lot}
            set={(v) => setForm({ ...form, lot: v })}
          />
          <Input
            label="Custo (R$)"
            type="number"
            value={form.unitCost}
            set={(v) => setForm({ ...form, unitCost: v })}
          />
          <Input
            label="Preço sugerido (R$)"
            type="number"
            value={form.suggestedPrice}
            set={(v) => setForm({ ...form, suggestedPrice: v })}
          />
          <Input
            label="Quantidade"
            type="number"
            value={form.quantity}
            set={(v) => setForm({ ...form, quantity: v })}
          />
          <Input
            label="Estoque mínimo"
            type="number"
            value={form.minimumStock}
            set={(v) => setForm({ ...form, minimumStock: v })}
          />
          <label className="flex items-center gap-2 text-xs font-semibold py-1 col-span-2">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
            />
            Item ativo (disponível para serviços e venda)
          </label>
          <button className="btn-primary col-span-2 mt-2">Salvar item</button>
        </form>
      </Modal>

      <Modal
        open={manageColorOpen}
        onClose={() => {
          setManageColorOpen(false);
          setColorForm({ id: "", name: "" });
        }}
        title="Gerenciar Cores"
      >
        <div className="space-y-6">
          <form onSubmit={saveColor} className="space-y-3 rounded-2xl bg-warm p-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-stone-500">
              {colorForm.id ? "Editar Cor" : "Nova Cor"}
            </h3>
            <Input
              label="Nome da Cor"
              value={colorForm.name}
              set={(v) => setColorForm({ ...colorForm, name: v })}
            />
            <div className="flex gap-2">
              <button
                disabled={savingColor || !colorForm.name.trim()}
                className="btn-primary flex-1 text-xs"
              >
                {savingColor ? "Salvando..." : "Salvar"}
              </button>
              {colorForm.id && (
                <button
                  type="button"
                  onClick={() => setColorForm({ id: "", name: "" })}
                  className="btn-secondary text-xs"
                >
                  Cancelar
                </button>
              )}
            </div>
          </form>

          <div className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-stone-500">Cores Cadastradas</h3>
            {colors.length ? (
              <div className="divide-y divide-black/5 max-h-60 overflow-y-auto pr-1">
                {colors.map((c: any) => (
                  <div key={c.id} className="flex items-center justify-between py-2 text-xs">
                    <span className="font-semibold text-ink">{c.name}</span>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => setColorForm({ id: c.id, name: c.name })}
                        className="rounded-full p-1 text-stone-500 hover:bg-black/5 hover:text-champagne transition"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteColor(c)}
                        className="rounded-full p-1 text-rose-600 hover:bg-rose-50 transition"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-stone-400 italic">Nenhuma cor cadastrada.</p>
            )}
          </div>
        </div>
      </Modal>

      <Modal open={movementModalOpen} onClose={() => setMovementModalOpen(false)} title="Lançar movimentação">
        {movementItem && (
          <form onSubmit={submitMovement} className="space-y-4">
            <div className="rounded-2xl bg-warm p-4 text-xs space-y-1">
              <p><strong>Item:</strong> {movementItem.item} ({movementItem.code})</p>
              <p><strong>Saldo atual:</strong> {movementItem.qty} unidades</p>
            </div>

            <label className="block">
              <span className="mb-2 block text-xs font-bold">Tipo de movimentação</span>
              <select
                className="field"
                value={movementForm.kind}
                onChange={(e) => setMovementForm({ ...movementForm, kind: e.target.value })}
              >
                <option value="entry">Entrada (Adicionar ao estoque)</option>
                <option value="exit">Saída (Retirar do estoque)</option>
                <option value="adjustment">Ajuste (Definir saldo absoluto)</option>
              </select>
            </label>

            <Input
              label="Quantidade"
              type="number"
              value={movementForm.quantity}
              set={(v) => setMovementForm({ ...movementForm, quantity: v })}
            />

            <label className="block">
              <span className="mb-2 block text-xs font-bold">Observação / Nota</span>
              <textarea
                className="field min-h-20 py-2.5"
                value={movementForm.note}
                onChange={(e) => setMovementForm({ ...movementForm, note: e.target.value })}
                placeholder="Ex: Compra de lote extra, perda por avaria, etc..."
              />
            </label>

            <button className="btn-primary w-full">Confirmar movimentação</button>
          </form>
        )}
      </Modal>
    </div>
  );
}

export function AdminCommissionsPage() {
  const p = useLoad<any[]>("/api/portal?resource=admin-commissions");
  if (p.loading) return <LoadingState />;
  const list = p.data || [];
  const pending = list
    .filter((x) => x.status !== "paid")
    .reduce((s, x) => s + Number(x.amount || 0), 0);
  const paid = list
    .filter((x) => x.status === "paid")
    .reduce((s, x) => s + Number(x.amount || 0), 0);
  return (
    <div>
      <PageHeader
        eyebrow="FINANCEIRO"
        title="Comissões"
        subtitle="Comissões calculadas por profissional e atendimento."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard label="A pagar" value={brl(pending)} icon={<WalletCards />} />
        <StatCard
          label="Total pago"
          value={brl(paid)}
          icon={<CircleDollarSign />}
          tone="dark"
        />
      </div>
      <section className="surface mt-5 overflow-hidden">
        {list.length ? (
          list.map((x) => (
            <div
              key={x.id}
              className="grid grid-cols-[1fr_auto] gap-3 border-b border-black/5 p-5 sm:grid-cols-[1fr_1fr_.6fr_.5fr]"
            >
              <span>
                <b className="block text-xs">{x.professional}</b>
                <small>
                  {x.client || "—"} • {x.service || "Comissão"}
                </small>
              </span>
              <span className="hidden text-xs sm:block">
                {x.rate}% de {brl(x.base_amount)}
              </span>
              <b className="text-xs">{brl(x.amount)}</b>
              <Badge tone={tone(x.status)}>
                {labels[x.status] || x.status}
              </Badge>
            </div>
          ))
        ) : (
          <EmptyState
            title="Nenhuma comissão"
            text="As comissões aparecerão após os atendimentos."
          />
        )}
      </section>
    </div>
  );
}

export function AdminReportsPage() {
  const [start, setStart] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
  });
  const [end, setEnd] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0];
  });

  const p = useLoad<any>(`/api/portal?resource=admin-dashboard&start=${start}&end=${end}`);

  if (p.loading) return <LoadingState />;
  if (!p.data) return <ErrorBox text={p.error} />;
  const m = p.data.metrics;

  const exportCSV = () => {
    if (!p.data) return;
    const m = p.data.metrics;

    let csvContent = "\uFEFF"; // UTF-8 BOM

    csvContent += "RELATÓRIO OPERACIONAL - CAROL SOL\n";
    csvContent += `Período:;${p.data.start} até ${p.data.end}\n\n`;

    csvContent += "MÉTRICA;VALOR\n";
    csvContent += `Faturamento no Período;${brl(m.period_revenue)}\n`;
    csvContent += `Total de Atendimentos;${m.appointments_period}\n`;
    csvContent += `Atendimentos Cancelados;${m.cancelled_period}\n`;
    csvContent += `No-shows;${m.no_show_period}\n`;
    csvContent += `Novas Clientes;${m.new_clients}\n`;
    csvContent += `Planos Ativos;${m.active_plans}\n`;
    csvContent += `Cobranças Pendentes/Parciais;${m.pending_payments}\n\n`;

    csvContent += "RANKING DE SERVIÇOS\n";
    csvContent += "Serviço;Quantidade\n";
    p.data.topServices.forEach((x: any) => {
      csvContent += `"${x.name}";${x.total}\n`;
    });
    csvContent += "\n";

    csvContent += "RANKING DE PROFISSIONAIS\n";
    csvContent += "Profissional;Quantidade de Atendimentos\n";
    p.data.topProfessionals.forEach((x: any) => {
      csvContent += `"${x.full_name}";${x.total}\n`;
    });
    csvContent += "\n";

    csvContent += "LISTA DETALHADA DE ATENDIMENTOS NO PERÍODO\n";
    csvContent += "Data;Cliente;Serviço;Profissional;Valor Estimado;Status\n";
    p.data.appointments.forEach((a: any) => {
      const dateStr = new Date(a.starts_at).toLocaleString("pt-BR");
      csvContent += `"${dateStr}";"${a.client}";"${a.service}";"${a.professional}";${a.estimated_value};"${labels[a.status] || a.status}"\n`;
    });
    csvContent += "\n";

    csvContent += "LISTA DETALHADA DE PAGAMENTOS NO PERÍODO\n";
    csvContent += "Data Criação;Data Pagamento;Cliente;Valor Total;Valor Pago;Método;Status\n";
    p.data.payments.forEach((py: any) => {
      const createdStr = new Date(py.created_at).toLocaleString("pt-BR");
      const paidStr = py.paid_at ? new Date(py.paid_at).toLocaleString("pt-BR") : "—";
      csvContent += `"${createdStr}";"${paidStr}";"${py.client}";${py.amount};${py.paid_amount || 0};"${py.method}";"${labels[py.status] || py.status}"\n`;
    });

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `relatorio_operacional_${p.data.start}_a_${p.data.end}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportPDF = () => {
    window.print();
  };

  return (
    <div>
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          nav, aside, header, .no-print, button, input, select {
            display: none !important;
          }
          body {
            background: white !important;
            color: black !important;
            padding: 2cm !important;
          }
          .surface {
            background: white !important;
            border: 1px solid #ddd !important;
            box-shadow: none !important;
            color: black !important;
            page-break-inside: avoid;
          }
          .surface * {
            color: black !important;
          }
        }
      `}} />

      <PageHeader
        eyebrow="ANÁLISE"
        title="Relatórios operacionais"
        subtitle="Resumo detalhado calculado a partir dos registros do Neon."
        action={
          <div className="flex gap-2 no-print">
            <button onClick={exportCSV} className="btn-secondary">
              <Download size={15} />
              Exportar CSV
            </button>
            <button onClick={exportPDF} className="btn-primary">
              <Download size={15} />
              Exportar PDF
            </button>
          </div>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 no-print">
        <label className="block">
          <span className="mb-2 block text-xs font-bold text-stone-400">Início do Período</span>
          <input
            type="date"
            className="field"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-2 block text-xs font-bold text-stone-400">Fim do Período</span>
          <input
            type="date"
            className="field"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Faturamento no período"
          value={brl(m.period_revenue)}
          icon={<CircleDollarSign />}
        />
        <StatCard
          label="Total de atendimentos"
          value={String(m.appointments_period)}
          icon={<CalendarDays />}
        />
        <StatCard
          label="Novas clientes"
          value={String(m.new_clients)}
          icon={<Users />}
        />
        <StatCard
          label="Planos ativos"
          value={String(m.active_plans)}
          icon={<BarChart3 />}
          tone="dark"
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <section className="surface p-6">
          <SectionHeading title="Serviços por volume" />
          {p.data.topServices.length ? (
            p.data.topServices.map((x: any) => (
              <div
                key={x.name}
                className="flex justify-between border-b border-black/5 py-3 text-xs"
              >
                <span>{x.name}</span>
                <b>{x.total}</b>
              </div>
            ))
          ) : (
            <EmptyState title="Sem dados" text="Nenhum serviço registrado no período." />
          )}
        </section>
        <section className="surface p-6">
          <SectionHeading title="Atendimentos por profissional" />
          {p.data.topProfessionals.length ? (
            p.data.topProfessionals.map((x: any) => (
              <div
                key={x.full_name}
                className="flex justify-between border-b border-black/5 py-3 text-xs"
              >
                <span>{x.full_name}</span>
                <b>{x.total}</b>
              </div>
            ))
          ) : (
            <EmptyState
              title="Sem dados"
              text="Nenhum atendimento registrado no período."
            />
          )}
        </section>
      </div>
    </div>
  );
}

export function AdminSumupPage() {
  const p = useLoad<any>("/api/payments?resource=sumup-integration");
  if (p.loading) return <LoadingState />;
  if (!p.data) return <ErrorBox text={p.error} />;
  const data = p.data;
  return (
    <div>
      <PageHeader
        eyebrow="INTEGRAÇÃO DE PAGAMENTO"
        title="SumUp"
        subtitle="Status seguro da integração, sem exibir credenciais."
        action={
          <button onClick={() => p.reload()} className="btn-secondary">
            <RefreshCw size={15} />
            Atualizar status
          </button>
        }
      />
      {!data.configured && (
        <div className="mb-5 rounded-2xl bg-amber-50 p-4 text-xs font-semibold text-amber-900">
          A SumUp ainda não possui API Key e Merchant Code configurados no
          Vercel. Nenhum pagamento por cartão será simulado.
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Integração"
          value={data.enabled && data.configured ? "Ativa" : "Inativa"}
          icon={<CreditCard />}
          tone={data.enabled && data.configured ? "dark" : "gold"}
        />
        <StatCard
          label="Ambiente"
          value={String(data.environment || "sandbox")}
          icon={<CreditCard />}
        />
        <StatCard
          label="Recebido"
          value={brl(data.stats?.paid_total)}
          icon={<CircleDollarSign />}
        />
        <StatCard
          label="Pendentes"
          value={String(data.stats?.pending || 0)}
          icon={<CreditCard />}
        />
      </div>
      <section className="surface mt-5 p-6">
        <SectionHeading title="Diagnóstico" />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl bg-warm p-4 text-xs">
            <span className="text-stone-400">Merchant Code</span>
            <b className="mt-1 block">
              {data.merchantCode || "Não configurado"}
            </b>
          </div>
          <div className="rounded-2xl bg-warm p-4 text-xs">
            <span className="text-stone-400">Último checkout</span>
            <b className="mt-1 block">{dt(data.stats?.last_checkout)}</b>
          </div>
          <div className="rounded-2xl bg-warm p-4 text-xs">
            <span className="text-stone-400">Falhos</span>
            <b className="mt-1 block">{data.stats?.failed || 0}</b>
          </div>
          <div className="rounded-2xl bg-warm p-4 text-xs">
            <span className="text-stone-400">Último webhook</span>
            <b className="mt-1 block">{dt(data.lastWebhook?.received_at)}</b>
            {data.lastWebhook?.processing_error && (
              <small className="mt-1 block text-rose-700">
                {data.lastWebhook.processing_error}
              </small>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

export function AdminSettingsPage() {
  const p = useLoad<any>("/api/portal?resource=admin-settings");
  const backupsLoad = useLoad<any[]>("/api/portal?resource=admin-backups");

  const [activeTab, setActiveTab] = useState<"general" | "backup">("general");
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const [form, setForm] = useState<any>({
    businessName: "Carol Sol",
    phone: "",
    whatsapp: "",
    email: "",
    address: "",
    timezone: "America/Sao_Paulo",
  });
  const [templates, setTemplates] = useState({
    confirmation: "",
    reminder: "",
    cancellation: "",
    reschedule: ""
  });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [testChannel, setTestChannel] = useState("email");
  const [testRecipient, setTestRecipient] = useState("");
  const [testMessage, setTestMessage] = useState("Ola, este e um teste de comunicacao do sistema Carol Sol.");
  const [testSending, setTestSending] = useState(false);
  useEffect(() => {
    if (p.data) {
      setForm((current: any) => ({ ...current, ...p.data }));
      if (p.data.templates) {
        setTemplates(p.data.templates);
      }
    }
  }, [p.data]);

  const triggerBackup = async () => {
    setCreatingBackup(true);
    try {
      await apiFetch("/api/portal?resource=admin-backup-create", { method: "POST" });
      setToast("Backup criado com sucesso!");
      await backupsLoad.reload();
    } catch (err) {
      console.error(err);
      setToast("Erro ao criar backup.");
    } finally {
      setCreatingBackup(false);
      setTimeout(() => setToast(""), 2200);
    }
  };

  const triggerRestore = async (id: string, filename: string) => {
    if (!window.confirm(`ATENÇÃO: Restaurar o backup "${filename}" substituirá TODO o banco de dados atual. Deseja continuar?`)) {
      return;
    }
    setRestoring(true);
    try {
      await apiFetch("/api/portal?resource=admin-backup-restore", {
        method: "POST",
        body: JSON.stringify({ id }),
      });
      alert("Banco de dados restaurado com sucesso!");
      window.location.reload();
    } catch (err) {
      console.error(err);
      alert("Erro ao restaurar o backup.");
    } finally {
      setRestoring(false);
    }
  };

  const triggerDelete = async (id: string) => {
    if (!window.confirm("Deseja realmente excluir este registro de backup do histórico?")) {
      return;
    }
    try {
      await apiFetch("/api/portal?resource=admin-backup-delete", {
        method: "DELETE",
        body: JSON.stringify({ id }),
      });
      setToast("Backup excluído do histórico.");
      await backupsLoad.reload();
    } catch (err) {
      console.error(err);
      setToast("Erro ao excluir backup.");
    } finally {
      setTimeout(() => setToast(""), 2200);
    }
  };

  const downloadFile = async (id: string, filename: string) => {
    try {
      const res = await apiFetch<any>(`/api/portal?resource=admin-backup-download&id=${id}`);
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setToast("Arquivo baixado com sucesso.");
    } catch (err) {
      console.error(err);
      setToast("Erro ao baixar o arquivo.");
    } finally {
      setTimeout(() => setToast(""), 2200);
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const json = JSON.parse(e.target?.result as string);
        if (!json.tables) {
          alert("Arquivo de backup inválido.");
          return;
        }
        if (!window.confirm("ATENÇÃO: Restaurar este backup local substituirá TODO o banco de dados atual. Deseja continuar?")) {
          return;
        }
        setRestoring(true);
        await apiFetch("/api/portal?resource=admin-backup-restore", {
          method: "POST",
          body: JSON.stringify({ rawJson: json }),
        });
        alert("Banco de dados restaurado com sucesso!");
        window.location.reload();
      } catch (err) {
        console.error(err);
        alert("Erro ao ler ou restaurar o arquivo de backup local.");
      } finally {
        setRestoring(false);
      }
    };
    reader.readAsText(file);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch("/api/portal?resource=admin-settings", {
        method: "PATCH",
        body: JSON.stringify({ ...form, templates }),
      });
      await p.reload();
      setToast("Alterações salvas com sucesso.");
    } catch (err) {
      console.error("Business settings error", err);
      setToast(
        err instanceof Error
          ? err.message
          : "Ocorreu um erro ao salvar os dados.",
      );
    } finally {
      setSaving(false);
      setTimeout(() => setToast(""), 2200);
    }
  };

  const sendTestNotification = async () => {
    setTestSending(true);
    try {
      await apiFetch("/api/portal?resource=test-notification", {
        method: "POST",
        body: JSON.stringify({
          channel: testChannel,
          recipient: testRecipient,
          message: testMessage,
        }),
      });
      setToast("Mensagem de teste enviada com sucesso!");
    } catch (err) {
      console.error("Test notification error", err);
      setToast(err instanceof Error ? err.message : "Erro ao enviar mensagem de teste.");
    } finally {
      setTestSending(false);
      setTimeout(() => setToast(""), 2200);
    }
  };

  if (p.loading) return <LoadingState />;
  if (p.error) return <ErrorBox text={p.error} />;

  return (
    <div>
      <Toast show={!!toast} message={toast} />
      <PageHeader
        eyebrow="CONFIGURAÇÕES"
        title="Dados da empresa"
        subtitle="Informações operacionais persistidas e auditadas."
      />

      <div className="mb-6 flex gap-2 border-b border-black/10 pb-3">
        <button
          type="button"
          onClick={() => setActiveTab("general")}
          className={`px-4 py-2 text-xs font-bold uppercase tracking-wider transition-all duration-200 border-b-2 ${
            activeTab === "general"
              ? "border-champagne text-champagne"
              : "border-transparent text-stone-400 hover:text-stone-600"
          }`}
        >
          Configurações Gerais
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("backup")}
          className={`px-4 py-2 text-xs font-bold uppercase tracking-wider transition-all duration-200 border-b-2 ${
            activeTab === "backup"
              ? "border-champagne text-champagne"
              : "border-transparent text-stone-400 hover:text-stone-600"
          }`}
        >
          Backup & Restauração
        </button>
      </div>

      {activeTab === "general" ? (
        <>
          <form onSubmit={save} className="surface grid gap-4 p-6 sm:grid-cols-2">
            <Input
              label="Nome da empresa"
              value={form.businessName || ""}
              set={(v) => setForm({ ...form, businessName: v })}
            />
            <Input
              label="E-mail"
              type="email"
              value={form.email || ""}
              set={(v) => setForm({ ...form, email: v })}
            />
            <Input
              label="Telefone"
              value={form.phone || ""}
              set={(v) => setForm({ ...form, phone: v })}
            />
            <Input
              label="WhatsApp"
              value={form.whatsapp || ""}
              set={(v) => setForm({ ...form, whatsapp: v })}
            />
            <div className="sm:col-span-2">
              <Input
                label="Endereço"
                value={form.address || ""}
                set={(v) => setForm({ ...form, address: v })}
              />
            </div>
            <div className="sm:col-span-2">
              <Input
                label="Fuso horário"
                value={form.timezone || ""}
                set={(v) => setForm({ ...form, timezone: v })}
              />
            </div>
            <button disabled={saving} className="btn-primary sm:col-span-2">
              <Save size={15} />
              {saving ? "Salvando…" : "Salvar configurações"}
            </button>
          </form>

          <section className="surface p-6 mt-6">
            <SectionHeading title="Templates de Mensagens" />
            <p className="muted text-xs mb-4">
              Personalize as mensagens automáticas enviadas aos clientes. Use as tags <code>{"{name}"}</code>, <code>{"{service}"}</code>, <code>{"{professional}"}</code>, <code>{"{date}"}</code> e <code>{"{window}"}</code> para inserção dinâmica de dados.
            </p>
            <div className="space-y-4">
              <label className="block">
                <span className="mb-2 block text-xs font-bold">Confirmação de Agendamento</span>
                <textarea
                  className="field min-h-[70px] py-3"
                  value={templates.confirmation || ""}
                  placeholder="Ex: Olá, {name}! Seu agendamento de {service} com {professional} foi reservado para {date}. — Carol Sol"
                  onChange={(e) => setTemplates({ ...templates, confirmation: e.target.value })}
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-xs font-bold">Lembrete de Agendamento</span>
                <textarea
                  className="field min-h-[70px] py-3"
                  value={templates.reminder || ""}
                  placeholder="Ex: Olá, {name}! Lembrete Carol Sol: seu atendimento de {service} com {professional} será {window}."
                  onChange={(e) => setTemplates({ ...templates, reminder: e.target.value })}
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-xs font-bold">Cancelamento de Agendamento</span>
                <textarea
                  className="field min-h-[70px] py-3"
                  value={templates.cancellation || ""}
                  placeholder="Ex: Olá, {name}. Seu agendamento de {service} em {date} foi cancelado."
                  onChange={(e) => setTemplates({ ...templates, cancellation: e.target.value })}
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-xs font-bold">Solicitação de Reagendamento</span>
                <textarea
                  className="field min-h-[70px] py-3"
                  value={templates.reschedule || ""}
                  placeholder="Ex: {client} solicitou reagendamento de {service} para {date}. Acesse sua agenda para responder."
                  onChange={(e) => setTemplates({ ...templates, reschedule: e.target.value })}
                />
              </label>
            </div>
          </section>

          <section className="surface p-6 mt-6">
            <SectionHeading title="Testador de Comunicações" />
            <p className="muted text-xs mb-4">
              Envie uma mensagem de teste para validar o funcionamento do Resend (E-mail) e Baileys (WhatsApp).
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-xs font-bold">Canal</span>
                <select
                  className="field"
                  value={testChannel}
                  onChange={(e) => setTestChannel(e.target.value)}
                >
                  <option value="email">E-mail</option>
                  <option value="whatsapp">WhatsApp</option>
                </select>
              </label>
              <Input
                label="Destinatário"
                placeholder={testChannel === "email" ? "exemplo@email.com" : "5511999999999"}
                value={testRecipient}
                set={setTestRecipient}
              />
              <div className="sm:col-span-2">
                <label className="block">
                  <span className="mb-2 block text-xs font-bold">Mensagem de Teste</span>
                  <textarea
                    className="field min-h-[80px] py-3"
                    placeholder="Escreva a mensagem de teste aqui..."
                    value={testMessage}
                    onChange={(e) => setTestMessage(e.target.value)}
                  />
                </label>
              </div>
              <button
                type="button"
                disabled={testSending || !testRecipient || !testMessage}
                onClick={sendTestNotification}
                className="btn-secondary sm:col-span-2"
              >
                {testSending ? "Enviando..." : "Enviar Mensagem de Teste"}
              </button>
            </div>
          </section>
        </>
      ) : (
        <div className="grid gap-6 md:grid-cols-3">
          <div className="md:col-span-2 surface p-6">
            <div className="flex items-center justify-between mb-4">
              <SectionHeading title="Histórico de Backups na Nuvem" />
              <button
                type="button"
                disabled={creatingBackup || restoring}
                onClick={triggerBackup}
                className="btn-primary min-h-0 py-2"
              >
                {creatingBackup ? "Criando..." : "Criar Backup"}
              </button>
            </div>

            {backupsLoad.loading ? (
              <LoadingState />
            ) : backupsLoad.data && backupsLoad.data.length > 0 ? (
              <div className="divide-y divide-black/5">
                {backupsLoad.data.map((item: any) => (
                  <div key={item.id} className="py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <b className="block text-sm font-display">{item.filename}</b>
                      <span className="text-xs text-stone-400">
                        {dt(item.created_at)} • {(item.size_bytes / 1024).toFixed(1)} KB • Criado por {item.creator || "Sistema"}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => downloadFile(item.id, item.filename)}
                        className="btn-secondary py-1.5 px-3 text-xs min-h-0"
                      >
                        Baixar
                      </button>
                      <button
                        type="button"
                        disabled={restoring}
                        onClick={() => triggerRestore(item.id, item.filename)}
                        className="btn-primary py-1.5 px-3 text-xs min-h-0"
                      >
                        Restaurar
                      </button>
                      <button
                        type="button"
                        onClick={() => triggerDelete(item.id)}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 transition hover:bg-rose-100 hover:border-rose-300 disabled:opacity-50 min-h-0"
                      >
                        Excluir
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="Nenhum backup" text="Nenhum registro de backup encontrado." />
            )}
          </div>

          <div className="surface p-6 flex flex-col gap-4 h-fit">
            <SectionHeading title="Restaurar de Arquivo Local" />
            <p className="muted text-xs">
              Selecione um arquivo de backup (.json) salvo no seu computador para restaurar o estado do sistema.
            </p>

            <label className="flex flex-col items-center justify-center border-2 border-dashed border-stone-300 rounded-2xl p-6 hover:border-champagne hover:bg-stone-50/50 cursor-pointer transition">
              <Save size={30} className="text-stone-400 mb-2" />
              <span className="text-xs font-bold text-stone-600">Carregar arquivo .json</span>
              <input
                type="file"
                accept=".json"
                onChange={handleFileUpload}
                className="hidden"
                disabled={restoring}
              />
            </label>

            {restoring && (
              <div className="p-3 bg-amber-50 text-amber-700 rounded-xl text-xs font-bold animate-pulse text-center">
                Restaurando banco de dados, por favor aguarde...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-warm p-4">
      <span className="text-[9px] uppercase text-stone-400">{label}</span>
      <b className="mt-1 block text-xs">{value}</b>
    </div>
  );
}
function Row({
  title,
  detail,
  value,
}: {
  title: string;
  detail: string;
  value: any;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-black/5 py-4 last:border-0">
      <span>
        <b className="block text-xs">{title}</b>
        <span className="text-[10px] text-stone-400">{detail}</span>
      </span>
      <span className="text-xs font-bold">{value}</span>
    </div>
  );
}
function TableEmpty({
  rows,
  render,
}: {
  rows: any[];
  render: (row: any, index: number) => any;
}) {
  return rows?.length ? (
    <>{rows.map(render)}</>
  ) : (
    <EmptyState
      title="Nenhum registro encontrado"
      text="Não existem dados nesta seção."
    />
  );
}
function Input({
  label,
  value,
  set,
  type = "text",
  placeholder,
  disabled = false,
}: {
  label: string;
  value: string;
  set: (v: string) => void;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-bold">{label}</span>
      <input
        className="field"
        type={type}
        value={value}
        disabled={disabled}
        onChange={(e) => set(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}
