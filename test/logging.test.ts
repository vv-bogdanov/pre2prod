import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { FileRunLogger, MAX_LOG_BYTES, createRunId } from "../src/logging.js";

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
    const summaryLines = (await readFile(paths.summary, "utf8"))
      .trim()
      .split("\n");
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

  it("redacts sensitive fields and inline credentials", async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), "pre2prod-logs-"));
    const logger = new FileRunLogger({
      cwd,
      runId: createRunId(new Date("2026-07-21T12:00:02.000Z")),
    });

    logger.log("info", "runtime.command", {
      command: String.raw`curl --header "Authorization: Bearer live-token" --password "p@ss" OPENAI_API_KEY="escaped\"secret"`,
      credentials: { apiKey: "key-value" },
      environment: {
        OPENAI_API_KEY: "openai-secret",
        AWS_SECRET_ACCESS_KEY: "aws-secret",
        DATABASE_PASSWORD: "database-secret",
      },
      message: "token=inline-token",
      safe: "keep-me",
    });

    const [event] = await readJsonRecords(FileRunLogger.paths(cwd).full);
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("live-token");
    expect(serialized).not.toContain("p@ss");
    expect(serialized).not.toContain("key-value");
    expect(serialized).not.toContain("inline-token");
    expect(serialized).not.toContain('escaped\\"secret');
    expect(serialized).not.toContain("openai-secret");
    expect(serialized).not.toContain("aws-secret");
    expect(serialized).not.toContain("database-secret");
    expect(serialized).toContain("[REDACTED]");
    expect(event?.safe).toBe("keep-me");
  });

  it("warns once per file and continues when writes fail", async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), "pre2prod-logs-"));
    const warnings: string[] = [];
    const logger = new FileRunLogger({
      cwd,
      runId: createRunId(new Date("2026-07-21T12:00:03.000Z")),
      onWriteError: (message) => warnings.push(message),
    });
    const paths = FileRunLogger.paths(cwd);
    await mkdir(paths.full);
    await mkdir(paths.summary);

    logger.log("info", "pipeline.run.started", {}, { summary: true });
    logger.log("info", "pipeline.run.completed", {}, { summary: true });

    expect(warnings).toHaveLength(2);
    expect(warnings.join(" ")).toContain("continuing");
  });

  it("keeps both logs bounded at complete JSONL records", async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), "pre2prod-logs-"));
    const logger = new FileRunLogger({
      cwd,
      runId: createRunId(new Date("2026-07-21T12:00:04.000Z")),
    });
    const paths = FileRunLogger.paths(cwd);
    const oldLine = `${JSON.stringify({ event: "old", value: "x".repeat(100_000) })}\n`;
    const oldContent = oldLine.repeat(
      Math.ceil(MAX_LOG_BYTES / Buffer.byteLength(oldLine, "utf8")) + 1,
    );
    await writeFile(paths.full, oldContent, "utf8");
    await writeFile(paths.summary, oldContent, "utf8");

    logger.log(
      "info",
      "pipeline.run.started",
      { value: "latest" },
      { summary: true },
    );

    for (const path of [paths.full, paths.summary]) {
      expect((await stat(path)).size).toBeLessThanOrEqual(MAX_LOG_BYTES);
      const records = await readJsonRecords(path);
      expect(records.at(-1)?.event).toBe("pipeline.run.started");
    }
  });
});

async function readJsonRecords(
  path: string,
): Promise<Record<string, unknown>[]> {
  const content = (await readFile(path, "utf8")).trim();
  if (!content) {
    return [];
  }
  return content.split("\n").map((line) => {
    const parsed: unknown = JSON.parse(line);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      return parsed as Record<string, unknown>;
    }
    throw new Error("Expected a JSON object log record");
  });
}
