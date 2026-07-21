import pc from "picocolors";

import type { Phase, PipelineResult, ProgressReporter } from "./core/types.js";

export class ConsoleProgressReporter implements ProgressReporter {
  readonly #verboseEnabled: boolean;

  public constructor(verbose = false) {
    this.#verboseEnabled = verbose;
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

  public command(command: string, status?: string): void {
    if (this.#verboseEnabled) {
      console.log(pc.dim(`      command [${status ?? "unknown"}] ${command}`));
    }
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
}
