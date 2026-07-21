import { describe, expect, it } from "vitest";

import { Pre2prodError } from "../src/core/errors.js";
import type { Phase } from "../src/core/types.js";
import {
  collectPhaseIds,
  formatPhaseList,
  parsePhaseIds,
  selectPhases,
} from "../src/phase-selection.js";

const phases: readonly Phase[] = [
  { id: "reproducibility-and-build", title: "Reproducibility and build", reviewerPrompt: "x" },
  { id: "testing", title: "Testing", reviewerPrompt: "x" },
  { id: "security", title: "Security", reviewerPrompt: "x" },
];

describe("phase selection", () => {
  it("selects all phases by default", () => {
    expect(selectPhases(phases)).toEqual(phases);
  });

  it("parses comma separated phase ids", () => {
    expect(parsePhaseIds("testing, security")).toEqual(["testing", "security"]);
    expect(collectPhaseIds("testing,security", ["security"])).toEqual([
      "security",
      "testing",
      "security",
    ]);
  });

  it("selects included phases in user order", () => {
    expect(selectPhases(phases, ["security", "testing"])).toEqual([
      phases[2],
      phases[1],
    ]);
  });

  it("deduplicates duplicated includes", () => {
    expect(selectPhases(phases, ["testing", "security", "testing"])).toEqual([
      phases[1],
      phases[2],
    ]);
  });

  it("supports the all alias", () => {
    expect(selectPhases(phases, ["all"], ["testing"])).toEqual([
      phases[0],
      phases[2],
    ]);
  });

  it("excludes selected phases", () => {
    expect(selectPhases(phases, [], ["security"])).toEqual([
      phases[0],
      phases[1],
    ]);
  });

  it("throws on unknown include ids", () => {
    expect(() => selectPhases(phases, ["unknown"], [])).toThrow(
      /--phases references unknown phase id\(s\): unknown\./,
    );
  });

  it("throws on unknown exclude ids", () => {
    expect(() => selectPhases(phases, [], ["unknown"])).toThrow(
      /--exclude references unknown phase id\(s\): unknown\./,
    );
  });

  it("throws if result becomes empty", () => {
    expect(() => selectPhases(phases, ["testing"], ["testing"])).toThrow(
      Pre2prodError,
    );
  });

  it("formats phase list", () => {
    expect(formatPhaseList(phases)).toEqual([
      "1) reproducibility-and-build — Reproducibility and build",
      "2) testing — Testing",
      "3) security — Security",
    ]);
  });
});
