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

export function hasId(
  message: IncomingMessage,
): message is JsonRpcRequest | JsonRpcSuccess | JsonRpcFailure {
  return "id" in message;
}

export function isServerRequest(message: IncomingMessage): message is JsonRpcRequest {
  return hasId(message) && "method" in message;
}

export function isResponse(message: IncomingMessage): message is JsonRpcSuccess | JsonRpcFailure {
  return hasId(message) && !("method" in message);
}

export function isFailure(message: JsonRpcSuccess | JsonRpcFailure): message is JsonRpcFailure {
  return "error" in message;
}
