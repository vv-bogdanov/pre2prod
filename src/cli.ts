#!/usr/bin/env node
import { resolve } from "node:path";
import process from "node:process";

import { Command, InvalidArgumentError } from "commander";

import { AppServerRuntime } from "./app-server/runtime.js";
import { Pre2prodPipeline } from "./pipeline.js";
import { ConsoleProgressReporter } from "./progress.js";

const VERSION = "0.1.0";
const program = new Command();

program
  .name("pre2prod")
  .description("Prepare an existing repository for staging with a reviewer-led Codex workflow.")
  .version(VERSION)
  .argument("[instructions...]", "Additional free-form direction for the whole run")
  .option("-C, --cwd <path>", "Repository working directory", process.cwd())
  .option("--model <model>", "Codex model", process.env.PRE2PROD_MODEL ?? "gpt-5.6")
  .option(
    "--max-iterations <number>",
    "Maximum worker iterations per phase",
    parseNonNegativeInteger,
    2,
  )
  .option("--no-network", "Disable network access for worker execution turns")
  .option("--codex-bin <path>", "Codex executable", process.env.PRE2PROD_CODEX_BIN ?? "codex")
  .option("--verbose", "Show streamed model and command details", false)
  .action(async (instructions: string[], options: CliOptions) => {
    const cwd = resolve(options.cwd);
    const reporter = new ConsoleProgressReporter(options.verbose);
    const runtime = new AppServerRuntime({
      command: options.codexBin,
      args: ["app-server"],
      cwd,
      model: options.model,
      reporter,
      clientVersion: VERSION,
    });
    const pipeline = new Pre2prodPipeline(runtime, reporter);
    const additionalInstructions = instructions.join(" ").trim();

    try {
      await pipeline.run({
        cwd,
        model: options.model,
        ...(additionalInstructions ? { instructions: additionalInstructions } : {}),
        maxIterationsPerPhase: options.maxIterations,
        networkAccess: options.network,
      });
    } catch (error) {
      reporter.failed(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  });

await program.parseAsync();

interface CliOptions {
  cwd: string;
  model: string;
  maxIterations: number;
  network: boolean;
  codexBin: string;
  verbose: boolean;
}

function parseNonNegativeInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new InvalidArgumentError("Expected a non-negative integer");
  }
  return parsed;
}
