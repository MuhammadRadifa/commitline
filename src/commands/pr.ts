import * as p from "@clack/prompts";
import { truncateDiff, validMessage, withCommitIcon } from "../commit";
import { configure, loadConfig } from "../config";
import { getBranchHistory } from "../git";
import { buildRequest } from "../providers/request";
import { extractOllamaText, extractText, readCompatibleStream } from "../providers/response";
import type { Config } from "../types";
import { pc, requirePrompt } from "../ui";
import { fail, responseDescription } from "../utils/errors";
import { commitMessageFromResponse, prSuggestionFromResponse } from "../utils/parser";
import { buildPrSystemPrompt, buildPrUserPrompt } from "../utils/prompt";

export type PrOptions = {
  base?: string;
  dryRun: boolean;
  json: boolean;
  yes: boolean;
  regenHint?: string;
};

type Suggestion = { title: string; body: string };

const UNACCEPTED_FIELDS = ["stream", "reasoning_effort", "response_mime_type"];

function withoutUnacceptedFields(body: Record<string, unknown>): Record<string, unknown> {
  const clone = { ...body };
  for (const field of UNACCEPTED_FIELDS) delete clone[field];
  if (clone.generationConfig && typeof clone.generationConfig === "object") {
    const generationConfig = { ...(clone.generationConfig as Record<string, unknown>) };
    delete generationConfig.response_mime_type;
    clone.generationConfig = generationConfig;
  }
  if (clone.options && typeof clone.options === "object") {
    clone.options = { ...(clone.options as Record<string, unknown>) };
  }
  return clone;
}

async function sendRequest(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
): Promise<Response> {
  const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  if (response.status === 400) {
    return fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(withoutUnacceptedFields(body)),
    });
  }
  return response;
}

function humanizeBranch(branch: string): string {
  return branch.split("/").pop()?.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim() || branch;
}

async function generateSuggestion(
  config: Config,
  history: ReturnType<typeof getBranchHistory>,
  diff: string,
  spinner: { message: (text: string) => void },
  hint?: string,
): Promise<{ suggestion: Suggestion; fallback: boolean }> {
  const system = buildPrSystemPrompt(
    config.provider,
    config.convention,
    history.current,
    history.base,
  );
  const user = buildPrUserPrompt(history.commits, history.files, history.stat, diff, hint);
  const req = buildRequest(config, system, user, {
    dryRun: false,
    yes: false,
    body: false,
    breaking: false,
  });

  const response = await sendRequest(req.url, req.headers, req.body);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    fail(`${config.provider} request failed (${response.status}): ${responseDescription(payload)}`);
  }

  const isStream =
    req.body.stream === true && response.headers.get("content-type")?.includes("text/event-stream");
  const payload = isStream ? undefined : await response.json().catch(() => ({}));
  const streamResult = isStream
    ? await readCompatibleStream(response, {
        onThinking: (thinking) => {
          const snippet = thinking.replace(/\s+/g, " ").trim().slice(-60);
          spinner.message(`Thinking ${pc.dim(`· ${snippet}…`)}`);
        },
        onText: () => spinner.message("Writing PR suggestion"),
      })
    : undefined;
  const raw = streamResult
    ? streamResult.message || streamResult.thinking
    : req.isOllama
      ? extractOllamaText(payload)
      : extractText(payload, config.provider);

  const parsed = prSuggestionFromResponse(raw);
  if (parsed?.title) {
    const title = withCommitIcon(
      commitMessageFromResponse(
        parsed.title,
        config.convention?.enabled === false ? [] : config.convention,
      ) || parsed.title,
      config.useIcons,
      config.convention,
    );
    return { suggestion: { title, body: parsed.body }, fallback: false };
  }

  const firstSubject =
    history.commits[0]?.subject || humanizeBranch(history.current) || "update branch";
  const fallbackTitle =
    config.convention?.enabled === false
      ? firstSubject
      : commitMessageFromResponse(firstSubject, config.convention) || firstSubject;
  const fallbackBody = [
    "## Summary",
    "",
    `Changes from \`${history.base}\` to \`${history.current}\` (${history.commits.length} commit(s)).`,
    "",
    "## Changes",
    "",
    ...history.commits.map((c) => `- ${c.subject}`),
  ].join("\n");
  return {
    suggestion: {
      title: withCommitIcon(fallbackTitle, config.useIcons, config.convention),
      body: fallbackBody,
    },
    fallback: true,
  };
}

function printSuggestion(suggestion: Suggestion, asJson: boolean): void {
  if (asJson) {
    p.log.message(JSON.stringify({ title: suggestion.title, body: suggestion.body }, null, 2));
    return;
  }
  p.note(`${suggestion.title}\n\n${suggestion.body || "(no description)"}`, "Suggested PR");
}

export async function runPr(options: PrOptions): Promise<void> {
  let config = await loadConfig();
  if (!config) {
    p.log.info("No configuration found. Starting setup.");
    await configure();
    config = await loadConfig();
    if (!config) fail("Configuration was not saved.");
  }

  const history = getBranchHistory(options.base);
  const truncated = truncateDiff(history.diff);
  p.log.info(
    `${history.commits.length} commit(s) on "${history.current}" vs "${history.base}"${truncated.truncated ? "; large diff truncated" : ""}`,
  );
  if (truncated.truncated) p.log.warn("The branch diff was truncated before generation.");
  if (!history.diff.trim()) p.log.warn("No file diff found; suggesting from commit messages only.");

  let hint = options.regenHint;
  while (true) {
    const spinner = p.spinner();
    spinner.start("Preparing branch history");
    const startedAt = Date.now();
    let phaseStarted = false;
    const waitStatus = setInterval(() => {
      if (!phaseStarted)
        spinner.message(
          `Waiting for ${config.provider} response (${Math.floor((Date.now() - startedAt) / 1000)}s)`,
        );
    }, 1_000);
    const phaseSpinner = {
      message: (text: string) => {
        phaseStarted = true;
        spinner.message(text);
      },
    };
    let result: { suggestion: Suggestion; fallback: boolean };
    try {
      spinner.message(`Sending request to ${config.provider}`);
      result = await generateSuggestion(config, history, truncated.content, phaseSpinner, hint);
      clearInterval(waitStatus);
      spinner.stop("PR suggestion generated");
    } catch (error) {
      clearInterval(waitStatus);
      spinner.stop("Generation failed");
      throw error;
    }

    const { suggestion } = result;
    p.log.success(suggestion.title);
    if (result.fallback)
      p.log.warn(
        "The provider returned no usable suggestion. Edit this fallback or regenerate it.",
      );
    if (config.convention?.enabled !== false && !validMessage(suggestion.title, config.convention))
      p.log.warn("Suggested title does not match the expected Conventional Commit format.");

    if (options.dryRun || options.json || options.yes) {
      printSuggestion(suggestion, options.json);
      return;
    }

    printSuggestion(suggestion, false);
    const action = requirePrompt(
      await p.select({
        message: "What would you like to do?",
        options: [
          { value: "accept", label: "Accept", hint: "Use this title and description" },
          { value: "edit-title", label: "Edit title", hint: "Change the PR title" },
          { value: "edit-body", label: "Edit description", hint: "Change the PR body" },
          { value: "regenerate", label: "Regenerate", hint: "Ask for another suggestion" },
          { value: "cancel", label: "Cancel", hint: "Exit without using it" },
        ],
        initialValue: "accept",
      }),
    );
    if (action === "accept") return;
    if (action === "cancel") return;
    if (action === "edit-title") {
      const title = requirePrompt(
        await p.text({
          message: "PR title",
          initialValue: suggestion.title,
          validate: (value) => ((value ?? "").trim() ? undefined : "PR title cannot be empty."),
        }),
      );
      printSuggestion({ title, body: suggestion.body }, false);
      return;
    }
    if (action === "edit-body") {
      const body = requirePrompt(
        await p.text({
          message: "PR description (markdown)",
          initialValue: suggestion.body,
        }),
      );
      printSuggestion({ title: suggestion.title, body }, false);
      return;
    }
    hint = requirePrompt(
      await p.text({
        message: "Optional regeneration guidance",
        placeholder: "Leave blank for no additional guidance",
      }),
    );
  }
}
