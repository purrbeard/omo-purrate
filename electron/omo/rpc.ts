import type { RequestId, RpcNotification, RpcServerRequest } from "../../shared/protocol";

/** Error codes the bridge uses for failures that are not server-sent RPC errors. */
export const BRIDGE_ERROR_CODES = { notConnected: -32000, timeout: -32001 } as const;

/** A JSON-RPC error response, a request timeout, or a request against a child that is not running. */
export class RpcRequestError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "RpcRequestError";
  }
}

/** start() failure: the child failed to spawn, exited, or did not initialize in time. */
export class AppServerStartError extends Error {
  constructor(
    message: string,
    readonly exitCode: number | null,
    readonly signal: string | null,
    readonly stderrTail: string,
  ) {
    super(message);
    this.name = "AppServerStartError";
  }
}

export type Frame =
  | { kind: "request"; request: RpcServerRequest }
  | { kind: "notification"; notification: RpcNotification }
  | { kind: "response"; id: RequestId; result: unknown }
  | { kind: "error"; id: RequestId; code: number; message: string; data: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRequestId(value: unknown): value is RequestId {
  return typeof value === "number" || typeof value === "string";
}

/** Classifies one decoded JSONL value; null when it is not a JSON-RPC frame. */
export function classify(value: unknown): Frame | null {
  if (!isRecord(value)) return null;
  const { id, method } = value;
  if (typeof method === "string") {
    if (isRequestId(id)) return { kind: "request", request: { id, method, params: value["params"] } };
    const notification: RpcNotification = { method, params: value["params"] };
    if (typeof value["emittedAtMs"] === "number") notification.emittedAtMs = value["emittedAtMs"];
    return { kind: "notification", notification };
  }
  if (!isRequestId(id)) return null;
  if ("result" in value) return { kind: "response", id, result: value["result"] };
  const error = value["error"];
  if (!isRecord(error)) return null;
  return {
    kind: "error",
    id,
    code: typeof error["code"] === "number" ? error["code"] : -32603,
    message: typeof error["message"] === "string" ? error["message"] : "unknown error",
    data: error["data"],
  };
}

export function describeExit(code: number | null, signal: string | null): string {
  if (code !== null) return `code ${code}`;
  if (signal !== null) return `signal ${signal}`;
  return "no exit code";
}

export function assertNever(value: never): never {
  throw new Error(`unhandled frame: ${JSON.stringify(value)}`);
}
