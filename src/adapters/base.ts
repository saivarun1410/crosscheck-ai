import type { AgentConfig, DoctorCheck } from "../types.js";
import { runProcess } from "../process.js";

export class AdapterError extends Error {
  override readonly name = "AdapterError";
}

export abstract class CliAdapterBase {
  constructor(protected readonly config: AgentConfig) {}

  async doctor(cwd: string): Promise<DoctorCheck> {
    const result = await runProcess({
      command: this.config.command,
      args: ["--version"],
      cwd,
      timeoutMs: 10_000,
    });
    const detail = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join(" — ");
    return {
      name: `${this.config.adapter} CLI`,
      ok: result.exitCode === 0,
      detail: detail || (result.exitCode === 0 ? "available" : "not found"),
    };
  }

  protected modelArgs(): string[] {
    return this.config.model ? ["--model", this.config.model] : [];
  }

  protected assertSuccess(exitCode: number, stderr: string): void {
    if (exitCode !== 0) {
      throw new AdapterError(
        `${this.config.adapter} exited with code ${exitCode}: ${stderr.trim() || "no error output"}`,
      );
    }
  }
}
