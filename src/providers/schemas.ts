import { z } from "zod";

export const CompatibleResponseSchema = z.object({
  choices: z
    .array(
      z
        .object({
          message: z.unknown().optional(),
          delta: z.unknown().optional(),
          text: z.string().optional(),
        })
        .passthrough(),
    )
    .min(1),
});

export const AnthropicResponseSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
});

export const GeminiResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z.object({
          parts: z.array(z.object({ text: z.string().optional() })),
        }),
      }),
    )
    .min(1),
});

export const OllamaResponseSchema = z.object({
  message: z.object({ content: z.string() }),
});
