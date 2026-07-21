import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { AppServerRuntime } from "../src/app-server/runtime.js";
import type { Phase, ProgressReporter } from "../src/core/types.js";
import { Pre2prodPipeline } from "../src/pipeline.js";

const here = dirname(fileURLToPath(import.meta.url));
const mockServer = resolve(here, "fixtures/mock-app-server.mjs");
const execFileAsync = promisify(execFile);
const phase: Phase = {
  id: "mock-readiness",
  title: "Mock readiness",
  reviewerPrompt: "Require mock-fixed.txt to exist.",
};

describe("Pre2prodPipeline with App Server transport", () => {
  it("completes the full reviewer-worker-re-review loop over JSONL", async () => {
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
    await expect(
      readFile(resolve(cwd, "PRE2PROD_PLAN.md"), "utf8"),
    ).rejects.toThrow();
    const archivedPlans = await readdir(resolve(cwd, ".pre2prod", "plans"));
    expect(archivedPlans).toHaveLength(1);
    const [archivedPlan] = archivedPlans;
    if (!archivedPlan) {
      throw new Error("Expected archived Worker plan");
    }
    expect(
      await readFile(resolve(cwd, ".pre2prod", "plans", archivedPlan), "utf8"),
    ).toContain("# Plan");
    expect(await readFile(resolve(cwd, "mock-fixed.txt"), "utf8")).toBe(
      "fixed\n",
    );
    expect(await execGit(cwd, ["status", "--porcelain"])).toBe("");

    const secondRuntime = new AppServerRuntime({
      command: process.execPath,
      args: [mockServer],
      cwd,
      model: "mock-model",
    });
    const secondPipeline = new Pre2prodPipeline(
      secondRuntime,
      silentReporter(),
      [phase],
    );
    await expect(
      secondPipeline.run({
        cwd,
        model: "mock-model",
        maxIterationsPerPhase: 2,
        networkAccess: false,
      }),
    ).resolves.toMatchObject({ phases: [{ passed: true }] });
  });

  it("forwards live App Server activity and errors to the reporter", async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), "pre2prod-runtime-"));
    const thinking: string[] = [];
    const results: string[] = [];
    const commands: Array<{ command: string; status: string | undefined }> = [];
    const warnings: string[] = [];
    const reporter = silentReporter();
    reporter.thinking = (message) => thinking.push(message);
    reporter.result = (message) => results.push(message);
    reporter.command = (command, status) => commands.push({ command, status });
    reporter.warning = (message) => warnings.push(message);
    const runtime = new AppServerRuntime({
      command: process.execPath,
      args: [mockServer],
      cwd,
      reporter,
    });

    try {
      await runtime.initialize();
      const thread = await runtime.startThread({ cwd });
      await runtime.runTurn({
        threadId: thread.id,
        prompt: "emit observability",
        cwd,
        sandbox: "read-only",
      });
    } finally {
      await runtime.close();
    }

    expect(thinking).toEqual(["Inspecting the repository."]);
    expect(results).toEqual(["Repository reviewed."]);
    expect(commands).toContainEqual({
      command: "git status --short",
      status: "running",
    });
    expect(warnings).toContain(
      "App Server error (retrying): temporary mock error",
    );
  });

  it("passes the local provider when starting a thread", async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), "pre2prod-provider-"));
    const runtime = new AppServerRuntime({
      command: process.execPath,
      args: [mockServer],
      cwd,
      modelProvider: "ollama",
      env: { ...process.env, MOCK_EXPECT_MODEL_PROVIDER: "ollama" },
    });

    try {
      await runtime.initialize();
      await runtime.startThread({ cwd });
    } finally {
      await runtime.close();
    }
  });
});

async function initBaseRepository(cwd: string): Promise<void> {
  await execGit(cwd, ["init"]);
  await writeFile(resolve(cwd, "base.txt"), "base\n", "utf8");
  await writeFile(resolve(cwd, ".gitignore"), ".pre2prod/\n", "utf8");
  await execGit(cwd, ["add", "base.txt", ".gitignore"]);
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

async function execGit(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, { cwd, encoding: "utf8" });
  return result.stdout;
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
