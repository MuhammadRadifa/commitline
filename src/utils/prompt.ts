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

const PR_JSON_INSTRUCTION =
  'Return ONLY a JSON object: {"pr_title":"<single-line PR title>","pr_body":"<markdown PR description>"}. No other text.';

const PR_TEXT_INSTRUCTION = [
  "Output the PR suggestion as:",
  "Title: <single-line PR title>",
  "Body:",
  "<markdown PR description>",
  "No other text.",
].join("\n");

export function buildPrSystemPrompt(
  provider: string,
  convention?: Convention | null,
  currentBranch?: string,
  baseBranch?: string,
): string {
  const structured = isStructuredProvider(provider);
  const enabled = !convention || convention.enabled !== false;
  const allowed = enabled
    ? (convention?.types.map((t) => t.type).join(", ") ??
      "feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert")
    : "";
  const details = enabled ? describeConvention(convention ?? null) : "";
  const scope =
    currentBranch && baseBranch
      ? `The PR merges "${currentBranch}" into "${baseBranch}".`
      : "The PR merges the current branch into its base branch.";
  const lines = enabled
    ? [
        "Summarize the branch below into one GitHub pull request title and description.",
        scope,
        `The title MUST be one Conventional Commit subject. Allowed types: ${allowed}.`,
        details ? `Type meanings: ${details}.` : "",
        "Title format: type: description or type(scope): description. Keep it under 72 characters.",
        "Describe the actual behavior change, not file names. Complete the title; never end with an ellipsis.",
        "The body must be markdown with sections: Summary, Changes (bullet list), Test plan (bullet list). Keep it concise.",
        "Derive everything from the branch commits and diff. Do not invent changes.",
        structured ? PR_JSON_INSTRUCTION : PR_TEXT_INSTRUCTION,
      ]
    : [
        "Summarize the branch below into one GitHub pull request title and description.",
        scope,
        "The title must be a single concise subject line under 72 characters.",
        "Describe the actual behavior change, not file names.",
        "The body must be markdown with sections: Summary, Changes (bullet list), Test plan (bullet list). Keep it concise.",
        "Derive everything from the branch commits and diff. Do not invent changes.",
        structured ? PR_JSON_INSTRUCTION : PR_TEXT_INSTRUCTION,
      ];
  return lines.filter(Boolean).join(structured ? " " : "\n");
}

export function buildPrUserPrompt(
  commits: { hash: string; subject: string; body: string }[],
  files: string[],
  stat: string,
  diff: string,
  hint?: string,
): string {
  const log = commits
    .map(
      (c) =>
        `- ${c.subject}${c.body ? `\n  ${c.body.split("\n").join("\n  ")}` : ""} (${c.hash.slice(0, 7)})`,
    )
    .join("\n");
  return [
    `Branch commits (${commits.length}):`,
    log,
    "",
    `Changed files:\n${files.length ? files.join("\n") : "(none)"}`,
    "",
    stat ? `Diff stat:\n${stat}\n` : "",
    `Branch diff:\n${diff}`,
    hint ? `\nAdditional guidance: ${hint}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
