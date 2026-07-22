import { execFile } from "node:child_process";

import { AppServerRuntime } from "./app-server/runtime.js";
import { parseReviewResult, REVIEW_RESULT_SCHEMA } from "./reviewer.js";
import { VERSION } from "./version.js";

export interface DoctorOptions {
  cwd: string;
  codexBin: string;
  codexArgs: string[];
  model?: string;
  provider?: string;
  clientVersion?: string;
}

export interface DoctorCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface DoctorResult {
  passed: boolean;
  checks: DoctorCheck[];
}

const MINIMUM_NODE_VERSION = [20, 19, 0] as const;
const COMMAND_TIMEOUT_MS = 10_000;
const HANDSHAKE_TIMEOUT_MS = 2 * 60_000;

export async function runDoctor(options: DoctorOptions): Promise<DoctorResult> {
  const checks: DoctorCheck[] = [];
  const nodePassed = compareVersions(parseVersion(process.versions.node), [
    ...MINIMUM_NODE_VERSION,
  ]);
  checks.push({
    name: "Node.js",
    passed: nodePassed,
    detail: nodePassed
      ? process.versions.node
      : `requires >=${MINIMUM_NODE_VERSION.join(".")}; found ${process.versions.node}`,
  });

  const gitRepository = await runCommand(
    "git",
    ["rev-parse", "--is-inside-work-tree"],
    options.cwd,
  );
  const isRepository =
    gitRepository.exitCode === 0 && gitRepository.stdout.trim() === "true";
  checks.push({
    name: "Git repository",
    passed: isRepository,
    detail: isRepository ? "available" : commandFailure(gitRepository),
  });

  if (isRepository) {
    const status = await runCommand(
      "git",
      ["status", "--porcelain", "--untracked-files=normal"],
      options.cwd,
    );
    const clean = status.exitCode === 0 && status.stdout.trim() === "";
    checks.push({
      name: "Git working tree",
      passed: clean,
      detail: clean ? "clean" : "has uncommitted changes",
    });
  } else {
    checks.push({
      name: "Git working tree",
      passed: false,
      detail: "unavailable until the repository is initialized with git init",
    });
  }

  const version = await runCommand(
    options.codexBin,
    ["--version"],
    options.cwd,
  );
  const codexAvailable = version.exitCode === 0;
  checks.push({
    name: "Codex CLI",
    passed: codexAvailable,
    detail: codexAvailable ? version.stdout.trim() : commandFailure(version),
  });

  if (options.provider) {
    checks.push({
      name: "Codex authentication",
      passed: true,
      detail: `not required for local provider ${options.provider}`,
    });
  } else if (codexAvailable) {
    const login = await runCommand(
      options.codexBin,
      ["login", "status"],
      options.cwd,
    );
    checks.push({
      name: "Codex authentication",
      passed: login.exitCode === 0,
      detail:
        login.exitCode === 0
          ? firstLine(login.stdout) || "authenticated"
          : commandFailure(login),
    });
  } else {
    checks.push({
      name: "Codex authentication",
      passed: false,
      detail: "unavailable until Codex CLI is installed",
    });
  }

  if (codexAvailable) {
    checks.push(await checkAppServer(options));
  } else {
    checks.push({
      name: "Codex App Server",
      passed: false,
      detail: "unavailable until Codex CLI is installed",
    });
  }

  return {
    passed: checks.every((check) => check.passed),
    checks,
  };
}

async function checkAppServer(options: DoctorOptions): Promise<DoctorCheck> {
  const runtime = new AppServerRuntime({
    command: options.codexBin,
    args: options.codexArgs,
    cwd: options.cwd,
    ...(options.model ? { model: options.model } : {}),
    ...(options.provider ? { modelProvider: options.provider } : {}),
    clientVersion: options.clientVersion ?? VERSION,
    turnTimeoutMs: HANDSHAKE_TIMEOUT_MS,
  });

  try {
    await runtime.initialize();
    const thread = await runtime.startThread({
      cwd: options.cwd,
      ...(options.model ? { model: options.model } : {}),
    });
    const turn = await runtime.runTurn({
      threadId: thread.id,
      prompt:
        "Pre2prod doctor compatibility check. Do not inspect files or run tools. Return no findings.",
      cwd: options.cwd,
      sandbox: "read-only",
      outputSchema: REVIEW_RESULT_SCHEMA,
    });
    parseReviewResult(turn.text);
    return {
      name: "Codex App Server",
      passed: true,
      detail: "initialize, thread/start, and structured read-only turn passed",
    };
  } catch (error) {
    return {
      name: "Codex App Server",
      passed: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await runtime.close().catch(() => undefined);
  }
}

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { cwd, encoding: "utf8", timeout: COMMAND_TIMEOUT_MS },
      (error, stdout, stderr) => {
        const exitCode =
          error && "code" in error && typeof error.code === "number"
            ? error.code
            : error
              ? 1
              : 0;
        resolve({ exitCode, stdout, stderr });
      },
    );
  });
}

function commandFailure(result: CommandResult): string {
  return (
    firstLine(result.stderr) || firstLine(result.stdout) || "command failed"
  );
}

function firstLine(value: string): string {
  return value.trim().split(/\r?\n/, 1)[0] ?? "";
}

function parseVersion(value: string): number[] {
  return value.split(".").map((part) => Number.parseInt(part, 10) || 0);
}

function compareVersions(actual: number[], minimum: number[]): boolean {
  for (let index = 0; index < minimum.length; index += 1) {
    const difference = (actual[index] ?? 0) - (minimum[index] ?? 0);
    if (difference !== 0) {
      return difference > 0;
    }
  }
  return true;
}
