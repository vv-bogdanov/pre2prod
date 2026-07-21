import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { Pre2prodError } from "../src/core/errors.js";
import { loadPhases } from "../src/phases.js";

describe("loadPhases", () => {
  const tempDirs: string[] = [];
  const originalHome = process.env.HOME;

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  });

  function newTempDir(prefix: string): Promise<string> {
    return mkdtemp(resolve(tmpdir(), prefix)).then((dir) => {
      tempDirs.push(dir);
      return dir;
    });
  }

  it("uses project phases first", async () => {
    const cwd = await newTempDir("pre2prod-phases-project-");
    const homeDir = await newTempDir("pre2prod-phases-home-");

    await writePhaseFile(resolve(cwd, ".pre2prod", "phases.yaml"), projectPhaseYaml("project"));
    await writePhaseFile(resolve(homeDir, ".pre2prod", "phases.yaml"), projectPhaseYaml("home"));
    process.env.HOME = homeDir;

    const phases = await loadPhases(cwd);

    expect(phases).toEqual([{ id: "project", title: "Project", reviewerPrompt: "From project" }]);
  });

  it("falls back to home when project is missing", async () => {
    const cwd = await newTempDir("pre2prod-phases-home-only-");
    const homeDir = await newTempDir("pre2prod-phases-home-only2-");

    await writePhaseFile(resolve(homeDir, ".pre2prod", "phases.yaml"), projectPhaseYaml("home"));
    process.env.HOME = homeDir;

    const phases = await loadPhases(cwd);

    expect(phases).toEqual([{ id: "home", title: "Home", reviewerPrompt: "From home" }]);
  });

  it("falls back to embedded phases when project and home are missing", async () => {
    const cwd = await newTempDir("pre2prod-phases-internal-");
    const homeDir = await newTempDir("pre2prod-phases-home-missing-");

    process.env.HOME = homeDir;

    const phases = await loadPhases(cwd);

    expect(phases[0]?.id).toBe("reproducibility-build");
    expect(phases).toHaveLength(6);
  });

  it("merges included phase files and allows local overrides", async () => {
    const cwd = await newTempDir("pre2prod-phases-include-");
    const basePath = resolve(cwd, ".pre2prod", "base.yaml");
    const projectConfig =
      "include:\n  - ./base.yaml\n" +
      "phases:\n" +
      "  - id: base\n    title: Base overridden\n    reviewerPrompt: Local override\n" +
      "  - id: local\n    title: Local\n    reviewerPrompt: Local only\n";

    await writePhaseFile(basePath, "phases:\n  - id: base\n    title: Base\n    reviewerPrompt: Base phase\n");
    await writePhaseFile(resolve(cwd, ".pre2prod", "phases.yaml"), projectConfig);

    const phases = await loadPhases(cwd);

    expect(phases).toEqual([
      { id: "base", title: "Base overridden", reviewerPrompt: "Local override" },
      { id: "local", title: "Local", reviewerPrompt: "Local only" },
    ]);
  });

  it("fails on circular include", async () => {
    const cwd = await newTempDir("pre2prod-phases-cycle-");
    const top = resolve(cwd, ".pre2prod", "phases.yaml");
    const includeA = resolve(cwd, ".pre2prod", "a.yaml");
    const includeB = resolve(cwd, ".pre2prod", "b.yaml");

    await writePhaseFile(top, "include:\n  - ./a.yaml\n");
    await writePhaseFile(includeA, "include:\n  - ./b.yaml\nphases:\n  - id: a\n    title: A\n    reviewerPrompt: from a\n");
    await writePhaseFile(includeB, "include:\n  - ./a.yaml\nphases:\n  - id: b\n    title: B\n    reviewerPrompt: from b\n");

    await expect(loadPhases(cwd)).rejects.toThrow(/circular/i);
  });

  it("fails when yaml cannot be parsed", async () => {
    const cwd = await newTempDir("pre2prod-phases-parse-error-");

    await writePhaseFile(resolve(cwd, ".pre2prod", "phases.yaml"), "phases: [ [\n");

    await expect(loadPhases(cwd)).rejects.toThrow(Pre2prodError);
  });

  it("fails when document structure is invalid", async () => {
    const cwd = await newTempDir("pre2prod-phases-shape-error-");

    await writePhaseFile(
      resolve(cwd, ".pre2prod", "phases.yaml"),
      "phases:\n  - id: 1\n    title: 2\n    reviewerPrompt: 3\n",
    );

    await expect(loadPhases(cwd)).rejects.toThrow(Pre2prodError);
  });
});

async function writePhaseFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

function projectPhaseYaml(label: string): string {
  return `phases:\n  - id: ${label}\n    title: ${label[0]?.toUpperCase() ?? ""}${label.slice(1)}\n    reviewerPrompt: From ${label}\n`;
}
