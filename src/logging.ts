import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, resolve } from "node:path";

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
  onWriteError?: (message: string) => void;
}

export interface LoggerFilePaths {
  full: string;
  summary: string;
}

const DEFAULT_LOG_DIR = ".pre2prod/logs";
const DEFAULT_FULL_LOG_FILE = "pre2prod-events.jsonl";
const DEFAULT_SUMMARY_FILE = "pre2prod-summary.jsonl";
export const MAX_LOG_BYTES = 10 * 1024 * 1024;
const REDACTED = "[REDACTED]";
const SENSITIVE_KEYS = new Set([
  "apikey",
  "apisecret",
  "apitoken",
  "accesstoken",
  "accesskey",
  "auth",
  "authtoken",
  "authorization",
  "bearertoken",
  "clientsecret",
  "cookie",
  "credentials",
  "credential",
  "idtoken",
  "jwt",
  "password",
  "passphrase",
  "privatekey",
  "proxyauthorization",
  "refreshtoken",
  "secret",
  "secretaccesskey",
  "secretkey",
  "sessiontoken",
  "setcookie",
  "signingkey",
  "token",
  "xapikey",
]);

const PRIVATE_KEY_PATTERN =
  /-----BEGIN [^-]+-----[\s\S]*?(?:-----END [^-]+-----|$)/g;
const BEARER_PATTERN = /(\bbearer\s+)[^\s,;&]+/gi;
const ASSIGNMENT_PATTERN =
  /(["']?(?:[A-Za-z0-9]+[-_])*(?:access[-_]?key|access[-_]?token|api[-_]?key|api[-_]?secret|api[-_]?token|auth[-_]?token|authorization|bearer[-_]?token|client[-_]?secret|cookie|id[-_]?token|jwt|passphrase|password|private[-_]?key|proxy[-_]?authorization|refresh[-_]?token|secret[-_]?access[-_]?key|secret[-_]?key|secret|session[-_]?token|set-cookie|signing[-_]?key|token)\b["']?\s*[:=]\s*)(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|[^\s,;&]+)/gi;
const FLAG_PATTERN =
  /(--(?:access[-_]?key|access[-_]?token|api[-_]?key|api[-_]?secret|api[-_]?token|auth[-_]?token|client[-_]?secret|cookie|id[-_]?token|jwt|passphrase|password|secret[-_]?key|secret|session[-_]?token|signing[-_]?key|token)(?:=|\s+))(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s]+)/gi;

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
  readonly #onWriteError: ((message: string) => void) | undefined;
  readonly #reportedWriteFailures = new Set<string>();

  public readonly runId: string;

  public constructor(options: LoggerOptions) {
    this.runId = options.runId;
    const logDir = resolve(options.cwd, options.logDir ?? DEFAULT_LOG_DIR);
    this.#fullLogPath = resolve(logDir, DEFAULT_FULL_LOG_FILE);
    this.#summaryPath = resolve(logDir, DEFAULT_SUMMARY_FILE);
    this.#onWriteError = options.onWriteError;
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
    const safeDetails = sanitizeRecord(enrichedDetails);
    const contextTag = buildContextTag(safeDetails);
    const payload: RunLogEvent = {
      level,
      event,
      runId: this.runId,
      at: new Date().toISOString(),
      ...safeDetails,
      ...(contextTag ? { contextTag } : {}),
    };

    this.#append(this.#fullLogPath, payload);

    if (options.summary || SUMMARY_EVENTS.has(event)) {
      this.#append(this.#summaryPath, payload);
    }
  }

  #append(filePath: string, data: Record<string, unknown>): void {
    try {
      const line = `${JSON.stringify(data)}\n`;
      appendWithinLimit(filePath, line);
    } catch {
      this.#reportWriteFailure(filePath);
    }
  }

  #reportWriteFailure(filePath: string): void {
    if (this.#reportedWriteFailures.has(filePath)) {
      return;
    }
    this.#reportedWriteFailures.add(filePath);

    const message = `Unable to write observability log ${basename(filePath)}; continuing without persisted diagnostics.`;
    try {
      if (this.#onWriteError) {
        this.#onWriteError(message);
      } else {
        console.error(`[pre2prod] WARNING · ${message}`);
      }
    } catch {
      // Warning output must not block pipeline execution.
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

export function redactSensitiveText(value: string): string {
  return value
    .replace(PRIVATE_KEY_PATTERN, REDACTED)
    .replace(BEARER_PATTERN, `$1${REDACTED}`)
    .replace(ASSIGNMENT_PATTERN, redactAssignment)
    .replace(FLAG_PATTERN, `$1${REDACTED}`);
}

function redactAssignment(
  _match: string,
  prefix: string,
  doubleQuoted: string | undefined,
  singleQuoted: string | undefined,
): string {
  const replacement =
    doubleQuoted !== undefined
      ? `"${REDACTED}"`
      : singleQuoted !== undefined
        ? `'${REDACTED}'`
        : REDACTED;
  return `${prefix}${replacement}`;
}

function sanitizeRecord(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized = sanitizeValue(value, undefined, new WeakSet<object>());
  return isRecord(sanitized) ? sanitized : {};
}

function sanitizeValue(
  value: unknown,
  key: string | undefined,
  seen: WeakSet<object>,
): unknown {
  if (key !== undefined && isSensitiveKey(key)) {
    return REDACTED;
  }
  if (typeof value === "string") {
    return redactSensitiveText(value);
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, undefined, seen));
  }
  if (!isRecord(value)) {
    return value;
  }
  if (seen.has(value)) {
    return "[Circular]";
  }

  seen.add(value);
  const result: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    result[entryKey] = sanitizeValue(entryValue, entryKey, seen);
  }
  seen.delete(value);
  return result;
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[-_]/g, "").toLowerCase();
  return [...SENSITIVE_KEYS].some(
    (sensitiveKey) =>
      normalized === sensitiveKey || normalized.endsWith(sensitiveKey),
  );
}

function appendWithinLimit(filePath: string, line: string): void {
  const incomingBytes = Buffer.byteLength(line, "utf8");
  if (incomingBytes > MAX_LOG_BYTES) {
    throw new Error("observability log record exceeds the maximum log size");
  }

  let existingBytes = 0;
  try {
    existingBytes = statSync(filePath).size;
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }

  if (existingBytes + incomingBytes > MAX_LOG_BYTES) {
    trimToFit(filePath, MAX_LOG_BYTES - incomingBytes);
  }
  appendFileSync(filePath, line, "utf8");
}

function trimToFit(filePath: string, maxBytes: number): void {
  const existing = readFileSync(filePath);
  if (existing.byteLength <= maxBytes) {
    return;
  }

  const start = Math.max(0, existing.byteLength - maxBytes);
  const candidate = existing.subarray(start);
  const firstNewline = candidate.indexOf(0x0a);
  const retained =
    firstNewline === -1
      ? Buffer.alloc(0)
      : candidate.subarray(firstNewline + 1);
  writeFileSync(filePath, retained);
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createRunId(date: Date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

export function buildContextTag(
  details: Record<string, unknown>,
): string | undefined {
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
    typeof details.threadRole === "string" &&
    details.threadRole.trim().length > 0
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
