import { z } from "zod";

export const ProviderSchema = z.enum(["openai", "anthropic", "gemini", "compatible"]);

export const ConventionTypeSchema = z.object({
  type: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .regex(/^[a-zA-Z]+$/, "Use letters only.")
    .transform((value) => value.toLowerCase()),
  description: z.string().trim().min(1).max(120).default(""),
  icon: z.string().trim().max(10).optional(),
});

export const DEFAULT_CONVENTION_TYPES: z.infer<typeof ConventionTypeSchema>[] = [
  { type: "feat", description: "A new feature", icon: "✨" },
  { type: "fix", description: "A bug fix", icon: "🐛" },
  { type: "docs", description: "Documentation changes", icon: "📝" },
  { type: "style", description: "Code style changes", icon: "💄" },
  { type: "refactor", description: "Code refactoring", icon: "♻️" },
  { type: "perf", description: "Performance improvements", icon: "⚡" },
  { type: "test", description: "Test changes", icon: "✅" },
  { type: "build", description: "Build system changes", icon: "📦" },
  { type: "ci", description: "CI changes", icon: "👷" },
  { type: "chore", description: "Other changes", icon: "🔧" },
  { type: "revert", description: "Revert a commit", icon: "⏪" },
];

export const ConventionSchema = z.object({
  enabled: z.boolean().default(true),
  types: z
    .array(ConventionTypeSchema)
    .min(1, "Add at least one type.")
    .default(DEFAULT_CONVENTION_TYPES),
});

export type ConventionType = z.infer<typeof ConventionTypeSchema>;
export type Convention = z.infer<typeof ConventionSchema>;

export const ConfigSchema = z
  .object({
    provider: ProviderSchema,
    apiKey: z.string().trim().min(1, "An API key is required."),
    model: z.string().trim().min(1, "A model is required."),
    baseUrl: z.url().optional(),
    ignore: z.array(z.string()).default([]),
    useIcons: z.boolean().default(false),
    convention: ConventionSchema.default({
      enabled: true,
      types: DEFAULT_CONVENTION_TYPES,
    }),
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
