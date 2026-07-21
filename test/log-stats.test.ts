import { describe, expect, it } from "vitest";

import { buildLogStats } from "../src/log-stats.js";

describe("buildLogStats", () => {
  it("summarizes run, review, blocker, and worker outcomes", () => {
    const lines = [
      event("pipeline.run.started"),
      event("pipeline.phase.started", {
        phaseId: "security-auth",
        phaseTitle: "Security: Authentication",
      }),
      event("phase.review.completed", {
        phaseId: "security-auth",
        phaseTitle: "Security: Authentication",
        blockersCount: 2,
        nonBlockersCount: 4,
      }),
      event("phase.worker.forked", {
        phaseId: "security-auth",
        phaseTitle: "Security: Authentication",
      }),
      event("phase.review.completed", {
        phaseId: "security-auth",
        phaseTitle: "Security: Authentication",
        blockersCount: 0,
      }),
      event("phase.review.passed", {
        phaseId: "security-auth",
        phaseTitle: "Security: Authentication",
      }),
      event("pipeline.run.completed"),
      "not json",
    ];

    expect(buildLogStats(lines)).toEqual({
      runs: { total: 1, completed: 1, failed: 0, incomplete: 0 },
      totals: { reviews: 2, blockers: 2, workerIterations: 1 },
      phases: [
        {
          id: "security-auth",
          title: "Security: Authentication",
          runs: 1,
          passed: 1,
          blocked: 0,
          incomplete: 0,
          reviews: 2,
          blockers: 2,
          workerIterations: 1,
        },
      ],
    });
  });

  it("filters by run and phase without exposing non-blocker content", () => {
    const lines = [
      event("pipeline.run.started", {}, "run-a"),
      event(
        "phase.review.completed",
        {
          phaseId: "architecture-boundaries",
          phaseTitle: "Architecture: Boundaries",
          blockersCount: 1,
          non_blockers: ["informational"],
        },
        "run-a",
      ),
      event("pipeline.run.failed", {}, "run-a"),
      event("pipeline.run.started", {}, "run-b"),
      event(
        "phase.review.completed",
        {
          phaseId: "security-auth",
          phaseTitle: "Security: Authentication",
          blockersCount: 3,
        },
        "run-b",
      ),
    ];

    const stats = buildLogStats(lines, {
      runId: "run-a",
      phaseId: "architecture",
    });

    expect(stats.runs).toEqual({
      total: 1,
      completed: 0,
      failed: 1,
      incomplete: 0,
    });
    expect(stats.totals).toEqual({
      reviews: 1,
      blockers: 1,
      workerIterations: 0,
    });
    expect(JSON.stringify(stats)).not.toContain("informational");
  });
});

function event(
  name: string,
  details: Record<string, unknown> = {},
  runId = "run-1",
): string {
  return JSON.stringify({ event: name, runId, ...details });
}
