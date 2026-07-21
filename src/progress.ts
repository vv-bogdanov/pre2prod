import pc from "picocolors";

import type { Phase, PipelineResult, ProgressReporter } from "./core/types.js";
import { redactSensitiveText } from "./logging.js";

export class ConsoleProgressReporter implements ProgressReporter {
  readonly #verboseEnabled: boolean;
  readonly #observeEnabled: boolean;

  public constructor(verbose = false, observe = false) {
    this.#verboseEnabled = verbose;
    this.#observeEnabled = observe;
  }

  public title(): void {
    console.log(pc.bold("Pre2prod"));
    console.log();
  }

  public info(message: string): void {
    console.log(pc.dim(`      ${redactSensitiveText(message)}`));
  }

  public warning(message: string): void {
    console.warn(pc.yellow(`      WARNING · ${redactSensitiveText(message)}`));
  }

  public phaseStarted(index: number, total: number, phase: Phase): void {
    console.log(
      pc.bold(`[${index}/${total}] ${redactSensitiveText(phase.title)}`),
    );
  }

  public reviewing(isRepeat: boolean): void {
    console.log(pc.dim(`      ${isRepeat ? "Re-reviewing" : "Reviewing"}...`));
  }

  public needsWork(findings: string[]): void {
    console.log(
      pc.yellow(
        `      NEEDS WORK · ${findings.length} material finding${findings.length === 1 ? "" : "s"}`,
      ),
    );
    for (const finding of findings) {
      console.log(pc.dim(`        - ${redactSensitiveText(finding)}`));
    }
  }

  public planning(planPath: string): void {
    console.log(pc.dim(`      Planning → ${redactSensitiveText(planPath)}`));
  }

  public working(): void {
    console.log(pc.dim("      Working..."));
  }

  public phasePassed(): void {
    console.log(pc.green("      PASS"));
    console.log();
  }

  public command(
    command: string,
    status?: string,
    context?: Record<string, unknown>,
  ): void {
    const contextLabel = this.#formatContext(context);
    const safeCommand = redactSensitiveText(command);
    console.log(
      pc.dim(
        `      ${contextLabel} command [${status ?? "unknown"}] ${this.#verboseEnabled ? safeCommand : safeCommand.slice(0, 220)}`,
      ),
    );
  }

  public thinking(message: string, context?: Record<string, unknown>): void {
    this.#observedMessage("think", message, context);
  }

  public result(message: string, context?: Record<string, unknown>): void {
    this.#observedMessage("result", message, context);
  }

  public filesTouched(
    paths: readonly string[],
    context?: Record<string, unknown>,
  ): void {
    if (!this.#observeEnabled || paths.length === 0) {
      return;
    }
    const contextLabel = this.#formatContext(context);
    for (const path of paths) {
      console.log(
        pc.green(`      ${contextLabel} file: ${redactSensitiveText(path)}`),
      );
    }
  }

  public waiting(message: string): void {
    console.log(pc.dim(`      ${redactSensitiveText(message)}`));
  }

  public verbose(message: string): void {
    if (this.#verboseEnabled) {
      process.stdout.write(pc.dim(redactSensitiveText(message)));
    }
  }

  public completed(result: PipelineResult): void {
    console.log(pc.green(pc.bold("Pre2prod completed")));
    console.log(
      `Passed phases: ${result.phases.filter((phase) => phase.passed).length}/${result.phases.length}`,
    );
    if (result.gitBranch) {
      console.log(`Branch: ${redactSensitiveText(result.gitBranch)}`);
    }
    console.log(
      "Review the resulting repository before production deployment.",
    );
  }

  public failed(message: string): void {
    console.error(
      pc.red(pc.bold(`Pre2prod failed: ${redactSensitiveText(message)}`)),
    );
  }

  #formatContext(context?: Record<string, unknown>): string {
    if (!context) {
      return "";
    }
    const role =
      typeof context.threadRole === "string" ? context.threadRole : "agent";
    const turn =
      typeof context.phaseTurn === "string" ? context.phaseTurn : "turn";
    const phase =
      typeof context.phaseId === "string" &&
      typeof context.phaseIteration === "number"
        ? `${context.phaseId}#${context.phaseIteration}`
        : "phase";
    return `[${role}/${turn} ${phase}]`;
  }

  #observedMessage(
    label: "think" | "result",
    message: string,
    context?: Record<string, unknown>,
  ): void {
    if (!this.#observeEnabled) {
      return;
    }
    const contextLabel = this.#formatContext(context);
    const safeMessage = redactSensitiveText(message);
    const prettyJson = tryPrettyJsonLines(safeMessage);
    const lines = prettyJson ?? splitLines(safeMessage);
    const prefix = `      ${contextLabel} ${label}:`;
    if (prettyJson) {
      console.log(pc.dim(prefix));
      for (const line of lines) {
        console.log(`      ${colorizeJson(line)}`);
      }
      return;
    }

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      console.log(pc.dim(`${prefix} ${line}`));
    }
  }
}

function splitLines(text: string): string[] {
  return text.trim().split(/\r?\n/);
}

function tryPrettyJsonLines(text: string): string[] | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  if (
    (trimmed[0] !== "{" && trimmed[0] !== "[") ||
    (trimmed.at(-1) !== "}" && trimmed.at(-1) !== "]")
  ) {
    return null;
  }
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2).split(/\r?\n/);
  } catch {
    return null;
  }
}

function colorizeJson(line: string): string {
  let result = "";
  let index = 0;

  while (index < line.length) {
    if (line[index] === '"') {
      const end = findStringEnd(line, index);
      const value = line.slice(index, end + 1);
      const next = line.slice(end + 1).trimStart();
      result += next.startsWith(":") ? pc.cyan(value) : pc.green(value);
      index = end + 1;
      continue;
    }

    const literal = line
      .slice(index)
      .match(/^(true|false|null|-?\d+(?:\.\d+)?)/);
    if (literal) {
      result += pc.yellow(literal[0]);
      index += literal[0].length;
      continue;
    }

    result += line[index];
    index += 1;
  }

  return result;
}

function findStringEnd(line: string, start: number): number {
  for (let index = start + 1; index < line.length; index += 1) {
    if (line[index] === "\\") {
      index += 1;
      continue;
    }
    if (line[index] === '"') {
      return index;
    }
  }
  return line.length - 1;
}
