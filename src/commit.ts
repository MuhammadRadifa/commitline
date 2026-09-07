import { DEFAULT_CONVENTION_TYPES, type Convention } from "./types";

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

export function conventionTypes(convention?: Pick<Convention, "types"> | null): string[] {
  const types = convention?.types?.map((t) => t.type.toLowerCase()).filter(Boolean);
  return types?.length ? [...new Set(types)] : DEFAULT_CONVENTION_TYPES.map((t) => t.type);
}

export function iconsFromConvention(
  convention?: Pick<Convention, "types"> | null,
): Record<string, string> {
  const icons: Record<string, string> = { ...COMMIT_ICONS };
  for (const entry of convention?.types ?? []) {
    if (entry.icon) icons[entry.type.toLowerCase()] = entry.icon;
  }
  return icons;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function conventionPattern(types?: string[]): RegExp {
  const list = types?.length ? types : DEFAULT_CONVENTION_TYPES.map((t) => t.type);
  return new RegExp(`^(${list.map(escapeRegExp).join("|")})(\\([a-z0-9._/-]+\\))?!?: .+`, "i");
}

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

export function validMessage(
  message: string,
  typesOrConvention?: string[] | Pick<Convention, "types">,
): boolean {
  const types = Array.isArray(typesOrConvention)
    ? typesOrConvention
    : conventionTypes(typesOrConvention ?? null);
  const firstLine = message.split("\n")[0] || "";
  const withoutIcon = firstLine.replace(/^[^\w]*/, "");
  return conventionPattern(types).test(withoutIcon);
}

export function withCommitIcon(
  message: string,
  enabled: boolean,
  iconsOrConvention?: Record<string, string> | Pick<Convention, "types">,
): string {
  const icons =
    !iconsOrConvention || Array.isArray(iconsOrConvention)
      ? { ...COMMIT_ICONS }
      : iconsFromConvention(iconsOrConvention as Pick<Convention, "types">);
  const merged = { ...COMMIT_ICONS, ...icons };
  const names = Object.keys(merged).map(escapeRegExp).join("|");
  if (!enabled || new RegExp(`^\\S+\\s+(?:${names})`, "i").test(message)) return message;
  const type = message.match(new RegExp(`^(${names})`, "i"))?.[1]?.toLowerCase();
  return type && merged[type] ? `${merged[type]} ${message}` : message;
}
