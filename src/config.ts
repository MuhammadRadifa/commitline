import * as p from "@clack/prompts";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import pc from "picocolors";
import { z } from "zod";
import { CliError, ConfigSchema, DEFAULT_MODELS, type Config, type Provider } from "./types";

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

export async function configure(): Promise<void> {
  const existing = await loadConfig();
  p.intro(pc.bgCyan(pc.black(" [commitline] Setup ")));
  p.note(
    "Your API key stays in a local file and is sent only to your selected provider.",
    "[lock] Privacy",
  );

  if (existing) {
    const fields = requirePrompt(
      await p.multiselect({
        message: "Select what to change",
        options: [
          { value: "provider", label: "Provider", hint: existing.provider },
          { value: "apiKey", label: "API Key", hint: "***" },
          { value: "model", label: "Model", hint: existing.model },
          ...(existing.provider === "compatible"
            ? [{ value: "baseUrl" as const, label: "Base URL", hint: existing.baseUrl ?? "" }]
            : []),
          { value: "useIcons", label: "Use Icons", hint: existing.useIcons ? "yes" : "no" },
        ],
        required: false,
      }),
    );

    if (!fields.length) {
      p.outro("Nothing changed.");
      return;
    }

    let provider = existing.provider;
    let apiKey = existing.apiKey;
    let baseUrl = existing.baseUrl;
    let model = existing.model;
    let useIcons = existing.useIcons;

    if (fields.includes("provider")) {
      provider = requirePrompt(
        await p.select<Provider>({
          message: "Select your AI provider",
          options: [
            { value: "openai", label: "[O] OpenAI", hint: "GPT models through api.openai.com" },
            {
              value: "anthropic",
              label: "[A] Anthropic",
              hint: "Claude models through api.anthropic.com",
            },
            {
              value: "gemini",
              label: "[G] Google Gemini",
              hint: "Gemini models through Google AI Studio",
            },
            {
              value: "compatible",
              label: "[>] Compatible API",
              hint: "Ollama, LM Studio, or another compatible server",
            },
          ],
          initialValue: existing.provider,
        }),
      );
      if (provider !== existing.provider) {
        baseUrl = provider === "compatible" ? baseUrl : undefined;
        fields.push("model");
      }
    }

    if (fields.includes("apiKey")) {
      const entered = requirePrompt(
        await p.password({
          message: "API key (leave blank to keep current key)",
          validate: (value) =>
            (value ?? "").trim() || apiKey ? undefined : "An API key is required.",
        }),
      );
      if (entered.trim()) apiKey = entered.trim();
    }

    if (fields.includes("baseUrl") && provider === "compatible") {
      baseUrl = requirePrompt(
        await p.text({
          message: "OpenAI-compatible base URL",
          initialValue: baseUrl || "http://localhost:11434/v1",
          validate: (value) =>
            z.url().safeParse(value ?? "").success ? undefined : "Enter a valid URL.",
        }),
      );
    }

    if (fields.includes("model")) {
      model = await chooseModel(provider, apiKey, baseUrl, model);
    }

    if (fields.includes("useIcons")) {
      useIcons = requirePrompt(
        await p.confirm({
          message: "Add an icon before each commit message?",
          initialValue: useIcons,
        }),
      );
    }

    const config = ConfigSchema.parse({ provider, apiKey, model, baseUrl, ignore: [], useIcons });
    await mkdir(dirname(CONFIG_PATH), { recursive: true });
    await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    await chmod(CONFIG_PATH, 0o600);
    p.outro(`${pc.green("[ok] Configuration saved")} ${pc.dim(CONFIG_PATH)}`);
    return;
  }

  const provider = requirePrompt(
    await p.select<Provider>({
      message: "Select your AI provider",
      options: [
        { value: "openai", label: "[O] OpenAI", hint: "GPT models through api.openai.com" },
        {
          value: "anthropic",
          label: "[A] Anthropic",
          hint: "Claude models through api.anthropic.com",
        },
        {
          value: "gemini",
          label: "[G] Google Gemini",
          hint: "Gemini models through Google AI Studio",
        },
        {
          value: "compatible",
          label: "[>] Compatible API",
          hint: "Ollama, LM Studio, or another compatible server",
        },
      ],
      initialValue: "openai",
    }),
  );
  const enteredApiKey = requirePrompt(
    await p.password({
      message: "API key",
      validate: (value) => ((value ?? "").trim() ? undefined : "An API key is required."),
    }),
  );
  const apiKey = enteredApiKey.trim();
  const baseUrl =
    provider === "compatible"
      ? requirePrompt(
          await p.text({
            message: "OpenAI-compatible base URL",
            initialValue: "http://localhost:11434/v1",
            validate: (value) =>
              z.url().safeParse(value ?? "").success ? undefined : "Enter a valid URL.",
          }),
        )
      : undefined;
  const model = await chooseModel(provider, apiKey, baseUrl);
  const useIcons = requirePrompt(
    await p.confirm({
      message: "Add an icon before each commit message?",
      initialValue: false,
    }),
  );
  const config = ConfigSchema.parse({ provider, apiKey, model, baseUrl, ignore: [], useIcons });
  await mkdir(dirname(CONFIG_PATH), { recursive: true });
  await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await chmod(CONFIG_PATH, 0o600);
  p.outro(`${pc.green("[ok] Configuration saved")} ${pc.dim(CONFIG_PATH)}`);
}
