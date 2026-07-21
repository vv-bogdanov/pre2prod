import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { Pre2prodError } from "./core/errors.js";
import type { ProgressReporter } from "./core/types.js";

const execFileAsync = promisify(execFile);

export interface GitSession {
  enabled: true;
  branch: string;
  commitPhase(phase: { id: string; title: string }): Promise<void>;
}

const GIT_COMMAND_HINT =
  "Initialize a git repository first: run `git init` in the project directory (for example: git init .).";

export async function prepareGit(cwd: string, reporter: ProgressReporter): Promise<GitSession> {
  if (!(await isGitRepository(cwd))) {
    throw new Pre2prodError(`Git repository not detected.
${GIT_COMMAND_HINT}`);
  }

  const status = await git(cwd, ["status", "--porcelain"]);
  if (status.stdout.trim()) {
    throw new Pre2prodError(
      "Git working tree is not clean. Commit or stash local changes before running pre2prod.",
    );
  }

  const branch = `pre2prod/${formatRunId(new Date())}`;
  try {
    await git(cwd, ["switch", "-c", branch]);
    reporter.info(`Git branch: ${branch}`);
  } catch (error) {
    throw new Pre2prodError(`Could not create Git branch for the run: ${messageOf(error)}`);
  }

  return {
    enabled: true,
    branch,
    async commitPhase(phase) {
      const slug = normalizePhaseIdentifier(phase);
      const safeTitle = normalizeCommitTitle(phase.title);
      const message = `pre2prod(${slug}): ${safeTitle}`;

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
          message,
        ]);
      } catch (error) {
        throw new Pre2prodError(`Git checkpoint commit failed: ${messageOf(error)}`);
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

async function git(
  cwd: string,
  args: string[],
  allowNonZero = false,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await execFileAsync("git", args, { cwd, encoding: "utf8" });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const record = error as { stdout?: string; stderr?: string; code?: number; message?: string };
    if (allowNonZero) {
      return {
        stdout: record.stdout ?? "",
        stderr: record.stderr ?? "",
        exitCode: typeof record.code === "number" ? record.code : 1,
      };
    }
    if (record.message && /ENOENT/.test(record.message)) {
      throw new Pre2prodError(`Unable to run git. ${GIT_COMMAND_HINT}`);
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

function normalizePhaseIdentifier(phase: { id: string; title: string }): string {
  const fromTitle = normalizeCommitSegment(phase.title);
  return fromTitle !== "" ? fromTitle : normalizeCommitSegment(phase.id);
}

function normalizeCommitTitle(title: string): string {
  const cleaned = title.trim();
  if (cleaned.length === 0) {
    return "phase";
  }
  return cleaned.replace(/\s+/g, " ");
}

function normalizeCommitSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 48);
}
