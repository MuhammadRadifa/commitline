import { CONVENTIONAL_COMMIT } from "../commit";

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

export function commitMessageFromResponse(message: string): string {
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

  const subject =
    cleaned
      .match(
        /(?:feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(?:\([a-z0-9._/-]+\))?!?: [^\n`]+/i,
      )?.[0]
      .trim() || "";
  if (subject && !isPlaceholderCommit(subject)) return stripReasoning(subject);

  const lines = cleaned
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    if (isReasoningLine(line)) continue;
    if (CONVENTIONAL_COMMIT.test(line)) return stripReasoning(line);
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
