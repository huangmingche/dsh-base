/**
 * Official `workspaceFiles` namespace bridge.
 *
 * The Workers-native Host keeps immutable file versions in R2 with metadata in
 * the Session Host Durable Object SQLite store. This bridge maps the official
 * `workspaceFiles/{list,stat,read,readBytes,changes}` wire contract onto the
 * owner-scoped `/api/session-host` methods, deriving `workspaceFileScope` from
 * the wire Session id exactly like the official Typert lookup.
 */
import type {
  WireInvocation,
  WireStreamHandler,
  WireStreamInvocation,
  WireStreamRegistry,
  WireRpc,
} from "@dsh-base/cloudflare-worker-wire-rpc";
import { SessionRpcFault } from "./remote-contract.ts";
import { createHostCall } from "./host-call.ts";
import { argsOf, isRecord, requestOf } from "./remote.ts";

type JsonRecord = Record<string, unknown>;

/** Read the flat official `workspaceFiles` arguments (optionally nested under `request`). */
function fileArgs(payload: unknown, endpoint: string): JsonRecord {
  const args = argsOf(payload, endpoint);
  return isRecord(args.request) ? args.request : args;
}

/** Resolve the wire `workspaceFileScope` lookup value to a Session id. */
function scopeSessionId(request: JsonRecord, endpoint: string): string {
  const scope = request.workspaceFileScope ?? request.workspaceFileScopeId ?? request.sessionId;
  if (typeof scope === "string" && scope !== "") return scope;
  if (isRecord(scope) && typeof scope.sessionId === "string" && scope.sessionId !== "") return scope.sessionId;
  throw new SessionRpcFault("gateway/bad-request", `${endpoint}: workspaceFileScope must carry a session id`, { endpoint, field: "workspaceFileScope" });
}

/** Read the optional path argument (root is the empty string). */
function pathOf(request: JsonRecord, endpoint: string): string {
  const path = request.path;
  if (path === undefined) return "";
  if (typeof path !== "string") throw new SessionRpcFault("gateway/bad-request", `${endpoint}: path must be a string`, { endpoint, field: "path" });
  return path;
}

/** Read the line window from `range` or flat fields. */
function lineRangeOf(request: JsonRecord): { offset?: number; limit?: number } {
  const range = isRecord(request.range) ? request.range : {};
  const offset = typeof range.offset === "number" ? range.offset : typeof request.offset === "number" ? request.offset : undefined;
  const limit = typeof range.limit === "number" ? range.limit : typeof request.limit === "number" ? request.limit : undefined;
  return { ...(offset === undefined ? {} : { offset }), ...(limit === undefined ? {} : { limit }) };
}

/** Read the byte window from `options.range` or flat fields. */
function byteRangeOf(request: JsonRecord): { offset?: number; length?: number } {
  const options = isRecord(request.options) ? request.options : {};
  const range = isRecord(options.range) ? options.range : isRecord(request.range) ? request.range : {};
  const offset = typeof range.offset === "number" ? range.offset : typeof request.offset === "number" ? request.offset : undefined;
  const length = typeof range.length === "number" ? range.length : typeof request.length === "number" ? request.length : undefined;
  return { ...(offset === undefined ? {} : { offset }), ...(length === undefined ? {} : { length }) };
}

/** Join an official relative `baseFile` option onto the requested path. */
function resolveBaseFile(path: string, request: JsonRecord): string {
  const options = isRecord(request.options) ? request.options : {};
  const baseFile = options.baseFile;
  if (typeof baseFile !== "string" || baseFile === "") return path;
  if (path.startsWith("/")) return path;
  const cut = baseFile.lastIndexOf("/");
  if (cut <= 0) return path;
  return `${baseFile.slice(0, cut)}/${path}`;
}

/** Seed the real transcript file once before the first read of a Session. */
async function ensureTranscript(call: (method: string, params?: JsonRecord) => Promise<unknown>, sessionId: string): Promise<void> {
  try {
    await call("workspaceFileEnsureTranscript", { sessionId });
  } catch (error) {
    // A missing R2 binding surfaces as unavailable; leave the fallback seam.
    if (error instanceof SessionRpcFault && (error.code === "workspace-file/unavailable" || error.code === "gateway/endpoint-unavailable")) throw error;
    // Any other seed failure must not hide the requested operation's outcome.
  }
}

/** Refresh the change feed from one stat call. */
async function pollVersion(
  call: (method: string, params?: JsonRecord) => Promise<unknown>,
  sessionId: string,
  path: string,
): Promise<{ absolutePath: string; version: string } | { absolutePath: string; absent: true } | undefined> {
  try {
    const stat = await call("workspaceFileStat", { sessionId, path }) as { readonly absolutePath?: unknown; readonly version?: unknown };
    if (typeof stat.absolutePath !== "string" || typeof stat.version !== "string") return undefined;
    return { absolutePath: stat.absolutePath, version: stat.version };
  } catch (error) {
    if (error instanceof SessionRpcFault && error.code === "workspace-file/not-found") {
      return { absolutePath: path, absent: true };
    }
    return undefined;
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Stream the official workspace-file watch frames for one target.
 * @param invocation - authenticated mux invocation with owner-scoped bindings.
 * @param request - `{workspaceFileScope, path}` official arguments.
 * @param signal - logical stream cancellation.
 */
async function* changesStream(invocation: WireStreamInvocation, request: JsonRecord, signal: AbortSignal): AsyncIterable<unknown> {
  const endpoint = "workspaceFiles/changes";
  const sessionId = scopeSessionId(request, endpoint);
  const path = pathOf(request, endpoint);
  const call = createHostCall(invocation);
  await ensureTranscript(call, sessionId);
  let current: { absolutePath: string; version: string } | { absolutePath: string; absent: true } | undefined;
  let ready = false;
  while (!signal.aborted) {
    const next = await pollVersion(call, sessionId, path);
    if (next !== undefined) {
      if (!ready) {
        ready = true;
        yield { kind: "ready" };
      }
      const changed = current === undefined
        || current.absolutePath !== next.absolutePath
        || ("version" in current && "version" in next ? current.version !== next.version : !("version" in current) && !("version" in next));
      if (changed) {
        current = next;
        yield "version" in next
          ? { kind: "change", change: { absolutePath: next.absolutePath, version: next.version } }
          : { kind: "change", change: { absolutePath: next.absolutePath, absent: true } };
      }
    }
    await sleep(800, signal);
  }
}

/**
 * Register the official unary `workspaceFiles` endpoints.
 * @param wireRpc - generic wire-RPC endpoint registry.
 * @returns disposer withdrawing every endpoint this bridge registered.
 */
export function registerWorkspaceFilesRemoteEndpoints(wireRpc: WireRpc): () => void {
  const disposers: Array<() => void> = [];
  const register = (method: string, handler: (payload: unknown, invocation: WireInvocation) => Promise<unknown> | unknown): void => {
    disposers.push(wireRpc.register(`workspaceFiles/${method}`, handler));
  };

  register("list", async (payload, invocation) => {
    const endpoint = "workspaceFiles/list";
    const request = fileArgs(payload, endpoint);
    const sessionId = scopeSessionId(request, endpoint);
    const call = createHostCall(invocation);
    await ensureTranscript(call, sessionId);
    return await call("workspaceFileList", { sessionId, path: pathOf(request, endpoint) });
  });

  register("stat", async (payload, invocation) => {
    const endpoint = "workspaceFiles/stat";
    const request = fileArgs(payload, endpoint);
    const sessionId = scopeSessionId(request, endpoint);
    const call = createHostCall(invocation);
    await ensureTranscript(call, sessionId);
    return await call("workspaceFileStat", { sessionId, path: pathOf(request, endpoint) });
  });

  register("read", async (payload, invocation) => {
    const endpoint = "workspaceFiles/read";
    const request = fileArgs(payload, endpoint);
    const sessionId = scopeSessionId(request, endpoint);
    const call = createHostCall(invocation);
    await ensureTranscript(call, sessionId);
    return await call("workspaceFileRead", { sessionId, path: pathOf(request, endpoint), ...lineRangeOf(request) });
  });

  register("readBytes", async (payload, invocation) => {
    const endpoint = "workspaceFiles/readBytes";
    const request = fileArgs(payload, endpoint);
    const sessionId = scopeSessionId(request, endpoint);
    const path = resolveBaseFile(pathOf(request, endpoint), request);
    const call = createHostCall(invocation);
    await ensureTranscript(call, sessionId);
    return await call("workspaceFileReadBytes", { sessionId, path, ...byteRangeOf(request) });
  });

  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}

/**
 * Register the official `workspaceFiles/changes` mux stream.
 * @param wireStream - stream registry provided by the wire-RPC plugin.
 * @returns disposer withdrawing the stream endpoint.
 */
export function registerWorkspaceFilesStreamEndpoints(wireStream: WireStreamRegistry): () => void {
  const handler: WireStreamHandler = (payload, invocation) => {
    const endpoint = "workspaceFiles/changes";
    const request = fileArgs(payload, endpoint);
    return changesStream(invocation, request, invocation.request.signal);
  };
  return wireStream.register("workspaceFiles/changes", handler);
}
