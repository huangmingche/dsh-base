/**
 * Official `workspace` RPC and follow-stream bridge over the Workers-native
 * Session Host.
 *
 * The official `api-workspace-controller` client calls `workspace/<method>`
 * with the generated `{ args: { request } }` payload. Each handler dispatches
 * through the same `/api/session-host` transport as the custom browser client,
 * so one Durable Object owns the Workspace registry, its order, and the
 * archive/pin flag sets. Streams are served by the Gateway stream mux through
 * `registerWorkspaceStreamEndpoints`.
 */
import type {
  WireHandler,
  WireInvocation,
  WireRpc,
  WireStreamHandler,
  WireStreamInvocation,
  WireStreamRegistry,
} from "@dsh-base/cloudflare-worker-wire-rpc";
import { SessionRpcFault } from "./remote-contract.ts";
import { argsOf, isRecord, requestOf, sessionIdOf } from "./remote.ts";
import { createHostCall, hostChanges } from "./host-call.ts";

/** One durable Workspace in the official `WorkspaceView` wire shape. */
export interface WorkspaceView {
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

/** Complete Workspace reconnect baseline. */
export interface WorkspaceBaseline {
  readonly items: readonly WorkspaceView[];
  readonly archivedSessionIds: readonly string[];
  /** Registry-global pin set, most recently pinned first. */
  readonly pinnedSessionIds: readonly string[];
}

type JsonRecord = Record<string, unknown>;

function resultInvalid(endpoint: string, field: string): SessionRpcFault {
  return new SessionRpcFault("gateway/result-invalid", `${endpoint}: Host returned an invalid ${field}`, { endpoint, field });
}

function badRequest(endpoint: string, field: string): SessionRpcFault {
  return new SessionRpcFault("gateway/bad-request", `${endpoint}: ${field} is invalid`, { endpoint, field });
}

function requiredString(request: JsonRecord, field: string, endpoint: string): string {
  const value = request[field];
  if (typeof value !== "string" || value === "") throw badRequest(endpoint, field);
  return value;
}

function optionalString(request: JsonRecord, field: string, endpoint: string): string | undefined {
  const value = request[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value === "") throw badRequest(endpoint, field);
  return value;
}

/** Validate an optional boolean that this bridge deliberately ignores. */
function ignoredBoolean(request: JsonRecord, field: string, endpoint: string): void {
  const value = request[field];
  if (value !== undefined && typeof value !== "boolean") throw badRequest(endpoint, field);
}

function nonEmptyString(value: unknown, endpoint: string, field: string): string {
  if (typeof value !== "string" || value === "") throw resultInvalid(endpoint, field);
  return value;
}

function stringList(value: unknown, endpoint: string, field: string): string[] {
  if (!Array.isArray(value)) throw resultInvalid(endpoint, field);
  return value.map((item) => nonEmptyString(item, endpoint, field));
}

function isoInstant(value: unknown, endpoint: string, field: string): string {
  const instant = nonEmptyString(value, endpoint, field);
  if (Number.isNaN(Date.parse(instant))) throw resultInvalid(endpoint, field);
  return instant;
}

/**
 * Project one Host Workspace row into the official wire value.
 * @param value - Host value read back through `/api/session-host`.
 * @param endpoint - endpoint name for failure details.
 * @returns the validated official `WorkspaceView`.
 */
export function toWorkspaceView(value: unknown, endpoint: string): WorkspaceView {
  if (!isRecord(value)) throw resultInvalid(endpoint, "workspace");
  return {
    workspaceId: nonEmptyString(value.workspaceId, endpoint, "workspace.workspaceId"),
    path: nonEmptyString(value.path, endpoint, "workspace.path"),
    title: nonEmptyString(value.title, endpoint, "workspace.title"),
    sessionIds: stringList(value.sessionIds, endpoint, "workspace.sessionIds"),
    createdAt: isoInstant(value.createdAt, endpoint, "workspace.createdAt"),
    updatedAt: isoInstant(value.updatedAt, endpoint, "workspace.updatedAt"),
  };
}

/**
 * Project one Host Workspace baseline into the official follow value.
 * @param value - Host `workspaceState` value.
 * @param endpoint - endpoint name for failure details.
 * @returns the validated complete Workspace state.
 */
export function toWorkspaceBaseline(value: unknown, endpoint: string): WorkspaceBaseline {
  if (!isRecord(value)) throw resultInvalid(endpoint, "workspace baseline");
  if (!Array.isArray(value.items)) throw resultInvalid(endpoint, "workspace baseline items");
  return {
    items: value.items.map((item) => toWorkspaceView(item, endpoint)),
    archivedSessionIds: stringList(value.archivedSessionIds, endpoint, "archivedSessionIds"),
    pinnedSessionIds: stringList(value.pinnedSessionIds, endpoint, "pinnedSessionIds"),
  };
}

/**
 * Read the complete archive set from one Host `workspaceState` reply.
 * @param value - Host `workspaceState` value.
 * @param endpoint - endpoint name for failure details.
 * @returns validated archived Session ids.
 */
export function archivedIdsOf(value: unknown, endpoint: string): string[] {
  if (!isRecord(value)) throw resultInvalid(endpoint, "workspace state");
  return stringList(value.archivedSessionIds, endpoint, "archivedSessionIds");
}

/**
 * Read the complete pin set from one Host `workspaceState` reply.
 * @param value - Host `workspaceState` value.
 * @param endpoint - endpoint name for failure details.
 * @returns validated pinned Session ids in Host order.
 */
export function pinnedIdsOf(value: unknown, endpoint: string): string[] {
  if (!isRecord(value)) throw resultInvalid(endpoint, "workspace state");
  return stringList(value.pinnedSessionIds, endpoint, "pinnedSessionIds");
}

/** Translate the generic Host not-found fault into the Workspace namespace. */
function workspaceNotFound(error: unknown, workspaceId: string): never {
  if (error instanceof SessionRpcFault && error.code === "session/not-found") {
    throw new SessionRpcFault("workspace/not-found", error.message, { workspaceId });
  }
  throw error;
}

/**
 * Register every migrated unary `workspace/*` endpoint on the generic wire-RPC
 * service.
 * @param wireRpc - endpoint registry provided by the Worker wire-RPC plugin.
 * @returns disposer withdrawing every endpoint this bridge registered.
 */
export function registerWorkspaceRemoteEndpoints(wireRpc: WireRpc): () => void {
  const disposers: Array<() => void> = [];
  const register = (method: string, handler: WireHandler): void => {
    disposers.push(wireRpc.register(`workspace/${method}`, handler));
  };

  register("create", async (payload, invocation) => {
    const endpoint = "workspace/create";
    const request = requestOf(argsOf(payload, endpoint), endpoint);
    const path = requiredString(request, "path", endpoint);
    const result = await createHostCall(invocation)("workspaceCreate", { path }) as {
      readonly workspace?: unknown;
      readonly created?: unknown;
    };
    return { workspace: toWorkspaceView(result.workspace, endpoint), created: result.created === true };
  });

  register("initializeDefault", async (payload, invocation) => {
    const endpoint = "workspace/initializeDefault";
    argsOf(payload, endpoint);
    const result = await createHostCall(invocation)("workspaceInitializeDefault") as { readonly workspace?: unknown };
    // The official value is WorkspaceValue | undefined; the Host always has a
    // default Workspace, but an empty reply maps to the absent value.
    return result.workspace === undefined ? {} : { workspace: toWorkspaceView(result.workspace, endpoint) };
  });

  register("rename", async (payload, invocation) => {
    const endpoint = "workspace/rename";
    const request = requestOf(argsOf(payload, endpoint), endpoint);
    const workspaceId = requiredString(request, "workspaceId", endpoint);
    if (typeof request.title !== "string") throw badRequest(endpoint, "title");
    try {
      const result = await createHostCall(invocation)("workspaceRename", { workspaceId, title: request.title }) as {
        readonly workspace?: unknown;
      };
      return { workspace: toWorkspaceView(result.workspace, endpoint) };
    } catch (error) {
      return workspaceNotFound(error, workspaceId);
    }
  });

  register("delete", async (payload, invocation) => {
    const endpoint = "workspace/delete";
    const request = requestOf(argsOf(payload, endpoint), endpoint);
    const workspaceId = requiredString(request, "workspaceId", endpoint);
    try {
      await createHostCall(invocation)("workspaceDelete", { workspaceId });
    } catch (error) {
      workspaceNotFound(error, workspaceId);
    }
    return { deleted: true };
  });

  register("insertBefore", async (payload, invocation) => {
    const endpoint = "workspace/insertBefore";
    const request = requestOf(argsOf(payload, endpoint), endpoint);
    const workspaceId = requiredString(request, "workspaceId", endpoint);
    const beforeWorkspaceId = optionalString(request, "beforeWorkspaceId", endpoint);
    try {
      const result = await createHostCall(invocation)("workspaceInsertBefore", {
        workspaceId,
        ...(beforeWorkspaceId === undefined ? {} : { beforeWorkspaceId }),
      }) as { readonly workspaceIds?: unknown };
      if (!isRecord(result)) throw resultInvalid(endpoint, "workspace order");
      return { workspaceIds: stringList(result.workspaceIds, endpoint, "workspaceIds") };
    } catch (error) {
      return workspaceNotFound(error, workspaceId);
    }
  });

  register("insertSessionBefore", async (payload, invocation) => {
    const endpoint = "workspace/insertSessionBefore";
    const request = requestOf(argsOf(payload, endpoint), endpoint);
    const workspaceId = requiredString(request, "workspaceId", endpoint);
    const sessionId = sessionIdOf(request, endpoint);
    const beforeSessionId = optionalString(request, "beforeSessionId", endpoint);
    try {
      const result = await createHostCall(invocation)("workspaceInsertSessionBefore", {
        workspaceId,
        sessionId,
        ...(beforeSessionId === undefined ? {} : { beforeSessionId }),
      }) as { readonly workspace?: unknown };
      return { workspace: toWorkspaceView(result.workspace, endpoint) };
    } catch (error) {
      if (error instanceof SessionRpcFault && error.code === "session/not-found") {
        throw new SessionRpcFault("workspace/not-found", error.message, { workspaceId });
      }
      if (error instanceof SessionRpcFault && error.code === "gateway/bad-request") {
        throw new SessionRpcFault("workspace/move-invalid", error.message, {
          workspaceId,
          sessionId,
          ...(beforeSessionId === undefined ? {} : { beforeSessionId }),
        });
      }
      throw error;
    }
  });

  register("archiveSession", async (payload, invocation) => {
    const endpoint = "workspace/archiveSession";
    const request = requestOf(argsOf(payload, endpoint), endpoint);
    const sessionId = sessionIdOf(request, endpoint);
    ignoredBoolean(request, "stopActivity", endpoint);
    const call = createHostCall(invocation);
    await call("workspaceArchive", { sessionId, stopActivity: request.stopActivity === true });
    const state = await call("workspaceState");
    return { archivedSessionIds: archivedIdsOf(state, endpoint) };
  });

  register("unarchiveSession", async (payload, invocation) => {
    const endpoint = "workspace/unarchiveSession";
    const request = requestOf(argsOf(payload, endpoint), endpoint);
    const sessionId = sessionIdOf(request, endpoint);
    const call = createHostCall(invocation);
    try {
      await call("workspaceSetFlags", { sessionId, archived: false });
    } catch (error) {
      // Unknown sessions are not archived, so the official idempotent call
      // succeeds and reports the unchanged set.
      if (!(error instanceof SessionRpcFault) || error.code !== "session/not-found") throw error;
    }
    return { archivedSessionIds: archivedIdsOf(await call("workspaceState"), endpoint) };
  });

  register("pinSession", async (payload, invocation) => {
    const endpoint = "workspace/pinSession";
    const request = requestOf(argsOf(payload, endpoint), endpoint);
    const sessionId = sessionIdOf(request, endpoint);
    const call = createHostCall(invocation);
    const state = await call("workspaceState");
    if (!isRecord(state)) throw resultInvalid(endpoint, "workspace state");
    if (stringList(state.archivedSessionIds, endpoint, "archivedSessionIds").includes(sessionId)) {
      throw new SessionRpcFault("gateway/bad-request", `${endpoint}: an archived Session cannot be pinned`, { endpoint });
    }
    await call("workspaceSetFlags", { sessionId, pinned: true });
    return { pinnedSessionIds: pinnedIdsOf(await call("workspaceState"), endpoint) };
  });

  register("unpinSession", async (payload, invocation) => {
    const endpoint = "workspace/unpinSession";
    const request = requestOf(argsOf(payload, endpoint), endpoint);
    const sessionId = sessionIdOf(request, endpoint);
    const call = createHostCall(invocation);
    try {
      await call("workspaceSetFlags", { sessionId, pinned: false });
    } catch (error) {
      // Unknown sessions are not pinned, so the official idempotent call
      // succeeds and reports the unchanged set.
      if (!(error instanceof SessionRpcFault) || error.code !== "session/not-found") throw error;
    }
    return { pinnedSessionIds: pinnedIdsOf(await call("workspaceState"), endpoint) };
  });

  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}

/**
 * Stream `baseline` once, then a complete `replace` after a committed owner
 * invalidation changes the registry, order, archive, or pin state.
 */
async function* followWorkspace(
  invocation: WireStreamInvocation,
  signal: AbortSignal,
): AsyncIterable<unknown> {
  const call = createHostCall(invocation);
  let previous = "";
  let opened = false;
  for await (const change of hostChanges(invocation, signal)) {
    if (opened && change.topics.length > 0 && !change.topics.includes('sessions')) continue;
    const state = await call("workspaceState");
    const baseline = toWorkspaceBaseline(state, "workspace/follow");
    const signature = JSON.stringify(baseline);
    if (signature !== previous) {
      previous = signature;
      yield opened ? { type: "replace", value: baseline } : { type: "baseline", value: baseline };
      opened = true;
    }
  }
}

/**
 * Register the `workspace/follow` logical stream on the Gateway stream mux.
 * @param wireStream - stream registry provided by the wire-RPC plugin.
 * @returns disposer withdrawing the stream this bridge registered.
 */
export function registerWorkspaceStreamEndpoints(wireStream: WireStreamRegistry): () => void {
  const handler: WireStreamHandler = (payload, invocation) => {
    argsOf(payload, "workspace/follow");
    return followWorkspace(invocation, invocation.request.signal);
  };
  const dispose = wireStream.register("workspace/follow", handler);
  return () => dispose();
}
