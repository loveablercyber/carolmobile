const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";

export class OpenAiClientError extends Error {
  constructor(message, { status = 502, code = "OPENAI_ERROR", expose = true } = {}) {
    super(message);
    this.name = "OpenAiClientError";
    this.status = status;
    this.code = code;
    this.expose = expose;
  }
}

export function openAiConfig() {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  const model = String(process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL).trim();
  const enabled = ["1", "true", "yes", "on"].includes(
    String(process.env.OPENAI_ENABLED || "").toLowerCase(),
  );
  return {
    apiKey,
    model,
    enabled,
    configured: Boolean(apiKey && model),
  };
}

export function openAiPublicStatus() {
  const config = openAiConfig();
  return {
    provider: "openai",
    configured: config.configured,
    enabled: config.enabled,
    model: config.model,
  };
}

function extractOutputText(data) {
  const direct = String(data?.output_text || "").trim();
  if (direct) return direct;
  
  const choiceText = String(data?.choices?.[0]?.message?.content || "").trim();
  if (choiceText) return choiceText;

  return (data?.output || [])
    .filter((item) => item?.type === "message")
    .flatMap((item) => item?.content || [])
    .filter((item) => item?.type === "output_text")
    .map((item) => String(item?.text || "").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

export async function generateOpenAiText({
  systemPrompt,
  message,
  model,
  timeoutMs = 12000,
  maxTokens = 300,
  apiKey = null,
}) {
  const config = openAiConfig();
  const activeKey = apiKey || config.apiKey;
  if (!apiKey && !config.enabled) {
    throw new OpenAiClientError("OpenAI está desativada no ambiente.", {
      status: 503,
      code: "OPENAI_DISABLED",
    });
  }
  if (!activeKey) {
    throw new OpenAiClientError("OpenAI ainda não está configurada.", {
      status: 503,
      code: "OPENAI_NOT_CONFIGURED",
    });
  }

  const selectedModel = String(model || config.model).trim();
  let response;
  try {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${activeKey}`,
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: [
          { role: "system", content: String(systemPrompt || "") },
          { role: "user", content: String(message || "") },
        ],
        max_tokens: Number(maxTokens || 300),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    console.error("OpenAI network error", { message: error.message });
    throw new OpenAiClientError("Não foi possível conectar à OpenAI.", {
      status: 503,
      code: "OPENAI_NETWORK_ERROR",
    });
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const status = response.status;
    const message = String(data?.error?.message || "OpenAI recusou a solicitação.").trim();
    const code =
      status === 401
        ? "OPENAI_UNAUTHORIZED"
        : status === 429
          ? "RESOURCE_EXHAUSTED"
          : "OPENAI_PROVIDER_ERROR";
    throw new OpenAiClientError(message, { status, code });
  }

  const text = extractOutputText(data);
  if (!text) {
    throw new OpenAiClientError("OpenAI não retornou uma resposta de texto.", {
      status: 502,
      code: "OPENAI_EMPTY_RESPONSE",
    });
  }

  return {
    model: selectedModel,
    text,
    usage: data?.usage || null,
    responseId: data?.id || null,
  };
}
