import { z } from "zod";

import type { ReviewResult } from "./core/types.js";
import { Pre2prodError } from "./core/errors.js";

const reviewSchema = z
  .object({
    blockers: z.array(z.string()),
    non_blockers: z.array(z.string()),
  })
  .strict();

export const REVIEW_RESULT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    blockers: {
      type: "array",
      items: { type: "string" },
    },
    non_blockers: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["blockers", "non_blockers"],
  additionalProperties: false,
};

export function parseReviewResult(text: string): ReviewResult {
  const trimmed = text.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new Pre2prodError(
      `Reviewer response is not valid JSON: ${trimmed.slice(0, 240)}`,
      { cause: error },
    );
  }

  const parsedResult = reviewSchema.safeParse(parsed);
  if (!parsedResult.success) {
    throw new Pre2prodError(
      `Reviewer response does not match required structure: ${parsedResult.error.message}`,
    );
  }

  return {
    blockers: parsedResult.data.blockers
      .map((item) => item.trim())
      .filter(Boolean),
    non_blockers: parsedResult.data.non_blockers
      .map((item) => item.trim())
      .filter(Boolean),
  };
}
