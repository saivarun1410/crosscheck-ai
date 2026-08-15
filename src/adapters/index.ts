import type { AgentAdapter, AgentConfig } from "../types.js";
import { ClaudeCliAdapter } from "./claude.js";
import { CodexCliAdapter } from "./codex.js";

export function createAdapter(config: AgentConfig): AgentAdapter {
  switch (config.adapter) {
    case "codex":
      return new CodexCliAdapter(config);
    case "claude":
      return new ClaudeCliAdapter(config);
  }
}

export { AdapterError } from "./base.js";
export { ClaudeCliAdapter } from "./claude.js";
export { CodexCliAdapter } from "./codex.js";
