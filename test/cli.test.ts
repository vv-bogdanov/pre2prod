import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(here, "..", "dist", "cli.js");
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
  ])("rejects invalid arguments: %j", async (args, expected) => {
    const result = await runCli(...args);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(expected);
  });
});

async function runCli(...args: string[]): Promise<CliResult> {
  try {
    const result = await execFileAsync(process.execPath, [cliPath, ...args], {
      cwd,
      encoding: "utf8",
    });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const result = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      exitCode: typeof result.code === "number" ? result.code : 1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
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
