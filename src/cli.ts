#!/usr/bin/env node
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import process from "node:process";

import { Command, InvalidArgumentError } from "commander";

import {
  AppServerRuntime,
  DEFAULT_TURN_TIMEOUT_MS,
} from "./app-server/runtime.js";
import { loadPhases } from "./phases.js";
import { Pre2prodPipeline } from "./pipeline.js";
import { ConsoleProgressReporter } from "./progress.js";
import { createRunId, FileRunLogger, redactSensitiveText } from "./logging.js";
import { resolveRuntimeConfig } from "./runtime-config.js";
import { buildLogStats, formatLogStats } from "./log-stats.js";
import { runDoctor } from "./doctor.js";
import {
  collectPhaseIds,
  formatPhaseList,
  selectPhases,
} from "./phase-selection.js";

const VERSION = "0.1.0";
const program = new Command();

program
  .name("pre2prod")
  .description(
    "Prepare an existing repository for staging with a reviewer-led Codex workflow.",
  )
  .version(VERSION)
  .argument(
    "[instructions...]",
    "Additional free-form direction for the whole run",
  )
  .option("-C, --cwd <path>", "Repository working directory", process.cwd())
  .option("--model <model>", "Codex model")
  .option(
    "--local-provider <provider>",
    "Run Codex with a local provider (ollama or lmstudio)",
  )
  .option(
    "--max-iterations <number>",
    "Maximum worker iterations per phase",
    parseNonNegativeInteger,
    3,
  )
  .option(
    "--turn-timeout <minutes>",
    "Maximum duration of one App Server turn in minutes",
    parsePositiveNumber,
    DEFAULT_TURN_TIMEOUT_MS / 60_000,
  )
  .option("--no-network", "Disable network access for worker execution turns")
  .option("--no-commit", "Run in the current branch without checkpoint commits")
  .option("--log-dir <path>", "Directory for run logs", ".pre2prod/logs")
  .option(
    "--codex-bin <path>",
    "Codex executable",
    process.env.PRE2PROD_CODEX_BIN ?? "codex",
  )
  .option(
    "-p, --phases <ids>",
    "Run only these phases (comma-separated, can be repeated)",
    collectPhaseIds,
    [],
  )
  .option(
    "-x, --exclude <ids>",
    "Exclude phases (comma-separated, can be repeated)",
    collectPhaseIds,
    [],
  )
  .option("-l, --list", "List available phases and exit", false)
  .option(
    "-o, --observe",
    "Stream thinking, command, and file-change telemetry",
    true,
  )
  .option("--verbose", "Show streamed model and command details", false)
  .action(async (instructions: string[], options: CliRunOptions) => {
    const cwd = resolve(options.cwd);
    const runtimeConfig = resolveRuntimeConfig(options);
    const reporter = new ConsoleProgressReporter(
      options.verbose,
      options.observe || options.verbose,
    );
    const runId = createRunId();
    const logDirectory = resolve(cwd, options.logDir);
    const logger = new FileRunLogger({
      cwd,
      runId,
      logDir: options.logDir,
      onWriteError: (message) => reporter.warning(message),
    });
    const additionalInstructions = instructions.join(" ").trim();

    try {
      const allPhases = await loadPhases(cwd);
      const selectedPhases = selectPhases(
        allPhases,
        options.phases,
        options.exclude,
      );

      if (options.list) {
        for (const phase of formatPhaseList(selectedPhases, {
          dimSlug: true,
        })) {
          console.log(phase);
        }
        return;
      }

      reporter.info(`Run: ${runId} · logs: ${logDirectory}`);
      logger.log(
        "info",
        "cli.run.started",
        { cwd, logDir: logDirectory },
        { summary: true },
      );
      const providerLabel = formatRuntimeValue(
        runtimeConfig.provider,
        runtimeConfig.providerSource,
        "Codex default",
      );
      const modelLabel = formatRuntimeValue(
        runtimeConfig.model,
        runtimeConfig.modelSource,
        "Codex default",
      );
      reporter.info(`Provider: ${providerLabel} · model: ${modelLabel}`);
      logger.log("info", "cli.runtime.selected", {
        provider: runtimeConfig.provider ?? "codex-default",
        providerSource: runtimeConfig.providerSource,
        model: runtimeConfig.model ?? "codex-default",
        modelSource: runtimeConfig.modelSource,
      });
      const runtime = new AppServerRuntime({
        command: options.codexBin,
        args: runtimeConfig.codexArgs,
        cwd,
        ...(runtimeConfig.model ? { model: runtimeConfig.model } : {}),
        ...(runtimeConfig.provider
          ? { modelProvider: runtimeConfig.provider }
          : {}),
        reporter,
        logger,
        clientVersion: VERSION,
        turnTimeoutMs: options.turnTimeout * 60_000,
      });
      const pipeline = new Pre2prodPipeline(
        runtime,
        reporter,
        selectedPhases,
        logger,
      );

      const abortController = new AbortController();
      let shuttingDown = false;
      const shutdown = (signal: NodeJS.Signals): void => {
        if (shuttingDown) {
          return;
        }
        shuttingDown = true;
        abortController.abort();
        reporter.warning(`Received ${signal}; shutting down App Server...`);
        void runtime.close().catch((error: unknown) => {
          reporter.warning(
            `App Server shutdown failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      };
      const onInterrupt = (): void => shutdown("SIGINT");
      const onTerminate = (): void => shutdown("SIGTERM");
      process.once("SIGINT", onInterrupt);
      process.once("SIGTERM", onTerminate);
      try {
        await pipeline.run({
          cwd,
          ...(runtimeConfig.model ? { model: runtimeConfig.model } : {}),
          ...(additionalInstructions
            ? { instructions: additionalInstructions }
            : {}),
          maxIterationsPerPhase: options.maxIterations,
          networkAccess: options.network,
          commit: options.commit,
          signal: abortController.signal,
        });
      } finally {
        process.off("SIGINT", onInterrupt);
        process.off("SIGTERM", onTerminate);
      }
    } catch (error) {
      reporter.failed(
        `${error instanceof Error ? error.message : String(error)}; logs: ${logger.runId}`,
      );
      process.exitCode = 1;
    }
  });

program
  .command("logs")
  .description("View run logs")
  .option("-C, --cwd <path>", "Repository working directory", process.cwd())
  .option("--log-dir <path>", "Directory for run logs", ".pre2prod/logs")
  .option("--full", "Read full event log instead of summary log", false)
  .option("--stats", "Summarize runs and phases from the summary log", false)
  .option("-r, --run-id <id>", "Filter by run id (exact)")
  .option("-p, --phase-id <id>", "Filter by phase id (substring)")
  .option(
    "-i, --iteration <number>",
    "Filter by phase iteration",
    parseNonNegativeInteger,
  )
  .option("-R, --role <role>", "Filter by thread role: reviewer|worker")
  .option(
    "-t, --turn <turn>",
    "Filter by phase turn: review|planning|execution",
  )
  .option("-e, --event <event>", "Filter by event name")
  .option("-c, --contains <text>", "Filter by text present in raw log line")
  .option("-T, --tag <tag>", "Filter by text present in contextTag")
  .action(async (options: CliLogOptions) => {
    const cwd = resolve(options.cwd);
    const logPaths = FileRunLogger.paths(cwd, options.logDir);
    const logPath = options.full ? logPaths.full : logPaths.summary;
    const filters: LogFilters = {
      runId: options.runId,
      phaseId: options.phaseId,
      iteration: options.iteration,
      role: options.role,
      turn: options.turn,
      event: options.event,
      contains: options.contains,
      tag: options.tag,
    };

    try {
      if (options.stats) {
        const unsupported = selectedDetailedLogFilters(options);
        if (options.full || unsupported.length > 0) {
          console.error(
            `--stats supports only --run-id and --phase-id${unsupported.length > 0 ? `; remove ${unsupported.join(", ")}` : "; remove --full"}`,
          );
          process.exitCode = 1;
          return;
        }
        const content = await readFile(logPaths.summary, "utf8");
        const stats = buildLogStats(content.split(/\r?\n/), {
          ...(options.runId ? { runId: options.runId } : {}),
          ...(options.phaseId ? { phaseId: options.phaseId } : {}),
        });
        if (stats.runs.total === 0 && stats.phases.length === 0) {
          console.log("No matching log entries");
          return;
        }
        for (const line of formatLogStats(stats)) {
          console.log(line);
        }
        return;
      }

      const output = await readLogFile(logPath, filters);
      if (!output.length) {
        console.log("No matching log entries");
        return;
      }
      for (const line of output) {
        console.log(line);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        console.error(`Log file not found: ${redactSensitiveText(logPath)}`);
        process.exitCode = 1;
        return;
      }
      throw error;
    }
  });

program
  .command("doctor")
  .description("Check local prerequisites and Codex App Server compatibility")
  .option("-C, --cwd <path>", "Repository working directory", process.cwd())
  .option("--model <model>", "Codex model")
  .option(
    "--local-provider <provider>",
    "Run Codex with a local provider (ollama or lmstudio)",
  )
  .option(
    "--codex-bin <path>",
    "Codex executable",
    process.env.PRE2PROD_CODEX_BIN ?? "codex",
  )
  .action(async (options: CliDoctorOptions) => {
    const cwd = resolve(options.cwd);
    const runtimeConfig = resolveRuntimeConfig(options);
    const result = await runDoctor({
      cwd,
      codexBin: options.codexBin,
      codexArgs: runtimeConfig.codexArgs,
      ...(runtimeConfig.model ? { model: runtimeConfig.model } : {}),
      ...(runtimeConfig.provider ? { provider: runtimeConfig.provider } : {}),
      clientVersion: VERSION,
    });

    console.log("Pre2prod doctor");
    for (const check of result.checks) {
      console.log(
        `${check.passed ? "PASS" : "FAIL"}  ${check.name}: ${redactSensitiveText(check.detail)}`,
      );
    }
    if (!result.passed) {
      process.exitCode = 1;
    }
  });

await program.parseAsync();

interface CliRunOptions {
  cwd: string;
  model?: string;
  localProvider?: string;
  maxIterations: number;
  turnTimeout: number;
  network: boolean;
  logDir: string;
  codexBin: string;
  commit: boolean;
  observe: boolean;
  phases: string[];
  exclude: string[];
  list: boolean;
  verbose: boolean;
}

interface CliLogOptions {
  cwd: string;
  logDir: string;
  full: boolean;
  stats: boolean;
  runId: string | undefined;
  phaseId: string | undefined;
  iteration: number | undefined;
  role: string | undefined;
  turn: string | undefined;
  event: string | undefined;
  contains: string | undefined;
  tag: string | undefined;
}

interface CliDoctorOptions {
  cwd: string;
  model?: string;
  localProvider?: string;
  codexBin: string;
}

interface ParsedLogEvent {
  event?: unknown;
  runId?: unknown;
  phaseId?: unknown;
  phaseIteration?: unknown;
  threadRole?: unknown;
  phaseTurn?: unknown;
  contextTag?: unknown;
}

interface LogFilters {
  runId: string | undefined;
  phaseId: string | undefined;
  iteration: number | undefined;
  role: string | undefined;
  turn: string | undefined;
  event: string | undefined;
  contains: string | undefined;
  tag: string | undefined;
}

async function readLogFile(
  filePath: string,
  filters: LogFilters,
): Promise<string[]> {
  const content = await readFile(filePath, "utf8");
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const result: string[] = [];

  for (const line of lines) {
    if (matchesLogFilter(line, filters)) {
      result.push(redactSensitiveText(line));
    }
  }

  return result;
}

function matchesLogFilter(line: string, filters: LogFilters): boolean {
  if (Object.values(filters).every((value) => value === undefined)) {
    return true;
  }

  const parsed = parseLogLine(line);
  if (parsed === null) {
    return false;
  }

  const event = getString(parsed.event);
  const runId = getString(parsed.runId);
  const phaseId = getString(parsed.phaseId);
  const phaseIteration = getInteger(parsed.phaseIteration);
  const threadRole = getString(parsed.threadRole);
  const phaseTurn = getString(parsed.phaseTurn);
  const contextTag = getString(parsed.contextTag);

  if (filters.runId !== undefined) {
    if (runId !== filters.runId) {
      return false;
    }
  }
  if (filters.phaseId !== undefined) {
    if (phaseId === undefined || !phaseId.includes(filters.phaseId)) {
      return false;
    }
  }
  if (filters.iteration !== undefined) {
    if (phaseIteration !== filters.iteration) {
      return false;
    }
  }
  if (filters.role !== undefined) {
    if (threadRole !== filters.role) {
      return false;
    }
  }
  if (filters.turn !== undefined) {
    if (phaseTurn !== filters.turn) {
      return false;
    }
  }
  if (filters.event !== undefined) {
    if (event !== filters.event) {
      return false;
    }
  }
  if (filters.contains !== undefined) {
    if (!line.includes(filters.contains)) {
      return false;
    }
  }
  if (filters.tag !== undefined) {
    if (contextTag === undefined || !contextTag.includes(filters.tag)) {
      return false;
    }
  }

  return true;
}

function parseLogLine(line: string): ParsedLogEvent | null {
  try {
    const parsed: unknown = JSON.parse(line);
    if (parsed !== null && typeof parsed === "object") {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value)
    ? value
    : undefined;
}

function selectedDetailedLogFilters(options: CliLogOptions): string[] {
  return [
    ["--iteration", options.iteration],
    ["--role", options.role],
    ["--turn", options.turn],
    ["--event", options.event],
    ["--contains", options.contains],
    ["--tag", options.tag],
  ]
    .filter((entry) => entry[1] !== undefined)
    .map((entry) => String(entry[0]));
}

function formatRuntimeValue(
  value: string | undefined,
  source: "cli" | "dev" | "default",
  fallback: string,
): string {
  return `${value ?? fallback}${source === "default" ? "" : ` (${source})`}`;
}

function parseNonNegativeInteger(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new InvalidArgumentError("Expected a non-negative integer");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new InvalidArgumentError("Expected a non-negative integer");
  }
  return parsed;
}

function parsePositiveNumber(value: string): number {
  const parsed = Number(value);
  const maximum = Math.floor(2_147_483_647 / 60_000);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > maximum) {
    throw new InvalidArgumentError(
      `Expected a positive number no greater than ${maximum}`,
    );
  }
  return parsed;
}
