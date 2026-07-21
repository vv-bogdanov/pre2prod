import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { AppServerRuntime } from "../src/app-server/runtime.js";
import type { Phase, ProgressReporter } from "../src/core/types.js";
import { Pre2prodPipeline } from "../src/pipeline.js";

const here = dirname(fileURLToPath(import.meta.url));
const mockServer = resolve(here, "fixtures/mock-app-server.mjs");
const phase: Phase = {
  id: "mock-readiness",
  title: "Mock readiness",
  reviewerPrompt: "Require mock-fixed.txt to exist.",
};

describe("Pre2prodPipeline with App Server transport", () => {
  it("completes the full reviewer-worker-re-review loop over JSONL", async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), "pre2prod-e2e-"));
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
