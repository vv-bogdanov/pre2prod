import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { AppServerRuntime } from "../src/app-server/runtime.js";
import { REVIEW_OUTPUT_SCHEMA } from "../src/reviewer.js";

const here = dirname(fileURLToPath(import.meta.url));
const mockServer = resolve(here, "fixtures/mock-app-server.mjs");

describe("AppServerRuntime", () => {
  it("starts, forks, and runs read/write turns", async () => {
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
      const review = await runtime.runTurn({
        threadId: reviewer.id,
        prompt: "review",
        cwd,
        sandbox: "readOnly",
        outputSchema: REVIEW_OUTPUT_SCHEMA,
      });
      expect(review.text).toContain('"NEEDS_WORK"');

      const worker = await runtime.forkThread(reviewer.id, review.turnId);
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

      expect(await readFile(resolve(cwd, "PRE2PROD_PLAN.md"), "utf8")).toContain("# Plan");
      expect(await readFile(resolve(cwd, "mock-fixed.txt"), "utf8")).toBe("fixed\n");
    } finally {
      await runtime.close();
    }
  });
});
