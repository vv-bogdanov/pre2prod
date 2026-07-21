import { execFile } from "node:child_process";
import {
  access,
  mkdtemp,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { AppServerRuntime } from "../src/app-server/runtime.js";
import { ProtocolError } from "../src/core/errors.js";
import type { Phase, ProgressReporter } from "../src/core/types.js";
import { FileRunLogger } from "../src/logging.js";
import { Pre2prodPipeline } from "../src/pipeline.js";

const execFileAsync = promisify(execFile);

const here = dirname(fileURLToPath(import.meta.url));
const mockServer = resolve(here, "fixtures/mock-app-server.mjs");
const phase: Phase = {
  id: "mock-readiness",
  title: "Mock readiness",
  reviewerPrompt: "Require mock-fixed.txt to exist.",
};

const malformedGoalCalls: ReadonlyArray<
  [string, (runtime: AppServerRuntime) => Promise<unknown>]
> = [
  [
    "thread/goal/set",
    (runtime) =>
      runtime.setThreadGoal("thread-1", {
        objective: "Work",
        status: "active",
      }),
  ],
  ["thread/goal/get", (runtime) => runtime.getThreadGoal("thread-1")],
  ["thread/goal/clear", (runtime) => runtime.clearThreadGoal("thread-1")],
];

describe("Pre2prodPipeline with App Server transport", () => {
  it.each(["failed", "interrupted"])(
    "rejects a terminal %s turn and cleans up its collector",
    async (status) => {
      const cwd = await mkdtemp(resolve(tmpdir(), "pre2prod-terminal-turn-"));
      const runtime = new AppServerRuntime({
        command: process.execPath,
        args: [mockServer],
        cwd,
        env: { ...process.env, MOCK_TURN_STATUS: status },
      });

      try {
        await runtime.initialize();
        const thread = await runtime.startThread({ cwd });
        await expect(
          runtime.runTurn({
            threadId: thread.id,
            prompt: "terminal turn",
            cwd,
            sandbox: "read-only",
          }),
        ).rejects.toThrow(`mock ${status} turn`);

        await expect(
          runtime.runTurn({
            threadId: thread.id,
            prompt: "normal turn",
            cwd,
            sandbox: "read-only",
          }),
        ).resolves.toMatchObject({
          status: "completed",
          text: "Repository studied.",
        });
      } finally {
        await runtime.close();
      }
    },
  );

  it("times out a turn with no terminal event and cleans up its collector", async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), "pre2prod-turn-timeout-"));
    const runtime = new AppServerRuntime({
      command: process.execPath,
      args: [mockServer],
      cwd,
      env: { ...process.env, MOCK_HANG_TURN: "1" },
      turnTimeoutMs: 20,
    });

    try {
      await runtime.initialize();
      const thread = await runtime.startThread({ cwd });
      await expect(
        runtime.runTurn({
          threadId: thread.id,
          prompt: "hang turn",
          cwd,
          sandbox: "read-only",
        }),
      ).rejects.toThrow(/turn .* timed out after 20ms/i);
    } finally {
      await runtime.close();
    }
  });

  it("rejects an active turn when runtime close is called repeatedly", async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), "pre2prod-runtime-close-"));
    const turnStartedFile = resolve(cwd, "turn-started");
    const runtime = new AppServerRuntime({
      command: process.execPath,
      args: [mockServer],
      cwd,
      env: {
        ...process.env,
        MOCK_HANG_TURN: "1",
        MOCK_TURN_STARTED_FILE: turnStartedFile,
      },
      turnTimeoutMs: 10_000,
    });

    try {
      await runtime.initialize();
      const thread = await runtime.startThread({ cwd });
      const pending = runtime.runTurn({
        threadId: thread.id,
        prompt: "hang turn",
        cwd,
        sandbox: "read-only",
      });
      await waitForFile(turnStartedFile);
      const firstClose = runtime.close();
      const secondClose = runtime.close();

      await expect(pending).rejects.toThrow(/runtime closed/i);
      expect(secondClose).toBe(firstClose);
      await Promise.all([firstClose, secondClose]);
    } finally {
      await runtime.close();
    }
  });

  it("completes worker execution when the goal finishes before turn completion", async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), "pre2prod-e2e-"));
    await initBaseRepository(cwd);

    const runtime = new AppServerRuntime({
      command: process.execPath,
      args: [mockServer],
      cwd,
      model: "mock-model",
    });
    const pipeline = new Pre2prodPipeline(runtime, silentReporter(), [phase]);

    const result = await pipeline.run({
      cwd,
      model: "mock-model",
      maxIterationsPerPhase: 2,
      networkAccess: false,
    });

    expect(result.phases).toEqual([
      { phase, iterations: 1, passed: true, findings: [] },
    ]);
    const [archivedPlan] = await readdir(resolve(cwd, ".pre2prod", "plans"));
    if (!archivedPlan) {
      throw new Error("Expected archived Worker plan");
    }
    expect(
      await readFile(resolve(cwd, ".pre2prod", "plans", archivedPlan), "utf8"),
    ).toContain("# Plan");
    expect(await readFile(resolve(cwd, "mock-fixed.txt"), "utf8")).toBe(
      "fixed\n",
    );
  });

  it("logs the effective network policy for each turn sandbox", async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), "pre2prod-network-log-"));
    const logger = new FileRunLogger({
      cwd,
      runId: "network-policy-test",
    });
    const runtime = new AppServerRuntime({
      command: process.execPath,
      args: [mockServer],
      cwd,
      logger,
    });

    try {
      await runtime.initialize();
      const thread = await runtime.startThread({ cwd });
      await runtime.runTurn({
        threadId: thread.id,
        prompt: "read-only turn",
        cwd,
        sandbox: "read-only",
      });
      await runtime.runTurn({
        threadId: thread.id,
        prompt: "workspace turn without explicit network setting",
        cwd,
        sandbox: "workspace-write",
      });
      await runtime.runTurn({
        threadId: thread.id,
        prompt: "workspace turn with network disabled",
        cwd,
        sandbox: "workspace-write",
        networkAccess: false,
      });
    } finally {
      await runtime.close();
    }

    const events = await readJsonRecords(FileRunLogger.paths(cwd).full);
    expect(
      events
        .filter((event) => event.event === "runtime.turn.started")
        .map((event) => event.networkAccess),
    ).toEqual([false, true, false]);
  });

  it("rejects malformed thread/start results", async () => {
    const runtime = malformedResultRuntime("thread/start");
    await runtime.initialize();
    try {
      await expectInvalidResponse(
        runtime.startThread({ cwd: process.cwd() }),
        "thread/start",
      );
    } finally {
      await runtime.close();
    }
  });

  it("rejects malformed thread/fork results", async () => {
    const runtime = malformedResultRuntime("thread/fork");
    await runtime.initialize();
    try {
      await expectInvalidResponse(
        runtime.forkThread("thread-1", "turn-1"),
        "thread/fork",
      );
    } finally {
      await runtime.close();
    }
  });

  it("rejects malformed turn/start results", async () => {
    const runtime = malformedResultRuntime("turn/start");
    await runtime.initialize();
    try {
      await expectInvalidResponse(
        runtime.runTurn({
          threadId: "thread-1",
          prompt: "Review the repository.",
          cwd: process.cwd(),
          sandbox: "read-only",
        }),
        "turn/start",
      );
    } finally {
      await runtime.close();
    }
  });

  it.each(malformedGoalCalls)(
    "rejects malformed %s results",
    async (method, call) => {
      const runtime = malformedResultRuntime(method);
      await runtime.initialize();
      try {
        await expectInvalidResponse(call(runtime), method);
      } finally {
        await runtime.close();
      }
    },
  );
});

function malformedResultRuntime(method: string): AppServerRuntime {
  return new AppServerRuntime({
    command: process.execPath,
    args: [mockServer],
    env: { ...process.env, MOCK_MALFORMED_RESULT: method },
  });
}

async function expectInvalidResponse(
  promise: Promise<unknown>,
  method: string,
): Promise<void> {
  try {
    await promise;
    throw new Error(`Expected ${method} to reject`);
  } catch (error) {
    expect(error).toBeInstanceOf(ProtocolError);
    expect(error).toMatchObject({
      message: `Invalid result from App Server method "${method}"`,
    });
  }
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

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      await access(path);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}

async function initBaseRepository(cwd: string): Promise<void> {
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

async function readJsonRecords(
  path: string,
): Promise<Record<string, unknown>[]> {
  const content = (await readFile(path, "utf8")).trim();
  if (!content) {
    return [];
  }
  return content
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function execGit(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, { cwd, encoding: "utf8" });
  return result.stdout;
}
