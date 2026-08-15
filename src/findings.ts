import { isAbsolute, normalize, sep } from "node:path";
import type {
  PolicyConfig,
  ReviewFinding,
  ReviewReport,
  ReviewVerdict,
  Severity,
} from "./types.js";

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"];
const VERDICTS: ReviewVerdict[] = ["pass", "changes_requested", "blocked"];
const RANK: Record<Severity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

export class ReviewParseError extends Error {
  override readonly name = "ReviewParseError";
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ReviewParseError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ReviewParseError(`${path} must be a non-empty string`);
  }
  return value;
}

function unwrap(value: unknown): unknown {
  const outer = record(value, "review output");
  if (outer.structured_output !== undefined) return outer.structured_output;
  if (outer.structuredOutput !== undefined) return outer.structuredOutput;
  if (typeof outer.result === "string") return parseJsonText(outer.result);
  if (outer.result && typeof outer.result === "object") return outer.result;
  return value;
}

function parseJsonText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) {
      try {
        return JSON.parse(fenced);
      } catch {
        // Continue to the balanced-object fallback.
      }
    }
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        // The error below is more useful to callers than the JSON parser detail.
      }
    }
    throw new ReviewParseError("Reviewer did not return valid JSON");
  }
}

function parseFinding(value: unknown, index: number): ReviewFinding {
  const raw = record(value, `findings[${index}]`);
  const severity = requiredString(raw.severity, `findings[${index}].severity`) as Severity;
  if (!SEVERITIES.includes(severity)) {
    throw new ReviewParseError(`findings[${index}].severity is invalid`);
  }
  if (typeof raw.confidence !== "number" || raw.confidence < 0 || raw.confidence > 1) {
    throw new ReviewParseError(`findings[${index}].confidence must be between 0 and 1`);
  }
  const finding: ReviewFinding = {
    id: requiredString(raw.id, `findings[${index}].id`),
    severity,
    confidence: raw.confidence,
    category: requiredString(raw.category, `findings[${index}].category`),
    file: requiredString(raw.file, `findings[${index}].file`),
    title: requiredString(raw.title, `findings[${index}].title`),
    evidence: requiredString(raw.evidence, `findings[${index}].evidence`),
    recommendation: requiredString(raw.recommendation, `findings[${index}].recommendation`),
  };
  if (raw.line !== undefined) {
    if (!Number.isInteger(raw.line) || (raw.line as number) < 1) {
      throw new ReviewParseError(`findings[${index}].line must be a positive integer`);
    }
    finding.line = raw.line as number;
  }
  return finding;
}

export function parseReviewOutput(value: string | unknown): ReviewReport {
  const parsed = typeof value === "string" ? parseJsonText(value) : value;
  const raw = record(unwrap(parsed), "review");
  const verdict = requiredString(raw.verdict, "review.verdict") as ReviewVerdict;
  if (!VERDICTS.includes(verdict)) throw new ReviewParseError("review.verdict is invalid");
  if (!Array.isArray(raw.findings)) throw new ReviewParseError("review.findings must be an array");
  return {
    verdict,
    summary: requiredString(raw.summary, "review.summary"),
    findings: raw.findings.map(parseFinding),
  };
}

function safeRelativePath(path: string): string | undefined {
  if (isAbsolute(path)) return undefined;
  const cleaned = normalize(path.replace(/^\.\//, ""));
  if (cleaned === ".." || cleaned.startsWith(`..${sep}`)) return undefined;
  return cleaned.replaceAll("\\", "/");
}

export function blockingFindings(
  report: ReviewReport,
  policy: PolicyConfig,
  changedFiles: string[],
): ReviewFinding[] {
  const changed = new Set(changedFiles.map((path) => path.replaceAll("\\", "/")));
  return report.findings.filter((finding) => {
    const path = safeRelativePath(finding.file);
    return (
      path !== undefined &&
      changed.has(path) &&
      finding.confidence >= policy.minimumConfidence &&
      RANK[finding.severity] >= RANK[policy.failOn]
    );
  });
}
