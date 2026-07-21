import type {
  AgentRuntime,
  ThreadGoal,
  ThreadGoalRequest,
  ThreadGoalStatus,
  ProgressReporter,
  ThreadRef,
  TurnLogContext,
  TurnRequest,
  TurnResult,
} from "../core/types.js";
import { ProtocolError, TurnFailedError } from "../core/errors.js";
import {
  JsonRpcProcessClient,
  type JsonRpcClientOptions,
} from "./json-rpc-client.js";
import type { RunLogger } from "../logging.js";

interface ThreadResponse {
  thread: {
    id: string;
    sessionId?: string;
  };
}

interface TurnStartResponse {
  turn: {
    id: string;
  };
}

interface ThreadGoalResponse {
  goal: ThreadGoal;
}

interface ThreadGoalGetResponse {
  goal: ThreadGoal | null;
}

interface ThreadGoalClearResponse {
  cleared: boolean;
}

interface TurnCollector {
  turnId: string;
  text: string;
  diff: string | undefined;
  usage: Record<string, unknown> | undefined;
  threadId: string;
  logContext: TurnLogContext | undefined;
  resolve(result: TurnResult): void;
  reject(reason: unknown): void;
}

export interface AppServerRuntimeOptions extends JsonRpcClientOptions {
  reporter?: ProgressReporter;
  model?: string;
  modelProvider?: string;
  clientVersion?: string;
  logger?: RunLogger;
}

export class AppServerRuntime implements AgentRuntime {
  readonly #client: JsonRpcProcessClient;
  readonly #reporter: ProgressReporter | undefined;
  readonly #model: string | undefined;
  readonly #modelProvider: string | undefined;
  readonly #clientVersion: string;
  readonly #logger: RunLogger | undefined;
  readonly #collectors = new Map<string, TurnCollector>();
  readonly #settledTurnIds = new Set<string>();
  readonly #earlyEvents = new Map<
    string,
    { method: string; params: unknown }[]
  >();
  #initialized = false;
  #unsubscribe: (() => void) | undefined;
  #unsubscribeFailure: (() => void) | undefined;

  public constructor(options: AppServerRuntimeOptions) {
    this.#reporter = options.reporter;
    this.#model = options.model;
    this.#modelProvider = options.modelProvider;
    this.#clientVersion = options.clientVersion ?? "0.1.0";
    this.#logger = options.logger;
    this.#client = new JsonRpcProcessClient(options);
    this.#unsubscribeFailure = this.#client.onFailure((error) =>
      this.#failActiveTurns(error),
    );
  }

  public async initialize(): Promise<void> {
    if (this.#initialized) {
      this.#logger?.log("debug", "runtime.initialize.skipped");
      return;
    }

    this.#logger?.log("debug", "runtime.initialize.start");
    await this.#client.start();
    this.#unsubscribe = this.#client.onNotification((method, params) =>
      this.#onNotification(method, params),
    );

    await this.#client.request("initialize", {
      clientInfo: {
        name: "pre2prod",
        title: "Pre2Prod",
        version: this.#clientVersion,
      },
      capabilities: null,
    });
    this.#client.notify("initialized", {});
    this.#logger?.log("debug", "runtime.initialize.complete");
    this.#initialized = true;
  }

  public async startThread(options: {
    cwd: string;
    model?: string;
  }): Promise<ThreadRef> {
    this.#assertInitialized();
    const response = parseThreadResponse(
      await this.#client.request<unknown>("thread/start", {
        cwd: options.cwd,
        model: options.model ?? this.#model,
        ...(this.#modelProvider ? { modelProvider: this.#modelProvider } : {}),
        approvalPolicy: "never",
        sandbox: "read-only",
        serviceName: "pre2prod",
      }),
      "thread/start",
    );
    this.#logger?.log("debug", "runtime.thread.start", {
      threadId: response.thread.id,
      cwd: options.cwd,
      requestedModel: options.model ?? this.#model,
      requestedModelProvider: this.#modelProvider,
    });
    return {
      id: response.thread.id,
      ...(response.thread.sessionId
        ? { sessionId: response.thread.sessionId }
        : {}),
    };
  }

  public async forkThread(
    threadId: string,
    lastTurnId: string,
  ): Promise<ThreadRef> {
    this.#assertInitialized();
    const response = parseThreadResponse(
      await this.#client.request<unknown>("thread/fork", {
        threadId,
        lastTurnId,
        // App Server goals are unavailable on ephemeral threads. The pipeline
        // still treats this worker as disposable and never resumes it.
        ephemeral: false,
      }),
      "thread/fork",
    );
    this.#logger?.log("debug", "runtime.thread.fork", {
      parentThreadId: threadId,
      sourceTurnId: lastTurnId,
      forkedThreadId: response.thread.id,
    });
    return {
      id: response.thread.id,
      ...(response.thread.sessionId
        ? { sessionId: response.thread.sessionId }
        : {}),
    };
  }

  public async runTurn(request: TurnRequest): Promise<TurnResult> {
    this.#assertInitialized();
    const logContext = request.logContext;

    const response = parseTurnStartResponse(
      await this.#client.request<unknown>("turn/start", {
        threadId: request.threadId,
        input: [{ type: "text", text: request.prompt }],
        cwd: request.cwd,
        approvalPolicy: "never",
        sandboxPolicy:
          request.sandbox === "read-only"
            ? { type: "readOnly", networkAccess: false }
            : {
                type: "workspaceWrite",
                writableRoots: [request.cwd],
                networkAccess: request.networkAccess ?? true,
                excludeTmpdirEnvVar: true,
                excludeSlashTmp: true,
              },
        model: this.#model,
        ...(request.outputSchema ? { outputSchema: request.outputSchema } : {}),
      }),
      "turn/start",
    );
    this.#logger?.log("info", "runtime.turn.started", {
      turnId: response.turn.id,
      threadId: request.threadId,
      sandbox: request.sandbox,
      hasOutputSchema: request.outputSchema !== undefined,
      networkAccess: request.networkAccess ?? true,
      ...logContext,
    });

    const turnId = response.turn.id;
    const result = new Promise<TurnResult>((resolve, reject) => {
      this.#collectors.set(turnId, {
        turnId,
        text: "",
        diff: undefined,
        usage: undefined,
        threadId: request.threadId,
        logContext,
        resolve,
        reject,
      });
    });

    const early = this.#earlyEvents.get(turnId);
    if (early) {
      this.#earlyEvents.delete(turnId);
      for (const event of early) {
        this.#applyNotification(event.method, event.params);
      }
    }

    return await result;
  }

  public async setThreadGoal(
    threadId: string,
    goal: ThreadGoalRequest,
  ): Promise<ThreadGoal> {
    this.#assertInitialized();
    this.#logger?.log("debug", "runtime.goal.set", {
      threadId,
      objective: goal.objective,
      status: goal.status,
    });
    const response = parseThreadGoalResponse(
      await this.#client.request<unknown>("thread/goal/set", {
        threadId,
        ...(goal.objective !== undefined ? { objective: goal.objective } : {}),
        ...(goal.status !== undefined ? { status: goal.status } : {}),
        ...(goal.tokenBudget !== undefined
          ? { tokenBudget: goal.tokenBudget }
          : {}),
      }),
      "thread/goal/set",
    );
    return response.goal;
  }

  public async getThreadGoal(threadId: string): Promise<ThreadGoal | null> {
    this.#assertInitialized();
    this.#logger?.log("debug", "runtime.goal.get", { threadId });
    const response = parseThreadGoalGetResponse(
      await this.#client.request<unknown>("thread/goal/get", { threadId }),
      "thread/goal/get",
    );
    return response.goal;
  }

  public async clearThreadGoal(threadId: string): Promise<boolean> {
    this.#assertInitialized();
    this.#logger?.log("debug", "runtime.goal.clear", { threadId });
    const response = parseThreadGoalClearResponse(
      await this.#client.request<unknown>("thread/goal/clear", { threadId }),
      "thread/goal/clear",
    );
    return response.cleared;
  }

  public async close(): Promise<void> {
    this.#logger?.log("debug", "runtime.close.start");
    this.#unsubscribe?.();
    this.#unsubscribeFailure?.();
    await this.#client.close();
    this.#logger?.log("debug", "runtime.close.complete");
  }

  #onNotification(method: string, params: unknown): void {
    if (method === "thread/goal/updated") {
      this.#applyNotification(method, params);
      return;
    }

    const turnId = getTurnId(params);
    if (turnId && this.#settledTurnIds.has(turnId)) {
      return;
    }
    if (turnId && !this.#collectors.has(turnId)) {
      const events = this.#earlyEvents.get(turnId) ?? [];
      events.push({ method, params });
      this.#earlyEvents.set(turnId, events);
      return;
    }

    this.#applyNotification(method, params);
  }

  #applyNotification(method: string, params: unknown): void {
    if (method === "thread/goal/updated") {
      this.#applyGoalUpdated(params);
      return;
    }

    const turnId = getTurnId(params);
    if (!turnId) {
      if (method === "thread/goal/cleared") {
        return;
      }
      if (method === "warning" || method === "configWarning") {
        const message = getMessage(params) ?? method;
        this.#reporter?.warning(message);
        this.#logger?.log("warn", "runtime.warning", { message });
      }
      return;
    }

    const collector = this.#collectors.get(turnId);
    if (!collector) {
      return;
    }

    if (method === "item/reasoning/summaryTextDelta") {
      const delta = getString(params, "delta");
      if (delta) {
        this.#logger?.log("debug", "runtime.turn.reasoning_summary", {
          ...this.#collectorContext(collector),
          turnId,
          deltaLength: delta.length,
        });
      }
      return;
    }

    if (method === "item/agentMessage/delta") {
      const delta = getString(params, "delta");
      if (delta) {
        this.#logger?.log("debug", "runtime.turn.delta", {
          ...this.#collectorContext(collector),
          turnId,
          deltaLength: delta.length,
        });
      }
      return;
    }

    if (method === "item/started") {
      const item = getObject(params, "item");
      if (item?.type === "commandExecution") {
        const command =
          typeof item.command === "string" ? item.command : "command";
        this.#reporter?.command(
          command,
          "running",
          this.#collectorContext(collector),
        );
        this.#logger?.log("info", "runtime.command.started", {
          ...this.#collectorContext(collector),
          turnId,
          command,
        });
      }
      return;
    }

    if (method === "item/completed") {
      const item = getObject(params, "item");
      if (!item) {
        return;
      }
      if (item.type === "agentMessage" && typeof item.text === "string") {
        collector.text = item.text;
      } else if (item.type === "reasoning") {
        for (const summary of extractReasoningSummaries(item)) {
          this.#reporter?.thinking(summary, this.#collectorContext(collector));
        }
      }
      if (item.type === "commandExecution") {
        const command =
          typeof item.command === "string" ? item.command : "command";
        const status =
          typeof item.status === "string" ? item.status : undefined;
        this.#reporter?.command(
          command,
          status,
          this.#collectorContext(collector),
        );
        this.#logger?.log("info", "runtime.command", {
          ...this.#collectorContext(collector),
          turnId,
          command,
          status,
        });
      } else if (item.type === "fileChange") {
        const touched = extractTouchedPaths(item);
        if (touched.length > 0) {
          this.#reporter?.filesTouched(
            touched,
            this.#collectorContext(collector),
          );
        }
        const summary = itemSummary(item);
        if (summary !== undefined) {
          this.#logger?.log("debug", "runtime.file_change", {
            ...this.#collectorContext(collector),
            turnId,
            summary,
          });
        }
      }
      return;
    }

    if (method === "error") {
      const error =
        getErrorMessage(getObject(params, "error")) ??
        "Unknown App Server error";
      const willRetry = getBoolean(params, "willRetry") === true;
      const message = `App Server error${willRetry ? " (retrying)" : ""}: ${error}`;
      this.#reporter?.warning(message);
      this.#logger?.log("error", "runtime.turn.error", {
        ...this.#collectorContext(collector),
        turnId,
        error,
        willRetry,
      });
      return;
    }

    if (method === "turn/diff/updated") {
      const diff = getString(params, "diff");
      if (diff !== undefined) {
        collector.diff = diff;
        this.#logger?.log("debug", "runtime.turn.diff", {
          ...this.#collectorContext(collector),
          turnId,
          diffLength: diff.length,
        });
      }
      return;
    }

    if (method === "thread/tokenUsage/updated") {
      if (isRecord(params)) {
        collector.usage = params;
        this.#logger?.log("debug", "runtime.turn.usage", {
          ...this.#collectorContext(collector),
          turnId,
          usage: params,
        });
      }
      return;
    }

    if (method === "turn/completed") {
      const turn = getObject(params, "turn");
      const status = turn?.status;
      const normalizedStatus =
        status === "completed" ||
        status === "interrupted" ||
        status === "failed"
          ? status
          : "failed";
      const error = getErrorMessage(turn?.error);
      const result: TurnResult = {
        turnId,
        status: normalizedStatus,
        text: collector.text,
        ...(collector.diff !== undefined ? { diff: collector.diff } : {}),
        ...(collector.usage !== undefined ? { usage: collector.usage } : {}),
        ...(error ? { error } : {}),
      };
      if (normalizedStatus !== "completed") {
        this.#reporter?.warning(
          `App Server turn ${normalizedStatus}: ${error ?? "no error details"}`,
        );
        this.#logger?.log("error", "runtime.turn.failed", {
          ...this.#collectorContext(collector),
          turnId,
          status: normalizedStatus,
          error,
        });
        this.#discardCollector(collector);
        collector.reject(
          new TurnFailedError(
            error ?? `Turn ${turnId} ended with status ${normalizedStatus}`,
          ),
        );
      } else {
        if (collector.text) {
          this.#reporter?.result(
            collector.text,
            this.#collectorContext(collector),
          );
        }
        this.#logger?.log("info", "runtime.turn.completed", {
          ...this.#collectorContext(collector),
          turnId,
          status: normalizedStatus,
          diffLength: collector.diff === undefined ? 0 : collector.diff.length,
          usage: collector.usage,
          textLength: collector.text.length,
        });
        this.#settleCollector(collector, result);
      }
    }
  }

  #applyGoalUpdated(params: unknown): void {
    const goal = getObject(params, "goal");
    const threadId = getString(params, "threadId");
    const status = getString(goal, "status");
    if (!threadId || !status) {
      return;
    }

    const collector = Array.from(this.#collectors.values()).find(
      (candidate) =>
        candidate.threadId === threadId &&
        candidate.logContext?.threadRole === "worker" &&
        candidate.logContext.phaseTurn === "execution",
    );
    if (!collector || status === "active" || status === "paused") {
      return;
    }

    const turnId = collector.turnId;
    if (status === "complete") {
      this.#logger?.log("info", "runtime.turn.completed", {
        ...this.#collectorContext(collector),
        turnId,
        status: "completed",
        completedBy: "goal",
      });
      this.#settleCollector(collector, {
        turnId,
        status: "completed",
        text: collector.text,
        ...(collector.diff !== undefined ? { diff: collector.diff } : {}),
        ...(collector.usage !== undefined ? { usage: collector.usage } : {}),
      });
      return;
    }

    const error = `Worker goal ended with status: ${status}`;
    this.#logger?.log("error", "runtime.turn.failed", {
      ...this.#collectorContext(collector),
      turnId,
      status,
      error,
    });
    this.#discardCollector(collector);
    collector.reject(new TurnFailedError(error));
  }

  #settleCollector(collector: TurnCollector, result: TurnResult): void {
    this.#discardCollector(collector);
    collector.resolve(result);
  }

  #discardCollector(collector: TurnCollector): void {
    this.#settledTurnIds.add(collector.turnId);
    this.#collectors.delete(collector.turnId);
  }

  #failActiveTurns(error: Error): void {
    for (const collector of this.#collectors.values()) {
      this.#logger?.log("error", "runtime.turn.failed", {
        ...this.#collectorContext(collector),
        turnId: collector.turnId,
        error: error.message,
      });
      this.#discardCollector(collector);
      collector.reject(error);
    }
  }

  #collectorContext(collector: TurnCollector): Record<string, unknown> {
    return {
      threadId: collector.threadId,
      ...collector.logContext,
    };
  }

  #assertInitialized(): void {
    if (!this.#initialized) {
      throw new ProtocolError(
        "AppServerRuntime.initialize() must be called first",
      );
    }
  }
}

function getTurnId(params: unknown): string | undefined {
  if (!isRecord(params)) {
    return undefined;
  }
  if (typeof params.turnId === "string") {
    return params.turnId;
  }
  const turn = params.turn;
  if (isRecord(turn) && typeof turn.id === "string") {
    return turn.id;
  }
  return undefined;
}

function getMessage(params: unknown): string | undefined {
  if (!isRecord(params)) {
    return undefined;
  }
  if (typeof params.message === "string") {
    return params.message;
  }
  if (typeof params.summary === "string") {
    return params.summary;
  }
  return undefined;
}

function getString(value: unknown, key: string): string | undefined {
  return isRecord(value) && typeof value[key] === "string"
    ? value[key]
    : undefined;
}

function getBoolean(value: unknown, key: string): boolean | undefined {
  return isRecord(value) && typeof value[key] === "boolean"
    ? value[key]
    : undefined;
}

function getObject(
  value: unknown,
  key: string,
): Record<string, unknown> | undefined {
  return isRecord(value) && isRecord(value[key]) ? value[key] : undefined;
}

function extractTouchedPaths(value: Record<string, unknown>): string[] {
  const results = new Set<string>();

  const single = getString(value, "path");
  if (single) {
    results.add(single);
  }

  const file = getString(value, "file");
  if (file) {
    results.add(file);
  }

  const files = getStringArray(value, "files");
  for (const value of files) {
    results.add(value);
  }

  const changes = getObject(value, "changes");
  if (changes) {
    const changePath = getString(changes, "path");
    if (changePath) {
      results.add(changePath);
    }
  }

  const items = getArray(value, "items");
  for (const item of items) {
    if (!isRecord(item)) {
      continue;
    }
    const path = getString(item, "path");
    const filePath = getString(item, "file");
    if (path) {
      results.add(path);
    }
    if (filePath) {
      results.add(filePath);
    }
  }

  return Array.from(results);
}

function getArray(value: Record<string, unknown>, key: string): unknown[] {
  const items = value[key];
  return Array.isArray(items) ? (items as unknown[]) : [];
}

function getStringArray(value: unknown, key: string): string[] {
  const raw = isRecord(value) ? value[key] : undefined;
  if (!Array.isArray(raw)) {
    return [];
  }
  const values: string[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.trim()) {
      values.push(item);
    }
  }
  return values;
}

function itemSummary(value: Record<string, unknown>): string | undefined {
  return getString(value, "summary") ?? getString(value, "status");
}

function extractReasoningSummaries(value: Record<string, unknown>): string[] {
  const summary = value.summary;
  if (!Array.isArray(summary)) {
    return [];
  }
  return summary.flatMap((part) => {
    if (!isRecord(part) || part.type !== "summary_text") {
      return [];
    }
    const text = getString(part, "text");
    return text?.trim() ? [text] : [];
  });
}

function getErrorMessage(value: unknown): string | undefined {
  return isRecord(value) && typeof value.message === "string"
    ? value.message
    : undefined;
}

function parseThreadResponse(value: unknown, method: string): ThreadResponse {
  if (!isRecord(value) || !isRecord(value.thread)) {
    throw invalidResponse(method);
  }

  const id = nonEmptyString(value.thread.id);
  const rawSessionId = value.thread.sessionId;
  const sessionId =
    rawSessionId === undefined ? undefined : nonEmptyString(rawSessionId);
  if (!id || (rawSessionId !== undefined && !sessionId)) {
    throw invalidResponse(method);
  }

  return {
    thread: {
      id,
      ...(sessionId ? { sessionId } : {}),
    },
  };
}

function parseTurnStartResponse(
  value: unknown,
  method: string,
): TurnStartResponse {
  if (!isRecord(value) || !isRecord(value.turn)) {
    throw invalidResponse(method);
  }

  const id = nonEmptyString(value.turn.id);
  if (!id) {
    throw invalidResponse(method);
  }

  return { turn: { id } };
}

function parseThreadGoalResponse(
  value: unknown,
  method: string,
): ThreadGoalResponse {
  if (!isRecord(value)) {
    throw invalidResponse(method);
  }
  const goal = parseThreadGoal(value.goal);
  if (!goal) {
    throw invalidResponse(method);
  }
  return { goal };
}

function parseThreadGoalGetResponse(
  value: unknown,
  method: string,
): ThreadGoalGetResponse {
  if (!isRecord(value) || !("goal" in value)) {
    throw invalidResponse(method);
  }
  if (value.goal === null) {
    return { goal: null };
  }
  const goal = parseThreadGoal(value.goal);
  if (!goal) {
    throw invalidResponse(method);
  }
  return { goal };
}

function parseThreadGoalClearResponse(
  value: unknown,
  method: string,
): ThreadGoalClearResponse {
  if (!isRecord(value) || typeof value.cleared !== "boolean") {
    throw invalidResponse(method);
  }
  return { cleared: value.cleared };
}

function parseThreadGoal(value: unknown): ThreadGoal | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const threadId = nonEmptyString(value.threadId);
  const objective = nonEmptyString(value.objective);
  const status = isThreadGoalStatus(value.status) ? value.status : undefined;
  const tokenBudget = value.tokenBudget;
  if (
    !threadId ||
    !objective ||
    !status ||
    (tokenBudget !== null && !isFiniteNumber(tokenBudget)) ||
    !isFiniteNumber(value.tokensUsed) ||
    !isFiniteNumber(value.timeUsedSeconds) ||
    !isFiniteNumber(value.createdAt) ||
    !isFiniteNumber(value.updatedAt)
  ) {
    return undefined;
  }
  return {
    threadId,
    objective,
    status,
    tokenBudget,
    tokensUsed: value.tokensUsed,
    timeUsedSeconds: value.timeUsedSeconds,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isThreadGoalStatus(value: unknown): value is ThreadGoalStatus {
  return (
    value === "active" ||
    value === "paused" ||
    value === "blocked" ||
    value === "complete" ||
    value === "budgetLimited" ||
    value === "usageLimited"
  );
}

function invalidResponse(method: string): ProtocolError {
  return new ProtocolError(`Invalid result from App Server method "${method}"`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
