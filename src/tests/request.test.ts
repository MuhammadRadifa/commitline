import { describe, expect, it } from "bun:test";
import { buildRequest, buildRetryRequest } from "../providers/request";
import { buildSystemPrompt } from "../utils/prompt";
import type { Config, Options } from "../types";

const options: Options = { dryRun: false, yes: false, body: false, breaking: false };

function config(provider: Config["provider"], overrides: Partial<Config> = {}): Config {
  return {
    provider,
    apiKey: "test-key",
    model: "test-model",
    baseUrl: provider === "compatible" ? "http://localhost:11434/v1" : undefined,
    ignore: [],
    useIcons: false,
    ...overrides,
  };
}

describe("buildRequest openai", () => {
  const request = buildRequest(config("openai"), "system", "user", options);

  it("uses the OpenAI completions endpoint", () => {
    expect(request.url).toBe("https://api.openai.com/v1/chat/completions");
  });

  it("streams and requests JSON output", () => {
    expect(request.body.stream).toBe(true);
    expect(request.body.response_format).toEqual({ type: "json_object" });
    expect(request.body.max_tokens).toBe(2048);
  });

  it("is not the Ollama path", () => {
    expect(request.isOllama).toBe(false);
  });
});

describe("buildRequest anthropic", () => {
  const request = buildRequest(config("anthropic"), "system", "user", options);

  it("uses the messages endpoint with anthropic headers", () => {
    expect(request.url).toBe("https://api.anthropic.com/v1/messages");
    expect(request.headers["x-api-key"]).toBe("test-key");
    expect(request.headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("sends a non-streaming JSON body with system as a top-level field", () => {
    expect(request.body.stream).toBeUndefined();
    expect(request.body.max_tokens).toBe(2048);
    expect(request.body.system).toBe("system");
    expect(request.body.messages).toEqual([{ role: "user", content: "user" }]);
  });
});

describe("buildRequest gemini", () => {
  const request = buildRequest(config("gemini"), "system", "user", options);

  it("uses the generateContent endpoint with the key parameter", () => {
    expect(request.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent?key=test-key",
    );
  });

  it("requests JSON output without stream fields", () => {
    expect(request.body.stream).toBeUndefined();
    expect(request.body.reasoning_effort).toBeUndefined();
    const generationConfig = request.body.generationConfig as Record<string, unknown>;
    expect(generationConfig.response_mime_type).toBe("application/json");
    expect(generationConfig.maxOutputTokens).toBe(2048);
  });
});

describe("buildRequest ollama-compatible", () => {
  const request = buildRequest(config("compatible"), "system", "user", options);

  it("routes localhost:11434 to the native chat endpoint", () => {
    expect(request.url).toBe("http://localhost:11434/api/chat");
    expect(request.isOllama).toBe(true);
  });

  it("keeps the native non-streaming body without hint fields", () => {
    expect(request.body.stream).toBe(false);
    expect(request.body.reasoning_effort).toBeUndefined();
    const ollamaOptions = request.body.options as Record<string, unknown>;
    expect(ollamaOptions.num_predict).toBe(2048);
  });
});

describe("buildRequest custom compatible endpoint", () => {
  const request = buildRequest(
    config("compatible", { baseUrl: "http://localhost:8080/v1" }),
    "system",
    "user",
    options,
  );

  it("streams from the configured chat/completions URL", () => {
    expect(request.url).toBe("http://localhost:8080/v1/chat/completions");
    expect(request.body.stream).toBe(true);
    expect(request.body.reasoning_effort).toBe("none");
    expect(request.isOllama).toBe(false);
  });
});

describe("buildRetryRequest", () => {
  it("disables streaming for OpenAI", () => {
    const request = buildRetryRequest(config("openai"), "diff", options);
    expect(request.body.stream).toBe(false);
    expect(request.body.response_format).toEqual({ type: "json_object" });
  });

  it("disables streaming for compatible endpoints but not Ollama", () => {
    const compatible = buildRetryRequest(
      config("compatible", { baseUrl: "http://localhost:8080/v1" }),
      "diff",
      options,
    );
    expect(compatible.body.stream).toBe(false);
    const ollama = buildRetryRequest(config("compatible"), "diff", options);
    expect(ollama.isOllama).toBe(true);
    expect(ollama.body.stream).toBe(false);
  });

  it("keeps Anthropic and Gemini bodies unchanged and provider-shaped", () => {
    const anthropic = buildRetryRequest(config("anthropic"), "diff", options);
    expect(anthropic.body.system).toContain("message_commits");
    expect(anthropic.body.stream).toBeUndefined();
    const gemini = buildRetryRequest(config("gemini"), "diff", options);
    expect(gemini.body.stream).toBeUndefined();
    expect(gemini.body.reasoning_effort).toBeUndefined();
  });

  it("includes the body instruction when requested", () => {
    const request = buildRetryRequest(config("openai"), "diff", { ...options, body: true });
    const messages = request.body.messages as Array<{ role: string; content: string }>;
    expect(messages[0]).toMatchObject({ role: "system" });
    expect(JSON.stringify(messages)).toContain("bullet-list");
  });
});

describe("buildSystemPrompt", () => {
  it("uses the JSON instruction for structured providers", () => {
    for (const provider of ["openai", "anthropic", "gemini"]) {
      expect(buildSystemPrompt(provider, options)).toContain("message_commits");
    }
  });

  it("uses plain text for compatible and Ollama", () => {
    expect(buildSystemPrompt("compatible", options)).toContain("Output ONLY the commit message");
  });

  it("describes body placement for structured providers", () => {
    const prompt = buildSystemPrompt("gemini", { ...options, body: true });
    expect(prompt).toContain("The message value must include a blank line");
  });
});
