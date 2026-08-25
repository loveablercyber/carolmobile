import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import {
  generateOllamaText,
  ollamaConfig,
  ollamaResponseText,
} from "../server/lib/ollama-client.js";

const originalFetch = global.fetch;
const envKeys = ["OLLAMA_ENABLED", "OLLAMA_BASE_URL", "OLLAMA_MODEL", "OLLAMA_NUM_CTX"];
const originalEnv = {};

beforeEach(() => {
  for (const key of envKeys) originalEnv[key] = process.env[key];
  process.env.OLLAMA_ENABLED = "true";
  process.env.OLLAMA_BASE_URL = "http://ollama:11434/";
  process.env.OLLAMA_MODEL = "qwen3:4b";
  process.env.OLLAMA_NUM_CTX = "4096";
});

afterEach(() => {
  global.fetch = originalFetch;
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

test("normalizes Ollama configuration for the internal Coolify service", () => {
  const config = ollamaConfig();
  assert.equal(config.baseUrl, "http://ollama:11434");
  assert.equal(config.model, "qwen3:4b");
  assert.equal(config.contextSize, 4096);
  assert.equal(config.configured, true);
});

test("reads Ollama chat response text", () => {
  assert.equal(ollamaResponseText({ message: { content: " Olá! " } }), "Olá!");
});

test("sends a low-memory non-thinking chat request to Ollama", async () => {
  let requestUrl = "";
  let requestBody = null;
  global.fetch = async (url, init) => {
    requestUrl = String(url);
    requestBody = JSON.parse(init.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        message: { content: "Como posso ajudar?" },
        prompt_eval_count: 32,
        eval_count: 12,
      }),
    };
  };

  const result = await generateOllamaText({
    systemPrompt: "Atenda com clareza.",
    message: "Olá",
    maxTokens: 180,
  });

  assert.equal(requestUrl, "http://ollama:11434/api/chat");
  assert.equal(requestBody.stream, false);
  assert.equal(requestBody.think, false);
  assert.equal(requestBody.keep_alive, "30m");
  assert.equal(requestBody.options.num_ctx, 4096);
  assert.equal(requestBody.options.num_predict, 120);
  assert.equal(result.text, "Como posso ajudar?");
});
