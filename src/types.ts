export type AgentAdapterName = "codex" | "claude";
export type AgentRole = "author" | "reviewer";
export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type ReviewVerdict = "pass" | "changes_requested" | "blocked";
export type RunStatus =
  | "accepted"
  | "changes_requested"
  | "verification_failed"
  | "no_changes";

export interface AgentConfig {
  adapter: AgentAdapterName;
  command: string;
  model?: string;
  maxTurns: number;
  timeoutMs: number;
  extraArgs: string[];
}

export interface WorkspaceConfig {
  baseRef: string;
  requireClean: boolean;
  includeUntracked: boolean;
}

export interface VerificationConfig {
  commands: string[];
  timeoutMs: number;
}

export interface PolicyConfig {
  maxReviewRounds: number;
  failOn: Severity;
  minimumConfidence: number;
  maxDiffBytes: number;
}

export interface CrosscheckConfig {
  version: 1;
  agents: {
    author: AgentConfig;
    reviewer: AgentConfig;
  };
  workspace: WorkspaceConfig;
  verification: VerificationConfig;
  policy: PolicyConfig;
}

export interface ReviewFinding {
  id: string;
  severity: Severity;
  confidence: number;
  category: string;
  file: string;
  line?: number;
  title: string;
  evidence: string;
  recommendation: string;
}

export interface ReviewReport {
  verdict: ReviewVerdict;
  summary: string;
  findings: ReviewFinding[];
}

export interface VerificationResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface AgentResult {
  summary: string;
  raw?: unknown;
}

export interface AuthorRequest {
  task: string;
  cwd: string;
  round: number;
  feedback: ReviewFinding[];
  verification: VerificationResult[];
}

export interface ReviewRequest {
  task: string;
  cwd: string;
  round: number;
  diff: string;
  diffTruncated: boolean;
  verification: VerificationResult[];
}

export interface AgentAdapter {
  readonly name: string;
  author(request: AuthorRequest): Promise<AgentResult>;
  review(request: ReviewRequest): Promise<ReviewReport>;
  doctor(cwd: string): Promise<DoctorCheck>;
}

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface RoundReport {
  round: number;
  authorSummary?: string;
  verification: VerificationResult[];
  review: ReviewReport;
  blockingFindings: ReviewFinding[];
}

export interface CrosscheckReport {
  status: RunStatus;
  task: string;
  cwd: string;
  baseRef: string;
  startedAt: string;
  finishedAt: string;
  changedFiles: string[];
  rounds: RoundReport[];
  finalVerification: VerificationResult[];
  message: string;
}

export interface RunOptions {
  task: string;
  cwd: string;
  config: CrosscheckConfig;
  author: AgentAdapter;
  reviewer: AgentAdapter;
  reviewOnly?: boolean;
  onEvent?: (event: CrosscheckEvent) => void;
}

export type CrosscheckEvent =
  | { type: "author_started"; round: number; agent: string }
  | { type: "author_finished"; round: number; summary: string }
  | { type: "verification_started"; round: number; command: string }
  | { type: "verification_finished"; round: number; result: VerificationResult }
  | { type: "review_started"; round: number; agent: string }
  | { type: "review_finished"; round: number; report: ReviewReport }
  | { type: "finished"; report: CrosscheckReport };
