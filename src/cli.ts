#!/usr/bin/env node
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import process from "node:process";

import { Command, InvalidArgumentError } from "commander";

import { AppServerRuntime } from "./app-server/runtime.js";
import { loadPhases } from "./phases.js";
import { Pre2prodPipeline } from "./pipeline.js";
import { ConsoleProgressReporter } from "./progress.js";
import { createRunId, FileRunLogger } from "./logging.js";
import {
  collectPhaseIds,
  formatPhaseList,
  selectPhases,
} from "./phase-selection.js";

const VERSION = "0.1.0";
const program = new Command();

program
  .name("pre2prod")
  .description("Prepare an existing repository for staging with a reviewer-led Codex workflow.")
  .version(VERSION)
  .argument("[instructions...]", "Additional free-form direction for the whole run")
  .option("-C, --cwd <path>", "Repository working directory", process.cwd())
  .option("--model <model>", "Codex model")
  .option(
    "--max-iterations <number>",
    "Maximum worker iterations per phase",
    parseNonNegativeInteger,
    2,
  )
  .option("--no-network", "Disable network access for worker execution turns")
  .option("--log-dir <path>", "Directory for run logs", ".pre2prod/logs")
  .option("--codex-bin <path>", "Codex executable", process.env.PRE2PROD_CODEX_BIN ?? "codex")
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
  .option("-o, --observe", "Stream thinking, command, and file-change telemetry", false)
  .option("--verbose", "Show streamed model and command details", false)
  .action(async (instructions: string[], options: CliRunOptions) => {
    const cwd = resolve(options.cwd);
    const reporter = new ConsoleProgressReporter(
      options.verbose,
      options.observe || options.verbose,
    );
    const runId = createRunId();
    const logger = new FileRunLogger({
      cwd,
      runId,
      logDir: options.logDir,
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
        for (const phase of formatPhaseList(selectedPhases, { dimSlug: true })) {
          console.log(phase);
        }
        return;
      }

      const runtime = new AppServerRuntime({
        command: options.codexBin,
        args: ["app-server"],
        cwd,
        ...(options.model ? { model: options.model } : {}),
        reporter,
        logger,
        clientVersion: VERSION,
      });
      const pipeline = new Pre2prodPipeline(runtime, reporter, selectedPhases, logger);

      await pipeline.run({
        cwd,
        ...(options.model ? { model: options.model } : {}),
        ...(additionalInstructions ? { instructions: additionalInstructions } : {}),
        maxIterationsPerPhase: options.maxIterations,
        networkAccess: options.network,
      });
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
  .option("-r, --run-id <id>", "Filter by run id (exact)")
  .option("-p, --phase-id <id>", "Filter by phase id (substring)")
  .option("-i, --iteration <number>", "Filter by phase iteration", parseNonNegativeInteger)
  .option("-R, --role <role>", "Filter by thread role: reviewer|worker")
  .option("-t, --turn <turn>", "Filter by phase turn: review|planning|execution")
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
        console.error(`Log file not found: ${logPath}`);
        process.exitCode = 1;
        return;
      }
      throw error;
    }
  });

await program.parseAsync();

interface CliRunOptions {
  cwd: string;
  model?: string;
  maxIterations: number;
  network: boolean;
  logDir: string;
  codexBin: string;
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
  runId: string | undefined;
  phaseId: string | undefined;
  iteration: number | undefined;
  role: string | undefined;
  turn: string | undefined;
  event: string | undefined;
  contains: string | undefined;
  tag: string | undefined;
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

async function readLogFile(filePath: string, filters: LogFilters): Promise<string[]> {
  const content = await readFile(filePath, "utf8");
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const result: string[] = [];

  for (const line of lines) {
    if (matchesLogFilter(line, filters)) {
      result.push(line);
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
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function parseNonNegativeInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new InvalidArgumentError("Expected a non-negative integer");
  }
  return parsed;
}
