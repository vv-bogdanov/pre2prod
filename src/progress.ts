import pc from "picocolors";

import type { Phase, PipelineResult, ProgressReporter } from "./core/types.js";

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
    console.log(pc.dim(`      ${message}`));
  }

  public warning(message: string): void {
    console.warn(pc.yellow(`      WARNING · ${message}`));
  }

  public phaseStarted(index: number, total: number, phase: Phase): void {
    console.log(pc.bold(`[${index}/${total}] ${phase.title}`));
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
      console.log(pc.dim(`        - ${finding}`));
    }
  }

  public planning(planPath: string): void {
    console.log(pc.dim(`      Planning → ${planPath}`));
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
    console.log(
      pc.dim(
        `      ${contextLabel} command [${status ?? "unknown"}] ${this.#verboseEnabled ? command : command.slice(0, 220)}`,
      ),
    );
  }

  public thinking(message: string, context?: Record<string, unknown>): void {
    if (!this.#observeEnabled) {
      return;
    }
    const contextLabel = this.#formatContext(context);
    for (const line of splitLines(message)) {
      if (!line.trim()) {
        continue;
      }
      console.log(pc.dim(`      ${contextLabel} think: ${line}`));
    }
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
      console.log(pc.green(`      ${contextLabel} file: ${path}`));
    }
  }

  public waiting(message: string): void {
    console.log(pc.dim(`      ${message}`));
  }

  public verbose(message: string): void {
    if (this.#verboseEnabled) {
      process.stdout.write(pc.dim(message));
    }
  }

  public completed(result: PipelineResult): void {
    console.log(pc.green(pc.bold("Pre2prod completed")));
    console.log(
      `Passed phases: ${result.phases.filter((phase) => phase.passed).length}/${result.phases.length}`,
    );
    if (result.gitBranch) {
      console.log(`Branch: ${result.gitBranch}`);
    }
    console.log("Review the resulting repository before production deployment.");
  }

  public failed(message: string): void {
    console.error(pc.red(pc.bold(`Pre2prod failed: ${message}`)));
  }

  #formatContext(context?: Record<string, unknown>): string {
    if (!context) {
      return "";
    }
    const role = typeof context.threadRole === "string" ? context.threadRole : "agent";
    const turn = typeof context.phaseTurn === "string" ? context.phaseTurn : "turn";
    const phase =
      typeof context.phaseId === "string" &&
      typeof context.phaseIteration === "number"
        ? `${context.phaseId}#${context.phaseIteration}`
        : "phase";
    return `[${role}/${turn} ${phase}]`;
  }
}

function splitLines(text: string): string[] {
  return text.trim().split(/\r?\n/);
}
