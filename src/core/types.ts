export type ReviewStatus = "PASS" | "NEEDS_WORK";

export interface ReviewResult {
  status: ReviewStatus;
  findings: string[];
  summary?: string | undefined;
}

export interface Phase {
  id: string;
  title: string;
  reviewerPrompt: string;
}

export interface ThreadRef {
  id: string;
  sessionId?: string;
}

export type SandboxMode = "readOnly" | "workspaceWrite";

export interface TurnRequest {
  threadId: string;
  prompt: string;
  cwd: string;
  sandbox: SandboxMode;
  networkAccess?: boolean;
  outputSchema?: Record<string, unknown>;
}

export interface TurnResult {
  turnId: string;
  status: "completed" | "interrupted" | "failed";
  text: string;
  diff?: string;
  error?: string;
  usage?: Record<string, unknown>;
}

export interface AgentRuntime {
  initialize(): Promise<void>;
  startThread(options: { cwd: string; model?: string }): Promise<ThreadRef>;
  forkThread(threadId: string, lastTurnId: string): Promise<ThreadRef>;
  runTurn(request: TurnRequest): Promise<TurnResult>;
  close(): Promise<void>;
}

export interface PipelineOptions {
  cwd: string;
  model?: string;
  instructions?: string;
  maxIterationsPerPhase: number;
  networkAccess: boolean;
}

export interface PhaseSummary {
  phase: Phase;
  iterations: number;
  passed: boolean;
  findings: string[];
}

export interface PipelineResult {
  reviewerThreadId: string;
  phases: PhaseSummary[];
  gitBranch?: string;
}

export interface ProgressReporter {
  title(): void;
  info(message: string): void;
  warning(message: string): void;
  phaseStarted(index: number, total: number, phase: Phase): void;
  reviewing(isRepeat: boolean): void;
  needsWork(findings: string[]): void;
  planning(planPath: string): void;
  working(): void;
  phasePassed(): void;
  command(command: string, status?: string): void;
  verbose(message: string): void;
  completed(result: PipelineResult): void;
  failed(message: string): void;
}
