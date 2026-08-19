import { includesAny, normalizeText } from "./utils.js";

const HAIR_KNOWLEDGE_TOPICS = [
  {
    key: "coloracao",
    title: "Coloração",
    terms: ["coloracao", "colorir", "tintura", "tingir", "pintar o cabelo", "pintar cabelo"],
    explanation: "Coloração é o procedimento que deposita ou altera pigmentos nos fios para mudar a cor, cobrir cabelos brancos ou corrigir o tom.",
    process: "Normalmente a profissional avalia a cor atual, o histórico químico e o resultado desejado, escolhe a fórmula adequada, faz o teste necessário e então aplica, pausa, enxágua e finaliza.",
    caution: "Em cabelos com Mega Hair, descoloração anterior ou outras químicas, a avaliação é importante para proteger os fios naturais e verificar a compatibilidade com o material do alongamento.",
  },
  {
    key: "tonalizacao",
    title: "Tonalização",
    terms: ["tonalizacao", "tonalizar", "tonalizante", "matizacao", "matizar"],
    explanation: "Tonalização ajusta ou renova o reflexo da cor com uma ação geralmente mais suave do que a coloração permanente.",
    process: "A cor de fundo e o resultado desejado são avaliados antes da escolha do tonalizante e do tempo de pausa.",
    caution: "Em Mega Hair, a profissional precisa confirmar se o produto é compatível com a fibra ou com o cabelo utilizado.",
  },
  {
    key: "descoloracao",
    title: "Descoloração e luzes",
    terms: ["descoloracao", "descolorir", "luzes", "clarear", "mechas loiras", "ficar loira"],
    explanation: "Descoloração remove parte dos pigmentos dos fios para clarear o cabelo ou preparar técnicas como luzes e mechas.",
    process: "O procedimento depende de diagnóstico, teste de mecha, resistência do cabelo, químicas anteriores e tom que se pretende alcançar.",
    caution: "Não é seguro prometer o resultado sem avaliação, principalmente em fios sensibilizados ou com alongamento.",
  },
  {
    key: "alisamento",
    title: "Progressiva e alisamento",
    terms: ["progressiva", "alisamento", "alisar", "relaxamento"],
    explanation: "Progressiva e alisamentos são procedimentos químicos usados para reduzir volume, alinhar ou modificar a estrutura dos fios.",
    process: "A técnica e o produto precisam ser escolhidos conforme o histórico químico, a saúde do cabelo e o resultado esperado.",
    caution: "Com Mega Hair, a aplicação deve respeitar os pontos de fixação e a compatibilidade entre as químicas.",
  },
  {
    key: "tratamento",
    title: "Tratamentos capilares",
    terms: ["hidratacao", "hidratar", "nutricao", "reconstrucao", "cronograma capilar", "tratamento capilar"],
    explanation: "Tratamentos capilares repõem água, lipídios ou proteínas conforme a necessidade dos fios.",
    process: "A escolha entre hidratação, nutrição e reconstrução depende de avaliação do ressecamento, porosidade, elasticidade e histórico químico.",
    caution: "Em cabelos com alongamento, os produtos e a aplicação também precisam preservar os pontos de fixação.",
  },
];

function findHairKnowledgeTopic(text) {
  const normalized = normalizeText(text);
  return HAIR_KNOWLEDGE_TOPICS.find((topic) => includesAny(normalized, topic.terms)) || null;
}

export function buildHairKnowledgeResponse(text, { offeredInCatalog = false } = {}) {
  const topic = findHairKnowledgeTopic(text);
  if (!topic) return null;
  const normalized = normalizeText(text);
  const asksAvailability = includesAny(normalized, [
    "voce faz",
    "voces fazem",
    "trabalha com",
    "trabalham com",
    "tem esse servico",
    "tem este servico",
    "oferece",
  ]);
  const availability = asksAvailability
    ? offeredInCatalog
      ? `${topic.title} aparece entre os serviços ativos para atendimento.`
      : `${topic.title} não aparece no catálogo ativo para agendamento automático. Posso orientar sobre o procedimento, mas a disponibilidade precisa ser confirmada pela equipe.`
    : "";
  return [
    availability,
    topic.explanation,
    topic.process,
    topic.caution,
    offeredInCatalog
      ? "Você quer consultar as opções cadastradas ou iniciar um agendamento?"
      : "Se quiser confirmar se a Carol realiza esse atendimento, envie “atendente”. Para conhecer os serviços disponíveis para agendamento, envie “serviços”.",
  ].filter(Boolean).join("\n\n");
}

export function isKnownHairKnowledgeTopic(text) {
  return Boolean(findHairKnowledgeTopic(text));
}
