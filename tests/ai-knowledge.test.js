import assert from "node:assert/strict";
import test from "node:test";

import {
  findMatchingArticle,
  classifyInboundMessage,
} from "../server/lib/whatsapp-ai-engine.js";

const mockArticles = [
  {
    title: "O que é Mega Hair?",
    slug: "o-que-e-mega-hair",
    category: "O que é Mega Hair",
    question_variations: ["o que e mega hair", "oque e mega hair", "alongamento de cabelo", "o que e alongamento"],
    short_answer: "Mega Hair é uma técnica de alongamento ou aumento de volume feita com mechas adicionais de cabelo.",
    full_answer: "Mega Hair é uma técnica de alongamento ou aumento de volume feita com mechas adicionais de cabelo. Existem vários métodos, como fita adesiva, microlink, queratina e tic tac. O melhor depende do seu comprimento atual, espessura dos fios, rotina e resultado desejado. Você busca mais volume, mais comprimento ou os dois?",
    requires_evaluation: false,
    requires_human_handoff: false,
    medical_safety_level: "normal",
    status: "active"
  },
  {
    title: "Mega Hair faz o cabelo cair?",
    slug: "mega-hair-faz-cair-cabelo",
    category: "Mega Hair e queda de cabelo",
    question_variations: ["mega hair faz cair cabelo", "mega hair prejudica o cabelo", "mega hair causa queda", "estragou meu cabelo", "cabelo caindo"],
    short_answer: "O Mega Hair não deve causar queda quando a técnica é bem indicada, aplicada corretamente e recebe manutenção no prazo.",
    full_answer: "O Mega Hair não deve causar queda quando a técnica é bem indicada, aplicada corretamente e recebe manutenção no prazo. Mas peso excessivo, tensionagem, aplicação inadequada, manutenção atrasada ou um couro cabeludo sensível podem causar desconforto e prejudicar os fios. Para indicar a técnica certa, preciso entender como está seu cabelo hoje. Você sente quebra, queda intensa, dor ou sensibilidade no couro cabeludo?",
    requires_evaluation: false,
    requires_human_handoff: false,
    medical_safety_level: "normal",
    status: "active"
  },
  {
    title: "O que é Mega Hair de queratina?",
    slug: "o-que-e-mega-hair-de-queratina",
    category: "Queratina",
    question_variations: ["o que e mega hair de queratina", "tecnica de queratina", "como funciona a queratina", "megahair de queratina"],
    short_answer: "É uma técnica em que pequenas mechas são fixadas aos fios naturais com pontos de queratina específicos para alongamento.",
    full_answer: "É uma técnica em que pequenas mechas são fixadas aos fios naturais com pontos de queratina específicos para alongamento. Ela pode oferecer um resultado discreto e personalizado, mas exige aplicação cuidadosa e manutenção profissional. Para saber se é indicada para você, preciso avaliar o comprimento, a espessura e o estado atual do seu cabelo.",
    requires_evaluation: true,
    requires_human_handoff: false,
    medical_safety_level: "normal",
    status: "active"
  },
  {
    title: "Qual o melhor método para cabelo curto?",
    slug: "qual-o-melhor-metodo-para-cabelo-curto",
    category: "Cabelo curto",
    question_variations: ["qual o melhor metodo para cabelo curto", "tenho cabelo curto o que fazer", "mega hair em cabelo curto", "qual e melhor para cabelo curto"],
    short_answer: "Para cabelo curto, a escolha depende do comprimento atual, densidade dos fios e do quanto você deseja alongar.",
    full_answer: "Para cabelo curto, a escolha depende principalmente do comprimento atual, da densidade dos fios e de quanto você deseja alongar. Em alguns casos, técnicas com mechas menores podem ajudar a deixar o resultado mais discreto, mas a indicação correta precisa de avaliação. Você consegue me dizer aproximadamente até onde vai seu cabelo hoje e qual comprimento gostaria de alcançar?",
    requires_evaluation: true,
    requires_human_handoff: false,
    medical_safety_level: "normal",
    status: "active"
  },
  {
    title: "Qual método é melhor para cabelo fino?",
    slug: "qual-metodo-e-melhor-para-cabelo-fino",
    category: "Cabelo fino",
    question_variations: ["qual metodo e melhor para cabelo fino", "tenho cabelo muito fino", "mega hair em cabelo fino", "qual e melhor para cabelo fino"],
    short_answer: "Em cabelos finos, o principal é escolher uma técnica com distribuição adequada de peso e quantidade de mechas compatível.",
    full_answer: "Em cabelos finos, o principal é escolher uma técnica com distribuição adequada de peso e quantidade de mechas compatível com os fios naturais. A avaliação é importante para evitar excesso de peso e garantir um resultado natural. Você procura mais volume, comprimento ou ambos?",
    requires_evaluation: true,
    requires_human_handoff: false,
    medical_safety_level: "normal",
    status: "active"
  },
  {
    title: "Quanto tempo dura o Mega Hair?",
    slug: "quanto-tempo-dura-o-mega-hair",
    category: "Durabilidade",
    question_variations: ["quanto tempo dura o mega hair", "durabilidade do mega hair", "de quanto em quanto tempo faz manutencao", "quanto tempo dura"],
    short_answer: "A durabilidade varia conforme a técnica, velocidade de crescimento do cabelo e cuidados em casa.",
    full_answer: "A durabilidade varia conforme a técnica, velocidade de crescimento do cabelo e cuidados em casa. Além da duração da aplicação, existe o prazo ideal de manutenção, que é fundamental para preservar o resultado e a saúde dos fios. Posso mostrar as opções de manutenção disponíveis para cada técnica.",
    requires_evaluation: false,
    requires_human_handoff: false,
    medical_safety_level: "normal",
    status: "active"
  },
  {
    title: "Posso lavar, usar secador, piscina ou praia?",
    slug: "posso-lavar-usar-secador-piscina-ou-praia",
    category: "Cuidados em casa",
    question_variations: ["posso lavar", "usar secador", "piscina ou praia", "mega hair na piscina", "como lavar o mega hair", "piscina", "praia", "secador"],
    short_answer: "Em geral, é possível manter uma rotina normal com alguns cuidados específicos, como usar produtos adequados e secar bem a região das fixações.",
    full_answer: "Em geral, é possível manter uma rotina normal com alguns cuidados específicos, como usar produtos adequados, secar bem a região das fixações e respeitar as orientações da técnica escolhida. Os cuidados podem variar conforme o método. Você já usa Mega Hair ou está pesquisando para fazer pela primeira vez?",
    requires_evaluation: false,
    requires_human_handoff: false,
    medical_safety_level: "normal",
    status: "active"
  },
  {
    title: "Mega Hair e progressiva ou química",
    slug: "mega-hair-com-progressiva",
    category: "Cabelo com química",
    question_variations: ["posso fazer se tenho progressiva", "progressiva e mega hair", "mega hair com quimica", "alisamento e mega hair", "mega hair loiro", "loira mega hair", "mega hair com progressiva"],
    short_answer: "Sim, é possível aplicar Mega Hair em cabelos com progressiva ou química, mas exige cuidados adicionais e uma avaliação da resistência dos fios.",
    full_answer: "Sim, é possível aplicar Mega Hair em cabelos com progressiva ou outra química, contanto que os fios estejam saudáveis e resistentes. O alisamento diminui o atrito, mas a fixação precisa ser feita de forma correta para evitar escorregamento da mecha. Para recomendar a melhor técnica para o seu caso, preciso entender melhor: faz quanto tempo que você realizou a progressiva?",
    requires_evaluation: true,
    requires_human_handoff: false,
    medical_safety_level: "normal",
    status: "active"
  },
  {
    title: "Dor e coceira intensa no couro cabeludo",
    slug: "dor-coceira-couro-cabeludo",
    category: "Contraindicações",
    question_variations: ["meu couro cabeludo esta cocando e doendo", "dor no couro cabeludo", "irritacao couro cabeludo", "ferida na cabeca", "dor intensa", "meu couro cabeludo esta cocando"],
    short_answer: "Se você percebe dor, coceira intensa, feridas ou queda importante, recomendamos pausar procedimentos e procurar ajuda médica.",
    full_answer: "Se você percebe dor, coceira intensa, feridas, quebra acentuada ou queda importante, recomendamos pausar qualquer procedimento, evitar coçar a região e procurar uma profissional qualificada para avaliação física do couro cabeludo e, se necessário, um dermatologista. Sintomas inflamatórios requerem cuidados especializados.",
    requires_evaluation: true,
    requires_human_handoff: true,
    medical_safety_level: "alert",
    status: "active"
  },
  {
    title: "Quebra de cabelo associada ao Mega Hair",
    slug: "mega-hair-quebrando-cabelo",
    category: "Segurança e contraindicações",
    question_variations: ["meu mega hair esta quebrando meu cabelo", "quebrando meu cabelo", "dano no cabelo por mega hair", "mega hair quebrando"],
    short_answer: "A quebra excessiva pode ocorrer por excesso de peso, manutenção atrasada ou aplicação inadequada.",
    full_answer: "A quebra excessiva dos fios associada ao Mega Hair pode ser causada por excesso de peso das mechas, tensionagem inadequada na aplicação, atraso no prazo de manutenção ou fragilidade prévia do cabelo. Recomendamos pausar a tração e agendar uma avaliação presencial para verificar a integridade da haste capilar.",
    requires_evaluation: true,
    requires_human_handoff: true,
    medical_safety_level: "alert",
    status: "active"
  },
  {
    title: "Técnica recomendada / Triagem",
    slug: "qual-tecnica-combina-comigo",
    category: "Avaliação profissional",
    question_variations: ["qual tecnica combina comigo", "qual o melhor metodo para mim", "qual mega hair escolher", "qual tecnica combina comigo", "quero saber qual tecnica combina comigo"],
    short_answer: "A escolha do melhor método depende de uma análise dos seus fios, rotina e preferências.",
    full_answer: "A escolha do melhor método depende de fatores como a espessura do seu fio, o estado do couro cabeludo, sua rotina e o resultado desejado. Para te dar uma orientação personalizada inicial, você poderia me dizer: você busca mais volume, comprimento ou ambos? Seus fios são finos, médios ou grossos?",
    requires_evaluation: true,
    requires_human_handoff: false,
    medical_safety_level: "normal",
    status: "active"
  }
];

test("1. Question: O que é Mega Hair?", () => {
  const art = findMatchingArticle("O que é Mega Hair?", mockArticles);
  assert.ok(art);
  assert.equal(art.slug, "o-que-e-mega-hair");
  const level = classifyInboundMessage("O que é Mega Hair?", art);
  assert.equal(level, 1);
});

test("2. Question: Mega Hair faz cair cabelo?", () => {
  const art = findMatchingArticle("Mega Hair faz cair cabelo?", mockArticles);
  assert.ok(art);
  assert.equal(art.slug, "mega-hair-faz-cair-cabelo");
  const level = classifyInboundMessage("Mega Hair faz cair cabelo?", art);
  assert.equal(level, 1);
});

test("3. Question: O que é técnica de queratina?", () => {
  const art = findMatchingArticle("O que é técnica de queratina?", mockArticles);
  assert.ok(art);
  assert.equal(art.slug, "o-que-e-mega-hair-de-queratina");
  const level = classifyInboundMessage("O que é técnica de queratina?", art);
  assert.equal(level, 3);
});

test("4. Question: Qual é melhor para cabelo curto?", () => {
  const art = findMatchingArticle("Qual é melhor para cabelo curto?", mockArticles);
  assert.ok(art, "Should find matching article for short hair query");
  assert.equal(art.slug, "qual-o-melhor-metodo-para-cabelo-curto");
  const level = classifyInboundMessage("Qual é melhor para cabelo curto?", art);
  assert.equal(level, 3);
});

test("5. Question: Qual é melhor para cabelo fino?", () => {
  const art = findMatchingArticle("Qual é melhor para cabelo fino?", mockArticles);
  assert.ok(art, "Should find matching article for fine hair query");
  assert.equal(art.slug, "qual-metodo-e-melhor-para-cabelo-fino");
  const level = classifyInboundMessage("Qual é melhor para cabelo fino?", art);
  assert.equal(level, 3);
});

test("6. Question: Posso fazer se tenho progressiva?", () => {
  const art = findMatchingArticle("Posso fazer se tenho progressiva?", mockArticles);
  assert.ok(art);
  assert.equal(art.slug, "mega-hair-com-progressiva");
  const level = classifyInboundMessage("Posso fazer se tenho progressiva?", art);
  assert.equal(level, 3);
});

test("7. Question: Quanto tempo dura?", () => {
  const art = findMatchingArticle("Quanto tempo dura?", mockArticles);
  assert.ok(art, "Should find matching article for duration query");
  assert.equal(art.slug, "quanto-tempo-dura-o-mega-hair");
  const level = classifyInboundMessage("Quanto tempo dura?", art);
  assert.equal(level, 1);
});

test("8. Question: Posso entrar na piscina?", () => {
  const art = findMatchingArticle("Posso entrar na piscina?", mockArticles);
  assert.ok(art, "Should find matching article for pool query");
  assert.equal(art.slug, "posso-lavar-usar-secador-piscina-ou-praia");
  const level = classifyInboundMessage("Posso entrar na piscina?", art);
  assert.equal(level, 1);
});

test("9. Question: Meu couro cabeludo está coçando e doendo. (Nível 4)", () => {
  const art = findMatchingArticle("Meu couro cabeludo está coçando e doendo.", mockArticles);
  assert.ok(art);
  assert.equal(art.slug, "dor-coceira-couro-cabeludo");
  const level = classifyInboundMessage("Meu couro cabeludo está coçando e doendo.", art);
  assert.equal(level, 4);
});

test("10. Question: Meu Mega Hair está quebrando meu cabelo. (Nível 4)", () => {
  const art = findMatchingArticle("Meu Mega Hair está quebrando meu cabelo.", mockArticles);
  assert.ok(art);
  assert.equal(art.slug, "mega-hair-quebrando-cabelo");
  const level = classifyInboundMessage("Meu Mega Hair está quebrando meu cabelo.", art);
  assert.equal(level, 4);
});

test("11. Question: Quero saber qual técnica combina comigo. (Triagem)", () => {
  const art = findMatchingArticle("Quero saber qual técnica combina comigo.", mockArticles);
  assert.ok(art);
  assert.equal(art.slug, "qual-tecnica-combina-comigo");
  const level = classifyInboundMessage("Quero saber qual técnica combina comigo.", art);
  assert.equal(level, 3);
});

test("12. Question: Quero agendar uma avaliação.", () => {
  const art = findMatchingArticle("Quero agendar uma avaliação.", mockArticles);
  const level = classifyInboundMessage("Quero agendar uma avaliação.", art);
  assert.equal(level, 1);
});
