import { FormEvent, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  CalendarDays,
  Check,
  Clock3,
  Copy,
  CreditCard,
  Download,
  ExternalLink,
  FileText,
  Gift,
  MapPin,
  Plus,
  QrCode,
  Save,
  Scissors,
  Sparkles,
  Trash2,
  UserPlus,
  Upload,
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
  Toast,
} from "../../components/ui";
import { apiFetch, uploadFile, uploadImage } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";

declare global {
  interface Window {
    SumUpCard?: {
      mount: (options: {
        id: string;
        checkoutId: string;
        onResponse: (type: string, body: unknown) => void;
      }) => void;
    };
  }
}

let sumupWidgetLoader: Promise<void> | null = null;
function loadSumupWidget() {
  if (window.SumUpCard) return Promise.resolve();
  if (sumupWidgetLoader) return sumupWidgetLoader;
  sumupWidgetLoader = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-sumup-card-widget="true"]',
    );
    const ready = () =>
      window.SumUpCard
        ? resolve()
        : reject(new Error("O widget da SumUp não ficou disponível."));
    if (existing) {
      existing.addEventListener("load", ready, { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Não foi possível carregar o widget da SumUp.")),
        { once: true },
      );
      return;
    }
    const script = document.createElement("script");
    script.src = "https://gateway.sumup.com/gateway/ecom/card/v2/sdk.js";
    script.async = true;
    script.dataset.sumupCardWidget = "true";
    script.addEventListener("load", ready, { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error("Não foi possível carregar o widget da SumUp.")),
      { once: true },
    );
    document.head.appendChild(script);
  }).catch((error) => {
    sumupWidgetLoader = null;
    throw error;
  });
  return sumupWidgetLoader;
}

type PortalResponse<T> = { data: T };
const brl = (value: unknown) =>
  Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
const servicePriceLabel = (service: Record<string, any>, inventoryItems: Array<Record<string, any>> = []) => {
  if (service?.offer_inventory_items) {
    const matching = (inventoryItems || []).filter(
      (item) => item.category_id === service.category_id && 
                (!service.hair_method_id || item.hair_method_id === service.hair_method_id)
    );
    if (matching.length > 0) {
      const prices = matching.map((item) => Number(item.suggested_price || 0));
      const minPrice = Math.min(...prices);
      return `A partir de ${brl(minPrice)}`;
    }
    return "Sob consulta";
  }
  return service?.is_free ? "Sem custo" : brl(service?.base_price);
};
const date = (value: unknown) =>
  value ? new Date(String(value)).toLocaleDateString("pt-BR") : "—";
const dateTime = (value: unknown) =>
  value
    ? new Date(String(value)).toLocaleString("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "—";
const statusLabel: Record<string, string> = {
  pending: "Pendente",
  pending_deposit: "Aguardando sinal",
  under_review: "Em análise",
  confirmed: "Confirmado",
  in_service: "Em atendimento",
  rescheduled: "Reagendado",
  reschedule_requested: "Reagendamento solicitado",
  paid: "Pago",
  partial: "Parcial",
  cancelled: "Cancelado",
  refunded: "Reembolsado",
  failed: "Falhou",
  no_show: "Faltou",
  active: "Ativo",
  awaiting_payment: "Aguardando pagamento",
  paused: "Pausado",
  expired: "Expirado",
  delinquent: "Inadimplente",
  draft: "Rascunho",
  requested: "Solicitação enviada",
  invited: "Convidado",
  registered: "Registrado",
  processing: "Processando",
  approved: "Aprovado",
  rejected: "Rejeitado",
  completed: "Concluído",
};
const statusTone = (
  status: string,
): "green" | "gold" | "amber" | "rose" | "neutral" =>
  status === "paid" ||
  status === "active" ||
  status === "approved" ||
  status === "completed" ||
  status === "confirmed"
    ? "green"
    : status === "pending" ||
        status === "requested" ||
        status === "pending_deposit" ||
        status === "awaiting_payment" ||
        status === "under_review" ||
        status === "rescheduled" ||
        status === "reschedule_requested" ||
        status === "in_service"
      ? "amber"
      : status === "cancelled" ||
          status === "refunded" ||
          status === "failed" ||
          status === "rejected" ||
          status === "delinquent" ||
          status === "no_show"
        ? "rose"
        : "neutral";

function usePortal<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reload = () => {
    setLoading(true);
    setError("");
    return apiFetch<PortalResponse<T> | T>(url)
      .then((result) =>
        setData(((result as PortalResponse<T>).data ?? result) as T),
      )
      .catch((err) => {
        console.error("Portal load error", err);
        setError(err.message);
      })
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    reload();
  }, [url]);
  return { data, loading, error, reload, setData };
}

function Notice({ message }: { message: string }) {
  return message ? (
    <div className="rounded-2xl bg-rose-50 p-4 text-xs font-semibold text-rose-700">
      {message}
    </div>
  ) : null;
}

export function ClientHomePage() {
  const nav = useNavigate();
  const overview = usePortal<any>("/api/portal?resource=client-overview");
  const bootstrap = usePortal<any>("/api/data?resource=bootstrap");
  const prompt = overview.data?.firstAccessPrompt;
  const promptKey = prompt
    ? `carolsol:first-access:${prompt.id}:${prompt.payment_id || "no-payment"}`
    : "";
  const [firstAccessOpen, setFirstAccessOpen] = useState(false);

  useEffect(() => {
    if (!promptKey) return;
    if (window.localStorage.getItem(promptKey) !== "dismissed") {
      setFirstAccessOpen(true);
    }
  }, [promptKey]);

  const closeFirstAccess = () => {
    if (promptKey) window.localStorage.setItem(promptKey, "dismissed");
    setFirstAccessOpen(false);
  };

  if (overview.loading || bootstrap.loading) return <LoadingState />;
  if (!overview.data) return <Notice message={overview.error} />;
  const d = overview.data;
  const firstName = String(d.profile?.full_name || "Cliente").split(" ")[0];
  return (
    <div>
      <PageHeader
        eyebrow="MINHA JORNADA"
        title={`Olá, ${firstName}.`}
        subtitle="Seus próximos cuidados e benefícios atualizados em tempo real."
      />
      <Modal
        open={firstAccessOpen && Boolean(prompt)}
        onClose={closeFirstAccess}
        title="Seu agendamento"
      >
        {prompt && (
          <div className="space-y-5">
            <div className="rounded-2xl bg-warm p-4">
              <Badge tone={statusTone(prompt.status)}>
                {statusLabel[prompt.status] || prompt.status}
              </Badge>
              <h3 className="mt-3 font-display text-3xl font-semibold">
                {prompt.service}
              </h3>
              <p className="mt-2 text-sm text-stone-500">
                {dateTime(prompt.starts_at)} • {prompt.professional} •{" "}
                {prompt.location || "Carol Sol"}
              </p>
              {prompt.booking_code && (
                <p className="mt-3 text-xs font-bold text-stone-500">
                  Codigo {prompt.booking_code}
                </p>
              )}
            </div>
            {prompt.payment_id && (
              <div className="rounded-2xl border border-champagne/30 bg-champagne/10 p-4">
                <b className="block text-xs">Fatura disponivel</b>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="text-sm text-stone-600">
                    {prompt.billing_reason || "Pagamento do agendamento"}
                  </span>
                  <b className="font-display text-2xl">
                    {brl(prompt.payment_amount)}
                  </b>
                </div>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              {prompt.payment_id && (
                <button
                  type="button"
                  className="btn-primary justify-center"
                  onClick={() => {
                    closeFirstAccess();
                    nav(`/cliente/pagamentos/${prompt.payment_id}`);
                  }}
                >
                  <WalletCards size={16} />
                  Ir para pagamento
                </button>
              )}
              <button
                type="button"
                className="btn-secondary justify-center"
                onClick={() => {
                  closeFirstAccess();
                  nav(`/cliente/agendamentos/${prompt.id}`);
                }}
              >
                <CalendarDays size={16} />
                Ver detalhes
              </button>
            </div>
          </div>
        )}
      </Modal>
      <section className="hair-gradient rounded-[30px] p-7 text-white sm:p-10">
        <div className="eyebrow">PRÓXIMO CUIDADO</div>
        {d.nextAppointment ? (
          <>
            <h2 className="mt-3 font-display text-4xl">
              {d.nextAppointment.service}
            </h2>
            <p className="mt-3 text-sm text-white/60">
              {dateTime(d.nextAppointment.starts_at)} •{" "}
              {d.nextAppointment.professional} •{" "}
              {d.nextAppointment.location || "Carol Sol"}
            </p>
            <button
              onClick={() => nav("/cliente/agendamentos")}
              className="btn-gold mt-6"
            >
              Ver agendamento
            </button>
          </>
        ) : (
          <>
            <h2 className="mt-3 font-display text-4xl">
              Sua agenda está livre
            </h2>
            <p className="mt-3 text-sm text-white/60">
              Escolha um serviço e reserve seu próximo cuidado.
            </p>
            <button
              onClick={() => nav("/cliente/agendamentos")}
              className="btn-gold mt-6"
            >
              Agendar agora
            </button>
          </>
        )}
      </section>
      <div className="mt-5 grid gap-4 sm:grid-cols-4">
        <button
          onClick={() => nav("/cliente/beneficios")}
          className="surface p-5 text-left"
        >
          <Gift className="text-champagne" />
          <b className="mt-3 block text-xl">{d.points} pontos</b>
          <span className="text-[10px] text-stone-400">
            {d.subscription?.name
              ? `${d.subscription.name} • ${statusLabel[d.subscription.status] || d.subscription.status}`
              : "Nenhum plano ativo"}
          </span>
        </button>
        <button
          onClick={() => nav("/cliente/cupons")}
          className="surface p-5 text-left"
        >
          <Sparkles className="text-champagne" />
          <b className="mt-3 block text-xl">{d.coupons.length} cupons</b>
          <span className="text-[10px] text-stone-400">
            Benefícios disponíveis
          </span>
        </button>
        <button
          onClick={() => nav("/cliente/pagamentos")}
          className="surface p-5 text-left"
        >
          <WalletCards className="text-champagne" />
          <b className="mt-3 block text-xl">{brl(d.pendingPayments.amount)}</b>
          <span className="text-[10px] text-stone-400">
            {d.pendingPayments.count} pagamentos pendentes
          </span>
        </button>
        <button
          onClick={() => nav("/cliente/historico")}
          className="surface p-5 text-left"
        >
          <FileText className="text-champagne" />
          <b className="mt-3 block text-xl">Histórico</b>
          <span className="text-[10px] text-stone-400">
            Serviços, fichas e fotos
          </span>
        </button>
      </div>
      <section className="mt-8">
        <SectionHeading
          title="Serviços disponíveis"
          link="Ver todos"
          onClick={() => nav("/cliente/servicos")}
        />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {bootstrap.data?.services?.length ? (
            bootstrap.data.services.map((s: any) => (
              <div key={s.id} className="surface p-5">
                <CalendarDays className="text-champagne" />
                <h3 className="mt-3 font-display text-2xl">{s.name}</h3>
                <p className="muted mt-2">{s.description}</p>
                <div className="mt-4 flex justify-between text-xs">
                  <span>
                    <Clock3 className="mr-1 inline" size={13} />
                    {s.duration_minutes}min
                  </span>
                  <b>{servicePriceLabel(s, bootstrap.data?.inventoryItems || [])}</b>
                </div>
                <button
                  onClick={() => nav("/cliente/agendamentos")}
                  className="btn-primary mt-5 w-full"
                >
                  Agendar
                </button>
              </div>
            ))
          ) : (
            <EmptyState
              title="Nenhum serviço disponível"
              text="O catálogo está temporariamente vazio."
            />
          )}
        </div>
      </section>
    </div>
  );
}

export function ClientProfilePage() {
  const nav = useNavigate();
  const { refresh } = useAuth();
  const portal = usePortal<any>("/api/portal?resource=profile");
  const history = usePortal<any>("/api/portal?resource=client-history");
  const [form, setForm] = useState<any>({
    fullName: "",
    email: "",
    phone: "",
    cpf: "",
    birthDate: "",
    instagram: "",
    address: {},
    preferences: {},
    personalNotes: "",
    avatarUrl: "",
  });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [uploading, setUploading] = useState(false);
  useEffect(() => {
    if (portal.data)
      setForm({
        fullName: portal.data.full_name || "",
        email: portal.data.email || "",
        phone: portal.data.phone || "",
        cpf: portal.data.cpf || "",
        birthDate: portal.data.birth_date?.slice(0, 10) || "",
        instagram: portal.data.instagram || "",
        address: portal.data.address || {},
        preferences: portal.data.preferences || {},
        personalNotes: portal.data.personal_notes || "",
        avatarUrl: portal.data.avatar_url || "",
      });
  }, [portal.data]);
  if (portal.loading) return <LoadingState />;
  if (!portal.data)
    return (
      <>
        <PageHeader title="Perfil" />
        <Notice message={portal.error} />
      </>
    );
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch("/api/portal?resource=profile", {
        method: "PATCH",
        body: JSON.stringify(form),
      });
      await Promise.all([portal.reload(), refresh()]);
      setToast("Alterações salvas com sucesso.");
    } catch (err) {
      console.error("Profile save error", err);
      setToast(
        err instanceof Error
          ? err.message
          : "Ocorreu um erro ao salvar os dados.",
      );
    } finally {
      setSaving(false);
      setTimeout(() => setToast(""), 2600);
    }
  };
  const photo = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try {
      const uploaded = await uploadImage(file, "profile-photo");
      await apiFetch("/api/portal?resource=profile", {
        method: "PATCH",
        body: JSON.stringify({
          fullName: portal.data.full_name || "",
          email: portal.data.email || "",
          phone: portal.data.phone || "",
          cpf: portal.data.cpf || "",
          birthDate: portal.data.birth_date?.slice(0, 10) || "",
          instagram: portal.data.instagram || "",
          address: portal.data.address || {},
          preferences: portal.data.preferences || {},
          personalNotes: portal.data.personal_notes || "",
          avatarUrl: uploaded.url,
        }),
      });
      await Promise.all([portal.reload(), refresh()]);
      setToast("Foto atualizada com sucesso.");
    } catch (err) {
      console.error("Profile photo error", err);
      setToast(
        err instanceof Error ? err.message : "Não foi possível enviar a foto.",
      );
    } finally {
      setUploading(false);
      setTimeout(() => setToast(""), 2600);
    }
  };
  const recent = history.data?.appointments?.slice(0, 3) || [];
  const summary = history.data?.summary || {};
  return (
    <div className="animate-fade-up">
      <Toast show={!!toast} message={toast} />
      <PageHeader
        eyebrow="MINHA CONTA"
        title="Perfil e preferências"
        subtitle="Dados reais da sua conta Carol Sol."
        action={
          <button
            onClick={() => nav("/cliente/historico")}
            className="btn-secondary"
          >
            <FileText size={16} />
            Ver histórico completo
          </button>
        }
      />
      <form onSubmit={save} className="grid gap-5 lg:grid-cols-[300px_1fr]">
        <aside className="surface self-start p-7 text-center">
          <Avatar src={form.avatarUrl} name={form.fullName} size="lg" />
          <h2 className="mt-4 font-display text-3xl font-semibold">
            {form.fullName}
          </h2>
          <p className="text-xs text-stone-400">
            Conta{" "}
            {statusLabel[portal.data.account_status] ||
              portal.data.account_status}
          </p>
          <div className="mt-5 grid grid-cols-3 rounded-2xl bg-warm p-4 text-center text-[10px]">
            <span>
              <b className="block text-sm">{summary.loyaltyBalance ?? "—"}</b>
              Pontos
            </span>
            <span>
              <b className="block text-sm">
                {summary.completedAppointments ?? "—"}
              </b>
              Atend.
            </span>
            <span>
              <b className="block text-sm">{summary.technicalRecords ?? "—"}</b>
              Fichas
            </span>
          </div>
          <label className="btn-secondary mt-5 cursor-pointer">
            {uploading ? "Enviando…" : "Trocar foto"}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={uploading}
              onChange={(e) => photo(e.target.files?.[0])}
            />
          </label>
        </aside>
        <section className="surface p-6 sm:p-8">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Nome completo"
              value={form.fullName}
              onChange={(v) => setForm({ ...form, fullName: v })}
            />
            <Field
              label="E-mail"
              type="email"
              value={form.email}
              onChange={(v) => setForm({ ...form, email: v })}
            />
            <Field
              label="Telefone"
              value={form.phone}
              onChange={(v) => setForm({ ...form, phone: v })}
            />
            <Field
              label="CPF"
              value={form.cpf}
              onChange={(v) => setForm({ ...form, cpf: v })}
            />
            <Field
              label="Nascimento"
              type="date"
              value={form.birthDate}
              onChange={(v) => setForm({ ...form, birthDate: v })}
            />
            <Field
              label="Instagram"
              value={form.instagram}
              onChange={(v) => setForm({ ...form, instagram: v })}
            />
            <Field
              label="CEP"
              value={form.address?.zip || ""}
              onChange={(v) =>
                setForm({ ...form, address: { ...form.address, zip: v } })
              }
            />
            <Field
              label="Cidade"
              value={form.address?.city || ""}
              onChange={(v) =>
                setForm({ ...form, address: { ...form.address, city: v } })
              }
            />
            <Field
              label="Estado"
              value={form.address?.state || ""}
              onChange={(v) =>
                setForm({ ...form, address: { ...form.address, state: v } })
              }
            />
          </div>
          <label className="mt-4 block">
            <span className="mb-2 block text-xs font-bold">Endereço</span>
            <input
              className="field"
              value={form.address?.street || ""}
              onChange={(e) =>
                setForm({
                  ...form,
                  address: { ...form.address, street: e.target.value },
                })
              }
            />
          </label>
          <label className="mt-4 block">
            <span className="mb-2 block text-xs font-bold">
              Preferências e observações pessoais
            </span>
            <textarea
              className="field min-h-24 py-3"
              value={form.personalNotes}
              onChange={(e) =>
                setForm({ ...form, personalNotes: e.target.value })
              }
            />
          </label>
          <button
            disabled={saving}
            className="btn-primary mt-6 disabled:opacity-50"
          >
            <Save size={16} />
            {saving ? "Salvando…" : "Salvar alterações"}
          </button>
        </section>
      </form>
      <section className="surface mt-5 p-6">
        <SectionHeading
          title="Histórico de serviços"
          link="Ver todos"
          onClick={() => nav("/cliente/historico")}
        />
        {history.loading ? (
          <LoadingState />
        ) : recent.length ? (
          <div className="grid gap-3">
            {recent.map((a: any) => (
              <button
                key={a.id}
                onClick={() => nav(`/cliente/agendamentos/${a.id}`)}
                className="flex items-center gap-4 rounded-2xl border border-black/5 p-4 text-left transition hover:bg-warm"
              >
                <Scissors size={17} className="text-champagne" />
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-xs">{a.service}</b>
                  <span className="text-[10px] text-stone-400">
                    {dateTime(a.starts_at)} • {a.professional}
                  </span>
                </span>
                <Badge tone={statusTone(a.status)}>
                  {statusLabel[a.status] || a.status}
                </Badge>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            title="Nenhum histórico ainda"
            text="Quando houver atendimentos, eles aparecerão aqui com fichas técnicas e registros."
          />
        )}
      </section>
    </div>
  );
}

export function ClientPaymentsPage() {
  const location = useLocation();
  const id = location.pathname.split("/pagamentos/")[1];
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");
  const portal = usePortal<any>(
    `/api/portal?resource=payments${id ? `&id=${encodeURIComponent(id)}` : "&id=structured"}`,
  );
  const chooseMethod = async (provider: "pix_manual" | "local") => {
    if (!id) return;
    setBusy(provider);
    try {
      await apiFetch("/api/payments?resource=payment-method", {
        method: "POST",
        body: JSON.stringify({ paymentId: id, provider }),
      });
      await portal.reload();
      setToast("Forma de pagamento atualizada.");
    } catch (error) {
      console.error("Payment method error", error);
      setToast(
        error instanceof Error
          ? error.message
          : "Não foi possível concluir a ação.",
      );
    } finally {
      setBusy("");
      setTimeout(() => setToast(""), 2600);
    }
  };
  const openSumup = async () => {
    if (!id) return;
    setBusy("sumup");
    try {
      const result = await apiFetch<{ url: string }>(
        "/api/payments?resource=create-sumup-checkout",
        {
          method: "POST",
          body: JSON.stringify({ paymentId: id }),
        },
      );
      window.location.assign(result.url);
    } catch (error) {
      console.error("SumUp checkout error", error);
      setToast(
        error instanceof Error
          ? error.message
          : "Não foi possível abrir o pagamento seguro.",
      );
      setBusy("");
      setTimeout(() => setToast(""), 3200);
    }
  };
  const receipt = async (file?: File) => {
    if (!file || !id) return;
    if (!(file.type.startsWith("image/") || file.type === "application/pdf")) {
      setToast("Envie o comprovante em imagem ou PDF.");
      setTimeout(() => setToast(""), 2800);
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setToast("O arquivo deve ter no máximo 8 MB.");
      setTimeout(() => setToast(""), 2800);
      return;
    }
    setBusy("receipt");
    try {
      const uploaded = await uploadFile(file, "payment-receipt");
      await apiFetch("/api/payments?resource=receipt", {
        method: "POST",
        body: JSON.stringify({ paymentId: id, url: uploaded.url }),
      });
      await portal.reload();
      setToast("Comprovante enviado para análise.");
    } catch (error) {
      console.error("Receipt upload error", error);
      setToast(
        error instanceof Error
          ? error.message
          : "Não foi possível enviar o comprovante.",
      );
    } finally {
      setBusy("");
      setTimeout(() => setToast(""), 2800);
    }
  };
  if (portal.loading) return <LoadingState />;
  if (!portal.data)
    return (
      <>
        <PageHeader title="Pagamentos" />
        <Notice message={portal.error} />
      </>
    );
  if (id) {
    const p = portal.data;
    return (
      <div>
        <Toast show={!!toast} message={toast} />
        <PageHeader
          eyebrow="DETALHE FINANCEIRO"
          title={`Pagamento ${String(p.id).slice(0, 8).toUpperCase()}`}
          subtitle={p.service || p.plan || "Pagamento Carol Sol"}
        />
        <section className="surface p-6">
          <div className="mb-5 flex justify-between">
            <Badge tone={statusTone(p.status)}>
              {statusLabel[p.status] || p.status}
            </Badge>
            <b className="font-display text-3xl">{brl(p.amount)}</b>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Info label="Valor pago" value={brl(p.paid_amount)} />
            <Info
              label="Valor restante"
              value={brl(
                Number(p.amount) -
                  Number(p.paid_amount || 0) -
                  Number(p.discount_amount || 0),
              )}
            />
            <Info label="Desconto" value={brl(p.discount_amount)} />
            <Info label="Método" value={p.method} />
            <Info label="Provedor" value={p.provider || "manual"} />
            <Info label="Criação" value={dateTime(p.created_at)} />
            <Info label="Confirmação" value={dateTime(p.paid_at)} />
          </div>
          {p.receipt_url && (
            <a
              className="btn-secondary mt-5"
              href={p.receipt_url}
              target="_blank"
              rel="noreferrer"
            >
              Ver comprovante <ExternalLink size={15} />
            </a>
          )}
          {p.receipts?.length > 0 && (
            <div className="mt-5 rounded-2xl bg-warm p-4">
              <b className="block text-xs">Comprovantes enviados</b>
              {p.receipts.map((item: any) => (
                <div
                  key={item.id}
                  className="mt-3 flex flex-wrap items-start justify-between gap-3 border-t border-black/5 pt-3 text-xs"
                >
                  <span>
                    <a
                      href={item.storage_url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-bold underline"
                    >
                      Abrir imagem
                    </a>
                    {item.rejection_reason && (
                      <small className="mt-1 block text-rose-700">
                        Motivo: {item.rejection_reason}
                      </small>
                    )}
                  </span>
                  <Badge tone={statusTone(item.status)}>
                    {statusLabel[item.status] || item.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
          {["pending", "failed", "expired", "awaiting_confirmation"].includes(
            p.status,
          ) && (
            <div className="mt-6 border-t border-black/5 pt-6">
              <h3 className="font-display text-2xl">Escolha como pagar</h3>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <button
                  disabled={!!busy}
                  onClick={openSumup}
                  className="btn-primary"
                >
                  <CreditCard size={16} />
                  {busy === "sumup" ? "Abrindo…" : "Cartão via SumUp"}
                </button>
                <button
                  disabled={!!busy}
                  onClick={() => chooseMethod("pix_manual")}
                  className="btn-secondary"
                >
                  <QrCode size={16} />
                  Pix manual
                </button>
                <button
                  disabled={!!busy}
                  onClick={() => chooseMethod("local")}
                  className="btn-secondary"
                >
                  <WalletCards size={16} />
                  Pagar no local
                </button>
              </div>
              {p.provider === "pix_manual" && (
                <label className="btn-secondary mt-3 cursor-pointer">
                  <Upload size={16} />
                  {busy === "receipt" ? "Enviando…" : "Enviar comprovante"}
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    className="hidden"
                    disabled={!!busy}
                    onChange={(event) => receipt(event.target.files?.[0])}
                  />
                </label>
              )}
            </div>
          )}
          {p.history?.length > 0 && (
            <div className="mt-6 border-t border-black/5 pt-6">
              <SectionHeading title="Histórico de status" />
              {p.history.map((item: any, index: number) => (
                <div
                  key={`${item.created_at}-${index}`}
                  className="flex justify-between border-b border-black/5 py-3 text-xs"
                >
                  <span>
                    {statusLabel[item.new_status] || item.new_status}
                    <small className="block text-stone-400">{item.notes}</small>
                  </span>
                  <span>{dateTime(item.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    );
  }
  const data = portal.data || { payments: [], appointments: [] };
  const payments = data.payments || [];
  const appointments = data.appointments || [];

  // Filter payments list for statistics
  const pendingPayments = payments.filter((p: any) =>
    ["pending", "under_review", "partial", "awaiting_confirmation"].includes(p.status),
  );
  const paidPayments = payments.filter((p: any) => p.status === "paid");

  // Sinal do Serviço payments
  const sinalList = payments.filter((p: any) =>
    p.appointment_id &&
    (p.billing_reason === "Sinal" || Number(p.amount) === Number(p.original_amount))
  );

  // Restante do Serviço rows (computed dynamically)
  const restanteList = appointments.map((a: any) => {
    const basePrice = Number(a.base_price || 0);
    const discount = Number(a.discount_amount || 0);
    const total = Number(a.estimated_value || 0);
    const deposit = Math.min(Number(a.deposit_amount || 0), total);
    const remainingAmount = total - deposit;

    if (remainingAmount <= 0) return null; // No remaining to pay

    // Find if there is an existing payment record for this remainder
    const remainingPayment = payments.find((p: any) =>
      p.appointment_id === a.id && p.billing_reason === "Restante do pagamento"
    );

    let status = "pending";
    let paymentId = remainingPayment?.id || null;

    if (remainingPayment) {
      status = remainingPayment.status;
    } else {
      if (a.status === "completed") status = "paid";
      else if (["cancelled", "no_show"].includes(a.status)) status = "expired";
      else status = "pending";
    }

    return {
      id: `remaining-${a.id}`,
      paymentId,
      service: a.service,
      starts_at: a.starts_at,
      amount: remainingAmount,
      status,
    };
  }).filter(Boolean);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="FINANCEIRO"
        title="Meus pagamentos"
        subtitle="Acompanhe sinais, planos e pagamentos realizados."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Info label="Pendentes" value={String(pendingPayments.length)} />
        <Info
          label="Valor pendente"
          value={brl(
            pendingPayments.reduce(
              (sum: number, p: any) => sum + Number(p.amount) - Number(p.paid_amount || 0),
              0,
            ),
          )}
        />
        <Info
          label="Total pago"
          value={brl(
            paidPayments.reduce((sum: number, p: any) => sum + Number(p.paid_amount || p.amount), 0),
          )}
        />
      </div>

      {/* Sinal do Serviço Section */}
      <section className="surface p-6">
        <SectionHeading title="Sinal de Serviços" />
        <p className="text-[11px] text-stone-400 mb-3">
          Sinais de agendamento obrigatórios para confirmação da agenda.
        </p>
        <div className="overflow-hidden rounded-2xl bg-warm/5">
          {sinalList.length ? sinalList.map((p: any) => (
            <a
              key={p.id}
              href={`/cliente/pagamentos/${p.id}`}
              className="grid grid-cols-[1fr_auto] gap-3 border-b border-black/[.05] p-4 last:border-0 sm:grid-cols-[1.5fr_.8fr_.8fr_auto] hover:bg-black/[.02] transition"
            >
              <span>
                <b className="block text-xs">Sinal - {p.service}</b>
                <span className="text-[10px] text-stone-400">{dateTime(p.created_at)}</span>
              </span>
              <span className="hidden text-xs sm:block">{p.method === "card" ? "Cartão (SumUp)" : p.method === "pix" ? "PIX" : "Manual"}</span>
              <b className="text-xs">{brl(p.amount)}</b>
              <Badge tone={statusTone(p.status)}>
                {statusLabel[p.status] || p.status}
              </Badge>
            </a>
          )) : <p className="text-xs text-stone-400">Nenhum sinal de serviço registrado.</p>}
        </div>
      </section>

      {/* Restante do Serviço Section */}
      <section className="surface p-6">
        <SectionHeading title="Restante de Serviços" />
        <p className="text-[11px] text-stone-400 mb-3">
          Saldos restantes dos serviços para pagamento no local ou SumUp.
        </p>
        <div className="overflow-hidden rounded-2xl bg-warm/5">
          {restanteList.length ? restanteList.map((r: any) => {
            const content = (
              <div className="grid grid-cols-[1fr_auto] gap-3 border-b border-black/[.05] p-4 last:border-0 sm:grid-cols-[1.5fr_.8fr_.8fr_auto] transition">
                <span>
                  <b className="block text-xs">Restante - {r.service}</b>
                  <span className="text-[10px] text-stone-400">{dateTime(r.starts_at)}</span>
                </span>
                <span className="hidden text-xs sm:block">No Local / SumUp</span>
                <b className="text-xs">{brl(r.amount)}</b>
                <Badge tone={statusTone(r.status)}>
                  {statusLabel[r.status] || r.status}
                </Badge>
              </div>
            );
            return r.paymentId ? (
              <a key={r.id} href={`/cliente/pagamentos/${r.paymentId}`} className="block hover:bg-black/[.02]">
                {content}
              </a>
            ) : (
              <div key={r.id} className="block">
                {content}
              </div>
            );
          }) : <p className="text-xs text-stone-400">Nenhum saldo restante pendente ou realizado.</p>}
        </div>
      </section>

      {/* Histórico Cronológico Section */}
      <section className="surface p-6">
        <SectionHeading title="Histórico de Cobranças e Pagamentos" />
        <p className="text-[11px] text-stone-400 mb-3">
          Histórico cronológico completo de cobranças, pagamentos e comprovantes.
        </p>
        <div className="overflow-hidden rounded-2xl bg-warm/5">
          {payments.length ? payments.map((p: any) => (
            <a
              key={p.id}
              href={`/cliente/pagamentos/${p.id}`}
              className="grid grid-cols-[1fr_auto] gap-3 border-b border-black/[.05] p-4 last:border-0 sm:grid-cols-[1.5fr_.8fr_.8fr_auto] hover:bg-black/[.02] transition"
            >
              <span>
                <b className="block text-xs">
                  {p.billing_reason ? `${p.billing_reason} - ` : ""}
                  {p.service || p.plan || p.notes || "Pagamento"}
                </b>
                <span className="text-[10px] text-stone-400">{dateTime(p.created_at)}</span>
                {p.latest_receipt_url && (
                  <span className="mt-1 block text-[9px] font-bold text-emerald-600">✓ Comprovante enviado</span>
                )}
              </span>
              <span className="hidden text-xs sm:block">{p.provider || "local"}</span>
              <b className="text-xs">{brl(p.amount)}</b>
              <Badge tone={statusTone(p.status)}>
                {statusLabel[p.status] || p.status}
              </Badge>
            </a>
          )) : (
            <EmptyState
              title="Você ainda não possui pagamentos"
              text="Seus pagamentos de serviços e planos aparecerão aqui."
            />
          )}
        </div>
      </section>
    </div>
  );
}

export function ClientPaymentReturnPage() {
  const location = useLocation();
  const paymentId =
    new URLSearchParams(location.search).get("payment_id") || "";
  const portal = usePortal<any>(
    `/api/payments?resource=status&id=${encodeURIComponent(paymentId)}`,
  );
  useEffect(() => {
    if (
      !paymentId ||
      !["pending", "processing", "awaiting_confirmation"].includes(
        portal.data?.payment?.status,
      )
    )
      return;
    const timer = window.setInterval(() => portal.reload(), 4000);
    return () => window.clearInterval(timer);
  }, [paymentId, portal.data?.payment?.status]);
  if (portal.loading) return <LoadingState />;
  const payment = portal.data?.payment;
  if (!payment)
    return <Notice message={portal.error || "Pagamento não encontrado."} />;
  const confirmed = payment.status === "paid";
  return (
    <div>
      <PageHeader
        eyebrow="PAGAMENTO SEGURO"
        title={
          confirmed
            ? "Pagamento confirmado"
            : "Estamos confirmando seu pagamento"
        }
        subtitle="O backend consulta a SumUp e atualiza esta tela automaticamente."
      />
      <section className="surface p-7 text-center">
        <Badge tone={statusTone(payment.status)}>
          {statusLabel[payment.status] || payment.status}
        </Badge>
        <h2 className="mt-5 font-display text-4xl">{brl(payment.amount)}</h2>
        <p className="muted mt-3">
          {confirmed
            ? "Seu pagamento foi conciliado e os benefícios relacionados foram liberados."
            : "Aguardando a confirmação da SumUp. Esta tela atualiza automaticamente."}
        </p>
        <a
          href={`/cliente/pagamentos/${payment.id}`}
          className="btn-primary mt-6"
        >
          Ver detalhes
        </a>
      </section>
    </div>
  );
}

export function ClientAppointmentDetailPage() {
  const id = useLocation().pathname.split("/agendamentos/")[1];
  const p = usePortal<any>(`/api/data?resource=appointment-detail&id=${encodeURIComponent(id || "")}`);
  const navigate = useNavigate();

  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [toast, setToast] = useState("");
  const [updating, setUpdating] = useState(false);

  if (p.loading) return <LoadingState />;
  if (!p.data?.appointment) {
    return (
      <EmptyState
        title="Agendamento não encontrado"
        text={p.error || "Este registro não existe ou não pertence à sua conta."}
      />
    );
  }

  const a = p.data.appointment;
  const history = p.data.history || [];
  const payments = p.data.payments || [];
  const record = p.data.record;

  const handleCancel = async (e: FormEvent) => {
    e.preventDefault();
    setUpdating(true);
    try {
      await apiFetch("/api/data?resource=appointments", {
        method: "PATCH",
        body: JSON.stringify({
          id,
          status: "cancelled",
          cancellationReason: cancelReason
        })
      });
      setCancelModalOpen(false);
      await p.reload();
      setToast("Agendamento cancelado com sucesso.");
    } catch (err) {
      console.error("Cancel appointment error", err);
      setToast(err instanceof Error ? err.message : "Erro ao cancelar agendamento.");
    } finally {
      setUpdating(false);
      setTimeout(() => setToast(""), 2200);
    }
  };

  const confirmPresence = async () => {
    setUpdating(true);
    try {
      await apiFetch("/api/data?resource=appointments", {
        method: "PATCH",
        body: JSON.stringify({
          id,
          status: "confirmed",
          statusNote: "Presença confirmada pela cliente no app"
        })
      });
      await p.reload();
      setToast("Presença confirmada com sucesso. Obrigado!");
    } catch (err) {
      console.error("Confirm presence error", err);
      setToast(err instanceof Error ? err.message : "Erro ao confirmar presença.");
    } finally {
      setUpdating(false);
      setTimeout(() => setToast(""), 2200);
    }
  };

  const steps = [
    { key: "requested", label: "Solicitado" },
    { key: "pending_deposit", label: "Sinal" },
    { key: "confirmed", label: "Confirmado" },
    { key: "in_service", label: "Atendimento" },
    { key: "completed", label: "Concluído" }
  ];

  let activeIndex = -1;
  if (a.status === "requested") activeIndex = 0;
  else if (["pending_deposit", "awaiting_payment"].includes(a.status)) activeIndex = 1;
  else if (["confirmed", "rescheduled", "reschedule_requested"].includes(a.status)) activeIndex = 2;
  else if (a.status === "in_service") activeIndex = 3;
  else if (a.status === "completed") activeIndex = 4;

  const isTerminated = ["cancelled", "no_show"].includes(a.status);

  return (
    <div>
      <Toast show={!!toast} message={toast} />

      <div className="mb-4">
        <a href="/cliente/agenda" className="text-xs font-bold text-champagne flex items-center gap-1">
          ← Meus Agendamentos
        </a>
      </div>

      <PageHeader
        eyebrow="MEU AGENDAMENTO"
        title={a.service_name || a.service}
        subtitle={`Código CS${String(a.id).slice(0, 8).toUpperCase()}`}
        action={
          <div className="flex gap-2">
            {!isTerminated && a.status !== "completed" && (
              <button
                onClick={() => setCancelModalOpen(true)}
                className="btn-secondary text-rose-500 border-rose-500/20"
              >
                Cancelar
              </button>
            )}

            {["pending_deposit", "confirmed", "awaiting_payment"].includes(a.status) && (
              <button
                disabled={updating}
                onClick={confirmPresence}
                className="btn-primary"
              >
                Confirmar Presença
              </button>
            )}
          </div>
        }
      />

      {!isTerminated ? (
        <section className="surface p-6 mb-5">
          <SectionHeading title="Progresso do Atendimento" />
          <div className="relative mt-6 flex justify-between items-center w-full">
            <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1 bg-stone-100 -z-10" />
            {activeIndex >= 0 && (
              <div
                className="absolute left-0 top-1/2 -translate-y-1/2 h-1 bg-champagne transition-all -z-10"
                style={{ width: `${(activeIndex / (steps.length - 1)) * 100}%` }}
              />
            )}

            {steps.map((step, idx) => {
              const isActive = idx <= activeIndex;
              const isCurrent = idx === activeIndex;
              return (
                <div key={step.key} className="flex flex-col items-center">
                  <div
                    className={`h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-bold transition-all border-4 ${
                      isCurrent
                        ? "bg-white border-champagne text-champagne scale-110 shadow-md"
                        : isActive
                          ? "bg-champagne border-champagne text-white"
                          : "bg-white border-stone-200 text-stone-300"
                    }`}
                  >
                    {isActive ? "✓" : idx + 1}
                  </div>
                  <span
                    className={`mt-2 text-[9px] font-bold ${
                      isCurrent
                        ? "text-champagne font-extrabold"
                        : isActive
                          ? "text-stone-700"
                          : "text-stone-400"
                    }`}
                  >
                    {step.label}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      ) : (
        <div className="rounded-2xl bg-rose-50 p-5 mb-5 text-rose-800 text-xs font-semibold">
          Este agendamento foi finalizado com o status: <b>{statusLabel[a.status] || a.status}</b>.
          {a.cancellation_reason && (
            <p className="mt-2 text-stone-500 italic font-normal">
              Motivo do cancelamento: "{a.cancellation_reason}"
            </p>
          )}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_350px]">
        <div className="space-y-5">
          <section className="surface p-6">
            <SectionHeading title="Detalhes do Horário" />
            <div className="grid gap-4 sm:grid-cols-2 text-xs">
              <div>
                <span className="text-stone-400 block">Status</span>
                <span className="font-bold">
                  <Badge tone={statusTone(a.status)}>{statusLabel[a.status] || a.status}</Badge>
                </span>
              </div>
              <div>
                <span className="text-stone-400 block">Data e Hora</span>
                <span className="font-bold">{dateTime(a.starts_at)}</span>
              </div>
              <div>
                <span className="text-stone-400 block">Duração Estimada</span>
                <span className="font-bold">{a.duration_minutes || 60} minutos</span>
              </div>
              <div>
                <span className="text-stone-400 block">Localização</span>
                <span className="font-bold">{a.location || "Carol Sol Mega Hair - Premium"}</span>
              </div>
            </div>
            {a.notes && (
              <div className="mt-5 rounded-2xl bg-warm p-4 text-xs">
                <span className="font-bold block mb-1 text-stone-500">Observações:</span>
                {a.notes}
              </div>
            )}
          </section>

          <section className="surface p-6">
            <SectionHeading title="Pagamentos & Cobranças" />
            {payments.length ? (
              <div className="space-y-4">
                {payments.map((py: any) => (
                  <div key={py.id} className="border border-black/5 rounded-2xl p-4 text-xs bg-warm/20">
                    <div className="flex justify-between items-center mb-3">
                      <span className="font-bold">
                        Cobrança #{String(py.id).slice(0, 8).toUpperCase()}
                      </span>
                      <Badge tone={statusTone(py.status)}>
                        {statusLabel[py.status] || py.status}
                      </Badge>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-3 mb-4">
                      <div>
                        <span className="text-stone-400 block">Valor Total</span>
                        <b className="text-sm">{brl(py.amount)}</b>
                      </div>
                      <div>
                        <span className="text-stone-400 block">Valor Pago</span>
                        <b className="text-sm text-green-600">{brl(py.paid_amount)}</b>
                      </div>
                      <div>
                        <span className="text-stone-400 block">Pendente</span>
                        <b className="text-sm text-amber-600">
                          {brl(Number(py.amount) - Number(py.paid_amount || 0) - Number(py.discount_amount || 0))}
                        </b>
                      </div>
                    </div>

                    <div className="flex justify-end gap-2 border-t border-black/5 pt-3">
                      {["pending", "failed", "expired", "awaiting_confirmation", "partial", "pending_deposit"].includes(py.status) && (
                        <a
                          href={`/cliente/pagamentos/${py.id}`}
                          className="btn-primary !min-h-8 !px-3 text-[11px]"
                        >
                          Ir para Pagamento / Comprovante
                        </a>
                      )}
                      {py.receipt_url && (
                        <a
                          href={py.receipt_url}
                          target="_blank"
                          rel="noreferrer"
                          className="btn-secondary !min-h-8 !px-3 text-[11px] flex items-center gap-1"
                        >
                          Ver Comprovante <ExternalLink size={13} />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-stone-400">Nenhum pagamento registrado para este atendimento.</p>
            )}
          </section>
        </div>

        <div className="space-y-5">
          <section className="surface p-6 text-center">
            <h4 className="font-bold text-[10px] uppercase tracking-wider text-stone-400 mb-3">Sua Profissional</h4>
            <div className="flex justify-center">
              <Avatar src={a.professional_photo || ""} name={a.professional_name || a.professional} size="lg" />
            </div>
            <h3 className="mt-3 font-display text-xl font-bold">{a.professional_name || a.professional}</h3>
            <p className="text-xs text-stone-400 mt-1">Carol Sol Especialista</p>
          </section>

          {record && (
            <section className="surface p-6">
              <h4 className="font-bold text-[10px] uppercase tracking-wider text-stone-400 mb-3">Ficha Técnica</h4>
              <div className="text-xs space-y-2">
                <p className="text-stone-500">A profissional registrou detalhes técnicos sobre a aplicação.</p>
                <div>
                  <span className="text-stone-400 block">Método</span>
                  <span className="font-bold">{record.method || "Fita Adesiva"}</span>
                </div>
                {record.strands_count && (
                  <div>
                    <span className="text-stone-400 block">Quantidade</span>
                    <span className="font-bold">{record.strands_count} mechas</span>
                  </div>
                )}
                {record.weight_grams && (
                  <div>
                    <span className="text-stone-400 block">Peso Utilizado</span>
                    <span className="font-bold">{record.weight_grams}g</span>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      </div>

      <Modal open={cancelModalOpen} onClose={() => { if (!updating) setCancelModalOpen(false); }} title="Cancelar Agendamento">
        <form onSubmit={handleCancel} className="space-y-4">
          <div className="rounded-2xl bg-amber-50 p-4 text-[11px] leading-relaxed text-amber-800 border border-amber-200">
            <b>Atenção à Política de Cancelamento:</b>
            <p className="mt-1">
              Cancelamentos realizados com menos de 24h de antecedência do horário agendado estão sujeitos a perda do valor pago como sinal ou cobrança de taxa de retenção capilar, conforme nossos Termos de Uso.
            </p>
          </div>

          <label className="block">
            <span className="mb-2 block text-xs font-bold">Descreva brevemente o motivo do cancelamento</span>
            <textarea
              required
              className="field min-h-24 py-3"
              placeholder="Ex: Imprevisto de trabalho, reagendando para outra data..."
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
            />
          </label>

          <div className="flex gap-2">
            <button
              type="button"
              disabled={updating}
              onClick={() => setCancelModalOpen(false)}
              className="btn-secondary flex-1"
            >
              Voltar
            </button>
            <button
              disabled={updating || !cancelReason.trim()}
              className="btn-primary flex-1 bg-rose-600 hover:bg-rose-700 border-transparent text-white"
            >
              {updating ? "Processando..." : "Confirmar Cancelamento"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export function ClientHistoryPage() {
  const nav = useNavigate();
  const portal = usePortal<any>("/api/portal?resource=client-history");
  const appointments = portal.data?.appointments || [];
  const records = portal.data?.records || [];
  const photos = portal.data?.photos || [];
  const summary = portal.data?.summary || {};
  const completed = useMemo(
    () => appointments.filter((a: any) => a.status === "completed"),
    [appointments],
  );
  if (portal.loading) return <LoadingState />;
  if (!portal.data)
    return (
      <>
        <PageHeader title="Histórico" />
        <Notice message={portal.error} />
      </>
    );
  return (
    <div className="animate-fade-up">
      <PageHeader
        eyebrow="HISTÓRICO DA CLIENTE"
        title="Histórico de serviços"
        subtitle="Atendimentos, fichas técnicas, fotos e pagamentos vinculados à sua conta."
        action={
          <button
            onClick={() => nav("/cliente/agendamentos")}
            className="btn-primary"
          >
            <Plus size={16} />
            Novo agendamento
          </button>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Info
          label="Atendimentos"
          value={String(summary.totalAppointments || 0)}
        />
        <Info
          label="Concluídos"
          value={String(completed.length || summary.completedAppointments || 0)}
        />
        <Info label="Fichas técnicas" value={String(records.length)} />
        <Info label="Fotos enviadas" value={String(photos.length)} />
      </div>
      {summary.nextAppointment && (
        <section className="hair-gradient mt-5 rounded-[28px] p-6 text-white">
          <div className="eyebrow">PRÓXIMO CUIDADO</div>
          <h2 className="mt-2 font-display text-3xl">
            {summary.nextAppointment.service}
          </h2>
          <p className="mt-2 text-sm text-white/60">
            {dateTime(summary.nextAppointment.starts_at)} •{" "}
            {summary.nextAppointment.professional}
          </p>
        </section>
      )}
      <section className="surface mt-6 overflow-hidden">
        <SectionHeading title="Todos os atendimentos" />
        {appointments.length ? (
          appointments.map((a: any) => (
            <button
              key={a.id}
              onClick={() => nav(`/cliente/agendamentos/${a.id}`)}
              className="grid w-full gap-3 border-b border-black/5 p-5 text-left transition hover:bg-warm last:border-0 sm:grid-cols-[1.2fr_.9fr_.8fr_auto]"
            >
              <span className="flex min-w-0 items-center gap-3">
                <Scissors size={18} className="text-champagne" />
                <span className="min-w-0">
                  <b className="block truncate text-xs">{a.service}</b>
                  <small className="text-stone-400">
                    CS{String(a.id).slice(0, 8).toUpperCase()}
                  </small>
                </span>
              </span>
              <span className="text-xs">
                <Clock3 className="mr-1 inline text-champagne" size={14} />
                {dateTime(a.starts_at)}
              </span>
              <span className="text-xs">
                <MapPin className="mr-1 inline text-champagne" size={14} />
                {a.location || "Carol Sol"}
              </span>
              <Badge tone={statusTone(a.status)}>
                {statusLabel[a.status] || a.status}
              </Badge>
            </button>
          ))
        ) : (
          <EmptyState
            title="Nenhum atendimento"
            text="Seus atendimentos aparecerão aqui assim que forem criados."
          />
        )}
      </section>
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <section className="surface p-6">
          <SectionHeading title="Fichas técnicas" />
          {records.length ? (
            <div className="space-y-3">
              {records.map((r: any) => (
                <div
                  key={r.id}
                  className="rounded-2xl border border-black/5 p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span>
                      <b className="text-xs">
                        {r.method || "Método não informado"}
                      </b>
                      <span className="mt-1 block text-[10px] text-stone-400">
                        {dateTime(r.starts_at || r.created_at)} •{" "}
                        {r.professional || "Carol Sol"}
                      </span>
                    </span>
                    <FileText className="text-champagne" />
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-[11px]">
                    <span>
                      <b className="block">
                        {r.weight_grams ? `${r.weight_grams}g` : "—"}
                      </b>
                      <small className="text-stone-400">Peso</small>
                    </span>
                    <span>
                      <b className="block">
                        {r.length_cm ? (String(r.length_cm).toLowerCase().includes('cm') ? r.length_cm : `${r.length_cm} cm`) : "—"}
                      </b>
                      <small className="text-stone-400">Comprimento</small>
                    </span>
                    <span>
                      <b className="block">
                        {[r.color, r.shade].filter(Boolean).join(" / ") || "—"}
                      </b>
                      <small className="text-stone-400">Cor</small>
                    </span>
                    <span>
                      <b className="block">{date(r.next_maintenance_date)}</b>
                      <small className="text-stone-400">
                        Próxima manutenção
                      </small>
                    </span>
                  </div>
                  {r.recommendations && (
                    <p className="mt-4 rounded-2xl bg-warm p-3 text-[11px] text-stone-500">
                      {r.recommendations}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="Nenhuma ficha técnica"
              text="As fichas salvas pela profissional aparecerão aqui."
            />
          )}
        </section>
        <section className="surface p-6">
          <SectionHeading title="Fotos e registros" />
          {photos.length ? (
            <div className="grid grid-cols-2 gap-3">
              {photos.slice(0, 8).map((p: any) => (
                <a
                  key={p.id}
                  href={p.storage_path}
                  target="_blank"
                  rel="noreferrer"
                  className="group relative aspect-square overflow-hidden rounded-2xl bg-warm"
                >
                  <img
                    src={p.storage_path}
                    alt={p.kind}
                    className="h-full w-full object-cover transition group-hover:scale-105"
                  />
                  <span className="absolute bottom-2 left-2 rounded-full bg-white/90 px-2 py-1 text-[9px] font-bold">
                    {p.kind}
                  </span>
                </a>
              ))}
            </div>
          ) : (
            <EmptyState
              title="Nenhuma foto enviada"
              text="Fotos de avaliação ou antes/depois aparecerão aqui com seu consentimento."
            />
          )}
        </section>
      </div>
    </div>
  );
}

export function ClientCardsPage() {
  const portal = usePortal<any[]>("/api/portal?resource=cards");
  const [open, setOpen] = useState(false);
  const [setup, setSetup] = useState<{
    sessionId: string;
    checkoutId: string;
    expiresAt: string;
  } | null>(null);
  const [widgetError, setWidgetError] = useState("");
  const [pendingRemoval, setPendingRemoval] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const act = async (body: any) => {
    setSaving(true);
    try {
      await apiFetch("/api/portal?resource=cards", {
        method: body.action ? "PATCH" : "POST",
        body: JSON.stringify(body),
      });
      await portal.reload();
      setPendingRemoval(null);
      setToast(
        body.action === "remove"
          ? "Cartão removido da SumUp e da sua conta."
          : "Cartão principal atualizado.",
      );
    } catch (err) {
      console.error("Card action error", err);
      setToast(
        err instanceof Error
          ? err.message
          : "Não foi possível concluir a ação.",
      );
    } finally {
      setSaving(false);
      setTimeout(() => setToast(""), 2400);
    }
  };
  const finishSetup = async (sessionId: string) => {
    setSaving(true);
    setWidgetError("");
    try {
      await apiFetch("/api/payments?resource=card-setup-complete", {
        method: "POST",
        body: JSON.stringify({ sessionId }),
      });
      await portal.reload();
      setSetup(null);
      setOpen(false);
      setToast("Cartão tokenizado com segurança pela SumUp.");
    } catch (error) {
      console.error("Card tokenization confirmation error", error);
      setWidgetError(
        error instanceof Error
          ? error.message
          : "Não foi possível confirmar o cartão.",
      );
    } finally {
      setSaving(false);
      setTimeout(() => setToast(""), 2800);
    }
  };
  const startSetup = async () => {
    setSaving(true);
    setWidgetError("");
    try {
      const result = await apiFetch<{
        sessionId: string;
        checkoutId: string;
        expiresAt: string;
      }>("/api/payments?resource=card-setup", { method: "POST" });
      setSetup(result);
    } catch (error) {
      console.error("Card tokenization start error", error);
      setWidgetError(
        error instanceof Error
          ? error.message
          : "Não foi possível iniciar a tokenização.",
      );
    } finally {
      setSaving(false);
    }
  };
  useEffect(() => {
    if (!setup?.checkoutId) return;
    let active = true;
    loadSumupWidget()
      .then(() => {
        if (!active || !window.SumUpCard) return;
        window.SumUpCard.mount({
          id: "sumup-card-tokenization",
          checkoutId: setup.checkoutId,
          onResponse: (type) => {
            if (!active) return;
            const responseType = String(type || "").toLowerCase();
            if (responseType === "success") void finishSetup(setup.sessionId);
            else if (["error", "fail", "failed", "invalid"].includes(responseType))
              setWidgetError("A SumUp não conseguiu tokenizar este cartão.");
          },
        });
      })
      .catch((error) => {
        console.error("SumUp widget load error", error);
        if (active)
          setWidgetError(
            error instanceof Error
              ? error.message
              : "Não foi possível carregar o widget da SumUp.",
          );
      });
    return () => {
      active = false;
    };
  }, [setup?.checkoutId]);
  if (portal.loading) return <LoadingState />;
  if (!portal.data) return <Notice message={portal.error} />;
  return (
    <div>
      <Toast show={!!toast} message={toast} />
      <PageHeader
        eyebrow="PAGAMENTOS"
        title="Cartões salvos"
        subtitle="A SumUp coleta consentimento e protege os dados. O aplicativo recebe somente bandeira e últimos quatro dígitos."
        action={
          <button
            onClick={() => {
              setSetup(null);
              setWidgetError("");
              setOpen(true);
            }}
            className="btn-primary"
          >
            <Plus size={16} />
            Adicionar cartão
          </button>
        }
      />
      <div className="grid gap-4 md:grid-cols-2">
        {portal.data?.length ? (
          portal.data.map((card) => (
            <div
              key={card.id}
              className="hair-gradient rounded-[26px] p-6 text-white"
            >
              <CreditCard />
              <div className="mt-8 font-display text-2xl">
                •••• •••• •••• {card.last_four}
              </div>
              <div className="mt-5 flex justify-between text-xs">
                <span>{card.holder_name}</span>
                <b>{card.brand}</b>
              </div>
              <div className="mt-5 flex gap-2">
                {card.is_default ? (
                  <Badge tone="gold">PRINCIPAL</Badge>
                ) : (
                  <button
                    disabled={saving}
                    onClick={() => act({ id: card.id, action: "default" })}
                    className="text-[10px] font-bold text-champagne disabled:opacity-50"
                  >
                    Definir principal
                  </button>
                )}
                <button
                  disabled={saving}
                  onClick={() => setPendingRemoval(card)}
                  className="ml-auto text-white/60 disabled:opacity-50"
                  aria-label={`Remover cartão final ${card.last_four}`}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))
        ) : (
          <EmptyState
            title="Nenhum cartão salvo"
            text="Tokenize um cartão com consentimento e 3DS diretamente no ambiente seguro da SumUp."
            action={
              <button onClick={() => setOpen(true)} className="btn-primary">
                Adicionar cartão
              </button>
            }
          />
        )}
      </div>
      <Modal
        open={open}
        onClose={() => {
          if (!saving) {
            setOpen(false);
            setSetup(null);
            setWidgetError("");
          }
        }}
        title="Tokenizar cartão com a SumUp"
      >
        <div className="space-y-4">
          <p className="muted">
            Os dados completos e o CVV não passam pelos servidores Carol Sol.
            A SumUp fará a verificação, coletará seu consentimento e devolverá
            apenas um instrumento tokenizado.
          </p>
          {widgetError && (
            <div className="rounded-2xl bg-rose-50 p-4 text-xs font-semibold text-rose-800">
              {widgetError}
            </div>
          )}
          {setup ? (
            <>
              <div id="sumup-card-tokenization" className="min-h-52" />
              <button
                disabled={saving}
                onClick={() => finishSetup(setup.sessionId)}
                className="btn-secondary w-full disabled:opacity-50"
              >
                {saving ? "Confirmando…" : "Confirmar após concluir na SumUp"}
              </button>
            </>
          ) : (
            <button
              disabled={saving}
              onClick={startSetup}
              className="btn-primary w-full disabled:opacity-50"
            >
              {saving ? "Preparando ambiente seguro…" : "Continuar com a SumUp"}
            </button>
          )}
        </div>
      </Modal>
      <Modal
        open={Boolean(pendingRemoval)}
        onClose={() => {
          if (!saving) setPendingRemoval(null);
        }}
        title="Remover cartão"
      >
        <div className="space-y-4">
          <p className="muted">
            O cartão final {pendingRemoval?.last_four} será desativado também
            na SumUp e deixará de poder ser usado em pagamentos futuros.
          </p>
          <button
            disabled={saving}
            onClick={() =>
              act({ id: pendingRemoval?.id, action: "remove" })
            }
            className="btn-primary w-full disabled:opacity-50"
          >
            {saving ? "Removendo…" : "Confirmar remoção"}
          </button>
        </div>
      </Modal>
    </div>
  );
}

export function ClientBenefitsPage() {
  const nav = useNavigate();
  const portal = usePortal<any>("/api/portal?resource=benefits");
  const [plan, setPlan] = useState<any>(null);
  const [method, setMethod] = useState("pix");
  const [couponCode, setCouponCode] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  if (portal.loading) return <LoadingState />;
  if (!portal.data) return <Notice message={portal.error} />;
  const request = async () => {
    setSaving(true);
    try {
      const result = await apiFetch<{ data: { payment: { id: string } } }>(
        "/api/portal?resource=subscription-request",
        {
          method: "POST",
          body: JSON.stringify({ planId: plan.id, method, couponCode }),
        },
      );
      await portal.reload();
      setPlan(null);
      setCouponCode("");
      setToast(
        "Solicitação criada. O plano será ativado após a confirmação do pagamento.",
      );
      if (result.data?.payment?.id)
        nav(`/cliente/pagamentos/${result.data.payment.id}`);
    } catch (err) {
      console.error("Plan request error", err);
      setToast(
        err instanceof Error
          ? err.message
          : "Não foi possível contratar o plano.",
      );
    } finally {
      setSaving(false);
      setTimeout(() => setToast(""), 3200);
    }
  };
  const current = portal.data.subscription;
  const updateRecurring = async (enabled: boolean) => {
    if (!current?.id) return;
    setSaving(true);
    try {
      await apiFetch("/api/portal?resource=subscription-recurring", {
        method: "PATCH",
        body: JSON.stringify({
          subscriptionId: current.id,
          enabled,
          cardId: enabled ? portal.data.defaultCard?.id : undefined,
        }),
      });
      await portal.reload();
      setToast(
        enabled
          ? "Renovação automática ativada no cartão principal."
          : "Renovação automática desativada.",
      );
    } catch (err) {
      console.error("Subscription recurring consent error", err);
      setToast(
        err instanceof Error
          ? err.message
          : "Não foi possível atualizar a renovação automática.",
      );
    } finally {
      setSaving(false);
      setTimeout(() => setToast(""), 3200);
    }
  };
  return (
    <div>
      <Toast show={!!toast} message={toast} />
      <PageHeader
        eyebrow="CLUBE CAROL SOL"
        title="Benefícios e planos"
        subtitle="Contratação e renovações só mudam após confirmação real do pagamento."
      />
      <section className="hair-gradient rounded-[28px] p-7 text-white">
        <div className="flex justify-between">
          <div>
            <div className="eyebrow">PLANO ATUAL</div>
            <h2 className="mt-2 font-display text-4xl">
              {current?.name || "Nenhum plano ativo"}
            </h2>
          </div>
          {current && (
            <Badge tone={statusTone(current.status)}>
              {statusLabel[current.status] || current.status}
            </Badge>
          )}
        </div>
        {current && (
          <div className="mt-6 grid gap-3 sm:grid-cols-4">
            <InfoDark label="Início" value={date(current.starts_at)} />
            <InfoDark
              label="Vencimento"
              value={date(current.expires_at || current.renews_at)}
            />
            <InfoDark
              label="Manutenções"
              value={String(current.remaining_maintenances || 0)}
            />
            <InfoDark label="Valor" value={brl(current.price)} />
          </div>
        )}
      </section>
      {current && (
        <section className="surface mt-5 p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-display text-2xl">Renovação automática</h3>
              <p className="muted mt-1">
                {current.auto_renew
                  ? `Ativa no cartão final ${current.recurring_card_last_four || "••••"}. A cobrança ocorrerá no vencimento.`
                  : portal.data.defaultCard
                    ? `Use o cartão principal final ${portal.data.defaultCard.last_four} nas próximas renovações.`
                    : "Adicione e defina um cartão principal para ativar a renovação."}
              </p>
              {Number(current.renewal_failures || 0) > 0 && (
                <p className="mt-2 text-xs font-semibold text-rose-700">
                  Falhas consecutivas: {current.renewal_failures}. Próxima tentativa: {date(current.next_retry_at)}.
                </p>
              )}
            </div>
            {current.auto_renew ? (
              <button
                disabled={saving}
                onClick={() => updateRecurring(false)}
                className="btn-secondary disabled:opacity-50"
              >
                {saving ? "Salvando…" : "Desativar renovação"}
              </button>
            ) : portal.data.defaultCard ? (
              <button
                disabled={saving || current.status !== "active"}
                onClick={() => updateRecurring(true)}
                className="btn-primary disabled:opacity-50"
              >
                {saving ? "Salvando…" : "Ativar renovação"}
              </button>
            ) : (
              <button
                onClick={() => nav("/cliente/cartoes")}
                className="btn-secondary"
              >
                Adicionar cartão
              </button>
            )}
          </div>
          <p className="mt-4 text-[10px] leading-relaxed text-stone-400">
            Ao ativar, você autoriza cobranças recorrentes do valor vigente do plano no cartão indicado. É possível revogar esta autorização antes do próximo vencimento.
          </p>
        </section>
      )}
      <section className="mt-8">
        <SectionHeading title="Planos disponíveis" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {portal.data.plans.map((p: any) => (
            <div key={p.id} className="surface p-6">
              <h3 className="font-display text-3xl">{p.name}</h3>
              <b className="mt-3 block text-xl">{brl(p.price)}</b>
              <div className="mt-4 space-y-2 text-xs text-stone-500">
                {(p.benefits || []).map((b: string) => (
                  <div key={b} className="flex gap-2">
                    <Check size={14} className="text-champagne" />
                    {b}
                  </div>
                ))}
              </div>
              <button
                onClick={() => setPlan(p)}
                className="btn-primary mt-5 w-full"
              >
                Solicitar plano
              </button>
              <button
                onClick={() => nav(`/cliente/planos/${p.id}`)}
                className="mt-3 w-full text-xs font-bold text-champagne"
              >
                Ver detalhes
              </button>
            </div>
          ))}
        </div>
      </section>
      <section className="mt-8">
        <SectionHeading
          title="Cupons disponíveis"
          link="Ver todos"
          onClick={() => nav("/cliente/cupons")}
        />
        {portal.data.coupons.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {portal.data.coupons.map((c: any) => (
              <div key={c.id} className="surface p-5">
                <Badge tone="gold">{c.code}</Badge>
                <h3 className="mt-3 font-bold">{c.description}</h3>
                <p className="mt-2 text-xs text-stone-400">
                  Válido até {date(c.ends_at)}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="Nenhum cupom ativo"
            text="Novos benefícios aparecerão aqui."
          />
        )}
      </section>
      <Modal
        open={!!plan}
        onClose={() => setPlan(null)}
        title={`Solicitar ${plan?.name || ""}`}
      >
        <p className="muted">
          Escolha a forma de pagamento. A assinatura ficará aguardando
          confirmação.
        </p>
        <div className="mt-5 space-y-2">
          {[
            ["pix", "Pix"],
            ["card", "Cartão via SumUp"],
            ["local", "Pagamento no local"],
          ].map(([value, label]) => (
            <button
              key={value}
              onClick={() => setMethod(value)}
              className={`w-full rounded-2xl border p-4 text-left text-xs font-bold ${method === value ? "border-champagne bg-champagne/10" : "border-black/10"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="mt-5 block">
          <span className="mb-2 block text-xs font-bold">Cupom (opcional)</span>
          <input
            className="field"
            value={couponCode}
            onChange={(event) =>
              setCouponCode(event.target.value.toUpperCase())
            }
            placeholder="CAROLSOL15"
          />
        </label>
        <button
          disabled={saving}
          onClick={request}
          className="btn-primary mt-5 w-full"
        >
          {saving ? "Criando solicitação…" : "Confirmar solicitação"}
        </button>
      </Modal>
    </div>
  );
}

export function ClientPlanDetailPage() {
  const id = useLocation().pathname.split("/planos/")[1];
  const portal = usePortal<any>(
    `/api/portal?resource=plans&id=${encodeURIComponent(id || "")}`,
  );
  if (portal.loading) return <LoadingState />;
  if (!portal.data) return <Notice message={portal.error} />;
  const p = portal.data;
  return (
    <div>
      <PageHeader
        eyebrow="DETALHES DO PLANO"
        title={p.name}
        subtitle={`${brl(p.price)} por ciclo`}
      />
      <section className="surface p-7">
        <SectionHeading title="Benefícios" />
        <div className="grid gap-3 sm:grid-cols-2">
          {(p.benefits || []).map((b: string) => (
            <div
              key={b}
              className="rounded-2xl bg-warm p-4 text-xs font-semibold"
            >
              <Check className="mr-2 inline text-champagne" size={15} />
              {b}
            </div>
          ))}
        </div>
        <h3 className="mt-7 font-display text-2xl">Histórico</h3>
        {p.history?.length ? (
          <div className="mt-3 space-y-2">
            {p.history.map((h: any) => (
              <div
                key={h.id}
                className="flex justify-between rounded-2xl border border-black/5 p-4 text-xs"
              >
                <span>
                  {date(h.starts_at)} • {h.payment_method}
                </span>
                <Badge tone={statusTone(h.status)}>
                  {statusLabel[h.status] || h.status}
                </Badge>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted mt-3">Você ainda não solicitou este plano.</p>
        )}
      </section>
    </div>
  );
}

export function ClientCouponsPage() {
  const nav = useNavigate();
  const portal = usePortal<any>("/api/portal?resource=benefits");
  const [toast, setToast] = useState("");
  if (portal.loading) return <LoadingState />;
  const coupons = portal.data?.coupons || [];
  return (
    <div>
      <Toast show={!!toast} message={toast} />
      <PageHeader
        eyebrow="BENEFÍCIOS"
        title="Meus cupons"
        subtitle="Cupons válidos e histórico de utilização."
      />
      <div className="grid gap-4 md:grid-cols-2">
        {coupons.length ? (
          coupons.map((c: any) => (
            <div key={c.id} className="surface p-6">
              <Badge tone="gold">ATIVO</Badge>
              <h2 className="mt-3 font-display text-3xl">{c.code}</h2>
              <p className="muted mt-2">{c.description}</p>
              <p className="mt-4 text-[10px] text-stone-400">
                Validade: {date(c.ends_at)}
              </p>
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(c.code);
                  setToast("Código copiado.");
                  setTimeout(() => setToast(""), 1800);
                }}
                className="btn-secondary mt-5"
              >
                <Copy size={15} />
                Copiar código
              </button>
              <button
                onClick={() => nav("/cliente/beneficios")}
                className="btn-primary ml-2 mt-5"
              >
                Usar agora
              </button>
            </div>
          ))
        ) : (
          <EmptyState
            title="Nenhum cupom ativo"
            text="Seus cupons aparecerão aqui quando forem liberados."
          />
        )}
      </div>
    </div>
  );
}

export function ClientNotificationsPage() {
  const nav = useNavigate();
  const portal = usePortal<any>("/api/portal?resource=notifications");
  const [prefs, setPrefs] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  useEffect(() => {
    if (portal.data)
      setPrefs({
        inApp: portal.data.preferences?.in_app ?? true,
        whatsapp: portal.data.preferences?.whatsapp ?? true,
        email: portal.data.preferences?.email ?? true,
        reminders: portal.data.preferences?.reminders ?? true,
        promotions: portal.data.preferences?.promotions ?? true,
      });
  }, [portal.data]);
  if (portal.loading) return <LoadingState />;
  const save = async () => {
    setSaving(true);
    try {
      await apiFetch("/api/portal?resource=notification-preferences", {
        method: "PATCH",
        body: JSON.stringify(prefs),
      });
      setToast("Alterações salvas com sucesso.");
    } catch (err) {
      console.error("Notification preferences error", err);
      setToast("Não foi possível concluir a ação.");
    } finally {
      setSaving(false);
      setTimeout(() => setToast(""), 2200);
    }
  };
  const markAll = async () => {
    try {
      await apiFetch("/api/portal?resource=notification-read", {
        method: "PATCH",
        body: JSON.stringify({ all: true }),
      });
      await portal.reload();
      setToast("Todas as notificações foram marcadas como lidas.");
    } catch (error) {
      console.error("Notification mark-all error", error);
      setToast("Não foi possível concluir a ação.");
    } finally {
      setTimeout(() => setToast(""), 2200);
    }
  };
  return (
    <div>
      <Toast show={!!toast} message={toast} />
      <PageHeader
        eyebrow="COMUNICAÇÃO"
        title="Notificações"
        subtitle="Lembretes, pagamentos, planos e mensagens do salão."
        action={
          <button onClick={markAll} className="btn-secondary">
            Marcar todas como lidas
          </button>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <section className="surface overflow-hidden">
          {portal.data?.items?.length ? (
            portal.data.items.map((n: any) => (
              <button
                key={n.id}
                onClick={async () => {
                  if (!n.read_at) {
                    await apiFetch("/api/portal?resource=notification-read", {
                      method: "PATCH",
                      body: JSON.stringify({ id: n.id }),
                    });
                    await portal.reload();
                  }
                  if (n.action_url) nav(n.action_url);
                }}
                className="flex w-full gap-4 border-b border-black/5 p-5 text-left last:border-0"
              >
                <span
                  className={`mt-1 h-2 w-2 rounded-full ${n.read_at ? "bg-stone-200" : "bg-champagne"}`}
                />
                <span className="flex-1">
                  <div className="flex justify-between items-start gap-2 flex-wrap">
                    <b className="text-xs">{n.title}</b>
                    <div className="flex gap-1">
                      {((kind: string) => {
                        if (kind === "appointment_reminder") return ["📱 App", "💬 WhatsApp", "✉️ E-mail"];
                        if (kind === "appointment_status") return ["📱 App", "💬 WhatsApp"];
                        if (kind === "payment_status") return ["📱 App", "💬 WhatsApp", "✉️ E-mail"];
                        if (kind === "referral_status") return ["📱 App", "💬 WhatsApp"];
                        return ["📱 App"];
                      })(n.kind).map(ch => (
                        <span key={ch} className="rounded bg-warm px-1 py-0.5 text-[8px] font-bold text-stone-500 uppercase">
                          {ch}
                        </span>
                      ))}
                    </div>
                  </div>
                  <span className="mt-1 block text-[11px] text-stone-500">
                    {n.body}
                  </span>
                  <span className="mt-2 flex justify-between items-center text-[9px] text-stone-400">
                    <span>{dateTime(n.created_at)}</span>
                    {n.delivery_logs && n.delivery_logs.length > 0 && (
                      <div className="flex gap-2">
                        {n.delivery_logs.map((log: any, idx: number) => (
                          <span
                            key={idx}
                            className={`rounded px-1.5 py-0.5 text-[7px] font-extrabold uppercase ${
                              log.status === "failed"
                                ? "bg-rose-100 text-rose-700"
                                : "bg-emerald-100 text-emerald-800"
                            }`}
                            title={log.error_message || ""}
                          >
                            {log.channel === "email" ? "✉️ E-mail" : "💬 WhatsApp"}:{" "}
                            {log.status === "failed" ? "Falhou" : "Enviado"}
                          </span>
                        ))}
                      </div>
                    )}
                  </span>
                </span>
              </button>
            ))
          ) : (
            <EmptyState
              title="Nenhuma notificação"
              text="Suas atualizações aparecerão aqui."
            />
          )}
        </section>
        <aside className="surface self-start p-6">
          <SectionHeading title="Canais" />
          {prefs &&
            Object.entries({
              inApp: "No aplicativo",
              whatsapp: "WhatsApp",
              email: "E-mail",
              reminders: "Lembretes",
              promotions: "Promoções",
            }).map(([key, label]) => (
              <label
                key={key}
                className="flex justify-between border-b border-black/5 py-3 text-xs font-semibold"
              >
                <span>{label}</span>
                <input
                  type="checkbox"
                  checked={Boolean(prefs[key])}
                  onChange={(e) =>
                    setPrefs({ ...prefs, [key]: e.target.checked })
                  }
                />
              </label>
            ))}
          <button
            disabled={saving}
            onClick={save}
            className="btn-primary mt-5 w-full"
          >
            {saving ? "Salvando…" : "Salvar preferências"}
          </button>
        </aside>
      </div>
    </div>
  );
}

export function ClientPrivacyPage() {
  const portal = usePortal<any>("/api/portal?resource=privacy");
  const [toast, setToast] = useState("");
  const [deletion, setDeletion] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deletionSaving, setDeletionSaving] = useState(false);
  if (portal.loading) return <LoadingState />;
  const update = async (type: string, accepted: boolean) => {
    try {
      await apiFetch("/api/portal?resource=privacy-consent", {
        method: "PATCH",
        body: JSON.stringify({ consentType: type, accepted }),
      });
      await portal.reload();
      setToast("Consentimento atualizado.");
    } catch (err) {
      console.error("Consent update error", err);
      setToast("Não foi possível concluir a ação.");
    } finally {
      setTimeout(() => setToast(""), 2200);
    }
  };
  const download = async () => {
    setExporting(true);
    try {
      const result = await apiFetch<PortalResponse<any>>(
        "/api/portal?resource=data-export",
        { method: "POST" },
      );
      const blob = new Blob([JSON.stringify(result.data.export, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `dados-carol-sol-${result.data.request.id}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      await portal.reload();
      setToast("Exportação gerada com sucesso.");
    } catch (err) {
      console.error("Data export error", err);
      setToast("Não foi possível gerar a exportação.");
    } finally {
      setExporting(false);
      setTimeout(() => setToast(""), 2200);
    }
  };
  return (
    <div>
      <Toast show={!!toast} message={toast} />
      <PageHeader
        eyebrow="LGPD"
        title="Privacidade e consentimentos"
        subtitle="Você controla como seus dados e imagens podem ser utilizados."
      />
      <section className="surface p-6">
        <div className="space-y-2">
          {portal.data?.consents?.map((c: any) => (
            <label
              key={c.consent_type}
              className="flex items-center justify-between rounded-2xl bg-warm p-4"
            >
              <span>
                <b className="block text-xs">
                  {
                    (
                      {
                        marketing: "Marketing",
                        whatsapp: "Mensagens por WhatsApp",
                        email: "Mensagens por e-mail",
                        photos: "Uso de fotos antes e depois",
                        referrals: "Programa de indicação",
                      } as any
                    )[c.consent_type]
                  }
                </b>
                <span className="text-[9px] text-stone-400">
                  Política {c.policy_version}
                </span>
              </span>
              <input
                type="checkbox"
                checked={c.accepted}
                onChange={(e) => update(c.consent_type, e.target.checked)}
              />
            </label>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap gap-3 border-t border-black/5 pt-6">
          <button disabled={exporting} onClick={download} className="btn-secondary disabled:opacity-50">
            <Download size={16} />
            {exporting ? "Gerando…" : "Exportar meus dados"}
          </button>
          <button
            disabled={Boolean(portal.data?.deletion&&['requested','under_review'].includes(portal.data.deletion.status))}
            onClick={() => setDeletion(true)}
            className="btn-secondary text-rose-700 disabled:opacity-50"
          >
            <Trash2 size={16} />
            Solicitar exclusão
          </button>
        </div>
        {portal.data?.exports?.length ? (
          <div className="mt-5 border-t border-black/5 pt-5">
            <SectionHeading title="Histórico de exportações" />
            {portal.data.exports.map((item: any) => (
              <div key={item.id} className="flex justify-between border-b border-black/5 py-3 text-xs">
                <span>{dateTime(item.requested_at)}</span>
                <Badge tone={statusTone(item.status)}>{statusLabel[item.status] || item.status}</Badge>
              </div>
            ))}
          </div>
        ) : null}
        {portal.data?.deletion && (
          <div className="mt-5 rounded-2xl bg-amber-50 p-4 text-xs text-amber-800">
            Solicitação de exclusão:{" "}
            <b>
              {statusLabel[portal.data.deletion.status] ||
                portal.data.deletion.status}
            </b>
          </div>
        )}
      </section>
      <Modal
        open={deletion}
        onClose={() => setDeletion(false)}
        title="Solicitar exclusão"
      >
        <p className="muted">
          Dados financeiros obrigatórios serão preservados ou anonimizados
          conforme a legislação.
        </p>
        <button
          onClick={async () => {
            setDeletionSaving(true);
            try {
              await apiFetch("/api/portal?resource=deletion-request", {
                method: "POST",
                body: JSON.stringify({ reason: "Solicitação pelo portal" }),
              });
              await portal.reload();
              setDeletion(false);
              setToast("Solicitação enviada para análise.");
            } catch (err) {
              console.error("Deletion request error", err);
              setToast(
                err instanceof Error
                  ? err.message
                  : "Não foi possível concluir a ação.",
              );
            } finally {
              setDeletionSaving(false);
              setTimeout(() => setToast(""), 2200);
            }
          }}
          disabled={deletionSaving}
          className="btn-primary mt-5 w-full disabled:opacity-50"
        >
          {deletionSaving ? "Enviando…" : "Confirmar solicitação"}
        </button>
      </Modal>
    </div>
  );
}

export function ClientReferralsPage() {
  const portal = usePortal<any>("/api/portal?resource=referrals");
  const [form, setForm] = useState({ name: "", phone: "" });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  if (portal.loading) return <LoadingState />;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch("/api/portal?resource=referrals", {
        method: "POST",
        body: JSON.stringify(form),
      });
      await portal.reload();
      setForm({ name: "", phone: "" });
      setToast("Indicação registrada com sucesso.");
    } catch (err) {
      console.error("Referral error", err);
      setToast(
        err instanceof Error
          ? err.message
          : "Não foi possível concluir a ação.",
      );
    } finally {
      setSaving(false);
      setTimeout(() => setToast(""), 2200);
    }
  };
  return (
    <div>
      <Toast show={!!toast} message={toast} />
      <PageHeader
        eyebrow="INDIQUE E GANHE"
        title="Compartilhe beleza"
        subtitle="A recompensa é liberada quando a indicação concluir o primeiro atendimento."
      />
      <section className="hair-gradient rounded-[28px] p-7 text-white">
        <div className="eyebrow">SEU CÓDIGO</div>
        <h2 className="mt-2 font-display text-4xl">{portal.data?.code}</h2>
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(portal.data.shareUrl);
            setToast("Link copiado.");
            setTimeout(() => setToast(""), 1800);
          }}
          className="btn-gold mt-5"
        >
          <Copy size={15} />
          Copiar link
        </button>
      </section>
      <div className="mt-6 grid gap-5 lg:grid-cols-[380px_1fr]">
        <form onSubmit={submit} className="surface self-start p-6">
          <SectionHeading title="Nova indicação" />
          <Field
            label="Nome da amiga"
            value={form.name}
            onChange={(v) => setForm({ ...form, name: v })}
          />
          <div className="mt-4">
            <Field
              label="Telefone"
              value={form.phone}
              onChange={(v) => setForm({ ...form, phone: v })}
            />
          </div>
          <p className="mt-4 text-[10px] text-stone-400">
            O contato só será usado para esta indicação. Nenhuma agenda de
            contatos é acessada automaticamente.
          </p>
          <button disabled={saving} className="btn-primary mt-5 w-full">
            <UserPlus size={16} />
            {saving ? "Salvando…" : "Registrar indicação"}
          </button>
        </form>
        <section className="surface overflow-hidden">
          {portal.data?.referrals?.length ? (
            portal.data.referrals.map((r: any) => (
              <div
                key={r.id}
                className="flex justify-between border-b border-black/5 p-5"
              >
                <span>
                  <b className="block text-xs">{r.invited_name}</b>
                  <span className="text-[10px] text-stone-400">
                    {r.invited_phone} • {date(r.created_at)}
                  </span>
                </span>
                <Badge tone={statusTone(r.status)}>
                  {statusLabel[r.status] || r.status}
                </Badge>
              </div>
            ))
          ) : (
            <EmptyState
              title="Nenhuma indicação"
              text="Cadastre sua primeira indicação de forma consentida."
            />
          )}
        </section>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-bold">{label}</span>
      <input
        className="field"
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="surface p-5">
      <span className="text-[10px] uppercase tracking-wider text-stone-400">
        {label}
      </span>
      <b className="mt-2 block text-sm">{value}</b>
    </div>
  );
}
function InfoDark({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/[.07] p-4">
      <span className="text-[9px] text-white/40">{label}</span>
      <b className="mt-1 block text-xs">{value}</b>
    </div>
  );
}
