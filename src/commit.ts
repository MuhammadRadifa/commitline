export const CONVENTIONAL_COMMIT =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9._/-]+\))?!?: .+/i;

const COMMIT_ICONS: Record<string, string> = {
  feat: "✨",
  fix: "🐛",
  docs: "📝",
  style: "💄",
  refactor: "♻️",
  perf: "⚡",
  test: "✅",
  build: "📦",
  ci: "👷",
  chore: "🔧",
  revert: "⏪",
};

const MAX_DIFF_CHARS = 30_000;

export function truncateDiff(diff: string): { content: string; truncated: boolean } {
  if (diff.length <= MAX_DIFF_CHARS) return { content: diff, truncated: false };
  const fileDiffs = diff.split(/(?=^diff --git )/m);
  let content = "";
  for (const fileDiff of fileDiffs) {
    if (content.length + fileDiff.length > MAX_DIFF_CHARS) {
      const remaining = MAX_DIFF_CHARS - content.length;
      if (remaining > 200) content += fileDiff.slice(0, remaining);
      break;
    }
    content += fileDiff;
  }
  return { content, truncated: true };
}

export function validMessage(message: string): boolean {
  const firstLine = message.split("\n")[0] || "";
  const withoutIcon = firstLine.replace(/^[^\w]*/, "");
  return CONVENTIONAL_COMMIT.test(withoutIcon);
}

export function withCommitIcon(message: string, enabled: boolean): string {
  if (
    !enabled ||
    /^\S+\s+(?:feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)/i.test(message)
  )
    return message;
  const type = message
    .match(/^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)/i)?.[1]
    ?.toLowerCase();
  return type && COMMIT_ICONS[type] ? `${COMMIT_ICONS[type]} ${message}` : message;
}
