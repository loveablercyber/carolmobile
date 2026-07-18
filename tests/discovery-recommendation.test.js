import assert from "node:assert/strict";
import test from "node:test";

import {
  bookableDiscoveryServices,
  fallbackDiscoveryRecommendation,
  parseDiscoveryRecommendationJson,
  safeAiDiscoveryMessage,
} from "../server/lib/discovery-recommendation.js";

const services = [
  {
    id: "service-fita",
    name: "Aplicacao Fita Adesiva",
    description: "Aplicacao de fita adesiva.",
    active: true,
    offer_inventory_items: true,
    category_id: "category-fita",
    hair_method_id: "method-fita",
    base_price: 360,
  },
  {
    id: "service-micro",
    name: "Microlink",
    description: "Aplicacao Microlink.",
    active: true,
    offer_inventory_items: false,
    category_id: "category-micro",
    hair_method_id: "method-micro",
    base_price: 420,
  },
];

const inventory = [
  {
    id: "item-50",
    active: true,
    quantity: 1,
    category_id: "category-fita",
    hair_method_id: "method-fita",
    color: "Castanho claro",
    length_cm: "50cm",
    weight_grams: 120,
    suggested_price: 980,
  },
  {
    id: "item-60",
    active: true,
    quantity: 1,
    category_id: "category-fita",
    hair_method_id: "method-fita",
    color: "Castanho claro",
    length_cm: "60cm",
    weight_grams: 150,
    suggested_price: 1200,
  },
  {
    id: "item-other-service",
    active: true,
    quantity: 1,
    category_id: "category-micro",
    hair_method_id: "method-micro",
    color: "Castanho claro",
    length_cm: "70cm",
    weight_grams: 180,
    suggested_price: 1300,
  },
];

test("fallbackDiscoveryRecommendation uses an active matching service and catalog inventory", () => {
  const recommendation = fallbackDiscoveryRecommendation({
    services,
    inventory,
    answers: {
      objective: "Mais comprimento",
      method: "Fita Adesiva",
      color: "Castanho claro",
    },
  });

  assert.equal(recommendation.service.id, "service-fita");
  assert.equal(recommendation.inventoryItem.id, "item-60");
});

test("bookableDiscoveryServices excludes inventory services without available matching stock", () => {
  const bookable = bookableDiscoveryServices(
    [...services, { ...services[0], id: "service-without-stock", category_id: "empty-category" }],
    inventory,
  );
  assert.deepEqual(bookable.map((service) => service.id), ["service-fita", "service-micro"]);
});

test("parseDiscoveryRecommendationJson accepts structured AI output and rejects unsafe pricing text", () => {
  const parsed = parseDiscoveryRecommendationJson(
    '```json\n{"serviceId":"service-fita","inventoryItemId":"item-60","personalizedMessage":"Uma opcao inicial alinhada ao seu objetivo."}\n```',
  );
  assert.equal(parsed.serviceId, "service-fita");
  assert.equal(parsed.inventoryItemId, "item-60");
  assert.equal(
    safeAiDiscoveryMessage(parsed.personalizedMessage),
    "Uma opcao inicial alinhada ao seu objetivo.",
  );
  assert.equal(safeAiDiscoveryMessage("O valor e R$ 1.200."), "");
});
