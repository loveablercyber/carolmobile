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

export function getGeminiKeys() {
  const keys = [];
  const primaryKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (primaryKey) {
    if (primaryKey.includes(",")) {
      keys.push(...primaryKey.split(",").map((k) => k.trim()));
    } else {
      keys.push(primaryKey);
    }
  }
  for (let i = 1; i <= 10; i++) {
    const k = process.env[`GEMINI_API_KEY_${i}`];
    if (k) keys.push(k.trim());
  }
  return [...new Set(keys)].filter(Boolean);
}

export function geminiConfig() {
  const keys = getGeminiKeys();
  const apiKey = keys[0] || "";
  const model = String(process.env.GEMINI_MODEL || "gemini-2.5-flash-lite").trim();
  const enabled = ["1", "true", "yes", "on"].includes(
    String(process.env.GEMINI_ENABLED || "").toLowerCase(),
  );
  return {
    apiKey,
    keys,
    model,
    enabled,
    configured: keys.length > 0 && Boolean(model),
  };
}

export function geminiPublicStatus() {
  const config = geminiConfig();
  return {
    provider: "gemini",
    configured: config.configured,
    enabled: config.enabled,
    model: config.model,
    keyCount: config.keys.length,
  };
}

export async function generateGeminiText({
  systemPrompt,
  message,
  model,
  timeoutMs = 7000,
  maxTokens = 220,
  temperature = 0.4,
  apiKeyIndex = null,
  apiKey = null,
}) {
  const config = geminiConfig();
  const keys = apiKey ? [apiKey] : config.keys;
  if (!apiKey && !config.enabled)
    throw new GeminiClientError("Gemini está desativado no ambiente.", {
      status: 503,
      code: "GEMINI_DISABLED",
    });
  if (!apiKey && !config.configured)
    throw new GeminiClientError("Gemini ainda não está configurado.", {
      status: 503,
      code: "GEMINI_NOT_CONFIGURED",
    });

  const idx = apiKeyIndex !== null ? apiKeyIndex % keys.length : Math.floor(Math.random() * keys.length);
  const activeKey = keys[idx];
  const selectedModel = String(model || config.model).trim();
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    selectedModel,
  )}:generateContent?key=${encodeURIComponent(activeKey)}`;

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
          temperature: Number(temperature || 0.4),
          maxOutputTokens: Number(maxTokens || 220),
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
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
    const errMsg = String(data?.error?.message || "Gemini recusou a solicitação.").trim();
    const errStatus = response.status;
    throw new GeminiClientError(errMsg, {
      status: errStatus,
      code: errStatus === 429 ? "RESOURCE_EXHAUSTED" : "GEMINI_PROVIDER_ERROR",
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
    keyIndexUsed: idx,
  };
}
