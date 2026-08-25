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
  const model = String(process.env.GROQ_MODEL || "openai/gpt-oss-20b").trim();
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

export function groqResponseText(data = {}) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => typeof part === "string" ? part : part?.text || part?.content || "")
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return "";
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
  const isGptOss = /^openai\/gpt-oss-/i.test(selectedModel);
  const completionTokenLimit = isGptOss
    ? Math.max(1024, Number(maxTokens || 220))
    : Number(maxTokens || 220);
  const messages = isGptOss
    ? [{
        role: "user",
        content: [
          String(systemPrompt || "").trim()
            ? `Instruções do atendimento:\n${String(systemPrompt).trim()}`
            : "",
          `Mensagem da cliente:\n${String(message || "")}`,
        ].filter(Boolean).join("\n\n"),
      }]
    : [
        { role: "system", content: String(systemPrompt || "") },
        { role: "user", content: String(message || "") },
      ];
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
        messages,
        temperature: Number(temperature || 0.4),
        max_completion_tokens: completionTokenLimit,
        ...(isGptOss ? { reasoning_effort: "low", include_reasoning: false } : {}),
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

  const text = groqResponseText(data);

  if (!text) {
    const finishReason = String(data?.choices?.[0]?.finish_reason || "").trim();
    throw new GroqClientError(
      finishReason === "length"
        ? "O Groq consumiu o limite de saída antes de concluir a resposta."
        : "Groq não retornou uma resposta de texto.",
      {
        status: 502,
        code: finishReason === "length" ? "GROQ_OUTPUT_LIMIT" : "GROQ_EMPTY_RESPONSE",
      },
    );
  }

  return {
    model: selectedModel,
    text,
    usage: data?.usage || null,
    keyIndexUsed: idx,
  };
}
