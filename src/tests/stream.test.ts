import { describe, expect, it } from "bun:test";
import { readCompatibleStream } from "../providers/response";

function sseResponse(chunks: string[], delays: number[] = []): Response {
  const encoder = new TextEncoder();
  let i = 0;
  const stream = new ReadableStream({
    async pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      const delay = delays[i] ?? 0;
      if (delay) await new Promise((r) => setTimeout(r, delay));
      controller.enqueue(encoder.encode(chunks[i]));
      i++;
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream" } });
}

function deltaEvent(delta: unknown): string {
  return `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;
}

describe("readCompatibleStream", () => {
  it("separates reasoning deltas from content deltas", async () => {
    const response = sseResponse([
      deltaEvent({ reasoning_content: "Analyzing diff" }),
      deltaEvent({ content: "feat: " }),
      deltaEvent({ reasoning_content: " more" }),
      deltaEvent({ content: "add login" }),
    ]);
    const result = await readCompatibleStream(response);
    expect(result.message).toBe("feat: add login");
    expect(result.thinking).toBe("Analyzing diff more");
  });

  it("fires onThinking with accumulated reasoning and onText per chunk", async () => {
    const thinkingSnippets: string[] = [];
    const textSnippets: string[] = [];
    const response = sseResponse(
      [
        deltaEvent({ reasoning: "step one " }),
        deltaEvent({ reasoning_content: "step two" }),
        deltaEvent({ content: "feat: x" }),
      ],
      [0, 200, 200],
    );
    await readCompatibleStream(response, {
      onThinking: (thinking) => thinkingSnippets.push(thinking),
      onText: (snippet) => textSnippets.push(snippet),
    });
    expect(thinkingSnippets.length).toBe(2);
    expect(thinkingSnippets.at(-1)).toBe("step one step two");
    expect(textSnippets).toEqual(["feat: x"]);
  });

  it("supports OpenAI-style plain string deltas", async () => {
    const response = sseResponse([deltaEvent("feat: "), deltaEvent("add login")]);
    const result = await readCompatibleStream(response);
    expect(result.message).toBe("feat: add login");
    expect(result.thinking).toBe("");
  });

  it("does not leak reasoning into the message", async () => {
    const response = sseResponse([
      deltaEvent({ reasoning_content: "Let me check the diff carefully. " }),
      deltaEvent({ reasoning_content: "Files changed: two." }),
    ]);
    const result = await readCompatibleStream(response);
    expect(result.message).toBe("");
    expect(result.thinking).toContain("diff");
  });

  it("ignores [DONE] and malformed lines", async () => {
    const response = sseResponse([
      "data: not-json\n\n",
      "data: [DONE]\n\n",
      deltaEvent({ content: "feat: ok" }),
      ": comment line\n\n",
    ]);
    const result = await readCompatibleStream(response);
    expect(result.message).toBe("feat: ok");
  });

  it("falls back to choice.message when delta is empty", async () => {
    const response = sseResponse([
      `data: ${JSON.stringify({ choices: [{ message: { content: "feat: whole" } }] })}\n\n`,
    ]);
    const result = await readCompatibleStream(response);
    expect(result.message).toBe("feat: whole");
  });

  it("throws on empty body", async () => {
    const response = sseResponse([]);
    const broken = new Response(null, { status: 200 });
    await expect(readCompatibleStream(broken)).rejects.toThrow("empty streaming response");
    await readCompatibleStream(response);
  });
});
