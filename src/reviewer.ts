import { z } from "zod";

import type { ReviewResult } from "./core/types.js";
import { Pre2prodError } from "./core/errors.js";

const reviewSchema = z.object({
  status: z.enum(["PASS", "NEEDS_WORK"]),
  findings: z.array(z.string()).default([]),
  summary: z.string().optional(),
});

export const REVIEW_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["PASS", "NEEDS_WORK"] },
    findings: {
      type: "array",
      items: { type: "string" },
    },
    summary: { type: "string" },
  },
  required: ["status", "findings"],
  additionalProperties: false,
};

export function parseReviewResult(text: string): ReviewResult {
  const trimmed = text.trim();

  try {
    const parsed: unknown = JSON.parse(trimmed);
    const result = reviewSchema.parse(parsed);
    return normalize(result);
  } catch {
    // Keep a plain-text fallback for protocol/model compatibility.
  }

  const lines = trimmed.split(/\r?\n/).map((line) => line.trim());
  const first = lines[0]?.toUpperCase();

  if (first !== "PASS" && first !== "NEEDS_WORK") {
    throw new Pre2prodError(`Reviewer response cannot be classified: ${trimmed.slice(0, 240)}`);
  }

  const findings = lines
    .slice(1)
    .map((line) => line.replace(/^[-*\d.)\s]+/, "").trim())
    .filter(Boolean);

  return normalize({ status: first, findings });
}

function normalize(result: ReviewResult): ReviewResult {
  if (result.status === "PASS") {
    return { ...result, findings: [] };
  }

  return {
    ...result,
    findings: result.findings.map((finding) => finding.trim()).filter(Boolean),
  };
}
