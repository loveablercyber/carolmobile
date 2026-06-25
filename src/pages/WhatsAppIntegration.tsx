import { FormEvent, ReactNode, useEffect, useState } from "react";
import {
  Bot,
  BookOpen,
  Brain,
  FileText,
  KeyRound,
  ListChecks,
  MessageCircle,
  MessagesSquare,
  Power,
  QrCode,
  RefreshCw,
  Send,
  ShieldCheck,
} from "lucide-react";
import {
  Badge,
  EmptyState,
  LoadingState,
  PageHeader,
  SectionHeading,
  Toast,
} from "../components/ui";
import { apiFetch } from "../lib/api";

type Result = {
  data: {
    configured: boolean;
    enabled: boolean;
    session: Record<string, any>;
    liveStatus?: string;
    error?: string;
  };
};

type PersonalityMode = {
  value: string;
  label: string;
  description: string;
};

type AiSettings = {
  id?: string;
  enabled: boolean;
  provider: string;
  model: string;
  assistantName: string;
  salonName: string;
  personalityMode: string;
  systemPrompt: string;
  welcomeMessage: string;
  afterHoursMessage: string;
  humanHandoffMessage: string;
  closingMessage: string;
  maxIdleMinutes: number;
  maxAutoMessages: number;
  allow24h: boolean;
  aiStartTime: string | null;
  aiEndTime: string | null;
  allowNewContacts: boolean;
  allowExistingClients: boolean;
  allowAutoPaymentLinks: boolean;
  allowAutoBooking: boolean;
  requireBookingConfirmation: boolean;
  handoffOnComplaint: boolean;
  handoffOnPayment: boolean;
  handoffOnUrgency: boolean;
  pauseKeyword: string;
  resumeKeyword: string;
  stopKeyword: string;
  timezone: string;
  updatedAt?: string;
};

type AiPanelData = {
  status: {
    gemini: {
      provider: string;
      configured: boolean;
      enabled: boolean;
      model: string;
    };
    database: { configured: boolean };
    ai: { enabled: boolean; active: boolean };
  };
  personalityModes: PersonalityMode[];
  settings: AiSettings;
  base: {
    services: Array<Record<string, any>>;
    plans: Array<Record<string, any>>;
    coupons: Array<Record<string, any>>;
    flows: Array<Record<string, any>>;
    conversations: Array<Record<string, any>>;
    logs: Array<Record<string, any>>;
  };
};

type AiPanelResponse = { data: AiPanelData };
type AiMutationResponse = { data: { settings: AiSettings; panel: AiPanelData } };
type AiTestResponse = {
  data: {
    model: string;
    response: string;
    usage?: Record<string, any> | null;
  };
};
type AiServiceMutationResponse = {
  data: { service: Record<string, any>; panel: AiPanelData };
};
type AiFlowMutationResponse = {
  data: { flow: Record<string, any>; panel: AiPanelData };
};

type ServiceForm = {
  serviceId: string;
  active: boolean;
  commercialName: string;
  shortDescription: string;
  detailedDescription: string;
  initialPrice: string;
  estimatedDurationMinutes: string;
  requiresAssessment: boolean;
  requiresDeposit: boolean;
  depositType: string;
  depositValue: string;
  referencePhotosRequired: boolean;
  allowAutoQuote: boolean;
  allowAutoBooking: boolean;
  recommendedMessage: string;
  priorityOrder: string;
};

type FlowForm = {
  flowKey: string;
  enabled: boolean;
  requiresHumanApproval: boolean;
  triggerDelayMinutes: string;
};

const adminTabs = [
  { id: "connection", label: "Conexão", icon: MessageCircle },
  { id: "ai", label: "Atendimento IA", icon: Brain },
  { id: "base", label: "Base de Atendimento", icon: BookOpen },
  { id: "flows", label: "Fluxos e Automação", icon: ListChecks },
  { id: "conversations", label: "Conversas", icon: MessagesSquare },
  { id: "logs", label: "Logs e Diagnóstico", icon: FileText },
] as const;

type AdminTabId = (typeof adminTabs)[number]["id"];

export function WhatsAppIntegrationPage() {
  const [data, setData] = useState<Result["data"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [phone, setPhone] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [toast, setToast] = useState("");
  const [activeTab, setActiveTab] = useState<AdminTabId>("connection");
  const isAdmin = window.location.pathname.includes("/admin/");

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  };

  const load = () => {
    setLoading(true);
    return apiFetch<Result>("/api/whatsapp?resource=panel")
      .then((result) => setData(result.data))
      .catch((error) => {
        console.error("WhatsApp panel error", error);
        notify(error instanceof Error ? error.message : "Não foi possível carregar o WhatsApp.");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (
      !data ||
      !["connecting", "qrcode", "awaiting_scan", "pairing_code"].includes(
        String(data.session?.connection_status),
      )
    )
      return;
    const timer = window.setInterval(load, 5000);
    return () => window.clearInterval(timer);
  }, [data?.session?.connection_status]);

  const act = async (action: string) => {
    setBusy(action);
    try {
      const result = await apiFetch<{ data: any }>("/api/whatsapp?resource=action", {
        method: "POST",
        body: JSON.stringify({ action, phone }),
      });
      const provider = result.data?.provider || result.data?.result || {};
      if (action === "pairing_code" && provider.pairingCode)
        setPairingCode(String(provider.pairingCode));
      else if (["connect", "qr", "restart", "disconnect"].includes(action))
        setPairingCode("");
      if (result.data?.session)
        setData((current) =>
          current ? { ...current, session: result.data.session } : current,
        );
      else await load();
      notify(
        action === "test"
          ? "Mensagem de teste enviada."
          : action === "pairing_code"
            ? "Código de pareamento gerado."
            : "Status do WhatsApp atualizado.",
      );
    } catch (error) {
      console.error("WhatsApp action error", error);
      notify(
        error instanceof Error
          ? error.message
          : "Não foi possível concluir a ação.",
      );
    } finally {
      setBusy("");
    }
  };

  const test = (event: FormEvent) => {
    event.preventDefault();
    act("test");
  };

  if (loading && !data) return <LoadingState />;
  if (!data)
    return (
      <EmptyState
        title="WhatsApp indisponível"
        text="Não foi possível carregar a integração."
      />
    );

  return (
    <div>
      <Toast show={!!toast} message={toast} />
      <PageHeader
        eyebrow="INTEGRAÇÃO SEGURA"
        title="WhatsApp"
        subtitle="A conexão, a IA e as credenciais permanecem no backend."
        action={
          <button
            disabled={!!busy}
            onClick={() => act("status")}
            className="btn-secondary"
          >
            <RefreshCw size={15} />
            Atualizar status
          </button>
        }
      />

      {isAdmin && (
        <div className="mb-5 flex gap-2 overflow-x-auto rounded-[22px] bg-white/70 p-2 shadow-card">
          {adminTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex shrink-0 items-center gap-2 rounded-2xl px-4 py-3 text-xs font-bold transition ${
                  activeTab === tab.id
                    ? "bg-ink text-white"
                    : "text-stone-500 hover:bg-warm hover:text-ink"
                }`}
              >
                <Icon size={15} />
                {tab.label}
              </button>
            );
          })}
        </div>
      )}

      {!isAdmin || activeTab === "connection" ? (
        <ConnectionPanel
          data={data}
          busy={busy}
          phone={phone}
          pairingCode={pairingCode}
          setPhone={setPhone}
          act={act}
          test={test}
        />
      ) : (
        <AiAdminPanel activeTab={activeTab} notify={notify} />
      )}
    </div>
  );
}

function ConnectionPanel({
  data,
  busy,
  phone,
  pairingCode,
  setPhone,
  act,
  test,
}: {
  data: Result["data"];
  busy: string;
  phone: string;
  pairingCode: string;
  setPhone: (value: string) => void;
  act: (action: string) => Promise<void>;
  test: (event: FormEvent) => void;
}) {
  const session = data.session || {};
  const connected = session.connection_status === "connected";
  const qr = String(session.qr_code_data || "");
  const qrSrc = qr.startsWith("data:image")
    ? qr
    : qr.startsWith("iVBOR")
      ? `data:image/png;base64,${qr}`
      : "";

  return (
    <>
      {!data.configured && (
        <div className="mb-5 rounded-2xl bg-amber-50 p-4 text-xs font-semibold text-amber-900">
          A URL ou chave do servidor Baileys não está configurada. Os botões
          permanecem bloqueados para não simular conexão.
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <section className="surface p-6">
          <div className="flex items-center justify-between">
            <SectionHeading title="Sessão" />
            <Badge
              tone={
                connected
                  ? "green"
                  : session.connection_status === "error"
                    ? "rose"
                    : "amber"
              }
            >
              {session.connection_status || "disconnected"}
            </Badge>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Info label="Nome da sessão" value={session.session_name} />
            <Info label="Número conectado" value={session.phone_number || "—"} />
            <Info
              label="Última conexão"
              value={
                session.last_connected_at
                  ? new Date(session.last_connected_at).toLocaleString("pt-BR")
                  : "—"
              }
            />
            <Info
              label="Última atividade"
              value={
                session.last_activity_at
                  ? new Date(session.last_activity_at).toLocaleString("pt-BR")
                  : "—"
              }
            />
          </div>
          {session.last_error && (
            <div className="mt-4 rounded-xl bg-rose-50 p-3 text-xs text-rose-800">
              {session.last_error}
            </div>
          )}
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              disabled={!data.configured || !!busy}
              onClick={() => act("connect")}
              className="btn-primary"
            >
              <MessageCircle size={15} />
              {busy === "connect" ? "Conectando…" : "Conectar"}
            </button>
            <button
              disabled={!data.configured || !!busy}
              onClick={() => act("qr")}
              className="btn-secondary"
            >
              <QrCode size={15} />
              Gerar QR Code
            </button>
            <button
              disabled={!data.configured || !!busy}
              onClick={() => act("restart")}
              className="btn-secondary"
            >
              <RefreshCw size={15} />
              Reconectar
            </button>
            <button
              disabled={!data.configured || !!busy}
              onClick={() => act("disconnect")}
              className="btn-secondary text-rose-700"
            >
              <Power size={15} />
              Desconectar
            </button>
          </div>
        </section>
        <aside className="surface p-6">
          <SectionHeading title="QR Code" />
          {qrSrc ? (
            <img
              src={qrSrc}
              alt="QR Code do WhatsApp"
              className="mx-auto mt-4 aspect-square w-full max-w-64 rounded-2xl border p-2"
            />
          ) : (
            <EmptyState
              title={connected ? "WhatsApp conectado" : "QR Code indisponível"}
              text={
                connected
                  ? "Não é necessário escanear novamente."
                  : "Clique em Gerar QR Code para iniciar a conexão."
              }
            />
          )}
          {pairingCode && (
            <div className="mt-4 rounded-2xl bg-warm p-4 text-center">
              <span className="text-[9px] uppercase text-stone-400">
                Código de pareamento
              </span>
              <b className="mt-1 block text-2xl tracking-[0.2em] text-stone-900">
                {pairingCode}
              </b>
              <p className="mt-2 text-[11px] text-stone-500">
                No WhatsApp, use Conectar dispositivo com número de telefone.
              </p>
            </div>
          )}
          <form onSubmit={test} className="mt-5 border-t border-black/5 pt-5">
            <label className="text-xs font-bold">
              Telefone para teste
              <input
                className="field mt-2"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="5511999999999"
              />
            </label>
            <button
              type="button"
              disabled={
                !data.configured ||
                !!busy ||
                phone.replace(/\D/g, "").length < 10
              }
              onClick={() => act("pairing_code")}
              className="btn-secondary mt-3 w-full"
            >
              <KeyRound size={15} />
              Gerar código de pareamento
            </button>
            <button
              disabled={
                !data.configured ||
                !!busy ||
                phone.replace(/\D/g, "").length < 10
              }
              className="btn-primary mt-3 w-full"
            >
              <Send size={15} />
              Testar envio
            </button>
          </form>
        </aside>
      </div>
    </>
  );
}

function AiAdminPanel({
  activeTab,
  notify,
}: {
  activeTab: AdminTabId;
  notify: (message: string) => void;
}) {
  const [panel, setPanel] = useState<AiPanelData | null>(null);
  const [form, setForm] = useState<AiSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [testMessage, setTestMessage] = useState(
    "Oi, gostaria de saber quais serviços de Mega Hair vocês oferecem.",
  );
  const [testResult, setTestResult] = useState("");

  const applyPanel = (next: AiPanelData) => {
    setPanel(next);
    setForm(next.settings);
  };

  const load = () => {
    setLoading(true);
    return apiFetch<AiPanelResponse>("/api/ai-whatsapp?resource=panel")
      .then((result) => applyPanel(result.data))
      .catch((error) => {
        console.error("AI WhatsApp panel error", error);
        notify(
          error instanceof Error
            ? error.message
            : "Não foi possível carregar o Atendimento IA.",
        );
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const updateField = <K extends keyof AiSettings>(
    key: K,
    value: AiSettings[K],
  ) => {
    setForm((current) => (current ? { ...current, [key]: value } : current));
  };

  const saveSettings = async (event: FormEvent) => {
    event.preventDefault();
    if (!form) return;
    setSaving("settings");
    try {
      const result = await apiFetch<AiMutationResponse>(
        "/api/ai-whatsapp?resource=settings",
        { method: "POST", body: JSON.stringify(form) },
      );
      applyPanel(result.data.panel);
      notify("Configurações da IA salvas no banco.");
    } catch (error) {
      console.error("AI WhatsApp save error", error);
      notify(
        error instanceof Error
          ? error.message
          : "Não foi possível salvar a configuração da IA.",
      );
    } finally {
      setSaving("");
    }
  };

  const runAction = async (action: "activate" | "pause" | "restore_defaults") => {
    setSaving(action);
    try {
      const result = await apiFetch<AiMutationResponse>(
        "/api/ai-whatsapp?resource=action",
        { method: "POST", body: JSON.stringify({ action }) },
      );
      applyPanel(result.data.panel);
      notify(
        action === "restore_defaults"
          ? "Configuração padrão restaurada."
          : action === "activate"
            ? "Atendimento IA ativado."
            : "Atendimento IA pausado.",
      );
    } catch (error) {
      console.error("AI WhatsApp action error", error);
      notify(
        error instanceof Error
          ? error.message
          : "Não foi possível executar a ação da IA.",
      );
    } finally {
      setSaving("");
    }
  };

  const testGemini = async (event: FormEvent) => {
    event.preventDefault();
    setSaving("test");
    setTestResult("");
    try {
      const result = await apiFetch<AiTestResponse>(
        "/api/ai-whatsapp?resource=test",
        { method: "POST", body: JSON.stringify({ message: testMessage }) },
      );
      setTestResult(result.data.response);
      notify("Teste do Gemini concluído.");
    } catch (error) {
      console.error("AI WhatsApp test error", error);
      notify(
        error instanceof Error
          ? error.message
          : "Não foi possível testar o Gemini.",
      );
    } finally {
      setSaving("");
    }
  };

  if (loading && !panel) return <LoadingState />;
  if (!panel || !form)
    return (
      <EmptyState
        title="Atendimento IA indisponível"
        text="Não foi possível carregar as configurações reais da IA."
      />
    );

  if (activeTab === "base")
    return (
      <BaseKnowledgeTab panel={panel} onPanel={applyPanel} notify={notify} />
    );
  if (activeTab === "flows")
    return <FlowsTab panel={panel} onPanel={applyPanel} notify={notify} />;
  if (activeTab === "conversations") return <ConversationsTab panel={panel} />;
  if (activeTab === "logs") return <LogsTab panel={panel} reload={load} />;

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
      <form onSubmit={saveSettings} className="surface p-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <SectionHeading title="Atendimento IA" />
            <p className="muted max-w-2xl text-sm">
              Configurações salvas no Supabase/Neon. A chave do Gemini permanece
              somente no backend.
            </p>
          </div>
          <Badge tone={panel.status.ai.active ? "green" : "amber"}>
            {panel.status.ai.active ? "ativo" : "pausado"}
          </Badge>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Info
            label="Gemini"
            value={panel.status.gemini.configured ? "configurado" : "sem chave"}
          />
          <Info
            label="Ambiente"
            value={panel.status.gemini.enabled ? "habilitado" : "desativado"}
          />
          <Info label="Modelo" value={panel.status.gemini.model} />
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <Field label="Nome da assistente">
            <input
              className="field"
              value={form.assistantName}
              onChange={(event) => updateField("assistantName", event.target.value)}
            />
          </Field>
          <Field label="Nome do salão">
            <input
              className="field"
              value={form.salonName}
              onChange={(event) => updateField("salonName", event.target.value)}
            />
          </Field>
          <Field label="Modelo Gemini">
            <input
              className="field"
              value={form.model}
              onChange={(event) => updateField("model", event.target.value)}
            />
          </Field>
          <Field label="Modo de humor">
            <select
              className="field"
              value={form.personalityMode}
              onChange={(event) =>
                updateField("personalityMode", event.target.value)
              }
            >
              {panel.personalityModes.map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Mensagem de boas-vindas">
            <textarea
              className="field min-h-24"
              value={form.welcomeMessage}
              onChange={(event) =>
                updateField("welcomeMessage", event.target.value)
              }
            />
          </Field>
          <Field label="Mensagem fora do horário">
            <textarea
              className="field min-h-24"
              value={form.afterHoursMessage}
              onChange={(event) =>
                updateField("afterHoursMessage", event.target.value)
              }
            />
          </Field>
          <Field label="Mensagem de transferência humana">
            <textarea
              className="field min-h-24"
              value={form.humanHandoffMessage}
              onChange={(event) =>
                updateField("humanHandoffMessage", event.target.value)
              }
            />
          </Field>
          <Field label="Mensagem de encerramento">
            <textarea
              className="field min-h-24"
              value={form.closingMessage}
              onChange={(event) =>
                updateField("closingMessage", event.target.value)
              }
            />
          </Field>
        </div>

        <Field label="Prompt base da IA">
          <textarea
            className="field min-h-56"
            value={form.systemPrompt}
            onChange={(event) => updateField("systemPrompt", event.target.value)}
          />
        </Field>

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <Field label="Máx. mensagens automáticas">
            <input
              type="number"
              min={1}
              max={80}
              className="field"
              value={form.maxAutoMessages}
              onChange={(event) =>
                updateField("maxAutoMessages", Number(event.target.value))
              }
            />
          </Field>
          <Field label="Inatividade em minutos">
            <input
              type="number"
              min={5}
              max={1440}
              className="field"
              value={form.maxIdleMinutes}
              onChange={(event) =>
                updateField("maxIdleMinutes", Number(event.target.value))
              }
            />
          </Field>
          <Field label="Fuso horário">
            <input
              className="field"
              value={form.timezone}
              onChange={(event) => updateField("timezone", event.target.value)}
            />
          </Field>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <CheckField
            label="IA ativa no WhatsApp"
            checked={form.enabled}
            onChange={(checked) => updateField("enabled", checked)}
          />
          <CheckField
            label="Atender 24h"
            checked={form.allow24h}
            onChange={(checked) => updateField("allow24h", checked)}
          />
          <CheckField
            label="Responder novos contatos"
            checked={form.allowNewContacts}
            onChange={(checked) => updateField("allowNewContacts", checked)}
          />
          <CheckField
            label="Responder clientes existentes"
            checked={form.allowExistingClients}
            onChange={(checked) => updateField("allowExistingClients", checked)}
          />
          <CheckField
            label="Permitir links de pagamento automáticos"
            checked={form.allowAutoPaymentLinks}
            onChange={(checked) => updateField("allowAutoPaymentLinks", checked)}
          />
          <CheckField
            label="Permitir pré-agendamento automático"
            checked={form.allowAutoBooking}
            onChange={(checked) => updateField("allowAutoBooking", checked)}
          />
          <CheckField
            label="Exigir confirmação antes de agendar"
            checked={form.requireBookingConfirmation}
            onChange={(checked) =>
              updateField("requireBookingConfirmation", checked)
            }
          />
          <CheckField
            label="Transferir reclamações para humano"
            checked={form.handoffOnComplaint}
            onChange={(checked) => updateField("handoffOnComplaint", checked)}
          />
        </div>

        {!form.allow24h && (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="Início do atendimento IA">
              <input
                type="time"
                className="field"
                value={form.aiStartTime || ""}
                onChange={(event) =>
                  updateField("aiStartTime", event.target.value || null)
                }
              />
            </Field>
            <Field label="Fim do atendimento IA">
              <input
                type="time"
                className="field"
                value={form.aiEndTime || ""}
                onChange={(event) =>
                  updateField("aiEndTime", event.target.value || null)
                }
              />
            </Field>
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-2">
          <button disabled={!!saving} className="btn-primary">
            <ShieldCheck size={15} />
            {saving === "settings" ? "Salvando…" : "Salvar configuração"}
          </button>
          <button
            type="button"
            disabled={!!saving}
            onClick={() => runAction(form.enabled ? "pause" : "activate")}
            className="btn-secondary"
          >
            <Bot size={15} />
            {form.enabled ? "Pausar IA" : "Ativar IA"}
          </button>
          <button
            type="button"
            disabled={!!saving}
            onClick={() => runAction("restore_defaults")}
            className="btn-secondary"
          >
            Restaurar padrão
          </button>
        </div>
      </form>

      <aside className="space-y-5">
        <section className="surface p-6">
          <SectionHeading title="Teste seguro" />
          <form onSubmit={testGemini}>
            <textarea
              className="field min-h-28"
              value={testMessage}
              onChange={(event) => setTestMessage(event.target.value)}
            />
            <button
              disabled={!!saving || !panel.status.gemini.configured}
              className="btn-primary mt-3 w-full"
            >
              <Send size={15} />
              {saving === "test" ? "Testando…" : "Testar Gemini"}
            </button>
          </form>
          {!panel.status.gemini.configured && (
            <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-800">
              Configure GEMINI_API_KEY no ambiente do Vercel para liberar o
              teste real.
            </p>
          )}
          {testResult && (
            <div className="mt-4 rounded-2xl bg-warm p-4 text-sm text-stone-700">
              {testResult}
            </div>
          )}
        </section>
        <section className="surface p-6">
          <SectionHeading title="Regras críticas" />
          <ul className="space-y-3 text-sm text-stone-600">
            <li>• A IA não confirma valores, horários ou pagamentos inventados.</li>
            <li>• Pré-agendamento exige confirmação explícita.</li>
            <li>• Reclamações, urgência e pagamento problemático vão para humano.</li>
            <li>• Nenhuma chave sensível é exposta no frontend.</li>
          </ul>
        </section>
      </aside>
    </div>
  );
}

function BaseKnowledgeTab({
  panel,
  onPanel,
  notify,
}: {
  panel: AiPanelData;
  onPanel: (panel: AiPanelData) => void;
  notify: (message: string) => void;
}) {
  const [savingServiceId, setSavingServiceId] = useState("");

  const saveService = async (form: ServiceForm) => {
    setSavingServiceId(form.serviceId);
    try {
      const result = await apiFetch<AiServiceMutationResponse>(
        "/api/ai-whatsapp?resource=service-settings",
        { method: "POST", body: JSON.stringify(form) },
      );
      onPanel(result.data.panel);
      notify("Serviço salvo na Base de Atendimento.");
      return true;
    } catch (error) {
      console.error("AI WhatsApp service settings error", error);
      notify(
        error instanceof Error
          ? error.message
          : "Não foi possível salvar o serviço para a IA.",
      );
      return false;
    } finally {
      setSavingServiceId("");
    }
  };

  return (
    <div className="grid gap-5 xl:grid-cols-3">
      <section className="surface p-6 xl:col-span-2">
        <SectionHeading title="Serviços usados pela IA" />
        <p className="muted mb-5 text-sm">
          Libere apenas serviços reais do catálogo. A IA só pode citar valores e
          descrições salvos aqui.
        </p>
        {panel.base.services.length ? (
          <div className="grid gap-4">
            {panel.base.services.map((service) => (
              <ServiceSettingsCard
                key={service.id}
                service={service}
                saving={savingServiceId === service.id}
                disabled={!!savingServiceId}
                onSave={saveService}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title="Nenhum serviço cadastrado"
            text="Cadastre serviços reais antes de liberar respostas comerciais pela IA."
          />
        )}
      </section>

      <section className="surface p-6">
        <SectionHeading title="Planos e cupons" />
        <MiniList
          title="Planos"
          empty="Nenhum plano disponível para consulta."
          items={panel.base.plans.map((plan) => ({
            id: plan.id,
            title: plan.name,
            description: `${formatMoney(plan.price)} • ${plan.billing_cycle || "ciclo não informado"}`,
            badge: plan.can_sell_by_ai ? "IA vende" : "humano confirma",
          }))}
        />
        <div className="mt-5 border-t border-black/5 pt-5">
          <MiniList
            title="Cupons"
            empty="Nenhum cupom disponível."
            items={panel.base.coupons.map((coupon) => ({
              id: coupon.id,
              title: coupon.code,
              description: coupon.description || "Sem descrição",
              badge: coupon.active ? "ativo" : "inativo",
            }))}
          />
        </div>
      </section>
    </div>
  );
}

function serviceToForm(service: Record<string, any>): ServiceForm {
  return {
    serviceId: String(service.id || ""),
    active: Boolean(service.ai_active),
    commercialName: String(service.commercial_name || service.name || ""),
    shortDescription: String(
      service.short_description || service.description || "",
    ),
    detailedDescription: String(
      service.detailed_description || service.description || "",
    ),
    initialPrice: String(service.initial_price ?? service.base_price ?? ""),
    estimatedDurationMinutes: String(
      service.estimated_duration_minutes ?? service.duration_minutes ?? "",
    ),
    requiresAssessment: Boolean(service.requires_assessment),
    requiresDeposit: Boolean(service.requires_deposit),
    depositType: String(service.deposit_type || "amount"),
    depositValue: String(service.deposit_value ?? service.deposit_amount ?? 0),
    referencePhotosRequired: Boolean(service.reference_photos_required),
    allowAutoQuote: Boolean(service.allow_auto_quote),
    allowAutoBooking: Boolean(service.allow_auto_booking),
    recommendedMessage: String(service.recommended_message || ""),
    priorityOrder: String(service.priority_order || 100),
  };
}

function ServiceSettingsCard({
  service,
  saving,
  disabled,
  onSave,
}: {
  service: Record<string, any>;
  saving: boolean;
  disabled: boolean;
  onSave: (form: ServiceForm) => Promise<boolean>;
}) {
  const [form, setForm] = useState<ServiceForm>(() => serviceToForm(service));

  useEffect(() => {
    setForm(serviceToForm(service));
  }, [service]);

  const set = <K extends keyof ServiceForm>(key: K, value: ServiceForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await onSave(form);
    if (!ok) setForm(serviceToForm(service));
  };

  const disabledAll = disabled || saving;
  const catalogInactive = service.active === false;

  return (
    <form onSubmit={submit} className="rounded-[24px] bg-warm p-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <b className="text-sm">{service.name}</b>
            <Badge tone={form.active ? "green" : "neutral"}>
              {form.active ? "IA ativa" : "não usado"}
            </Badge>
            {catalogInactive && <Badge tone="rose">catálogo inativo</Badge>}
          </div>
          <p className="mt-1 text-xs text-stone-500">
            Catálogo: {formatMoney(service.base_price)} •{" "}
            {service.duration_minutes || "—"} min
          </p>
        </div>
        <label className="flex items-center gap-2 rounded-2xl bg-white px-3 py-2 text-xs font-bold text-stone-600">
          <input
            type="checkbox"
            checked={form.active}
            disabled={disabledAll || (catalogInactive && !form.active)}
            onChange={(event) => set("active", event.target.checked)}
          />
          Ativo no WhatsApp
        </label>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Field label="Nome comercial">
          <input
            className="field bg-white"
            value={form.commercialName}
            disabled={disabledAll}
            onChange={(event) => set("commercialName", event.target.value)}
          />
        </Field>
        <Field label="Valor inicial">
          <input
            className="field bg-white"
            type="number"
            min={0}
            step="0.01"
            value={form.initialPrice}
            disabled={disabledAll}
            onChange={(event) => set("initialPrice", event.target.value)}
          />
        </Field>
        <Field label="Duração estimada em minutos">
          <input
            className="field bg-white"
            type="number"
            min={5}
            max={720}
            value={form.estimatedDurationMinutes}
            disabled={disabledAll}
            onChange={(event) =>
              set("estimatedDurationMinutes", event.target.value)
            }
          />
        </Field>
        <Field label="Ordem de prioridade">
          <input
            className="field bg-white"
            type="number"
            min={1}
            max={999}
            value={form.priorityOrder}
            disabled={disabledAll}
            onChange={(event) => set("priorityOrder", event.target.value)}
          />
        </Field>
      </div>

      <Field label="Descrição curta para WhatsApp">
        <textarea
          className="field min-h-20 bg-white"
          value={form.shortDescription}
          disabled={disabledAll}
          onChange={(event) => set("shortDescription", event.target.value)}
        />
      </Field>

      <Field label="Descrição detalhada">
        <textarea
          className="field min-h-24 bg-white"
          value={form.detailedDescription}
          disabled={disabledAll}
          onChange={(event) => set("detailedDescription", event.target.value)}
        />
      </Field>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <CheckField
          label="Exige avaliação"
          checked={form.requiresAssessment}
          disabled={disabledAll}
          onChange={(checked) => set("requiresAssessment", checked)}
        />
        <CheckField
          label="Fotos de referência obrigatórias"
          checked={form.referencePhotosRequired}
          disabled={disabledAll}
          onChange={(checked) => set("referencePhotosRequired", checked)}
        />
        <CheckField
          label="Permitir pré-orçamento automático"
          checked={form.allowAutoQuote}
          disabled={disabledAll}
          onChange={(checked) => set("allowAutoQuote", checked)}
        />
        <CheckField
          label="Permitir pré-agendamento automático"
          checked={form.allowAutoBooking}
          disabled={disabledAll}
          onChange={(checked) => set("allowAutoBooking", checked)}
        />
        <CheckField
          label="Exige sinal"
          checked={form.requiresDeposit}
          disabled={disabledAll}
          onChange={(checked) => set("requiresDeposit", checked)}
        />
      </div>

      {form.requiresDeposit && (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Field label="Tipo do sinal">
            <select
              className="field bg-white"
              value={form.depositType}
              disabled={disabledAll}
              onChange={(event) => set("depositType", event.target.value)}
            >
              <option value="amount">Valor fixo</option>
              <option value="percentage">Percentual</option>
            </select>
          </Field>
          <Field label="Valor do sinal">
            <input
              className="field bg-white"
              type="number"
              min={0}
              step="0.01"
              value={form.depositValue}
              disabled={disabledAll}
              onChange={(event) => set("depositValue", event.target.value)}
            />
          </Field>
        </div>
      )}

      <Field label="Mensagem recomendada">
        <textarea
          className="field min-h-20 bg-white"
          value={form.recommendedMessage}
          disabled={disabledAll}
          onChange={(event) => set("recommendedMessage", event.target.value)}
          placeholder="Ex.: Ideal para quem busca mais volume com acabamento discreto."
        />
      </Field>

      {catalogInactive && (
        <p className="mt-3 rounded-xl bg-rose-50 p-3 text-xs font-semibold text-rose-700">
          Este serviço está inativo no catálogo real. Reative no cadastro de
          serviços antes de liberar para a IA.
        </p>
      )}

      <button disabled={disabledAll} className="btn-primary mt-4">
        <ShieldCheck size={15} />
        {saving ? "Salvando serviço…" : "Salvar serviço"}
      </button>
    </form>
  );
}

function flowToForm(flow: Record<string, any>): FlowForm {
  return {
    flowKey: String(flow.flow_key || ""),
    enabled: Boolean(flow.enabled),
    requiresHumanApproval: Boolean(flow.requires_human_approval),
    triggerDelayMinutes: String(flow.trigger_delay_minutes ?? 0),
  };
}

function FlowsTab({
  panel,
  onPanel,
  notify,
}: {
  panel: AiPanelData;
  onPanel: (panel: AiPanelData) => void;
  notify: (message: string) => void;
}) {
  const [savingFlowKey, setSavingFlowKey] = useState("");

  const saveFlow = async (form: FlowForm) => {
    setSavingFlowKey(form.flowKey);
    try {
      const result = await apiFetch<AiFlowMutationResponse>(
        "/api/ai-whatsapp?resource=flow-settings",
        { method: "POST", body: JSON.stringify(form) },
      );
      onPanel(result.data.panel);
      notify("Fluxo salvo no banco.");
      return true;
    } catch (error) {
      console.error("AI WhatsApp flow settings error", error);
      notify(
        error instanceof Error
          ? error.message
          : "Não foi possível salvar o fluxo.",
      );
      return false;
    } finally {
      setSavingFlowKey("");
    }
  };
  return (
    <section className="surface p-6">
      <SectionHeading title="Fluxos e Automação" />
      <p className="muted mb-5 text-sm">
        Escolha quais fluxos ficam ativos. Nesta etapa, ativar um fluxo libera
        somente a configuração salva; agenda, pagamento e mídia continuam
        exigindo implementação própria.
      </p>
      {panel.base.flows.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {panel.base.flows.map((flow) => (
            <FlowSettingsCard
              key={flow.id}
              flow={flow}
              saving={savingFlowKey === flow.flow_key}
              disabled={!!savingFlowKey}
              onSave={saveFlow}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          title="Nenhum fluxo cadastrado"
          text="A migração cria os fluxos padrão automaticamente ao abrir o painel."
        />
      )}
    </section>
  );
}

function FlowSettingsCard({
  flow,
  saving,
  disabled,
  onSave,
}: {
  flow: Record<string, any>;
  saving: boolean;
  disabled: boolean;
  onSave: (form: FlowForm) => Promise<boolean>;
}) {
  const [form, setForm] = useState<FlowForm>(() => flowToForm(flow));

  useEffect(() => {
    setForm(flowToForm(flow));
  }, [flow]);

  const update = <K extends keyof FlowForm>(key: K, value: FlowForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await onSave(form);
    if (!ok) setForm(flowToForm(flow));
  };

  const disabledAll = disabled || saving;

  return (
    <form onSubmit={submit} className="rounded-2xl bg-warm p-4">
      <div className="flex items-start justify-between gap-2">
        <b className="text-sm">{flow.name}</b>
        <Badge tone={form.enabled ? "green" : "neutral"}>
          {form.enabled ? "ativo" : "pausado"}
        </Badge>
      </div>
      <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-stone-400">
        {flow.flow_key}
      </p>
      <div className="mt-4 space-y-3">
        <CheckField
          label="Fluxo ativo"
          checked={form.enabled}
          disabled={disabledAll}
          onChange={(checked) => update("enabled", checked)}
        />
        <CheckField
          label="Exigir aprovação humana"
          checked={form.requiresHumanApproval}
          disabled={disabledAll}
          onChange={(checked) => update("requiresHumanApproval", checked)}
        />
        <Field label="Atraso do gatilho em minutos">
          <input
            type="number"
            min={0}
            max={1440}
            className="field"
            disabled={disabledAll}
            value={form.triggerDelayMinutes}
            onChange={(event) =>
              update("triggerDelayMinutes", event.target.value)
            }
          />
        </Field>
      </div>
      <button disabled={disabledAll} className="btn-primary mt-4 w-full">
        <ShieldCheck size={15} />
        {saving ? "Salvando fluxo…" : "Salvar fluxo"}
      </button>
    </form>
  );
}

function ConversationsTab({ panel }: { panel: AiPanelData }) {
  return (
    <section className="surface p-6">
      <SectionHeading title="Conversas" />
      {panel.base.conversations.length ? (
        <div className="space-y-3">
          {panel.base.conversations.map((conversation) => (
            <div
              key={conversation.id}
              className="flex flex-col gap-3 rounded-2xl bg-warm p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <b className="text-sm">
                  {conversation.client || conversation.phone_number}
                </b>
                <p className="mt-1 text-xs text-stone-500">
                  {conversation.last_message_preview || "Sem mensagens registradas."}
                </p>
                <p className="mt-1 text-[11px] text-stone-400">
                  {formatDate(conversation.last_message_at)}
                </p>
              </div>
              <Badge tone={conversation.ai_enabled ? "green" : "amber"}>
                {conversation.status}
              </Badge>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          title="Nenhuma conversa registrada"
          text="As conversas reais aparecerão aqui depois que o webhook de mensagens for conectado ao módulo IA."
        />
      )}
    </section>
  );
}

function LogsTab({
  panel,
  reload,
}: {
  panel: AiPanelData;
  reload: () => Promise<void>;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
      <section className="surface p-6">
        <SectionHeading title="Diagnóstico" />
        <div className="space-y-3">
          <StatusLine
            label="Gemini configurado"
            ok={panel.status.gemini.configured}
          />
          <StatusLine label="Gemini habilitado" ok={panel.status.gemini.enabled} />
          <StatusLine label="Banco preparado" ok={panel.status.database.configured} />
          <StatusLine label="IA ativa" ok={panel.status.ai.active} />
        </div>
        <button onClick={reload} className="btn-secondary mt-5 w-full">
          <RefreshCw size={15} />
          Atualizar diagnóstico
        </button>
      </section>
      <section className="surface p-6">
        <SectionHeading title="Logs recentes" />
        {panel.base.logs.length ? (
          <div className="space-y-3">
            {panel.base.logs.map((log) => (
              <div key={log.id} className="rounded-2xl bg-warm p-4">
                <div className="flex items-center justify-between gap-2">
                  <b className="text-sm">{log.event_type}</b>
                  <Badge tone={statusTone(log.status)}>{log.status}</Badge>
                </div>
                {log.error_message && (
                  <p className="mt-2 text-xs text-rose-700">{log.error_message}</p>
                )}
                <p className="mt-2 text-[11px] text-stone-400">
                  {formatDate(log.created_at)}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="Sem logs de IA"
            text="Nenhum evento do Atendimento IA foi registrado ainda."
          />
        )}
      </section>
    </div>
  );
}

function MiniList({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: Array<{ id: string; title: string; description: string; badge: string }>;
}) {
  return (
    <div>
      <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-stone-400">
        {title}
      </h3>
      {items.length ? (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.id} className="rounded-2xl bg-warm p-4">
              <div className="flex items-start justify-between gap-2">
                <b className="text-sm">{item.title}</b>
                <Badge tone="gold">{item.badge}</Badge>
              </div>
              <p className="mt-2 text-xs text-stone-500">{item.description}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-2xl bg-warm p-4 text-xs text-stone-500">{empty}</p>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mt-4 block text-xs font-bold text-stone-600">
      {label}
      <div className="mt-2">{children}</div>
    </label>
  );
}

function CheckField({
  label,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 rounded-2xl bg-warm p-4 text-xs font-bold text-stone-600">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}

function StatusLine({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-2xl bg-warm p-4 text-sm">
      <span className="font-semibold text-stone-600">{label}</span>
      <Badge tone={ok ? "green" : "amber"}>{ok ? "ok" : "pendente"}</Badge>
    </div>
  );
}

function statusTone(status: string): "neutral" | "gold" | "green" | "amber" | "rose" | "black" {
  if (["success", "sent", "delivered", "ok"].includes(String(status))) return "green";
  if (["error", "failed"].includes(String(status))) return "rose";
  if (["warning", "pending"].includes(String(status))) return "amber";
  return "neutral";
}

function formatMoney(value: unknown) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return "valor sob consulta";
  return amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(value: unknown) {
  if (!value) return "sem data";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "sem data";
  return date.toLocaleString("pt-BR");
}

function Info({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-2xl bg-warm p-4">
      <span className="text-[9px] uppercase text-stone-400">{label}</span>
      <b className="mt-1 block break-all text-xs">{String(value || "—")}</b>
    </div>
  );
}
