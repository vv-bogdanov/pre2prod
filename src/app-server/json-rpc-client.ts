import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  createInterface,
  type Interface as ReadlineInterface,
} from "node:readline";

import { ProtocolError } from "../core/errors.js";
import { redactSensitiveText } from "../logging.js";
import {
  isFailure,
  parseIncomingMessage,
  isResponse,
  isServerRequest,
  type JsonRpcId,
} from "./protocol.js";

interface Deferred<T> {
  resolve(value: T): void;
  reject(reason: unknown): void;
}

export interface JsonRpcClientOptions {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stderr?: NodeJS.WritableStream;
}

export type NotificationHandler = (method: string, params: unknown) => void;
type FailureHandler = (error: Error) => void;

export class JsonRpcProcessClient {
  readonly #options: JsonRpcClientOptions;
  readonly #pending = new Map<JsonRpcId, Deferred<unknown>>();
  readonly #notificationHandlers = new Set<NotificationHandler>();
  readonly #failureHandlers = new Set<FailureHandler>();
  #nextId = 1;
  #process?: ChildProcessWithoutNullStreams;
  #lines?: ReadlineInterface;
  #closed = false;

  public constructor(options: JsonRpcClientOptions) {
    this.#options = options;
  }

  public start(): Promise<void> {
    if (this.#process) {
      return Promise.resolve();
    }

    const child = spawn(this.#options.command, this.#options.args, {
      cwd: this.#options.cwd,
      env: this.#options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.#process = child;
    const stderr = this.#options.stderr ?? process.stderr;
    let stderrRemainder = "";
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderrRemainder += chunk.toString("utf8");
      if (hasUnterminatedPrivateKey(stderrRemainder)) {
        return;
      }
      const lines = redactSensitiveText(stderrRemainder).split(/\r?\n/);
      stderrRemainder = lines.pop() ?? "";
      for (const line of lines) {
        stderr.write(`${redactSensitiveText(line)}\n`);
      }
    });
    child.stderr.once("end", () => {
      if (stderrRemainder) {
        stderr.write(redactSensitiveText(stderrRemainder));
      }
    });

    child.once("error", (error) => {
      this.#fail(
        new ProtocolError(
          `Failed to start Codex App Server: ${error.message}`,
          { cause: error },
        ),
      );
    });

    child.once("exit", (code, signal) => {
      if (!this.#closed) {
        this.#fail(
          new ProtocolError(
            `Codex App Server exited unexpectedly (code=${String(code)}, signal=${String(signal)})`,
          ),
        );
      }
    });

    this.#lines = createInterface({ input: child.stdout });
    this.#lines.on("line", (line) => this.#handleLine(line));
    return Promise.resolve();
  }

  public onNotification(handler: NotificationHandler): () => void {
    this.#notificationHandlers.add(handler);
    return () => this.#notificationHandlers.delete(handler);
  }

  public onFailure(handler: FailureHandler): () => void {
    this.#failureHandlers.add(handler);
    return () => this.#failureHandlers.delete(handler);
  }

  public async request<T>(method: string, params?: unknown): Promise<T> {
    const id = this.#nextId++;
    const promise = new Promise<unknown>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
    });

    this.#send({ id, method, ...(params === undefined ? {} : { params }) });
    return (await promise) as T;
  }

  public notify(method: string, params?: unknown): void {
    this.#send({ method, ...(params === undefined ? {} : { params }) });
  }

  public respond(id: JsonRpcId, result: unknown): void {
    this.#send({ id, result });
  }

  public async close(): Promise<void> {
    this.#closed = true;
    this.#lines?.close();
    this.#process?.stdin.end();

    const child = this.#process;
    if (child === undefined || child.exitCode !== null) {
      return;
    }

    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 1_500);
      timer.unref();
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  #send(message: unknown): void {
    const child = this.#process;
    if (child?.stdin.writable !== true) {
      throw new ProtocolError("Codex App Server is not running");
    }
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #handleLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      this.#fail(
        new ProtocolError(`Invalid JSON from Codex App Server: ${line}`, {
          cause: error,
        }),
      );
      return;
    }

    const message = parseIncomingMessage(parsed);
    if (!message) {
      this.#fail(
        new ProtocolError("Invalid JSON-RPC message from Codex App Server"),
      );
      return;
    }

    if (isResponse(message)) {
      const deferred = this.#pending.get(message.id);
      if (!deferred) {
        return;
      }
      this.#pending.delete(message.id);
      if (isFailure(message)) {
        deferred.reject(
          new ProtocolError(
            `App Server request failed: ${message.error.message}`,
          ),
        );
      } else {
        deferred.resolve(message.result);
      }
      return;
    }

    if (isServerRequest(message)) {
      this.#handleServerRequest(message.id, message.method);
      return;
    }

    for (const handler of this.#notificationHandlers) {
      handler(message.method, message.params);
    }
  }

  #handleServerRequest(id: JsonRpcId, method: string): void {
    switch (method) {
      case "item/commandExecution/requestApproval":
      case "item/fileChange/requestApproval":
        this.respond(id, { decision: "decline" });
        break;
      case "tool/requestUserInput":
      case "item/tool/requestUserInput":
        this.respond(id, { answers: {} });
        break;
      case "mcpServer/elicitation/request":
        this.respond(id, { action: "decline", content: null });
        break;
      default:
        this.respond(id, {});
    }
  }

  #rejectAll(error: Error): void {
    for (const deferred of this.#pending.values()) {
      deferred.reject(error);
    }
    this.#pending.clear();
  }

  #fail(error: Error): void {
    this.#rejectAll(error);
    for (const handler of this.#failureHandlers) {
      handler(error);
    }
  }
}

function hasUnterminatedPrivateKey(value: string): boolean {
  const start = value.lastIndexOf("-----BEGIN ");
  return start !== -1 && !value.slice(start).includes("-----END ");
}
