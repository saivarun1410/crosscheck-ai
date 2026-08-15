# crosscheck-ai

Run one coding agent as the author and a different agent as the independent reviewer, with deterministic checks and bounded correction rounds between them.

```text
task → author edits → tests → reviewer reads diff → author corrects → tests → decision
```

Crosscheck is deliberately code-controlled. Agents do not choose the workflow, approve their own work, or continue debating forever.

## Status

This is an early MVP. It supports local Git repositories and installed Codex and Claude Code CLIs. It does not yet create isolated Git worktrees or call hosted provider SDKs directly.

## Prerequisites

- Node.js 20 or newer
- Git
- At least one author CLI and one reviewer CLI, already installed and authenticated
  - [Codex CLI](https://learn.chatgpt.com/docs/developer-commands?surface=cli)
  - [Claude Code](https://code.claude.com/docs/en/cli-usage)

## Install and initialize

From this repository during development:

```bash
npm install
npm run build
npm link
crosscheck init
```

After the package is published:

```bash
npm install -D crosscheck-ai
npx crosscheck init
```

Edit `crosscheck.yaml` to add your repository's test, lint, type-check, or security commands:

```yaml
version: 1

agents:
  author:
    adapter: codex
    command: codex
    maxTurns: 20
    timeoutMs: 900000
  reviewer:
    adapter: claude
    command: claude
    maxTurns: 8
    timeoutMs: 600000

workspace:
  baseRef: HEAD
  requireClean: true
  includeUntracked: true

verification:
  commands:
    - npm test
    - npm run lint
  timeoutMs: 120000

policy:
  maxReviewRounds: 2
  failOn: high
  minimumConfidence: 0.65
  maxDiffBytes: 1000000
```

## Run it

Ask Codex to implement and Claude to review:

```bash
npx crosscheck run "Add password-reset support with regression tests"
```

Reverse the roles without editing configuration:

```bash
npx crosscheck run --author claude --reviewer codex \
  "Add password-reset support with regression tests"
```

Review an existing working-tree diff without allowing an agent to edit it:

```bash
npx crosscheck review "Check this change for authentication regressions"
```

Validate the setup or preview the resolved workflow:

```bash
npx crosscheck doctor
npx crosscheck run --dry-run "Describe the task"
```

Use `--json` for CI output and `--output report.json` to retain the complete audit report.

## Review policy

A reviewer finding blocks only when all of the following are true:

- its severity meets `policy.failOn`;
- its confidence meets `policy.minimumConfidence`;
- it cites a file changed in the current diff; and
- the reviewer was able to return a valid structured report.

Configured verification commands are authoritative. A reviewer cannot approve a change while those commands fail. After `maxReviewRounds`, Crosscheck stops and returns the disagreement to the user.

Exit codes:

| Code | Meaning |
|---:|---|
| `0` | accepted, no changes, successful doctor, or dry run |
| `1` | blocking review findings, invalid setup, or runtime error |
| `2` | deterministic verification still fails |

## Permission model

- Codex authors run with `workspace-write`; Codex reviewers use `read-only`.
- Claude authors use `acceptEdits`; Claude reviewers use `plan` mode.
- Prompts prohibit commits, pushes, publishing, and changes outside the workspace.
- `run` requires a clean working tree by default so existing user changes are not mistaken for agent output.
- Reviewers receive the task, diff, and verification evidence—not the author's private reasoning.

These controls reduce risk but are not a complete security boundary. Run untrusted repositories in a disposable container or VM, keep credentials out of the repository, and review changes before committing them.

## Programmatic API

```ts
import { createAdapter, loadConfig, runCrosscheck } from "crosscheck-ai";

const cwd = process.cwd();
const config = await loadConfig(cwd);
const report = await runCrosscheck({
  task: "Add request idempotency",
  cwd,
  config,
  author: createAdapter(config.agents.author),
  reviewer: createAdapter(config.agents.reviewer),
});

if (report.status !== "accepted") process.exitCode = 1;
```

Custom adapters can implement the exported `AgentAdapter` interface, which keeps the orchestration independent of any provider.

## How the adapters work

The Codex adapter uses the officially documented non-interactive `codex exec` interface, its sandbox modes, and JSON output schemas. The Claude adapter uses print mode, permission modes, and validated JSON Schema output. See the [Codex developer command reference](https://learn.chatgpt.com/docs/developer-commands?surface=cli) and [Claude structured-output documentation](https://code.claude.com/docs/en/agent-sdk/structured-outputs).

## License

MIT
