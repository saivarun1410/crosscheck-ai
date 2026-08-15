import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createAdapter } from "./adapters/index.js";
import { loadConfig, writeStarterConfig } from "./config.js";
import { assertBaseRef, assertCleanWorkingTree, repositoryRoot } from "./git.js";
import { runCrosscheck } from "./orchestrator.js";
import type {
  AgentAdapterName,
  CrosscheckConfig,
  CrosscheckEvent,
  CrosscheckReport,
  DoctorCheck,
} from "./types.js";

interface CliOptions {
  command: string;
  cwd: string;
  configPath: string;
  json: boolean;
  dryRun: boolean;
  outputPath?: string;
  author?: AgentAdapterName;
  reviewer?: AgentAdapterName;
  baseRef?: string;
  task: string;
}

const USAGE = `crosscheck — independent author-reviewer loops for coding agents

Usage:
  crosscheck init [--config path] [--cwd path]
  crosscheck run [options] <task>
  crosscheck review [options] [review objective]
  crosscheck doctor [options]

Options:
  --author codex|claude    Override the configured author adapter
  --reviewer codex|claude  Override the configured reviewer adapter
  --base ref               Override workspace.baseRef
  --config path            Config path (default: crosscheck.yaml)
  --cwd path               Repository path (default: current directory)
  --output path            Write the final JSON report to a file
  --json                   Print only machine-readable JSON
  --dry-run                Validate and show the resolved workflow without agents
  --help                    Show this help
`;

function adapterName(value: string, flag: string): AgentAdapterName {
  if (value !== "codex" && value !== "claude") {
    throw new Error(`${flag} must be codex or claude`);
  }
  return value;
}

function parseArgs(argv: string[]): CliOptions {
  const command = argv[0] === "--help" || argv[0] === "-h" ? "help" : (argv[0] ?? "help");
  const positionals: string[] = [];
  let cwd = process.cwd();
  let configPath = "crosscheck.yaml";
  let json = false;
  let dryRun = false;
  let outputPath: string | undefined;
  let author: AgentAdapterName | undefined;
  let reviewer: AgentAdapterName | undefined;
  let baseRef: string | undefined;

  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") json = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--help" || arg === "-h") return { command: "help", cwd, configPath, json, dryRun, task: "" };
    else if (["--cwd", "--config", "--output", "--author", "--reviewer", "--base"].includes(arg ?? "")) {
      const value = argv[++index];
      if (!value) throw new Error(`${arg} requires a value`);
      if (arg === "--cwd") cwd = resolve(value);
      else if (arg === "--config") configPath = value;
      else if (arg === "--output") outputPath = value;
      else if (arg === "--author") author = adapterName(value, arg);
      else if (arg === "--reviewer") reviewer = adapterName(value, arg);
      else baseRef = value;
    } else if (arg?.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (arg !== undefined) {
      positionals.push(arg);
    }
  }

  const options: CliOptions = {
    command,
    cwd,
    configPath,
    json,
    dryRun,
    task: positionals.join(" ").trim(),
  };
  if (outputPath !== undefined) options.outputPath = outputPath;
  if (author !== undefined) options.author = author;
  if (reviewer !== undefined) options.reviewer = reviewer;
  if (baseRef !== undefined) options.baseRef = baseRef;
  return options;
}

function overrideConfig(config: CrosscheckConfig, options: CliOptions): CrosscheckConfig {
  const copy = structuredClone(config);
  if (options.author) {
    const changed = copy.agents.author.adapter !== options.author;
    copy.agents.author.adapter = options.author;
    if (changed) copy.agents.author.command = options.author;
  }
  if (options.reviewer) {
    const changed = copy.agents.reviewer.adapter !== options.reviewer;
    copy.agents.reviewer.adapter = options.reviewer;
    if (changed) copy.agents.reviewer.command = options.reviewer;
  }
  if (options.baseRef) copy.workspace.baseRef = options.baseRef;
  return copy;
}

function eventLogger(event: CrosscheckEvent): void {
  switch (event.type) {
    case "author_started":
      process.stderr.write(`Round ${event.round}: ${event.agent} author started\n`);
      break;
    case "author_finished":
      process.stderr.write(`Round ${event.round}: author finished\n`);
      break;
    case "verification_started":
      process.stderr.write(`Round ${event.round}: verifying \`${event.command}\`\n`);
      break;
    case "verification_finished":
      process.stderr.write(
        `Round ${event.round}: ${event.result.exitCode === 0 ? "PASS" : "FAIL"} \`${event.result.command}\`\n`,
      );
      break;
    case "review_started":
      process.stderr.write(`Round ${event.round}: ${event.agent} reviewer started\n`);
      break;
    case "review_finished":
      process.stderr.write(
        `Round ${event.round}: reviewer returned ${event.report.verdict} with ${event.report.findings.length} finding(s)\n`,
      );
      break;
    case "finished":
      break;
  }
}

function formatReport(report: CrosscheckReport): string {
  const lines = [
    `Crosscheck: ${report.status}`,
    report.message,
    `Changed files: ${report.changedFiles.length}`,
  ];
  for (const round of report.rounds) {
    lines.push("", `Round ${round.round}: ${round.review.verdict} — ${round.review.summary}`);
    for (const finding of round.review.findings) {
      lines.push(
        `  [${finding.severity.toUpperCase()} ${(finding.confidence * 100).toFixed(0)}%] ${finding.file}${finding.line ? `:${finding.line}` : ""} ${finding.title}`,
      );
    }
    for (const check of round.verification) {
      lines.push(`  [${check.exitCode === 0 ? "PASS" : "FAIL"}] ${check.command}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

async function runDoctor(options: CliOptions, config: CrosscheckConfig): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  let root = options.cwd;
  try {
    root = await repositoryRoot(options.cwd);
    checks.push({ name: "Git repository", ok: true, detail: root });
    await assertBaseRef(root, config.workspace.baseRef);
    checks.push({ name: "Base ref", ok: true, detail: config.workspace.baseRef });
  } catch (error) {
    checks.push({
      name: "Git repository",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  const [author, reviewer] = await Promise.all([
    createAdapter(config.agents.author).doctor(root),
    createAdapter(config.agents.reviewer).doctor(root),
  ]);
  checks.push(author, reviewer);
  return checks;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === "help") {
    process.stdout.write(USAGE);
    return;
  }
  if (options.command === "init") {
    const path = await writeStarterConfig(options.cwd, options.configPath);
    process.stdout.write(`${path}\n`);
    return;
  }
  if (!["run", "review", "doctor"].includes(options.command)) {
    throw new Error(`Unknown command: ${options.command}\n\n${USAGE}`);
  }

  const config = overrideConfig(await loadConfig(options.cwd, options.configPath), options);
  if (options.command === "doctor") {
    const checks = await runDoctor(options, config);
    if (options.json) process.stdout.write(`${JSON.stringify({ checks }, null, 2)}\n`);
    else {
      for (const check of checks) {
        process.stdout.write(`${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}\n`);
      }
    }
    if (checks.some((check) => !check.ok)) process.exitCode = 1;
    return;
  }

  const task = options.task || "Review the current changes for correctness and regressions.";
  if (options.command === "run" && options.task === "") {
    throw new Error("crosscheck run requires a task");
  }
  if (options.dryRun) {
    const root = await repositoryRoot(options.cwd);
    await assertBaseRef(root, config.workspace.baseRef);
    if (options.command === "run" && config.workspace.requireClean) await assertCleanWorkingTree(root);
    process.stdout.write(
      `${JSON.stringify({ command: options.command, task, cwd: root, config }, null, 2)}\n`,
    );
    return;
  }

  const runOptions = {
    task,
    cwd: options.cwd,
    config,
    author: createAdapter(config.agents.author),
    reviewer: createAdapter(config.agents.reviewer),
    reviewOnly: options.command === "review",
  };
  const report = await runCrosscheck(
    options.json ? runOptions : { ...runOptions, onEvent: eventLogger },
  );
  if (options.outputPath) {
    await writeFile(resolve(options.cwd, options.outputPath), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report));
  if (report.status === "changes_requested") process.exitCode = 1;
  else if (report.status === "verification_failed") process.exitCode = 2;
}

main().catch((error: unknown) => {
  process.stderr.write(`crosscheck: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
