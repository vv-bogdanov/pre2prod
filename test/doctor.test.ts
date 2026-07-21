import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { runDoctor } from "../src/doctor.js";

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const mockCodex = resolve(here, "fixtures", "mock-codex.mjs");
const directories: string[] = [];

describe("runDoctor", () => {
  afterEach(async () => {
    await Promise.all(
      directories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it("checks a clean Git repository and a structured App Server turn", async () => {
    const cwd = await createRepository();

    const result = await runDoctor({
      cwd,
      codexBin: mockCodex,
      codexArgs: ["app-server"],
    });

    expect(result.passed).toBe(true);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Git repository", passed: true }),
        expect.objectContaining({ name: "Git working tree", passed: true }),
        expect.objectContaining({ name: "Codex CLI", passed: true }),
        expect.objectContaining({
          name: "Codex authentication",
          passed: true,
        }),
        expect.objectContaining({ name: "Codex App Server", passed: true }),
      ]),
    );
  });

  it("reports a dirty working tree", async () => {
    const cwd = await createRepository();
    await writeFile(resolve(cwd, "dirty.txt"), "dirty\n", "utf8");

    const result = await runDoctor({
      cwd,
      codexBin: mockCodex,
      codexArgs: ["app-server"],
    });

    expect(result.passed).toBe(false);
    expect(result.checks).toContainEqual({
      name: "Git working tree",
      passed: false,
      detail: "has uncommitted changes",
    });
  });
});

async function createRepository(): Promise<string> {
  const cwd = await mkdtemp(resolve(tmpdir(), "pre2prod-doctor-"));
  directories.push(cwd);
  await execFileAsync("git", ["init"], { cwd });
  await writeFile(resolve(cwd, "base.txt"), "base\n", "utf8");
  await execFileAsync("git", ["add", "base.txt"], { cwd });
  await execFileAsync(
    "git",
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-m",
      "initial",
    ],
    { cwd },
  );
  return cwd;
}
