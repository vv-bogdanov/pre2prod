import { execFile, spawn, type ChildProcess } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(here, "..", "dist", "cli.js");
const mockCodex = resolve(here, "fixtures", "mock-app-server.mjs");
let cwd: string;

describe("pre2prod CLI", () => {
  beforeAll(async () => {
    cwd = await mkdtemp(resolve(tmpdir(), "pre2prod-cli-"));
  });

  afterAll(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("prints help and version", async () => {
    const help = await runCli("--help");
    const version = await runCli("--version");

    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain("Usage: pre2prod");
    expect(help.stdout).toContain("--list");
    expect(help.stdout).toContain("--turn-timeout");
    expect(version).toEqual({
      exitCode: 0,
      stdout: `${await packageVersion()}\n`,
      stderr: "",
    });
  });

  it("lists selected phase groups", async () => {
    const result = await runCli("--list", "--phases", "verification");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Verification");
    expect(result.stdout).toContain("verification-integration");
    expect(result.stdout).not.toContain("foundation-immediate-risk-triage");
    expect(result.stderr).toBe("");
  });

  it.each([
    [
      ["--list", "--phases", "not-a-phase"],
      /--phases references unknown phase id\(s\): not-a-phase/,
    ],
    [["--list", "--max-iterations", "nope"], /Expected a non-negative integer/],
    [["--list", "--turn-timeout", "0"], /Expected a positive number/],
  ])("rejects invalid arguments: %j", async (args, expected) => {
    const result = await runCli(...args);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(expected);
  });

  it("completes a reviewer-worker-re-review journey through the public command", async () => {
    const repository = await mkdtemp(resolve(tmpdir(), "pre2prod-cli-e2e-"));

    try {
      await initBaseRepository(repository);
      await mkdir(resolve(repository, ".pre2prod"), { recursive: true });
      await writeFile(
        resolve(repository, ".pre2prod", "phases.yaml"),
        [
          "phases:",
          "  - id: mock-readiness",
          "    title: Mock readiness",
          "    reviewerPrompt: Require mock-fixed.txt to exist.",
          "",
        ].join("\n"),
        "utf8",
      );

      const result = await runCli(
        "--cwd",
        repository,
        "--codex-bin",
        mockCodex,
        "--max-iterations",
        "1",
        "--no-network",
      );

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("Pre2prod completed");
      expect(
        await readFile(resolve(repository, "mock-fixed.txt"), "utf8"),
      ).toBe("fixed\n");
      await expect(
        readFile(resolve(repository, "PRE2PROD_PLAN.md"), "utf8"),
      ).rejects.toThrow();

      const archivedPlans = await readdir(
        resolve(repository, ".pre2prod", "plans"),
      );
      expect(archivedPlans).toHaveLength(1);
      expect(
        await readFile(
          resolve(repository, ".pre2prod", "plans", archivedPlans[0] ?? ""),
          "utf8",
        ),
      ).toContain("# Plan");

      const events = (
        await readFile(
          resolve(repository, ".pre2prod", "logs", "pre2prod-events.jsonl"),
          "utf8",
        )
      )
        .trim()
        .split("\n")
        .map(
          (line) => JSON.parse(line) as { event?: string; isRepeat?: boolean },
        );
      expect(events).toContainEqual(
        expect.objectContaining({
          event: "phase.review.started",
          isRepeat: true,
        }),
      );
      expect(await execGit(repository, ["status", "--porcelain"])).toBe("");
      expect(
        (await execGit(repository, ["log", "-1", "--pretty=%s"])).trim(),
      ).toBe("pre2prod(mock-readiness): Mock readiness");
    } finally {
      await rm(repository, { recursive: true, force: true });
    }
  });

  it("shuts down the App Server child on SIGTERM", async () => {
    const repository = await mkdtemp(resolve(tmpdir(), "pre2prod-cli-signal-"));
    const pidFile = resolve(repository, "mock.pid");
    const exitFile = resolve(repository, "mock.exit");
    let child: ChildProcess | undefined;

    try {
      await initBaseRepository(repository);
      await mkdir(resolve(repository, ".pre2prod"), { recursive: true });
      await writeFile(
        resolve(repository, ".pre2prod", "phases.yaml"),
        [
          "phases:",
          "  - id: mock-readiness",
          "    title: Mock readiness",
          "    reviewerPrompt: Require mock-fixed.txt to exist.",
          "",
        ].join("\n"),
        "utf8",
      );

      const spawnedChild = spawn(
        process.execPath,
        [
          cliPath,
          "--cwd",
          repository,
          "--codex-bin",
          mockCodex,
          "--max-iterations",
          "1",
          "--no-network",
        ],
        {
          cwd,
          env: {
            ...process.env,
            MOCK_HANG_TURN: "1",
            MOCK_PID_FILE: pidFile,
            MOCK_EXIT_FILE: exitFile,
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      child = spawnedChild;
      const stderr: string[] = [];
      spawnedChild.stderr.on("data", (chunk: Buffer) =>
        stderr.push(chunk.toString("utf8")),
      );

      await waitForFile(pidFile);
      spawnedChild.kill("SIGTERM");
      const exitCode = await new Promise<number>((resolveExit, reject) => {
        spawnedChild.once("error", reject);
        spawnedChild.once("close", (code) => resolveExit(code ?? 1));
      });
      await waitForFile(exitFile);

      expect(exitCode).not.toBe(0);
      expect(stderr.join("")).toContain(
        "Received SIGTERM; shutting down App Server...",
      );
    } finally {
      if (child && child.exitCode === null) {
        child.kill("SIGKILL");
      }
      await rm(repository, { recursive: true, force: true });
    }
  });
});

async function runCli(...args: string[]): Promise<CliResult> {
  const outputDirectory = await mkdtemp(
    resolve(tmpdir(), "pre2prod-cli-output-"),
  );
  const stdoutPath = resolve(outputDirectory, "stdout.log");
  const stderrPath = resolve(outputDirectory, "stderr.log");
  const stdout = await open(stdoutPath, "w");
  const stderr = await open(stderrPath, "w");

  try {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd,
      stdio: ["ignore", stdout.fd, stderr.fd],
    });

    const exitCode = await new Promise<number>((resolveExit, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolveExit(code ?? 1));
    });

    return {
      exitCode,
      stdout: await readFile(stdoutPath, "utf8"),
      stderr: await readFile(stderrPath, "utf8"),
    };
  } finally {
    await stdout.close();
    await stderr.close();
    await rm(outputDirectory, { recursive: true, force: true });
  }
}

interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function packageVersion(): Promise<string> {
  const parsed: unknown = JSON.parse(
    await readFile(resolve(here, "..", "package.json"), "utf8"),
  );
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("version" in parsed) ||
    typeof parsed.version !== "string"
  ) {
    throw new Error("package.json must contain a string version");
  }
  return parsed.version;
}

async function initBaseRepository(cwd: string): Promise<void> {
  await execGit(cwd, ["init"]);
  await writeFile(resolve(cwd, "base.txt"), "base\n", "utf8");
  await writeFile(resolve(cwd, ".gitignore"), ".pre2prod/\n", "utf8");
  await execGit(cwd, ["add", "base.txt", ".gitignore"]);
  await execGit(cwd, [
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-m",
    "initial",
  ]);
}

async function execGit(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, { cwd, encoding: "utf8" });
  return result.stdout;
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      await access(path);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}
