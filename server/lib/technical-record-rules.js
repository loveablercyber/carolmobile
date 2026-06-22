const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const paymentStatuses = new Set(["pending", "paid", "refunded", "failed"]);
const photoKinds = new Set(["before", "during", "after"]);

function text(value, maxLength) {
  const result = String(value ?? "").trim();
  return result ? result.slice(0, maxLength) : null;
}

function number(value, { integer = false, max }) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > max)
    return { error: true };
  if (integer && !Number.isInteger(parsed)) return { error: true };
  return parsed;
}

function validDate(value) {
  if (!datePattern.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export function technicalRecordInput(body = {}) {
  const appointmentId = String(body.appointmentId || "");
  if (!uuidPattern.test(appointmentId))
    return { value: null, error: "Atendimento inválido." };
  const hairMethodId = body.hairMethodId
    ? String(body.hairMethodId)
    : null;
  if (hairMethodId && !uuidPattern.test(hairMethodId))
    return { value: null, error: "Método capilar inválido." };

  const strandsCount = number(body.strandsCount, { integer: true, max: 5000 });
  const weightGrams = number(body.weightGrams, { max: 10000 });
  const lengthCm = number(body.lengthCm, { integer: true, max: 300 });
  const finalValue = number(body.finalValue, { max: 1_000_000 });
  if ([strandsCount, weightGrams, lengthCm, finalValue].some((item) => item?.error))
    return { value: null, error: "Revise os valores numéricos da ficha." };

  const nextMaintenanceDate = body.nextMaintenanceDate
    ? String(body.nextMaintenanceDate)
    : null;
  if (nextMaintenanceDate && !validDate(nextMaintenanceDate))
    return { value: null, error: "Data de manutenção inválida." };
  const paymentStatus = String(body.paymentStatus || "pending");
  if (!paymentStatuses.has(paymentStatus))
    return { value: null, error: "Status de pagamento inválido." };

  const productsUsed = (Array.isArray(body.productsUsed)
    ? body.productsUsed
    : String(body.productsUsed || "").split(","))
    .map((item) => text(item, 160))
    .filter(Boolean)
    .slice(0, 50);
  const photos = Array.isArray(body.photos) ? body.photos : [];
  if (photos.length > 3)
    return { value: null, error: "Envie no máximo três fotos por vez." };
  const normalizedPhotos = [];
  for (const photo of photos) {
    const kind = String(photo?.kind || "");
    const url = String(photo?.url || "").trim();
    if (!photoKinds.has(kind) || !/^https:\/\//i.test(url) || url.length > 2048)
      return { value: null, error: "Anexo técnico inválido." };
    normalizedPhotos.push({ kind, url });
  }

  const hairInventoryId = body.hairInventoryId ? String(body.hairInventoryId) : null;
  if (hairInventoryId && !uuidPattern.test(hairInventoryId))
    return { value: null, error: "Lote de estoque inválido." };

  const hairInventoryQty = body.hairInventoryId ? number(body.hairInventoryQty ?? 1, { max: 1000 }) : null;
  if (hairInventoryQty?.error)
    return { value: null, error: "Quantidade de lote inválida." };

  const productConsumptions = Array.isArray(body.productConsumptions) ? body.productConsumptions : [];
  const validatedProductConsumptions = [];
  for (const pc of productConsumptions) {
    const prodId = String(pc?.productId || "");
    if (!uuidPattern.test(prodId))
      return { value: null, error: "ID de produto inválido." };
    const pQty = number(pc?.quantity, { max: 10000 });
    if (pQty === null || pQty?.error || pQty <= 0)
      return { value: null, error: "Quantidade de produto inválida." };
    validatedProductConsumptions.push({ productId: prodId, quantity: pQty });
  }

  const deletedPhotoIds = Array.isArray(body.deletedPhotoIds) ? body.deletedPhotoIds : [];
  const validatedDeletedPhotoIds = [];
  for (const pid of deletedPhotoIds) {
    const idStr = String(pid || "");
    if (!uuidPattern.test(idStr))
      return { value: null, error: "ID de foto deletada inválido." };
    validatedDeletedPhotoIds.push(idStr);
  }

  const value = {
    appointmentId,
    hairMethodId,
    strandsCount,
    weightGrams,
    color: text(body.color, 100),
    shade: text(body.shade, 100),
    lengthCm,
    texture: text(body.texture, 100),
    hairLot: text(body.hairLot, 120),
    productsUsed,
    recommendations: text(body.recommendations, 4000),
    internalNotes: text(body.internalNotes, 4000),
    nextMaintenanceDate,
    finalValue,
    paymentStatus,
    photos: normalizedPhotos,
    hairInventoryId,
    hairInventoryQty,
    productConsumptions: validatedProductConsumptions,
    deletedPhotoIds: validatedDeletedPhotoIds,
  };
  const hasTechnicalContent = [
    value.strandsCount,
    value.weightGrams,
    value.color,
    value.shade,
    value.lengthCm,
    value.texture,
    value.hairLot,
    value.recommendations,
    value.internalNotes,
    value.nextMaintenanceDate,
    value.finalValue,
    value.hairInventoryId,
    ...value.productsUsed,
    ...value.photos,
    ...value.productConsumptions,
    ...value.deletedPhotoIds,
  ].some((item) => item !== null && item !== undefined && item !== "");
  if (!hasTechnicalContent)
    return { value: null, error: "Preencha ao menos um dado técnico da ficha." };
  return { value, error: "" };
}

export function calculateInventoryChanges({ oldRecord, newRecord, hairInventory = [], products = [] }) {
  const hairStock = new Map(hairInventory.map(item => [item.id, Number(item.quantity || 0)]));
  const productStock = new Map(products.map(p => [p.id, Number(p.stock_quantity || 0)]));

  const movements = [];
  const hairUpdates = [];
  const productUpdates = [];

  const oldHairId = oldRecord?.hairInventoryId || null;
  const oldHairQty = Number(oldRecord?.hairInventoryQty || 0);

  const newHairId = newRecord.hairInventoryId || null;
  const newHairQty = Number(newRecord.hairInventoryQty || 0);

  if (newHairQty < 0) {
    return { error: "Quantidade de lote não pode ser negativa." };
  }

  if (oldHairId === newHairId) {
    const diff = newHairQty - oldHairQty;
    if (diff !== 0) {
      if (newHairId) {
        const available = hairStock.get(newHairId) || 0;
        if (diff > 0 && available < diff) {
          return { error: "Saldo de estoque insuficiente para o lote selecionado." };
        }
        hairUpdates.push({ id: newHairId, delta: -diff });
        movements.push({
          inventory_id: newHairId,
          kind: diff > 0 ? "consume" : "return",
          quantity: Math.abs(diff),
        });
      }
    }
  } else {
    if (oldHairId && oldHairQty > 0) {
      hairUpdates.push({ id: oldHairId, delta: oldHairQty });
      movements.push({
        inventory_id: oldHairId,
        kind: "return",
        quantity: oldHairQty,
      });
    }
    if (newHairId && newHairQty > 0) {
      const available = hairStock.get(newHairId) || 0;
      if (available < newHairQty) {
        return { error: "Saldo de estoque insuficiente para o lote selecionado." };
      }
      hairUpdates.push({ id: newHairId, delta: -newHairQty });
      movements.push({
        inventory_id: newHairId,
        kind: "consume",
        quantity: newHairQty,
      });
    }
  }

  const oldProdMap = new Map((oldRecord?.productConsumptions || []).map(p => [p.productId, Number(p.quantity || 0)]));
  const newProdMap = new Map((newRecord.productConsumptions || []).map(p => [p.productId, Number(p.quantity || 0)]));

  const allProductIds = new Set([...oldProdMap.keys(), ...newProdMap.keys()]);
  for (const prodId of allProductIds) {
    const oldQty = oldProdMap.get(prodId) || 0;
    const newQty = newProdMap.get(prodId) || 0;

    if (newQty < 0) {
      return { error: "Quantidade do produto não pode ser negativa." };
    }

    const diff = newQty - oldQty;
    if (diff !== 0) {
      const available = productStock.get(prodId) || 0;
      if (diff > 0 && available < diff) {
        return { error: `Saldo de estoque insuficiente para o produto selecionado.` };
      }
      productUpdates.push({ id: prodId, delta: -diff });
    }
  }

  return {
    error: null,
    movements,
    hairUpdates,
    productUpdates,
  };
}

export const technicalRecordAppointmentStatuses = new Set([
  "confirmed",
  "in_service",
  "completed",
]);
