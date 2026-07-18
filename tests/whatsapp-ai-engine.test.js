import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { pool } from "../server/lib/db.js";
import { parseBookingDateFromText } from "../server/lib/whatsapp/intent-detector.js";

import {
  buildLocalGreetingResponse,
  buildOutOfScopeResponse,
  buildLocalIntentResponse,
  buildAiConversationMessage,
  buildBookingGuidance,
  isInAiServiceScope,
  isMessageWebhookPayload,
  isWithinAiHours,
  keywordInText,
  normalizeIncomingWhatsappPayload,
  shouldResetBookingStateOnGreeting,
  summarizeAiCommercialContext,
  isClientAskingQuestion,
  isClientChangingSubjectOrNegating,
  isClientExitingFlow,
  isReplyingToExplanationOffer,
  getAgendaAvailabilityContext,
  handleStructuredBookingFlow,
  isAgendaAvailabilityIntent,
  shouldPrioritizeBookingState,
  isSimpleGreeting,
  localGreetingForDate,
  buildInventoryOptions,
  phoneLookupCandidates,
  selectBookingService,
  hydrateBookingContactFromClient,
  isServiceCatalogMenuIntent,
  buildInitialServiceCatalogOptions,
  buildInitialCategoryCatalogOptions,
} from "../server/lib/whatsapp-ai-engine.js";

const originalQuery = pool.query;
const originalConnect = pool.connect;
const originalFetch = globalThis.fetch;
const originalBaileysUrl = process.env.BAILEYS_API_URL;
const originalBaileysKey = process.env.BAILEYS_API_KEY;

afterEach(() => {
  pool.query = originalQuery;
  pool.connect = originalConnect;
  globalThis.fetch = originalFetch;
  if (originalBaileysUrl === undefined) delete process.env.BAILEYS_API_URL;
  else process.env.BAILEYS_API_URL = originalBaileysUrl;
  if (originalBaileysKey === undefined) delete process.env.BAILEYS_API_KEY;
  else process.env.BAILEYS_API_KEY = originalBaileysKey;
});

test("matches migrated Brazilian client phones with or without country and ninth digit", () => {
  const candidates = phoneLookupCandidates("5514988773387");
  assert.ok(candidates.exact.includes("5514988773387"));
  assert.ok(candidates.exact.includes("14988773387"));
  assert.ok(candidates.exact.includes("1488773387"));
  assert.ok(candidates.exact.includes("551488773387"));
});

test("lists available inventory for a service, including generic category items", () => {
  const options = buildInventoryOptions(
    {
      inventory: [
        { id: "exact", active: true, quantity: 2, category_id: "cat-1", hair_method_id: "method-1", color: "Loiro", length_cm: "60", suggested_price: 900 },
        { id: "generic", active: true, quantity: 1, category_id: "cat-1", hair_method_id: null, color: "Castanho", length_cm: "55", suggested_price: 800 },
        { id: "empty", active: true, quantity: 0, category_id: "cat-1", hair_method_id: "method-1", color: "Preto" },
        { id: "other-method", active: true, quantity: 3, category_id: "cat-1", hair_method_id: "method-2", color: "Ruivo" },
      ],
    },
    { offerInventoryItems: true, categoryId: "cat-1", methodId: "method-1" },
  );
  assert.deepEqual(options.map((item) => item.inventoryId), ["exact", "generic"]);
});

test("keeps inventory linkage when a service is selected from natural language", () => {
  const selected = selectBookingService("quero agendar Alongamento Premium", {
    services: [{
      id: "service-1",
      name: "Alongamento Premium",
      active: true,
      ai_active: true,
      allow_auto_booking: true,
      offer_inventory_items: true,
      category_id: "category-1",
      hair_method_id: "method-1",
    }],
  });
  assert.equal(selected.offerInventoryItems, true);
  assert.equal(selected.categoryId, "category-1");
  assert.equal(selected.methodId, "method-1");
});

test("hydrates birth date and contact data from an existing client without overwriting state", () => {
  const state = { clientPhone: "5514999999999", clientName: "Nome mantido" };
  hydrateBookingContactFromClient(state, {
    full_name: "Cliente cadastrada",
    email: "cliente@example.test",
    cpf: "12345678901",
    birth_date: new Date("1990-05-10T00:00:00.000Z"),
  });
  assert.deepEqual(state, {
    clientPhone: "5514999999999",
    clientName: "Nome mantido",
    clientEmail: "cliente@example.test",
    clientCpf: "12345678901",
    clientBirthDate: "1990-05-10",
  });
});

test("recognizes requests to browse the backend service catalog", () => {
  assert.equal(isServiceCatalogMenuIntent("Serviços"), true);
  assert.equal(isServiceCatalogMenuIntent("Quero ver serviços"), true);
  assert.equal(isServiceCatalogMenuIntent("Quais serviços disponíveis"), true);
  assert.equal(isServiceCatalogMenuIntent("Que serviços vocês oferecem"), true);
  assert.equal(isServiceCatalogMenuIntent("Como funciona o serviço?"), false);
});

test("builds the initial catalog from active online services without requiring AI booking flags", () => {
  const base = {
    categories: [{ id: "cat-1", name: "Mega Hair" }],
    methods: [{ id: "method-1", name: "Ponto Americano" }],
    services: [
      {
        id: "service-visible",
        name: "Aplicacao completa",
        active: true,
        show_online_booking: true,
        ai_active: false,
        allow_auto_booking: false,
        category_id: "cat-1",
        hair_method_id: "method-1",
      },
      { id: "service-internal", name: "Servico interno", active: true, show_online_booking: false },
      { id: "service-inactive", name: "Servico inativo", active: false, show_online_booking: true },
    ],
  };
  const options = buildInitialServiceCatalogOptions(base);
  const categories = buildInitialCategoryCatalogOptions(base);

  assert.equal(options.length, 1);
  assert.equal(options[0].serviceName, "Aplicacao completa");
  assert.equal(options[0].categoryName, "Mega Hair");
  assert.equal(options[0].methodName, "Ponto Americano");
  assert.deepEqual(categories.map((item) => item.categoryName), ["Mega Hair"]);
});

test("parses dates written with a Portuguese month name", () => {
  assert.equal(parseBookingDateFromText("18/julho/2026"), "2026-07-18");
  assert.equal(parseBookingDateFromText("18 de julho de 2026"), "2026-07-18");
});

test("resets saved booking progress when the client starts over with a greeting", () => {
  assert.equal(
    shouldResetBookingStateOnGreeting("ola", {
      status: "awaiting_date",
      serviceId: "service-1",
      dateOptions: [{ id: 1, date: "2026-07-04" }],
    }),
    true,
  );
  assert.equal(
    shouldResetBookingStateOnGreeting("ol\u00e1", {
      status: "booked",
      appointmentId: "appointment-1",
    }),
    true,
  );
  assert.equal(
    shouldResetBookingStateOnGreeting("quero agendar", {
      status: "awaiting_date",
      serviceId: "service-1",
    }),
    false,
  );
  assert.equal(shouldResetBookingStateOnGreeting("ola", {}), false);
});

test("builds time-based greetings locally without AI", () => {
  assert.equal(isSimpleGreeting("bom dia, tudo bem?"), true);
  assert.equal(isSimpleGreeting("oi, quero agendar"), false);
  assert.equal(
    localGreetingForDate(new Date("2026-07-08T12:00:00.000Z"), "America/Sao_Paulo"),
    "Bom dia",
  );
  assert.equal(
    localGreetingForDate(new Date("2026-07-08T16:00:00.000Z"), "America/Sao_Paulo"),
    "Boa tarde",
  );
  assert.equal(
    localGreetingForDate(new Date("2026-07-08T23:30:00.000Z"), "America/Sao_Paulo"),
    "Boa noite",
  );
  assert.match(
    buildLocalGreetingResponse("boa noite", {
      date: new Date("2026-07-08T23:30:00.000Z"),
      timezone: "America/Sao_Paulo",
      salonName: "Carol Sol Mega Hair",
    }),
    /^Boa noite! Sou a assistente virtual da Carol Sol Mega Hair\./,
  );
  assert.match(
    buildLocalGreetingResponse("boa noite", {
      date: new Date("2026-07-08T16:00:00.000Z"),
      timezone: "America/Sao_Paulo",
      salonName: "Carol Sol Mega Hair",
    }),
    /^Boa noite!/,
  );
});

test("keeps AI replies scoped to salon and hair subjects", () => {
  assert.equal(isInAiServiceScope("Me passa uma receita de bolo"), false);
  assert.equal(isInAiServiceScope("Qual cuidado preciso ter com peruca lace?"), true);
  assert.equal(isInAiServiceScope("Quero saber valores e horários"), true);
  assert.equal(isInAiServiceScope("Tem promocao?"), true);
  assert.equal(buildOutOfScopeResponse("Tem promocao?"), "");
  assert.match(buildOutOfScopeResponse("receita de bolo"), /Mega Hair/i);
  assert.equal(buildOutOfScopeResponse("Quero agendar avaliação"), "");
});

test("keeps preenchimento de pontas inside salon scope", () => {
  assert.equal(isInAiServiceScope("Quanto esta pra preenchimento de pontas?"), true);
  assert.equal(buildOutOfScopeResponse("Quanto esta pra preenchimento de pontas?"), "");
});

test("normalizes Baileys inbound webhook payload safely", () => {
  const normalized = normalizeIncomingWhatsappPayload({
    from: "5514996405496@s.whatsapp.net",
    text: "Oi, quero atendimento",
    isFromMe: false,
    timestamp: 1710000000,
    raw: { key: { id: "ABC123" } },
  });

  assert.equal(normalized.phoneNumber, "5514996405496");
  assert.equal(normalized.text, "Oi, quero atendimento");
  assert.equal(normalized.isFromMe, false);
  assert.equal(normalized.isGroup, false);
  assert.equal(normalized.messageId, "ABC123");
  assert.equal(isMessageWebhookPayload(normalized.raw), true);
});

test("extracts text from raw Baileys message when text field is absent", () => {
  const normalized = normalizeIncomingWhatsappPayload({
    raw: {
      key: {
        id: "RAW1",
        remoteJid: "5511999999999@s.whatsapp.net",
        fromMe: false,
      },
      message: {
        extendedTextMessage: { text: "Quais serviços vocês têm?" },
      },
    },
  });

  assert.equal(normalized.phoneNumber, "5511999999999");
  assert.equal(normalized.text, "Quais serviços vocês têm?");
  assert.equal(normalized.messageId, "RAW1");
});

test("normalizes Evolution messages.upsert webhook payload safely", () => {
  const normalized = normalizeIncomingWhatsappPayload({
    event: "messages.upsert",
    instance: "carolsol",
    data: {
      key: {
        id: "EVO1",
        remoteJid: "5514996405496@s.whatsapp.net",
        fromMe: false,
      },
      message: {
        conversation: "Boa tarde, tem horario?",
      },
      messageTimestamp: 1710000000,
    },
  });

  assert.equal(normalized.sessionName, "carolsol");
  assert.equal(normalized.phoneNumber, "5514996405496");
  assert.equal(normalized.text, "Boa tarde, tem horario?");
  assert.equal(normalized.isFromMe, false);
  assert.equal(normalized.messageId, "EVO1");
});

test("uses explicit phone when Baileys remote JID is a LID", () => {
  const normalized = normalizeIncomingWhatsappPayload({
    from: "123456789012345@lid",
    phone: "5514996405496",
    text: "Teste privado",
    isFromMe: false,
    messageId: "LID1",
  });

  assert.equal(normalized.from, "123456789012345@lid");
  assert.equal(normalized.phoneNumber, "5514996405496");
  assert.equal(normalized.isGroup, false);
  assert.equal(normalized.messageId, "LID1");
});

test("extracts phone from raw.key.remoteJidAlt when remoteJid is a LID and phone is absent", () => {
  const normalized = normalizeIncomingWhatsappPayload({
    from: "123456789012345@lid",
    text: "Teste LID",
    isFromMe: false,
    messageId: "LID2",
    raw: {
      key: {
        id: "LID2",
        remoteJid: "123456789012345@lid",
        remoteJidAlt: "5514996405496@s.whatsapp.net",
        fromMe: false
      }
    }
  });

  assert.equal(normalized.from, "123456789012345@lid");
  assert.equal(normalized.phoneNumber, "5514996405496");
  assert.equal(normalized.isGroup, false);
  assert.equal(normalized.messageId, "LID2");
});

test("detects keywords ignoring accents and casing", () => {
  assert.equal(keywordInText("Quero falar com ATENDENTE agora", "atendente"), true);
  assert.equal(keywordInText("Pode voltar ao bot por favor?", "voltar ao bot"), true);
  assert.equal(keywordInText("Sem palavra especial", "atendente"), false);
});

test("checks AI service hours in Sao Paulo timezone", () => {
  const settings = {
    allow24h: false,
    aiStartTime: "09:00",
    aiEndTime: "18:00",
    timezone: "America/Sao_Paulo",
  };

  assert.equal(isWithinAiHours(settings, new Date("2026-06-24T15:00:00.000Z")), true);
  assert.equal(isWithinAiHours(settings, new Date("2026-06-24T23:00:00.000Z")), false);
  assert.equal(isWithinAiHours({ ...settings, allow24h: true }, new Date("2026-06-24T23:00:00.000Z")), true);
});

test("summarizes only real AI-enabled commercial data", () => {
  const context = summarizeAiCommercialContext({
    services: [
      {
        name: "Fita",
        commercial_name: "Mega Hair Fita",
        active: true,
        ai_active: true,
        base_price: 950,
        duration_minutes: 210,
      },
      {
        name: "Serviço interno",
        active: true,
        ai_active: false,
        base_price: 1,
      },
    ],
    plans: [{ name: "Gold", active: true, price: 599, billing_cycle: "monthly" }],
    coupons: [{ code: "CAROL15", active: true, description: "15% em produtos" }],
    promotions: [
      {
        title: "Mega Hair Fita Julho",
        active: true,
        promotional_value: 890,
        original_value: 1200,
        starts_at: "2026-07-01",
        ends_at: "2099-07-31",
        keywords: ["fita adesiva", "mega hair"],
      },
    ],
  });

  assert.match(context, /Mega Hair Fita/);
  assert.match(context, /R\$ 950\.00/);
  assert.match(context, /Gold/);
  assert.match(context, /CAROL15/);
  assert.match(context, /Mega Hair Fita Julho/);
  assert.match(context, /Promocoes ativas para WhatsApp/);
  assert.doesNotMatch(context, /Serviço interno/);
});

test("builds AI message with current input and booking progression rules", () => {
  const prompt = buildAiConversationMessage({
    incomingText: "Tem horário amanhã?",
    knownClient: true,
    commercialContext: "Serviços: nenhum serviço foi liberado.",
    history: [{ sender_type: "client", body: "Oi" }],
  });

  assert.match(prompt, /Mensagem atual da cliente:\s*Tem horário amanhã/i);
  assert.match(prompt, /avance pelo fluxo de pré-agendamento/i);
  assert.match(prompt, /Cliente já cadastrada: sim/);
  assert.doesNotMatch(prompt, /GEMINI_API_KEY/i);
  assert.doesNotMatch(prompt, /BAILEYS_API_KEY/i);
});

test("never truncates the current client message when context is long", () => {
  const prompt = buildAiConversationMessage({
    incomingText: "MENSAGEM_ATUAL_UNICA quero agendar na sexta à tarde",
    commercialContext: "C".repeat(5000),
    knowledgeContext: "K".repeat(5000),
    bookingGuidance: "Fluxo de pré-agendamento ativo.",
    history: Array.from({ length: 10 }, (_, index) => ({
      sender_type: index % 2 ? "ai" : "client",
      body: `Histórico ${index} ${"H".repeat(800)}`,
    })),
  });

  assert.ok(prompt.length <= 6000);
  assert.match(prompt, /MENSAGEM_ATUAL_UNICA/);
  assert.match(prompt, /não repita uma pergunta/i);
});

test("activates pre-booking and asks only for missing information", () => {
  const booking = buildBookingGuidance({
    incomingText: "Quero agendar uma aplicação",
    history: [],
    knownClient: false,
    settings: { allowAutoBooking: false },
  });

  assert.equal(booking.active, true);
  assert.equal(booking.shouldRegister, false);
  assert.match(booking.text, /somente UM dado faltante/i);
  assert.match(booking.text, /confirmação explícita/i);
});

test("registers a booking request only after an explicit confirmation", () => {
  const history = [
    {
      sender_type: "ai",
      body: "Resumo: manutenção na sexta à tarde. Posso registrar esta solicitação?",
    },
  ];
  const confirmed = buildBookingGuidance({
    incomingText: "Sim, pode registrar",
    history,
    knownClient: true,
    settings: { allowAutoBooking: false },
  });
  const unrelated = buildBookingGuidance({
    incomingText: "Qual a diferença entre fita e queratina?",
    history: [],
  });

  assert.equal(confirmed.shouldRegister, true);
  assert.match(confirmed.text, /backend registrará/i);
  assert.deepEqual(unrelated, { active: false, shouldRegister: false, text: "" });
});

test("builds local response for today's availability without promising schedule", () => {
  const response = buildLocalIntentResponse("Tem horário disponível pra hj?", {});

  assert.match(response, /horário de hoje/i);
  assert.match(response, /não vou prometer disponibilidade/i);
  assert.match(response, /agenda real/i);
  assert.match(response, /manhã, tarde ou noite/i);
});

test("builds local promotion response from active marketing promotions", () => {
  const response = buildLocalIntentResponse("Tem promocao de fita adesiva?", {
    promotions: [
      {
        title: "Mega Hair Fita Julho",
        description: "Aplicacao com valor especial",
        active: true,
        promotional_value: 890,
        original_value: 1200,
        starts_at: "2026-07-01",
        ends_at: "2099-07-31",
        keywords: ["promocao", "fita adesiva", "mega hair"],
      },
    ],
  });

  assert.match(response, /Mega Hair Fita Julho/);
  assert.match(response, /R\$\s?890/);
  assert.match(response, /Promocao valida ate/);
});

test("builds local promotion response even when specific terms do not match", () => {
  const response = buildLocalIntentResponse("Tem promocao de doacao de cabelo?", {
    promotions: [
      {
        title: "Mega Hair Fita Julho",
        description: "Aplicacao com valor especial",
        active: true,
        promotional_value: 890,
        original_value: 1200,
        starts_at: "2026-07-01",
        ends_at: "2099-07-31",
        keywords: ["fita adesiva", "mega hair"],
      },
    ],
  });

  assert.match(response, /Mega Hair Fita Julho/);
  assert.match(response, /R\$\s?890/);
  assert.doesNotMatch(response, /No momento nao temos promocoes cadastradas/);
  assert.doesNotMatch(response, /No momento nao encontrei promocao ativa/);
});

test("builds local promotion response when no promotions are active", () => {
  const response = buildLocalIntentResponse("Tem promocao?", { promotions: [] });

  assert.match(response, /No momento nao temos promocoes cadastradas/);
  assert.match(response, /valores normais/);
  assert.doesNotMatch(response, /Consigo te ajudar apenas com assuntos/);
});

test("price intent includes related active promotion when service matches", () => {
  const response = buildLocalIntentResponse("Quanto custa a fita adesiva?", {
    services: [
      {
        name: "Aplicacao Fita Adesiva",
        commercial_name: "Aplicacao Fita Adesiva",
        active: true,
        ai_active: true,
        base_price: 1200,
      },
    ],
    promotions: [
      {
        title: "Fita Adesiva Julho",
        active: true,
        promotional_value: 890,
        original_value: 1200,
        ends_at: "2099-07-31",
        keywords: ["fita adesiva"],
      },
    ],
  });

  assert.match(response, /Aplicacao Fita Adesiva custa a partir de/);
  assert.match(response, /Fita Adesiva Julho/);
  assert.match(response, /R\$\s?890/);
});

test("price intent describes free services as sem custo", () => {
  const response = buildLocalIntentResponse("Quanto custa a avaliacao?", {
    services: [
      {
        name: "Avaliacao personalizada",
        commercial_name: "Avaliacao personalizada",
        active: true,
        ai_active: true,
        base_price: 0,
        is_free: true,
      },
    ],
    promotions: [],
  });

  assert.match(response, /Avaliacao personalizada nao tem custo/);
  assert.doesNotMatch(response, /sob consulta/);
});

test("detects natural agenda availability questions before AI routing", () => {
  assert.equal(isAgendaAvailabilityIntent("Tem horario para sabado?"), true);
  assert.equal(isAgendaAvailabilityIntent("Consegue encaixe sexta a tarde?"), true);
  assert.equal(isAgendaAvailabilityIntent("Oi, qual valor do microlink?"), false);
});

test("prioritizes pending booking answers written in natural language", () => {
  assert.equal(
    shouldPrioritizeBookingState(
      "Hoje a tarde",
      {
        status: "awaiting_date",
        serviceId: "service-1",
        serviceName: "Aplicacao Fita Adesiva",
      },
      [{ sender_type: "ai", body: "Qual dia voce deseja?" }],
    ),
    true,
  );
  assert.equal(
    shouldPrioritizeBookingState(
      "Quanto custa a manutencao?",
      {
        status: "awaiting_date",
        serviceId: "service-1",
      },
      [],
    ),
    false,
  );
  assert.equal(
    shouldPrioritizeBookingState(
      "Sábado 17h",
      {},
      [{ sender_type: "ai", body: "Ponto Americano Invisível. Qual é a data preferida para o serviço?" }],
    ),
    true,
  );
});

test("routes fibra russa questions to the AI provider instead of a fixed local reply", () => {
  const response = buildLocalIntentResponse("Você faz aplicação de fibra russa?", {
    services: [
      {
        name: "Aplicação Fibra Russa",
        commercial_name: "Fibra Russa",
        active: true,
        ai_active: true,
      },
    ],
  });

  assert.equal(response, null);
});

test("isClientAskingQuestion classifies questions correctly", () => {
  assert.equal(isClientAskingQuestion("Qual o valor do mega?"), true);
  assert.equal(isClientAskingQuestion("Como funciona o microlink"), true);
  assert.equal(isClientAskingQuestion("Quero agendar por favor"), false);
});

test("isClientChangingSubjectOrNegating classifies negations correctly", () => {
  assert.equal(isClientChangingSubjectOrNegating("Não quero agendar mais"), true);
  assert.equal(isClientChangingSubjectOrNegating("Só quero tirar uma dúvida"), true);
  assert.equal(isClientChangingSubjectOrNegating("sim"), false);
});

test("isReplyingToExplanationOffer detects confirmations to explanation offers", () => {
  const historyOffer = [
    { sender_type: "ai", body: "Posso explicar a diferença das técnicas. Gostaria?" }
  ];
  const historyBooking = [
    { sender_type: "ai", body: "Você confirma o pré-agendamento acima?" }
  ];
  assert.equal(isReplyingToExplanationOffer("sim", historyOffer), true);
  assert.equal(isReplyingToExplanationOffer("sim", historyBooking), false);
});

test("summarizeAiCommercialContext includes active inventory stock", () => {
  const base = {
    services: [
      { id: "serv-1", name: "Alongamento", category_id: "cat-1", offer_inventory_items: true, active: true, ai_active: true }
    ],
    plans: [],
    coupons: [],
    flows: [],
    inventory: [
      { name: "Cabelo Loiro Premium", category: "Cabelos", category_id: "cat-1", color: "Loiro Claro", shade: "9.0", length_cm: 65, weight_grams: 100, quantity: 5 }
    ]
  };
  const summary = summarizeAiCommercialContext(base, {});
  assert.match(summary, /Variações de Cabelos e mechas/);
  assert.match(summary, /Loiro Claro/);
  assert.match(summary, /Disponível: 5 un/);
  assert.match(summary, /Nunca invente produto, preço, disponibilidade/);
});

test("getAgendaAvailabilityContext formats slots when asking for agenda", async () => {
  const base = {
    services: [
      { id: "e3cb1e22-861f-4958-868c-4bc46a6f44d1", name: "Avaliação", commercial_name: "Avaliação Técnica", duration_minutes: 30, base_price: 0, active: true, ai_active: true, allow_auto_booking: true }
    ]
  };

  // Mock client database query
  const mockClientQuery = async (sql, params) => {
    if (sql.includes("public.services")) {
      return { rows: [{ id: "e3cb1e22-861f-4958-868c-4bc46a6f44d1", name: "Avaliação", duration_minutes: 30, base_price: 0, active: true }] };
    }
    if (sql.includes("public.professionals")) {
      return { rows: [{ id: "p1", full_name: "Carol Sol" }] };
    }
    if (sql.includes("professional_availability")) {
      return { rows: [{ starts_at: "09:00", ends_at: "18:00", active: true }] };
    }
    if (sql.includes("appointments")) {
      return { rows: [] };
    }
    return { rows: [] };
  };

  const context = await getAgendaAvailabilityContext(
    { query: mockClientQuery },
    "Tem vaga amanhã?",
    base,
    {}
  );
  assert.match(context, /CONSULTA DE AGENDA REAL/);
  assert.match(context, /Carol Sol/);
});

test("isClientExitingFlow classifies exit phrases correctly", () => {
  assert.equal(isClientExitingFlow("depois eu agendo"), true);
  assert.equal(isClientExitingFlow("era só uma dúvida"), true);
  assert.equal(isClientExitingFlow("obrigado"), true);
  assert.equal(isClientExitingFlow("quero agendar"), false);
});

test("buildBookingGuidance handles paused booking flow when has question", () => {
  const booking = buildBookingGuidance({
    incomingText: "Vocês trabalham com queratina?",
    history: [],
    knownClient: true,
    settings: {},
    currentState: { serviceId: "s1", serviceName: "Microlink", date: "2026-07-10" }
  });
  assert.equal(booking.active, true);
  assert.equal(booking.shouldRegister, false);
  assert.match(booking.text, /Microlink/);
  assert.match(booking.text, /Campos ja salvos/i);
  assert.match(booking.text, /Proximo campo faltante: horario/i);
  assert.match(booking.text, /nunca pergunte novamente campo preenchido/i);
});

test("handleStructuredBookingFlow shows service details after service selection", async () => {
  const sentTexts = [];
  const savedStates = [];
  pool.query = async (sql, params = []) => {
    if (sql.includes("update public.whatsapp_conversations") && sql.includes("booking_state=$2")) {
      savedStates.push(JSON.parse(params[1]));
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes("insert into public.whatsapp_messages")) {
      return { rowCount: 1, rows: [{ id: "outbound-1" }] };
    }
    if (sql.includes("insert into public.whatsapp_message_logs")) {
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes("insert into public.ai_request_logs")) {
      return { rowCount: 1, rows: [] };
    }
    return { rowCount: 1, rows: [{ id: "generic-id" }] };
  };
  pool.connect = async () => ({
    query: async (sql, params = []) => {
      if (["begin", "commit", "rollback"].includes(String(sql).toLowerCase())) {
        return { rowCount: 0, rows: [] };
      }
      return pool.query(sql, params);
    },
    release: () => {},
  });
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes("/api/send-text")) {
      sentTexts.push(JSON.parse(options.body || "{}").text || "");
      return new Response(JSON.stringify({ success: true, messageId: "msg-service-details" }));
    }
    return new Response(JSON.stringify({ success: true }));
  };
  process.env.BAILEYS_API_URL = "https://baileys.example.test";
  process.env.BAILEYS_API_KEY = "test-key";

  const serviceOption = {
    id: 1,
    serviceId: "svc-avaliacao",
    serviceName: "Avaliacao personalizada",
    requestedServiceName: "Avaliacao personalizada",
    serviceValue: 0,
    serviceIsFree: true,
    serviceDescription: "Diagnostico capilar com especialista.",
    serviceDurationMinutes: 45,
    serviceDepositAmount: 0,
  };

  const response = await handleStructuredBookingFlow({
    normalized: { phoneNumber: "5511999999999" },
    conversationId: "conversation-1",
    inboundMessageId: "inbound-1",
    text: "1",
    settings: { allowAutoBooking: true },
    base: {
      flows: [{ flow_key: "pre_agendamento", enabled: true }],
      services: [],
    },
    recorded: {
      conversation: {
        booking_state: JSON.stringify({
          status: "awaiting_service",
          serviceOptions: [serviceOption],
        }),
      },
    },
    queueLatencyMs: 0,
    receivedAt: new Date(),
    history: [],
  });

  assert.equal(response.reason, "booking_service_details");
  assert.equal(savedStates.at(-1).status, "awaiting_service_details");
  assert.match(sentTexts.at(-1), /Avaliacao personalizada/);
  assert.match(sentTexts.at(-1), /Diagnostico capilar/);
  assert.match(sentTexts.at(-1), /Duracao: 45 minutos/);
  assert.match(sentTexts.at(-1), /Valor: sem custo/);
  assert.match(sentTexts.at(-1), /1\) Sim/);
  assert.match(sentTexts.at(-1), /2\) Escolher outro servico/);
});

test("handleStructuredBookingFlow shows service presentation together with inventory choices", async () => {
  const sentTexts = [];
  const savedStates = [];
  pool.query = async (sql, params = []) => {
    if (sql.includes("update public.whatsapp_conversations") && sql.includes("booking_state=$2")) {
      savedStates.push(JSON.parse(params[1]));
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes("insert into public.whatsapp_messages")) {
      return { rowCount: 1, rows: [{ id: "outbound-inventory" }] };
    }
    return { rowCount: 1, rows: [{ id: "generic-id" }] };
  };
  pool.connect = async () => ({
    query: async (sql, params = []) => {
      if (["begin", "commit", "rollback"].includes(String(sql).toLowerCase())) {
        return { rowCount: 0, rows: [] };
      }
      return pool.query(sql, params);
    },
    release: () => {},
  });
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes("/api/send-text")) {
      sentTexts.push(JSON.parse(options.body || "{}").text || "");
      return new Response(JSON.stringify({ success: true, messageId: "msg-inventory" }));
    }
    return new Response(JSON.stringify({ success: true }));
  };
  process.env.BAILEYS_API_URL = "https://baileys.example.test";
  process.env.BAILEYS_API_KEY = "test-key";

  const request = {
    normalized: { phoneNumber: "5511999999999" },
    conversationId: "conversation-inventory",
    inboundMessageId: "inbound-inventory",
    text: "1",
    settings: { allowAutoBooking: false },
    base: {
      flows: [{ flow_key: "pre_agendamento", enabled: true }],
      categories: [{ id: "category-fibra", name: "Fibra Russa" }],
      methods: [{ id: "method-aplicacao", name: "Ponto Americano", category_id: "category-fibra" }],
      services: [{
        id: "service-point",
        name: "Ponto Americano Invisível",
        commercial_name: "Ponto Americano Invisível",
        description: "Aplicação em costura invisível.",
        active: true,
        ai_active: true,
        allow_auto_booking: true,
        offer_inventory_items: true,
        category_id: "category-fibra",
        hair_method_id: "method-aplicacao",
        duration_minutes: 150,
      }],
      inventory: [{
        id: "inventory-fib-002",
        active: true,
        quantity: 1,
        category_id: "category-fibra",
        hair_method_id: "method-aplicacao",
        color: "Castanho Médio",
        length_cm: "60/65/70",
        weight_grams: 150,
        suggested_price: 410,
      }],
    },
    recorded: {
      conversation: {
        booking_state: JSON.stringify({
          status: "awaiting_category",
          categoryOptions: [{ id: 1, categoryId: "category-fibra", categoryName: "Fibra Russa" }],
        }),
        last_message_preview: "1) Fibra Russa",
      },
    },
    queueLatencyMs: 0,
    receivedAt: new Date(),
    history: [],
    forceCatalogFlow: true,
  };

  const response = await handleStructuredBookingFlow(request);

  assert.equal(response.reason, "booking_inventory_options");
  assert.equal(savedStates.at(-1).status, "awaiting_inventory");
  assert.match(sentTexts.at(-1), /Ponto Americano Invis/);
  assert.match(sentTexts.at(-1), /costura invis/);
  assert.match(sentTexts.at(-1), /Castanho Médio/);
  assert.match(sentTexts.at(-1), /60\/65\/70 cm/);
  assert.match(sentTexts.at(-1), /150 g/);
  assert.match(sentTexts.at(-1), /410/);
});

test("handleStructuredBookingFlow does not replace WhatsApp phone with CPF", async () => {
  const sentTexts = [];
  const savedStates = [];
  pool.query = async (sql, params = []) => {
    if (sql.includes("update public.whatsapp_conversations") && sql.includes("booking_state=$2")) {
      savedStates.push(JSON.parse(params[1]));
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes("insert into public.whatsapp_messages")) {
      return { rowCount: 1, rows: [{ id: "outbound-cpf" }] };
    }
    if (sql.includes("insert into public.whatsapp_message_logs")) {
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes("insert into public.ai_request_logs")) {
      return { rowCount: 1, rows: [] };
    }
    return { rowCount: 1, rows: [{ id: "generic-id" }] };
  };
  pool.connect = async () => ({
    query: async (sql, params = []) => {
      if (["begin", "commit", "rollback"].includes(String(sql).toLowerCase())) {
        return { rowCount: 0, rows: [] };
      }
      return pool.query(sql, params);
    },
    release: () => {},
  });
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes("/api/send-text")) {
      sentTexts.push(JSON.parse(options.body || "{}").text || "");
      return new Response(JSON.stringify({ success: true, messageId: "msg-cpf" }));
    }
    return new Response(JSON.stringify({ success: true }));
  };
  process.env.BAILEYS_API_URL = "https://baileys.example.test";
  process.env.BAILEYS_API_KEY = "test-key";

  const response = await handleStructuredBookingFlow({
    normalized: { phoneNumber: "5511999999999" },
    conversationId: "conversation-cpf",
    inboundMessageId: "inbound-cpf",
    text: "12345678901",
    settings: { allowAutoBooking: true },
    base: {
      flows: [{ flow_key: "pre_agendamento", enabled: true }],
      services: [],
    },
    recorded: {
      conversation: {
        booking_state: JSON.stringify({
          status: "awaiting_contact",
          serviceId: "svc-avaliacao",
          serviceName: "Avaliacao personalizada",
          serviceValue: 0,
          serviceIsFree: true,
          serviceDetailsAccepted: true,
          date: "2026-07-13",
          time: "09:00",
          professionalId: "prof-1",
          professionalName: "Carol Sol",
          clientName: "Maria Silva",
          clientEmail: "maria@example.test",
          clientPhone: "5511999999999",
          clientBirthDate: "1990-05-10",
        }),
      },
    },
    queueLatencyMs: 0,
    receivedAt: new Date(),
    history: [],
  });

  assert.equal(response.reason, "booking_confirmation_request");
  assert.equal(savedStates.at(-1).clientCpf, "12345678901");
  assert.equal(savedStates.at(-1).clientPhone, "5511999999999");
  assert.match(sentTexts.at(-1), /CPF: 12345678901/);
  assert.match(sentTexts.at(-1), /Telefone: 5511999999999/);
});

test("handleStructuredBookingFlow may repeat a structured menu without falling back to AI", async () => {
  const sentTexts = [];
  pool.query = async (sql) => {
    if (sql.includes("insert into public.whatsapp_messages")) {
      return { rowCount: 1, rows: [{ id: "outbound-repeated-menu" }] };
    }
    return { rowCount: 1, rows: [{ id: "generic-id" }] };
  };
  pool.connect = async () => ({
    query: async (sql, params = []) => {
      if (["begin", "commit", "rollback"].includes(String(sql).toLowerCase())) {
        return { rowCount: 0, rows: [] };
      }
      return pool.query(sql, params);
    },
    release: () => {},
  });
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes("/api/send-text")) {
      sentTexts.push(JSON.parse(options.body || "{}").text || "");
    }
    return new Response(JSON.stringify({ success: true, messageId: "msg-repeated-menu" }));
  };
  process.env.BAILEYS_API_URL = "https://baileys.example.test";
  process.env.BAILEYS_API_KEY = "test-key";
  const base = {
    services: [
      { id: "s1", name: "Avaliacao", duration_minutes: 30, base_price: 0, active: true },
      { id: "s2", name: "Ponto Americano", duration_minutes: 120, base_price: 410, active: true },
    ],
  };
  const history = [
    { sender_type: "ai", body: "Escolha o servico respondendo so com o numero:\n\n1) Avaliacao\n2) Ponto Americano" },
  ];
  const response = await handleStructuredBookingFlow({
    normalized: { phoneNumber: "5511999999999" },
    conversationId: "c1",
    inboundMessageId: "m1",
    text: "qualquer entrada nao parseavel para forçar repetição do menu",
    settings: { allowAutoBooking: true },
    base,
    recorded: { conversation: { booking_state: JSON.stringify({ status: "awaiting_service" }) } },
    queueLatencyMs: 0,
    receivedAt: new Date(),
    history
  });
  assert.equal(response.reason, "booking_service_options");
  assert.match(sentTexts.at(-1), /Avaliacao/);
  assert.match(sentTexts.at(-1), /Ponto Americano/);
});

test("rejects Evolution messages.update event as non-message webhook", () => {
  // messages.update é enviado pela Evolution para confirmar entrega/leitura.
  // O bot NÃO deve processar esses eventos como mensagens novas.
  const updatePayload = {
    event: "messages.update",
    instance: "carolsol",
    data: [
      {
        key: {
          id: "EVO_MSG1",
          remoteJid: "5514996405496@s.whatsapp.net",
          fromMe: true,
        },
        update: { status: 4 }, // DELIVERED
      },
    ],
  };

  assert.equal(isMessageWebhookPayload(updatePayload), false);
});

test("rejects Evolution connection.update event as non-message webhook", () => {
  const connectionPayload = {
    event: "connection.update",
    instance: "carolsol",
    data: { state: "open", statusReason: 200 },
  };

  assert.equal(isMessageWebhookPayload(connectionPayload), false);
});

test("rejects Evolution qrcode.updated event as non-message webhook", () => {
  const qrPayload = {
    event: "qrcode.updated",
    instance: "carolsol",
    data: { qrcode: { base64: "data:image/png;base64,..." } },
  };

  assert.equal(isMessageWebhookPayload(qrPayload), false);
});

test("rejects Evolution application.startup event as non-message webhook", () => {
  const startupPayload = {
    event: "application.startup",
    instance: "carolsol",
    data: {},
  };

  assert.equal(isMessageWebhookPayload(startupPayload), false);
});

test("accepts Evolution messages.upsert event as valid message webhook", () => {
  const upsertPayload = {
    event: "messages.upsert",
    instance: "carolsol",
    data: {
      key: {
        id: "EVO_UPSERT1",
        remoteJid: "5514996405496@s.whatsapp.net",
        fromMe: false,
      },
      message: { conversation: "Oi, quero agendar" },
      messageTimestamp: 1710000000,
    },
  };

  assert.equal(isMessageWebhookPayload(upsertPayload), true);
});

test("detects isFromMe=true when Evolution sends data as array (messages.update format)", () => {
  // Quando payload.data é um array, é formato de status de entrega.
  // Mesmo que fromMe não esteja explícito, deve ser tratado como isFromMe=true.
  const arrayPayload = {
    event: "messages.update",
    instance: "carolsol",
    data: [
      {
        key: {
          id: "EVO_STATUS1",
          remoteJid: "5514996405496@s.whatsapp.net",
          fromMe: true,
        },
        update: { status: 4 },
      },
    ],
  };

  const normalized = normalizeIncomingWhatsappPayload(arrayPayload);
  assert.equal(normalized.isFromMe, true);
});

test("payloads without event field still work (Baileys direct format)", () => {
  // Compatibilidade com payloads do Baileys sem campo event
  const baileysPayload = {
    from: "5514996405496@s.whatsapp.net",
    text: "Bom dia",
    isFromMe: false,
    raw: { key: { id: "BAILEYS1" } },
  };

  assert.equal(isMessageWebhookPayload(baileysPayload), true);
});
