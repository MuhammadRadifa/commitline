# commitline

Generate **Conventional Commit** messages from staged changes using your own AI provider key. Works with OpenAI, Anthropic, Google Gemini, and any OpenAI-compatible API (Ollama, LM Studio, etc.).

```
$ git add .
$ commitline
✔ Commit message generated
✨ feat: add user authentication flow
```

commitline never commits without review unless you pass `--yes`. Your API key stays local and is sent only to your chosen provider.

---

## Install

```bash
# Via npm (recommended)
npm install -g commitline

# Via Bun
bun install -g commitline

# Or run directly without installing
npx commitline
```

**Requirements:** [Bun](https://bun.sh) 1.0+ and [Git](https://git-scm.com).

---

## Quick start

```bash
git add .
commitline
```

On first run, commitline starts an interactive setup wizard:

1. Choose your provider (OpenAI, Anthropic, Gemini, or compatible API)
2. Enter your API key
3. Pick a model from the fetched list or enter one manually
4. Optionally enable commit icons (`✨ feat:`, `🐛 fix:`, etc.)

Configuration is saved to `~/.config/commitline/config.json` with owner-only permissions.

> **Tip:** Run `commitline config` anytime to change provider, key, model, or icons.

---

## Usage

### Basic

```bash
commitline                      # Generate and review before committing
commitline --yes                # Generate and commit immediately
commitline --dry-run            # Print the message without committing
```

### Options

| Flag                  | Description                                                             |
| --------------------- | ----------------------------------------------------------------------- |
| `--dry-run`           | Print the generated message without committing                          |
| `-y, --yes`           | Commit immediately after generation                                     |
| `--body`              | Request a commit body for larger changes                                |
| `--breaking`          | Include a breaking change description                                   |
| `--regen-hint <text>` | Add one-shot guidance (e.g. `--regen-hint "focus on the API behavior"`) |

### Interactive review

After generating a message, commitline shows it and asks what to do:

- **Accept and commit** — create the commit
- **Edit message** — modify it before committing
- **Regenerate** — ask for another message (optionally with guidance)
- **Cancel** — exit without committing

### No staged changes? No problem.

If there are unstaged changes, commitline offers to stage all, select specific files, or cancel.

---

## Configuration

```bash
commitline config               # Create or replace configuration
```

When a configuration already exists, you can pick which fields to change instead of re-entering everything.

### Supported providers

| Provider      | Default model             | Notes                                              |
| ------------- | ------------------------- | -------------------------------------------------- |
| OpenAI        | `gpt-4o-mini`             | GPT models via api.openai.com                      |
| Anthropic     | `claude-3-5-haiku-latest` | Claude models via api.anthropic.com                |
| Google Gemini | `gemini-2.0-flash`        | Gemini models via Google AI Studio                 |
| Compatible    | —                         | Ollama, LM Studio, or any OpenAI-compatible server |

### Config file

`~/.config/commitline/config.json`:

```json
{
  "provider": "openai",
  "apiKey": "sk-...",
  "model": "gpt-4o-mini",
  "useIcons": true
}
```

For compatible providers, add a `"baseUrl"` field (e.g. `"http://localhost:11434/v1"`).

---

## Features

- **Model discovery** — fetches available models from your provider so you can pick one from a list
- **Streaming** — OpenAI-compatible endpoints stream tokens live; shows "Thinking…" during reasoning and "Writing commit message" as answer text arrives
- **Graceful retry** — if the provider rejects streaming, `reasoning_effort`, or the JSON mime type, commitline retries automatically without those fields
- **Ollama auto-detection** — a compatible URL on port `11434` uses Ollama's native `/api/chat` endpoint
- **Diff truncation** — diffs over 30,000 characters are truncated with a visible warning
- **Lock & binary filtering** — lock files (`bun.lock`, `package-lock.json`, etc.) and binary files are skipped automatically
- **Commit icons** — optional Gitmoji-style icons (`✨ feat:`, `🐛 fix:`, `📝 docs:`, `🔧 chore:`, etc.)
- **Conventional Commit validation** — generated subjects are checked against standard types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`
- **No client timeout** — shows elapsed seconds while waiting; cancel a stalled request with `Ctrl+C`

---

## How it works

1. Reads staged files via `git diff --cached` (skipping lock files and binaries)
2. Builds a prompt and sends the diff (up to 30k chars) to your chosen AI provider
3. Parses the response into a Conventional Commit message
4. If the response has no valid subject, retries once with a stricter prompt
5. Falls back to `chore: update <N> staged files` if the provider returns nothing useful
6. Presents the message for review — or commits immediately with `--yes`

---

## Build a standalone binary

```bash
bun run build
```

Outputs a static binary at `./commitline`.

---

## Project structure

```text
src/
  index.ts              Entry point
  cli.ts                CLI command wiring (Commander.js)
  config.ts             Configuration storage, setup wizard, model discovery
  types.ts              Shared schemas and types (Zod)
  ui.ts                 Terminal prompt helpers (Clack, picocolors)
  git.ts                Git operations (diff, stage, commit)
  commit.ts             Commit validation, icon formatting, diff truncation
  commands/
    generate.ts         Main generation workflow
  providers/
    request.ts          API request builders
    response.ts         Response parsers (OpenAI, Anthropic, Gemini, Ollama)
  utils/
    errors.ts           Error formatting
    parser.ts           Commit message extraction from responses
    prompt.ts           System and user prompt builders
```

---

## Development

```bash
git clone https://github.com/MuhammadRadifa/commitline.git
cd commitline
bun install

bun run start          # Run the CLI
bun run build          # Build standalone binary
bun test               # Run tests
bun run check          # Lint, format, and type-check
```

---

## License

MIT
