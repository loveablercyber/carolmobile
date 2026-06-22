import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateInventoryChanges,
  technicalRecordAppointmentStatuses,
  technicalRecordInput,
} from "../server/lib/technical-record-rules.js";
import { extractPublicId } from "../server/lib/integrations.js";

const appointmentId = "11111111-1111-4111-8111-111111111111";

test("normalizes a valid technical record", () => {
  const { value, error } = technicalRecordInput({
    appointmentId,
    strandsCount: "120",
    weightGrams: "140.5",
    color: " Castanho ",
    productsUsed: [" Sérum ", "Protetor térmico"],
    nextMaintenanceDate: "2026-08-15",
    paymentStatus: "paid",
    photos: [{ kind: "before", url: "https://cdn.example/before.jpg" }],
  });
  assert.equal(error, "");
  assert.equal(value.strandsCount, 120);
  assert.equal(value.weightGrams, 140.5);
  assert.equal(value.color, "Castanho");
  assert.deepEqual(value.productsUsed, ["Sérum", "Protetor térmico"]);
  assert.equal(value.photos[0].kind, "before");
});

test("rejects invalid identifiers and blank records", () => {
  assert.match(technicalRecordInput({ appointmentId: "123" }).error, /Atendimento/);
  assert.match(technicalRecordInput({ appointmentId }).error, /ao menos um dado/);
  assert.match(
    technicalRecordInput({ appointmentId, color: "Preto", hairMethodId: "x" })
      .error,
    /Método/,
  );
});

test("rejects unsafe numeric values", () => {
  assert.match(
    technicalRecordInput({ appointmentId, strandsCount: "2.5" }).error,
    /numéricos/,
  );
  assert.match(
    technicalRecordInput({ appointmentId, weightGrams: "-1" }).error,
    /numéricos/,
  );
  assert.match(
    technicalRecordInput({ appointmentId, lengthCm: "301" }).error,
    /numéricos/,
  );
});

test("rejects invalid dates, payment states and photo metadata", () => {
  assert.match(
    technicalRecordInput({
      appointmentId,
      color: "Preto",
      nextMaintenanceDate: "2026-02-30",
    }).error,
    /Data/,
  );
  assert.match(
    technicalRecordInput({ appointmentId, color: "Preto", paymentStatus: "ok" })
      .error,
    /pagamento/,
  );
  assert.match(
    technicalRecordInput({
      appointmentId,
      color: "Preto",
      photos: [{ kind: "profile", url: "http://example.test/a.jpg" }],
    }).error,
    /Anexo/,
  );
});

test("limits record creation to service-related appointment states", () => {
  assert.deepEqual([...technicalRecordAppointmentStatuses], [
    "confirmed",
    "in_service",
    "completed",
  ]);
});

test("calculateInventoryChanges - Consumo válido", () => {
  const result = calculateInventoryChanges({
    oldRecord: null,
    newRecord: {
      hairInventoryId: "80000000-0000-0000-0000-000000000001",
      hairInventoryQty: 2,
      productConsumptions: [{ productId: "81000000-0000-0000-0000-000000000001", quantity: 3 }]
    },
    hairInventory: [{ id: "80000000-0000-0000-0000-000000000001", quantity: 5 }],
    products: [{ id: "81000000-0000-0000-0000-000000000001", stock_quantity: 10 }]
  });
  assert.equal(result.error, null);
  assert.deepEqual(result.hairUpdates, [{ id: "80000000-0000-0000-0000-000000000001", delta: -2 }]);
  assert.deepEqual(result.productUpdates, [{ id: "81000000-0000-0000-0000-000000000001", delta: -3 }]);
  assert.deepEqual(result.movements, [{
    inventory_id: "80000000-0000-0000-0000-000000000001",
    kind: "consume",
    quantity: 2
  }]);
});

test("calculateInventoryChanges - Saldo insuficiente", () => {
  const result = calculateInventoryChanges({
    oldRecord: null,
    newRecord: {
      hairInventoryId: "80000000-0000-0000-0000-000000000001",
      hairInventoryQty: 6,
      productConsumptions: []
    },
    hairInventory: [{ id: "80000000-0000-0000-0000-000000000001", quantity: 5 }],
    products: []
  });
  assert.match(result.error, /insuficiente/);
});

test("calculateInventoryChanges - Edição aumentando consumo", () => {
  const result = calculateInventoryChanges({
    oldRecord: {
      hairInventoryId: "80000000-0000-0000-0000-000000000001",
      hairInventoryQty: 2,
      productConsumptions: [{ productId: "81000000-0000-0000-0000-000000000001", quantity: 1 }]
    },
    newRecord: {
      hairInventoryId: "80000000-0000-0000-0000-000000000001",
      hairInventoryQty: 5,
      productConsumptions: [{ productId: "81000000-0000-0000-0000-000000000001", quantity: 3 }]
    },
    hairInventory: [{ id: "80000000-0000-0000-0000-000000000001", quantity: 10 }],
    products: [{ id: "81000000-0000-0000-0000-000000000001", stock_quantity: 10 }]
  });
  assert.equal(result.error, null);
  assert.deepEqual(result.hairUpdates, [{ id: "80000000-0000-0000-0000-000000000001", delta: -3 }]);
  assert.deepEqual(result.productUpdates, [{ id: "81000000-0000-0000-0000-000000000001", delta: -2 }]);
  assert.deepEqual(result.movements, [{
    inventory_id: "80000000-0000-0000-0000-000000000001",
    kind: "consume",
    quantity: 3
  }]);
});

test("calculateInventoryChanges - Edição reduzindo consumo", () => {
  const result = calculateInventoryChanges({
    oldRecord: {
      hairInventoryId: "80000000-0000-0000-0000-000000000001",
      hairInventoryQty: 4,
      productConsumptions: [{ productId: "81000000-0000-0000-0000-000000000001", quantity: 3 }]
    },
    newRecord: {
      hairInventoryId: "80000000-0000-0000-0000-000000000001",
      hairInventoryQty: 2,
      productConsumptions: [{ productId: "81000000-0000-0000-0000-000000000001", quantity: 1 }]
    },
    hairInventory: [{ id: "80000000-0000-0000-0000-000000000001", quantity: 10 }],
    products: [{ id: "81000000-0000-0000-0000-000000000001", stock_quantity: 10 }]
  });
  assert.equal(result.error, null);
  assert.deepEqual(result.hairUpdates, [{ id: "80000000-0000-0000-0000-000000000001", delta: 2 }]);
  assert.deepEqual(result.productUpdates, [{ id: "81000000-0000-0000-0000-000000000001", delta: 2 }]);
  assert.deepEqual(result.movements, [{
    inventory_id: "80000000-0000-0000-0000-000000000001",
    kind: "return",
    quantity: 2
  }]);
});

test("calculateInventoryChanges - Reenvio sem alteração", () => {
  const result = calculateInventoryChanges({
    oldRecord: {
      hairInventoryId: "80000000-0000-0000-0000-000000000001",
      hairInventoryQty: 2,
      productConsumptions: [{ productId: "81000000-0000-0000-0000-000000000001", quantity: 3 }]
    },
    newRecord: {
      hairInventoryId: "80000000-0000-0000-0000-000000000001",
      hairInventoryQty: 2,
      productConsumptions: [{ productId: "81000000-0000-0000-0000-000000000001", quantity: 3 }]
    },
    hairInventory: [{ id: "80000000-0000-0000-0000-000000000001", quantity: 10 }],
    products: [{ id: "81000000-0000-0000-0000-000000000001", stock_quantity: 10 }]
  });
  assert.equal(result.error, null);
  assert.deepEqual(result.hairUpdates, []);
  assert.deepEqual(result.productUpdates, []);
  assert.deepEqual(result.movements, []);
});

test("calculateInventoryChanges - Valores inválidos e saldo negativo", () => {
  const resultHairNegative = calculateInventoryChanges({
    oldRecord: null,
    newRecord: {
      hairInventoryId: "80000000-0000-0000-0000-000000000001",
      hairInventoryQty: -1,
      productConsumptions: []
    },
    hairInventory: [{ id: "80000000-0000-0000-0000-000000000001", quantity: 5 }],
    products: []
  });
  assert.match(resultHairNegative.error, /negativa/);

  const resultProdNegative = calculateInventoryChanges({
    oldRecord: null,
    newRecord: {
      hairInventoryId: null,
      hairInventoryQty: 0,
      productConsumptions: [{ productId: "81000000-0000-0000-0000-000000000001", quantity: -2 }]
    },
    hairInventory: [],
    products: [{ id: "81000000-0000-0000-0000-000000000001", stock_quantity: 10 }]
  });
  assert.match(resultProdNegative.error, /negativa/);
});

test("technicalRecordInput - Validação de novos campos de estoque", () => {
  const validResult = technicalRecordInput({
    appointmentId,
    hairInventoryId: "80000000-0000-0000-0000-000000000001",
    hairInventoryQty: "2.5",
    productConsumptions: [{ productId: "81000000-0000-0000-0000-000000000001", quantity: "3" }]
  });
  assert.equal(validResult.error, "");
  assert.equal(validResult.value.hairInventoryId, "80000000-0000-0000-0000-000000000001");
  assert.equal(validResult.value.hairInventoryQty, 2.5);
  assert.deepEqual(validResult.value.productConsumptions, [
    { productId: "81000000-0000-0000-0000-000000000001", quantity: 3 }
  ]);

  const invalidHairResult = technicalRecordInput({
    appointmentId,
    hairInventoryId: "invalid-uuid"
  });
  assert.match(invalidHairResult.error, /Lote/);

  const invalidProductResult = technicalRecordInput({
    appointmentId,
    productConsumptions: [{ productId: "invalid-uuid", quantity: 1 }]
  });
  assert.match(invalidProductResult.error, /produto/);
});

test("extractPublicId - Extrai public_id corretamente de URLs Cloudinary", () => {
  const url1 = "https://res.cloudinary.com/cloudname/image/upload/v123456789/folder/subfolder/image.jpg";
  assert.equal(extractPublicId(url1), "folder/subfolder/image");

  const url2 = "https://res.cloudinary.com/cloudname/image/upload/folder/image.png";
  assert.equal(extractPublicId(url2), "folder/image");

  const urlNonCloudinary = "https://example.com/some-image.jpg";
  assert.equal(extractPublicId(urlNonCloudinary), null);

  assert.equal(extractPublicId(null), null);
});

test("technicalRecordInput - Validação de deletedPhotoIds", () => {
  const resultValid = technicalRecordInput({
    appointmentId,
    color: "Loiro",
    deletedPhotoIds: [
      "22222222-2222-2222-2222-222222222222",
      "33333333-3333-3333-3333-333333333333"
    ]
  });
  assert.equal(resultValid.error, "");
  assert.deepEqual(resultValid.value.deletedPhotoIds, [
    "22222222-2222-2222-2222-222222222222",
    "33333333-3333-3333-3333-333333333333"
  ]);

  const resultInvalid = technicalRecordInput({
    appointmentId,
    color: "Loiro",
    deletedPhotoIds: ["invalid-uuid"]
  });
  assert.match(resultInvalid.error, /deletada/);
});
