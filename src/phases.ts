import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

import { Pre2prodError } from "./core/errors.js";
import type { Phase } from "./core/types.js";

const INTERNAL_PHASES_PATH = fileURLToPath(
  new URL("../resources/phases.yaml", import.meta.url),
);

export async function loadPhases(cwd: string): Promise<readonly Phase[]> {
  const fromProject = await tryLoadPhases(
    resolve(cwd, ".pre2prod", "phases.yaml"),
  );
  if (fromProject !== undefined) {
    return fromProject;
  }

  const fromHome = await tryLoadPhases(
    resolve(homedir(), ".pre2prod", "phases.yaml"),
  );
  if (fromHome !== undefined) {
    return fromHome;
  }

  return loadPhasesFromFile(INTERNAL_PHASES_PATH, new Set());
}

async function tryLoadPhases(
  path: string,
): Promise<readonly Phase[] | undefined> {
  try {
    return await loadPhasesFromFile(path, new Set());
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }
    throw error;
  }
}

async function loadPhasesFromFile(
  path: string,
  stack: Set<string>,
): Promise<readonly Phase[]> {
  const absolutePath = resolve(path);
  if (stack.has(absolutePath)) {
    throw new Pre2prodError(
      `Detected circular phases include while resolving ${absolutePath}: ${[...stack, absolutePath].join(" -> ")}`,
    );
  }

  stack.add(absolutePath);

  try {
    let rawContent: string;
    try {
      rawContent = await readFile(absolutePath, "utf8");
    } catch (error) {
      if (isMissingFileError(error)) {
        throw error;
      }
      throw new Pre2prodError(`Failed to read phase config ${absolutePath}`, {
        cause: error,
      });
    }

    let parsed: unknown;
    try {
      parsed = parse(rawContent);
    } catch (error) {
      throw new Pre2prodError(`Failed to parse YAML in ${absolutePath}`, {
        cause: error,
      });
    }

    const document = parsePhaseDocument(parsed, absolutePath);

    let phases: Phase[] = [];
    for (const include of document.include) {
      const includedPath = resolve(dirname(absolutePath), include);
      try {
        const includedPhases = await loadPhasesFromFile(includedPath, stack);
        phases = mergePhases(phases, includedPhases);
      } catch (error) {
        throw new Pre2prodError(
          `Failed to process include "${includedPath}" from ${absolutePath}: ${getErrorMessage(error)}`,
          { cause: error },
        );
      }
    }

    return mergePhases(phases, document.phases);
  } finally {
    stack.delete(absolutePath);
  }
}

function parsePhaseDocument(raw: unknown, path: string): PhaseConfig {
  if (raw === null || raw === undefined) {
    throw new Pre2prodError(
      `Invalid phase document in ${path}: expected an object or an array`,
    );
  }

  if (Array.isArray(raw)) {
    return { include: [], phases: parsePhases(raw, path, "root list") };
  }

  if (!isRecord(raw)) {
    throw new Pre2prodError(
      `Invalid phase document in ${path}: expected an object or an array`,
    );
  }

  const include = parseInclude(raw.include, path);
  const phasesFromList = parsePhases(raw.phases, path, "phases");
  const phasesFromMap = parsePhaseRecords(raw, path, "root object");
  const phases = mergePhases(phasesFromList, phasesFromMap);
  return { include, phases };
}

function parseInclude(rawInclude: unknown, path: string): readonly string[] {
  if (rawInclude === undefined) {
    return [];
  }

  if (typeof rawInclude === "string") {
    return [rawInclude];
  }

  if (Array.isArray(rawInclude)) {
    const includes = rawInclude.map((item, index) => {
      if (typeof item !== "string" || item.trim() === "") {
        throw new Pre2prodError(
          `Invalid include at index ${index} in ${path}; include entries must be non-empty strings`,
        );
      }
      return item;
    });
    return includes;
  }

  throw new Pre2prodError(
    `Invalid include in ${path}; expected a string or list of strings`,
  );
}

function parsePhases(
  rawPhases: unknown,
  path: string,
  propertyPath: string,
): readonly Phase[] {
  if (rawPhases === undefined) {
    return [];
  }

  if (!Array.isArray(rawPhases)) {
    throw new Pre2prodError(
      `Invalid ${propertyPath} in ${path}; expected a list of phases`,
    );
  }

  return rawPhases.map((rawPhase, index) => {
    if (!isRecord(rawPhase)) {
      throw new Pre2prodError(
        `Invalid phase at ${propertyPath}[${index}] in ${path}; expected an object`,
      );
    }

    const title = toNonEmptyString(
      rawPhase.title,
      `${propertyPath}[${index}].title`,
      path,
    );
    const id = extractPhaseId(
      rawPhase,
      `${propertyPath}[${index}]`,
      path,
      title,
    );
    const reviewerPrompt = toNonEmptyString(
      rawPhase.reviewerPrompt,
      `${propertyPath}[${index}].reviewerPrompt`,
      path,
    );

    return { id, title, reviewerPrompt };
  });
}

function parsePhaseRecords(
  raw: Record<string, unknown>,
  path: string,
  propertyPath: string,
): readonly Phase[] {
  const phases: Phase[] = [];
  for (const [phaseId, phaseConfig] of Object.entries(raw)) {
    if (phaseId === "include" || phaseId === "phases") {
      continue;
    }

    const id = toPhaseId(phaseId);
    const titleFromKey = inferPhaseTitleFromKey(phaseId);
    if (typeof phaseConfig === "string") {
      const reviewerPrompt = toNonEmptyString(
        phaseConfig,
        `${propertyPath}.${phaseId}.reviewerPrompt`,
        path,
      );
      phases.push({
        id,
        title: titleFromKey,
        reviewerPrompt,
      });
      continue;
    }

    if (!isRecord(phaseConfig)) {
      throw new Pre2prodError(
        `Invalid phase at ${propertyPath}.${phaseId} in ${path}; expected an object or string`,
      );
    }

    const title = phaseConfig.title
      ? toNonEmptyString(
          phaseConfig.title,
          `${propertyPath}.${phaseId}.title`,
          path,
        )
      : titleFromKey;
    const reviewerPrompt = toNonEmptyString(
      phaseConfig.reviewerPrompt,
      `${propertyPath}.${phaseId}.reviewerPrompt`,
      path,
    );
    phases.push({ id, title, reviewerPrompt });
  }
  return phases;
}

function inferPhaseTitleFromKey(key: string): string {
  const titleFromKey = key.trim();
  if (titleFromKey.includes(" ")) {
    return titleFromKey;
  }

  return slugToTitle(titleFromKey);
}

function toNonEmptyString(
  value: unknown,
  fieldPath: string,
  sourcePath: string,
): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Pre2prodError(
      `Invalid ${fieldPath} in ${sourcePath}; expected a non-empty string`,
    );
  }

  return value.trim();
}

function extractPhaseId(
  rawPhase: Record<string, unknown>,
  propertyPath: string,
  sourcePath: string,
  title: string,
): string {
  const rawId = rawPhase.id;
  if (rawId === undefined) {
    return toPhaseId(title);
  }
  return toNonEmptyString(rawId, `${propertyPath}.id`, sourcePath);
}

function toPhaseId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/["'`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function slugToTitle(value: string): string {
  return value
    .trim()
    .replace(/[-_]+/g, " ")
    .split(" ")
    .filter((segment) => segment.length > 0)
    .map((segment) => `${segment[0]?.toUpperCase() ?? ""}${segment.slice(1)}`)
    .join(" ");
}

function mergePhases(
  base: readonly Phase[],
  override: readonly Phase[],
): Phase[] {
  const merged = [...base];

  for (const phase of override) {
    const index = merged.findIndex((current) => current.id === phase.id);
    if (index === -1) {
      merged.push(phase);
      continue;
    }
    merged[index] = phase;
  }

  return merged;
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return isRecord(error) && error.code === "ENOENT";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface PhaseConfig {
  include: readonly string[];
  phases: readonly Phase[];
}
