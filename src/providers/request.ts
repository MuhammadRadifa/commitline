import type { Config, Options } from "../types";

const MAX_TOKENS = 2048;

function isOllamaUrl(baseUrl?: string): boolean {
  if (!baseUrl) return false;
  const url = new URL(baseUrl);
  return ["localhost", "127.0.0.1", "::1"].includes(url.hostname) && url.port === "11434";
}

function ollamaChatUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.pathname = "/api/chat";
  url.search = "";
  return url.toString();
}

export type ProviderRequest = {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  isOllama: boolean;
};

function providerBody(config: Config, system: string, user: string): Record<string, unknown> {
  if (config.provider === "anthropic") {
    return {
      model: config.model,
      max_tokens: MAX_TOKENS,
      system,
      messages: [{ role: "user", content: user }],
    };
  }

  if (config.provider === "gemini") {
    return {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: {
        maxOutputTokens: MAX_TOKENS,
        temperature: 0.2,
        response_mime_type: "application/json",
      },
    };
  }

  if (config.provider === "compatible" && isOllamaUrl(config.baseUrl)) {
    return {
      model: config.model,
      stream: false,
      options: { temperature: 0.2, num_predict: MAX_TOKENS },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    };
  }

  return {
    model: config.model,
    temperature: 0.2,
    max_tokens: MAX_TOKENS,
    stream: true,
    ...(config.provider === "openai" ? { response_format: { type: "json_object" } } : {}),
    ...(config.provider === "compatible" ? { reasoning_effort: "none" as const } : {}),
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
}

export function buildRequest(
  config: Config,
  system: string,
  user: string,
  _options: Options,
): ProviderRequest {
  if (config.provider === "anthropic") {
    return {
      url: "https://api.anthropic.com/v1/messages",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: providerBody(config, system, user),
      isOllama: false,
    };
  }

  if (config.provider === "gemini") {
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`,
      headers: { "content-type": "application/json" },
      body: providerBody(config, system, user),
      isOllama: false,
    };
  }

  if (config.provider === "compatible" && isOllamaUrl(config.baseUrl)) {
    return {
      url: ollamaChatUrl(config.baseUrl!),
      headers: { "content-type": "application/json" },
      body: providerBody(config, system, user),
      isOllama: true,
    };
  }

  const baseUrl = (
    config.provider === "compatible" ? config.baseUrl : "https://api.openai.com/v1"
  )?.replace(/\/$/, "");
  return {
    url: `${baseUrl}/chat/completions`,
    headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
    body: providerBody(config, system, user),
    isOllama: false,
  };
}

export function buildRetryRequest(config: Config, diff: string, options: Options): ProviderRequest {
  const system = `Output ONLY a JSON object: {"message_commits":"<the commit message>"}. No other text. The commit message is a Conventional Commit: type: description. Example: {"message_commits":"feat: add login"}.${
    options.body ? " Include a blank line then a concise bullet-list body." : ""
  }`;
  const request = buildRequest(config, system, diff.slice(0, 15_000), options);
  if (!request.isOllama && (config.provider === "openai" || config.provider === "compatible")) {
    return { ...request, body: { ...request.body, stream: false } };
  }
  return request;
}
