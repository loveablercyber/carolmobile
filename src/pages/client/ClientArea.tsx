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
  Modal,
  PageHeader,
  SectionHeading,
  Toast,
} from "../../components/ui";
import { images, professionals, services } from "../../data/mock";
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

export function ClientArea() {
  const location = useLocation();
  let page = <ClientHomePage />;
  if (location.pathname.includes("/agendamentos/"))
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
  return <AppShell role="cliente">{page}</AppShell>;
}

function ClientHome() {
  const navigate = useNavigate();
  return (
    <div className="animate-fade-up">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="text-sm text-stone-500">Domingo, 21 de junho</div>
          <h1 className="font-display text-3xl font-semibold">
            Olá, Juliana.{" "}
            <span className="inline-block origin-bottom-right animate-[wave_1s_ease_1]">
              👋
            </span>
          </h1>
        </div>
        <Badge tone="gold">Nível Gold</Badge>
      </div>
      <section className="relative min-h-[500px] overflow-hidden rounded-[30px] bg-ink shadow-premium lg:min-h-[560px]">
        <img
          src={images.hero}
          alt="Mulher com cabelo longo e volumoso"
          className="absolute inset-0 h-full w-full object-cover object-[center_25%] opacity-90"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/30 to-transparent" />
        <div className="relative z-10 flex min-h-[500px] max-w-xl flex-col justify-end p-7 text-white sm:p-10 lg:min-h-[560px] lg:justify-center lg:p-16">
          <div className="eyebrow mb-4">SUA MELHOR VERSÃO</div>
          <h2 className="font-display text-5xl font-semibold leading-[.88] sm:text-6xl lg:text-7xl">
            Transforme
            <br />
            seu visual.
          </h2>
          <p className="mt-5 max-w-sm text-sm leading-relaxed text-white/70">
            Mega Hair Premium com resultado natural, técnica impecável e cuidado
            contínuo.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <button
              onClick={() => navigate("/cliente/agenda")}
              className="btn-gold"
            >
              <CalendarDays size={17} />
              Agendar avaliação
            </button>
            <button
              onClick={() => navigate("/cliente/descobrir")}
              className="inline-flex min-h-12 items-center gap-2 rounded-2xl border border-white/20 bg-white/10 px-5 text-sm font-bold backdrop-blur"
            >
              Descobrir meu método <ArrowRight size={17} />
            </button>
          </div>
        </div>
        <div className="absolute bottom-7 right-7 hidden rounded-2xl border border-white/15 bg-white/10 p-4 text-white backdrop-blur-xl sm:block">
          <div className="flex items-center gap-2 text-xs font-semibold">
            <Play size={15} fill="white" />
            Conheça nossa experiência
          </div>
        </div>
      </section>
      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <button
          onClick={() => navigate("/cliente/agenda")}
          className="surface flex items-center gap-4 p-5 text-left transition hover:-translate-y-1"
        >
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-champagne/15 text-champagne">
            <CalendarDays />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
              Próxima manutenção
            </div>
            <div className="mt-1 text-sm font-bold">24/06 às 14:00</div>
            <div className="mt-1 text-[11px] text-stone-500">Faltam 3 dias</div>
          </div>
          <ChevronRight className="ml-auto text-stone-300" size={18} />
        </button>
        <button
          onClick={() => navigate("/cliente/beneficios")}
          className="surface flex items-center gap-4 p-5 text-left transition hover:-translate-y-1"
        >
          <div className="progress-ring grid h-12 w-12 shrink-0 place-items-center rounded-full">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-white text-xs font-bold">
              74%
            </div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
              Clube Carol Sol
            </div>
            <div className="mt-1 text-sm font-bold">850 pontos</div>
            <div className="mt-1 text-[11px] text-stone-500">
              +150 para nova recompensa
            </div>
          </div>
        </button>
        <button
          onClick={() => navigate("/cliente/descobrir")}
          className="hair-gradient flex items-center gap-4 rounded-[24px] p-5 text-left text-white shadow-card transition hover:-translate-y-1"
        >
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/10 text-champagne">
            <Camera />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-white/45">
              Avaliação online
            </div>
            <div className="mt-1 text-sm font-bold">Envie suas fotos</div>
            <div className="mt-1 text-[11px] text-white/50">
              Receba uma análise inicial
            </div>
          </div>
          <ArrowRight className="ml-auto text-champagne" size={18} />
        </button>
      </div>

      <section className="mt-10">
        <SectionHeading
          title="Mais procurados"
          link="Ver todos"
          onClick={() => navigate("/cliente/servicos")}
        />
        <div className="no-scrollbar -mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-3 sm:mx-0 sm:px-0">
          {services.slice(0, 4).map((s) => (
            <article
              key={s.id}
              className="surface min-w-[260px] snap-start overflow-hidden sm:min-w-[300px]"
            >
              <div className="relative h-48">
                <img
                  src={s.image}
                  alt={s.name}
                  className="h-full w-full object-cover"
                />
                {s.tag && (
                  <span className="absolute left-4 top-4">
                    <Badge tone="black">{s.tag}</Badge>
                  </span>
                )}
                <button className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full bg-white/85">
                  <Heart size={16} />
                </button>
              </div>
              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-display text-2xl font-semibold">
                      {s.name}
                    </h3>
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-stone-500">
                      {s.description}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs font-bold text-champagne">
                    a partir de
                    <br />
                    {money(s.price)}
                  </span>
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-black/[.05] pt-4 text-[11px] text-stone-500">
                  <span className="flex items-center gap-1">
                    <Clock3 size={13} />
                    {s.duration}
                  </span>
                  <button
                    onClick={() => navigate("/cliente/agenda")}
                    className="font-bold text-ink"
                  >
                    Agendar <ArrowRight className="inline" size={13} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-10 grid gap-5 lg:grid-cols-[1.25fr_.75fr]">
        <div>
          <SectionHeading title="Transformações reais" link="Ver galeria" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Transformation
              image={images.brunette}
              label="Fita Adesiva • 60 cm"
            />
            <Transformation image={images.blonde} label="Microlink • 55 cm" />
          </div>
        </div>
        <div>
          <SectionHeading title="Sua especialista favorita" />
          <div className="hair-gradient relative h-[338px] overflow-hidden rounded-[28px] p-6 text-white">
            <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black to-transparent" />
            <img
              src={professionals[0].photo}
              alt={professionals[0].name}
              className="absolute inset-0 h-full w-full object-cover opacity-70"
            />
            <div className="absolute bottom-6 left-6 right-6">
              <Badge tone="gold">★ 4,9 • 284 avaliações</Badge>
              <h3 className="mt-3 font-display text-3xl font-semibold">
                Juliana Almeida
              </h3>
              <p className="mt-1 text-xs text-white/65">
                Especialista em Fita Adesiva e Microlink
              </p>
              <button
                onClick={() => navigate("/cliente/agenda")}
                className="mt-4 text-xs font-bold text-champagne"
              >
                Ver agenda <ArrowRight className="inline" size={14} />
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-10 grid gap-5 lg:grid-cols-2">
        <div className="relative overflow-hidden rounded-[28px] bg-[#e9ddc7] p-7 sm:p-9">
          <div className="relative z-10 max-w-xs">
            <Badge tone="black">EXCLUSIVO PARA VOCÊ</Badge>
            <h3 className="mt-4 font-display text-4xl font-semibold leading-none">
              Seu brilho merece cuidado.
            </h3>
            <p className="muted mt-3">
              15% OFF no Kit Home Care Carol Sol para prolongar seu resultado.
            </p>
            <button className="btn-primary mt-5">Usar cupom CAROLSOL15</button>
          </div>
          <Package className="absolute -bottom-7 right-2 h-48 w-48 text-champagne/30" />
        </div>
        <div className="surface p-7 sm:p-9">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
              <Sparkles />
            </div>
            <div>
              <div className="eyebrow">CUIDADO DA SEMANA</div>
              <h3 className="font-display text-2xl font-semibold">
                Proteja a fixação
              </h3>
            </div>
          </div>
          <p className="muted mt-4">
            Seque completamente a raiz antes de dormir e evite aplicar óleos
            diretamente nos pontos de fixação.
          </p>
          <button className="mt-5 text-xs font-bold text-champagne">
            Ver todos os cuidados <ArrowRight className="inline" size={14} />
          </button>
        </div>
      </section>
    </div>
  );
}

function Transformation({ image, label }: { image: string; label: string }) {
  const [position, setPosition] = useState(52);
  return (
    <div className="relative h-[338px] overflow-hidden rounded-[28px] bg-stone-200">
      <img
        src={image}
        alt={`Resultado ${label}`}
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div
        className="absolute inset-y-0 left-0 overflow-hidden grayscale"
        style={{ width: `${position}%` }}
      >
        <img
          src={image}
          alt="Antes"
          className="h-full max-w-none object-cover opacity-75"
          style={{ width: "500px" }}
        />
      </div>
      <div
        className="absolute inset-y-0 w-0.5 bg-white shadow"
        style={{ left: `${position}%` }}
      >
        <div className="absolute left-1/2 top-1/2 grid h-9 w-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-champagne shadow-lg">
          ↔
        </div>
      </div>
      <input
        aria-label="Comparar antes e depois"
        type="range"
        min="15"
        max="85"
        value={position}
        onChange={(e) => setPosition(+e.target.value)}
        className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
      />
      <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between">
        <Badge tone="black">{label}</Badge>
        <Badge tone="gold">Antes & depois</Badge>
      </div>
    </div>
  );
}

function ServicesPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Array<Record<string, any>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    setLoading(true);
    apiFetch<{ services: Array<Record<string, any>> }>(
      "/api/data?resource=bootstrap",
    )
      .then((data) => setItems(data.services || []))
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
                  A partir de {money(Number(s.base_price || 0))}
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

function Discover() {
  const [step, setStep] = useState(0);
  const [answer, setAnswer] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<string[]>([]);
  const [uploading, setUploading] = useState<number | null>(null);
  const navigate = useNavigate();
  const next = () => setStep(Math.min(4, step + 1));
  const prev = () => setStep(Math.max(0, step - 1));
  const addFiles = async (
    e: ChangeEvent<HTMLInputElement>,
    index: number,
    kind: string,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const preview = URL.createObjectURL(file);
    setFiles((current) => {
      const next = [...current];
      next[index] = preview;
      return next;
    });
    setUploading(index);
    try {
      const uploaded = await uploadImage(file, kind.toLowerCase());
      await apiFetch("/api/data?resource=photos", {
        method: "POST",
        body: JSON.stringify({
          url: uploaded.url,
          kind: kind.toLowerCase(),
          publicId: uploaded.publicId,
        }),
      });
      setFiles((current) => {
        const next = [...current];
        next[index] = uploaded.url;
        return next;
      });
    } catch (error) {
      console.error(error);
    } finally {
      setUploading(null);
    }
  };
  return (
    <div className="animate-fade-up">
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
                            src={files[i]}
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
      ) : (
        <Recommendation
          onSchedule={() => {
            sessionStorage.setItem(
              "carol_sol_discovery",
              JSON.stringify({
                answers: answer,
                photos: files.filter(Boolean),
                createdAt: new Date().toISOString(),
              }),
            );
            navigate("/cliente/agenda?origem=descobrir");
          }}
        />
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
function Recommendation({ onSchedule }: { onSchedule: () => void }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="surface overflow-hidden">
        <div className="hair-gradient p-7 text-white sm:p-10">
          <Badge tone="gold">RECOMENDAÇÃO PERSONALIZADA</Badge>
          <h2 className="mt-5 max-w-xl font-display text-4xl font-semibold leading-none sm:text-5xl">
            Fita Adesiva ou Microlink Premium
          </h2>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-white/60">
            Pelo seu objetivo de volume com naturalidade e rotina de manutenção,
            estes métodos oferecem equilíbrio entre leveza, movimento e
            durabilidade.
          </p>
        </div>
        <div className="grid gap-4 p-6 sm:grid-cols-2 sm:p-8">
          {[
            ["Tempo médio", "3h30 a 4h30"],
            ["Faixa estimada", "R$ 1.250 a R$ 2.400"],
            ["Manutenção", "A cada 45–60 dias"],
            ["Resultado", "Volume natural e móvel"],
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
          src={professionals[0].photo}
          name={professionals[0].name}
          size="lg"
        />
        <h3 className="mt-4 font-display text-2xl font-semibold">
          Converse com uma especialista
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
  const [booking, setBooking] = useState(Boolean(discoveryDraft));
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<Record<string, string>>({
    service: "",
    method: discoveryDraft?.answers?.method || "Quero recomendação",
    professional: "Primeira disponível",
    date: dates[0] || "",
    time: "09:00",
    payment: "Pix",
    notes: discoveryNotes,
  });
  const [success, setSuccess] = useState(false);
  const [createdAppointment, setCreatedAppointment] = useState<Record<
    string,
    any
  > | null>(null);
  const [toast, setToast] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [bookingError, setBookingError] = useState("");
  const [remoteAppointments, setRemoteAppointments] = useState<
    Array<Record<string, any>>
  >([]);
  const [availability, setAvailability] = useState<Record<string, boolean>>({});
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [catalog, setCatalog] = useState<{
    services: Array<Record<string, any>>;
    professionals: Array<Record<string, any>>;
  }>({ services: [], professionals: [] });
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
  useEffect(() => {
    refreshAppointments().catch(() => {});
  }, []);
  useEffect(() => {
    apiFetch<{
      services: Array<Record<string, any>>;
      professionals: Array<Record<string, any>>;
    }>("/api/data?resource=bootstrap")
      .then((data) => {
        setCatalog({
          services: data.services || [],
          professionals: data.professionals || [],
        });
        setSelected((current) => ({
          ...current,
          service: current.service || data.services?.[0]?.name || "",
          professional: current.professional || "Primeira disponível",
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
    if (!year || !service?.id || !selected.professional) return;
    setCheckingAvailability(true);
    const queryString = new URLSearchParams({
      resource: "availability",
      date: `${year}-${month}-${day}`,
      serviceId: String(service.id),
    });
    if (professional?.id)
      queryString.set("professionalId", String(professional.id));
    else queryString.set("professionalName", selected.professional);
    apiFetch<{ slots: Array<{ time: string; available: boolean }> }>(
      `/api/data?${queryString}`,
    )
      .then((data) => {
        const nextAvailability = Object.fromEntries(
          data.slots.map((slot) => [slot.time, slot.available]),
        );
        setAvailability(nextAvailability);
        if (nextAvailability[selected.time] === false) {
          const first = data.slots.find((slot) => slot.available);
          if (first)
            setSelected((current) => ({ ...current, time: first.time }));
        }
      })
      .catch((error) => {
        console.error("Availability error", error);
        setAvailability({});
      })
      .finally(() => setCheckingAvailability(false));
  }, [
    catalog.professionals,
    catalog.services,
    selected.date,
    selected.professional,
    selected.service,
  ]);
  useEffect(() => {
    if (!reschedule || !rescheduleDate) return;
    const params = new URLSearchParams({
      resource: "availability",
      date: rescheduleDate,
      serviceId: String(reschedule.service_id),
      professionalId: String(reschedule.professional_id),
    });
    apiFetch<{ slots: Array<{ time: string; available: boolean }> }>(
      `/api/data?${params}`,
    )
      .then((data) => {
        const slots = Object.fromEntries(
          data.slots.map((x) => [x.time, x.available]),
        );
        setRescheduleSlots(slots);
        const first = data.slots.find((x) => x.available);
        if (first) setRescheduleTime(first.time);
      })
      .catch((error) => {
        console.error("Reschedule availability error", error);
        setRescheduleSlots({});
      });
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
      const professional = catalog.professionals.find(
        (item) => item.name === selected.professional,
      );
      if (!service?.id)
        throw new Error(
          "Serviço inválido. Atualize a página e tente novamente.",
        );
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
            professionalId: professional?.id,
            professionalName: selected.professional,
            startsAt: `${year}-${month}-${day}T${selected.time}:00-03:00`,
            notes: selected.notes,
            paymentMethod,
            intakeData: discoveryDraft || {},
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
                      src={
                        professionals.find(
                          (p) => p.name === appointment.professional,
                        )?.photo || professionals[0].photo
                      }
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
                  <a
                    href="https://wa.me/"
                    target="_blank"
                    rel="noreferrer"
                    className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border px-4 text-xs font-bold ${index === 0 ? "border-white/15 bg-white/5" : "border-black/10 bg-warm"}`}
                  >
                    <MessageCircle size={16} />
                    Falar no WhatsApp
                  </a>
                </div>
              </div>
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
      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_340px]">
        <section className="surface p-6">
          <SectionHeading title="Histórico" />
          {history.length ? (
            <div className="space-y-2">
              {history.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-4 rounded-2xl border border-black/[.05] p-4"
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
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl bg-warm p-6 text-center text-xs text-stone-400">
              Nenhum atendimento concluído.
            </div>
          )}
        </section>
        <aside className="surface p-6">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-amber-50 text-amber-700">
            <Info />
          </div>
          <h3 className="mt-4 font-display text-2xl font-semibold">
            Política tranquila
          </h3>
          <p className="muted mt-2">
            Remarque sem custo até 24 horas antes. Cancelamentos após esse prazo
            podem reter 50% do sinal.
          </p>
        </aside>
      </div>
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
      <Modal open={success} onClose={() => setSuccess(false)}>
        <div className="py-5 text-center">
          <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-emerald-50 text-emerald-600">
            <Check size={36} />
          </div>
          <h2 className="mt-5 font-display text-4xl font-semibold">
            Solicitação enviada!
          </h2>
          <p className="muted mx-auto mt-3 max-w-sm">
            Seu pedido foi salvo no sistema para {selected.date} às{" "}
            {selected.time}. Acompanhe o status até a confirmação final.
          </p>
          <div className="mt-6 rounded-2xl bg-warm p-4 text-left text-xs">
            <div className="flex justify-between py-1">
              <span className="text-stone-500">Código</span>
              <b>{createdAppointment?.booking_code || "Gerado no sistema"}</b>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-stone-500">Serviço</span>
              <b>{createdAppointment?.service || selected.service}</b>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-stone-500">Profissional</span>
              <b>{createdAppointment?.professional || selected.professional}</b>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-stone-500">Status</span>
              <b>
                {clientAppointmentStatus[String(createdAppointment?.status)] ||
                  createdAppointment?.status}
              </b>
            </div>
          </div>
          <button
            onClick={() => setSuccess(false)}
            className="btn-primary mt-6 w-full"
          >
            Acompanhar na agenda
          </button>
        </div>
      </Modal>
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
}: {
  step: number;
  selected: Record<string, string>;
  setSelected: (x: Record<string, string>) => void;
  availability: Record<string, boolean>;
  checkingAvailability: boolean;
  catalog: {
    services: Array<Record<string, any>>;
    professionals: Array<Record<string, any>>;
  };
  dateOptions: string[];
}) {
  const choose = (k: string, v: string) => setSelected({ ...selected, [k]: v });
  const service = catalog.services.find((s) => s.name === selected.service);
  const slots = Object.keys(availability).length
    ? Object.keys(availability)
    : ["09:00", "10:30", "14:00", "16:00"];
  const configs: { title: string; key: string; options: string[] }[] = [
    {
      title: "Qual serviço você procura?",
      key: "service",
      options: catalog.services.map((s) => String(s.name)),
    },
    {
      title: "Qual método deseja avaliar?",
      key: "method",
      options: ["Quero recomendação", "Fita Adesiva", "Microlink", "Queratina"],
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
            Nenhuma opção disponível no momento.
          </p>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-2">
            {c.options.map((o) => {
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
  if (step === 6)
    return (
      <div className="mt-5">
        <h3 className="font-display text-2xl font-semibold">
          Revise os detalhes
        </h3>
        <div className="mt-4 space-y-3 rounded-2xl bg-warm p-5 text-xs">
          {[
            ["Serviço", selected.service],
            ["Método", selected.method],
            ["Profissional", selected.professional],
            ["Data e hora", `${selected.date} às ${selected.time}`],
            [
              "Estimativa",
              `${service?.duration_minutes || "—"}min • ${service ? money(Number(service.base_price || 0)) : "A confirmar"}`,
            ],
            [
              "Sinal",
              service
                ? money(Number(service.deposit_amount || 0))
                : "A confirmar",
            ],
          ].map((x) => (
            <div key={x[0]} className="flex justify-between gap-4">
              <span className="text-stone-500">{x[0]}</span>
              <b className="text-right">{x[1]}</b>
            </div>
          ))}
        </div>
        <p className="mt-4 text-[10px] leading-relaxed text-stone-400">
          Ao confirmar, você concorda com a política de cancelamento e
          reagendamento.
        </p>
      </div>
    );
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
        {service ? money(Number(service.deposit_amount || 0)) : "a confirmar"}.
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

function Benefits() {
  const [plan, setPlan] = useState("Completo");
  const [modal, setModal] = useState(false);
  const plans = [
    ["Essencial", "R$ 349", "1 manutenção", "5% em produtos"],
    ["Completo", "R$ 599", "2 manutenções", "10% em produtos"],
    ["VIP", "R$ 899", "3 manutenções", "15% + prioridade"],
    ["Premium Gold", "R$ 1.299", "4 manutenções", "20% + concierge"],
  ];
  return (
    <div className="animate-fade-up">
      <PageHeader
        eyebrow="CLUBE CAROL SOL"
        title="Cuidado que recompensa"
        subtitle="Acumule pontos, desbloqueie experiências e mantenha seu Mega Hair sempre impecável."
      />
      <section className="hair-gradient relative overflow-hidden rounded-[30px] p-7 text-white shadow-premium sm:p-10">
        <div className="absolute right-[-40px] top-[-60px] h-64 w-64 rounded-full bg-champagne/15 blur-3xl" />
        <div className="relative grid gap-7 lg:grid-cols-[1fr_auto]">
          <div>
            <div className="flex items-center gap-2">
              <Badge tone="gold">GOLD</Badge>
              <span className="text-[10px] text-white/40">
                desde março de 2026
              </span>
            </div>
            <h2 className="mt-4 font-display text-5xl font-semibold">
              850 <span className="text-2xl text-champagne">pontos</span>
            </h2>
            <p className="mt-2 text-sm text-white/50">
              Faltam 150 pontos para ganhar R$ 100 em serviços.
            </p>
            <div className="mt-6 h-2 max-w-lg overflow-hidden rounded-full bg-white/10">
              <div className="h-full w-[85%] rounded-full bg-champagne" />
            </div>
            <div className="mt-2 flex max-w-lg justify-between text-[9px] text-white/35">
              <span>Gold</span>
              <span>1.000 pts</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:min-w-[320px]">
            <MiniBenefit icon={<Gift />} value="2" label="Cupons ativos" />
            <MiniBenefit
              icon={<Share2 />}
              value="R$ 50"
              label="Indique e ganhe"
            />
            <MiniBenefit icon={<Zap />} value="5%" label="Cashback" />
            <MiniBenefit icon={<Star />} value="Gold" label="Seu nível" />
          </div>
        </div>
      </section>
      <section className="mt-10">
        <SectionHeading title="Planos de cuidado" link="Comparar benefícios" />
        <div className="no-scrollbar -mx-4 flex gap-4 overflow-x-auto px-4 pb-4 sm:mx-0 sm:grid sm:grid-cols-2 sm:px-0 xl:grid-cols-4">
          {plans.map((p, i) => (
            <button
              key={p[0]}
              onClick={() => setPlan(p[0])}
              className={`relative min-w-[270px] rounded-[26px] border p-6 text-left transition sm:min-w-0 ${plan === p[0] ? "border-champagne bg-white shadow-premium" : "border-black/[.06] bg-white shadow-card"}`}
            >
              {i === 1 && (
                <span className="absolute right-4 top-4">
                  <Badge tone="gold">MAIS ESCOLHIDO</Badge>
                </span>
              )}
              <div className="eyebrow">PLANO</div>
              <h3 className="mt-2 font-display text-3xl font-semibold">
                {p[0]}
              </h3>
              <div className="mt-4 text-2xl font-bold">
                {p[1]}{" "}
                <span className="text-[10px] font-normal text-stone-400">
                  / ciclo
                </span>
              </div>
              <div className="mt-5 space-y-3 border-t border-black/[.06] pt-5 text-xs">
                {[
                  p[2],
                  p[3],
                  "Prioridade na agenda",
                  "Pix ou 6x sem juros",
                ].map((x) => (
                  <div key={x} className="flex gap-2">
                    <Check className="text-champagne" size={15} />
                    {x}
                  </div>
                ))}
              </div>
              <span
                onClick={() => setModal(true)}
                className={`mt-6 flex min-h-11 items-center justify-center rounded-xl text-xs font-bold ${plan === p[0] ? "bg-ink text-white" : "bg-warm"}`}
              >
                Assinar plano
              </span>
            </button>
          ))}
        </div>
      </section>
      <div className="mt-8 grid gap-5 lg:grid-cols-3">
        <div className="surface p-6">
          <Badge tone="gold">CUPOM ATIVO</Badge>
          <h3 className="mt-4 font-display text-3xl font-semibold">
            CAROLSOL15
          </h3>
          <p className="muted mt-2">15% OFF no Kit Home Care Carol Sol.</p>
          <div className="mt-5 text-[10px] text-stone-400">
            Válido até 30/06/2026
          </div>
        </div>
        <div className="surface p-6">
          <Badge tone="green">INDIQUE & GANHE</Badge>
          <h3 className="mt-4 font-display text-3xl font-semibold">
            R$ 50 para cada uma
          </h3>
          <p className="muted mt-2">
            Você e sua amiga ganham crédito após o primeiro atendimento.
          </p>
          <button className="mt-5 text-xs font-bold text-champagne">
            Convidar uma amiga
          </button>
        </div>
        <div className="surface p-6">
          <Badge tone="black">GIFT CARD</Badge>
          <h3 className="mt-4 font-display text-3xl font-semibold">
            Presenteie beleza
          </h3>
          <p className="muted mt-2">
            Escolha um valor e envie uma experiência inesquecível.
          </p>
          <button className="mt-5 text-xs font-bold text-champagne">
            Criar gift card
          </button>
        </div>
      </div>
      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={`Assinar plano ${plan}`}
      >
        <div className="rounded-2xl bg-warm p-5">
          <div className="flex justify-between text-sm">
            <span>Plano selecionado</span>
            <b>{plan}</b>
          </div>
          <div className="mt-3 flex justify-between text-sm">
            <span>Forma de pagamento</span>
            <b>Pix ou cartão</b>
          </div>
        </div>
        <label className="mt-5 flex gap-3 text-[11px] leading-relaxed text-stone-500">
          <input type="checkbox" defaultChecked />
          Li os benefícios, regras de uso e renovação do plano.
        </label>
        <button className="btn-primary mt-5 w-full">
          Continuar para pagamento
        </button>
      </Modal>
    </div>
  );
}
function MiniBenefit({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[.06] p-4">
      <div className="text-champagne">{icon}</div>
      <div className="mt-3 text-sm font-bold">{value}</div>
      <div className="mt-1 text-[9px] text-white/40">{label}</div>
    </div>
  );
}

function ClientProfile() {
  const [importOpen, setImportOpen] = useState(false);
  const [edit, setEdit] = useState(false);
  const [toast, setToast] = useState(false);
  return (
    <div className="animate-fade-up">
      <Toast show={toast} message="Dados atualizados" />
      <PageHeader
        eyebrow="MINHA CONTA"
        title="Perfil e preferências"
        subtitle="Cuide dos seus dados, privacidade e histórico técnico."
        action={
          <button onClick={() => setEdit(true)} className="btn-secondary">
            <Pencil size={16} />
            Editar dados
          </button>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
        <aside className="surface self-start overflow-hidden">
          <div className="h-24 bg-gradient-to-r from-ink to-[#4a392b]" />
          <div className="px-6 pb-6">
            <div className="-mt-9">
              <Avatar src={images.client1} name="Juliana Mendes" size="lg" />
            </div>
            <h2 className="mt-4 font-display text-3xl font-semibold">
              Juliana Mendes
            </h2>
            <p className="text-xs text-stone-500">Cliente Gold • desde 2025</p>
            <div className="mt-5 grid grid-cols-3 rounded-2xl bg-warm p-4 text-center">
              <div>
                <b className="block text-sm">850</b>
                <span className="text-[9px] text-stone-400">Pontos</span>
              </div>
              <div className="border-x border-black/[.07]">
                <b className="block text-sm">12</b>
                <span className="text-[9px] text-stone-400">Visitas</span>
              </div>
              <div>
                <b className="block text-sm">Gold</b>
                <span className="text-[9px] text-stone-400">Nível</span>
              </div>
            </div>
            <div className="mt-5 space-y-3 text-xs text-stone-500">
              <div className="flex gap-3">
                <Phone size={15} className="text-champagne" />
                (11) 99845-2201
              </div>
              <div className="flex gap-3">
                <UserRound size={15} className="text-champagne" />
                juliana@email.com
              </div>
              <div className="flex gap-3">
                <CalendarDays size={15} className="text-champagne" />
                14/09/1991
              </div>
            </div>
          </div>
        </aside>
        <div className="space-y-5">
          <section className="surface p-6">
            <SectionHeading title="Próxima manutenção" />
            <div className="grid gap-4 sm:grid-cols-3">
              <InfoBox label="Data" value="24/06/2026 às 14:00" />
              <InfoBox label="Profissional" value="Juliana Almeida" />
              <InfoBox label="Método" value="Fita Adesiva • 60 cm" />
            </div>
          </section>
          <section className="surface p-6">
            <SectionHeading
              title="Histórico técnico"
              link="Ver ficha completa"
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl bg-warm p-5">
                <div className="eyebrow">APLICAÇÃO ATUAL</div>
                <h3 className="mt-2 text-sm font-bold">Fita Adesiva Premium</h3>
                <div className="mt-4 grid grid-cols-2 gap-3 text-[11px]">
                  <span>
                    <b className="block">120g</b>
                    <span className="text-stone-400">Peso utilizado</span>
                  </span>
                  <span>
                    <b className="block">60 cm</b>
                    <span className="text-stone-400">Comprimento</span>
                  </span>
                  <span>
                    <b className="block">Castanho 4/6</b>
                    <span className="text-stone-400">Cor / tonalidade</span>
                  </span>
                  <span>
                    <b className="block">CS2604</b>
                    <span className="text-stone-400">Lote</span>
                  </span>
                </div>
              </div>
              <div className="rounded-2xl border border-black/[.06] p-5">
                <div className="eyebrow">CUIDADOS RECOMENDADOS</div>
                <ul className="mt-3 space-y-2 text-[11px] leading-relaxed text-stone-500">
                  <li>• Secar completamente a raiz antes de dormir.</li>
                  <li>• Usar escova própria para extensões.</li>
                  <li>• Evitar óleos nos pontos de fixação.</li>
                  <li>• Manutenção em 45 a 60 dias.</li>
                </ul>
              </div>
            </div>
          </section>
          <section className="surface overflow-hidden">
            <ProfileRow
              icon={<CreditCard />}
              title="Pagamentos"
              text="Cartões salvos e histórico de pagamentos"
            />
            <ProfileRow
              icon={<BellIcon />}
              title="Notificações"
              text="Lembretes, ofertas e canais de contato"
            />
            <ProfileRow
              icon={<ShieldCheck />}
              title="Privacidade e LGPD"
              text="Consentimentos, exportação e exclusão de dados"
            />
            <ProfileRow
              icon={<Users />}
              title="Indique uma amiga"
              text="Importe contatos somente com autorização"
              onClick={() => setImportOpen(true)}
            />
            <ProfileRow
              icon={<Gift />}
              title="Cupons e planos"
              text="1 cupom ativo • Plano Completo"
            />
          </section>
        </div>
      </div>
      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Convidar amigas"
      >
        <div className="rounded-2xl bg-amber-50 p-4 text-[11px] leading-relaxed text-amber-800">
          <b>Você está no controle.</b> Nunca importamos contatos
          automaticamente. Selecione manualmente quem deseja convidar e revise
          antes de compartilhar.
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <button className="btn-secondary">
            <Users size={17} />
            Selecionar contatos
          </button>
          <label className="btn-secondary cursor-pointer">
            <Upload size={17} />
            Importar CSV/VCF
            <input className="hidden" type="file" accept=".csv,.vcf" />
          </label>
        </div>
        <p className="mt-4 text-[10px] leading-relaxed text-stone-400">
          O convite não será enviado sem sua confirmação final. Ao continuar,
          aplicam-se nossa Política de Privacidade e a LGPD.
        </p>
      </Modal>
      <Modal open={edit} onClose={() => setEdit(false)} title="Editar dados">
        <div className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-xs font-bold">Nome completo</span>
            <input className="field" defaultValue="Juliana Mendes" />
          </label>
          <label className="block">
            <span className="mb-2 block text-xs font-bold">Telefone</span>
            <input className="field" defaultValue="(11) 99845-2201" />
          </label>
          <label className="block">
            <span className="mb-2 block text-xs font-bold">E-mail</span>
            <input className="field" defaultValue="juliana@email.com" />
          </label>
          <button
            onClick={() => {
              setEdit(false);
              setToast(true);
              setTimeout(() => setToast(false), 2200);
            }}
            className="btn-primary w-full"
          >
            Salvar alterações
          </button>
        </div>
      </Modal>
    </div>
  );
}
function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-warm p-4">
      <div className="text-[9px] font-bold uppercase tracking-wider text-stone-400">
        {label}
      </div>
      <div className="mt-1.5 text-xs font-bold">{value}</div>
    </div>
  );
}
function ProfileRow({
  icon,
  title,
  text,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-4 border-b border-black/[.05] p-5 text-left last:border-0 hover:bg-warm/50"
    >
      <span className="grid h-11 w-11 place-items-center rounded-xl bg-warm text-champagne">
        {icon}
      </span>
      <span className="flex-1">
        <b className="block text-xs">{title}</b>
        <span className="mt-1 block text-[10px] text-stone-400">{text}</span>
      </span>
      <ChevronRight size={17} className="text-stone-300" />
    </button>
  );
}
function BellIcon() {
  return <Sparkles />;
}
