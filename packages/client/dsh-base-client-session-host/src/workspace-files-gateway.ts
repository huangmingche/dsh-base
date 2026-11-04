/**
 * Official-style client descriptor for the `workspaceFiles` namespace.
 *
 * Unary file reads use the official `{type:'client-request', payload:{args}}`
 * envelope; the `changes` watch travels as a logical Gateway mux stream. The
 * Workers Host transports bytes as base64 in JSON, so this gateway restores the
 * official `Uint8Array` value before the client provider sees it.
 */
import type { ConnectionHandle } from "@deepseek-ai/dsh-client-connection/client";
import type { OfficialGatewayResult } from "./gateway.ts";
import { openWireStream, type WireStreamSocketLike } from "./wire-stream.ts";

/** One workspace directory entry. */
export interface WorkspaceDirectoryEntry {
  readonly name: string;
  readonly type: "file" | "directory" | "other";
  readonly size?: number;
}

/** Official workspace directory listing. */
export interface WorkspaceDirectoryListing {
  readonly path: string;
  readonly entries: readonly WorkspaceDirectoryEntry[];
  readonly truncated: boolean;
}

/** Official workspace file stat. */
export interface WorkspaceFileStat {
  readonly absolutePath: string;
  readonly version: string;
  readonly bytes?: number;
}

/** Official line-window read result. */
export interface WorkspaceFileText extends WorkspaceFileStat {
  readonly offset: number;
  readonly text: string;
  readonly lines: number;
  readonly eof: boolean;
}

/** Official byte-window read result. */
export interface WorkspaceFileBytes extends WorkspaceFileStat {
  readonly offset: number;
  readonly data: Uint8Array;
  readonly eof: boolean;
}

/** One change-feed frame. */
export type WorkspaceFileWatchFrame =
  | { readonly kind: "ready" }
  | {
    readonly kind: "change";
    readonly change:
      | { readonly absolutePath: string; readonly version: string }
      | { readonly absolutePath: string; readonly absent: true };
  };

/** Endpoint names this gateway calls. */
export const WORKSPACE_FILES_ENDPOINTS = Object.freeze({
  list: "workspaceFiles/list",
  stat: "workspaceFiles/stat",
  read: "workspaceFiles/read",
  readBytes: "workspaceFiles/readBytes",
  changes: "workspaceFiles/changes",
} as const);

/** Options for the workspace-files gateway. */
export interface OfficialWorkspaceFilesGatewayOptions {
  readonly baseUrl: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly connection?: () => ConnectionHandle | undefined;
  /** Socket factory override for the `changes` mux stream (tests). */
  readonly socketFactory?: (url: string) => WireStreamSocketLike;
}

/** Official-style caller for workspace file reads and watches. */
export interface OfficialWorkspaceFilesGateway {
  list(sessionId: string, path: string, signal?: AbortSignal): Promise<OfficialGatewayResult<WorkspaceDirectoryListing>>;
  stat(sessionId: string, path: string, signal?: AbortSignal): Promise<OfficialGatewayResult<WorkspaceFileStat>>;
  read(sessionId: string, path: string, range?: { readonly offset?: number; readonly limit?: number }, signal?: AbortSignal): Promise<OfficialGatewayResult<WorkspaceFileText>>;
  readBytes(sessionId: string, path: string, options?: { readonly baseFile?: string; readonly range?: { readonly offset?: number; readonly length?: number } }, signal?: AbortSignal): Promise<OfficialGatewayResult<WorkspaceFileBytes>>;
  changes(sessionId: string, path: string, signal: AbortSignal): AsyncIterable<WorkspaceFileWatchFrame>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function newRpcId(): string {
  const cryptoFace = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (typeof cryptoFace?.randomUUID === "function") return cryptoFace.randomUUID();
  return `workspace-files-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function decodeBase64(value: unknown): Uint8Array {
  if (typeof value !== "string" || value === "") return new Uint8Array();
  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * Create the official workspace-files caller.
 * @param options - deployment origin, connection resolver and optional fetch.
 * @returns workspace file gateway.
 */
export function createOfficialWorkspaceFilesGateway(options: OfficialWorkspaceFilesGatewayOptions): OfficialWorkspaceFilesGateway {
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);

  async function call<T>(endpoint: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<OfficialGatewayResult<T>> {
    const payload = { args };
    const connection = options.connection?.();
    if (connection !== undefined) {
      return await connection.rpc.call("/api", endpoint, payload, signal) as OfficialGatewayResult<T>;
    }
    const rpcId = newRpcId();
    const response = await fetcher(`${options.baseUrl.replace(/\/+$/, "")}/api/${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "client-request", rpcId, method: endpoint, payload }),
      ...(signal === undefined ? {} : { signal }),
    });
    if (!response.ok) throw new Error(`transport failure for /api/${endpoint}: HTTP ${response.status}`);
    const body = await response.json() as { readonly type?: unknown; readonly rpcId?: unknown; readonly result?: unknown };
    if (body.type !== "server-response" || body.rpcId !== rpcId || !isRecord(body.result)) {
      throw new Error(`invalid server-response envelope for ${endpoint}`);
    }
    const result = body.result;
    if (result.ok === true) return { ok: true, value: result.value as T };
    if (result.ok === false && isRecord(result.error)
      && typeof result.error.code === "string" && typeof result.error.message === "string") {
      return { ok: false, error: { code: result.error.code, message: result.error.message } };
    }
    throw new Error(`invalid server-response result for ${endpoint}`);
  }

  return {
    list: (sessionId, path, signal) => call("workspaceFiles/list", { workspaceFileScope: sessionId, path }, signal),
    stat: (sessionId, path, signal) => call("workspaceFiles/stat", { workspaceFileScope: sessionId, path }, signal),
    read: (sessionId, path, range = {}, signal) => call("workspaceFiles/read", {
      workspaceFileScope: sessionId,
      path,
      range,
    }, signal),
    async readBytes(sessionId, path, readOptions = {}, signal) {
      const result = await call<WorkspaceFileBytes & { readonly dataBase64?: string }>("workspaceFiles/readBytes", {
        workspaceFileScope: sessionId,
        path,
        options: readOptions,
      }, signal);
      if (!result.ok) return result;
      const { dataBase64, ...rest } = result.value as WorkspaceFileBytes & { readonly dataBase64?: string };
      return { ok: true, value: { ...rest, data: decodeBase64(dataBase64) } };
    },
    changes: (sessionId, path, signal) => openWireStream<WorkspaceFileWatchFrame>({
      baseUrl: options.baseUrl,
      endpoint: "workspaceFiles/changes",
      payload: { args: { workspaceFileScope: sessionId, path } },
      signal,
      ...(options.socketFactory === undefined ? {} : { socketFactory: options.socketFactory }),
    }),
  };
}
