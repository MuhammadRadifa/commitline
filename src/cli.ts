#!/usr/bin/env bun

import { Command } from "commander";
import * as p from "@clack/prompts";
import { CliError } from "./types";
import { configure } from "./config";
import { run } from "./commands/generate";

export async function main(): Promise<void> {
  const program = new Command()
    .name("commitline")
    .description("Generate Conventional Commit messages from staged changes")
    .option("--dry-run", "Print the generated message without committing")
    .option("-y, --yes", "Commit immediately after generation")
    .option("--body", "Request a commit body")
    .option("--breaking", "Include a breaking change description")
    .option("--regen-hint <text>", "Add guidance for generation")
    .action(async (options) =>
      run({
        dryRun: Boolean(options.dryRun),
        yes: Boolean(options.yes),
        body: Boolean(options.body),
        breaking: Boolean(options.breaking),
        regenHint: options.regenHint,
      }),
    );

  program.command("config").description("Create or replace the configuration").action(configure);
  try {
    await program.parseAsync();
  } catch (error) {
    p.log.error(
      error instanceof CliError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Unexpected error",
    );
    process.exitCode = 1;
  }
}
