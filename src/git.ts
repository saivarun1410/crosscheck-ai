import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { runProcess } from "./process.js";

export class GitError extends Error {
  override readonly name = "GitError";
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await runProcess({ command: "git", args, cwd, timeoutMs: 30_000 });
  if (result.exitCode !== 0) {
    throw new GitError(result.stderr.trim() || `git ${args.join(" ")} failed`);
  }
  return result.stdout;
}

export async function repositoryRoot(cwd: string): Promise<string> {
  return (await git(cwd, ["rev-parse", "--show-toplevel"])).trim();
}

export async function assertBaseRef(cwd: string, baseRef: string): Promise<void> {
  await git(cwd, ["rev-parse", "--verify", `${baseRef}^{commit}`]);
}

export async function workingTreeStatus(cwd: string): Promise<string> {
  return await git(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
}

export async function assertCleanWorkingTree(cwd: string): Promise<void> {
  if ((await workingTreeStatus(cwd)).length > 0) {
    throw new GitError(
      "The working tree is not clean. Commit or stash existing changes, or set workspace.requireClean to false.",
    );
  }
}

function parseNullList(output: string): string[] {
  return output.split("\0").filter(Boolean);
}

async function untrackedFiles(cwd: string): Promise<string[]> {
  return parseNullList(await git(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]));
}

function untrackedPatch(path: string, content: Buffer): string {
  const normalized = path.replaceAll("\\", "/");
  const header = `diff --git a/${normalized} b/${normalized}\nnew file mode 100644\n--- /dev/null\n+++ b/${normalized}\n`;
  if (content.includes(0)) return `${header}Binary files /dev/null and b/${normalized} differ\n`;
  const text = content.toString("utf8");
  const lines = text === "" ? [] : text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const body = lines.map((line) => `+${line}`).join("\n");
  const noNewline = text !== "" && !text.endsWith("\n") ? "\n\\ No newline at end of file" : "";
  return `${header}@@ -0,0 +1,${lines.length} @@\n${body}${noNewline}\n`;
}

export interface DiffResult {
  text: string;
  truncated: boolean;
}

export async function collectDiff(
  cwd: string,
  baseRef: string,
  includeUntracked: boolean,
  maxBytes: number,
): Promise<DiffResult> {
  let text = await git(cwd, ["diff", "--no-ext-diff", "--binary", baseRef, "--", "."]);
  if (includeUntracked) {
    for (const path of await untrackedFiles(cwd)) {
      const fullPath = resolve(cwd, path);
      if (relative(cwd, fullPath).startsWith("..")) continue;
      text += untrackedPatch(path, await readFile(fullPath));
      if (Buffer.byteLength(text) > maxBytes) break;
    }
  }
  if (Buffer.byteLength(text) <= maxBytes) return { text, truncated: false };
  return {
    text: Buffer.from(text).subarray(0, maxBytes).toString("utf8"),
    truncated: true,
  };
}

export async function changedFiles(cwd: string, baseRef: string): Promise<string[]> {
  const tracked = parseNullList(await git(cwd, ["diff", "--name-only", "-z", baseRef, "--", "."]));
  const untracked = await untrackedFiles(cwd);
  return [...new Set([...tracked, ...untracked])].sort();
}
