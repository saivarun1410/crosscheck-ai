import { createHash } from "node:crypto";
import {
  assertBaseRef,
  assertCleanWorkingTree,
  changedFiles,
  collectDiff,
  repositoryRoot,
} from "./git.js";
import { blockingFindings } from "./findings.js";
import { emptyReview } from "./schema.js";
import { runVerificationCommand } from "./process.js";
import type {
  CrosscheckReport,
  ReviewFinding,
  RoundReport,
  RunOptions,
  RunStatus,
  VerificationResult,
} from "./types.js";

function hash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function checksPassed(results: VerificationResult[]): boolean {
  return results.every((result) => result.exitCode === 0);
}

async function verify(
  options: RunOptions,
  root: string,
  round: number,
): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];
  for (const command of options.config.verification.commands) {
    options.onEvent?.({ type: "verification_started", round, command });
    const result = await runVerificationCommand(
      command,
      root,
      options.config.verification.timeoutMs,
    );
    results.push(result);
    options.onEvent?.({ type: "verification_finished", round, result });
  }
  return results;
}

function reportMessage(status: RunStatus, rounds: RoundReport[]): string {
  switch (status) {
    case "accepted":
      return `Accepted after ${rounds.length} review round${rounds.length === 1 ? "" : "s"}.`;
    case "changes_requested":
      return "Review still has blocking findings or could not reach a reliable verdict.";
    case "verification_failed":
      return "One or more verification commands still fail.";
    case "no_changes":
      return "No changes were found to review.";
  }
}

function finishReport(
  options: RunOptions,
  root: string,
  startedAt: string,
  status: RunStatus,
  rounds: RoundReport[],
  files: string[],
  verification: VerificationResult[],
): CrosscheckReport {
  const report: CrosscheckReport = {
    status,
    task: options.task,
    cwd: root,
    baseRef: options.config.workspace.baseRef,
    startedAt,
    finishedAt: new Date().toISOString(),
    changedFiles: files,
    rounds,
    finalVerification: verification,
    message: reportMessage(status, rounds),
  };
  options.onEvent?.({ type: "finished", report });
  return report;
}

export async function runCrosscheck(options: RunOptions): Promise<CrosscheckReport> {
  const startedAt = new Date().toISOString();
  const root = await repositoryRoot(options.cwd);
  const { workspace, policy } = options.config;
  await assertBaseRef(root, workspace.baseRef);
  if (!options.reviewOnly && workspace.requireClean) await assertCleanWorkingTree(root);

  const rounds: RoundReport[] = [];
  let feedback: ReviewFinding[] = [];
  let previousVerification: VerificationResult[] = [];
  let previousDiffHash: string | undefined;
  let files: string[] = [];

  for (let round = 1; round <= policy.maxReviewRounds; round += 1) {
    let authorSummary: string | undefined;
    if (!options.reviewOnly) {
      options.onEvent?.({ type: "author_started", round, agent: options.author.name });
      const authorResult = await options.author.author({
        task: options.task,
        cwd: root,
        round,
        feedback,
        verification: previousVerification,
      });
      authorSummary = authorResult.summary;
      options.onEvent?.({ type: "author_finished", round, summary: authorSummary });
    }

    const verification = await verify(options, root, round);
    const diff = await collectDiff(
      root,
      workspace.baseRef,
      workspace.includeUntracked,
      policy.maxDiffBytes,
    );
    files = await changedFiles(root, workspace.baseRef);

    if (diff.text.trim() === "") {
      const noChangeRound: RoundReport = {
        round,
        verification,
        review: emptyReview("No diff was available to review."),
        blockingFindings: [],
      };
      if (authorSummary !== undefined) noChangeRound.authorSummary = authorSummary;
      rounds.push(noChangeRound);
      return finishReport(options, root, startedAt, "no_changes", rounds, files, verification);
    }

    options.onEvent?.({ type: "review_started", round, agent: options.reviewer.name });
    const review = await options.reviewer.review({
      task: options.task,
      cwd: root,
      round,
      diff: diff.text,
      diffTruncated: diff.truncated,
      verification,
    });
    options.onEvent?.({ type: "review_finished", round, report: review });
    const blockers = blockingFindings(review, policy, files);
    const roundReport: RoundReport = {
      round,
      verification,
      review,
      blockingFindings: blockers,
    };
    if (authorSummary !== undefined) roundReport.authorSummary = authorSummary;
    rounds.push(roundReport);

    if (checksPassed(verification) && blockers.length === 0 && review.verdict !== "blocked") {
      return finishReport(options, root, startedAt, "accepted", rounds, files, verification);
    }

    if (options.reviewOnly || review.verdict === "blocked") {
      const status = checksPassed(verification) ? "changes_requested" : "verification_failed";
      return finishReport(options, root, startedAt, status, rounds, files, verification);
    }

    const currentDiffHash = hash(diff.text);
    if (previousDiffHash === currentDiffHash || round === policy.maxReviewRounds) {
      const status = checksPassed(verification) ? "changes_requested" : "verification_failed";
      return finishReport(options, root, startedAt, status, rounds, files, verification);
    }

    previousDiffHash = currentDiffHash;
    feedback = blockers;
    previousVerification = verification;
  }

  return finishReport(
    options,
    root,
    startedAt,
    "changes_requested",
    rounds,
    files,
    previousVerification,
  );
}
