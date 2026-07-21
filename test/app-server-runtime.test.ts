import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { AppServerRuntime } from "../src/app-server/runtime.js";
import { REVIEW_RESULT_SCHEMA } from "../src/reviewer.js";

const here = dirname(fileURLToPath(import.meta.url));
const mockServer = resolve(here, "fixtures/mock-app-server.mjs");

describe("AppServerRuntime", () => {
  it("supports thread lifecycle, turns, and goal operations", async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), "pre2prod-runtime-"));
    const runtime = new AppServerRuntime({
      command: process.execPath,
      args: [mockServer],
      cwd,
      model: "mock-model",
    });

    await runtime.initialize();
    try {
      const reviewer = await runtime.startThread({ cwd });
      const reviewGoal = await runtime.setThreadGoal(reviewer.id, {
        objective: "initial review",
        status: "active",
      });
      expect(reviewGoal.threadId).toBe(reviewer.id);
      expect(reviewGoal.objective).toBe("initial review");

      const fetchedReviewGoal = await runtime.getThreadGoal(reviewer.id);
      expect(fetchedReviewGoal).toEqual(reviewGoal);

      const review = await runtime.runTurn({
        threadId: reviewer.id,
        prompt: "review",
        cwd,
        sandbox: "readOnly",
        outputSchema: REVIEW_RESULT_SCHEMA,
      });
      expect(review.text).toContain('"blockers"');

      const worker = await runtime.forkThread(reviewer.id, review.turnId);
      const planGoal = await runtime.setThreadGoal(worker.id, {
        objective: "plan",
        status: "active",
      });
      expect(planGoal.threadId).toBe(worker.id);
      expect(await runtime.getThreadGoal(worker.id)).toEqual(planGoal);

      await runtime.runTurn({
        threadId: worker.id,
        prompt: "write a complete, minimal, executable remediation plan",
        cwd,
        sandbox: "workspaceWrite",
      });
      await runtime.runTurn({
        threadId: worker.id,
        prompt: "read PRE2PROD_PLAN.md and execute it completely",
        cwd,
        sandbox: "workspaceWrite",
      });
      expect(await runtime.clearThreadGoal(worker.id)).toBe(true);

      expect(
        await readFile(resolve(cwd, "PRE2PROD_PLAN.md"), "utf8"),
      ).toContain("# Plan");
      expect(await readFile(resolve(cwd, "mock-fixed.txt"), "utf8")).toBe(
        "fixed\n",
      );
      expect(await runtime.clearThreadGoal(reviewer.id)).toBe(true);
    } finally {
      await runtime.close();
    }
  });
});
