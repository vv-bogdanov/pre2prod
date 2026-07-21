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
  const phaseLookup = new Set(availableIds);

  if (include.length > 0 && include.some((id) => PHASE_ALL_ALIASES.has(id))) {
    include = include.filter((id) => !PHASE_ALL_ALIASES.has(id));
  }

  const includeResolution =
    include.length > 0
      ? resolveSelectorsToPhaseIds(include, allPhases, phaseLookup)
      : null;

  const includedIds =
    includeResolution ? includeResolution.resolvedIds : availableIds;
  if (include.length > 0) {
    validateKnownIds("--phases", availableIds, includeResolution?.unmatchedSelectors ?? []);
  }

  const selected = include.length === 0
    ? [...allPhases]
    : uniqueFromSource(includedIds).map((id) => {
      const phase = availableById.get(id);
      if (!phase) {
        throw new Error("Unreachable: validation did not prevent missing phase");
      }
      return phase;
    });

  const excludeResolution = exclude.length > 0
    ? resolveSelectorsToPhaseIds(exclude, allPhases, phaseLookup)
    : null;

  const resolvedExcludes = excludeResolution ? excludeResolution.resolvedIds : [];
  if (exclude.length > 0) {
    validateKnownIds("--exclude", availableIds, excludeResolution?.unmatchedSelectors ?? []);
  }

  const excludeSet = new Set(resolvedExcludes.map((id) => id.trim().toLowerCase()).filter(Boolean));

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

function resolveSelectorsToPhaseIds(
  selectors: readonly string[],
  allPhases: readonly Phase[],
  available: Set<string>,
): { readonly resolvedIds: string[]; readonly unmatchedSelectors: string[] } {
  const resolved: string[] = [];
  const seen = new Set<string>();
  const unmatched: string[] = [];

  for (const selector of selectors) {
    const normalized = selector.trim().toLowerCase();
    if (!normalized) {
      continue;
    }

    let matched = false;
    if (available.has(normalized)) {
      if (!seen.has(normalized)) {
        seen.add(normalized);
        resolved.push(normalized);
      }
      matched = true;
    }

    const prefix = `${normalized}-`;
    for (const phase of allPhases) {
      if (phase.id.startsWith(prefix) && !seen.has(phase.id)) {
        seen.add(phase.id);
        resolved.push(phase.id);
        matched = true;
      }
    }

    if (!matched) {
      unmatched.push(normalized);
    }
  }

  return { resolvedIds: resolved, unmatchedSelectors: unmatched };
}

function validateKnownIds(
  flag: string,
  selectors: readonly string[],
  unmatchedSelectors: readonly string[],
): void {
  if (unmatchedSelectors.length === 0) {
    return;
  }

  throw new Pre2prodError(
    `${flag} references unknown phase id(s): ${unmatchedSelectors.join(", ")}.
Available ids: ${selectors.join(", ")}`,
  );
}
