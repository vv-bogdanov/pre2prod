import { describe, expect, it } from "vitest";

import { parseReviewResult } from "../src/reviewer.js";
import { phaseReviewPrompt } from "../src/prompts.js";

describe("parseReviewResult", () => {
  it("parses blockers and non_blockers", () => {
    expect(
      parseReviewResult(
        '{"blockers":["Missing tests"],"non_blockers":["Minor cleanup"]}',
      ),
    ).toEqual({
      blockers: ["Missing tests"],
      non_blockers: ["Minor cleanup"],
    });
  });

  it("enforces both arrays", () => {
    expect(() => parseReviewResult('{"blockers":["Only blockers"]}')).toThrow(
      /does not match required structure/i,
    );
  });

  it("requires exact object shape", () => {
    expect(() => parseReviewResult("not json")).toThrow(
      /Reviewer response is not valid JSON/i,
    );
  });

  it("rejects unknown fields", () => {
    expect(() =>
      parseReviewResult('{"blockers":[],"non_blockers":[],"status":"PASS"}'),
    ).toThrow(/does not match required structure/i);
  });
});

describe("phaseReviewPrompt", () => {
  it("classifies immutable external constraints as non-blockers", () => {
    const prompt = phaseReviewPrompt(
      {
        id: "delivery",
        title: "Delivery",
        reviewerPrompt: "Review delivery readiness.",
      },
      undefined,
      false,
    );

    expect(prompt).toContain(
      "classify unavailable credentials, hosted environments, external services, and host or sandbox limitations as non_blockers",
    );
    expect(prompt).toContain(
      "Put only material findings that justify another change cycle in blockers; put optional improvements in non_blockers.",
    );
  });
});
