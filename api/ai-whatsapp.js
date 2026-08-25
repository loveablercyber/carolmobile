import { requireUser } from "../server/lib/auth.js";
import {
  buildRuntimePrompt,
  defaultAiSettings,
  getAiPanel,
  getAiSettings,
  saveAiFlowSettings,
  saveAiSettings,
  saveKnowledgeArticle,
  deleteKnowledgeArticle,
  updateAiConversationStatus,
} from "../server/lib/ai-whatsapp.js";
import {
  aiProviderRuntime,
  generateAiProviderText,
  normalizeAiProvider,
} from "../server/lib/ai-provider-router.js";
import {
  appError,
  getBody,
  handleError,
  methodNotAllowed,
  send,
} from "../server/lib/http.js";
import { query } from "../server/lib/db.js";

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
      if (action === "activate") {
        await query(
          `update public.whatsapp_conversations
              set status='ai',ai_enabled=true,assigned_to=null,human_takeover_at=null,updated_at=now()
            where ai_enabled=false or status<>'ai'`,
        );
        await query(
          `update public.human_handoff_tickets
              set status='closed',resolved_at=coalesce(resolved_at,now()),updated_at=now()
            where status in ('pending','open')`,
        );
      }
      return { settings, panel: await getAiPanel() };
    }
    throw appError("Ação inválida.");
  }
  if (resource === "test") {
    const settings = await getAiSettings();
    const provider = normalizeAiProvider(
      body.provider || settings.primaryProvider || settings.provider,
    );
    const runtime = aiProviderRuntime(provider, settings);
    if (!runtime.enabled || !runtime.configured) {
      throw appError(
        `Provedor ${provider} não está habilitado/configurado no ambiente ou painel.`,
        503,
      );
    }
    const message =
      clean(body.message) ||
      "Oi, gostaria de saber quais serviços de Mega Hair vocês oferecem.";
    const result = await generateAiProviderText({
      provider,
      model:
        provider === normalizeAiProvider(settings.primaryProvider || settings.provider)
          ? settings.primaryModel || settings.model || runtime.defaultModel
          : runtime.defaultModel,
      systemPrompt: buildRuntimePrompt(settings),
      message:
        `${message}\n\nResponda sem citar preços, horários ou disponibilidade. ` +
        "Explique que essas informações precisam ser consultadas nas ferramentas reais do sistema.",
      timeoutMs: settings.timeoutMs || 12000,
      maxTokens: settings.maxResponseTokens || 300,
      apiKey: runtime.apiKey,
    });
    return {
      provider,
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
