import type { Convention, Options } from "../types";

const STRUCTURED_PROVIDERS = new Set(["openai", "anthropic", "gemini"]);

const JSON_INSTRUCTION =
  'Return ONLY a JSON object: {"message_commits":"<the commit message>"}. No other text.';

const TEXT_INSTRUCTION = "DO NOT explain. Output ONLY the commit message.";

export function isStructuredProvider(provider: string): boolean {
  return STRUCTURED_PROVIDERS.has(provider);
}

export function describeConvention(convention?: Convention | null): string {
  if (!convention || !convention.enabled) return "";
  return convention.types
    .map((t) => (t.description ? `${t.type}: ${t.description}` : t.type))
    .join(", ");
}

export function buildSystemPrompt(
  provider: string,
  options: Pick<Options, "body" | "breaking" | "breakingDescription">,
  convention?: Convention | null,
): string {
  const structured = isStructuredProvider(provider);
  const enabled = !convention || convention.enabled !== false;
  const allowed = enabled
    ? (convention?.types.map((t) => t.type).join(", ") ??
      "feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert")
    : "";
  const details = enabled ? describeConvention(convention ?? null) : "";
  const lines = enabled
    ? [
        "Generate one Conventional Commit message from the staged git diff.",
        `Allowed types: ${allowed}.`,
        details ? `Type meanings: ${details}.` : "",
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
      ]
    : [
        "Generate one concise git commit message from the staged git diff.",
        "Format: a single subject line describing the actual behavior change, not file names.",
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
        "Complete the subject; never end with an ellipsis.",
        structured ? JSON_INSTRUCTION : TEXT_INSTRUCTION,
      ];
  return lines.filter(Boolean).join(structured ? " " : "\n");
}

export function buildUserPrompt(files: string[], diff: string, hint?: string): string {
  return `Changed files:\n${files.join("\n")}\n\nStaged diff:\n${diff}${hint ? `\n\nAdditional guidance: ${hint}` : ""}`;
}
