/**
 * Official-style client descriptor for the Workers-native `workspace` namespace.
 *
 * The official `api-workspace-controller` client calls `workspace/<method>`
 * through the same `{ type: 'client-request', payload: { args } }` envelope as
 * the session bridge. This module reproduces that wire contract over the Worker
 * RPC bridge and adds the `workspace/follow` logical stream on `/api/remote.mux`;
 * the custom `/api/session-host` transport remains the fallback in the adapter.
 */
import type { ConnectionHandle } from "@deepseek-ai/dsh-client-connection/client";
import type { OfficialGatewayResult } from "./gateway.ts";
import { OfficialGatewayTransportError } from "./gateway.ts";
import { openWireStream } from "./wire-stream.ts";
import type { WireStreamSocketLike } from "./wire-stream.ts";

/** One durable Workspace in the official `WorkspaceView` wire shape. */
export interface OfficialWorkspaceView {
  readonly workspaceId: string;
  /** Canonical host directory path. */
  readonly path: string;
  /** User-visible title. */
  readonly title: string;
  /** Sessions accounted to this Workspace in manual order. */
  readonly sessionIds: readonly string[];
  /** ISO-8601 creation instant. */
  readonly createdAt: string;
  /** ISO-8601 last-mutation instant. */
  readonly updatedAt: string;
}

/** Result of `workspace/create`. */
export interface OfficialWorkspaceCreateValue {
  readonly workspace: OfficialWorkspaceView;
  readonly created: boolean;
}

/** Result of a Workspace mutation that returns the complete row. */
export interface OfficialWorkspaceValue {
  readonly workspace: OfficialWorkspaceView;
}

/** Result of `workspace/delete`. */
export interface OfficialWorkspaceDeleteValue {
  readonly deleted: true;
}

/** Result of `workspace/insertBefore`: the complete registry order. */
export interface OfficialWorkspaceOrderValue {
  readonly workspaceIds: readonly string[];
}

/** Complete archived Session set after an archive mutation. */
export interface OfficialWorkspaceArchiveValue {
  readonly archivedSessionIds: readonly string[];
}

/** Complete pinned Session set after a pin mutation, most recently pinned first. */
export interface OfficialWorkspacePinValue {
  readonly pinnedSessionIds: readonly string[];
}

/** Complete reconnect baseline for Workspace browser state. */
export interface OfficialWorkspaceBaseline {
  readonly items: readonly OfficialWorkspaceView[];
  readonly archivedSessionIds: readonly string[];
  /** Registry-global pin set, most recently pinned first. */
  readonly pinnedSessionIds: readonly string[];
}

/** One ordered Workspace change after a generation's baseline. */
export type OfficialWorkspaceFollowIncrement =
  | { readonly type: "replace"; readonly value: OfficialWorkspaceBaseline }
  | { readonly type: "upsert"; readonly workspace: OfficialWorkspaceView }
  | { readonly type: "remove"; readonly workspaceId: string }
  | { readonly type: "order"; readonly workspaceIds: readonly string[] }
  | { readonly type: "archived"; readonly archivedSessionIds: readonly string[] }
  | { readonly type: "pinned"; readonly pinnedSessionIds: readonly string[] };

/** Workspace state stream; every generation starts with exactly one baseline. */
export type OfficialWorkspaceFollowFrame =
  | { readonly type: "baseline"; readonly value: OfficialWorkspaceBaseline }
  | OfficialWorkspaceFollowIncrement;

/** The official Workspace unary method set this increment bridges. */
export const WORKSPACE_REMOTE_ENDPOINTS = Object.freeze({
  create: "workspace/create",
  initializeDefault: "workspace/initializeDefault",
  rename: "workspace/rename",
  delete: "workspace/delete",
  insertBefore: "workspace/insertBefore",
  insertSessionBefore: "workspace/insertSessionBefore",
  archiveSession: "workspace/archiveSession",
  unarchiveSession: "workspace/unarchiveSession",
  pinSession: "workspace/pinSession",
  unpinSession: "workspace/unpinSession",
} as const);

/** The Workspace state stream endpoint served by the Gateway mux. */
export const WORKSPACE_FOLLOW_ENDPOINT = "workspace/follow";

/** Discoverable descriptor metadata for the migrated namespace. */
export const WORKSPACE_REMOTE_DESCRIPTOR = Object.freeze({
  namespace: "workspace",
  methods: Object.freeze(Object.keys(WORKSPACE_REMOTE_ENDPOINTS)),
  stream: WORKSPACE_FOLLOW_ENDPOINT,
});

/** Options for the official-style Workspace gateway. */
export interface OfficialWorkspaceGatewayOptions {
  /** Origin of the Workers deployment serving `/api/workspace/*`; defaults to the page origin. */
  readonly baseUrl?: string;
  /** Fetch implementation override for tests. */
  readonly fetch?: typeof globalThis.fetch;
  /**
   * Resolve the official Connection service when its plugin is active. Reads
   * are resolved lazily because the Connection plugin activates after this seam.
   */
  readonly connection?: () => ConnectionHandle | undefined;
  /** Stream carrier override for tests. */
  readonly socketFactory?: (url: string) => WireStreamSocketLike;
}

/** One official-style caller for the Workspace namespace. */
export interface OfficialWorkspaceGateway {
  create(input: { readonly path: string }, signal?: AbortSignal): Promise<OfficialGatewayResult<OfficialWorkspaceCreateValue>>;
  initializeDefault(signal?: AbortSignal): Promise<OfficialGatewayResult<{ readonly workspace?: OfficialWorkspaceView }>>;
  rename(input: { readonly workspaceId: string; readonly title: string }, signal?: AbortSignal): Promise<OfficialGatewayResult<OfficialWorkspaceValue>>;
  delete(input: { readonly workspaceId: string }, signal?: AbortSignal): Promise<OfficialGatewayResult<OfficialWorkspaceDeleteValue>>;
  insertBefore(input: {
    readonly workspaceId: string;
    readonly beforeWorkspaceId?: string;
  }, signal?: AbortSignal): Promise<OfficialGatewayResult<OfficialWorkspaceOrderValue>>;
  insertSessionBefore(input: {
    readonly workspaceId: string;
    readonly sessionId: string;
    readonly beforeSessionId?: string;
  }, signal?: AbortSignal): Promise<OfficialGatewayResult<OfficialWorkspaceValue>>;
  archiveSession(input: {
    readonly sessionId: string;
    readonly stopActivity?: boolean;
  }, signal?: AbortSignal): Promise<OfficialGatewayResult<OfficialWorkspaceArchiveValue>>;
  unarchiveSession(input: { readonly sessionId: string }, signal?: AbortSignal): Promise<OfficialGatewayResult<OfficialWorkspaceArchiveValue>>;
  pinSession(input: { readonly sessionId: string }, signal?: AbortSignal): Promise<OfficialGatewayResult<OfficialWorkspacePinValue>>;
  unpinSession(input: { readonly sessionId: string }, signal?: AbortSignal): Promise<OfficialGatewayResult<OfficialWorkspacePinValue>>;
  /** Stream one baseline followed by complete replacement baselines. */
  follow(signal: AbortSignal): AsyncIterable<OfficialWorkspaceFollowFrame>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function newRpcId(): string {
  const cryptoFace = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (typeof cryptoFace?.randomUUID === "function") return cryptoFace.randomUUID();
  return `rpc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function transportFailure(error: unknown, endpoint: string): OfficialGatewayTransportError {
  if (error instanceof OfficialGatewayTransportError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const status = /HTTP (\d{3})\b/.exec(message)?.[1];
  return new OfficialGatewayTransportError(`transport failure for /api/${endpoint}: ${message}`, status === undefined ? undefined : Number(status));
}

function pageOrigin(): string | undefined {
  const location = (globalThis as { location?: { origin?: unknown } }).location;
  return typeof location?.origin === "string" ? location.origin : undefined;
}

/**
 * Create the official-style Workspace gateway.
 * @param options - deployment origin, optional fetch/socket overrides, and Connection accessor.
 * @returns official `workspace/*` caller with `{ ok, value }` result envelopes.
 */
export function createOfficialWorkspaceGateway(options: OfficialWorkspaceGatewayOptions = {}): OfficialWorkspaceGateway {
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  const origin = (options.baseUrl ?? pageOrigin())?.replace(/\/+$/, "");

  function requireOrigin(): string {
    if (origin === undefined || origin === "") {
      throw new OfficialGatewayTransportError("workspace gateway has no deployment origin");
    }
    return origin;
  }

  async function call<T>(method: keyof typeof WORKSPACE_REMOTE_ENDPOINTS, args: Record<string, unknown>, signal?: AbortSignal): Promise<OfficialGatewayResult<T>> {
    const endpoint = WORKSPACE_REMOTE_ENDPOINTS[method];
    const payload = { args };
    const connection = options.connection?.();
    if (connection !== undefined) {
      try {
        return await connection.rpc.call("/api", endpoint, payload, signal) as OfficialGatewayResult<T>;
      } catch (error) {
        throw transportFailure(error, endpoint);
      }
    }
    const rpcId = newRpcId();
    const response = await fetcher(`${requireOrigin()}/api/${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "client-request", rpcId, method: endpoint, payload }),
      ...(signal === undefined ? {} : { signal }),
    });
    if (!response.ok) {
      throw new OfficialGatewayTransportError(`transport failure for /api/${endpoint}: HTTP ${response.status}`, response.status);
    }
    const body = await response.json() as { readonly type?: unknown; readonly rpcId?: unknown; readonly result?: unknown };
    if (body.type !== "server-response" || body.rpcId !== rpcId || !isRecord(body.result)) {
      throw new OfficialGatewayTransportError(`invalid server-response envelope for ${endpoint}`);
    }
    const result = body.result;
    if (result.ok === true) return { ok: true, value: result.value as T };
    if (result.ok === false && isRecord(result.error)
      && typeof result.error.code === "string" && typeof result.error.message === "string") {
      return { ok: false, error: { code: result.error.code, message: result.error.message } };
    }
    throw new OfficialGatewayTransportError(`invalid server-response result for ${endpoint}`);
  }

  return {
    create: (input, signal) => call("create", { request: { path: input.path } }, signal),
    initializeDefault: (signal) => call("initializeDefault", {}, signal),
    rename: (input, signal) => call("rename", { request: { workspaceId: input.workspaceId, title: input.title } }, signal),
    delete: (input, signal) => call("delete", { request: { workspaceId: input.workspaceId } }, signal),
    insertBefore: (input, signal) => call("insertBefore", {
      request: {
        workspaceId: input.workspaceId,
        ...(input.beforeWorkspaceId === undefined ? {} : { beforeWorkspaceId: input.beforeWorkspaceId }),
      },
    }, signal),
    insertSessionBefore: (input, signal) => call("insertSessionBefore", {
      request: {
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        ...(input.beforeSessionId === undefined ? {} : { beforeSessionId: input.beforeSessionId }),
      },
    }, signal),
    archiveSession: (input, signal) => call("archiveSession", {
      request: {
        sessionId: input.sessionId,
        ...(input.stopActivity === true ? { stopActivity: true } : {}),
      },
    }, signal),
    unarchiveSession: (input, signal) => call("unarchiveSession", { request: { sessionId: input.sessionId } }, signal),
    pinSession: (input, signal) => call("pinSession", { request: { sessionId: input.sessionId } }, signal),
    unpinSession: (input, signal) => call("unpinSession", { request: { sessionId: input.sessionId } }, signal),
    async *follow(signal) {
      const values = openWireStream<OfficialWorkspaceFollowFrame>({
        baseUrl: requireOrigin(),
        endpoint: WORKSPACE_FOLLOW_ENDPOINT,
        payload: { args: {} },
        signal,
        ...(options.socketFactory === undefined ? {} : { socketFactory: options.socketFactory }),
      });
      yield* values;
    },
  };
}
