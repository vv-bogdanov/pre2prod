import { Pre2prodError } from "./core/errors.js";
import type { Phase } from "./core/types.js";

const PHASE_ALL_ALIASES = new Set(["all", "*", "__all__"]);

export function collectPhaseIds(value: string, previous: string[] = []): string[] {
  const parsed = parsePhaseIds(value);
  return [...previous, ...parsed];
}

export function parsePhaseIds(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

export function selectPhases(
  allPhases: readonly Phase[],
  include: readonly string[] = [],
  exclude: readonly string[] = [],
): readonly Phase[] {
  const availableById = new Map(allPhases.map((phase) => [phase.id, phase]));
  const availableIds = [...availableById.keys()];

  if (include.length > 0 && include.some((id) => PHASE_ALL_ALIASES.has(id))) {
    include = include.filter((id) => !PHASE_ALL_ALIASES.has(id));
  }

  const includedIds = include.length > 0 ? include : availableIds;
  validateKnownIds("--phases", includedIds, availableIds);

  const selected = include.length === 0
    ? [...allPhases]
    : uniqueFromSource(includedIds).map((id) => {
      const phase = availableById.get(id);
      if (!phase) {
        throw new Error("Unreachable: validation did not prevent missing phase");
      }
      return phase;
    });

  const excludeSet = new Set(exclude.map((id) => id.trim().toLowerCase()).filter(Boolean));
  validateKnownIds("--exclude", [...excludeSet], availableIds);

  const result = selected.filter((phase) => !excludeSet.has(phase.id));

  if (result.length === 0) {
    throw new Pre2prodError("No phases remain after applying include/exclude filters.");
  }

  return result;
}

export function formatPhaseList(phases: readonly Phase[]): string[] {
  return phases.map((phase, index) => `${index + 1}) ${phase.id} — ${phase.title}`);
}

function uniqueFromSource(items: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    if (seen.has(item)) {
      continue;
    }
    seen.add(item);
    result.push(item);
  }
  return result;
}

function validateKnownIds(flag: string, ids: readonly string[], availableIds: readonly string[]): void {
  if (ids.length === 0) {
    return;
  }

  const known = new Set(availableIds);
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length === 0) {
    return;
  }

  throw new Pre2prodError(
    `${flag} references unknown phase id(s): ${unknown.join(", ")}.
` +
      `Available ids: ${availableIds.join(", ")}`,
  );
}
