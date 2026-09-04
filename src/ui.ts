import * as p from "@clack/prompts";
import pc from "picocolors";

export { pc };

export function requirePrompt<T>(value: T | symbol): T {
  if (p.isCancel(value)) {
    p.cancel("Operation cancelled.");
    process.exit(0);
  }
  return value;
}
