export class GroqClientError extends Error {
  constructor(message, { status = 502, code = "GROQ_ERROR", expose = true } = {}) {
    super(message);
    this.name = "GroqClientError";
    this.status = status;
    this.code = code;
    this.expose = expose;
  }
}

let nextGroqKeyIndex = 0;

export function getGroqKeys() {
  const keys = [];
  const primaryKey = String(process.env.GROQ_API_KEY || "").trim();
  if (primaryKey) {
    if (primaryKey.includes(",")) {
      keys.push(...primaryKey.split(",").map((k) => k.trim()));
    } else {
      keys.push(primaryKey);
    }
  }
  for (let i = 1; i <= 10; i++) {
    const k = process.env[`GROQ_API_KEY_${i}`];
    if (k) keys.push(k.trim());
  }
  return [...new Set(keys)].filter(Boolean);
}

export function groqConfig() {
  const keys = getGroqKeys();
  const apiKey = keys[0] || "";
  const model = String(process.env.GROQ_MODEL || "llama-3.1-8b-instant").trim();
  const enabled = ["1", "true", "yes", "on"].includes(
    String(process.env.GROQ_ENABLED || "").toLowerCase(),
  );
  return {
    apiKey,
    keys,
    model,
    enabled,
    configured: keys.length > 0 && Boolean(model),
  };
}

export function groqPublicStatus() {
  const config = groqConfig();
  return {
    provider: "groq",
    configured: config.configured,
    enabled: config.enabled,
    model: config.model,
    keyCount: config.keys.length,
  };
}

export async function generateGroqText({
  systemPrompt,
  message,
  model,
  timeoutMs = 7000,
  maxTokens = 220,
  temperature = 0.4,
  apiKeyIndex = null,
  apiKey = null,
}) {
  const config = groqConfig();
  const keys = apiKey ? [apiKey] : config.keys;
  if (!apiKey && !config.enabled)
    throw new GroqClientError("Groq está desativado no ambiente.", {
      status: 503,
      code: "GROQ_DISABLED",
    });
  if (!apiKey && !config.configured)
    throw new GroqClientError("Groq ainda não está configurado.", {
      status: 503,
      code: "GROQ_NOT_CONFIGURED",
    });

  const idx =
    apiKeyIndex !== null
      ? ((apiKeyIndex % keys.length) + keys.length) % keys.length
      : nextGroqKeyIndex % keys.length;
  if (apiKeyIndex === null) {
    nextGroqKeyIndex = (idx + 1) % keys.length;
  }
  const activeKey = keys[idx];
  const selectedModel = String(model || config.model).trim();
  const endpoint = "https://api.groq.com/openai/v1/chat/completions";

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${activeKey}`,
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: [
          { role: "system", content: String(systemPrompt || "") },
          { role: "user", content: String(message || "") },
        ],
        temperature: Number(temperature || 0.4),
        max_tokens: Number(maxTokens || 220),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    console.error("Groq network error", { message: error.message });
    throw new GroqClientError("Não foi possível conectar ao Groq.", {
      status: 503,
      code: "GROQ_NETWORK_ERROR",
    });
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errMsg = String(data?.error?.message || "Groq recusou a solicitação.").trim();
    const errStatus = response.status;
    throw new GroqClientError(errMsg, {
      status: errStatus,
      code: errStatus === 429 ? "RESOURCE_EXHAUSTED" : "GROQ_PROVIDER_ERROR",
    });
  }

  const text = String(data?.choices?.[0]?.message?.content || "").trim();

  if (!text)
    throw new GroqClientError("Groq não retornou uma resposta de texto.", {
      status: 502,
      code: "GROQ_EMPTY_RESPONSE",
    });

  return {
    model: selectedModel,
    text,
    usage: data?.usage || null,
    keyIndexUsed: idx,
  };
}
