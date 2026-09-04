import { describe, expect, it } from "bun:test";
import { CONVENTIONAL_COMMIT, validMessage, withCommitIcon } from "../commit";

describe("validMessage", () => {
  it("accepts feat subject", () => {
    expect(validMessage("feat: add commit message generator")).toBe(true);
  });

  it("accepts fix with scope", () => {
    expect(validMessage("fix(cli): handle missing config")).toBe(true);
  });

  it("accepts all conventional types", () => {
    const types = [
      "feat",
      "fix",
      "docs",
      "style",
      "refactor",
      "perf",
      "test",
      "build",
      "ci",
      "chore",
      "revert",
    ];
    for (const type of types) {
      expect(validMessage(`${type}: change something`)).toBe(true);
    }
  });

  it("rejects plain text", () => {
    expect(validMessage("updated some files")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(validMessage("")).toBe(false);
  });

  it("handles subject with icon prefix", () => {
    expect(validMessage("✨ feat: add feature")).toBe(true);
  });
});

describe("withCommitIcon", () => {
  it("adds icon for feat", () => {
    expect(withCommitIcon("feat: add feature", true)).toBe("✨ feat: add feature");
  });

  it("adds icon for fix", () => {
    expect(withCommitIcon("fix: resolve bug", true)).toBe("🐛 fix: resolve bug");
  });

  it("adds icon for chore", () => {
    expect(withCommitIcon("chore: update deps", true)).toBe("🔧 chore: update deps");
  });

  it("does not duplicate icon", () => {
    expect(withCommitIcon("✨ feat: add feature", true)).toBe("✨ feat: add feature");
  });

  it("returns message unchanged when disabled", () => {
    expect(withCommitIcon("feat: add feature", false)).toBe("feat: add feature");
  });

  it("returns unknown type unchanged", () => {
    expect(withCommitIcon("custom: something", true)).toBe("custom: something");
  });
});

describe("CONVENTIONAL_COMMIT", () => {
  it("matches standard subject", () => {
    expect(CONVENTIONAL_COMMIT.test("feat: add feature")).toBe(true);
  });

  it("matches subject with scope", () => {
    expect(CONVENTIONAL_COMMIT.test("fix(api): handle error")).toBe(true);
  });

  it("matches breaking change marker", () => {
    expect(CONVENTIONAL_COMMIT.test("feat!: breaking change")).toBe(true);
  });

  it("rejects non-conventional text", () => {
    expect(CONVENTIONAL_COMMIT.test("just a message")).toBe(false);
  });
});
