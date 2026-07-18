import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  Camera,
  Check,
  ChevronRight,
  Clock3,
  CreditCard,
  Download,
  Gift,
  Heart,
  ImagePlus,
  Info,
  MapPin,
  MessageCircle,
  Package,
  Pencil,
  Phone,
  Play,
  Plus,
  QrCode,
  Scissors,
  Search,
  Share2,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  Upload,
  UserRound,
  Users,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import { AppShell } from "../../components/AppShell";
import {
  Avatar,
  Badge,
  EmptyState,
  Modal,
  PageHeader,
  SectionHeading,
  Toast,
} from "../../components/ui";
import { apiFetch, uploadImage } from "../../lib/api";
import {
  ClientAppointmentDetailPage,
  ClientBenefitsPage,
  ClientCardsPage,
  ClientCouponsPage,
  ClientHistoryPage,
  ClientHomePage,
  ClientNotificationsPage,
  ClientPaymentReturnPage,
  ClientPaymentsPage,
  ClientPlanDetailPage,
  ClientPrivacyPage,
  ClientProfilePage,
  ClientReferralsPage,
} from "./ClientPortal";

const money = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const bookingDepositAmount = (
  service: Record<string, any> | undefined,
  finalPrice: number,
) => {
  if (!service?.id || service.is_free) return 0;
  const configuredDeposit = Math.max(0, Number(service.deposit_amount || 0));
  const payablePrice = Math.max(0, Number(finalPrice || 0));
  return Math.min(configuredDeposit, payablePrice);
};
const servicePriceLabel = (service: Record<string, any>, inventoryItems: Array<Record<string, any>> = []) => {
  if (service?.offer_inventory_items) {
    const matching = (inventoryItems || []).filter(
      (item) => item.category_id === service.category_id && 
                (!service.hair_method_id || item.hair_method_id === service.hair_method_id)
    );
    if (matching.length > 0) {
      const prices = matching.map((item) => Number(item.suggested_price || 0));
      const minPrice = Math.min(...prices);
      return `A partir de ${money(minPrice)}`;
    }
    return "Sob consulta";
  }
  return service?.is_free ? "Sem custo" : money(Number(service?.base_price || 0));
};

const whatsappUrl = (phone: unknown) => {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  return `https://wa.me/${digits.startsWith("55") ? digits : `55${digits}`}`;
};

export function ClientArea() {
  const location = useLocation();
  const navigate = useNavigate();
  let page;
  if (["/cliente", "/cliente/", "/cliente/inicio"].includes(location.pathname))
    page = <ClientHomePage />;
  else if (location.pathname.includes("/agendamentos/"))
    page = <ClientAppointmentDetailPage />;
  else if (location.pathname.includes("/pagamento/retorno"))
    page = <ClientPaymentReturnPage />;
  else if (location.pathname.includes("/pagamentos"))
    page = <ClientPaymentsPage />;
  else if (location.pathname.includes("/cartoes")) page = <ClientCardsPage />;
  else if (location.pathname.includes("/planos/"))
    page = <ClientPlanDetailPage />;
  else if (location.pathname.includes("/cupons")) page = <ClientCouponsPage />;
  else if (location.pathname.includes("/historico"))
    page = <ClientHistoryPage />;
  else if (location.pathname.includes("/notificacoes"))
    page = <ClientNotificationsPage />;
  else if (location.pathname.includes("/privacidade"))
    page = <ClientPrivacyPage />;
  else if (location.pathname.includes("/indique-e-ganhe"))
    page = <ClientReferralsPage />;
  else if (location.pathname.includes("/descobrir")) page = <Discover />;
  else if (
    location.pathname.includes("/agenda") ||
    location.pathname.includes("/agendamentos")
  )
    page = <ClientAgenda />;
  else if (location.pathname.includes("/beneficios"))
    page = <ClientBenefitsPage />;
  else if (location.pathname.includes("/perfil")) page = <ClientProfilePage />;
  else if (location.pathname.includes("/servicos")) page = <ServicesPage />;
  else
    page = (
      <EmptyState
        title="Página não encontrada"
        text="Este endereço não existe na área da cliente."
        action={
          <button onClick={() => navigate("/cliente/inicio")} className="btn-primary">
            Voltar ao início
          </button>
        }
      />
    );
  return <AppShell role="cliente">{page}</AppShell>;
}



function ServicesPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Array<Record<string, any>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [inventoryItems, setInventoryItems] = useState<Array<Record<string, any>>>([]);
  useEffect(() => {
    setLoading(true);
    apiFetch<{ services: Array<Record<string, any>>, inventoryItems?: Array<Record<string, any>> }>(
      "/api/data?resource=bootstrap",
    )
      .then((data) => {
        setItems(data.services || []);
        setInventoryItems(data.inventoryItems || []);
      })
      .catch((err) => {
        console.error("Services load error", err);
        setError(
          err instanceof Error
            ? err.message
            : "Não foi possível carregar os serviços.",
        );
      })
      .finally(() => setLoading(false));
  }, []);
  const filtered = items.filter((s) =>
    String(s.name || "")
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <div className="animate-fade-up">
      <PageHeader
        eyebrow="CATÁLOGO CAROL SOL"
        title="Serviços para cada fase"
        subtitle="Catálogo carregado do banco Neon, sem dados demonstrativos."
        action={
          <div className="relative">
            <Search
              className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400"
              size={16}
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar serviço"
              className="field pl-11 sm:w-72"
            />
          </div>
        }
      />
      {loading ? (
        <div className="surface p-8 text-center text-xs text-stone-400">
          Carregando serviços…
        </div>
      ) : error ? (
        <div className="rounded-2xl bg-rose-50 p-4 text-xs font-semibold text-rose-700">
          {error}
        </div>
      ) : filtered.length ? (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((s) => (
            <article key={s.id} className="surface p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-champagne/15 text-champagne">
                  <Scissors />
                </div>
                <Badge tone={s.deposit_amount > 0 ? "gold" : "green"}>
                  {s.deposit_amount > 0 ? "Sinal obrigatório" : "Sem sinal"}
                </Badge>
              </div>
              <h2 className="mt-5 font-display text-3xl font-semibold">
                {s.name}
              </h2>
              <p className="muted mt-2">
                {s.description || "Descrição em atualização."}
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <span className="chip">
                  <Clock3 size={13} />
                  {s.duration_minutes}min
                </span>
                <span className="chip">
                  {servicePriceLabel(s, inventoryItems)}
                </span>
                {Number(s.deposit_amount || 0) > 0 && (
                  <span className="chip">
                    Sinal {money(Number(s.deposit_amount || 0))}
                  </span>
                )}
              </div>
              <button
                onClick={() => navigate("/cliente/agendamentos")}
                className="btn-primary mt-5 w-full"
              >
                Agendar
              </button>
            </article>
          ))}
        </div>
      ) : (
        <div className="surface p-8 text-center">
          <h3 className="font-display text-2xl">Nenhum serviço encontrado</h3>
          <p className="muted mt-2">
            Ajuste a busca ou tente novamente mais tarde.
          </p>
        </div>
      )}
    </div>
  );
}

const objectives = [
  ["Mais volume", "Fios mais encorpados sem perder naturalidade."],
  ["Mais comprimento", "Transformação longa com movimento leve."],
  ["Manutenção", "Renove a fixação e preserve o resultado."],
  ["Remoção", "Retirada segura com avaliação dos fios."],
  ["Correção", "Equilíbrio para assimetrias, cor ou aplicação."],
  ["Transformação completa", "Novo comprimento, volume e cor."],
  ["Avaliação personalizada", "Receba uma análise antes de escolher o método."],
];

type DiscoveryPhoto = {
  id: string;
  url: string;
  kind: string;
};

type DiscoveryRecommendation = {
  personalizedMessage: string;
  service: Record<string, any>;
  inventoryItem: Record<string, any> | null;
};

function Discover() {
  const [step, setStep] = useState(0);
  const [answer, setAnswer] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Array<DiscoveryPhoto | null>>([]);
  const [uploading, setUploading] = useState<number | null>(null);
  const [uploadMessage, setUploadMessage] = useState("");
  const [recommendation, setRecommendation] = useState<DiscoveryRecommendation | null>(null);
  const [recommendationLoading, setRecommendationLoading] = useState(false);
  const [recommendationError, setRecommendationError] = useState("");
  const [recommendationAttempt, setRecommendationAttempt] = useState(0);
  const [specialist, setSpecialist] = useState<{ name: string; photo: string } | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    apiFetch<{ professionals: Array<Record<string, any>> }>("/api/data?resource=bootstrap")
      .then((data) => {
        if (data.professionals && data.professionals.length > 0) {
          const p = data.professionals[0];
          setSpecialist({
            name: p.name || "Especialista",
            photo: p.photo || "",
          });
        }
      })
      .catch((error) => console.error("Discover specialist load error", error));
  }, []);

  useEffect(() => {
    if (step !== 4) return;
    let cancelled = false;
    setRecommendationLoading(true);
    setRecommendationError("");
    apiFetch<{ recommendation: DiscoveryRecommendation }>(
      "/api/data?resource=discovery-recommendation",
      {
        method: "POST",
        body: JSON.stringify({ answers: answer }),
      },
    )
      .then((data) => {
        if (!data.recommendation?.service?.id)
          throw new Error("Não foi possível preparar sua recomendação.");
        if (!cancelled) setRecommendation(data.recommendation);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Discovery recommendation error", error);
        setRecommendationError(
          error instanceof Error
            ? error.message
            : "Não foi possível preparar sua recomendação.",
        );
      })
      .finally(() => {
        if (!cancelled) setRecommendationLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [step, answer, recommendationAttempt]);

  const next = () => {
    const nextStep = Math.min(4, step + 1);
    if (nextStep === 4 && step !== 4) {
      setRecommendation(null);
      setRecommendationError("");
      setRecommendationAttempt((value) => value + 1);
    }
    setStep(nextStep);
  };
  const prev = () => {
    if (step === 4) setRecommendation(null);
    setStep(Math.max(0, step - 1));
  };
  const addFiles = async (
    e: ChangeEvent<HTMLInputElement>,
    index: number,
    kind: string,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) {
      setUploadMessage("Selecione uma imagem de até 10 MB.");
      setTimeout(() => setUploadMessage(""), 2800);
      e.target.value = "";
      return;
    }
    setUploading(index);
    try {
      const uploaded = await uploadImage(file, kind.toLowerCase());
      const saved = await apiFetch<{
        photo: { id: string; kind: string; storage_path: string };
      }>("/api/data?resource=photos", {
        method: "POST",
        body: JSON.stringify({
          url: uploaded.url,
          kind: kind.toLowerCase(),
          publicId: uploaded.publicId,
        }),
      });
      if (!saved.photo?.id) throw new Error("A foto não foi vinculada à sua avaliação.");
      setFiles((current) => {
        const next = [...current];
        next[index] = {
          id: saved.photo.id,
          url: uploaded.url,
          kind: saved.photo.kind || kind.toLowerCase(),
        };
        return next;
      });
      setUploadMessage("Foto enviada com sucesso.");
    } catch (error) {
      console.error("Discovery photo upload error", error);
      setUploadMessage(
        error instanceof Error
          ? error.message
          : "Não foi possível enviar a foto.",
      );
    } finally {
      setUploading(null);
      e.target.value = "";
      setTimeout(() => setUploadMessage(""), 2800);
    }
  };
  return (
    <div className="animate-fade-up">
      <Toast show={!!uploadMessage} message={uploadMessage} />
      <PageHeader
        eyebrow="DIAGNÓSTICO INTELIGENTE"
        title={
          step === 4
            ? "Sua recomendação Carol Sol"
            : "Descubra o Mega Hair ideal"
        }
        subtitle={
          step === 4
            ? "Analisamos seu objetivo e preferências para sugerir o melhor próximo passo."
            : "Leva menos de 3 minutos. Suas respostas ajudam nossa especialista a preparar uma avaliação precisa."
        }
      />
      <div className="mb-7 flex items-center gap-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full transition ${i <= step ? "bg-champagne" : "bg-stone-200"}`}
          />
        ))}
      </div>
      {step < 4 ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <div className="surface p-5 sm:p-8">
            {step === 0 && (
              <Question
                title="Qual é o seu principal objetivo?"
                hint="Escolha a opção que mais se aproxima do resultado que você deseja."
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  {objectives.map(([title, text], i) => (
                    <Choice
                      key={title}
                      active={answer.objective === title}
                      onClick={() => setAnswer({ ...answer, objective: title })}
                      title={title}
                      text={text}
                      icon={<WandSparkles size={20} />}
                      index={i + 1}
                    />
                  ))}
                </div>
              </Question>
            )}
            {step === 1 && (
              <Question
                title="Conte um pouco sobre seus fios"
                hint="Essas informações ajudam a estimar técnica, tempo e quantidade de cabelo."
              >
                <div className="grid gap-5 sm:grid-cols-2">
                  <Select
                    label="Comprimento atual"
                    options={[
                      "Curto — acima do ombro",
                      "Médio — até o busto",
                      "Longo — abaixo do busto",
                    ]}
                    onChange={(v) => setAnswer({ ...answer, length: v })}
                  />
                  <Select
                    label="Cor atual"
                    options={[
                      "Preto",
                      "Castanho escuro",
                      "Castanho claro",
                      "Morena iluminada",
                      "Loiro",
                      "Ruivo",
                    ]}
                    onChange={(v) => setAnswer({ ...answer, color: v })}
                  />
                  <Select
                    label="Possui química?"
                    options={[
                      "Não",
                      "Coloração",
                      "Descoloração",
                      "Progressiva",
                      "Mais de uma química",
                    ]}
                    onChange={(v) => setAnswer({ ...answer, chemistry: v })}
                  />
                  <Select
                    label="Já usou Mega Hair?"
                    options={[
                      "Nunca usei",
                      "Sim, e gostei",
                      "Sim, mas tive desconforto",
                      "Uso atualmente",
                    ]}
                    onChange={(v) => setAnswer({ ...answer, used: v })}
                  />
                </div>
              </Question>
            )}
            {step === 2 && (
              <Question
                title="Qual rotina combina com você?"
                hint="Vamos equilibrar investimento, resultado e frequência de cuidados."
              >
                <div className="space-y-6">
                  <OptionGroup
                    label="Orçamento aproximado"
                    options={[
                      "Até R$ 1.000",
                      "R$ 1.000 a R$ 2.000",
                      "R$ 2.000 a R$ 3.500",
                      "Acima de R$ 3.500",
                    ]}
                    value={answer.budget}
                    onChange={(v) => setAnswer({ ...answer, budget: v })}
                  />
                  <OptionGroup
                    label="Frequência de manutenção desejada"
                    options={[
                      "A cada 30 dias",
                      "A cada 45 dias",
                      "A cada 60 dias",
                      "Quero orientação",
                    ]}
                    value={answer.frequency}
                    onChange={(v) => setAnswer({ ...answer, frequency: v })}
                  />
                  <OptionGroup
                    label="Preferência de método"
                    options={[
                      "Sem preferência",
                      "Fita Adesiva",
                      "Microlink",
                      "Queratina",
                      "Tic Tac",
                    ]}
                    value={answer.method}
                    onChange={(v) => setAnswer({ ...answer, method: v })}
                  />
                </div>
              </Question>
            )}
            {step === 3 && (
              <Question
                title="Envie fotos para uma análise mais precisa"
                hint="Opcional. As imagens ficam protegidas e serão acessadas somente pela equipe responsável."
              >
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {["Frente", "Costas", "Lateral", "Referência"].map(
                    (label, i) => (
                      <label
                        key={label}
                        className="relative grid aspect-[3/4] cursor-pointer place-items-center overflow-hidden rounded-[20px] border border-dashed border-champagne/60 bg-warm text-center"
                      >
                        {files[i] ? (
                          <img
                            src={files[i]?.url}
                            alt={label}
                            className={`absolute inset-0 h-full w-full object-cover ${uploading === i ? "opacity-50" : ""}`}
                          />
                        ) : (
                          <div>
                            <ImagePlus className="mx-auto text-champagne" />
                            <span className="mt-2 block text-[11px] font-bold">
                              {label}
                            </span>
                            <span className="mt-1 block text-[9px] text-stone-400">
                              Adicionar foto
                            </span>
                          </div>
                        )}
                        {uploading === i && (
                          <span className="absolute rounded-full bg-ink/80 px-3 py-1 text-[9px] font-bold text-white">
                            Enviando…
                          </span>
                        )}
                        <input
                          type="file"
                          accept="image/*"
                          disabled={uploading !== null}
                          onChange={(e) => addFiles(e, i, label)}
                          className="hidden"
                        />
                      </label>
                    ),
                  )}
                </div>
                <div className="mt-5 flex gap-3 rounded-2xl bg-emerald-50 p-4 text-[11px] leading-relaxed text-emerald-800">
                  <ShieldCheck className="shrink-0" size={17} />
                  <span>
                    Ao enviar, você autoriza o uso das imagens apenas para sua
                    avaliação capilar. É possível excluir tudo a qualquer
                    momento.
                  </span>
                </div>
              </Question>
            )}
            <div className="mt-8 flex justify-between border-t border-black/[.06] pt-5">
              <button
                onClick={prev}
                disabled={step === 0}
                className="btn-secondary disabled:opacity-30"
              >
                <ArrowLeft size={16} />
                Voltar
              </button>
              <button onClick={next} className="btn-primary">
                {step === 3 ? "Ver recomendação" : "Continuar"}
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
          <aside className="hair-gradient self-start rounded-[28px] p-6 text-white lg:sticky lg:top-24">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white/10 text-champagne">
              <Sparkles />
            </div>
            <h3 className="mt-5 font-display text-3xl font-semibold">
              Avaliação personalizada
            </h3>
            <p className="mt-3 text-xs leading-relaxed text-white/55">
              Sua recomendação é revisada por uma especialista antes da
              aplicação. Nenhum método é indicado sem considerar a saúde dos
              seus fios.
            </p>
            <div className="mt-6 space-y-3 text-[11px] text-white/65">
              {[
                "Resultado alinhado ao seu objetivo",
                "Estimativa de tempo e investimento",
                "Plano de manutenção recomendado",
              ].map((x) => (
                <div key={x} className="flex gap-2">
                  <Check size={14} className="text-champagne" />
                  {x}
                </div>
              ))}
            </div>
          </aside>
        </div>
      ) : recommendationLoading ? (
        <div className="surface p-8 text-center">
          <Sparkles className="mx-auto text-champagne" size={28} />
          <h2 className="mt-4 font-display text-3xl font-semibold">
            Preparando sua recomendação
          </h2>
          <p className="muted mt-2">
            Consultando os serviços e itens disponíveis para você.
          </p>
        </div>
      ) : recommendation ? (
        <Recommendation
          specialist={specialist}
          recommendation={recommendation}
          onSchedule={() => {
            const discoveryPhotos = files.filter(
              (file): file is DiscoveryPhoto => Boolean(file),
            );
            sessionStorage.setItem(
              "carol_sol_discovery",
              JSON.stringify({
                answers: answer,
                photos: discoveryPhotos.map((photo) => photo.url),
                photoIds: discoveryPhotos.map((photo) => photo.id),
                recommendation,
                recommendedServiceId: recommendation.service.id,
                recommendedInventoryItemId: recommendation.inventoryItem?.id || "",
                createdAt: new Date().toISOString(),
              }),
            );
            navigate("/cliente/agenda?origem=descobrir");
          }}
        />
      ) : (
        <div className="surface p-8 text-center">
          <h2 className="font-display text-3xl font-semibold">
            Não foi possível preparar a recomendação
          </h2>
          <p className="muted mt-2">
            {recommendationError || "Tente novamente em instantes."}
          </p>
          <button
            onClick={() => setRecommendationAttempt((value) => value + 1)}
            className="btn-primary mt-5"
          >
            Tentar novamente
          </button>
        </div>
      )}
    </div>
  );
}

function Question({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="eyebrow mb-3">ETAPA DE DESCOBERTA</div>
      <h2 className="font-display text-3xl font-semibold sm:text-4xl">
        {title}
      </h2>
      <p className="muted mt-2 mb-7">{hint}</p>
      {children}
    </>
  );
}
function Choice({
  active,
  onClick,
  title,
  text,
  icon,
  index,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  text: string;
  icon: React.ReactNode;
  index: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative rounded-[22px] border p-5 text-left transition ${active ? "border-champagne bg-champagne/[.08] ring-4 ring-champagne/10" : "border-black/[.07] bg-white hover:border-champagne/40"}`}
    >
      <span className="flex items-center justify-between">
        <span
          className={`grid h-10 w-10 place-items-center rounded-2xl ${active ? "bg-champagne text-white" : "bg-warm text-champagne"}`}
        >
          {icon}
        </span>
        <span className="text-[10px] font-bold text-stone-300">0{index}</span>
      </span>
      <span className="mt-4 block text-sm font-bold">{title}</span>
      <span className="mt-1 block text-[11px] leading-relaxed text-stone-500">
        {text}
      </span>
    </button>
  );
}
function Select({
  label,
  options,
  onChange,
}: {
  label: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label>
      <span className="mb-2 block text-xs font-bold">{label}</span>
      <select
        className="field"
        defaultValue=""
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="" disabled>
          Selecione
        </option>
        {options.map((x) => (
          <option key={x}>{x}</option>
        ))}
      </select>
    </label>
  );
}
function OptionGroup({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <div className="mb-3 text-xs font-bold">{label}</div>
      <div className="flex flex-wrap gap-2">
        {options.map((x) => (
          <button
            key={x}
            onClick={() => onChange(x)}
            className={`rounded-full border px-4 py-2.5 text-xs font-semibold transition ${value === x ? "border-champagne bg-champagne text-white" : "border-black/10 bg-white text-stone-500"}`}
          >
            {x}
          </button>
        ))}
      </div>
    </div>
  );
}
function Recommendation({
  onSchedule,
  specialist,
  recommendation,
}: {
  onSchedule: () => void;
  specialist: { name: string; photo: string } | null;
  recommendation: DiscoveryRecommendation;
}) {
  const service = recommendation.service;
  const inventoryItem = recommendation.inventoryItem;
  const value = inventoryItem
    ? Number(inventoryItem.suggested_price || 0)
    : Number(service.base_price || 0);
  const itemDetails = inventoryItem
    ? [
        inventoryItem.color,
        inventoryItem.shade,
        inventoryItem.length_cm ? `${inventoryItem.length_cm}` : "",
        inventoryItem.weight_grams ? `${inventoryItem.weight_grams}g` : "",
      ]
        .filter(Boolean)
        .join(" - ")
    : "A confirmar na avaliação";
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="surface overflow-hidden">
        <div className="hair-gradient p-7 text-white sm:p-10">
          <Badge tone="gold">RECOMENDAÇÃO PERSONALIZADA</Badge>
          <h2 className="mt-5 max-w-xl font-display text-4xl font-semibold leading-none sm:text-5xl">
            {service.name}
          </h2>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-white/60">
            {recommendation.personalizedMessage}
          </p>
        </div>
        <div className="grid gap-4 p-6 sm:grid-cols-2 sm:p-8">
          {[
            ["Tempo estimado", service.duration_minutes ? `${service.duration_minutes} min` : "A confirmar"],
            ["Valor", service.is_free ? "Sem custo" : money(value)],
            ["Sinal", Number(service.deposit_amount || 0) > 0 ? money(Math.min(Number(service.deposit_amount || 0), value)) : "Sem sinal"],
            [inventoryItem ? "Item sugerido" : "Detalhe", itemDetails],
          ].map(([a, b]) => (
            <div key={a} className="rounded-2xl bg-warm p-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
                {a}
              </div>
              <div className="mt-2 text-sm font-bold">{b}</div>
            </div>
          ))}
        </div>
      </div>
      <aside className="surface self-start p-6">
        <Avatar
          src={specialist?.photo || ""}
          name={specialist?.name || "Especialista"}
          size="lg"
        />
        <h3 className="mt-4 font-display text-2xl font-semibold">
          Converse com {specialist?.name ? specialist.name.split(" ")[0] : "uma especialista"}
        </h3>
        <p className="muted mt-2">
          A avaliação presencial confirma cor, peso, textura e quantidade ideal
          para o seu cabelo.
        </p>
        <button onClick={onSchedule} className="btn-primary mt-5 w-full">
          Agendar avaliação <ArrowRight size={16} />
        </button>
        <button className="btn-secondary mt-3 w-full">
          <MessageCircle size={16} />
          Falar no WhatsApp
        </button>
      </aside>
    </div>
  );
}

const bookingSteps = [
  "Serviço",
  "Método",
  "Profissional",
  "Data",
  "Horário",
  "Observações",
  "Revisão",
  "Sinal",
];
const clientAppointmentStatus: Record<string, string> = {
  requested: "SOLICITAÇÃO ENVIADA",
  awaiting_payment: "AGUARDANDO PAGAMENTO",
  pending_deposit: "AGUARDANDO SINAL",
  confirmed: "CONFIRMADO",
  in_service: "EM ATENDIMENTO",
  reschedule_requested: "REAGENDAMENTO SOLICITADO",
  rescheduled: "REAGENDADO",
};
const nextBookingDates = () => {
  const dates: string[] = [];
  const base = new Date();
  for (let offset = 1; dates.length < 8 && offset < 21; offset++) {
    const d = new Date(base);
    d.setDate(base.getDate() + offset);
    if (d.getDay() !== 0) dates.push(d.toLocaleDateString("pt-BR"));
  }
  return dates;
};

function ClientAgenda() {
  const location = useLocation();
  const dates = useMemo(nextBookingDates, []);
  const discoveryDraft = useMemo(() => {
    try {
      return JSON.parse(
        sessionStorage.getItem("carol_sol_discovery") || "null",
      );
    } catch {
      return null;
    }
  }, []);
  const discoveryNotes = discoveryDraft?.answers
    ? Object.entries(discoveryDraft.answers)
        .map(([key, value]) => `${key}: ${value}`)
        .join(" • ")
    : "";
  const discoveryRecommendationNote = discoveryDraft?.recommendation?.service?.name
    ? `Recomendação da descoberta: ${discoveryDraft.recommendation.service.name}`
    : "";
  // Check if we were navigated here with openBooking state (e.g. from home services)
  const locationState = location.state as { openBooking?: boolean; serviceName?: string } | null;
  const [booking, setBooking] = useState(Boolean(discoveryDraft) || Boolean(locationState?.openBooking));
  const [step, setStep] = useState(discoveryDraft ? 2 : 0);
  const mappedMethod = useMemo(() => {
    const draftMethod = discoveryDraft?.answers?.method;
    if (!draftMethod) return "Quero recomendação";
    if (draftMethod === "Sem preferência" || draftMethod === "Tic Tac") {
      return "Quero recomendação";
    }
    return draftMethod;
  }, [discoveryDraft]);
  const [selected, setSelected] = useState<Record<string, string>>({
    service: locationState?.serviceName || "",
    method: mappedMethod,
    professional: "Primeira disponível",
    date: dates[0] || "",
    time: "09:00",
    payment: "Pix",
    notes: [discoveryRecommendationNote, discoveryNotes].filter(Boolean).join("\n"),
    couponCode: "",
    inventoryItemId: "",
  });
  // State for removing appointments
  const [removingApptId, setRemovingApptId] = useState<string | null>(null);
  const [confirmRemoveApptId, setConfirmRemoveApptId] = useState<string | null>(null);
  const [validatingCoupon, setValidatingCoupon] = useState(false);
  const [couponInfo, setCouponInfo] = useState<{ code: string; discount: number; total: number; error?: string } | null>(null);
  const [success, setSuccess] = useState(false);
  const [createdAppointment, setCreatedAppointment] = useState<Record<
    string,
    any
  > | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [loadingCheckout, setLoadingCheckout] = useState(false);

  useEffect(() => {
    if (success && createdAppointment?.payment_id) {
      setLoadingCheckout(true);
      setCheckoutUrl(null);
      apiFetch<{ url: string }>("/api/payments?resource=create-sumup-checkout", {
        method: "POST",
        body: JSON.stringify({ paymentId: createdAppointment.payment_id }),
      })
        .then((res) => {
          setCheckoutUrl(res.url);
        })
        .catch((err) => {
          console.error("Failed to generate checkout link", err);
        })
        .finally(() => {
          setLoadingCheckout(false);
        });
    }
  }, [success, createdAppointment]);
  const [toast, setToast] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [bookingError, setBookingError] = useState("");
  const [remoteAppointments, setRemoteAppointments] = useState<
    Array<Record<string, any>>
  >([]);
  const [rescheduleRequests, setRescheduleRequests] = useState<
    Array<Record<string, any>>
  >([]);
  const [busyRequestId, setBusyRequestId] = useState("");
  const [availability, setAvailability] = useState<Record<string, boolean>>({});
  const [resolvedProfessionalId, setResolvedProfessionalId] = useState("");
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [catalog, setCatalog] = useState<{
    services: Array<Record<string, any>>;
    professionals: Array<Record<string, any>>;
    inventoryItems?: Array<Record<string, any>>;
  }>({ services: [], professionals: [], inventoryItems: [] });
  const [reschedule, setReschedule] = useState<Record<string, any> | null>(
    null,
  );
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleTime, setRescheduleTime] = useState("09:00");
  const [rescheduleReason, setRescheduleReason] = useState("");
  const [rescheduleSlots, setRescheduleSlots] = useState<
    Record<string, boolean>
  >({});
  const [rescheduling, setRescheduling] = useState(false);
  const refreshAppointments = () =>
    apiFetch<{ appointments: Array<Record<string, any>> }>(
      "/api/data?resource=appointments",
    ).then((data) => {
      setRemoteAppointments(data.appointments);
      return data.appointments;
    });
  const refreshRescheduleRequests = () =>
    apiFetch<{ requests: Array<Record<string, any>> }>(
      "/api/data?resource=reschedule-requests",
    ).then((data) => {
      setRescheduleRequests(data.requests || []);
      return data.requests;
    });
  useEffect(() => {
    const init = async () => {
      await refreshAppointments();
      await refreshRescheduleRequests();
    };
    init().catch((error) => {
      console.error("Client appointments load error", error);
      setBookingError(
        error instanceof Error
          ? error.message
          : "Não foi possível carregar seus agendamentos.",
      );
    });
  }, []);
  useEffect(() => {
    apiFetch<{
      services: Array<Record<string, any>>;
      professionals: Array<Record<string, any>>;
      inventoryItems?: Array<Record<string, any>>;
    }>("/api/data?resource=bootstrap")
      .then((data) => {
        setCatalog({
          services: data.services || [],
          professionals: data.professionals || [],
          inventoryItems: data.inventoryItems || [],
        });
        const recommendedServiceId = String(
          discoveryDraft?.recommendedServiceId || discoveryDraft?.recommendation?.service?.id || "",
        );
        const recommendedInventoryItemId = String(
          discoveryDraft?.recommendedInventoryItemId || discoveryDraft?.recommendation?.inventoryItem?.id || "",
        );
        const recommendedService = data.services?.find((s: any) => s.id === recommendedServiceId);
        const defaultService =
          recommendedService?.name ||
          (discoveryDraft && data.services?.find((s: any) => s.name === "Avaliação personalizada")?.name) ||
          data.services?.[0]?.name ||
          "";
        const recommendedInventoryItem = recommendedService?.offer_inventory_items
          ? data.inventoryItems?.find((item: any) => item.id === recommendedInventoryItemId)
          : null;
        setSelected((current) => ({
          ...current,
          service: current.service || defaultService,
          professional: current.professional || "Primeira disponível",
          inventoryItemId: current.inventoryItemId || recommendedInventoryItem?.id || "",
        }));
      })
      .catch((error) => {
        console.error("Booking catalog error", error);
        setBookingError("Não foi possível carregar serviços e profissionais.");
      });
  }, []);
  useEffect(() => {
    const [day, month, year] = selected.date.split("/");
    const service = catalog.services.find(
      (item) => item.name === selected.service,
    );
    const professional = catalog.professionals.find(
      (item) => item.name === selected.professional,
    );
    if (!year || !service?.id || !selected.professional) {
      setAvailability({});
      setResolvedProfessionalId("");
      return;
    }
    const controller = new AbortController();
    setCheckingAvailability(true);
    setAvailability({});
    setResolvedProfessionalId("");
    const queryString = new URLSearchParams({
      resource: "availability",
      date: `${year}-${month}-${day}`,
      serviceId: String(service.id),
    });
    if (professional?.id)
      queryString.set("professionalId", String(professional.id));
    else queryString.set("firstAvailable", "true");
    apiFetch<{
      professional: { id: string };
      slots: Array<{ time: string; available: boolean }>;
    }>(
      `/api/data?${queryString}`,
      { signal: controller.signal },
    )
      .then((data) => {
        const nextAvailability = Object.fromEntries(
          data.slots.map((slot) => [slot.time, slot.available]),
        );
        setAvailability(nextAvailability);
        setResolvedProfessionalId(data.professional.id);
        const first = data.slots.find((slot) => slot.available);
        setSelected((current) =>
          nextAvailability[current.time] === true
            ? current
            : { ...current, time: first?.time || "" },
        );
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.error("Availability error", error);
        setAvailability({});
        setResolvedProfessionalId("");
      })
      .finally(() => {
        if (!controller.signal.aborted) setCheckingAvailability(false);
      });
    return () => controller.abort();
  }, [
    catalog.professionals,
    catalog.services,
    selected.date,
    selected.professional,
    selected.service,
  ]);
  useEffect(() => {
    if (!reschedule || !rescheduleDate) {
      setRescheduleSlots({});
      setRescheduleTime("");
      return;
    }
    const controller = new AbortController();
    setRescheduleSlots({});
    setRescheduleTime("");
    const params = new URLSearchParams({
      resource: "availability",
      date: rescheduleDate,
      serviceId: String(reschedule.service_id),
      professionalId: String(reschedule.professional_id),
    });
    apiFetch<{ slots: Array<{ time: string; available: boolean }> }>(
      `/api/data?${params}`,
      { signal: controller.signal },
    )
      .then((data) => {
        const slots = Object.fromEntries(
          data.slots.map((x) => [x.time, x.available]),
        );
        setRescheduleSlots(slots);
        const first = data.slots.find((x) => x.available);
        setRescheduleTime(first?.time || "");
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.error("Reschedule availability error", error);
        setRescheduleSlots({});
        setRescheduleTime("");
      });
    return () => controller.abort();
  }, [reschedule, rescheduleDate]);
  const next = async () => {
    if (step < 7) {
      setStep(step + 1);
      return;
    }
    setSaving(true);
    setBookingError("");
    try {
      if (!selected.service || !selected.professional)
        throw new Error("Escolha serviço e profissional.");
      const service = catalog.services.find(
        (item) => item.name === selected.service,
      );
      const selectedInventoryItem = service?.offer_inventory_items
        ? catalog.inventoryItems?.find((x) => x.id === selected.inventoryItemId)
        : null;
      if (service?.offer_inventory_items && !selected.inventoryItemId) {
        throw new Error("Selecione uma opção de variação do cabelo/mecha.");
      }
      
      let finalNotes = selected.notes;
      if (selectedInventoryItem) {
        const itemText = `[Item do Estoque Selecionado: Código ${selectedInventoryItem.code || "Sem código"} - Cor ${selectedInventoryItem.color || "N/A"} - Comprimento ${selectedInventoryItem.length_cm ? (String(selectedInventoryItem.length_cm).toLowerCase().includes('cm') ? selectedInventoryItem.length_cm : `${selectedInventoryItem.length_cm}cm`) : "N/A"} - Peso ${selectedInventoryItem.weight_grams || 0}g - Preço R$ ${Number(selectedInventoryItem.suggested_price || 0).toFixed(2)}]`;
        finalNotes = finalNotes ? `${itemText}\n${finalNotes}` : itemText;
      }
      const professional = catalog.professionals.find(
        (item) => item.name === selected.professional,
      );
      if (!service?.id)
        throw new Error(
          "Serviço inválido. Atualize a página e tente novamente.",
        );
      const professionalId = professional?.id || resolvedProfessionalId;
      if (!professionalId)
        throw new Error("Nenhuma profissional disponível foi encontrada.");
      if (!selected.time || availability[selected.time] !== true)
        throw new Error("Escolha um horário disponível.");
      const [day, month, year] = selected.date.split("/");
      const paymentMethod =
        selected.payment === "Cartão de crédito"
          ? "card"
          : selected.payment === "Pagar no local"
            ? "local"
            : "pix";
      const result = await apiFetch<{ appointment: Record<string, any> }>(
        "/api/data?resource=appointments",
        {
          method: "POST",
          body: JSON.stringify({
            serviceId: service.id,
            professionalId,
            startsAt: `${year}-${month}-${day}T${selected.time}:00-03:00`,
            notes: finalNotes,
            paymentMethod,
            intakeData: discoveryDraft || {},
            discoveryPhotoIds: Array.isArray(discoveryDraft?.photoIds)
              ? discoveryDraft.photoIds
              : [],
            couponCode: selected.couponCode || null,
            inventoryItemId: selected.inventoryItemId || null,
          }),
        },
      );
      setCreatedAppointment(result.appointment);
      sessionStorage.removeItem("carol_sol_discovery");
      await refreshAppointments();
      setBooking(false);
      setSuccess(true);
    } catch (error) {
      console.error("Booking create error", error);
      setBookingError(
        error instanceof Error ? error.message : "Não foi possível agendar.",
      );
    } finally {
      setSaving(false);
    }
  };
  const submitReschedule = async () => {
    if (!reschedule || !rescheduleDate || !rescheduleTime) return;
    setRescheduling(true);
    try {
      await apiFetch("/api/data?resource=reschedule-requests", {
        method: "POST",
        body: JSON.stringify({
          appointmentId: reschedule.id,
          startsAt: `${rescheduleDate}T${rescheduleTime}:00-03:00`,
          reason: rescheduleReason,
        }),
      });
      await refreshAppointments();
      await refreshRescheduleRequests();
      setReschedule(null);
      setToastMessage(
        "Reagendamento solicitado com sucesso. A profissional recebeu a solicitação.",
      );
      setToast(true);
    } catch (error) {
      console.error("Reschedule request error", error);
      setToastMessage(
        error instanceof Error
          ? error.message
          : "Não foi possível solicitar o reagendamento.",
      );
      setToast(true);
    } finally {
      setRescheduling(false);
      setTimeout(() => setToast(false), 3200);
    }
  };
  const handleRespondReschedule = async (requestId: string, action: "accept" | "reject") => {
    setBusyRequestId(requestId);
    try {
      await apiFetch("/api/data?resource=reschedule-requests", {
        method: "PATCH",
        body: JSON.stringify({ id: requestId, action }),
      });
      setToastMessage(
        action === "accept"
          ? "Novo horário confirmado com sucesso!"
          : "Sugestão de reagendamento recusada."
      );
      setToast(true);
      await refreshAppointments();
      await refreshRescheduleRequests();
    } catch (error) {
      console.error("Error responding to reschedule request", error);
      setToastMessage(
        error instanceof Error ? error.message : "Não foi possível responder."
      );
      setToast(true);
    } finally {
      setBusyRequestId("");
      setTimeout(() => setToast(false), 3200);
    }
  };
  const upcoming = remoteAppointments
    .filter(
      (item) =>
        !["completed", "cancelled", "no_show"].includes(String(item.status)),
    )
    .sort(
      (a, b) =>
        new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
    );
  const history = remoteAppointments
    .filter((item) =>
      ["completed", "cancelled", "no_show"].includes(String(item.status)),
    )
    .sort(
      (a, b) =>
        new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime(),
    );
  return (
    <div className="animate-fade-up">
      <Toast show={toast} message={toastMessage} />
      <PageHeader
        eyebrow="MINHA AGENDA"
        title="Seus próximos cuidados"
        subtitle="Acompanhe, remarque ou fale com a equipe quando precisar."
        action={
          <button
            onClick={() => {
              setBooking(true);
              setStep(0);
            }}
            className="btn-primary"
          >
            <Plus size={17} />
            Novo agendamento
          </button>
        }
      />
      <div className="space-y-4">
        {upcoming.length ? (
          upcoming.map((appointment, index) => (
            <section
              key={appointment.id}
              className={`${index === 0 ? "hair-gradient text-white shadow-premium" : "surface"} relative overflow-hidden rounded-[28px] p-6 sm:p-8`}
            >
              <div className="relative grid gap-6 lg:grid-cols-[1fr_auto]">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      tone={
                        appointment.status === "confirmed" ? "green" : "gold"
                      }
                    >
                      {clientAppointmentStatus[appointment.status] ||
                        String(appointment.status).toUpperCase()}
                    </Badge>
                    <span
                      className={
                        index === 0
                          ? "text-[11px] text-white/45"
                          : "text-[11px] text-stone-400"
                      }
                    >
                      Código{" "}
                      {appointment.booking_code ||
                        `CS${String(appointment.id).slice(0, 6).toUpperCase()}`}
                    </span>
                  </div>
                  <h2 className="mt-4 font-display text-4xl font-semibold">
                    {appointment.service}
                  </h2>
                  <div
                    className={`mt-5 flex flex-wrap gap-x-6 gap-y-3 text-xs ${index === 0 ? "text-white/65" : "text-stone-500"}`}
                  >
                    <span className="flex items-center gap-2">
                      <CalendarDays size={15} className="text-champagne" />
                      {appointment.date}, {appointment.time}
                    </span>
                    <span className="flex items-center gap-2">
                      <Clock3 size={15} className="text-champagne" />
                      {appointment.duration}
                    </span>
                    <span className="flex items-center gap-2">
                      <MapPin size={15} className="text-champagne" />
                      {appointment.location || "Carol Sol"}
                    </span>
                  </div>
                  <div className="mt-6 flex items-center gap-3">
                    <Avatar
                      src={appointment.professional_avatar_url}
                      name={appointment.professional}
                    />
                    <div>
                      <div className="text-sm font-bold">
                        {appointment.professional}
                      </div>
                      <div
                        className={
                          index === 0
                            ? "text-[11px] text-white/45"
                            : "text-[11px] text-stone-400"
                        }
                      >
                        Especialista em extensões
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex min-w-[210px] flex-col justify-end gap-3">
                  <button
                    disabled={appointment.status === "reschedule_requested"}
                    onClick={() => {
                      setReschedule(appointment);
                      setRescheduleDate(
                        new Date(Date.now() + 86400000)
                          .toISOString()
                          .slice(0, 10),
                      );
                      setRescheduleReason("");
                    }}
                    className={
                      index === 0
                        ? "btn-gold disabled:opacity-50"
                        : "btn-primary disabled:opacity-50"
                    }
                  >
                    {appointment.status === "reschedule_requested"
                      ? "Aguardando resposta"
                      : "Remarcar"}
                  </button>
                  {whatsappUrl(appointment.professional_phone) ? (
                    <a
                      href={whatsappUrl(appointment.professional_phone)}
                      target="_blank"
                      rel="noreferrer"
                      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border px-4 text-xs font-bold ${index === 0 ? "border-white/15 bg-white/5" : "border-black/10 bg-warm"}`}
                    >
                      <MessageCircle size={16} />
                      Falar no WhatsApp
                    </a>
                  ) : (
                    <span
                      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border px-4 text-xs font-bold opacity-60 ${index === 0 ? "border-white/15 bg-white/5" : "border-black/10 bg-warm"}`}
                    >
                      <MessageCircle size={16} />
                      WhatsApp indisponível
                    </span>
                  )}
                </div>
              </div>

              {/* Reschedule alert section */}
              {(() => {
                const activeRequest = rescheduleRequests.find(
                  (r) => r.appointment_id === appointment.id && ["pending", "suggested"].includes(r.status)
                );
                if (!activeRequest) return null;

                if (activeRequest.status === "suggested") {
                  const prettySuggestedTime = new Date(activeRequest.suggested_starts_at).toLocaleString("pt-BR", {
                    dateStyle: "short",
                    timeStyle: "short",
                  });
                  return (
                    <div
                      className={`mt-6 rounded-2xl border p-4 text-xs animate-fade-down ${
                        index === 0
                          ? "border-white/20 bg-white/10 text-white"
                          : "border-champagne/20 bg-champagne/[.04] text-stone-800"
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        <Sparkles size={16} className="text-champagne shrink-0 mt-0.5" />
                        <div className="flex-1 space-y-1">
                          <p className="font-bold">
                            Sugestão de novo horário recebida:
                          </p>
                          <p className="font-semibold text-[13px]">
                            {prettySuggestedTime}
                          </p>
                          {activeRequest.response_note && (
                            <p className={`text-[11px] leading-relaxed italic ${index === 0 ? "text-white/70" : "text-stone-500"}`}>
                              "{activeRequest.response_note}"
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2 justify-end">
                        <button
                          type="button"
                          disabled={busyRequestId === activeRequest.id}
                          onClick={() => handleRespondReschedule(activeRequest.id, "reject")}
                          className={`rounded-xl px-4 py-2 text-[11px] font-bold transition disabled:opacity-50 ${
                            index === 0
                              ? "border border-white/20 bg-white/5 text-white hover:bg-white/10"
                              : "border border-black/10 bg-white text-stone-600 hover:bg-black/5"
                          }`}
                        >
                          Recusar Sugestão
                        </button>
                        <button
                          type="button"
                          disabled={busyRequestId === activeRequest.id}
                          onClick={() => handleRespondReschedule(activeRequest.id, "accept")}
                          className={`rounded-xl px-4 py-2 text-[11px] font-bold transition disabled:opacity-50 ${
                            index === 0
                              ? "bg-white text-ink hover:bg-white/95"
                              : "btn-primary !min-h-0 !py-2"
                          }`}
                        >
                          Confirmar Novo Horário
                        </button>
                      </div>
                    </div>
                  );
                }

                if (activeRequest.status === "pending") {
                  return (
                    <div
                      className={`mt-5 flex gap-2.5 rounded-2xl border p-4 text-[11px] leading-relaxed ${
                        index === 0
                          ? "border-white/10 bg-white/5 text-white/80"
                          : "border-black/5 bg-warm/40 text-stone-500"
                      }`}
                    >
                      <Clock3 size={15} className="shrink-0 mt-0.5 text-champagne" />
                      <span>
                        Você solicitou reagendamento para{" "}
                        <b>
                          {new Date(activeRequest.requested_starts_at).toLocaleString("pt-BR", {
                            dateStyle: "short",
                            timeStyle: "short",
                          })}
                        </b>
                        . Aguardando retorno da profissional...
                      </span>
                    </div>
                  );
                }
                return null;
              })()}
            </section>
          ))
        ) : (
          <section className="surface p-8 text-center">
            <CalendarDays className="mx-auto text-champagne" />
            <h2 className="mt-4 font-display text-3xl font-semibold">
              Nenhum agendamento futuro
            </h2>
            <p className="muted mt-2">
              Escolha um serviço e encontre o melhor horário para você.
            </p>
          </section>
        )}
      </div>
      {/* History + Sidebar */}
      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_340px]">
        <section className="surface p-6">
          <SectionHeading title="Histórico" />
          {history.length ? (
            <div className="space-y-2">
              {history.map((item) => (
                <div
                  key={item.id}
                  className={`flex items-center gap-4 rounded-2xl border p-4 ${
                    item.status === "completed"
                      ? "border-emerald-100 bg-emerald-50/30"
                      : item.status === "no_show"
                        ? "border-amber-100 bg-amber-50/30"
                        : "border-rose-100 bg-rose-50/20"
                  }`}
                >
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-warm text-champagne">
                    <CalendarDays size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-bold">
                      {item.service}
                    </div>
                    <div className="mt-1 text-[10px] text-stone-400">
                      {item.date} • {item.professional}
                    </div>
                  </div>
                  <span className="text-xs font-bold">{item.value}</span>
                  <Badge tone={item.status === "completed" ? "green" : "rose"}>
                    {item.status === "completed"
                      ? "Finalizado"
                      : item.status === "no_show"
                        ? "Faltou"
                        : "Cancelado"}
                  </Badge>
                  <button
                    type="button"
                    title="Remover agendamento"
                    disabled={removingApptId === item.id}
                    onClick={() => setConfirmRemoveApptId(item.id)}
                    className="rounded-xl border border-rose-200 bg-rose-50 p-2 text-rose-400 hover:bg-rose-100 transition disabled:opacity-40"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl bg-warm p-6 text-center text-xs text-stone-400">
              Nenhum atendimento concluído.
            </div>
          )}
        </section>
        {/* Smart Alerts Sidebar */}
        <aside className="space-y-4">
          <div className="surface p-6">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xl">✨</span>
              <h3 className="font-display text-xl font-semibold">Dicas para você</h3>
            </div>
            <div className="space-y-3 text-xs text-stone-600">
              <div className="rounded-2xl bg-purple-50 border border-purple-100 p-3">
                <p className="font-bold text-purple-800">💆‍♀️ Cronograma capilar</p>
                <p className="mt-1 text-purple-700">Manutenção regular preserva o investimento e a saúde dos seus fios.</p>
              </div>
              <div className="rounded-2xl bg-amber-50 border border-amber-100 p-3">
                <p className="font-bold text-amber-800">💧 Hidratação profunda</p>
                <p className="mt-1 text-amber-700">Recomendamos hidratação semanal para cabelos com extensões.</p>
              </div>
              <div className="rounded-2xl bg-emerald-50 border border-emerald-100 p-3">
                <p className="font-bold text-emerald-800">✅ Nova manutenção</p>
                <p className="mt-1 text-emerald-700">Extensões precisam de manutenção a cada 45–60 dias para manter o resultado perfeito.</p>
                <button
                  onClick={() => { setBooking(true); setStep(0); }}
                  className="mt-3 text-[11px] font-bold text-emerald-700 hover:underline"
                >
                  Agendar manutenção →
                </button>
              </div>
            </div>
          </div>
          <div className="surface p-6">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-amber-50 text-amber-700 mb-3">
              <Info size={18} />
            </div>
            <h3 className="font-display text-xl font-semibold">Política tranquila</h3>
            <p className="muted mt-2 text-xs">
              Remarque sem custo até 24 horas antes. Cancelamentos após esse prazo
              podem reter 50% do sinal.
            </p>
          </div>
        </aside>
      </div>
      {/* Confirm remove appointment modal */}
      <Modal
        open={!!confirmRemoveApptId}
        onClose={() => !removingApptId && setConfirmRemoveApptId(null)}
        title="Remover agendamento"
      >
        <div className="space-y-4">
          <p className="text-sm text-stone-600">
            Tem certeza que deseja remover este agendamento do seu histórico?
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!!removingApptId}
              onClick={() => setConfirmRemoveApptId(null)}
              className="btn-secondary flex-1"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={!!removingApptId}
              onClick={async () => {
                if (!confirmRemoveApptId) return;
                setRemovingApptId(confirmRemoveApptId);
                try {
                  await apiFetch("/api/data?resource=appointments", {
                    method: "DELETE",
                    body: JSON.stringify({ id: confirmRemoveApptId }),
                  });
                  await refreshAppointments();
                  setToastMessage("Agendamento removido.");
                  setToast(true);
                } catch (err) {
                  console.error("Remove appointment error", err);
                  setToastMessage(err instanceof Error ? err.message : "Não foi possível remover.");
                  setToast(true);
                } finally {
                  setRemovingApptId(null);
                  setConfirmRemoveApptId(null);
                  setTimeout(() => setToast(false), 2400);
                }
              }}
              className="btn-primary flex-1 bg-rose-600 hover:bg-rose-700 border-transparent"
            >
              {removingApptId ? "Removendo..." : "Confirmar"}
            </button>
          </div>
        </div>
      </Modal>
      <Modal
        open={booking}
        onClose={() => setBooking(false)}
        title="Novo agendamento"
      >
        <div className="mb-5 flex gap-1">
          {bookingSteps.map((_, i) => (
            <span
              key={i}
              className={`h-1 flex-1 rounded-full ${i <= step ? "bg-champagne" : "bg-stone-200"}`}
            />
          ))}
        </div>
        <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-stone-400">
          Etapa {step + 1} de 8 • {bookingSteps[step]}
        </div>
        <BookingStep
          step={step}
          selected={selected}
          setSelected={setSelected}
          availability={availability}
          checkingAvailability={checkingAvailability}
          catalog={catalog}
          dateOptions={dates}
          couponInfo={couponInfo}
          setCouponInfo={setCouponInfo}
          validatingCoupon={validatingCoupon}
          setValidatingCoupon={setValidatingCoupon}
        />
        {bookingError && (
          <div className="mt-4 rounded-2xl bg-rose-50 p-3 text-xs font-semibold text-rose-700">
            {bookingError}
          </div>
        )}
        <div className="mt-7 flex justify-between border-t border-black/[.06] pt-5">
          <button
            onClick={() => (step === 0 ? setBooking(false) : setStep(step - 1))}
            className="btn-secondary"
          >
            <ArrowLeft size={16} />
            Voltar
          </button>
          <button
            onClick={next}
            disabled={
              saving ||
              (step === 1 && catalog.services.find((s) => s.name === selected.service)?.offer_inventory_items && !selected.inventoryItemId) ||
              (step === 4 && checkingAvailability) ||
              (step === 4 && availability[selected.time] === false) ||
              !selected.service ||
              !selected.date ||
              !selected.time
            }
            className="btn-primary disabled:opacity-50"
          >
            {saving
              ? "Confirmando…"
              : step === 7
                ? "Confirmar agendamento"
                : "Continuar"}
            <ArrowRight size={16} />
          </button>
        </div>
      </Modal>
      <Modal
        open={!!reschedule}
        onClose={() => setReschedule(null)}
        title="Solicitar reagendamento"
      >
        <div className="rounded-2xl bg-amber-50 p-4 text-[11px] leading-relaxed text-amber-900">
          <b>Política de reagendamento</b>
          <br />
          Solicitações com menos de 24 horas podem depender de análise e
          retenção parcial do sinal. A data só muda após a profissional aceitar.
        </div>
        <div className="mt-5">
          <label className="text-xs font-bold">
            Nova data
            <input
              type="date"
              min={new Date().toISOString().slice(0, 10)}
              value={rescheduleDate}
              onChange={(e) => setRescheduleDate(e.target.value)}
              className="field mt-2"
            />
          </label>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {Object.entries(rescheduleSlots).map(([time, available]) => (
            <button
              key={time}
              disabled={!available}
              onClick={() => setRescheduleTime(time)}
              className={`rounded-xl border p-3 text-xs font-bold disabled:opacity-35 ${rescheduleTime === time ? "border-champagne bg-champagne/10" : "border-black/10"}`}
            >
              {time}
            </button>
          ))}
        </div>
        {rescheduleDate && !Object.keys(rescheduleSlots).length && (
          <p className="mt-4 rounded-2xl bg-rose-50 p-4 text-xs font-semibold text-rose-700">
            Nenhum horário disponível nessa data.
          </p>
        )}
        <label className="mt-4 block text-xs font-bold">
          Motivo ou observação
          <textarea
            value={rescheduleReason}
            onChange={(e) => setRescheduleReason(e.target.value)}
            className="field mt-2 min-h-20 py-3"
          />
        </label>
        <button
          disabled={rescheduling || !rescheduleSlots[rescheduleTime]}
          onClick={submitReschedule}
          className="btn-primary mt-5 w-full disabled:opacity-50"
        >
          {rescheduling ? "Enviando…" : "Enviar solicitação"}
        </button>
      </Modal>
      {(() => {
        const service = catalog.services.find((s) => s.name === selected.service);
        const selectedInventoryItem = service?.offer_inventory_items
          ? catalog.inventoryItems?.find((x) => x.id === selected.inventoryItemId)
          : null;
        const servicePrice = selectedInventoryItem
          ? Number(selectedInventoryItem.suggested_price || 0)
          : (service ? Number(service.base_price || 0) : 0);
        const discount = couponInfo?.code === selected.couponCode ? couponInfo.discount : 0;
        const finalPrice = Math.max(0, servicePrice - discount);
        const finalDeposit = bookingDepositAmount(service, finalPrice);

        return (
          <Modal open={success} onClose={() => setSuccess(false)}>
            <div className="py-5 text-center">
              <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-emerald-50 text-emerald-600">
                <Check size={36} />
              </div>
              <h2 className="mt-5 font-display text-4xl font-semibold">
                Solicitação enviada com sucesso.
              </h2>
              <p className="muted mx-auto mt-3 max-w-sm">
                Seu pedido foi salvo no sistema para {selected.date} às{" "}
                {selected.time}. Acompanhe o status até a confirmação final.
              </p>
              <div className="mt-6 rounded-2xl bg-warm p-4 text-left text-xs space-y-1">
                <div className="flex justify-between py-1 border-b border-black/5">
                  <span className="text-stone-500">Código</span>
                  <b>{createdAppointment?.booking_code || "Gerado no sistema"}</b>
                </div>
                <div className="flex justify-between py-1 border-b border-black/5">
                  <span className="text-stone-500">Serviço</span>
                  <b>{createdAppointment?.service || selected.service}</b>
                </div>
                <div className="flex justify-between py-1 border-b border-black/5">
                  <span className="text-stone-500">Profissional</span>
                  <b>{createdAppointment?.professional || selected.professional}</b>
                </div>
                <div className="flex justify-between py-1 border-b border-black/5">
                  <span className="text-stone-500">Status</span>
                  <b>
                    {clientAppointmentStatus[String(createdAppointment?.status)] ||
                      createdAppointment?.status}
                  </b>
                </div>

                {finalDeposit > 0 && (
                  <div className="mt-4 pt-3 text-xs space-y-1">
                    <div className="flex justify-between">
                      <span className="text-stone-500">Valor do Serviço</span>
                      <span>{money(servicePrice)}</span>
                    </div>
                    {discount > 0 && (
                      <div className="flex justify-between text-emerald-600 font-semibold">
                        <span>Desconto</span>
                        <span>-{money(discount)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-bold text-champagne pt-1 border-t border-dashed border-stone-200">
                      <span>Sinal (Pagar Agora)</span>
                      <span>{money(finalDeposit)}</span>
                    </div>
                    <div className="flex justify-between text-stone-500">
                      <span>Restante no local</span>
                      <span>{money(finalPrice - finalDeposit)}</span>
                    </div>
                  </div>
                )}
              </div>

              {finalDeposit > 0 && (
                <div className="mt-6">
                  {loadingCheckout ? (
                    <div className="text-xs text-stone-400 py-3">Gerando checkout seguro SumUp...</div>
                  ) : checkoutUrl ? (
                    <a
                      href={checkoutUrl}
                      className="btn-primary w-full block text-center py-3"
                    >
                      Pagar Sinal (SumUp)
                    </a>
                  ) : (
                    <div className="text-xs text-rose-600 font-semibold py-2">
                      Não foi possível obter o link de pagamento.
                    </div>
                  )}
                </div>
              )}

              <button
                onClick={() => setSuccess(false)}
                className="btn-secondary mt-4 w-full"
              >
                Acompanhar na agenda
              </button>
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}

function BookingStep({
  step,
  selected,
  setSelected,
  availability,
  checkingAvailability,
  catalog,
  dateOptions,
  couponInfo,
  setCouponInfo,
  validatingCoupon,
  setValidatingCoupon,
}: {
  step: number;
  selected: Record<string, string>;
  setSelected: (x: Record<string, string>) => void;
  availability: Record<string, boolean>;
  checkingAvailability: boolean;
  catalog: {
    services: Array<Record<string, any>>;
    professionals: Array<Record<string, any>>;
    inventoryItems?: Array<Record<string, any>>;
  };
  dateOptions: string[];
  couponInfo: { code: string; discount: number; total: number; error?: string } | null;
  setCouponInfo: (x: { code: string; discount: number; total: number; error?: string } | null) => void;
  validatingCoupon: boolean;
  setValidatingCoupon: (x: boolean) => void;
}) {
  const choose = (k: string, v: string) => setSelected({ ...selected, [k]: v });
  const service = catalog.services.find((s) => s.name === selected.service);
  const slots = Object.keys(availability);
  const matchingItems = (catalog.inventoryItems || []).filter(
    (item) => item.category_id === service?.category_id && 
              (!service?.hair_method_id || item.hair_method_id === service?.hair_method_id)
  );
  const configs: { title: string; key: string; options: string[] }[] = [
    {
      title: "Qual serviço você procura?",
      key: "service",
      options: catalog.services.map((s) => String(s.name)),
    },
    {
      title: service?.offer_inventory_items ? "Selecione o tipo de cabelo" : "Qual método deseja avaliar?",
      key: service?.offer_inventory_items ? "inventoryItemId" : "method",
      options: service?.offer_inventory_items 
        ? matchingItems.map((item) => item.id) 
        : ["Quero recomendação", "Fita Adesiva", "Microlink", "Queratina"],
    },
    {
      title: "Escolha sua especialista",
      key: "professional",
      options: [
        "Primeira disponível",
        ...catalog.professionals.map((p) => String(p.name)),
      ],
    },
    { title: "Escolha a melhor data", key: "date", options: dateOptions },
    { title: "Horários disponíveis", key: "time", options: slots },
  ];
  if (step <= 4) {
    const c = configs[step];
    return (
      <div className="mt-5">
        <h3 className="font-display text-2xl font-semibold">{c.title}</h3>
        {step === 4 && checkingAvailability && (
          <p className="mt-2 text-[10px] font-semibold text-stone-400">
            Consultando a agenda em tempo real…
          </p>
        )}
        {!c.options.length ? (
          <p className="mt-4 rounded-2xl bg-rose-50 p-4 text-xs font-semibold text-rose-700">
            {service?.offer_inventory_items && step === 1 
              ? "Nenhuma opção de cabelo/mecha disponível no estoque para este serviço." 
              : "Nenhuma opção disponível no momento."}
          </p>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-2">
            {c.options.map((o) => {
              const item = service?.offer_inventory_items && step === 1 
                ? catalog.inventoryItems?.find((x) => x.id === o) 
                : null;
              if (item) {
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setSelected({
                        ...selected,
                        inventoryItemId: item.id,
                        method: service?.method || selected.method
                      });
                    }}
                    className={`col-span-2 flex flex-col justify-between rounded-2xl border p-4 text-left transition ${selected.inventoryItemId === item.id ? "border-champagne bg-champagne/10 text-[#8d6929]" : "border-black/[.07] bg-white"}`}
                  >
                    <div className="flex justify-between items-start w-full">
                      <div>
                        <span className="font-bold text-xs block">
                          {item.color} {item.shade ? `/ ${item.shade}` : ""}
                        </span>
                        <span className="text-[10px] text-stone-500 mt-1 block">
                          {item.length_cm ? (String(item.length_cm).toLowerCase().includes('cm') ? item.length_cm : `${item.length_cm}cm`) : "—"} • {item.weight_grams ? `${item.weight_grams}g` : "—"}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="font-bold text-xs text-ink block">
                          {Number(item.suggested_price || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                        </span>
                        <span className="text-[10px] text-stone-400 block mt-0.5">
                          Disponível: {item.quantity} un
                        </span>
                      </div>
                    </div>
                  </button>
                );
              }
              const unavailable = step === 4 && availability[o] === false;
              return (
                <button
                  key={o}
                  disabled={unavailable || checkingAvailability}
                  onClick={() => choose(c.key, o)}
                  className={`rounded-2xl border p-3 text-left text-xs font-semibold transition disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-300 ${selected[c.key] === o && !unavailable ? "border-champagne bg-champagne/10 text-[#8d6929]" : "border-black/[.07] bg-white"}`}
                >
                  {o}
                  {unavailable && (
                    <span className="mt-1 block text-[9px] font-medium">
                      Indisponível
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }
  if (step === 5)
    return (
      <div className="mt-5">
        <h3 className="font-display text-2xl font-semibold">
          Alguma observação?
        </h3>
        <textarea
          value={selected.notes || ""}
          onChange={(e) => choose("notes", e.target.value)}
          className="field mt-4 min-h-32 py-4"
          placeholder="Conte sobre sensibilidade, química recente ou preferência de resultado…"
        />
      </div>
    );
  if (step === 6) {
    const selectedInventoryItem = service?.offer_inventory_items
      ? catalog.inventoryItems?.find((x) => x.id === selected.inventoryItemId)
      : null;
    const servicePrice = selectedInventoryItem
      ? Number(selectedInventoryItem.suggested_price || 0)
      : (service ? Number(service.base_price || 0) : 0);
    const discount = couponInfo?.code === selected.couponCode ? couponInfo.discount : 0;
    const finalPrice = Math.max(0, servicePrice - discount);
    const finalDeposit = bookingDepositAmount(service, finalPrice);

    return (
      <div className="mt-5">
        <h3 className="font-display text-2xl font-semibold">
          Revise os detalhes
        </h3>
        <div className="mt-4 space-y-3 rounded-2xl bg-warm p-5 text-xs">
          {[
            ["Serviço", selected.service],
            service?.offer_inventory_items && selectedInventoryItem ? [
              "Cabelo/Mecha",
              `${selectedInventoryItem.color} ${selectedInventoryItem.shade ? `/ ${selectedInventoryItem.shade}` : ""} - ${selectedInventoryItem.length_cm ? (String(selectedInventoryItem.length_cm).toLowerCase().includes('cm') ? selectedInventoryItem.length_cm : `${selectedInventoryItem.length_cm}cm`) : "—"} - ${selectedInventoryItem.weight_grams ? `${selectedInventoryItem.weight_grams}g` : "—"}`
            ] : null,
            ["Método", selected.method],
            ["Profissional", selected.professional],
            ["Data e hora", `${selected.date} às ${selected.time}`],
            [
              "Estimativa original",
              service ? money(servicePrice) : "A confirmar",
            ],
            discount > 0 ? ["Desconto", `- ${money(discount)}`] : null,
            [
              "Estimativa final",
              service ? money(finalPrice) : "A confirmar",
            ],
            [
              "Sinal",
              service ? money(finalDeposit) : "A confirmar",
            ],
          ].filter(Boolean).map((x) => (
            <div key={x![0]} className="flex justify-between gap-4">
              <span className="text-stone-500">{x![0]}</span>
              <b className="text-right">{x![1]}</b>
            </div>
          ))}
        </div>

        <div className="mt-4 flex gap-2">
          <input
            value={selected.couponCode || ""}
            onChange={(e) => choose("couponCode", e.target.value.toUpperCase())}
            placeholder="Cupom de desconto"
            className="field flex-1"
          />
          <button
            type="button"
            onClick={async () => {
              if (!selected.couponCode) return;
              setValidatingCoupon(true);
              try {
                const res = await apiFetch<{ valid: boolean; discount: number; total: number; error?: string }>(
                  `/api/data?resource=validate-coupon&code=${encodeURIComponent(selected.couponCode)}&serviceId=${service?.id}&amount=${service?.base_price}`
                );
                if (res.valid) {
                  setCouponInfo({ code: selected.couponCode, discount: res.discount, total: res.total });
                } else {
                  setCouponInfo({
                    code: selected.couponCode,
                    discount: 0,
                    total: service?.base_price || 0,
                    error: res.error || "Cupom inválido.",
                  });
                }
              } catch (err) {
                setCouponInfo({
                  code: selected.couponCode,
                  discount: 0,
                  total: service?.base_price || 0,
                  error: "Erro ao validar cupom.",
                });
              } finally {
                setValidatingCoupon(false);
              }
            }}
            disabled={validatingCoupon || !selected.couponCode}
            className="btn-secondary !min-h-12 !px-4"
          >
            {validatingCoupon ? "Validando..." : "Aplicar"}
          </button>
        </div>
        {couponInfo?.code === selected.couponCode && (
          <div className="mt-2 text-xs">
            {couponInfo.error ? (
              <span className="text-rose-600 font-semibold">{couponInfo.error}</span>
            ) : (
              <span className="text-emerald-600 font-semibold">
                Cupom aplicado! Desconto: {money(couponInfo.discount)} (Preço final: {money(couponInfo.total)})
              </span>
            )}
          </div>
        )}

        <p className="mt-4 text-[10px] leading-relaxed text-stone-400">
          Ao confirmar, você concorda com a política de cancelamento e
          reagendamento.
        </p>
      </div>
    );
  }
  const selectedInventoryItem = service?.offer_inventory_items
    ? catalog.inventoryItems?.find((x) => x.id === selected.inventoryItemId)
    : null;
  const servicePrice = selectedInventoryItem
    ? Number(selectedInventoryItem.suggested_price || 0)
    : (service ? Number(service.base_price || 0) : 0);
  const discount = couponInfo?.code === selected.couponCode ? couponInfo.discount : 0;
  const finalPrice = Math.max(0, servicePrice - discount);
  const finalDeposit = bookingDepositAmount(service, finalPrice);

  const paymentOptions: Array<{
    name: string;
    icon: React.ComponentType<{ size?: string | number }>;
  }> = [
    { name: "Pix", icon: QrCode },
    { name: "Cartão de crédito", icon: CreditCard },
    { name: "Pagar no local", icon: WalletIcon },
  ];
  return (
    <div className="mt-5">
      <h3 className="font-display text-2xl font-semibold">
        Como deseja pagar o sinal?
      </h3>
      <p className="muted mt-2">
        Valor do sinal:{" "}
        {service ? money(finalDeposit) : "a confirmar"}.
        O restante é pago no atendimento.
      </p>
      <div className="mt-4 space-y-2">
        {paymentOptions.map(({ name, icon: Icon }) => (
          <button
            key={name}
            onClick={() => choose("payment", name)}
            className={`flex w-full items-center gap-3 rounded-2xl border p-4 text-xs font-bold ${selected.payment === name ? "border-champagne bg-champagne/10" : "border-black/[.07]"}`}
          >
            <Icon size={18} />
            {name}
            {selected.payment === name && (
              <Check className="ml-auto text-champagne" size={16} />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function WalletIcon({ size = 18 }: { size?: string | number }) {
  return <CreditCard size={size} />;
}
