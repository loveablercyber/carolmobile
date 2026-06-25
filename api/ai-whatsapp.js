import { requireUser } from "../server/lib/auth.js";
import {
  buildRuntimePrompt,
  defaultAiSettings,
  getAiPanel,
  getAiSettings,
  saveAiFlowSettings,
  saveAiServiceSettings,
  saveAiSettings,
  saveKnowledgeArticle,
  deleteKnowledgeArticle,
  updateAiConversationStatus,
} from "../server/lib/ai-whatsapp.js";
import { generateGeminiText } from "../server/lib/gemini-client.js";
import {
  appError,
  getBody,
  handleError,
  methodNotAllowed,
  send,
} from "../server/lib/http.js";

const clean = (value) => String(value ?? "").trim();

function requireAdmin(user) {
  if (user.role !== "admin") throw appError("Acesso restrito à administração.", 403);
}

async function mutate(user, resource, body) {
  requireAdmin(user);
  if (resource === "save-knowledge-article") {
    const article = await saveKnowledgeArticle(user, body);
    return { article, panel: await getAiPanel() };
  }
  if (resource === "delete-knowledge-article") {
    await deleteKnowledgeArticle(user, body.id);
    return { success: true, panel: await getAiPanel() };
  }
  if (resource === "settings") {
    const settings = await saveAiSettings(user, body);
    return { settings, panel: await getAiPanel() };
  }
  if (resource === "service-settings") {
    const service = await saveAiServiceSettings(user, body);
    return { service, panel: await getAiPanel() };
  }
  if (resource === "flow-settings") {
    const flow = await saveAiFlowSettings(user, body);
    return { flow, panel: await getAiPanel() };
  }
  if (resource === "conversation-action") {
    const conversation = await updateAiConversationStatus(user, body);
    return { conversation, panel: await getAiPanel() };
  }
  if (resource === "action") {
    const action = clean(body.action);
    if (action === "restore_defaults") {
      const settings = await saveAiSettings(user, defaultAiSettings());
      return { settings, panel: await getAiPanel() };
    }
    if (action === "pause" || action === "activate") {
      const current = await getAiSettings();
      const settings = await saveAiSettings(user, {
        ...current,
        enabled: action === "activate",
      });
      return { settings, panel: await getAiPanel() };
    }
    throw appError("Ação inválida.");
  }
  if (resource === "test") {
    const settings = await getAiSettings();
    const message =
      clean(body.message) ||
      "Oi, gostaria de saber quais serviços de Mega Hair vocês oferecem.";
    const result = await generateGeminiText({
      model: settings.model,
      systemPrompt: buildRuntimePrompt(settings),
      message:
        `${message}\n\nResponda sem citar preços, horários ou disponibilidade. ` +
        "Explique que essas informações precisam ser consultadas nas ferramentas reais do sistema.",
    });
    return {
      model: result.model,
      response: result.text,
      usage: result.usage,
    };
  }
  throw appError("Recurso não encontrado.", 404);
}

export default async function handler(req, res) {
  try {
    const user = await requireUser(req, ["admin"]);
    const resource = clean(req.query?.resource || "panel");
    if (req.method === "GET") {
      if (resource !== "panel") throw appError("Recurso não encontrado.", 404);
      return send(res, 200, { data: await getAiPanel() });
    }
    if (req.method !== "POST") return methodNotAllowed(res, ["GET", "POST"]);
    const data = await mutate(user, resource, getBody(req));
    return send(res, 200, { data });
  } catch (error) {
    console.error("AI WhatsApp API error", {
      method: req.method,
      resource: req.query?.resource,
      status: error.status || 500,
      message: error.message,
      code: error.code || null,
    });
    return handleError(res, error);
  }
}
