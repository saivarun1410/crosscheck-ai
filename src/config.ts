import { access, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import type {
  AgentAdapterName,
  AgentConfig,
  CrosscheckConfig,
  Severity,
} from "./types.js";

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"];
const ADAPTERS: AgentAdapterName[] = ["codex", "claude"];

export const DEFAULT_CONFIG: CrosscheckConfig = {
  version: 1,
  agents: {
    author: {
      adapter: "codex",
      command: "codex",
      maxTurns: 20,
      timeoutMs: 900_000,
      extraArgs: [],
    },
    reviewer: {
      adapter: "claude",
      command: "claude",
      maxTurns: 8,
      timeoutMs: 600_000,
      extraArgs: [],
    },
  },
  workspace: {
    baseRef: "HEAD",
    requireClean: true,
    includeUntracked: true,
  },
  verification: {
    commands: [],
    timeoutMs: 120_000,
  },
  policy: {
    maxReviewRounds: 2,
    failOn: "high",
    minimumConfidence: 0.65,
    maxDiffBytes: 1_000_000,
  },
};

export const STARTER_CONFIG = `version: 1

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
  commands: []
  # Examples:
  #   - npm test
  #   - npm run lint
  timeoutMs: 120000

policy:
  maxReviewRounds: 2
  failOn: high
  minimumConfidence: 0.65
  maxDiffBytes: 1000000
`;

export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ConfigError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, fallback: string, path: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.trim() === "") {
    throw new ConfigError(`${path} must be a non-empty string`);
  }
  return value;
}

function booleanValue(value: unknown, fallback: boolean, path: string): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new ConfigError(`${path} must be boolean`);
  return value;
}

function numberValue(
  value: unknown,
  fallback: number,
  path: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ConfigError(`${path} must be a number`);
  }
  if (value < minimum || value > maximum) {
    throw new ConfigError(`${path} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function stringArray(value: unknown, fallback: string[], path: string): string[] {
  if (value === undefined) return [...fallback];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ConfigError(`${path} must be an array of strings`);
  }
  return [...value] as string[];
}

function agentConfig(value: unknown, fallback: AgentConfig, path: string): AgentConfig {
  const raw = value === undefined ? {} : record(value, path);
  const adapter = stringValue(raw.adapter, fallback.adapter, `${path}.adapter`);
  if (!ADAPTERS.includes(adapter as AgentAdapterName)) {
    throw new ConfigError(`${path}.adapter must be one of: ${ADAPTERS.join(", ")}`);
  }
  const result: AgentConfig = {
    adapter: adapter as AgentAdapterName,
    command: stringValue(raw.command, fallback.command, `${path}.command`),
    maxTurns: numberValue(raw.maxTurns, fallback.maxTurns, `${path}.maxTurns`, 1, 100),
    timeoutMs: numberValue(
      raw.timeoutMs,
      fallback.timeoutMs,
      `${path}.timeoutMs`,
      10_000,
      3_600_000,
    ),
    extraArgs: stringArray(raw.extraArgs, fallback.extraArgs, `${path}.extraArgs`),
  };
  if (raw.model !== undefined) {
    result.model = stringValue(raw.model, "", `${path}.model`);
  } else if (fallback.model !== undefined) {
    result.model = fallback.model;
  }
  return result;
}

export function parseConfig(source: string): CrosscheckConfig {
  let parsed: unknown;
  try {
    parsed = parse(source);
  } catch (error) {
    throw new ConfigError(`Invalid YAML: ${error instanceof Error ? error.message : String(error)}`);
  }
  const root = record(parsed, "config");
  if (root.version !== 1) throw new ConfigError("version must be 1");
  const agents = root.agents === undefined ? {} : record(root.agents, "agents");
  const workspace = root.workspace === undefined ? {} : record(root.workspace, "workspace");
  const verification =
    root.verification === undefined ? {} : record(root.verification, "verification");
  const policy = root.policy === undefined ? {} : record(root.policy, "policy");
  const failOn = stringValue(policy.failOn, DEFAULT_CONFIG.policy.failOn, "policy.failOn");
  if (!SEVERITIES.includes(failOn as Severity)) {
    throw new ConfigError(`policy.failOn must be one of: ${SEVERITIES.join(", ")}`);
  }

  return {
    version: 1,
    agents: {
      author: agentConfig(agents.author, DEFAULT_CONFIG.agents.author, "agents.author"),
      reviewer: agentConfig(agents.reviewer, DEFAULT_CONFIG.agents.reviewer, "agents.reviewer"),
    },
    workspace: {
      baseRef: stringValue(workspace.baseRef, DEFAULT_CONFIG.workspace.baseRef, "workspace.baseRef"),
      requireClean: booleanValue(
        workspace.requireClean,
        DEFAULT_CONFIG.workspace.requireClean,
        "workspace.requireClean",
      ),
      includeUntracked: booleanValue(
        workspace.includeUntracked,
        DEFAULT_CONFIG.workspace.includeUntracked,
        "workspace.includeUntracked",
      ),
    },
    verification: {
      commands: stringArray(
        verification.commands,
        DEFAULT_CONFIG.verification.commands,
        "verification.commands",
      ),
      timeoutMs: numberValue(
        verification.timeoutMs,
        DEFAULT_CONFIG.verification.timeoutMs,
        "verification.timeoutMs",
        1_000,
        3_600_000,
      ),
    },
    policy: {
      maxReviewRounds: numberValue(
        policy.maxReviewRounds,
        DEFAULT_CONFIG.policy.maxReviewRounds,
        "policy.maxReviewRounds",
        1,
        10,
      ),
      failOn: failOn as Severity,
      minimumConfidence: numberValue(
        policy.minimumConfidence,
        DEFAULT_CONFIG.policy.minimumConfidence,
        "policy.minimumConfidence",
        0,
        1,
      ),
      maxDiffBytes: numberValue(
        policy.maxDiffBytes,
        DEFAULT_CONFIG.policy.maxDiffBytes,
        "policy.maxDiffBytes",
        1_000,
        100_000_000,
      ),
    },
  };
}

export async function loadConfig(cwd: string, configPath = "crosscheck.yaml"): Promise<CrosscheckConfig> {
  const fullPath = resolve(cwd, configPath);
  try {
    return parseConfig(await readFile(fullPath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ConfigError(`Config not found: ${fullPath}. Run \`crosscheck init\` first.`);
    }
    throw error;
  }
}

export async function writeStarterConfig(cwd: string, configPath = "crosscheck.yaml"): Promise<string> {
  const fullPath = resolve(cwd, configPath);
  try {
    await access(fullPath, constants.F_OK);
    throw new ConfigError(`Refusing to overwrite existing config: ${fullPath}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await writeFile(fullPath, STARTER_CONFIG, { encoding: "utf8", flag: "wx" });
  return fullPath;
}
