import { FormEvent, useEffect, useState } from "react";
import { MessageCircle, Power, QrCode, RefreshCw, Send } from "lucide-react";
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

export function WhatsAppIntegrationPage() {
  const [data, setData] = useState<Result["data"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [phone, setPhone] = useState("");
  const [toast, setToast] = useState("");
  const load = () => {
    setLoading(true);
    return apiFetch<Result>("/api/whatsapp?resource=panel")
      .then((result) => setData(result.data))
      .catch((error) => {
        console.error("WhatsApp panel error", error);
        setToast(error.message);
      })
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (
      !data ||
      !["connecting", "qrcode", "awaiting_scan"].includes(
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
      const result = await apiFetch<{ data: any }>(
        "/api/whatsapp?resource=action",
        { method: "POST", body: JSON.stringify({ action, phone }) },
      );
      if (result.data?.session)
        setData((current) =>
          current ? { ...current, session: result.data.session } : current,
        );
      else await load();
      setToast(
        action === "test"
          ? "Mensagem de teste enviada."
          : "Status do WhatsApp atualizado.",
      );
    } catch (error) {
      console.error("WhatsApp action error", error);
      setToast(
        error instanceof Error
          ? error.message
          : "Não foi possível concluir a ação.",
      );
    } finally {
      setBusy("");
      setTimeout(() => setToast(""), 3000);
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
  const session = data.session || {};
  const connected = session.connection_status === "connected";
  const qr = String(session.qr_code_data || "");
  const qrSrc = qr.startsWith("data:image")
    ? qr
    : qr.startsWith("iVBOR")
      ? `data:image/png;base64,${qr}`
      : "";
  return (
    <div>
      <Toast show={!!toast} message={toast} />
      <PageHeader
        eyebrow="INTEGRAÇÃO SEGURA"
        title="WhatsApp"
        subtitle="A conexão e as credenciais permanecem no servidor Baileys."
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
            <Info
              label="Número conectado"
              value={session.phone_number || "—"}
            />
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
    </div>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-warm p-4">
      <span className="text-[9px] uppercase text-stone-400">{label}</span>
      <b className="mt-1 block break-all text-xs">{value || "—"}</b>
    </div>
  );
}
