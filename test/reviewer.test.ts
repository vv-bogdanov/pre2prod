import { describe, expect, it } from "vitest";

import { parseReviewResult } from "../src/reviewer.js";

describe("parseReviewResult", () => {
  it("parses structured output", () => {
    expect(parseReviewResult('{"status":"NEEDS_WORK","findings":["Missing tests"]}')).toEqual({
      status: "NEEDS_WORK",
      findings: ["Missing tests"],
    });
  });

  it("supports a plain-text fallback", () => {
    expect(parseReviewResult("NEEDS_WORK\n- Missing tests\n2. Missing CI")).toEqual({
      status: "NEEDS_WORK",
      findings: ["Missing tests", "Missing CI"],
    });
  });

  it("clears findings for PASS", () => {
    expect(parseReviewResult('{"status":"PASS","findings":["ignored"]}')).toEqual({
      status: "PASS",
      findings: [],
    });
  });

  it("rejects unclassifiable responses", () => {
    expect(() => parseReviewResult("Looks mostly fine")).toThrow(/cannot be classified/i);
  });
});
