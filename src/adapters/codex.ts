import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

export class CodexCliAdapter extends CliAdapterBase implements AgentAdapter {
  readonly name = "codex";

  async author(request: AuthorRequest): Promise<AgentResult> {
    return await this.withTempFiles(async (outputPath) => {
      const result = await runProcess({
        command: this.config.command,
        args: [
          "exec",
          "--cd",
          request.cwd,
          "--sandbox",
          "workspace-write",
          "--config",
          'approval_policy="never"',
          "--ephemeral",
          "--color",
          "never",
          "--output-last-message",
          outputPath,
          ...this.modelArgs(),
          ...this.config.extraArgs,
          "-",
        ],
        cwd: request.cwd,
        input: authorPrompt(request),
        timeoutMs: this.config.timeoutMs,
      });
      this.assertSuccess(result.exitCode, result.stderr);
      const summary = (await readFile(outputPath, "utf8")).trim();
      return { summary: summary || "Codex completed the author turn." };
    });
  }

  async review(request: ReviewRequest): Promise<ReviewReport> {
    return await this.withTempFiles(async (outputPath, schemaPath) => {
      await writeFile(schemaPath, reviewSchemaJson(), "utf8");
      const result = await runProcess({
        command: this.config.command,
        args: [
          "exec",
          "--cd",
          request.cwd,
          "--sandbox",
          "read-only",
          "--config",
          'approval_policy="never"',
          "--ephemeral",
          "--color",
          "never",
          "--output-last-message",
          outputPath,
          "--output-schema",
          schemaPath,
          ...this.modelArgs(),
          ...this.config.extraArgs,
          "-",
        ],
        cwd: request.cwd,
        input: reviewerPrompt(request, request.diffTruncated),
        timeoutMs: this.config.timeoutMs,
      });
      this.assertSuccess(result.exitCode, result.stderr);
      return parseReviewOutput(await readFile(outputPath, "utf8"));
    });
  }

  private async withTempFiles<T>(
    operation: (outputPath: string, schemaPath: string) => Promise<T>,
  ): Promise<T> {
    const directory = await mkdtemp(join(tmpdir(), "crosscheck-codex-"));
    try {
      return await operation(join(directory, "output.json"), join(directory, "schema.json"));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
