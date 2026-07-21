import { access, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

import type {
  AgentRuntime,
  Phase,
  PhaseSummary,
  PipelineOptions,
  PipelineResult,
  ProgressReporter,
} from "./core/types.js";
import { PhaseFailedError, Pre2prodError } from "./core/errors.js";
import { prepareGit } from "./git.js";
import { DEFAULT_PHASES } from "./phases.js";
import {
  initialDiscoveryPrompt,
  phaseReviewPrompt,
  workerExecutionPrompt,
  workerPlanningPrompt,
} from "./prompts.js";
import { parseReviewResult, REVIEW_OUTPUT_SCHEMA } from "./reviewer.js";

const PLAN_FILE = "PRE2PROD_PLAN.md";

export class Pre2prodPipeline {
  readonly #runtime: AgentRuntime;
  readonly #reporter: ProgressReporter;
  readonly #phases: readonly Phase[];

  public constructor(
    runtime: AgentRuntime,
    reporter: ProgressReporter,
    phases: readonly Phase[] = DEFAULT_PHASES,
  ) {
    this.#runtime = runtime;
    this.#reporter = reporter;
    this.#phases = phases;
  }

  public async run(options: PipelineOptions): Promise<PipelineResult> {
    this.#reporter.title();

    try {
      await this.#runtime.initialize();
      const git = await prepareGit(options.cwd, this.#reporter);
      const reviewer = await this.#runtime.startThread({
        cwd: options.cwd,
        ...(options.model ? { model: options.model } : {}),
      });

      this.#reporter.info("Studying repository...");
      await this.#runtime.runTurn({
        threadId: reviewer.id,
        prompt: initialDiscoveryPrompt(options.instructions),
        cwd: options.cwd,
        sandbox: "readOnly",
      });

      const summaries: PhaseSummary[] = [];

      for (const [index, phase] of this.#phases.entries()) {
        this.#reporter.phaseStarted(index + 1, this.#phases.length, phase);
        const summary = await this.#runPhase(reviewer.id, phase, options, (phaseId, iteration) =>
          git.commitWorker(phaseId, iteration),
        );
        summaries.push(summary);
      }

      const result: PipelineResult = {
        reviewerThreadId: reviewer.id,
        phases: summaries,
        ...(git.branch ? { gitBranch: git.branch } : {}),
      };
      this.#reporter.completed(result);
      return result;
    } finally {
      await this.#runtime.close();
    }
  }

  async #runPhase(
    reviewerThreadId: string,
    phase: Phase,
    options: PipelineOptions,
    commitWorker: (phaseId: string, iteration: number) => Promise<void>,
  ): Promise<PhaseSummary> {
    let isRepeat = false;
    let latestFindings: string[] = [];

    for (let iteration = 0; iteration <= options.maxIterationsPerPhase; iteration += 1) {
      this.#reporter.reviewing(isRepeat);
      const reviewTurn = await this.#runtime.runTurn({
        threadId: reviewerThreadId,
        prompt: phaseReviewPrompt(phase, options.instructions, isRepeat),
        cwd: options.cwd,
        sandbox: "readOnly",
        outputSchema: REVIEW_OUTPUT_SCHEMA,
      });
      const review = parseReviewResult(reviewTurn.text);
      latestFindings = review.findings;

      if (review.status === "PASS") {
        this.#reporter.phasePassed();
        return { phase, iterations: iteration, passed: true, findings: [] };
      }

      this.#reporter.needsWork(review.findings);
      if (iteration >= options.maxIterationsPerPhase) {
        throw new PhaseFailedError(
          phase.id,
          `Phase "${phase.title}" did not pass after ${options.maxIterationsPerPhase} worker iterations`,
        );
      }

      const worker = await this.#runtime.forkThread(reviewerThreadId, reviewTurn.turnId);
      await rm(resolve(options.cwd, PLAN_FILE), { force: true });
      this.#reporter.planning(PLAN_FILE);
      await this.#runtime.runTurn({
        threadId: worker.id,
        prompt: workerPlanningPrompt(phase, options.instructions),
        cwd: options.cwd,
        sandbox: "workspaceWrite",
        networkAccess: false,
      });
      await assertPlanExists(options.cwd);

      this.#reporter.working();
      await this.#runtime.runTurn({
        threadId: worker.id,
        prompt: workerExecutionPrompt(phase, options.instructions),
        cwd: options.cwd,
        sandbox: "workspaceWrite",
        networkAccess: options.networkAccess,
      });

      await commitWorker(phase.id, iteration + 1);
      isRepeat = true;
    }

    throw new Pre2prodError(`Unreachable phase state for ${phase.id}: ${latestFindings.join("; ")}`);
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
    throw new Pre2prodError(`Planning turn did not create ${PLAN_FILE}`, { cause: error });
  }
}
