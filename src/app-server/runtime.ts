import type {
  AgentRuntime,
  ProgressReporter,
  ThreadRef,
  TurnRequest,
  TurnResult,
} from "../core/types.js";
import { ProtocolError, TurnFailedError } from "../core/errors.js";
import { JsonRpcProcessClient, type JsonRpcClientOptions } from "./json-rpc-client.js";

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

interface TurnCollector {
  turnId: string;
  text: string;
  diff: string | undefined;
  usage: Record<string, unknown> | undefined;
  resolve(result: TurnResult): void;
  reject(reason: unknown): void;
}

export interface AppServerRuntimeOptions extends JsonRpcClientOptions {
  reporter?: ProgressReporter;
  model?: string;
  clientVersion?: string;
}

export class AppServerRuntime implements AgentRuntime {
  readonly #client: JsonRpcProcessClient;
  readonly #reporter: ProgressReporter | undefined;
  readonly #model: string | undefined;
  readonly #clientVersion: string;
  readonly #collectors = new Map<string, TurnCollector>();
  readonly #earlyEvents = new Map<string, { method: string; params: unknown }[]>();
  #initialized = false;
  #unsubscribe: (() => void) | undefined;

  public constructor(options: AppServerRuntimeOptions) {
    this.#reporter = options.reporter;
    this.#model = options.model;
    this.#clientVersion = options.clientVersion ?? "0.1.0";
    this.#client = new JsonRpcProcessClient(options);
  }

  public async initialize(): Promise<void> {
    if (this.#initialized) {
      return;
    }

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
    this.#initialized = true;
  }

  public async startThread(options: { cwd: string; model?: string }): Promise<ThreadRef> {
    this.#assertInitialized();
    const response = await this.#client.request<ThreadResponse>("thread/start", {
      cwd: options.cwd,
      model: options.model ?? this.#model,
      approvalPolicy: "never",
      sandbox: "readOnly",
      serviceName: "pre2prod",
    });
    return {
      id: response.thread.id,
      ...(response.thread.sessionId ? { sessionId: response.thread.sessionId } : {}),
    };
  }

  public async forkThread(threadId: string, lastTurnId: string): Promise<ThreadRef> {
    this.#assertInitialized();
    const response = await this.#client.request<ThreadResponse>("thread/fork", {
      threadId,
      lastTurnId,
      ephemeral: true,
    });
    return {
      id: response.thread.id,
      ...(response.thread.sessionId ? { sessionId: response.thread.sessionId } : {}),
    };
  }

  public async runTurn(request: TurnRequest): Promise<TurnResult> {
    this.#assertInitialized();

    const response = await this.#client.request<TurnStartResponse>("turn/start", {
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
    });

    const turnId = response.turn.id;
    const result = new Promise<TurnResult>((resolve, reject) => {
      this.#collectors.set(turnId, {
        turnId,
        text: "",
        diff: undefined,
        usage: undefined,
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

  public async close(): Promise<void> {
    this.#unsubscribe?.();
    await this.#client.close();
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
      if (method === "warning" || method === "configWarning") {
        this.#reporter?.warning(getMessage(params) ?? method);
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
        const command = typeof item.command === "string" ? item.command : "command";
        const status = typeof item.status === "string" ? item.status : undefined;
        this.#reporter?.command(command, status);
      }
      return;
    }

    if (method === "turn/diff/updated") {
      const diff = getString(params, "diff");
      if (diff !== undefined) {
        collector.diff = diff;
      }
      return;
    }

    if (method === "thread/tokenUsage/updated") {
      if (isRecord(params)) {
        collector.usage = params;
      }
      return;
    }

    if (method === "turn/completed") {
      const turn = getObject(params, "turn");
      const status = turn?.status;
      const normalizedStatus =
        status === "completed" || status === "interrupted" || status === "failed"
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
        collector.reject(
          new TurnFailedError(error ?? `Turn ${turnId} ended with status ${normalizedStatus}`),
        );
      } else {
        collector.resolve(result);
      }
    }
  }

  #assertInitialized(): void {
    if (!this.#initialized) {
      throw new ProtocolError("AppServerRuntime.initialize() must be called first");
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
  return isRecord(value) && typeof value[key] === "string" ? value[key] : undefined;
}

function getObject(value: unknown, key: string): Record<string, unknown> | undefined {
  return isRecord(value) && isRecord(value[key]) ? value[key] : undefined;
}

function getErrorMessage(value: unknown): string | undefined {
  return isRecord(value) && typeof value.message === "string" ? value.message : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
