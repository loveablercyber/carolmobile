const ANSWER_FIELDS = [
  "objective",
  "length",
  "color",
  "chemistry",
  "used",
  "budget",
  "frequency",
  "method",
];

const text = (value, max = 700) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const searchKey = (value) =>
  text(value, 240)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const amount = (value) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};

const measurement = (value) => {
  const match = String(value ?? "").match(/\d+(?:[.,]\d+)?/);
  return match ? Number(match[0].replace(",", ".")) : 0;
};

function budgetLimit(value) {
  const normalized = searchKey(value);
  if (normalized.includes("ate r$ 1.000")) return 1000;
  if (normalized.includes("1.000 a r$ 2.000")) return 2000;
  if (normalized.includes("2.000 a r$ 3.500")) return 3500;
  return 0;
}

function serviceScore(service, answers) {
  const name = searchKey(`${service.name} ${service.description}`);
  const method = searchKey(answers.method);
  const objective = searchKey(answers.objective);
  let score = 0;

  if (method && !method.includes("sem preferencia") && name.includes(method)) score += 80;
  if (objective.includes("avaliacao") && name.includes("avaliacao")) score += 70;
  if (objective.includes("manutencao") && name.includes("manutencao")) score += 60;
  if (objective.includes("remocao") && name.includes("remocao")) score += 60;
  if (objective.includes("correcao") && (name.includes("correcao") || name.includes("reparo"))) score += 60;
  if (
    (objective.includes("volume") || objective.includes("comprimento") || objective.includes("transformacao")) &&
    service.offer_inventory_items
  ) score += 35;

  const limit = budgetLimit(answers.budget);
  if (limit && amount(service.base_price) <= limit) score += 8;
  return score;
}

export function normalizeDiscoveryAnswers(input = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  return Object.fromEntries(
    ANSWER_FIELDS.map((field) => [field, text(source[field], 160)]).filter(([, value]) => value),
  );
}

export function inventoryMatchesService(item = {}, service = {}) {
  if (!service.offer_inventory_items || !service.category_id) return false;
  if (item.category_id !== service.category_id) return false;
  if (service.hair_method_id && item.hair_method_id !== service.hair_method_id) return false;
  return item.active !== false && amount(item.quantity) > 0;
}

export function inventoryForDiscoveryService(service = {}, inventory = []) {
  return (Array.isArray(inventory) ? inventory : []).filter((item) =>
    inventoryMatchesService(item, service),
  );
}

export function bookableDiscoveryServices(services = [], inventory = []) {
  return (Array.isArray(services) ? services : []).filter(
    (service) =>
      !service.offer_inventory_items ||
      inventoryForDiscoveryService(service, inventory).length > 0,
  );
}

export function suggestedInventoryForDiscoveryService(service = {}, inventory = [], answers = {}) {
  const objective = searchKey(answers.objective);
  const preferredColor = searchKey(answers.color);
  const limit = budgetLimit(answers.budget);

  return [...inventoryForDiscoveryService(service, inventory)].sort((left, right) => {
    const score = (item) => {
      let value = 0;
      const itemColor = searchKey(`${item.color} ${item.shade}`);
      if (preferredColor && itemColor.includes(preferredColor)) value += 80;
      if (objective.includes("comprimento")) value += measurement(item.length_cm);
      if (objective.includes("volume")) value += measurement(item.weight_grams);
      if (limit && amount(item.suggested_price) <= limit) value += 15;
      return value;
    };
    return score(right) - score(left) || amount(left.suggested_price) - amount(right.suggested_price);
  })[0] || null;
}

export function fallbackDiscoveryRecommendation({ services = [], inventory = [], answers = {} } = {}) {
  const normalizedAnswers = normalizeDiscoveryAnswers(answers);
  const service = [...services]
    .sort((left, right) => serviceScore(right, normalizedAnswers) - serviceScore(left, normalizedAnswers))[0] || null;
  const inventoryItem = service
    ? suggestedInventoryForDiscoveryService(service, inventory, normalizedAnswers)
    : null;
  const objective = normalizedAnswers.objective || "resultado desejado";
  const serviceName = service?.name || "avaliacao personalizada";

  return {
    service,
    inventoryItem,
    personalizedMessage: `Considerando seu objetivo de ${objective}, a sugestão inicial é ${serviceName}. A avaliação presencial confirma a saúde dos fios, a técnica e o acabamento ideal para você.`,
  };
}

export function parseDiscoveryRecommendationJson(value) {
  const raw = String(value || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return {
      serviceId: text(parsed.serviceId, 80),
      inventoryItemId: text(parsed.inventoryItemId, 80),
      personalizedMessage: text(parsed.personalizedMessage, 700),
    };
  } catch {
    return null;
  }
}

export function safeAiDiscoveryMessage(value) {
  const message = text(value, 700);
  if (!message) return "";
  if (/(?:r\$\s*\d|\b\d+(?:[.,]\d+)?\s*(?:cm|g|gramas?|minutos?))/i.test(message)) return "";
  return message;
}

export function publicDiscoveryService(service = {}) {
  return {
    id: String(service.id || ""),
    name: text(service.name, 160),
    description: text(service.description, 700),
    duration_minutes: amount(service.duration_minutes),
    base_price: amount(service.base_price),
    deposit_amount: amount(service.deposit_amount),
    is_free: service.is_free === true,
    offer_inventory_items: service.offer_inventory_items === true,
    category_id: service.category_id || null,
    hair_method_id: service.hair_method_id || null,
  };
}

export function publicDiscoveryInventoryItem(item) {
  if (!item) return null;
  return {
    id: String(item.id || ""),
    color: text(item.color, 100),
    shade: text(item.shade, 100),
    length_cm: text(item.length_cm, 60),
    texture: text(item.texture, 100),
    weight_grams: amount(item.weight_grams),
    suggested_price: amount(item.suggested_price),
  };
}
