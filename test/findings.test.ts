import assert from "node:assert/strict";
import test from "node:test";
import { blockingFindings, parseReviewOutput, ReviewParseError } from "../src/findings.js";
import type { PolicyConfig, ReviewReport } from "../src/types.js";

const report: ReviewReport = {
  verdict: "changes_requested",
  summary: "One issue",
  findings: [
    {
      id: "F1",
      severity: "high",
      confidence: 0.9,
      category: "correctness",
      file: "src/a.ts",
      line: 4,
      title: "Wrong return value",
      evidence: "The new branch returns false.",
      recommendation: "Return the computed value.",
    },
  ],
};

const policy: PolicyConfig = {
  maxReviewRounds: 2,
  failOn: "high",
  minimumConfidence: 0.65,
  maxDiffBytes: 1_000_000,
};

test("parseReviewOutput unwraps Claude structured output", () => {
  const parsed = parseReviewOutput(JSON.stringify({ structured_output: report }));
  assert.deepEqual(parsed, report);
});

test("parseReviewOutput accepts a fenced Codex result", () => {
  const parsed = parseReviewOutput(`Review complete\n\`\`\`json\n${JSON.stringify(report)}\n\`\`\``);
  assert.equal(parsed.findings[0]?.id, "F1");
});

test("blockingFindings requires severity, confidence, and a changed path", () => {
  assert.equal(blockingFindings(report, policy, ["src/a.ts"]).length, 1);
  assert.equal(blockingFindings(report, policy, ["src/b.ts"]).length, 0);
  const lowConfidence = structuredClone(report);
  lowConfidence.findings[0]!.confidence = 0.2;
  assert.equal(blockingFindings(lowConfidence, policy, ["src/a.ts"]).length, 0);
});

test("parseReviewOutput rejects malformed reports", () => {
  assert.throws(() => parseReviewOutput("not JSON"), ReviewParseError);
  assert.throws(
    () => parseReviewOutput({ verdict: "pass", summary: "ok", findings: "none" }),
    /findings/,
  );
});
