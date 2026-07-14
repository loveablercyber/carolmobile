const receiptStatuses = new Set(["pending", "failed", "expired"]);

export function receiptSubmissionError({
  role,
  provider,
  paymentStatus,
  url,
  hasActiveReceipt = false,
}) {
  if (role !== "client") return "Apenas a cliente pode enviar comprovantes.";
  if (provider !== "pix_manual")
    return "Selecione Pix manual antes de enviar o comprovante.";
  if (!receiptStatuses.has(paymentStatus))
    return "Este pagamento não aceita um novo comprovante.";
  if (hasActiveReceipt) return "Já existe um comprovante em análise.";
  try {
    const parsed = new URL(String(url || ""), "http://localhost");
    const isLocalUpload = parsed.pathname.startsWith("/uploads/");
    if (!isLocalUpload && parsed.protocol !== "https:")
      throw new Error("invalid receipt location");
  } catch {
    return "A URL do comprovante é inválida.";
  }
  return null;
}

export function resolveProviderTransition(currentStatus, incomingStatus) {
  if (currentStatus === "paid" && incomingStatus !== "paid")
    return { status: currentStatus, changed: false, ignored: true };
  if (currentStatus === incomingStatus)
    return { status: currentStatus, changed: false, ignored: false };
  return { status: incomingStatus, changed: true, ignored: false };
}

export function resolveReceiptReview(currentStatus, action) {
  const target = action === "approve" ? "approved" : action === "reject" ? "rejected" : null;
  if (!target) return { error: "Ação de análise inválida." };
  if (currentStatus === target) return { status: target, changed: false };
  if (currentStatus !== "under_review")
    return { error: "Este comprovante já foi analisado." };
  return { status: target, changed: true };
}
