import * as p from "@clack/prompts";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import pc from "picocolors";
import { z } from "zod";
import {
  CliError,
  ConfigSchema,
  ConventionSchema,
  DEFAULT_CONVENTION_TYPES,
  DEFAULT_MODELS,
  type Config,
  type Convention,
  type Provider,
} from "./types";

const CONFIG_PATH = join(
  process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
  "commitline",
  "config.json",
);
const OpenAIModelsSchema = z.object({ data: z.array(z.object({ id: z.string() })) });
const AnthropicModelsSchema = z.object({ data: z.array(z.object({ id: z.string() })) });
const GeminiModelsSchema = z.object({
  models: z.array(
    z.object({ name: z.string(), supportedGenerationMethods: z.array(z.string()).optional() }),
  ),
});

function requirePrompt<T>(value: T | symbol): T {
  if (p.isCancel(value)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }
  return value;
}

async function fetchModels(
  provider: Provider,
  apiKey: string,
  baseUrl?: string,
): Promise<string[]> {
  const headers: Record<string, string> = {};
  let url: string;
  if (provider === "gemini") {
    url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
  } else if (provider === "anthropic") {
    url = "https://api.anthropic.com/v1/models";
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else {
    url = `${(provider === "compatible" ? baseUrl : "https://api.openai.com/v1")?.replace(/\/$/, "")}/models`;
    headers.authorization = `Bearer ${apiKey}`;
  }
  try {
    const response = await fetch(url, { headers });
    if (!response.ok) return [];
    const payload = await response.json();
    if (provider === "gemini") {
      const models = GeminiModelsSchema.safeParse(payload);
      return models.success
        ? models.data.models
            .filter(
              (model) =>
                !model.supportedGenerationMethods ||
                model.supportedGenerationMethods.includes("generateContent"),
            )
            .map((model) => model.name.replace(/^models\//, ""))
        : [];
    }
    const models = (
      provider === "anthropic" ? AnthropicModelsSchema : OpenAIModelsSchema
    ).safeParse(payload);
    return models.success ? models.data.data.map((model) => model.id) : [];
  } catch {
    return [];
  }
}

async function chooseModel(
  provider: Provider,
  apiKey: string,
  baseUrl?: string,
  currentModel?: string,
): Promise<string> {
  const spinner = p.spinner();
  spinner.start("Looking for available models");
  const models = [...new Set(await fetchModels(provider, apiKey, baseUrl))].sort();
  spinner.stop(
    models.length
      ? `Found ${models.length} model${models.length === 1 ? "" : "s"}`
      : "No model information available",
  );
  if (!models.length) {
    p.log.info(
      "Enter the model name manually. Model discovery may be unavailable for this provider or API key.",
    );
    return requirePrompt(
      await p.text({
        message: "Model",
        initialValue: currentModel || DEFAULT_MODELS[provider],
        validate: (value) => ((value ?? "").trim() ? undefined : "A model is required."),
      }),
    );
  }
  const visibleModels = models.slice(0, 30);
  const selected = requirePrompt(
    await p.select({
      message: "Select a model or enter one manually",
      options: [
        ...visibleModels.map((model) => ({ value: model, label: model })),
        {
          value: "__custom__",
          label: "Enter a custom model",
          hint: "Use a model not listed above",
        },
      ],
      initialValue: visibleModels.includes(currentModel || "")
        ? currentModel
        : visibleModels.includes(DEFAULT_MODELS[provider])
          ? DEFAULT_MODELS[provider]
          : undefined,
    }),
  );
  return selected === "__custom__"
    ? requirePrompt(
        await p.text({
          message: "Model",
          initialValue: currentModel || DEFAULT_MODELS[provider],
          validate: (value) => ((value ?? "").trim() ? undefined : "A model is required."),
        }),
      )
    : selected;
}

export async function loadConfig(): Promise<Config | undefined> {
  if (!existsSync(CONFIG_PATH)) return undefined;
  try {
    const config = ConfigSchema.safeParse(JSON.parse(await readFile(CONFIG_PATH, "utf8")));
    if (!config.success)
      throw new CliError(
        `Could not validate ${CONFIG_PATH}: ${config.error.issues[0]?.message || "invalid configuration"}. Run \`commitline config\` to recreate it.`,
      );
    return config.data;
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError(`Could not read ${CONFIG_PATH}. Run \`commitline config\` to recreate it.`);
  }
}

export async function saveConfig(config: Config): Promise<void> {
  const parsed = ConfigSchema.parse(config);
  await mkdir(dirname(CONFIG_PATH), { recursive: true });
  await writeFile(CONFIG_PATH, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 });
  await chmod(CONFIG_PATH, 0o600);
}

function formatConvention(current: Convention, useIcons = true): string {
  const status = current.enabled ? "enabled" : "disabled";
  const icons = useIcons ? "icons on" : "icons off";
  const types = current.types
    .map((t) =>
      useIcons && t.icon
        ? `${t.icon} ${t.type}${t.description ? ` — ${t.description}` : ""}`
        : `${t.type}${t.description ? ` — ${t.description}` : ""}`,
    )
    .join("\n  ");
  return `Convention ${status}, ${icons} (${current.types.length} types):\n  ${types}`;
}

function validateTypeName(value: string | undefined, taken: string[]): string | undefined {
  const name = (value ?? "").trim().toLowerCase();
  if (!name) return "A type name is required.";
  if (!/^[a-z]+$/.test(name)) return "Use lowercase letters only (a-z).";
  if (name.length > 20) return "Keep it under 20 characters.";
  if (taken.includes(name)) return "This type already exists.";
  return undefined;
}

async function promptAddType(taken: string[]): Promise<Convention["types"][number] | undefined> {
  const type = requirePrompt(
    await p.text({
      message: "New type name (e.g. chore, feat, hotfix)",
      validate: (value) => validateTypeName(value, taken),
    }),
  )
    .trim()
    .toLowerCase();
  const description = requirePrompt(
    await p.text({
      message: `Description for "${type}"`,
      initialValue: "",
      validate: (value) => ((value ?? "").trim() ? undefined : "A description is required."),
    }),
  ).trim();
  const icon = requirePrompt(
    await p.text({
      message: `Icon for "${type}" (optional, blank for none)`,
      initialValue: "",
    }),
  ).trim();
  return icon ? { type, description, icon } : { type, description };
}

export async function promptConvention(
  current?: Convention,
  currentUseIcons = false,
): Promise<{ convention: Convention; useIcons: boolean }> {
  let draft: Convention = current
    ? ConventionSchema.parse(structuredClone(current))
    : ConventionSchema.parse({ enabled: true, types: DEFAULT_CONVENTION_TYPES });
  let useIcons = currentUseIcons;

  p.note(
    "Enforced:\n  feat: add user authentication\n  fix(auth): handle expired tokens\n\nNot enforced:\n  any message, e.g. updated stuff",
    "Conventional Commits",
  );
  draft.enabled = requirePrompt(
    await p.confirm({
      message: "Enforce Conventional Commits?",
      initialValue: draft.enabled,
    }),
  );

  while (true) {
    p.log.message(formatConvention(draft, useIcons));
    const action = requirePrompt(
      await p.select({
        message: "Convention rules",
        options: [
          {
            value: "toggle",
            label: draft.enabled ? "Disable convention" : "Enable convention",
            hint: "Turn enforcement on/off",
          },
          {
            value: "icons",
            label: useIcons ? "Disable icons" : "Enable icons",
            hint: useIcons ? "No icon before message" : "e.g. ✨ feat: add login",
          },
          { value: "add", label: "Add custom type", hint: "e.g. hotfix, wip, security" },
          { value: "edit", label: "Edit rule", hint: "Change description or icon" },
          { value: "remove", label: "Remove type", hint: "Delete one or more types" },
          {
            value: "reset",
            label: "Reset to defaults",
            hint: `${DEFAULT_CONVENTION_TYPES.length} built-in types`,
          },
          { value: "done", label: "Done", hint: "Save and continue" },
        ],
        initialValue: "done",
      }),
    );

    if (action === "done") break;

    if (action === "toggle") {
      draft.enabled = !draft.enabled;
      continue;
    }

    if (action === "icons") {
      useIcons = !useIcons;
      continue;
    }

    if (action === "reset") {
      draft.types = structuredClone(DEFAULT_CONVENTION_TYPES);
      p.log.success("Restored default rules.");
      continue;
    }

    if (action === "add") {
      const added = await promptAddType(draft.types.map((t) => t.type));
      if (added) {
        draft.types.push(added);
        p.log.success(`Added "${added.type}".`);
      }
      continue;
    }

    if (action === "edit") {
      const target = requirePrompt(
        await p.select({
          message: "Select a rule to edit",
          options: draft.types.map((t) => ({
            value: t.type,
            label: `${t.icon ? `${t.icon} ` : ""}${t.type}`,
            hint: t.description,
          })),
        }),
      );
      const entry = draft.types.find((t) => t.type === target);
      if (!entry) continue;
      entry.description = requirePrompt(
        await p.text({
          message: `Description for "${entry.type}"`,
          initialValue: entry.description,
          validate: (value) => ((value ?? "").trim() ? undefined : "A description is required."),
        }),
      ).trim();
      const icon = requirePrompt(
        await p.text({
          message: `Icon for "${entry.type}" (blank to remove)`,
          initialValue: entry.icon ?? "",
        }),
      ).trim();
      if (icon) entry.icon = icon;
      else delete entry.icon;
      continue;
    }

    if (action === "remove") {
      if (draft.types.length <= 1) {
        p.log.warn("Keep at least one type.");
        continue;
      }
      const doomed = requirePrompt(
        await p.multiselect({
          message: "Select types to remove",
          options: draft.types.map((t) => ({ value: t.type, label: t.type, hint: t.description })),
          required: true,
        }),
      );
      if (doomed.length >= draft.types.length) {
        p.log.warn("Keep at least one type.");
        continue;
      }
      draft.types = draft.types.filter((t) => !doomed.includes(t.type));
      p.log.success(`Removed ${doomed.join(", ")}.`);
    }
  }

  return { convention: ConventionSchema.parse(draft), useIcons };
}

export type ConventionActionOptions = {
  enable?: boolean;
  disable?: boolean;
  list?: boolean;
  reset?: boolean;
  icons?: boolean;
  noIcons?: boolean;
  add?: string[];
};

export async function manageConvention(options: ConventionActionOptions = {}): Promise<void> {
  let config = await loadConfig();
  if (!config) {
    p.log.error("No configuration found. Run `commitline config` first.");
    process.exit(1);
  }
  const current: Convention = config.convention ?? {
    enabled: true,
    types: DEFAULT_CONVENTION_TYPES,
  };

  if (options.list) {
    p.log.message(formatConvention(current, config.useIcons));
    return;
  }

  if (options.reset) {
    config = {
      ...config,
      convention: { enabled: current.enabled, types: structuredClone(DEFAULT_CONVENTION_TYPES) },
    };
    await saveConfig(config);
    p.log.success("Convention reset to defaults.");
    p.log.message(formatConvention(config.convention, config.useIcons));
    return;
  }

  if (options.enable || options.disable) {
    config = { ...config, convention: { ...current, enabled: Boolean(options.enable) } };
    await saveConfig(config);
    p.log.success(`Convention ${config.convention.enabled ? "enabled" : "disabled"}.`);
    return;
  }

  if (options.icons || options.noIcons) {
    config = { ...config, useIcons: Boolean(options.icons) };
    await saveConfig(config);
    p.log.success(`Icons ${config.useIcons ? "enabled" : "disabled"}.`);
    return;
  }

  if (options.add?.length) {
    const types = [...current.types];
    for (const raw of options.add) {
      const [name = "", description = "", icon = ""] = raw.split(":").map((s) => s.trim());
      const error = validateTypeName(
        name.toLowerCase(),
        types.map((t) => t.type),
      );
      if (error) {
        p.log.error(`Skipped "${raw}": ${error} Expected type[:description[:icon]].`);
        continue;
      }
      types.push(
        icon
          ? { type: name.toLowerCase(), description: description || name, icon }
          : { type: name.toLowerCase(), description: description || name },
      );
    }
    config = { ...config, convention: { ...current, types } };
    await saveConfig(ConfigSchema.parse(config));
    p.log.success("Custom type(s) added.");
    p.log.message(formatConvention(config.convention, config.useIcons));
    return;
  }

  p.intro(pc.bgCyan(pc.black(" [commitline] Convention ")));
  const next = await promptConventionSection(current, config.useIcons);
  await saveConfig({ ...config, useIcons: next.useIcons, convention: next.convention });
  p.outro(`${pc.green("[ok] Convention saved")} ${pc.dim(CONFIG_PATH)}`);
}

const PROVIDER_OPTIONS = [
  { value: "openai" as const, label: "[O] OpenAI", hint: "GPT models through api.openai.com" },
  {
    value: "anthropic" as const,
    label: "[A] Anthropic",
    hint: "Claude models through api.anthropic.com",
  },
  {
    value: "gemini" as const,
    label: "[G] Google Gemini",
    hint: "Gemini models through Google AI Studio",
  },
  {
    value: "compatible" as const,
    label: "[>] Compatible API",
    hint: "Ollama, LM Studio, or another compatible server",
  },
];

type AiDraft = Pick<Config, "provider" | "apiKey" | "baseUrl" | "model">;

async function promptAiConfiguration(current?: AiDraft): Promise<AiDraft> {
  const provider = requirePrompt(
    await p.select<Provider>({
      message: "Select your AI provider",
      options: PROVIDER_OPTIONS,
      initialValue: current?.provider ?? "openai",
    }),
  );
  const isFresh = !current;
  const enteredApiKey = requirePrompt(
    await p.password({
      message: isFresh ? "API key" : "API key (leave blank to keep current key)",
      validate: (value) =>
        (value ?? "").trim() || (!isFresh && current?.apiKey)
          ? undefined
          : "An API key is required.",
    }),
  );
  const apiKey = enteredApiKey.trim() || (!isFresh ? (current?.apiKey ?? "") : "");
  const baseUrl =
    provider === "compatible"
      ? requirePrompt(
          await p.text({
            message: "OpenAI-compatible base URL",
            initialValue:
              current?.provider === "compatible"
                ? (current?.baseUrl ?? "")
                : "http://localhost:11434/v1",
            validate: (value) =>
              z.url().safeParse(value ?? "").success ? undefined : "Enter a valid URL.",
          }),
        )
      : undefined;
  const model = await chooseModel(provider, apiKey, baseUrl, current?.model);
  return { provider, apiKey, baseUrl, model };
}

async function promptConventionSection(
  currentConvention?: Convention,
  currentUseIcons = false,
): Promise<{ convention: Convention; useIcons: boolean }> {
  p.note(
    "With icons:\n  ✨ feat: add user authentication\n  🐛 fix: resolve login timeout\n\nWithout icons:\n  feat: add user authentication\n  fix: resolve login timeout",
    "Commit icons",
  );
  const useIcons = requirePrompt(
    await p.confirm({
      message: "Add an icon before each commit message?",
      initialValue: currentUseIcons,
    }),
  );
  return promptConvention(currentConvention, useIcons);
}

export async function configure(): Promise<void> {
  const existing = await loadConfig();
  p.intro(pc.bgCyan(pc.black(" [commitline] Setup ")));
  p.log.info("Your API key stays in a local file and is sent only to your selected provider.");

  if (!existing) {
    const ai = await promptAiConfiguration();
    const section = await promptConventionSection(undefined, false);
    await saveConfig(
      ConfigSchema.parse({
        ...ai,
        ignore: [],
        useIcons: section.useIcons,
        convention: section.convention,
      }),
    );
    p.outro(`${pc.green("[ok] Configuration saved")} ${pc.dim(CONFIG_PATH)}`);
    return;
  }

  let draft: Config = existing;
  while (true) {
    const conventionHint =
      draft.convention?.enabled === false
        ? "disabled"
        : `${draft.convention?.types.length ?? 0} types${draft.useIcons ? ", icons on" : ", icons off"}`;
    const section = requirePrompt(
      await p.select({
        message: "Select configuration",
        options: [
          {
            value: "ai",
            label: "AI Configuration",
            hint: `${draft.provider} / ${draft.model}`,
          },
          { value: "convention", label: "Commit Convention", hint: conventionHint },
          { value: "done", label: "Done", hint: "Save and exit" },
        ],
        initialValue: "done",
      }),
    );

    if (section === "done") break;

    if (section === "ai") {
      const ai = await promptAiConfiguration(draft);
      draft = ConfigSchema.parse({ ...draft, ...ai });
      await saveConfig(draft);
      p.log.success("AI configuration saved.");
      continue;
    }

    const next = await promptConventionSection(draft.convention, draft.useIcons);
    draft = ConfigSchema.parse({ ...draft, useIcons: next.useIcons, convention: next.convention });
    await saveConfig(draft);
    p.log.success("Commit convention saved.");
  }

  p.outro(`${pc.green("[ok] Configuration saved")} ${pc.dim(CONFIG_PATH)}`);
}
