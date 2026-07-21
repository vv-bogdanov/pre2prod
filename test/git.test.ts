import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { prepareGit } from "../src/git.js";
import type { ProgressReporter } from "../src/core/types.js";

const execFileAsync = promisify(execFile);

describe("prepareGit", () => {
  it("creates a branch and commits worker changes without the runtime plan", async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), "pre2prod-git-"));
    await git(cwd, ["init"]);
    await writeFile(resolve(cwd, "app.txt"), "before\n", "utf8");
    await git(cwd, ["add", "app.txt"]);
    await git(cwd, [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-m",
      "initial",
    ]);

    const session = await prepareGit(cwd, silentReporter());
    expect(session.enabled).toBe(true);
    expect(session.branch).toMatch(/^pre2prod\//);

    await writeFile(resolve(cwd, "app.txt"), "after\n", "utf8");
    await writeFile(resolve(cwd, "PRE2PROD_PLAN.md"), "# Plan\n", "utf8");
    await session.commitPhase({ id: "testing", title: "Testing" });

    expect((await git(cwd, ["log", "-1", "--pretty=%s"])).trim()).toBe(
      "pre2prod(testing): Testing",
    );
    expect((await git(cwd, ["status", "--porcelain"])).trim()).toBe("");
    expect(await readFile(resolve(cwd, "PRE2PROD_PLAN.md"), "utf8")).toBe(
      "# Plan\n",
    );
    expect(await readFile(resolve(cwd, "app.txt"), "utf8")).toBe("after\n");
  });

  it("keeps generated runtime artifacts out of status and checkpoints", async () => {
    const cwd = await createInitializedRepository();
    await mkdir(resolve(cwd, ".pre2prod", "logs"), { recursive: true });
    await writeFile(
      resolve(cwd, ".pre2prod", "logs", "events.jsonl"),
      "{}\n",
      "utf8",
    );

    const session = await prepareGit(cwd, silentReporter());
    await writeFile(resolve(cwd, "app.txt"), "after\n", "utf8");
    await session.commitPhase({ id: "testing", title: "Testing" });

    expect((await git(cwd, ["status", "--porcelain"])).trim()).toBe("");
    expect(
      (await git(cwd, ["show", "--name-only", "--pretty=", "HEAD"])).trim(),
    ).toBe("app.txt");
  });

  it("marks unresolved phase checkpoints as blocked", async () => {
    const cwd = await createInitializedRepository();
    const session = await prepareGit(cwd, silentReporter());
    await writeFile(resolve(cwd, "app.txt"), "unresolved\n", "utf8");

    await session.commitPhase({ id: "testing", title: "Testing" }, "blocked");

    expect((await git(cwd, ["log", "-1", "--pretty=%s"])).trim()).toBe(
      "pre2prod(testing): Testing (blocked)",
    );
  });

  it("requires git repository and prints git init hint", async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), "pre2prod-git-"));

    await expect(prepareGit(cwd, silentReporter())).rejects.toThrow(
      /Git repository not detected\.[\s\S]*git init/,
    );
  });

  it("fails with dirty tree", async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), "pre2prod-git-"));
    await git(cwd, ["init"]);
    await writeFile(resolve(cwd, "app.txt"), "before\n", "utf8");

    await expect(prepareGit(cwd, silentReporter())).rejects.toThrow(
      /Git working tree is not clean/,
    );
  });

  it("does not delete a pre-existing root plan during preparation", async () => {
    const cwd = await createInitializedRepository();
    await writeFile(resolve(cwd, "PRE2PROD_PLAN.md"), "user plan\n", "utf8");

    await expect(prepareGit(cwd, silentReporter())).rejects.toThrow(
      /Git working tree is not clean/,
    );
    expect(await readFile(resolve(cwd, "PRE2PROD_PLAN.md"), "utf8")).toBe(
      "user plan\n",
    );
  });

  it("uses the current branch and never commits in manual mode", async () => {
    const cwd = await createInitializedRepository();
    const branch = (await git(cwd, ["branch", "--show-current"])).trim();
    const head = (await git(cwd, ["rev-parse", "HEAD"])).trim();

    const session = await prepareGit(cwd, silentReporter(), {
      createBranch: false,
    });
    expect(session.branch).toBe(branch);

    await writeFile(resolve(cwd, "app.txt"), "after\n", "utf8");
    await session.commitPhase({ id: "testing", title: "Testing" });

    expect((await git(cwd, ["rev-parse", "HEAD"])).trim()).toBe(head);
    expect((await git(cwd, ["status", "--porcelain"])).trim()).toBe(
      "M app.txt",
    );
  });
});

async function createInitializedRepository(): Promise<string> {
  const cwd = await mkdtemp(resolve(tmpdir(), "pre2prod-git-"));
  await git(cwd, ["init"]);
  await writeFile(resolve(cwd, "app.txt"), "before\n", "utf8");
  await git(cwd, ["add", "app.txt"]);
  await git(cwd, [
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-m",
    "initial",
  ]);
  return cwd;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, { cwd, encoding: "utf8" });
  return result.stdout;
}

function silentReporter(): ProgressReporter {
  return {
    title() {},
    info() {},
    warning() {},
    phaseStarted() {},
    reviewing() {},
    needsWork() {},
    planning() {},
    working() {},
    phasePassed() {},
    command() {},
    thinking() {},
    result() {},
    filesTouched() {},
    waiting() {},
    verbose() {},
    completed() {},
    failed() {},
  };
}
