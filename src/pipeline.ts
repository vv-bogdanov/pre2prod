import { access, mkdir, readFile, rename, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

import type {
  AgentRuntime,
  Phase,
  TurnLogContext,
  TurnResult,
  PhaseSummary,
  PipelineOptions,
  PipelineResult,
  ProgressReporter,
} from "./core/types.js";
import { PhaseFailedError, Pre2prodError } from "./core/errors.js";
import { prepareGit } from "./git.js";
import { loadPhases } from "./phases.js";
import {
  initialDiscoveryPrompt,
  phaseReviewPrompt,
  workerExecutionPrompt,
  workerPlanningPrompt,
} from "./prompts.js";
import { createRunId, NoopRunLogger, type RunLogger } from "./logging.js";
import { parseReviewResult, REVIEW_RESULT_SCHEMA } from "./reviewer.js";

const PLAN_FILE = "PRE2PROD_PLAN.md";
const TURN_WAIT_HEARTBEAT_MS = 10_000;
const execFileAsync = promisify(execFile);

export class Pre2prodPipeline {
  readonly #runtime: AgentRuntime;
  readonly #reporter: ProgressReporter;
  readonly #phases: readonly Phase[] | undefined;
  readonly #logger: RunLogger;

  public constructor(
    runtime: AgentRuntime,
    reporter: ProgressReporter,
    phases?: readonly Phase[],
    logger?: RunLogger,
  ) {
    this.#runtime = runtime;
    this.#reporter = reporter;
    this.#phases = phases;
    this.#logger = logger ?? new NoopRunLogger(createRunId());
  }

  public async run(options: PipelineOptions): Promise<PipelineResult> {
    this.#reporter.title();
    const phases = this.#phases ?? (await loadPhases(options.cwd));
    const runId = this.#logger.runId;
    const commit = options.commit ?? true;

    this.#logger.log(
      "info",
      "pipeline.run.started",
      {
        runId,
        cwd: options.cwd,
        phases: phases.length,
        model: options.model,
        maxIterationsPerPhase: options.maxIterationsPerPhase,
        networkAccess: options.networkAccess,
        commit,
      },
      { summary: true },
    );

    try {
      await this.#runtime.initialize();
      const git = await prepareGit(options.cwd, this.#reporter, {
        createBranch: commit,
      });
      const reviewer = await this.#runtime.startThread({
        cwd: options.cwd,
        ...(options.model ? { model: options.model } : {}),
      });

      this.#reporter.info("Studying repository...");
      this.#logger.log("info", "pipeline.discovery.started", {
        runId,
        threadId: reviewer.id,
      });
      const discoveryLogContext = {
        runId,
        phaseId: "discovery",
        phaseIndex: 0,
        phaseTitle: "discovery",
        phaseIteration: 0,
        phaseTotal: phases.length,
        threadRole: "reviewer" as const,
        phaseTurn: "review" as const,
        isRepeat: false,
      };

      await this.#runTurnWithProgress(
        () =>
          this.#runtime.runTurn({
            threadId: reviewer.id,
            prompt: initialDiscoveryPrompt(options.instructions),
            cwd: options.cwd,
            sandbox: "read-only",
            outputSchema: REVIEW_RESULT_SCHEMA,
            logContext: discoveryLogContext,
          }),
        discoveryLogContext,
        "Studying repository structure and baseline context",
      );
      this.#logger.log(
        "info",
        "pipeline.discovery.completed",
        {
          runId,
          threadId: reviewer.id,
        },
        { summary: true },
      );

      const summaries: PhaseSummary[] = [];

      for (const [index, phase] of phases.entries()) {
        this.#reporter.phaseStarted(index + 1, phases.length, phase);
        const summary = await this.#runPhase(
          reviewer.id,
          phase,
          index + 1,
          phases.length,
          options,
          commit
            ? (phaseToCommit) => git.commitPhase(phaseToCommit)
            : () => Promise.resolve(),
        );
        summaries.push(summary);
      }

      const result: PipelineResult = {
        reviewerThreadId: reviewer.id,
        phases: summaries,
        ...(git.branch ? { gitBranch: git.branch } : {}),
      };
      this.#reporter.completed(result);
      this.#logger.log(
        "info",
        "pipeline.run.completed",
        {
          runId,
          phasesPassed: result.phases.filter((phase) => phase.passed).length,
          phasesTotal: result.phases.length,
          failed: result.phases.some((phase) => !phase.passed),
        },
        { summary: true },
      );
      return result;
    } catch (error) {
      this.#logger.log(
        "error",
        "pipeline.run.failed",
        {
          runId,
          error: error instanceof Error ? error.message : String(error),
        },
        { summary: true },
      );
      throw error;
    } finally {
      await this.#runtime.close();
    }
  }

  async #runPhase(
    reviewerThreadId: string,
    phase: Phase,
    phaseIndex: number,
    phaseTotal: number,
    options: PipelineOptions,
    commitPhase: (phaseToCommit: {
      id: string;
      title: string;
    }) => Promise<void>,
  ): Promise<PhaseSummary> {
    let isRepeat = false;
    let latestBlockers: string[] = [];
    const runId = this.#logger.runId;
    const phaseContext = {
      runId,
      phaseId: phase.id,
      phaseIndex,
      phaseTitle: phase.title,
      phaseTotal,
    };

    this.#logger.log("info", "pipeline.phase.started", phaseContext, {
      summary: true,
    });

    for (
      let iteration = 0;
      iteration <= options.maxIterationsPerPhase;
      iteration += 1
    ) {
      const phaseIteration = iteration + 1;
      const reviewLogContext = this.#buildTurnContext(
        phase,
        phaseIndex,
        phaseTotal,
        phaseIteration,
        {
          threadRole: "reviewer",
          phaseTurn: "review",
          isRepeat,
        },
      );

      this.#logger.log(
        "info",
        "phase.review.started",
        {
          ...phaseContext,
          ...reviewLogContext,
        },
        { summary: true },
      );
      this.#reporter.reviewing(isRepeat);

      let reviewTurn: TurnResult;
      let review: ReturnType<typeof parseReviewResult>;
      try {
        reviewTurn = await this.#runTurnWithProgress(
          () =>
            this.#runtime.runTurn({
              threadId: reviewerThreadId,
              prompt: phaseReviewPrompt(phase, options.instructions, isRepeat),
              cwd: options.cwd,
              sandbox: "read-only",
              outputSchema: REVIEW_RESULT_SCHEMA,
              logContext: reviewLogContext,
            }),
          reviewLogContext,
          `${phase.title} review (iteration ${phaseIteration})`,
        );
        review = parseReviewResult(reviewTurn.text);
        latestBlockers = review.blockers;

        this.#logger.log(
          "info",
          "phase.review.completed",
          {
            ...phaseContext,
            phaseIteration,
            blockers: review.blockers,
            nonBlockers: review.non_blockers,
            blockersCount: review.blockers.length,
            nonBlockersCount: review.non_blockers.length,
            turnId: reviewTurn.turnId,
          },
          { summary: true },
        );
      } catch (error) {
        this.#logger.log(
          "error",
          "phase.review.failed",
          {
            ...phaseContext,
            phaseIteration,
            error: error instanceof Error ? error.message : String(error),
          },
          { summary: true },
        );
        throw error;
      }

      if (review.blockers.length === 0) {
        await archivePlan(options.cwd, runId, phase, phaseIteration);
        this.#reporter.phasePassed();
        this.#logger.log(
          "info",
          "phase.review.passed",
          {
            ...phaseContext,
            phaseIteration,
            turnId: reviewTurn.turnId,
          },
          { summary: true },
        );
        this.#logger.log(
          "info",
          "pipeline.phase.completed",
          {
            ...phaseContext,
            phaseIteration,
          },
          { summary: true },
        );
        await commitPhase(phase);
        return { phase, iterations: iteration, passed: true, findings: [] };
      }

      this.#reporter.needsWork(review.blockers);
      this.#logger.log(
        "warn",
        "phase.review.blockers",
        {
          ...phaseContext,
          phaseIteration,
          blockers: review.blockers,
          blockersCount: review.blockers.length,
        },
        { summary: true },
      );

      if (iteration >= options.maxIterationsPerPhase) {
        this.#logger.log(
          "error",
          "phase.review.max_iterations_reached",
          {
            ...phaseContext,
            phaseIteration,
            blockers: review.blockers,
            maxIterationsPerPhase: options.maxIterationsPerPhase,
          },
          { summary: true },
        );
        throw new PhaseFailedError(
          phase.id,
          `Phase "${phase.title}" did not pass after ${options.maxIterationsPerPhase} worker iterations`,
        );
      }

      const worker = await this.#runtime.forkThread(
        reviewerThreadId,
        reviewTurn.turnId,
      );
      this.#logger.log(
        "info",
        "phase.worker.forked",
        {
          ...phaseContext,
          phaseIteration,
          workerThreadId: worker.id,
          sourceTurnId: reviewTurn.turnId,
        },
        { summary: true },
      );

      await rm(resolve(options.cwd, PLAN_FILE), { force: true });
      this.#reporter.planning(PLAN_FILE);
      this.#logger.log(
        "info",
        "phase.worker.planning.started",
        {
          ...phaseContext,
          phaseIteration,
          threadId: worker.id,
        },
        { summary: true },
      );
      const planningContext = this.#buildTurnContext(
        phase,
        phaseIndex,
        phaseTotal,
        phaseIteration,
        {
          threadRole: "worker",
          phaseTurn: "planning",
          isRepeat: false,
        },
      );

      await this.#runTurnWithProgress(
        () =>
          this.#runtime.runTurn({
            threadId: worker.id,
            prompt: workerPlanningPrompt(
              phase,
              review.blockers,
              options.instructions,
            ),
            cwd: options.cwd,
            sandbox: "workspace-write",
            networkAccess: false,
            logContext: planningContext,
          }),
        planningContext,
        `${phase.title} worker planning (iteration ${phaseIteration})`,
      );
      await assertPlanExists(options.cwd);
      await assertOnlyPlanChanged(options.cwd);
      this.#logger.log(
        "info",
        "phase.worker.planning.completed",
        {
          ...phaseContext,
          phaseIteration,
          threadId: worker.id,
        },
        { summary: true },
      );

      this.#reporter.working();
      const executionContext = this.#buildTurnContext(
        phase,
        phaseIndex,
        phaseTotal,
        phaseIteration,
        {
          threadRole: "worker",
          phaseTurn: "execution",
          isRepeat,
        },
      );
      this.#logger.log(
        "info",
        "phase.worker.execution.started",
        {
          ...phaseContext,
          phaseIteration,
          threadId: worker.id,
        },
        { summary: true },
      );
      const executionGoal = `${phase.title}: execute PRE2PROD_PLAN.md (iteration ${phaseIteration})`;
      await this.#runtime.setThreadGoal(worker.id, {
        objective: executionGoal,
        status: "active",
      });
      try {
        await this.#runTurnWithProgress(
          () =>
            this.#runtime.runTurn({
              threadId: worker.id,
              prompt: workerExecutionPrompt(
                phase,
                review.blockers,
                options.instructions,
              ),
              cwd: options.cwd,
              sandbox: "workspace-write",
              networkAccess: options.networkAccess,
              logContext: executionContext,
            }),
          executionContext,
          executionGoal,
        );
      } finally {
        await this.#runtime.clearThreadGoal(worker.id);
      }
      this.#logger.log(
        "info",
        "phase.worker.execution.completed",
        {
          ...phaseContext,
          phaseIteration,
          threadId: worker.id,
        },
        { summary: true },
      );

      this.#logger.log(
        "info",
        "phase.worker.completed",
        {
          ...phaseContext,
          phaseIteration,
          workerThreadId: worker.id,
        },
        { summary: true },
      );

      this.#logger.log(
        "info",
        "phase.review.retry",
        {
          ...phaseContext,
          phaseIteration,
        },
        { summary: true },
      );

      isRepeat = true;
    }

    this.#logger.log(
      "error",
      "phase.review.unreachable_state",
      {
        ...phaseContext,
        blockers: latestBlockers,
      },
      { summary: true },
    );

    throw new Pre2prodError(
      `Unreachable phase state for ${phase.id}: ${latestBlockers.join("; ")}`,
    );
  }

  #buildTurnContext(
    phase: Phase,
    phaseIndex: number,
    phaseTotal: number,
    phaseIteration: number,
    turn: Pick<TurnLogContext, "threadRole" | "phaseTurn" | "isRepeat">,
  ): TurnLogContext {
    return {
      runId: this.#logger.runId,
      phaseId: phase.id,
      phaseIndex,
      phaseTitle: phase.title,
      phaseIteration,
      phaseTotal,
      ...turn,
    };
  }

  async #runTurnWithProgress<T>(
    runTurn: () => Promise<T>,
    context: TurnLogContext,
    action = "running",
  ): Promise<T> {
    const startedAt = Date.now();
    const turnLabel = `${context.threadRole}/${context.phaseTurn} ${context.phaseId}#${context.phaseIteration}`;
    this.#reporter.waiting(`${turnLabel} started: ${action}`);

    const timer = setInterval(() => {
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
      this.#reporter.waiting(`${turnLabel} running (${elapsedSeconds}s)`);
      this.#logger.log("debug", "pipeline.turn.waiting", {
        ...this.#buildLogContext(context),
        elapsedSeconds,
      });
    }, TURN_WAIT_HEARTBEAT_MS);

    try {
      return await runTurn();
    } finally {
      clearInterval(timer);
    }
  }

  #buildLogContext(context: TurnLogContext): Record<string, unknown> {
    return {
      runId: context.runId,
      phaseId: context.phaseId,
      phaseIndex: context.phaseIndex,
      phaseTitle: context.phaseTitle,
      phaseIteration: context.phaseIteration,
      phaseTotal: context.phaseTotal,
      threadRole: context.threadRole,
      phaseTurn: context.phaseTurn,
      isRepeat: context.isRepeat,
    };
  }
}

async function assertOnlyPlanChanged(cwd: string): Promise<void> {
  const result = await execFileAsync(
    "git",
    ["status", "--porcelain", "--untracked-files=all"],
    { cwd, encoding: "utf8" },
  );
  const changedPaths = result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.slice(3));
  const unexpected = changedPaths.filter((path) => path !== PLAN_FILE);

  if (unexpected.length > 0) {
    throw new Pre2prodError(
      `Planning turn modified files other than ${PLAN_FILE}: ${unexpected.join(", ")}`,
    );
  }
}

async function assertPlanExists(cwd: string): Promise<void> {
  const planPath = resolve(cwd, PLAN_FILE);
  try {
    await access(planPath);
    const content = await readFile(planPath, "utf8");
    if (!content.trim()) {
      throw new Pre2prodError(`${PLAN_FILE} was created but is empty`);
    }
  } catch (error) {
    if (error instanceof Pre2prodError) {
      throw error;
    }
    throw new Pre2prodError(`Planning turn did not create ${PLAN_FILE}`, {
      cause: error,
    });
  }
}

async function archivePlan(
  cwd: string,
  runId: string,
  phase: Phase,
  phaseIteration: number,
): Promise<void> {
  const planPath = resolve(cwd, PLAN_FILE);
  try {
    await access(planPath);
  } catch {
    return;
  }

  const directory = resolve(cwd, ".pre2prod", "plans");
  const filename = `${fileSegment(runId)}-${fileSegment(phase.id)}-${phaseIteration}.md`;

  await mkdir(directory, { recursive: true });
  await rename(planPath, resolve(directory, filename));
}

function fileSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
