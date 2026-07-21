import type {
  AgentRuntime,
  ThreadGoal,
  ThreadGoalRequest,
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
    status: string;
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
  clientVersion?: string;
  logger?: RunLogger;
}

export class AppServerRuntime implements AgentRuntime {
  readonly #client: JsonRpcProcessClient;
  readonly #reporter: ProgressReporter | undefined;
  readonly #model: string | undefined;
  readonly #clientVersion: string;
  readonly #logger: RunLogger | undefined;
  readonly #collectors = new Map<string, TurnCollector>();
  readonly #earlyEvents = new Map<
    string,
    { method: string; params: unknown }[]
  >();
  #initialized = false;
  #unsubscribe: (() => void) | undefined;

  public constructor(options: AppServerRuntimeOptions) {
    this.#reporter = options.reporter;
    this.#model = options.model;
    this.#clientVersion = options.clientVersion ?? "0.1.0";
    this.#logger = options.logger;
    this.#client = new JsonRpcProcessClient(options);
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
    const response = await this.#client.request<ThreadResponse>(
      "thread/start",
      {
        cwd: options.cwd,
        model: options.model ?? this.#model,
        approvalPolicy: "never",
        sandbox: "readOnly",
        serviceName: "pre2prod",
      },
    );
    this.#logger?.log("debug", "runtime.thread.start", {
      threadId: response.thread.id,
      cwd: options.cwd,
      requestedModel: options.model ?? this.#model,
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
    const response = await this.#client.request<ThreadResponse>("thread/fork", {
      threadId,
      lastTurnId,
      ephemeral: true,
    });
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

    const response = await this.#client.request<TurnStartResponse>(
      "turn/start",
      {
        threadId: request.threadId,
        input: [{ type: "text", text: request.prompt }],
        cwd: request.cwd,
        approvalPolicy: "never",
        sandboxPolicy:
          request.sandbox === "readOnly"
            ? { type: "readOnly" }
            : {
                type: "workspaceWrite",
                writableRoots: [request.cwd],
                networkAccess: request.networkAccess ?? true,
              },
        model: this.#model,
        ...(request.outputSchema ? { outputSchema: request.outputSchema } : {}),
      },
    );
    this.#logger?.log(
      "info",
      "runtime.turn.started",
      {
        turnId: response.turn.id,
        threadId: request.threadId,
        sandbox: request.sandbox,
        hasOutputSchema: request.outputSchema !== undefined,
        networkAccess: request.networkAccess ?? true,
        ...logContext,
      },
    );

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
    const response = await this.#client.request<ThreadGoalResponse>(
      "thread/goal/set",
      {
        threadId,
        ...(goal.objective !== undefined ? { objective: goal.objective } : {}),
        ...(goal.status !== undefined ? { status: goal.status } : {}),
        ...(goal.tokenBudget !== undefined
          ? { tokenBudget: goal.tokenBudget }
          : {}),
      },
    );
    return response.goal;
  }

  public async getThreadGoal(threadId: string): Promise<ThreadGoal | null> {
    this.#assertInitialized();
    this.#logger?.log("debug", "runtime.goal.get", { threadId });
    const response = await this.#client.request<ThreadGoalGetResponse>(
      "thread/goal/get",
      { threadId },
    );
    return response.goal;
  }

  public async clearThreadGoal(threadId: string): Promise<boolean> {
    this.#assertInitialized();
    this.#logger?.log("debug", "runtime.goal.clear", { threadId });
    const response = await this.#client.request<ThreadGoalClearResponse>(
      "thread/goal/clear",
      { threadId },
    );
    return response.cleared;
  }

  public async close(): Promise<void> {
    this.#logger?.log("debug", "runtime.close.start");
    this.#unsubscribe?.();
    await this.#client.close();
    this.#logger?.log("debug", "runtime.close.complete");
  }

  #onNotification(method: string, params: unknown): void {
    const turnId = getTurnId(params);
    if (turnId && !this.#collectors.has(turnId)) {
      const events = this.#earlyEvents.get(turnId) ?? [];
      events.push({ method, params });
      this.#earlyEvents.set(turnId, events);
      return;
    }

    this.#applyNotification(method, params);
  }

  #applyNotification(method: string, params: unknown): void {
    const turnId = getTurnId(params);
    if (!turnId) {
      if (
        method === "thread/goal/updated" ||
        method === "thread/goal/cleared"
      ) {
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

    if (method === "item/agentMessage/delta") {
      const delta = getString(params, "delta");
      if (delta) {
        this.#reporter?.verbose(delta);
        this.#logger?.log("debug", "runtime.turn.delta", {
          ...this.#collectorContext(collector),
          turnId,
          deltaSnippet: delta.slice(0, 140),
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
      }
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
      this.#collectors.delete(turnId);

      if (normalizedStatus !== "completed") {
        this.#logger?.log("error", "runtime.turn.failed", {
          ...this.#collectorContext(collector),
          turnId,
          status: normalizedStatus,
          error,
        });
        collector.reject(
          new TurnFailedError(
            error ?? `Turn ${turnId} ended with status ${normalizedStatus}`,
          ),
        );
      } else {
        this.#logger?.log("info", "runtime.turn.completed", {
          ...this.#collectorContext(collector),
          turnId,
          status: normalizedStatus,
          diffLength:
            collector.diff === undefined ? 0 : collector.diff.length,
          usage: collector.usage,
          textLength: collector.text.length,
        });
        collector.resolve(result);
      }
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

function getObject(
  value: unknown,
  key: string,
): Record<string, unknown> | undefined {
  return isRecord(value) && isRecord(value[key]) ? value[key] : undefined;
}

function getErrorMessage(value: unknown): string | undefined {
  return isRecord(value) && typeof value.message === "string"
    ? value.message
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
