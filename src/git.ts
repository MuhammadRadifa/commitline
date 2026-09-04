import { spawnSync } from "node:child_process";
import { CliError, type Config } from "./types";

export type StagedDiff = { diff: string; files: string[]; omitted: number };

const LOCK_FILE_PATTERNS = [
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "Cargo.lock",
  "Gemfile.lock",
  "Pipfile.lock",
  "poetry.lock",
  "go.sum",
  "composer.lock",
  "mix.lock",
  "Podfile.lock",
];

const BINARY_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "ico",
  "svg",
  "webp",
  "avif",
  "woff",
  "woff2",
  "ttf",
  "eot",
  "otf",
  "pdf",
  "zip",
  "tar",
  "gz",
  "bz2",
  "7z",
  "rar",
  "exe",
  "dll",
  "so",
  "dylib",
  "o",
  "a",
  "mp3",
  "mp4",
  "avi",
  "mov",
  "webm",
  "wav",
  "pyc",
  "pyo",
  "class",
  "wasm",
]);

function isLockFile(file: string): boolean {
  const basename = file.split("/").pop() || file;
  return LOCK_FILE_PATTERNS.some((pattern) => basename === pattern || basename.endsWith(".lock"));
}

function isBinaryFile(file: string): boolean {
  const ext = file.split(".").pop()?.toLowerCase() || "";
  return BINARY_EXTENSIONS.has(ext);
}

function command(args: string[], input?: string) {
  const [cmd, ...rest] = args;
  const result = spawnSync(cmd!, rest, {
    input: input ?? undefined,
    stdio: ["pipe", "pipe", "pipe"],
    encoding: "utf-8",
  });
  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? "").trimEnd(),
    stderr: (result.stderr ?? "").trim(),
  };
}

export function stagedDiff(_config: Config): StagedDiff {
  if (!command(["git", "rev-parse", "--is-inside-work-tree"]).ok)
    throw new CliError("Not inside a Git working tree.");
  const files = command(["git", "diff", "--cached", "--name-only"]);
  if (!files.ok) throw new CliError(files.stderr || "Could not read staged files.");
  const allFiles = files.stdout.split("\n").filter(Boolean);
  const included = allFiles.filter((f) => !isLockFile(f) && !isBinaryFile(f));
  const omitted = allFiles.length - included.length;
  if (!included.length)
    throw new CliError(
      omitted
        ? "Only ignored/binary files are staged. Update the ignore list in your config."
        : "No staged changes. Run `git add` first.",
    );
  const diff = command([
    "git",
    "diff",
    "--cached",
    "--no-ext-diff",
    "--diff-algorithm=minimal",
    "-U0",
    "--",
    ...included,
  ]);
  if (!diff.ok) throw new CliError(diff.stderr || "Could not read staged diff.");
  return { diff: diff.stdout, files: included, omitted };
}

export function getChangedFiles(): string[] {
  const result = command(["git", "status", "--porcelain"]);
  if (!result.ok) throw new CliError(result.stderr || "Could not read git status.");
  return result.stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const path = line[2] === " " ? line.slice(3) : line[1] === " " ? line.slice(2) : line;
      const arrow = path.indexOf(" -> ");
      return arrow === -1 ? path : path.slice(arrow + 4);
    });
}

export function stageFiles(files: string[]): void {
  const result = command(["git", "add", "--", ...files]);
  if (!result.ok) throw new CliError(result.stderr || "Could not stage files.");
}

export function commit(message: string): string {
  const result = command(["git", "commit", "-F", "-"], message);
  if (!result.ok) throw new CliError(result.stderr || "git commit failed.");
  return command(["git", "rev-parse", "--short", "HEAD"]).stdout;
}
