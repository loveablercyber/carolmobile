import { FormEvent, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  CalendarDays,
  Check,
  CircleDollarSign,
  CreditCard,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldAlert,
  Tag,
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
import { apiFetch } from "../../lib/api";

type Result<T> = { data: T };
const brl = (v: unknown) =>
  Number(v || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
const dt = (v: unknown) =>
  v
    ? new Date(String(v)).toLocaleString("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "—";
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
  if (p.loading) return <LoadingState />;
  const list = (p.data || []).filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div>
      <PageHeader
        eyebrow="CRM"
        title="Clientes"
        subtitle="Cadastros reais, conta e relacionamento."
        action={
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
        }
      />
      {list.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((c) => (
            <button
              key={c.id}
              onClick={() => nav(`/admin/clientes/${c.id}`)}
              className="surface p-5 text-left"
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
          ))}
        </div>
      ) : (
        <EmptyState
          title="Nenhuma cliente encontrada"
          text="Ajuste a busca ou cadastre uma nova cliente."
        />
      )}
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
  if (p.loading) return <LoadingState />;
  if (!p.data) return <ErrorBox text={p.error} />;
  const d = p.data,
    profile = d.profile;
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
  const tabs = [
    "Resumo",
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
        )}{" "}
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
        )}{" "}
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
        )}{" "}
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
        )}{" "}
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
        )}{" "}
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
        )}{" "}
        {tab === "Privacidade" && (<>
          {d.deletion&&<div className="mb-5 rounded-2xl bg-warm p-5"><div className="flex flex-wrap items-center justify-between gap-3"><span><b className="block text-xs">Solicitação de exclusão</b><small className="text-stone-400">{dt(d.deletion.requested_at)} • {d.deletion.reason||'Sem motivo informado'}</small></span><Badge tone={tone(d.deletion.status)}>{labels[d.deletion.status]||d.deletion.status}</Badge></div>{['requested','under_review'].includes(d.deletion.status)&&<div className="mt-4 flex gap-2"><button onClick={()=>setReviewAction('reject')} className="btn-secondary">Rejeitar</button><button onClick={()=>setReviewAction('approve')} className="btn-primary">Aprovar e anonimizar</button></div>}</div>}
          <TableEmpty rows={d.consents} render={(x: any) => (<Row key={x.consent_type} title={x.consent_type} detail={`Política ${x.policy_version}`} value={<Badge tone={x.accepted ? "green" : "rose"}>{x.accepted ? "Aceito" : "Revogado"}</Badge>}/>)}/>
        </>)}{" "}
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
      <Modal open={!!reviewAction} onClose={()=>{if(!reviewing)setReviewAction("")}} title={reviewAction==='approve'?"Aprovar exclusão":"Rejeitar exclusão"}>
        <p className="muted">{reviewAction==='approve'?"Esta ação remove dados pessoais, mídias e acesso da conta, preservando registros financeiros anonimizados. Não pode ser desfeita.":"A conta voltará ao estado ativo e a solicitação será encerrada."}</p>
        <button disabled={reviewing} onClick={reviewDeletion} className="btn-primary mt-5 w-full disabled:opacity-50">{reviewing?'Processando…':reviewAction==='approve'?'Confirmar anonimização':'Confirmar rejeição'}</button>
      </Modal>
    </div>
  );
}

export function AdminPaymentsPage() {
  const p = useLoad<any[]>("/api/portal?resource=admin-payments");
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");
  const [review, setReview] = useState<any>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  if (p.loading) return <LoadingState />;
  if (!p.data) return <ErrorBox text={p.error} />;
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
  return (
    <div>
      <Toast show={!!toast} message={toast} />
      <PageHeader
        eyebrow="FINANCEIRO"
        title="Pagamentos"
        subtitle="Confirmação manual, pagamentos parciais e histórico."
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
                  {x.service || x.plan || "Pagamento manual"}
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
              <b className="text-xs">{brl(x.amount)}</b>
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
              ) : x.provider === "local" && x.status !== "paid" ? (
                <button
                  disabled={busy === x.id}
                  onClick={() => confirm(x.id)}
                  className="btn-primary !min-h-9 !px-3"
                >
                  {busy === x.id ? "Confirmando…" : "Confirmar"}
                </button>
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
  const [form, setForm] = useState({ name: "", price: "", benefits: "" });
  const [toast, setToast] = useState("");
  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch("/api/portal?resource=admin-plan", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          price: Number(form.price),
          benefits: form.benefits.split("\n"),
        }),
      });
      await p.reload();
      setOpen(false);
      setToast("Plano atualizado com sucesso.");
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
          <button onClick={() => setOpen(true)} className="btn-primary">
            <Plus size={15} />
            Criar plano
          </button>
        }
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {p.data?.map((x) => (
          <div key={x.id} className="surface p-6">
            <Badge tone={x.active ? "green" : "neutral"}>
              {x.active ? "ATIVO" : "PAUSADO"}
            </Badge>
            <h2 className="mt-3 font-display text-3xl">{x.name}</h2>
            <b>{brl(x.price)}</b>
            <p className="mt-4 text-xs text-stone-400">
              {x.active_subscribers} assinantes ativos
            </p>
          </div>
        ))}
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Criar plano">
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
            <span className="mb-2 block text-xs font-bold">
              Benefícios, um por linha
            </span>
            <textarea
              className="field min-h-28 py-3"
              value={form.benefits}
              onChange={(e) => setForm({ ...form, benefits: e.target.value })}
            />
          </label>
          <button className="btn-primary w-full">Salvar plano</button>
        </form>
      </Modal>
    </div>
  );
}

export function AdminCouponsPage() {
  const p = useLoad<any[]>("/api/portal?resource=admin-coupons");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    code: "",
    description: "",
    discountValue: "15",
    endsAt: "",
  });
  const [toast, setToast] = useState("");
  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch("/api/portal?resource=admin-coupon", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          discountValue: Number(form.discountValue),
          discountType: "percentage",
        }),
      });
      await p.reload();
      setOpen(false);
      setToast("Cupom salvo com sucesso.");
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
          <button onClick={() => setOpen(true)} className="btn-primary">
            <Plus size={15} />
            Criar cupom
          </button>
        }
      />
      <div className="grid gap-4 md:grid-cols-2">
        {p.data?.length ? (
          p.data.map((x) => (
            <div key={x.id} className="surface p-6">
              <div className="flex justify-between">
                <Badge tone={x.active ? "green" : "neutral"}>
                  {x.active ? "ATIVO" : "PAUSADO"}
                </Badge>
                <Tag className="text-champagne" />
              </div>
              <h2 className="mt-3 font-display text-3xl">{x.code}</h2>
              <p className="muted mt-2">{x.description}</p>
              <div className="mt-4 text-xs">
                {x.discount_value}
                {x.discount_type === "percentage"
                  ? "%"
                  : ` ${brl(x.discount_value)}`}{" "}
                • até {dt(x.ends_at)}
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
      <Modal open={open} onClose={() => setOpen(false)} title="Criar cupom">
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
          <Input
            label="Desconto (%)"
            type="number"
            value={form.discountValue}
            set={(v) => setForm({ ...form, discountValue: v })}
          />
          <Input
            label="Validade"
            type="datetime-local"
            value={form.endsAt}
            set={(v) => setForm({ ...form, endsAt: v })}
          />
          <button className="btn-primary w-full">Salvar cupom</button>
        </form>
      </Modal>
    </div>
  );
}

export function AdminAppointmentsPage() {
  const p = useLoad<{ appointments: any[] }>("/api/data?resource=appointments");
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");
  if (p.loading) return <LoadingState />;
  const items = p.data?.appointments || [];
  const change = async (id: string, status: string) => {
    setBusy(id);
    try {
      await apiFetch("/api/data?resource=appointments", {
        method: "PATCH",
        body: JSON.stringify({ id, status }),
      });
      await p.reload();
      setToast("Agendamento atualizado com sucesso.");
    } catch (e) {
      console.error("Admin appointment update error", e);
      setToast(
        "Não foi possível atualizar o status. Verifique sua conexão ou tente novamente.",
      );
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
      />
      {items.length ? (
        <section className="surface overflow-hidden">
          {items.map((a: any) => (
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
            </div>
          ))}
        </section>
      ) : (
        <EmptyState title="Nenhum agendamento" text="A agenda está vazia." />
      )}
    </div>
  );
}

export function AdminProfessionalsPage() {
  const p = useLoad<any[]>("/api/portal?resource=admin-professionals");
  if (p.loading) return <LoadingState />;
  return (
    <div>
      <PageHeader
        eyebrow="EQUIPE"
        title="Profissionais"
        subtitle="Equipe, avaliações e atendimentos reais."
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {p.data?.length ? (
          p.data.map((x) => (
            <div key={x.id} className="surface p-6">
              <div className="flex gap-3">
                <Avatar src={x.avatar_url} name={x.full_name} size="lg" />
                <span className="flex-1">
                  <h2 className="font-display text-2xl">{x.full_name}</h2>
                  <p className="text-[10px] text-stone-400">{x.phone}</p>
                </span>
                <Badge tone={x.active ? "green" : "neutral"}>
                  {x.active ? "ATIVA" : "INATIVA"}
                </Badge>
              </div>
              <p className="muted mt-4">
                {x.bio || "Sem biografia cadastrada."}
              </p>
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
          ))
        ) : (
          <EmptyState
            title="Nenhuma profissional"
            text="Cadastre a equipe para iniciar."
          />
        )}
      </div>
    </div>
  );
}

export function AdminServicesPage() {
  const p = useLoad<any[]>("/api/portal?resource=admin-services");
  if (p.loading) return <LoadingState />;
  return (
    <div>
      <PageHeader
        eyebrow="CATÁLOGO"
        title="Serviços e métodos"
        subtitle="Preços, duração e demanda registrados no Neon."
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {p.data?.length ? (
          p.data.map((x) => (
            <div key={x.id} className="surface p-6">
              <Badge tone={x.active ? "green" : "neutral"}>
                {x.active ? "ATIVO" : "INATIVO"}
              </Badge>
              <h2 className="mt-3 font-display text-3xl">{x.name}</h2>
              <p className="muted mt-2">{x.description}</p>
              <div className="mt-5 grid grid-cols-3 rounded-2xl bg-warm p-4 text-center text-xs">
                <span>
                  <b className="block">{x.duration_minutes}min</b>
                  <small>Duração</small>
                </span>
                <span>
                  <b className="block">{brl(x.base_price)}</b>
                  <small>Preço</small>
                </span>
                <span>
                  <b className="block">{x.appointments}</b>
                  <small>Reservas</small>
                </span>
              </div>
            </div>
          ))
        ) : (
          <EmptyState title="Nenhum serviço" text="O catálogo está vazio." />
        )}
      </div>
    </div>
  );
}

export function AdminInventoryPage() {
  const p = useLoad<{ inventory: any[] }>("/api/data?resource=inventory");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({
    code: "",
    supplier: "",
    category: "Cabelo humano",
    color: "",
    lengthCm: "",
    lot: "",
    unitCost: "",
    suggestedPrice: "",
    quantity: "",
    minimumStock: "",
  });
  const [toast, setToast] = useState("");
  if (p.loading) return <LoadingState />;
  const list = p.data?.inventory || [];
  const total = list.reduce(
    (s, x) => s + Number(x.unit_cost || 0) * Number(x.qty || 0),
    0,
  );
  const low = list.filter((x) => Number(x.qty) <= Number(x.min));
  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch("/api/data?resource=inventory", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          lengthCm: Number(form.lengthCm) || null,
          unitCost: Number(form.unitCost),
          suggestedPrice: Number(form.suggestedPrice),
          quantity: Number(form.quantity),
          minimumStock: Number(form.minimumStock),
        }),
      });
      await p.reload();
      setOpen(false);
      setToast("Item salvo com sucesso.");
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
  return (
    <div>
      <Toast show={!!toast} message={toast} />
      <PageHeader
        eyebrow="ESTOQUE"
        title="Cabelos e produtos"
        subtitle="Quantidade, custo e alertas reais."
        action={
          <button onClick={() => setOpen(true)} className="btn-primary">
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
              className="grid grid-cols-[1fr_auto] gap-3 border-b border-black/5 p-5 sm:grid-cols-[.7fr_1.3fr_1fr_.6fr_.7fr]"
            >
              <span className="text-xs">
                {x.code}
                <small className="block text-stone-400">{x.lot}</small>
              </span>
              <b className="text-xs">{x.item}</b>
              <span className="hidden text-xs sm:block">{x.detail}</span>
              <span className="text-xs">
                {x.qty} / {x.min}
              </span>
              <Badge tone={Number(x.qty) <= Number(x.min) ? "amber" : "green"}>
                {x.status}
              </Badge>
            </div>
          ))
        ) : (
          <EmptyState
            title="Nenhum item"
            text="Cadastre o primeiro item do estoque."
          />
        )}
      </section>
      <Modal open={open} onClose={() => setOpen(false)} title="Cadastrar item">
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
          <Input
            label="Categoria"
            value={form.category}
            set={(v) => setForm({ ...form, category: v })}
          />
          <Input
            label="Cor"
            value={form.color}
            set={(v) => setForm({ ...form, color: v })}
          />
          <Input
            label="Comprimento"
            type="number"
            value={form.lengthCm}
            set={(v) => setForm({ ...form, lengthCm: v })}
          />
          <Input
            label="Lote"
            value={form.lot}
            set={(v) => setForm({ ...form, lot: v })}
          />
          <Input
            label="Custo"
            type="number"
            value={form.unitCost}
            set={(v) => setForm({ ...form, unitCost: v })}
          />
          <Input
            label="Preço sugerido"
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
          <button className="btn-primary col-span-2 mt-2">Salvar item</button>
        </form>
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
  const p = useLoad<any>("/api/portal?resource=admin-dashboard");
  if (p.loading) return <LoadingState />;
  if (!p.data) return <ErrorBox text={p.error} />;
  const m = p.data.metrics;
  return (
    <div>
      <PageHeader
        eyebrow="ANÁLISE"
        title="Relatórios operacionais"
        subtitle="Resumo atual calculado a partir dos registros do Neon."
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Faturamento mensal"
          value={brl(m.monthly_revenue)}
          icon={<CircleDollarSign />}
        />
        <StatCard
          label="Agenda da semana"
          value={String(m.appointments_week)}
          icon={<CalendarDays />}
        />
        <StatCard
          label="Clientes novas"
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
            <EmptyState title="Sem dados" text="Nenhum serviço registrado." />
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
              text="Nenhum atendimento registrado."
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
  const [form, setForm] = useState<any>({
    businessName: "Carol Sol",
    phone: "",
    whatsapp: "",
    email: "",
    address: "",
    timezone: "America/Sao_Paulo",
  });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  useEffect(() => {
    if (p.data) setForm((current: any) => ({ ...current, ...p.data }));
  }, [p.data]);
  if (p.loading) return <LoadingState />;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch("/api/portal?resource=admin-settings", {
        method: "PATCH",
        body: JSON.stringify(form),
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
  return (
    <div>
      <Toast show={!!toast} message={toast} />
      <PageHeader
        eyebrow="CONFIGURAÇÕES"
        title="Dados da empresa"
        subtitle="Informações operacionais persistidas e auditadas."
      />
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
}: {
  label: string;
  value: string;
  set: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-bold">{label}</span>
      <input
        className="field"
        type={type}
        value={value}
        onChange={(e) => set(e.target.value)}
      />
    </label>
  );
}
