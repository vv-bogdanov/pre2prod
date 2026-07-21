import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type {
  AgentRuntime,
  Phase,
  ThreadGoal,
  ThreadGoalRequest,
  ProgressReporter,
  ThreadRef,
  TurnRequest,
  TurnResult,
} from "../src/core/types.js";
import { PhaseFailedError } from "../src/core/errors.js";
import { FileRunLogger } from "../src/logging.js";
import { Pre2prodPipeline } from "../src/pipeline.js";
import { REVIEW_RESULT_SCHEMA } from "../src/reviewer.js";

const execFileAsync = promisify(execFile);

const phase: Phase = {
  id: "testing",
  title: "Testing",
  reviewerPrompt: "Review tests.",
};

describe("Pre2prodPipeline", () => {
  it("passes when blockers are empty", async () => {
    const cwd = await createInitializedRepo();
    const runtime = new FakeRuntime(cwd, [
      "Repository summary",
      JSON.stringify({
        blockers: [],
        non_blockers: ["Optional docs improvement"],
      }),
    ]);
    const pipeline = new Pre2prodPipeline(runtime, silentReporter(), [phase]);

    const result = await pipeline.run({
      cwd,
      maxIterationsPerPhase: 2,
      networkAccess: false,
    });

    expect(result.phases[0]?.iterations).toBe(0);
    expect(result.phases[0]?.passed).toBe(true);
    expect(runtime.forks).toHaveLength(0);
  });

  it("does not archive or commit after cancellation during re-review", async () => {
    const cwd = await createInitializedRepo();
    const initialCommits = await countCommits(cwd);
    const controller = new AbortController();
    const runtime = new FakeRuntime(
      cwd,
      [
        "Repository summary",
        JSON.stringify({ blockers: ["Gap A"], non_blockers: [] }),
        "Plan written",
        "Plan executed",
        JSON.stringify({ blockers: [], non_blockers: [] }),
      ],
      {
        onRunTurn: (request) => {
          if (request.prompt.includes("A worker has completed changes")) {
            controller.abort();
          }
        },
      },
    );
    const pipeline = new Pre2prodPipeline(runtime, silentReporter(), [phase]);

    await expect(
      pipeline.run({
        cwd,
        maxIterationsPerPhase: 2,
        networkAccess: false,
        signal: controller.signal,
      }),
    ).rejects.toThrow(/Pre2prod run interrupted/i);

    expect(await countCommits(cwd)).toBe(initialCommits);
    expect(await execGit(cwd, ["status", "--porcelain"])).toContain(
      "?? PRE2PROD_PLAN.md",
    );
  });

  it("does not trigger worker for non_blockers only", async () => {
    const cwd = await createInitializedRepo();
    const runtime = new FakeRuntime(cwd, [
      "Repository summary",
      JSON.stringify({
        blockers: [],
        non_blockers: ["Optional docs improvement"],
      }),
    ]);
    const pipeline = new Pre2prodPipeline(runtime, silentReporter(), [phase]);

    await pipeline.run({
      cwd,
      maxIterationsPerPhase: 2,
      networkAccess: false,
    });

    expect(runtime.forks).toHaveLength(0);
    expect(
      runtime.requests.filter((request) =>
        request.threadId.startsWith("worker"),
      ),
    ).toHaveLength(0);
  });

  it("persists review findings when a phase reaches max iterations", async () => {
    const cwd = await createInitializedRepo();
    const logCwd = await mkdtemp(resolve(tmpdir(), "pre2prod-review-logs-"));
    const logger = new FileRunLogger({
      cwd: logCwd,
      runId: "review-findings-test",
    });
    const runtime = new FakeRuntime(cwd, [
      "Repository summary",
      JSON.stringify({
        blockers: ["First blocker"],
        non_blockers: ["First non-blocker"],
      }),
      "Plan written",
      "Plan executed",
      JSON.stringify({
        blockers: ["Final blocker"],
        non_blockers: ["Final non-blocker"],
      }),
    ]);
    const pipeline = new Pre2prodPipeline(
      runtime,
      silentReporter(),
      [phase],
      logger,
    );

    await expect(
      pipeline.run({ cwd, maxIterationsPerPhase: 1, networkAccess: false }),
    ).rejects.toBeInstanceOf(PhaseFailedError);

    const content = await readFile(FileRunLogger.paths(logCwd).summary, "utf8");
    const reviewEvents = content
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((event) => event.event === "phase.review.completed");
    expect(reviewEvents).toHaveLength(2);
    expect(reviewEvents.at(-1)).toMatchObject({
      blockers: ["Final blocker"],
      non_blockers: ["Final non-blocker"],
    });
  });

  it("triggers a worker when blockers exist", async () => {
    const cwd = await createInitializedRepo();
    const runtime = new FakeRuntime(cwd, [
      "Repository summary",
      JSON.stringify({
        blockers: ["Missing a critical test"],
        non_blockers: [],
      }),
      "Plan written",
      "Plan executed",
      JSON.stringify({ blockers: [], non_blockers: [] }),
    ]);
    const pipeline = new Pre2prodPipeline(runtime, silentReporter(), [phase]);

    const result = await pipeline.run({
      cwd,
      model: "mock",
      maxIterationsPerPhase: 2,
      networkAccess: false,
    });

    expect(result.phases).toEqual([
      { phase, iterations: 1, passed: true, findings: [] },
    ]);
    expect(runtime.forks).toEqual([
      { threadId: "reviewer", lastTurnId: "turn-2" },
    ]);
    expect(runtime.goals).toEqual([
      {
        action: "set",
        threadId: "worker-1",
        payload: {
          objective: "Testing: execute PRE2PROD_PLAN.md (iteration 1)",
          status: "active",
        },
      },
      { action: "clear", threadId: "worker-1", payload: undefined },
    ]);
  });

  it("passes only blockers to worker prompts", async () => {
    const cwd = await createInitializedRepo();
    const runtime = new FakeRuntime(cwd, [
      "Repository summary",
      JSON.stringify({
        blockers: ["Gap A", "Gap B"],
        non_blockers: ["Nice-to-have"],
      }),
      "Plan written",
      "Plan executed",
      JSON.stringify({ blockers: [], non_blockers: [] }),
    ]);
    const pipeline = new Pre2prodPipeline(runtime, silentReporter(), [phase]);

    await pipeline.run({
      cwd,
      maxIterationsPerPhase: 2,
      networkAccess: false,
    });

    const workerPrompts = runtime.requests
      .filter((request) => request.threadId.startsWith("worker-"))
      .map((request) => request.prompt);
    expect(workerPrompts).toHaveLength(2);
    expect(workerPrompts.join("\n\n")).toContain("Gap A");
    expect(workerPrompts.join("\n\n")).toContain("Gap B");
    expect(workerPrompts.join("\n\n")).not.toContain("Nice-to-have");
  });

  it("includes outputSchema for reviewer turns and not for worker turns", async () => {
    const cwd = await createInitializedRepo();
    const runtime = new FakeRuntime(cwd, [
      "Repository summary",
      JSON.stringify({ blockers: ["Gap A"], non_blockers: [] }),
      "Plan written",
      "Plan executed",
      JSON.stringify({ blockers: [], non_blockers: [] }),
    ]);
    const pipeline = new Pre2prodPipeline(runtime, silentReporter(), [phase]);

    await pipeline.run({
      cwd,
      maxIterationsPerPhase: 2,
      networkAccess: false,
    });

    const reviewerReviewTurns = runtime.requests.filter(
      (request) =>
        request.threadId === "reviewer" &&
        request.prompt.includes("Current phase"),
    );
    expect(reviewerReviewTurns).toHaveLength(2);
    for (const request of reviewerReviewTurns) {
      expect(request.outputSchema).toEqual(REVIEW_RESULT_SCHEMA);
    }

    const workerTurns = runtime.requests.filter((request) =>
      request.threadId.startsWith("worker-"),
    );
    for (const request of workerTurns) {
      expect(request.outputSchema).toBeUndefined();
    }
  });

  it("reports malformed reviewer output explicitly", async () => {
    const cwd = await createInitializedRepo();
    const runtime = new FakeRuntime(cwd, [
      "Repository summary",
      "not valid json",
    ]);
    const pipeline = new Pre2prodPipeline(runtime, silentReporter(), [phase]);

    await expect(
      pipeline.run({ cwd, maxIterationsPerPhase: 1, networkAccess: false }),
    ).rejects.toThrow(/Reviewer response is not valid JSON/i);
  });

  it("rejects planner changes outside PRE2PROD_PLAN.md before execution", async () => {
    const cwd = await createInitializedRepo();
    const initialCommits = await countCommits(cwd);
    const runtime = new FakeRuntime(
      cwd,
      [
        "Repository summary",
        JSON.stringify({ blockers: ["Gap A"], non_blockers: [] }),
        "Plan written",
      ],
      { planningExtraFile: "unexpected.txt" },
    );
    const pipeline = new Pre2prodPipeline(runtime, silentReporter(), [phase]);

    await expect(
      pipeline.run({ cwd, maxIterationsPerPhase: 1, networkAccess: false }),
    ).rejects.toThrow(
      /Planning turn modified files other than PRE2PROD_PLAN\.md: unexpected\.txt/,
    );

    expect(runtime.goals).toHaveLength(0);
    expect(await countCommits(cwd)).toBe(initialCommits);
  });

  it("keeps persistent reviewer and exact-turn fork behavior", async () => {
    const cwd = await createInitializedRepo();
    const runtime = new FakeRuntime(cwd, [
      "Repository summary",
      JSON.stringify({ blockers: ["Gap A"], non_blockers: [] }),
      "Plan written",
      "Plan executed",
      JSON.stringify({ blockers: [], non_blockers: [] }),
    ]);
    const pipeline = new Pre2prodPipeline(runtime, silentReporter(), [phase]);

    await pipeline.run({
      cwd,
      maxIterationsPerPhase: 2,
      networkAccess: false,
    });

    expect(runtime.forks).toEqual([
      { threadId: "reviewer", lastTurnId: "turn-2" },
    ]);
  });

  it("does not commit while phase is failing max iterations", async () => {
    const cwd = await createInitializedRepo();
    const initialCommits = await countCommits(cwd);
    const runtime = new FakeRuntime(cwd, [
      "Repository summary",
      JSON.stringify({ blockers: ["Gap 1"], non_blockers: [] }),
      "Plan written",
      "Plan executed",
      JSON.stringify({ blockers: ["Gap 2"], non_blockers: [] }),
    ]);
    const pipeline = new Pre2prodPipeline(runtime, silentReporter(), [phase]);

    await expect(
      pipeline.run({ cwd, maxIterationsPerPhase: 1, networkAccess: false }),
    ).rejects.toBeInstanceOf(PhaseFailedError);
    expect(await countCommits(cwd)).toBe(initialCommits);
  });

  it("commits after successful phase with phase title", async () => {
    const cwd = await createInitializedRepo();
    const runtime = new FakeRuntime(cwd, [
      "Repository summary",
      JSON.stringify({ blockers: ["Gap A"], non_blockers: [] }),
      "Plan written",
      "Plan executed",
      JSON.stringify({ blockers: [], non_blockers: [] }),
    ]);
    const pipeline = new Pre2prodPipeline(runtime, silentReporter(), [phase]);

    await pipeline.run({
      cwd,
      maxIterationsPerPhase: 2,
      networkAccess: false,
    });

    const lastCommitMessage = await readLastCommitMessage(cwd);
    expect(lastCommitMessage).toBe("pre2prod(testing): Testing");
  });

  it("keeps the current branch and changes uncommitted with commit disabled", async () => {
    const cwd = await createInitializedRepo();
    const branch = (await execGit(cwd, ["branch", "--show-current"])).trim();
    const initialCommits = await countCommits(cwd);
    const runtime = new FakeRuntime(cwd, [
      "Repository summary",
      JSON.stringify({ blockers: ["Gap A"], non_blockers: [] }),
      "Plan written",
      "Plan executed",
      JSON.stringify({ blockers: [], non_blockers: [] }),
    ]);
    const pipeline = new Pre2prodPipeline(runtime, silentReporter(), [phase]);

    const result = await pipeline.run({
      cwd,
      maxIterationsPerPhase: 2,
      networkAccess: false,
      commit: false,
    });

    expect(result.gitBranch).toBe(branch);
    expect(await countCommits(cwd)).toBe(initialCommits);
    expect((await execGit(cwd, ["branch", "--show-current"])).trim()).toBe(
      branch,
    );
    expect(await execGit(cwd, ["status", "--porcelain"])).toContain(
      "?? mock-fixed.txt",
    );
  });
});

class FakeRuntime implements AgentRuntime {
  readonly requests: TurnRequest[] = [];
  readonly forks: Array<{ threadId: string; lastTurnId: string }> = [];
  readonly goals: Array<{
    action: "set" | "get" | "clear";
    threadId: string;
    payload: ThreadGoalRequest | undefined;
  }> = [];
  readonly #cwd: string;
  readonly #responses: string[];
  readonly #writePlan: boolean;
  readonly #planningExtraFile: string | undefined;
  readonly #onRunTurn: ((request: TurnRequest) => void) | undefined;
  #turn = 0;
  #worker = 0;
  #goalStorage = new Map<string, ThreadGoal>();

  public constructor(
    cwd: string,
    responses: string[],
    options: {
      writePlan?: boolean;
      planningExtraFile?: string;
      onRunTurn?: (request: TurnRequest) => void;
    } = {},
  ) {
    this.#cwd = cwd;
    this.#responses = [...responses];
    this.#writePlan = options.writePlan ?? true;
    this.#planningExtraFile = options.planningExtraFile;
    this.#onRunTurn = options.onRunTurn;
  }

  public async initialize(): Promise<void> {}

  public async startThread(): Promise<ThreadRef> {
    return { id: "reviewer" };
  }

  public async forkThread(
    threadId: string,
    lastTurnId: string,
  ): Promise<ThreadRef> {
    this.forks.push({ threadId, lastTurnId });
    return { id: `worker-${++this.#worker}` };
  }

  public async runTurn(request: TurnRequest): Promise<TurnResult> {
    this.requests.push(request);
    this.#onRunTurn?.(request);
    const text = this.#responses.shift();
    if (text === undefined) {
      throw new Error("No fake response configured");
    }
    if (
      this.#writePlan &&
      request.prompt.includes(
        "write a complete, minimal, executable remediation plan",
      )
    ) {
      await writeFile(
        resolve(this.#cwd, "PRE2PROD_PLAN.md"),
        "# Test plan\n",
        "utf8",
      );
      if (this.#planningExtraFile) {
        await writeFile(
          resolve(this.#cwd, this.#planningExtraFile),
          "unexpected\n",
          "utf8",
        );
      }
    }
    if (
      request.prompt.includes("read PRE2PROD_PLAN.md and execute it completely")
    ) {
      await writeFile(resolve(this.#cwd, "mock-fixed.txt"), "fixed\n", "utf8");
    }
    return { turnId: `turn-${++this.#turn}`, status: "completed", text };
  }

  public async setThreadGoal(
    threadId: string,
    goal: ThreadGoalRequest,
  ): Promise<ThreadGoal> {
    this.goals.push({ action: "set", threadId, payload: goal });
    const threadGoal: ThreadGoal = {
      threadId,
      objective: goal.objective ?? "objective",
      status: goal.status ?? "active",
      tokenBudget: goal.tokenBudget ?? null,
      tokensUsed: 0,
      timeUsedSeconds: 0,
      createdAt: 0,
      updatedAt: 0,
    };
    this.#goalStorage.set(threadId, threadGoal);
    return threadGoal;
  }

  public async getThreadGoal(threadId: string): Promise<ThreadGoal | null> {
    this.goals.push({ action: "get", threadId, payload: undefined });
    return this.#goalStorage.get(threadId) ?? null;
  }

  public async clearThreadGoal(threadId: string): Promise<boolean> {
    this.goals.push({ action: "clear", threadId, payload: undefined });
    return this.#goalStorage.delete(threadId);
  }

  public async close(): Promise<void> {}
}

function silentReporter(): ProgressReporter {
  return {
    title() {},
    info() {},
    warning() {},
    phaseStarted() {},
    reviewing() {},
    needsWork() {},
    planning() {},
    working() {},
    phasePassed() {},
    command() {},
    thinking() {},
    result() {},
    filesTouched() {},
    waiting() {},
    verbose() {},
    completed() {},
    failed() {},
  };
}

async function createInitializedRepo(): Promise<string> {
  const cwd = await mkdtemp(resolve(tmpdir(), "pre2prod-pipeline-"));
  await createBaseCommit(cwd);
  return cwd;
}

async function execGit(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, { cwd, encoding: "utf8" });
  return result.stdout;
}

async function createBaseCommit(cwd: string): Promise<void> {
  await execGit(cwd, ["init"]);
  await writeFile(resolve(cwd, "base.txt"), "base\n", "utf8");
  await execGit(cwd, ["add", "base.txt"]);
  await execGit(cwd, [
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-m",
    "initial",
  ]);
}

async function countCommits(cwd: string): Promise<number> {
  const count = await execGit(cwd, ["rev-list", "--count", "HEAD"]);
  return Number.parseInt(count.trim(), 10);
}

async function readLastCommitMessage(cwd: string): Promise<string> {
  const value = await execGit(cwd, ["log", "-1", "--pretty=%s"]);
  return value.trim();
}
