import { mkdtemp } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { FileRunLogger, createRunId } from "../src/logging.js";

interface JsonEvent {
  event: string;
  contextTag?: string;
}

function parseJsonLine(line: string): JsonEvent {
  const parsed: unknown = JSON.parse(line);
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "event" in parsed &&
    typeof parsed.event === "string"
  ) {
    const parsedRecord = parsed as Record<string, unknown>;
    const event: JsonEvent = { event: parsedRecord.event as string };
    if (typeof parsedRecord.contextTag === "string") {
      event.contextTag = parsedRecord.contextTag;
    }
    return event;
  }

  throw new Error("Unexpected log line format");
}

describe("FileRunLogger", () => {
  it("writes full and summary JSONL files", async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), "pre2prod-logs-"));
    const runId = createRunId(new Date("2026-07-21T12:00:00.000Z"));
    const logger = new FileRunLogger({ cwd, runId });

    logger.log("info", "pipeline.run.started", {
      runId,
      phaseId: "foundation-immediate-risk-triage",
      phaseIndex: 1,
      phaseTotal: 3,
      phaseIteration: 1,
      threadRole: "reviewer",
      phaseTurn: "review",
    });
    logger.log("debug", "runtime.command", {
      command: "pnpm test",
    });

    const paths = FileRunLogger.paths(cwd);
    const summaryLines = (await readFile(paths.summary, "utf8")).trim().split("\n");
    const fullLines = (await readFile(paths.full, "utf8")).trim().split("\n");

    expect(summaryLines).toHaveLength(1);
    expect(fullLines).toHaveLength(2);

    const summaryEvent = parseJsonLine(summaryLines[0] ?? "");
    const fullStart = parseJsonLine(fullLines[0] ?? "");
    const fullCommand = parseJsonLine(fullLines[1] ?? "");
    expect(summaryEvent.event).toBe("pipeline.run.started");
    expect(fullCommand.event).toBe("runtime.command");
    expect(fullStart.contextTag).toContain(
      "p=1/3:foundation-immediate-risk-triage",
    );
    expect(fullStart.contextTag).toContain("i=1");
    expect(fullStart.contextTag).toContain("t=reviewer/review");
  });

  it("appends to logs instead of replacing", async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), "pre2prod-logs-"));
    const runId = createRunId(new Date("2026-07-21T12:00:01.000Z"));
    const logger = new FileRunLogger({ cwd, runId });

    logger.log("info", "pipeline.phase.started", {
      phaseId: "security",
      phaseIndex: 1,
      phaseTotal: 1,
      phaseIteration: 1,
      threadRole: "worker",
      phaseTurn: "planning",
    });
    logger.log("info", "pipeline.phase.completed", {
      phaseId: "security",
      phaseIndex: 1,
      phaseTotal: 1,
      phaseIteration: 1,
      threadRole: "worker",
      phaseTurn: "execution",
    });

    const lines = (await readFile(FileRunLogger.paths(cwd).full, "utf8"))
      .trim()
      .split("\n");
    expect(lines).toHaveLength(2);
  });
});
