import type { Options } from "../types";

const STRUCTURED_PROVIDERS = new Set(["openai", "anthropic", "gemini"]);

const JSON_INSTRUCTION =
  'Return ONLY a JSON object: {"message_commits":"<the commit message>"}. No other text.';

const TEXT_INSTRUCTION = "DO NOT explain. Output ONLY the commit message.";

export function isStructuredProvider(provider: string): boolean {
  return STRUCTURED_PROVIDERS.has(provider);
}

export function buildSystemPrompt(
  provider: string,
  options: Pick<Options, "body" | "breaking" | "breakingDescription">,
): string {
  const structured = isStructuredProvider(provider);
  const lines = [
    "Generate one Conventional Commit message from the staged git diff.",
    "Allowed types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert.",
    "Format: type: description or type(scope): description.",
    options.body
      ? structured
        ? "The message value must include a blank line then a concise bullet-list body."
        : "After the subject, add a blank line then a bullet-list body."
      : structured
        ? "The message value contains only the subject line."
        : "Output ONLY the commit subject. No explanation.",
    options.breaking
      ? `After a blank line, add BREAKING CHANGE: ${options.breakingDescription}.`
      : "",
    "Describe the actual behavior change, not file names.",
    "Complete the subject; never end with an ellipsis.",
    structured ? JSON_INSTRUCTION : TEXT_INSTRUCTION,
  ];
  return lines.filter(Boolean).join(structured ? " " : "\n");
}

export function buildUserPrompt(files: string[], diff: string, hint?: string): string {
  return `Changed files:\n${files.join("\n")}\n\nStaged diff:\n${diff}${hint ? `\n\nAdditional guidance: ${hint}` : ""}`;
}
