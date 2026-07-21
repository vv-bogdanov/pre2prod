import { appendFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface RunLogEvent {
  level: LogLevel;
  event: string;
  runId: string;
  at: string;
  [key: string]: unknown;
}

export interface RunLogger {
  runId: string;
  log(
    level: LogLevel,
    event: string,
    details?: Record<string, unknown>,
    options?: { summary?: boolean },
  ): void;
}

export interface LoggerOptions {
  cwd: string;
  runId: string;
  logDir?: string;
}

export interface LoggerFilePaths {
  full: string;
  summary: string;
}

const DEFAULT_LOG_DIR = ".pre2prod/logs";
const DEFAULT_FULL_LOG_FILE = "pre2prod-events.jsonl";
const DEFAULT_SUMMARY_FILE = "pre2prod-summary.jsonl";

const SUMMARY_EVENTS = new Set<string>([
  "pipeline.run.started",
  "pipeline.run.completed",
  "pipeline.run.failed",
  "pipeline.phase.started",
  "phase.review.passed",
  "phase.review.blockers",
  "phase.review.failed",
  "phase.worker.started",
  "phase.worker.completed",
  "phase.review.retry",
  "phase.summary",
]);

export class NoopRunLogger implements RunLogger {
  public constructor(public readonly runId: string) {}

  public log(): void {
    return;
  }
}

export class FileRunLogger implements RunLogger {
  readonly #fullLogPath: string;
  readonly #summaryPath: string;

  public readonly runId: string;

  public constructor(options: LoggerOptions) {
    this.runId = options.runId;
    const logDir = resolve(options.cwd, options.logDir ?? DEFAULT_LOG_DIR);
    this.#fullLogPath = resolve(logDir, DEFAULT_FULL_LOG_FILE);
    this.#summaryPath = resolve(logDir, DEFAULT_SUMMARY_FILE);
    mkdirSync(logDir, { recursive: true });
  }

  public log(
    level: LogLevel,
    event: string,
    details: Record<string, unknown> = {},
    options: { summary?: boolean } = {},
  ): void {
    const enrichedDetails: Record<string, unknown> = {
      ...details,
      runId: this.runId,
    };
    const contextTag = buildContextTag(enrichedDetails);
    const payload: RunLogEvent = {
      level,
      event,
      runId: this.runId,
      at: new Date().toISOString(),
      ...enrichedDetails,
      ...(contextTag ? { contextTag } : {}),
    };

    this.#append(this.#fullLogPath, payload);

    if (options.summary || SUMMARY_EVENTS.has(event)) {
      this.#append(this.#summaryPath, payload);
    }
  }

  #append(filePath: string, data: Record<string, unknown>): void {
    const line = `${JSON.stringify(data)}\n`;
    try {
      appendFileSync(filePath, line, "utf8");
    } catch {
      // Logging should never block pipeline execution.
    }
  }

  public static paths(cwd: string, logDir = DEFAULT_LOG_DIR): LoggerFilePaths {
    const resolved = resolve(cwd, logDir);
    return {
      full: resolve(resolved, DEFAULT_FULL_LOG_FILE),
      summary: resolve(resolved, DEFAULT_SUMMARY_FILE),
    };
  }
}

export function createRunId(date: Date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

export function buildContextTag(details: Record<string, unknown>): string | undefined {
  const runId =
    typeof details.runId === "string" && details.runId.trim().length > 0
      ? details.runId
      : undefined;
  const phaseId =
    typeof details.phaseId === "string" && details.phaseId.trim().length > 0
      ? details.phaseId
      : undefined;
  const phaseIndex = normalizeInteger(details.phaseIndex);
  const phaseTotal = normalizeInteger(details.phaseTotal);
  const phaseIteration = normalizeInteger(details.phaseIteration);
  const threadRole =
    typeof details.threadRole === "string" && details.threadRole.trim().length > 0
      ? details.threadRole
      : undefined;
  const phaseTurn =
    typeof details.phaseTurn === "string" && details.phaseTurn.trim().length > 0
      ? details.phaseTurn
      : undefined;
  const isRepeat =
    typeof details.isRepeat === "boolean" ? details.isRepeat : undefined;

  const parts: string[] = [];
  if (runId) {
    parts.push(`r=${runId}`);
  }
  if (phaseId) {
    if (phaseIndex !== undefined && phaseTotal !== undefined) {
      parts.push(`p=${phaseIndex}/${phaseTotal}:${phaseId}`);
    } else {
      parts.push(`phase=${phaseId}`);
    }
  }
  if (phaseIteration !== undefined) {
    parts.push(`i=${phaseIteration}`);
  }
  if (threadRole !== undefined && phaseTurn !== undefined) {
    parts.push(`t=${threadRole}/${phaseTurn}`);
  }
  if (isRepeat) {
    parts.push("repeat");
  }

  if (parts.length === 0) {
    return undefined;
  }

  return parts.join("|");
}

function normalizeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value)
    ? value
    : undefined;
}
