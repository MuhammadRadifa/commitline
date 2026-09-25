import { conventionPattern, conventionTypes } from "../commit";
import type { Convention } from "../types";

const REASONING_PATTERNS = [
  /^we are given/i,
  /^the (?:changes|diff|staged|commit)/i,
  /^(?:here|this) (?:is|are)/i,
  /^based on/i,
  /^looking at/i,
  /^analyzing/i,
  /^the files? (?:changed|modified|updated)/i,
  /^(?:changed|modified|updated) files?:/i,
  /^staged (?:diff|changes|files)/i,
  /^summary:/i,
  /^i (?:would|will|suggest)/i,
];

const INLINE_REASONING = [
  /\.\s+However[,.]/i,
  /\.\s+The user/i,
  /\.\s+I (?:should|need|think)/i,
  /\.\s+This (?:is|does)/i,
  /\.\s+Note:/i,
  /\.\s+But\b/i,
  /"\.\s+/,
  /\.\s+Since\b/i,
];

function isReasoningLine(line: string): boolean {
  return REASONING_PATTERNS.some((p) => p.test(line));
}

function stripReasoning(subject: string): string {
  let result = subject;
  for (const pattern of INLINE_REASONING) {
    const match = result.match(pattern);
    if (match && match.index !== undefined) {
      result = result.slice(0, match.index + 1).trim();
    }
  }
  if (result.length > 72) {
    const sentenceEnd = result.indexOf(". ");
    if (sentenceEnd > 10 && sentenceEnd < 72) {
      result = result.slice(0, sentenceEnd + 1).trim();
    }
  }
  return result.replace(/[""]/g, "").replace(/\s+$/, "");
}

export function isPlaceholderCommit(message: string): boolean {
  const m = message.trim().toLowerCase();
  if (/^(?:type|feat|fix)(?:\([^)]*\))?: (?:concise )?description$/.test(m)) return true;
  if (
    [
      "the message",
      "commit message",
      "your commit message here",
      "message",
      "placeholder",
    ].includes(m)
  )
    return true;
  if (m.length < 3) return true;
  return false;
}

export type PrSuggestion = { title: string; body: string };

function cleanTitle(value: string): string {
  return stripReasoning(
    value
      .trim()
      .replace(/^```(?:\w+)?\s*|```$/g, "")
      .trim(),
  ).trim();
}

function cleanBody(value: string): string {
  return value
    .trim()
    .replace(/^```(?:markdown|md)?\s*|```$/g, "")
    .trim();
}

function suggestionFromObject(obj: Record<string, unknown>): PrSuggestion | undefined {
  const rawTitle =
    obj.pr_title ?? obj.title ?? obj.subject ?? obj.message_commits ?? obj.message ?? obj.commit;
  const rawBody = obj.pr_body ?? obj.body ?? obj.description;
  const title = typeof rawTitle === "string" ? cleanTitle(rawTitle) : "";
  const body = typeof rawBody === "string" ? cleanBody(rawBody) : "";
  if (!title || isPlaceholderCommit(title)) return undefined;
  return { title, body };
}

export function prSuggestionFromResponse(message: string): PrSuggestion | undefined {
  const cleaned = message
    .trim()
    .replace(/^```(?:\w+)?\s*|```$/g, "")
    .trim();
  if (!cleaned) return undefined;

  const parsed = (() => {
    try {
      return JSON.parse(cleaned);
    } catch {
      return undefined;
    }
  })();
  if (parsed && typeof parsed === "object") {
    const suggestion = suggestionFromObject(parsed as Record<string, unknown>);
    if (suggestion) return suggestion;
  }

  const embeddedJson = cleaned.match(
    /\{\s*"(?:pr_title|pr_body|title|body|subject|description|message_commits|message|commit)"\s*:\s*"(?:[^"\\]|\\.)*"(?:\s*,\s*"(?:pr_title|pr_body|title|body|subject|description|message_commits|message|commit)"\s*:\s*"(?:[^"\\]|\\.)*")*\s*\}/,
  );
  if (embeddedJson) {
    try {
      const suggestion = suggestionFromObject(JSON.parse(embeddedJson[0]));
      if (suggestion) return suggestion;
    } catch {}
  }

  const titleMatch = cleaned.match(/^(?:pr[_\s-]?title|title|subject)\s*:\s*(.+)$/im);
  const bodyMatch = cleaned.match(/^(?:pr[_\s-]?body|body|description)\s*:\s*([\s\S]+)$/im);
  if (titleMatch?.[1]?.trim()) {
    const title = cleanTitle(titleMatch[1]);
    if (title && !isPlaceholderCommit(title)) {
      return { title, body: bodyMatch?.[1] ? cleanBody(bodyMatch[1]) : "" };
    }
  }

  const lines = cleaned
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !isReasoningLine(l));
  if (!lines.length) return undefined;
  const [first = "", ...rest] = lines;
  const title = cleanTitle(first.replace(/^(title|subject)\s*:\s*/i, ""));
  if (!title || isPlaceholderCommit(title) || title.length > 120) return undefined;
  return { title, body: cleanBody(rest.join("\n")) };
}

export function commitMessageFromResponse(
  message: string,
  typesOrConvention?: string[] | Pick<Convention, "types">,
): string {
  const types = Array.isArray(typesOrConvention)
    ? typesOrConvention
    : conventionTypes(typesOrConvention ?? null);
  const pattern = conventionPattern(types);
  const escaped = types.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const subjectRegex = new RegExp(`(?:${escaped})(?:\\([a-z0-9._/-]+\\))?!?: [^\\n\`]+`, "i");
  const cleaned = message
    .trim()
    .replace(/^```(?:\w+)?\s*|```$/g, "")
    .trim();
  if (!cleaned) return "";

  const parsed = (() => {
    try {
      return JSON.parse(cleaned);
    } catch {
      return undefined;
    }
  })();
  if (parsed && typeof parsed === "object") {
    const value = parsed.message_commits || parsed.message || parsed.commit;
    if (typeof value === "string" && value.trim() && !isPlaceholderCommit(value)) {
      return value.trim();
    }
  }

  const embeddedJson = cleaned.match(
    /\{\s*"(?:message_commits|message|commit)"\s*:\s*"(?:[^"\\]|\\.)*"\s*\}/,
  );
  if (embeddedJson) {
    try {
      const obj = JSON.parse(embeddedJson[0]);
      const value = obj.message_commits || obj.message || obj.commit;
      if (typeof value === "string" && value.trim() && !isPlaceholderCommit(value)) {
        return value.trim();
      }
    } catch {}
  }

  const subject = cleaned.match(subjectRegex)?.[0].trim() || "";
  if (subject && !isPlaceholderCommit(subject)) return stripReasoning(subject);

  const lines = cleaned
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    if (isReasoningLine(line)) continue;
    if (pattern.test(line)) return stripReasoning(line);
    if (
      line.length < 80 &&
      line.length >= 5 &&
      /^[a-z]/i.test(line) &&
      !line.endsWith(".") &&
      !line.includes(": ")
    ) {
      return line;
    }
  }

  return "";
}
