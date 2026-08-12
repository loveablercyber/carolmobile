export function variantDepositAmount(variant = {}, total = 0) {
  const payableTotal = Math.max(0, Number(total || 0));
  const value = Math.max(0, Number(variant.deposit_value || 0));
  switch (String(variant.deposit_type || "none")) {
    case "fixed":
      return Math.min(value, payableTotal);
    case "percentage":
      return Number(Math.min(payableTotal, payableTotal * value / 100).toFixed(2));
    case "full":
      return Number(payableTotal.toFixed(2));
    case "material_cost":
      // The material cost is confirmed by a human after assessment. Never guess it.
      return 0;
    default:
      return 0;
  }
}

export function catalogSnapshot({ service, variant, addons = [], total, deposit }) {
  return {
    version: 1,
    capturedAt: new Date().toISOString(),
    service: {
      id: service.id,
      code: service.catalog_code || null,
      name: service.name,
    },
    variant: variant ? {
      id: variant.id,
      code: variant.code,
      label: variant.label,
      price: Number(variant.price || 0),
      durationMinutes: Number(variant.duration_minutes || 0),
      materialMode: variant.material_mode,
      depositType: variant.deposit_type,
      depositValue: Number(variant.deposit_value || 0),
      depositNonRefundable: variant.deposit_non_refundable === true,
      requiresAssessment: variant.requires_assessment === true,
      requiresHumanConfirmation: variant.requires_human_confirmation === true,
    } : null,
    addons: addons.map((addon) => ({
      id: addon.id,
      code: addon.code,
      name: addon.name,
      price: Number(addon.price || 0),
      durationMinutes: Number(addon.duration_minutes || 0),
    })),
    total: Number(total || 0),
    deposit: Number(deposit || 0),
  };
}

export function totalCatalogDuration(variant, addons = []) {
  return Number(variant?.duration_minutes || 0) + addons.reduce(
    (total, addon) => total + Number(addon.duration_minutes || 0),
    0,
  );
}

export function totalCatalogPrice(variant, addons = []) {
  return Number((Number(variant?.price || 0) + addons.reduce(
    (total, addon) => total + Number(addon.price || 0),
    0,
  )).toFixed(2));
}
