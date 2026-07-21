import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";

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
import { Pre2prodError, throwIfAborted } from "./core/errors.js";
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
    throwIfAborted(options.signal);
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
      throwIfAborted(options.signal);
      const git = await prepareGit(options.cwd, this.#reporter, {
        createBranch: commit,
      });
      throwIfAborted(options.signal);
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
        options.signal,
      );
      throwIfAborted(options.signal);
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
        throwIfAborted(options.signal);
        this.#reporter.phaseStarted(index + 1, phases.length, phase);
        const summary = await this.#runPhase(
          reviewer.id,
          phase,
          index + 1,
          phases.length,
          options,
          commit
            ? (phaseToCommit) => git.commitPhase(phaseToCommit, options.signal)
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
    commitPhase: (
      phaseToCommit: {
        id: string;
        title: string;
      },
      signal?: AbortSignal,
    ) => Promise<void>,
  ): Promise<PhaseSummary> {
    throwIfAborted(options.signal);
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
      throwIfAborted(options.signal);
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
          options.signal,
        );
        review = parseReviewResult(reviewTurn.text);
        latestBlockers = review.blockers;
        throwIfAborted(options.signal);

        this.#logger.log(
          "info",
          "phase.review.completed",
          {
            ...phaseContext,
            phaseIteration,
            blockersCount: review.blockers.length,
            nonBlockersCount: review.non_blockers.length,
            blockers: review.blockers,
            non_blockers: review.non_blockers,
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
        await archivePlan(
          options.cwd,
          runId,
          phase,
          phaseIteration,
          options.signal,
        );
        throwIfAborted(options.signal);
        await commitPhase(phase, options.signal);
        throwIfAborted(options.signal);
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
        return { phase, iterations: iteration, passed: true, findings: [] };
      }

      this.#reporter.needsWork(review.blockers);
      this.#logger.log(
        "warn",
        "phase.review.blockers",
        {
          ...phaseContext,
          phaseIteration,
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
            blockersCount: review.blockers.length,
            maxIterationsPerPhase: options.maxIterationsPerPhase,
          },
          { summary: true },
        );
        const message = `Phase "${phase.title}" remains blocked after ${options.maxIterationsPerPhase} worker iterations; continuing to the next phase.`;
        this.#reporter.warning(message);
        this.#logger.log(
          "warn",
          "phase.review.max_iterations_reached",
          {
            ...phaseContext,
            phaseIteration,
            blockersCount: review.blockers.length,
            maxIterationsPerPhase: options.maxIterationsPerPhase,
          },
          { summary: true },
        );
        return {
          phase,
          iterations: iteration,
          passed: false,
          findings: review.blockers,
        };
      }

      throwIfAborted(options.signal);
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

      throwIfAborted(options.signal);
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

      const planningTurn = await this.#runTurnWithProgress(
        () =>
          this.#runtime.runTurn({
            threadId: worker.id,
            prompt: workerPlanningPrompt(
              phase,
              review.blockers,
              options.instructions,
            ),
            cwd: options.cwd,
            sandbox: "read-only",
            networkAccess: false,
            logContext: planningContext,
          }),
        planningContext,
        `${phase.title} worker planning (iteration ${phaseIteration})`,
        options.signal,
      );
      throwIfAborted(options.signal);
      if (!planningTurn.text.trim()) {
        throw new Pre2prodError("Planning turn returned an empty plan");
      }
      await writeFile(
        resolve(options.cwd, PLAN_FILE),
        planningTurn.text,
        "utf8",
      );
      await assertPlanExists(options.cwd);
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
      throwIfAborted(options.signal);
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
          options.signal,
        );
      } finally {
        if (!options.signal?.aborted) {
          try {
            await this.#runtime.clearThreadGoal(worker.id);
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            this.#logger.log(
              "warn",
              "phase.worker.goal.clear.failed",
              {
                ...phaseContext,
                phaseIteration,
                threadId: worker.id,
                error: message,
              },
              { summary: true },
            );
            this.#reporter.warning(`Worker goal cleanup failed: ${message}`);
          }
        }
      }
      throwIfAborted(options.signal);
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
        blockersCount: latestBlockers.length,
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
    signal?: AbortSignal,
  ): Promise<T> {
    throwIfAborted(signal);
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
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  const planPath = resolve(cwd, PLAN_FILE);
  try {
    await access(planPath);
  } catch {
    return;
  }

  const directory = resolve(cwd, ".pre2prod", "plans");
  const filename = `${fileSegment(runId)}-${fileSegment(phase.id)}-${phaseIteration}.md`;

  throwIfAborted(signal);
  await mkdir(directory, { recursive: true });
  throwIfAborted(signal);
  await rename(planPath, resolve(directory, filename));
}

function fileSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
