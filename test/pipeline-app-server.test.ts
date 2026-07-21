import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
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

    expect(result.phases).toEqual([{ phase, iterations: 1, passed: true, findings: [] }]);
    expect(await readFile(resolve(cwd, "PRE2PROD_PLAN.md"), "utf8")).toContain("# Plan");
    expect(await readFile(resolve(cwd, "mock-fixed.txt"), "utf8")).toBe("fixed\n");
  });
});

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
    filesTouched() {},
    waiting() {},
    verbose() {},
    completed() {},
    failed() {},
  };
}
