export type JsonRpcId = number | string;

export interface JsonRpcRequest {
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccess {
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcFailure {
  id: JsonRpcId;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type IncomingMessage =
  JsonRpcRequest | JsonRpcNotification | JsonRpcSuccess | JsonRpcFailure;

export function parseIncomingMessage(
  value: unknown,
): IncomingMessage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if ("method" in value) {
    const method = value.method;
    if (typeof method !== "string") {
      return undefined;
    }
    if ("id" in value) {
      const id = value.id;
      if (!isJsonRpcId(id)) {
        return undefined;
      }
      return {
        id,
        method,
        ...("params" in value ? { params: value.params } : {}),
      };
    }
    return {
      method,
      ...("params" in value ? { params: value.params } : {}),
    };
  }

  const id = value.id;
  if (!isJsonRpcId(id) || "result" in value === "error" in value) {
    return undefined;
  }

  if ("result" in value) {
    return { id, result: value.result };
  }

  const error = value.error;
  if (!isError(error)) {
    return undefined;
  }
  return { id, error };
}

export function hasId(
  message: IncomingMessage,
): message is JsonRpcRequest | JsonRpcSuccess | JsonRpcFailure {
  return "id" in message;
}

export function isServerRequest(
  message: IncomingMessage,
): message is JsonRpcRequest {
  return hasId(message) && "method" in message;
}

export function isResponse(
  message: IncomingMessage,
): message is JsonRpcSuccess | JsonRpcFailure {
  return hasId(message) && !("method" in message);
}

export function isFailure(
  message: JsonRpcSuccess | JsonRpcFailure,
): message is JsonRpcFailure {
  return "error" in message;
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return typeof value === "string" || typeof value === "number";
}

function isError(value: unknown): value is JsonRpcFailure["error"] {
  return (
    isRecord(value) &&
    typeof value.code === "number" &&
    typeof value.message === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
