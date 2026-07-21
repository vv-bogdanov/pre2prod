import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type {
  AgentRuntime,
  Phase,
  ProgressReporter,
  ThreadRef,
  TurnRequest,
  TurnResult,
} from "../src/core/types.js";
import { PhaseFailedError } from "../src/core/errors.js";
import { Pre2prodPipeline } from "../src/pipeline.js";

const phase: Phase = {
  id: "testing",
  title: "Testing",
  reviewerPrompt: "Review tests.",
};

describe("Pre2prodPipeline", () => {
  it("runs discovery, review, worker plan/execute, and re-review", async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), "pre2prod-pipeline-"));
    const runtime = new FakeRuntime(cwd, [
      "Repository summary",
      '{"status":"NEEDS_WORK","findings":["Missing a critical test"]}',
      "Plan written",
      "Plan executed",
      '{"status":"PASS","findings":[]}',
    ]);

    const pipeline = new Pre2prodPipeline(runtime, silentReporter(), [phase]);
    const result = await pipeline.run({
      cwd,
      model: "mock",
      maxIterationsPerPhase: 2,
      networkAccess: false,
    });

    expect(result.phases).toEqual([{ phase, iterations: 1, passed: true, findings: [] }]);
    expect(runtime.forks).toEqual([{ threadId: "reviewer", lastTurnId: "turn-2" }]);
    expect(runtime.requests.map((request) => request.threadId)).toEqual([
      "reviewer",
      "reviewer",
      "worker-1",
      "worker-1",
      "reviewer",
    ]);
  });

  it("skips worker when a phase passes immediately", async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), "pre2prod-pipeline-"));
    const runtime = new FakeRuntime(cwd, ["Repository summary", '{"status":"PASS","findings":[]}']);
    const pipeline = new Pre2prodPipeline(runtime, silentReporter(), [phase]);

    const result = await pipeline.run({
      cwd,
      maxIterationsPerPhase: 2,
      networkAccess: false,
    });

    expect(result.phases[0]?.iterations).toBe(0);
    expect(runtime.forks).toHaveLength(0);
  });

  it("fails when the planning turn does not create PRE2PROD_PLAN.md", async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), "pre2prod-pipeline-"));
    const runtime = new FakeRuntime(
      cwd,
      [
        "Repository summary",
        '{"status":"NEEDS_WORK","findings":["Missing a critical test"]}',
        "Plan claimed",
      ],
      false,
    );
    const pipeline = new Pre2prodPipeline(runtime, silentReporter(), [phase]);

    await expect(
      pipeline.run({ cwd, maxIterationsPerPhase: 1, networkAccess: false }),
    ).rejects.toThrow(/did not create PRE2PROD_PLAN.md/i);
  });

  it("stops after the iteration limit", async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), "pre2prod-pipeline-"));
    const runtime = new FakeRuntime(cwd, [
      "Repository summary",
      '{"status":"NEEDS_WORK","findings":["Gap 1"]}',
      "Plan written",
      "Plan executed",
      '{"status":"NEEDS_WORK","findings":["Gap 2"]}',
    ]);
    const pipeline = new Pre2prodPipeline(runtime, silentReporter(), [phase]);

    await expect(
      pipeline.run({ cwd, maxIterationsPerPhase: 1, networkAccess: false }),
    ).rejects.toBeInstanceOf(PhaseFailedError);
  });
});

class FakeRuntime implements AgentRuntime {
  readonly requests: TurnRequest[] = [];
  readonly forks: Array<{ threadId: string; lastTurnId: string }> = [];
  readonly #cwd: string;
  readonly #responses: string[];
  readonly #writePlan: boolean;
  #turn = 0;
  #worker = 0;

  public constructor(cwd: string, responses: string[], writePlan = true) {
    this.#cwd = cwd;
    this.#responses = [...responses];
    this.#writePlan = writePlan;
  }

  public async initialize(): Promise<void> {}

  public async startThread(): Promise<ThreadRef> {
    return { id: "reviewer" };
  }

  public async forkThread(threadId: string, lastTurnId: string): Promise<ThreadRef> {
    this.forks.push({ threadId, lastTurnId });
    return { id: `worker-${++this.#worker}` };
  }

  public async runTurn(request: TurnRequest): Promise<TurnResult> {
    this.requests.push(request);
    const text = this.#responses.shift();
    if (text === undefined) {
      throw new Error("No fake response configured");
    }
    if (
      this.#writePlan &&
      request.prompt.includes("write a complete, minimal, executable remediation plan")
    ) {
      await writeFile(resolve(this.#cwd, "PRE2PROD_PLAN.md"), "# Test plan\n", "utf8");
    }
    return { turnId: `turn-${++this.#turn}`, status: "completed", text };
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
    verbose() {},
    completed() {},
    failed() {},
  };
}
