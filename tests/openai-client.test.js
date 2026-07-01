import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import {
  generateOpenAiText,
  openAiPublicStatus,
} from "../server/lib/openai-client.js";

const originalFetch = globalThis.fetch;
const originalEnv = {};

beforeEach(() => {
  for (const key of ["OPENAI_API_KEY", "OPENAI_ENABLED", "OPENAI_MODEL"]) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("OpenAI public status never exposes the API key", () => {
  process.env.OPENAI_API_KEY = "secret-openai-key";
  process.env.OPENAI_ENABLED = "true";
  process.env.OPENAI_MODEL = "gpt-5.4-mini";

  const status = openAiPublicStatus();
  assert.deepEqual(status, {
    provider: "openai",
    configured: true,
    enabled: true,
    model: "gpt-5.4-mini",
  });
  assert.doesNotMatch(JSON.stringify(status), /secret-openai-key/);
});

test("generateOpenAiText uses Responses API and extracts output text", async () => {
  process.env.OPENAI_API_KEY = "secret-openai-key";
  process.env.OPENAI_ENABLED = "true";
  process.env.OPENAI_MODEL = "gpt-5.4-mini";
  let request = null;

  globalThis.fetch = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return new Response(
      JSON.stringify({
        id: "resp_123",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "Olá! Como posso ajudar?" }],
          },
        ],
        usage: { input_tokens: 12, output_tokens: 7 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  const result = await generateOpenAiText({
    systemPrompt: "Você é uma consultora de Mega Hair.",
    message: "Qual técnica combina comigo?",
  });

  assert.equal(request.url, "https://api.openai.com/v1/responses");
  assert.equal(request.body.store, false);
  assert.equal(request.body.model, "gpt-5.4-mini");
  assert.equal(request.options.headers.Authorization, "Bearer secret-openai-key");
  assert.equal(result.text, "Olá! Como posso ajudar?");
  assert.equal(result.responseId, "resp_123");
});
