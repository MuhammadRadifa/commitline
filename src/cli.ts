#!/usr/bin/env node

import { Command } from "commander";
import * as p from "@clack/prompts";
import { CliError } from "./types";
import { configure, manageConvention } from "./config";
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
  program
    .command("convention")
    .description("Manage commit convention rules and icons (enable/disable, edit, add custom)")
    .option("--enable", "Enable convention enforcement")
    .option("--disable", "Disable convention enforcement")
    .option("--icons", "Enable commit icons")
    .option("--no-icons", "Disable commit icons")
    .option("--list", "List current convention rules")
    .option("--reset", "Reset rules to defaults")
    .option("--add <rule...>", "Add custom type (type[:description[:icon]])")
    .action(async (options) =>
      manageConvention({
        enable: Boolean(options.enable),
        disable: Boolean(options.disable),
        icons: Boolean(options.icons),
        noIcons: Boolean(options.noIcons),
        list: Boolean(options.list),
        reset: Boolean(options.reset),
        add: options.add,
      }),
    );
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
