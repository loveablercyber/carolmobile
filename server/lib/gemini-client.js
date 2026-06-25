const GEMINI_TIMEOUT_MS = 20_000;

export class GeminiClientError extends Error {
  constructor(message, { status = 502, code = "GEMINI_ERROR", expose = true } = {}) {
    super(message);
    this.name = "GeminiClientError";
    this.status = status;
    this.code = code;
    this.expose = expose;
  }
}

export function geminiConfig() {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  const model = String(process.env.GEMINI_MODEL || "gemini-2.5-flash-lite").trim();
  const enabled = ["1", "true", "yes", "on"].includes(
    String(process.env.GEMINI_ENABLED || "").toLowerCase(),
  );
  return {
    apiKey,
    model,
    enabled,
    configured: Boolean(apiKey && model),
  };
}

export function geminiPublicStatus() {
  const config = geminiConfig();
  return {
    provider: "gemini",
    configured: config.configured,
    enabled: config.enabled,
    model: config.model,
  };
}

export async function generateGeminiText({ systemPrompt, message, model }) {
  const config = geminiConfig();
  if (!config.enabled)
    throw new GeminiClientError("Gemini está desativado no ambiente.", {
      status: 503,
      code: "GEMINI_DISABLED",
    });
  if (!config.configured)
    throw new GeminiClientError("Gemini ainda não está configurado.", {
      status: 503,
      code: "GEMINI_NOT_CONFIGURED",
    });

  const selectedModel = String(model || config.model).trim();
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    selectedModel,
  )}:generateContent?key=${encodeURIComponent(config.apiKey)}`;

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: String(systemPrompt || "") }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: String(message || "").slice(0, 1500) }],
          },
        ],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 500,
        },
      }),
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    });
  } catch (error) {
    console.error("Gemini network error", { message: error.message });
    throw new GeminiClientError("Não foi possível conectar ao Gemini.", {
      status: 503,
      code: "GEMINI_NETWORK_ERROR",
    });
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("Gemini provider error", {
      status: response.status,
      message: data?.error?.message || null,
    });
    throw new GeminiClientError("Gemini recusou a solicitação de teste.", {
      status: 502,
      code: "GEMINI_PROVIDER_ERROR",
    });
  }

  const text =
    data?.candidates?.[0]?.content?.parts
      ?.map((part) => part?.text)
      .filter(Boolean)
      .join("\n")
      .trim() || "";

  if (!text)
    throw new GeminiClientError("Gemini não retornou uma resposta de texto.", {
      status: 502,
      code: "GEMINI_EMPTY_RESPONSE",
    });

  return {
    model: selectedModel,
    text,
    usage: data?.usageMetadata || null,
  };
}
