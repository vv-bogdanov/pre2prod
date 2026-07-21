import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { ProgressReporter } from "./core/types.js";

const execFileAsync = promisify(execFile);

export interface GitSession {
  enabled: boolean;
  branch?: string;
  commitWorker(phaseId: string, iteration: number): Promise<void>;
}

export async function prepareGit(cwd: string, reporter: ProgressReporter): Promise<GitSession> {
  if (!(await isGitRepository(cwd))) {
    reporter.warning("Git repository not detected; branch and checkpoint commits are disabled.");
    return disabledGitSession();
  }

  const status = await git(cwd, ["status", "--porcelain"]);
  if (status.stdout.trim()) {
    reporter.warning(
      "Git working tree is not clean; automatic branch and checkpoint commits are disabled.",
    );
    return disabledGitSession();
  }

  const branch = `pre2prod/${formatRunId(new Date())}`;
  try {
    await git(cwd, ["switch", "-c", branch]);
    reporter.info(`Git branch: ${branch}`);
  } catch (error) {
    reporter.warning(`Could not create Git branch; checkpoints are disabled: ${messageOf(error)}`);
    return disabledGitSession();
  }

  return {
    enabled: true,
    branch,
    async commitWorker(phaseId, iteration) {
      try {
        await git(cwd, ["add", "-A"]);
        await git(cwd, ["reset", "-q", "--", "PRE2PROD_PLAN.md"], true);
        const staged = await git(cwd, ["diff", "--cached", "--quiet"], true);
        if (staged.exitCode === 0) {
          return;
        }
        await git(cwd, [
          "-c",
          "user.name=Pre2prod",
          "-c",
          "user.email=pre2prod@local",
          "commit",
          "-m",
          `pre2prod(${phaseId}): iteration ${iteration}`,
        ]);
      } catch (error) {
        reporter.warning(`Git checkpoint failed: ${messageOf(error)}`);
      }
    },
  };
}

async function isGitRepository(cwd: string): Promise<boolean> {
  try {
    const result = await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
    return result.stdout.trim() === "true";
  } catch {
    return false;
  }
}

function disabledGitSession(): GitSession {
  return {
    enabled: false,
    async commitWorker() {
      // Intentionally empty.
    },
  };
}

async function git(
  cwd: string,
  args: string[],
  allowNonZero = false,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await execFileAsync("git", args, { cwd, encoding: "utf8" });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const record = error as { stdout?: string; stderr?: string; code?: number };
    if (allowNonZero) {
      return {
        stdout: record.stdout ?? "",
        stderr: record.stderr ?? "",
        exitCode: typeof record.code === "number" ? record.code : 1,
      };
    }
    throw error;
  }
}

function formatRunId(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z")
    .toLowerCase();
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
