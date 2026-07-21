import type { Phase } from "./core/types.js";

const BASE_PROMPT = `You are preparing the current repository for real staging and future production use.

Work autonomously. Do not ask the user questions.

Infer languages, frameworks, architecture, commands, and appropriate tools from the repository itself.

Follow KISS and YAGNI:
- preserve working behavior;
- prefer existing tools and conventions;
- make the minimum sufficient change;
- avoid speculative abstractions;
- avoid unnecessary dependencies and infrastructure;
- do not rewrite the project for architectural aesthetics.

Aim for necessary and sufficient quality for the application's actual type and scale, not theoretical perfection.

Inspect real files and real command results. Never claim success based only on reasoning.

Do not perform destructive production operations. Do not use or expose production secrets. If external credentials are unavailable, prepare everything possible locally, document the remaining external action, and continue.`;

const REVIEWER_DIRECTION = `You are the persistent senior reviewer for the entire run. Maintain a high-level understanding of the project across phases. Review the actual current repository independently. Do not trust claims from workers. Fail a phase only for material readiness gaps. Do not modify application files.`;

export function initialDiscoveryPrompt(instructions?: string): string {
  return joinPrompts(
    BASE_PROMPT,
    REVIEWER_DIRECTION,
    `First, study the repository as a whole. Understand its purpose, languages, frameworks, entry points, critical user and business flows, data stores, external integrations, trust boundaries, build/test/lint/deploy commands, architecture, and repository instructions. Keep this understanding in your context for later phases. Do not modify files. Respond with a concise factual summary.`,
    userInstructions(instructions),
  );
}

export function phaseReviewPrompt(
  phase: Phase,
  instructions: string | undefined,
  isRepeat: boolean,
): string {
  const repeatDirection = isRepeat
    ? `A worker has completed changes in a separate fork. You did not receive its transcript. Re-read the current repository and perform a complete review of this phase again. Do not limit yourself to previous findings and do not assume the changes are correct.`
    : `Perform a complete review of the current repository for this phase.`;

  return joinPrompts(
    BASE_PROMPT,
    REVIEWER_DIRECTION,
    `Current phase: ${phase.title}\n\n${phase.reviewerPrompt}`,
    repeatDirection,
    `Return only a JSON object matching the provided schema. Use PASS when there are no material gaps. Use NEEDS_WORK and list only material findings otherwise.`,
    userInstructions(instructions),
  );
}

export function workerPlanningPrompt(phase: Phase, instructions?: string): string {
  return joinPrompts(
    BASE_PROMPT,
    `You are a disposable worker forked from the review that found material gaps in the phase "${phase.title}". You understand the review context and current repository.`,
    `Planning stage: investigate the relevant code and write a complete, minimal, executable remediation plan to PRE2PROD_PLAN.md in the repository root. Overwrite the file if it exists. Include the changes, order, checks, and completion condition. Do not modify any other project file during this turn.`,
    userInstructions(instructions),
  );
}

export function workerExecutionPrompt(phase: Phase, instructions?: string): string {
  return joinPrompts(
    BASE_PROMPT,
    `Execution stage for phase "${phase.title}": read PRE2PROD_PLAN.md and execute it completely. Modify the repository, run relevant checks, and fix failures until the plan is complete or genuinely blocked by an unavailable external dependency. Do not ask questions. Do not broaden the work beyond the plan without a concrete necessity.`,
    userInstructions(instructions),
  );
}

function userInstructions(instructions?: string): string | undefined {
  const value = instructions?.trim();
  return value ? `Additional user direction for the whole run:\n${value}` : undefined;
}

function joinPrompts(...parts: (string | undefined)[]): string {
  return parts.filter((part): part is string => Boolean(part?.trim())).join("\n\n---\n\n");
}
