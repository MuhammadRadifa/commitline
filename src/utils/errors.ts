import { z } from "zod";
import { CliError } from "../types";
import { CompatibleResponseSchema } from "../providers/schemas";

export function fail(message: string): never {
  throw new CliError(message);
}

function messageDescription(message: unknown): string {
  if (typeof message === "string") return "text message was empty";
  const data = z.object({}).passthrough().safeParse(message);
  if (!data.success) return "message is not an object";
  const keys = Object.keys(data.data).slice(0, 8);
  return `message fields: ${keys.join(", ") || "empty message"}`;
}

export function responseDescription(payload: unknown): string {
  const data = z
    .object({
      error: z.object({ message: z.string().optional() }).optional(),
    })
    .passthrough()
    .safeParse(payload);
  if (!data.success) return "invalid JSON response";
  if (data.data.error?.message) return data.data.error.message;
  const compatible = CompatibleResponseSchema.safeParse(payload);
  if (compatible.success) {
    const choice = compatible.data.choices[0];
    return choice
      ? `response choice has no usable text content (${messageDescription(choice.message)})`
      : "response contained no choices";
  }
  const keys = Object.keys(data.data)
    .filter((key) => key !== "error")
    .slice(0, 8);
  return keys.length
    ? `unsupported response format (received: ${keys.join(", ")})`
    : "empty response";
}
