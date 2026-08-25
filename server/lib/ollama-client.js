export class OllamaClientError extends Error {
  constructor(message, { status = 502, code = "OLLAMA_ERROR", expose = true } = {}) {
    super(message);
    this.name = "OllamaClientError";
    this.status = status;
    this.code = code;
    this.expose = expose;
  }
}

const enabledValue = (value) =>
  ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());

export function ollamaConfig() {
  const baseUrl = String(process.env.OLLAMA_BASE_URL || "").trim().replace(/\/+$/, "");
  const model = String(process.env.OLLAMA_MODEL || "qwen3:4b").trim();
  const enabled = enabledValue(process.env.OLLAMA_ENABLED);
  const contextSize = Math.min(
    8192,
    Math.max(2048, Number(process.env.OLLAMA_NUM_CTX || 4096)),
  );
  return {
    baseUrl,
    model,
    enabled,
    contextSize,
    configured: Boolean(baseUrl && model),
  };
}

export function ollamaPublicStatus() {
  const config = ollamaConfig();
  return {
    provider: "ollama",
    configured: config.configured,
    enabled: config.enabled,
    model: config.model,
    keyCount: 0,
  };
}

export function ollamaResponseText(data = {}) {
  return String(data?.message?.content || data?.response || "").trim();
}

export async function generateOllamaText({
  systemPrompt,
  message,
  model,
  timeoutMs = 30000,
  maxTokens = 220,
  temperature = 0.4,
}) {
  const config = ollamaConfig();
  if (!config.enabled) {
    throw new OllamaClientError("Ollama está desativado no ambiente.", {
      status: 503,
      code: "OLLAMA_DISABLED",
    });
  }
  if (!config.configured) {
    throw new OllamaClientError("Ollama ainda não está configurado.", {
      status: 503,
      code: "OLLAMA_NOT_CONFIGURED",
    });
  }

  const selectedModel = String(model || config.model).trim();
  let response;
  try {
    response = await fetch(`${config.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: selectedModel,
        stream: false,
        think: false,
        keep_alive: "10m",
        messages: [
          { role: "system", content: String(systemPrompt || "") },
          { role: "user", content: String(message || "") },
        ],
        options: {
          num_ctx: config.contextSize,
          num_predict: Math.max(32, Number(maxTokens || 220)),
          temperature: Number(temperature || 0.4),
        },
      }),
      signal: AbortSignal.timeout(Math.max(5000, Number(timeoutMs || 30000))),
    });
  } catch (error) {
    console.error("Ollama network error", { message: error.message });
    throw new OllamaClientError("Não foi possível conectar ao Ollama.", {
      status: 503,
      code: "OLLAMA_NETWORK_ERROR",
    });
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new OllamaClientError(
      String(data?.error || "Ollama recusou a solicitação."),
      {
        status: response.status,
        code: response.status === 404 ? "OLLAMA_MODEL_NOT_FOUND" : "OLLAMA_PROVIDER_ERROR",
      },
    );
  }

  const text = ollamaResponseText(data);
  if (!text) {
    throw new OllamaClientError("Ollama não retornou uma resposta de texto.", {
      status: 502,
      code: "OLLAMA_EMPTY_RESPONSE",
    });
  }

  return {
    model: selectedModel,
    text,
    usage: {
      prompt_tokens: data?.prompt_eval_count || 0,
      completion_tokens: data?.eval_count || 0,
    },
  };
}
