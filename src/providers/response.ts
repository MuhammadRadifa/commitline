import { z } from "zod";
import type { Provider } from "../types";
import { CliError } from "../types";
import {
  CompatibleResponseSchema,
  AnthropicResponseSchema,
  GeminiResponseSchema,
  OllamaResponseSchema,
} from "./schemas";

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      const value = z.object({ text: z.string().optional() }).safeParse(part);
      return value.success ? value.data.text || "" : "";
    })
    .join("\n");
}

export function messageText(message: unknown): string {
  if (typeof message === "string") return message;
  const data = z
    .object({
      content: z.unknown().optional(),
      text: z.unknown().optional(),
      reasoning_content: z.unknown().optional(),
      reasoning: z.unknown().optional(),
    })
    .passthrough()
    .safeParse(message);
  if (!data.success) return "";
  return (
    contentText(data.data.content) ||
    contentText(data.data.text) ||
    contentText(data.data.reasoning_content) ||
    contentText(data.data.reasoning)
  );
}

export function extractText(response: unknown, provider: Provider): string {
  if (provider === "anthropic") {
    const data = AnthropicResponseSchema.safeParse(response);
    return data.success
      ? data.data.content
          .filter((item) => item.type === "text")
          .map((item) => item.text || "")
          .join("\n")
      : "";
  }
  if (provider === "gemini") {
    const data = GeminiResponseSchema.safeParse(response);
    return data.success
      ? data.data.candidates[0]?.content.parts.map((part) => part.text || "").join("\n") || ""
      : "";
  }
  const data = CompatibleResponseSchema.safeParse(response);
  if (!data.success) return "";
  const choice = data.data.choices[0];
  if (!choice) return "";
  return messageText(choice.message) || messageText(choice.delta) || choice.text || "";
}

export function extractOllamaText(response: unknown): string {
  const data = OllamaResponseSchema.safeParse(response);
  return data.success ? data.data.message.content : "";
}

export type StreamEvents = {
  onThinking?: (thinking: string) => void;
  onText?: (snippet: string) => void;
};

export type StreamResult = { message: string; thinking: string };

type DeltaChannels = { text: string; reasoning: string };

function deltaChannels(delta: unknown): DeltaChannels {
  if (typeof delta === "string") return { text: delta, reasoning: "" };
  const data = z
    .object({
      content: z.unknown().optional(),
      text: z.unknown().optional(),
      reasoning_content: z.unknown().optional(),
      reasoning: z.unknown().optional(),
    })
    .passthrough()
    .safeParse(delta);
  if (!data.success) return { text: "", reasoning: "" };
  return {
    text: contentText(data.data.content) || contentText(data.data.text),
    reasoning: contentText(data.data.reasoning_content) || contentText(data.data.reasoning),
  };
}

const THINKING_EMIT_INTERVAL_MS = 150;

export async function readCompatibleStream(
  response: Response,
  events: StreamEvents = {},
): Promise<StreamResult> {
  if (!response.body)
    throw new CliError("The compatible provider returned an empty streaming response.");
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  const message: string[] = [];
  const thinking: string[] = [];
  let lastThinkingEmit = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      const payload = (() => {
        try {
          return JSON.parse(data);
        } catch {
          return undefined;
        }
      })();
      if (!payload) continue;
      const chunk = CompatibleResponseSchema.safeParse(payload);
      if (!chunk.success) continue;
      const choice = chunk.data.choices[0];
      if (!choice) continue;
      let channels = deltaChannels(choice.delta);
      if (!channels.text && !channels.reasoning && choice.message) {
        channels = deltaChannels(choice.message);
      }
      if (channels.reasoning) {
        thinking.push(channels.reasoning);
        const now = Date.now();
        if (events.onThinking && now - lastThinkingEmit >= THINKING_EMIT_INTERVAL_MS) {
          lastThinkingEmit = now;
          events.onThinking(thinking.join(""));
        }
      }
      if (channels.text) {
        message.push(channels.text);
        events.onText?.(channels.text);
      }
    }
  }
  return { message: message.join(""), thinking: thinking.join("") };
}
