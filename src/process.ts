import { spawn } from "node:child_process";
import type { VerificationResult } from "./types.js";

const MAX_CAPTURE_BYTES = 2_000_000;

export interface ProcessRequest {
  command: string;
  args?: string[];
  cwd: string;
  input?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  shell?: boolean;
}

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

function appendLimited(current: string, chunk: Buffer): string {
  if (Buffer.byteLength(current) >= MAX_CAPTURE_BYTES) return current;
  const remaining = MAX_CAPTURE_BYTES - Buffer.byteLength(current);
  return current + chunk.subarray(0, remaining).toString("utf8");
}

export async function runProcess(request: ProcessRequest): Promise<ProcessResult> {
  const started = Date.now();
  return await new Promise((resolveResult) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const child = spawn(request.command, request.args ?? [], {
      cwd: request.cwd,
      env: request.env ?? process.env,
      shell: request.shell ?? false,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const finish = (exitCode: number): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolveResult({
        exitCode,
        stdout,
        stderr,
        durationMs: Date.now() - started,
        timedOut,
      });
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = appendLimited(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendLimited(stderr, chunk);
    });
    child.on("error", (error) => {
      stderr = appendLimited(stderr, Buffer.from(error.message));
      finish(-1);
    });
    child.on("close", (code) => finish(code ?? -1));

    const timer = request.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          stderr = appendLimited(stderr, Buffer.from(`\nTimed out after ${request.timeoutMs}ms`));
          child.kill("SIGTERM");
          setTimeout(() => child.kill("SIGKILL"), 1_000).unref();
        }, request.timeoutMs)
      : undefined;
    timer?.unref();

    if (request.input !== undefined) child.stdin.end(request.input);
    else child.stdin.end();
  });
}

export async function runVerificationCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
): Promise<VerificationResult> {
  const result = await runProcess({ command, cwd, timeoutMs, shell: true });
  return { command, ...result };
}
