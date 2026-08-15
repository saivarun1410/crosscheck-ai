import { authorPrompt, reviewerPrompt } from "../prompts.js";
import { runProcess } from "../process.js";
import { parseReviewOutput } from "../findings.js";
import { reviewSchemaJson } from "../schema.js";
import type {
  AgentAdapter,
  AgentResult,
  AuthorRequest,
  ReviewReport,
  ReviewRequest,
} from "../types.js";
import { CliAdapterBase } from "./base.js";

function resultSummary(stdout: string): AgentResult {
  try {
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    if (typeof parsed.result === "string" && parsed.result.trim()) {
      return { summary: parsed.result.trim(), raw: parsed };
    }
    return { summary: "Claude completed the author turn.", raw: parsed };
  } catch {
    return { summary: stdout.trim() || "Claude completed the author turn." };
  }
}

export class ClaudeCliAdapter extends CliAdapterBase implements AgentAdapter {
  readonly name = "claude";

  async author(request: AuthorRequest): Promise<AgentResult> {
    const result = await runProcess({
      command: this.config.command,
      args: [
        "--print",
        "--output-format",
        "json",
        "--permission-mode",
        "acceptEdits",
        "--max-turns",
        String(this.config.maxTurns),
        "--no-session-persistence",
        ...this.modelArgs(),
        ...this.config.extraArgs,
      ],
      cwd: request.cwd,
      input: authorPrompt(request),
      timeoutMs: this.config.timeoutMs,
    });
    this.assertSuccess(result.exitCode, result.stderr);
    return resultSummary(result.stdout);
  }

  async review(request: ReviewRequest): Promise<ReviewReport> {
    const result = await runProcess({
      command: this.config.command,
      args: [
        "--print",
        "--output-format",
        "json",
        "--permission-mode",
        "plan",
        "--max-turns",
        String(this.config.maxTurns),
        "--no-session-persistence",
        "--json-schema",
        reviewSchemaJson(),
        ...this.modelArgs(),
        ...this.config.extraArgs,
      ],
      cwd: request.cwd,
      input: reviewerPrompt(request, request.diffTruncated),
      timeoutMs: this.config.timeoutMs,
    });
    this.assertSuccess(result.exitCode, result.stderr);
    return parseReviewOutput(result.stdout);
  }
}
