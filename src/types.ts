import { z } from "zod";

export const ProviderSchema = z.enum(["openai", "anthropic", "gemini", "compatible"]);

export const ConfigSchema = z
  .object({
    provider: ProviderSchema,
    apiKey: z.string().trim().min(1, "An API key is required."),
    model: z.string().trim().min(1, "A model is required."),
    baseUrl: z.url().optional(),
    ignore: z.array(z.string()).default([]),
    useIcons: z.boolean().default(false),
  })
  .superRefine((config, context) => {
    if (config.provider === "compatible" && !config.baseUrl) {
      context.addIssue({
        code: "custom",
        path: ["baseUrl"],
        message: "A base URL is required for compatible providers.",
      });
    }
  });

export type Provider = z.infer<typeof ProviderSchema>;
export type Config = z.infer<typeof ConfigSchema>;

export type Options = {
  dryRun: boolean;
  yes: boolean;
  body: boolean;
  breaking: boolean;
  breakingDescription?: string;
  regenHint?: string;
};

export class CliError extends Error {}

export const DEFAULT_MODELS: Record<Provider, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-latest",
  gemini: "gemini-2.0-flash",
  compatible: "",
};
