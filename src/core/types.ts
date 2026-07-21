export interface ReviewResult {
  blockers: string[];
  non_blockers: string[];
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

export type ThreadGoalStatus =
  | "active"
  | "paused"
  | "blocked"
  | "usageLimited"
  | "budgetLimited"
  | "complete";

export interface ThreadGoal {
  threadId: string;
  objective: string;
  status: ThreadGoalStatus;
  tokenBudget: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: number;
  updatedAt: number;
}

export interface ThreadGoalRequest {
  objective?: string | undefined;
  status?: ThreadGoalStatus | undefined;
  tokenBudget?: number | undefined;
}

export interface ThreadGoalQueryResult {
  goal: ThreadGoal | null;
}

export type SandboxMode = "read-only" | "workspace-write";

export interface TurnRequest {
  threadId: string;
  prompt: string;
  cwd: string;
  sandbox: SandboxMode;
  networkAccess?: boolean;
  outputSchema?: Record<string, unknown>;
  logContext?: TurnLogContext;
}

export interface TurnLogContext {
  runId: string;
  phaseId: string;
  phaseIndex: number;
  phaseTitle: string;
  phaseIteration: number;
  phaseTotal: number;
  threadRole: "reviewer" | "worker";
  phaseTurn: "review" | "planning" | "execution";
  isRepeat: boolean;
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
  setThreadGoal(threadId: string, goal: ThreadGoalRequest): Promise<ThreadGoal>;
  getThreadGoal(threadId: string): Promise<ThreadGoal | null>;
  clearThreadGoal(threadId: string): Promise<boolean>;
  close(): Promise<void>;
}

export interface PipelineOptions {
  cwd: string;
  model?: string;
  instructions?: string;
  maxIterationsPerPhase: number;
  networkAccess: boolean;
  commit?: boolean;
  signal?: AbortSignal;
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
  command(
    command: string,
    status?: string,
    context?: Record<string, unknown>,
  ): void;
  thinking(message: string, context?: Record<string, unknown>): void;
  result(message: string, context?: Record<string, unknown>): void;
  filesTouched(
    paths: readonly string[],
    context?: Record<string, unknown>,
  ): void;
  waiting(message: string): void;
  verbose(message: string): void;
  completed(result: PipelineResult): void;
  failed(message: string): void;
}
