import { describe, expect, it } from "bun:test";
import { commitMessageFromResponse, isPlaceholderCommit } from "../utils/parser";

describe("commitMessageFromResponse", () => {
  it("extracts JSON message_commits", () => {
    expect(commitMessageFromResponse('{"message_commits":"feat: add login"}')).toBe(
      "feat: add login",
    );
  });

  it("extracts JSON message key", () => {
    expect(commitMessageFromResponse('{"message":"fix: resolve crash"}')).toBe(
      "fix: resolve crash",
    );
  });

  it("extracts embedded JSON from text", () => {
    const input = 'Here is the result: {"message_commits":"chore: update deps"} done.';
    expect(commitMessageFromResponse(input)).toBe("chore: update deps");
  });

  it("extracts conventional commit from plain text", () => {
    expect(commitMessageFromResponse("feat: add user authentication")).toBe(
      "feat: add user authentication",
    );
  });

  it("strips inline reasoning after subject", () => {
    const input = "refactor!: rename binary\". However, the user didn't specify if it's breaking.";
    expect(commitMessageFromResponse(input)).toBe("refactor!: rename binary.");
  });

  it("strips reasoning lines and finds commit", () => {
    const input = "We are given a diff.\nThe changes include:\nfeat: add new endpoint";
    expect(commitMessageFromResponse(input)).toBe("feat: add new endpoint");
  });

  it("returns empty for pure reasoning", () => {
    const input =
      "We are given a staged diff with changes in three files. I need to analyze the changes.";
    expect(commitMessageFromResponse(input)).toBe("");
  });

  it("returns empty for empty input", () => {
    expect(commitMessageFromResponse("")).toBe("");
  });

  it("returns empty for placeholder", () => {
    expect(commitMessageFromResponse("type: description")).toBe("");
  });
});

describe("isPlaceholderCommit", () => {
  it("catches type: description", () => {
    expect(isPlaceholderCommit("type: description")).toBe(true);
  });

  it("catches feat: concise description", () => {
    expect(isPlaceholderCommit("feat: concise description")).toBe(true);
  });

  it("catches the message", () => {
    expect(isPlaceholderCommit("the message")).toBe(true);
  });

  it("catches very short strings", () => {
    expect(isPlaceholderCommit("ab")).toBe(true);
  });

  it("allows valid messages", () => {
    expect(isPlaceholderCommit("feat: add login endpoint")).toBe(false);
  });
});
