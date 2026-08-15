import type { ReviewReport } from "./types.js";

export const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: { enum: ["pass", "changes_requested", "blocked"] },
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          severity: {
            enum: ["critical", "high", "medium", "low", "info"],
          },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          category: { type: "string" },
          file: { type: "string" },
          line: { type: "integer", minimum: 1 },
          title: { type: "string" },
          evidence: { type: "string" },
          recommendation: { type: "string" },
        },
        required: [
          "id",
          "severity",
          "confidence",
          "category",
          "file",
          "title",
          "evidence",
          "recommendation",
        ],
      },
    },
  },
  required: ["verdict", "summary", "findings"],
} as const;

export function reviewSchemaJson(): string {
  return JSON.stringify(REVIEW_SCHEMA);
}

export function emptyReview(summary: string): ReviewReport {
  return { verdict: "pass", summary, findings: [] };
}
