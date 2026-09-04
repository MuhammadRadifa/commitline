import * as p from "@clack/prompts";
import { truncateDiff, validMessage, withCommitIcon } from "../commit";
import { configure, loadConfig } from "../config";
import { commit, getChangedFiles, stageFiles, stagedDiff } from "../git";
import { buildRequest, buildRetryRequest } from "../providers/request";
import { extractOllamaText, extractText, readCompatibleStream } from "../providers/response";
import { CliError, type Options } from "../types";
import { pc, requirePrompt } from "../ui";
import { fail, responseDescription } from "../utils/errors";
import { commitMessageFromResponse } from "../utils/parser";
import { buildSystemPrompt, buildUserPrompt } from "../utils/prompt";

function commitMessage(message: string): void {
  const hash = commit(message);
  p.log.success(`Committed ${hash}: ${message.split("\n")[0]}`);
}

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

function extractPayload(provider: string, isOllama: boolean, payload: unknown): string {
  if (isOllama) return extractOllamaText(payload);
  return extractText(payload, provider as Parameters<typeof extractText>[1]);
}

async function generate(
  config: Awaited<ReturnType<typeof loadConfig>> & {},
  diff: string,
  files: string[],
  options: Options,
  spinner: { message: (text: string) => void },
  hint?: string,
): Promise<{ message: string; fallback: boolean }> {
  const system = buildSystemPrompt(config.provider, options);
  const user = buildUserPrompt(files, diff, hint);
  const req = buildRequest(config, system, user, options);

  let response = await sendRequest(req.url, req.headers, req.body);
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
        onText: () => spinner.message("Writing commit message"),
      })
    : undefined;
  const rawMessage = streamResult
    ? streamResult.message || streamResult.thinking
    : extractPayload(config.provider, req.isOllama, payload);

  const message = commitMessageFromResponse(rawMessage);
  if (message) return { message, fallback: false };

  if (rawMessage.length > 100) {
    const retry = buildRetryRequest(config, diff, options);
    try {
      const retryResponse = await sendRequest(retry.url, retry.headers, retry.body);
      if (retryResponse.ok) {
        const retryPayload = await retryResponse.json().catch(() => ({}));
        const retryRaw = extractPayload(config.provider, retry.isOllama, retryPayload);
        const retryMessage = commitMessageFromResponse(retryRaw);
        if (retryMessage) return { message: retryMessage, fallback: false };
      }
    } catch {}
  }

  return {
    message: `chore: update ${files.length === 1 ? files[0] : `${files.length} staged files`}`,
    fallback: true,
  };
}

export async function run(options: Options): Promise<void> {
  let config = await loadConfig();
  if (!config) {
    p.log.info("No configuration found. Starting setup.");
    await configure();
    config = await loadConfig();
    if (!config) fail("Configuration was not saved.");
  }
  let staged: ReturnType<typeof stagedDiff>;
  try {
    staged = stagedDiff(config);
  } catch (error) {
    if (!(error instanceof CliError) || !error.message.includes("No staged changes")) throw error;
    const changed = getChangedFiles();
    if (!changed.length) {
      p.log.error("No changes detected in the working tree.");
      return;
    }
    const action = requirePrompt(
      await p.select({
        message: "No staged changes. What would you like to do?",
        options: [
          { value: "all", label: "Stage all", hint: `git add . (${changed.length} files)` },
          { value: "select", label: "Select files", hint: "Pick specific files to stage" },
          { value: "cancel", label: "Cancel", hint: "Exit without staging" },
        ],
        initialValue: "all",
      }),
    );
    if (action === "cancel") return;
    if (action === "all") {
      stageFiles(["."]);
    } else {
      const selected = requirePrompt(
        await p.multiselect({
          message: "Select files to stage",
          options: changed.map((f) => ({ value: f, label: f })),
          required: true,
        }),
      );
      stageFiles(selected);
    }
    staged = stagedDiff(config);
  }
  if (options.breaking) {
    options.breakingDescription = requirePrompt(
      await p.text({
        message: "Describe the breaking change",
        validate: (value) =>
          (value ?? "").trim() ? undefined : "A breaking-change description is required.",
      }),
    );
  }
  const diff = truncateDiff(staged.diff);
  p.log.info(
    `${staged.files.length} staged file(s)${staged.omitted ? `, ${staged.omitted} ignored` : ""}${diff.truncated ? "; large diff truncated" : ""}`,
  );
  if (diff.truncated) p.log.warn("The diff was truncated before generation.");

  let hint = options.regenHint;
  while (true) {
    const spinner = p.spinner();
    spinner.start("Preparing staged changes");
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
    let result: { message: string; fallback: boolean };
    try {
      spinner.message(`Sending request to ${config.provider}`);
      result = await generate(config, diff.content, staged.files, options, phaseSpinner, hint);
      clearInterval(waitStatus);
      spinner.stop("Commit message generated");
    } catch (error) {
      clearInterval(waitStatus);
      spinner.stop("Generation failed");
      throw error;
    }
    const message = withCommitIcon(result.message, config.useIcons);
    p.note(
      pc.green(message),
      result.fallback ? "Fallback commit message" : "Generated commit message",
    );
    if (result.fallback)
      p.log.warn("The provider returned no commit subject. Edit this fallback or regenerate it.");
    if (!validMessage(message))
      p.log.warn("Generated subject does not match the expected Conventional Commit format.");
    if (options.dryRun) return;
    if (options.yes) return commitMessage(message);
    const action = requirePrompt(
      await p.select({
        message: "What would you like to do?",
        options: [
          { value: "accept", label: "Accept and commit", hint: "Create the commit" },
          { value: "edit", label: "Edit message", hint: "Change before committing" },
          { value: "regenerate", label: "Regenerate", hint: "Ask for another message" },
          { value: "cancel", label: "Cancel", hint: "Exit without committing" },
        ],
        initialValue: "accept",
      }),
    );
    if (action === "accept") return commitMessage(message);
    if (action === "cancel") return;
    if (action === "edit") {
      const edited = requirePrompt(
        await p.text({
          message: "Commit message",
          initialValue: message,
          validate: (value) =>
            (value ?? "").trim() ? undefined : "Commit message cannot be empty.",
        }),
      );
      return commitMessage(edited);
    }
    if (action === "regenerate") {
      hint = requirePrompt(
        await p.text({
          message: "Optional regeneration guidance",
          placeholder: "Leave blank for no additional guidance",
        }),
      );
      continue;
    }
  }
}
