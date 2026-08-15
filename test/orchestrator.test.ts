import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_CONFIG } from "../src/config.js";
import { runCrosscheck } from "../src/orchestrator.js";
import { runProcess } from "../src/process.js";
import type {
  AgentAdapter,
  AgentResult,
  AuthorRequest,
  CrosscheckConfig,
  DoctorCheck,
  ReviewReport,
  ReviewRequest,
} from "../src/types.js";

class ScriptedAdapter implements AgentAdapter {
  readonly name: string;
  authorCalls = 0;
  reviewCalls = 0;

  constructor(
    name: string,
    private readonly authors: Array<(request: AuthorRequest) => Promise<void>>,
    private readonly reviews: ReviewReport[],
  ) {
    this.name = name;
  }

  async author(request: AuthorRequest): Promise<AgentResult> {
    const operation = this.authors[Math.min(this.authorCalls, this.authors.length - 1)];
    this.authorCalls += 1;
    if (operation) await operation(request);
    return { summary: `author round ${request.round}` };
  }

  async review(_request: ReviewRequest): Promise<ReviewReport> {
    const report = this.reviews[Math.min(this.reviewCalls, this.reviews.length - 1)];
    this.reviewCalls += 1;
    if (!report) throw new Error("No scripted review");
    return structuredClone(report);
  }

  async doctor(_cwd: string): Promise<DoctorCheck> {
    return { name: this.name, ok: true, detail: "scripted" };
  }
}

const passReview: ReviewReport = { verdict: "pass", summary: "Looks good", findings: [] };

function blockingReview(file: string): ReviewReport {
  return {
    verdict: "changes_requested",
    summary: "Correction required",
    findings: [
      {
        id: "F1",
        severity: "high",
        confidence: 0.95,
        category: "correctness",
        file,
        title: "Incorrect value",
        evidence: "The changed file contains the wrong value.",
        recommendation: "Write the expected value.",
      },
    ],
  };
}

async function git(cwd: string, args: string[]): Promise<void> {
  const result = await runProcess({ command: "git", args, cwd });
  assert.equal(result.exitCode, 0, result.stderr);
}

async function createRepo(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "crosscheck-test-"));
  await git(cwd, ["init", "-q"]);
  await git(cwd, ["config", "user.email", "test@example.com"]);
  await git(cwd, ["config", "user.name", "Crosscheck Test"]);
  await writeFile(join(cwd, "README.md"), "fixture\n");
  await git(cwd, ["add", "README.md"]);
  await git(cwd, ["commit", "-q", "-m", "fixture"]);
  return cwd;
}

function config(overrides?: Partial<CrosscheckConfig["policy"]>): CrosscheckConfig {
  const value = structuredClone(DEFAULT_CONFIG);
  value.policy = { ...value.policy, ...overrides };
  value.verification.commands = [`node -e "process.exit(0)"`];
  return value;
}

test("runCrosscheck accepts an independently reviewed change", async (t) => {
  const cwd = await createRepo();
  t.after(async () => rm(cwd, { recursive: true, force: true }));
  const author = new ScriptedAdapter(
    "author",
    [async () => writeFile(join(cwd, "feature.txt"), "correct\n")],
    [],
  );
  const reviewer = new ScriptedAdapter("reviewer", [], [passReview]);

  const report = await runCrosscheck({ task: "Add feature", cwd, config: config(), author, reviewer });
  assert.equal(report.status, "accepted");
  assert.deepEqual(report.changedFiles, ["feature.txt"]);
  assert.equal(report.rounds.length, 1);
});

test("runCrosscheck feeds blockers back to the author and converges", async (t) => {
  const cwd = await createRepo();
  t.after(async () => rm(cwd, { recursive: true, force: true }));
  const author = new ScriptedAdapter(
    "author",
    [
      async () => writeFile(join(cwd, "feature.txt"), "wrong\n"),
      async (request) => {
        assert.equal(request.feedback[0]?.id, "F1");
        await writeFile(join(cwd, "feature.txt"), "correct\n");
      },
    ],
    [],
  );
  const reviewer = new ScriptedAdapter("reviewer", [], [blockingReview("feature.txt"), passReview]);

  const report = await runCrosscheck({ task: "Add feature", cwd, config: config(), author, reviewer });
  assert.equal(report.status, "accepted");
  assert.equal(author.authorCalls, 2);
  assert.equal(reviewer.reviewCalls, 2);
});

test("findings against untouched files do not block", async (t) => {
  const cwd = await createRepo();
  t.after(async () => rm(cwd, { recursive: true, force: true }));
  const author = new ScriptedAdapter(
    "author",
    [async () => writeFile(join(cwd, "feature.txt"), "correct\n")],
    [],
  );
  const reviewer = new ScriptedAdapter("reviewer", [], [blockingReview("not-changed.ts")]);
  const report = await runCrosscheck({ task: "Add feature", cwd, config: config(), author, reviewer });
  assert.equal(report.status, "accepted");
  assert.equal(report.rounds[0]?.review.findings.length, 1);
  assert.equal(report.rounds[0]?.blockingFindings.length, 0);
});

test("failed deterministic verification cannot be approved by the reviewer", async (t) => {
  const cwd = await createRepo();
  t.after(async () => rm(cwd, { recursive: true, force: true }));
  const author = new ScriptedAdapter(
    "author",
    [async () => writeFile(join(cwd, "feature.txt"), "change\n")],
    [],
  );
  const reviewer = new ScriptedAdapter("reviewer", [], [passReview]);
  const failing = config({ maxReviewRounds: 1 });
  failing.verification.commands = [`node -e "process.exit(7)"`];
  const report = await runCrosscheck({ task: "Add feature", cwd, config: failing, author, reviewer });
  assert.equal(report.status, "verification_failed");
  assert.equal(report.finalVerification[0]?.exitCode, 7);
});
