export interface LogStatsFilters {
  runId?: string;
  phaseId?: string;
}

export interface PhaseLogStats {
  id: string;
  title: string;
  runs: number;
  passed: number;
  blocked: number;
  incomplete: number;
  reviews: number;
  blockers: number;
  workerIterations: number;
}

export interface LogStats {
  runs: {
    total: number;
    completed: number;
    failed: number;
    incomplete: number;
  };
  totals: {
    reviews: number;
    blockers: number;
    workerIterations: number;
  };
  phases: PhaseLogStats[];
}

interface LogEvent {
  event?: unknown;
  runId?: unknown;
  phaseId?: unknown;
  phaseTitle?: unknown;
  blockersCount?: unknown;
}

interface MutablePhaseStats {
  id: string;
  title: string;
  reviews: number;
  blockers: number;
  workerIterations: number;
  passed: boolean;
  blocked: boolean;
}

export function buildLogStats(
  lines: readonly string[],
  filters: LogStatsFilters = {},
): LogStats {
  const events = lines.map(parseEvent).filter(isLogEvent);
  const eligibleRunIds = new Set(
    events
      .filter((event) => matchesRun(event, filters.runId))
      .filter((event) => matchesPhase(event, filters.phaseId))
      .map((event) => getString(event.runId))
      .filter((runId): runId is string => runId !== undefined),
  );
  const runStates = new Map<string, "completed" | "failed" | "incomplete">();
  const phases = new Map<string, MutablePhaseStats>();

  for (const event of events) {
    const runId = getString(event.runId);
    if (runId === undefined || !eligibleRunIds.has(runId)) {
      continue;
    }

    const eventName = getString(event.event);
    const currentRunState = runStates.get(runId);
    if (eventName === "pipeline.run.failed") {
      runStates.set(runId, "failed");
    } else if (
      eventName === "pipeline.run.completed" &&
      currentRunState !== "failed"
    ) {
      runStates.set(runId, "completed");
    } else if (currentRunState === undefined) {
      runStates.set(runId, "incomplete");
    }

    const phaseId = getString(event.phaseId);
    if (
      phaseId === undefined ||
      phaseId === "discovery" ||
      (filters.phaseId !== undefined && !phaseId.includes(filters.phaseId))
    ) {
      continue;
    }

    const key = `${runId}\0${phaseId}`;
    const phase = phases.get(key) ?? {
      id: phaseId,
      title: getString(event.phaseTitle) ?? phaseId,
      reviews: 0,
      blockers: 0,
      workerIterations: 0,
      passed: false,
      blocked: false,
    };
    const title = getString(event.phaseTitle);
    if (title !== undefined) {
      phase.title = title;
    }

    if (eventName === "phase.review.completed") {
      phase.reviews += 1;
      phase.blockers += getNonNegativeInteger(event.blockersCount) ?? 0;
    } else if (eventName === "phase.worker.forked") {
      phase.workerIterations += 1;
    } else if (eventName === "phase.review.passed") {
      phase.passed = true;
    } else if (eventName === "phase.review.max_iterations_reached") {
      phase.blocked = true;
    }
    phases.set(key, phase);
  }

  const phaseStats = aggregatePhases(phases.values());

  return {
    runs: {
      total: runStates.size,
      completed: countRunState(runStates, "completed"),
      failed: countRunState(runStates, "failed"),
      incomplete: countRunState(runStates, "incomplete"),
    },
    totals: {
      reviews: sum(phaseStats, (phase) => phase.reviews),
      blockers: sum(phaseStats, (phase) => phase.blockers),
      workerIterations: sum(phaseStats, (phase) => phase.workerIterations),
    },
    phases: phaseStats,
  };
}

export function formatLogStats(stats: LogStats): string[] {
  const lines = [
    `Runs: ${stats.runs.total} (completed ${stats.runs.completed}, failed ${stats.runs.failed}, incomplete ${stats.runs.incomplete})`,
    `Totals: ${count(stats.totals.reviews, "review")}, ${count(stats.totals.blockers, "blocker")}, ${count(stats.totals.workerIterations, "worker iteration")}`,
  ];

  if (stats.phases.length > 0) {
    lines.push("", "Phases:");
    for (const phase of stats.phases) {
      lines.push(
        `  ${phase.title} (${phase.id}): ${count(phase.runs, "run")} (${phase.passed} passed, ${phase.blocked} blocked, ${phase.incomplete} incomplete); ${count(phase.reviews, "review")}, ${count(phase.blockers, "blocker")}, ${count(phase.workerIterations, "worker iteration")}`,
      );
    }
  }

  return lines;
}

function count(value: number, singular: string): string {
  return `${value} ${singular}${value === 1 ? "" : "s"}`;
}

function aggregatePhases(phases: Iterable<MutablePhaseStats>): PhaseLogStats[] {
  const result = new Map<string, PhaseLogStats>();
  for (const phase of phases) {
    const aggregate = result.get(phase.id) ?? {
      id: phase.id,
      title: phase.title,
      runs: 0,
      passed: 0,
      blocked: 0,
      incomplete: 0,
      reviews: 0,
      blockers: 0,
      workerIterations: 0,
    };
    aggregate.title = phase.title;
    aggregate.runs += 1;
    aggregate.reviews += phase.reviews;
    aggregate.blockers += phase.blockers;
    aggregate.workerIterations += phase.workerIterations;
    if (phase.passed) {
      aggregate.passed += 1;
    } else if (phase.blocked) {
      aggregate.blocked += 1;
    } else {
      aggregate.incomplete += 1;
    }
    result.set(phase.id, aggregate);
  }
  return [...result.values()];
}

function parseEvent(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function isLogEvent(value: unknown): value is LogEvent {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function matchesRun(event: LogEvent, runId: string | undefined): boolean {
  return runId === undefined || getString(event.runId) === runId;
}

function matchesPhase(event: LogEvent, phaseId: string | undefined): boolean {
  if (phaseId === undefined) {
    return true;
  }
  const value = getString(event.phaseId);
  return value !== undefined && value.includes(phaseId);
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function countRunState(
  states: ReadonlyMap<string, "completed" | "failed" | "incomplete">,
  expected: "completed" | "failed" | "incomplete",
): number {
  return [...states.values()].filter((state) => state === expected).length;
}

function sum<T>(items: readonly T[], select: (item: T) => number): number {
  return items.reduce((total, item) => total + select(item), 0);
}
