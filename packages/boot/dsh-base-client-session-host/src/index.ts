export { hostProjectionBlock, hostProjectionControl } from "./projection-block.ts";
/**
 * Browser transport for the Workers-native Session Host.
 *
 * This is a seam, not an official plugin: it maps the official Session Remote
 * calls onto `POST /api/session-host` and its SSE follow/control endpoints.
 */

/** One Host request failure. */
export class SessionHostClientError extends Error {
  readonly code: string;
  readonly method: string;
  readonly details: unknown;

  constructor(method: string, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "SessionHostClientError";
    this.method = method;
    this.code = code;
    this.details = details;
  }
}

/** Options shared by every Host request. */
export interface SessionHostClientOptions {
  readonly baseUrl: string;
  readonly fetch?: typeof globalThis.fetch;
}

/** One event from the Host journal. */
export interface SessionHostEvent {
  readonly sessionId: string;
  readonly seq: number;
  readonly type: string;
  readonly payload: unknown;
  readonly createdAt: number;
}

/** One Host control frame. */
export interface SessionHostControlFrame {
  readonly type: "sessions.snapshot";
  readonly sessions: readonly unknown[];
}

/** Transport for the official Session Remote surface. */
export interface SessionHostClient {
  request<T>(method: string, params?: unknown): Promise<T>;
  list(cursor?: string): Promise<{ sessions: readonly unknown[]; cursor?: string }>;
  state(sessionId: string): Promise<unknown>;
  page(sessionId: string, before?: number, limit?: number): Promise<unknown>;
  projections(sessionId: string): Promise<Record<string, unknown>>;
  rename(sessionId: string, title: string): Promise<{ title: string; projectionRevision?: number }>;
  create(input?: { title?: string; sessionId?: string; workspaceId?: string; cwd?: string }): Promise<{ sessionId: string }>;
  fork(sessionId: string, messageId?: string): Promise<{ sessionId: string }>;
  selectModel(sessionId: string, model: string, reasoningEffort?: string): Promise<{ model: string; reasoningEffort?: string }>;
  models(): Promise<readonly unknown[]>;
  uploadAttachment(input: {
    sessionId: string;
    name: string;
    mediaType: string;
    dataBase64: string;
  }): Promise<{ attachmentId: string; name: string; mediaType: string; size: number }>;
  prompt(
    sessionId: string,
    text: string,
    requestId?: string,
    attachments?: readonly { attachmentId: string }[],
  ): Promise<{ requestId: string; submissionId: string }>;
  cancel(sessionId: string): Promise<void>;
  updateQueue(sessionId: string, itemId: string, action: "remove" | "retry" | "clear"): Promise<void>;
  claim(sessionId: string, submissionId: string): Promise<unknown>;
  live(sessionId: string): Promise<{ live?: { attemptId: string; turn: number; step: number; revision: number; chunks: ReadonlyArray<{ type: string; index: number; text: string }> } | null }>;
  liveStream(sessionId: string, signal: AbortSignal): AsyncIterable<{ live?: { attemptId: string; turn: number; step: number; revision: number; chunks: ReadonlyArray<{ type: string; index: number; text: string }> } }>;
  workspaceState(): Promise<unknown>;
  workspaceInitializeDefault(): Promise<unknown>;
  workspaceCreate(input?: { path?: string; title?: string }): Promise<unknown>;
  workspaceRename(workspaceId: string, title: string): Promise<unknown>;
  workspaceDelete(workspaceId: string): Promise<unknown>;
  workspaceSetFlags(sessionId: string, flags: { pinned?: boolean; archived?: boolean }): Promise<unknown>;
  follow(sessionId: string, after: number, signal: AbortSignal): AsyncIterable<SessionHostEvent>;
  control(signal: AbortSignal): AsyncIterable<SessionHostControlFrame>;
}

function endpoint(baseUrl: string, path = ""): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/session-host${path}`;
}

async function* sse<T>(response: Response, signal: AbortSignal): AsyncIterable<T> {
  if (response.body === null) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = block.split("\n").filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("\n");
        if (data !== "") yield JSON.parse(data) as T;
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

/** Create a browser transport for one deployed Session Host. */
export function createSessionHostClient(options: SessionHostClientOptions): SessionHostClient {
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);

  async function request<T>(method: string, params: unknown = {}): Promise<T> {
    const response = await fetcher(endpoint(options.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method, params }),
    });
    let parsed: unknown;
    try { parsed = await response.json(); } catch {
      throw new SessionHostClientError(method, response.ok ? "invalid_response" : String(response.status),
        response.ok ? "Session Host returned invalid JSON" : `Session Host HTTP ${response.status}`);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new SessionHostClientError(method, response.ok ? "invalid_response" : String(response.status),
        "Session Host returned an invalid response envelope");
    }
    const body = parsed as { readonly result?: T; readonly error?: unknown; readonly message?: unknown };
    if (body.error !== undefined) {
      const failure = typeof body.error === "object" && body.error !== null
        ? body.error as { readonly code?: unknown; readonly message?: unknown; readonly details?: unknown }
        : undefined;
      throw new SessionHostClientError(method,
        typeof failure?.code === "string" ? failure.code : typeof body.error === "string" ? body.error : "unknown",
        typeof failure?.message === "string" ? failure.message : typeof body.message === "string" ? body.message : "Session Host request failed",
        failure?.details);
    }
    if (!response.ok) throw new SessionHostClientError(method, String(response.status), `Session Host HTTP ${response.status}`);
    if (!Object.hasOwn(body, "result")) {
      throw new SessionHostClientError(method, "invalid_response", "Session Host response is missing result");
    }
    return body.result as T;
  }

  async function stream<T>(path: string, signal: AbortSignal): Promise<Response> {
    const response = await fetcher(endpoint(options.baseUrl, path), {
      method: "GET",
      headers: { accept: "text/event-stream" },
      signal,
    });
    if (!response.ok) throw new SessionHostClientError("stream", String(response.status), await response.text());
    return response;
  }

  return {
    request,
    list: (cursor) => request("list", cursor === undefined ? {} : { cursor }),
    state: (sessionId) => request("state", { sessionId }),
    page: (sessionId, before, limit) => request("page", {
      address: { kind: "session", sessionId },
      ...(before === undefined ? {} : { before }),
      ...(limit === undefined ? {} : { limit }),
    }),
    projections: (sessionId) => request("projections", { sessionId }),
    rename: (sessionId, title) => request("rename", { sessionId, title }),
    create: (input = {}) => request("create", input),
    fork: (sessionId, messageId) => request("fork", {
      sessionId, ...(messageId === undefined ? {} : { messageId }),
    }),
    selectModel: (sessionId, model, reasoningEffort) => request("selectModel", { sessionId, model, ...(reasoningEffort === undefined ? {} : { reasoningEffort }) }),
    models: () => request("models"),
    uploadAttachment: (input) => request("uploadAttachment", input),
    prompt: (sessionId, text, requestId, attachments) => request("prompt", {
      sessionId, text,
      ...(requestId === undefined ? {} : { requestId }),
      ...(attachments === undefined || attachments.length === 0 ? {} : { attachments }),
    }),
    cancel: (sessionId) => request("cancel", { sessionId }),
    updateQueue: (sessionId, itemId, action) => request("updateQueue", { sessionId, itemId, action }),
    claim: (sessionId, submissionId) => request("claim", { sessionId, submissionId }),
    live: (sessionId) => request("live", { sessionId }),
    async *liveStream(sessionId, signal) {
      const response = await stream(`/live-stream?sessionId=${encodeURIComponent(sessionId)}`, signal);
      yield* sse<{ live?: { attemptId: string; turn: number; step: number; revision: number; chunks: ReadonlyArray<{ type: string; index: number; text: string }> } }>(response, signal);
    },
    workspaceState: () => request("workspaceState"),
    workspaceInitializeDefault: () => request("workspaceInitializeDefault"),
    workspaceCreate: (input = {}) => request("workspaceCreate", input),
    workspaceRename: (workspaceId, title) => request("workspaceRename", { workspaceId, title }),
    workspaceDelete: (workspaceId) => request("workspaceDelete", { workspaceId }),
    workspaceSetFlags: (sessionId, flags) => request("workspaceSetFlags", { sessionId, ...flags }),
    async *follow(sessionId, after, signal) {
      const response = await stream(`/follow?sessionId=${encodeURIComponent(sessionId)}&after=${after}`, signal);
      yield* sse<SessionHostEvent>(response, signal);
    },
    async *control(signal) {
      const response = await stream("/control", signal);
      yield* sse<SessionHostControlFrame>(response, signal);
    },
  };
}

export { openWireStream, WireStreamFailure } from "./wire-stream.ts";
export type { WireStreamOptions, WireStreamSocketLike } from "./wire-stream.ts";
export {
  createOfficialWorkspaceFilesGateway,
  WORKSPACE_FILES_ENDPOINTS,
} from "./workspace-files-gateway.ts";
export type {
  OfficialWorkspaceFilesGateway,
  OfficialWorkspaceFilesGatewayOptions,
  WorkspaceDirectoryEntry,
  WorkspaceDirectoryListing,
  WorkspaceFileBytes,
  WorkspaceFileStat,
  WorkspaceFileText,
  WorkspaceFileWatchFrame,
} from "./workspace-files-gateway.ts";
export { createOfficialPermissionGateway, PERMISSION_REMOTE_ENDPOINT } from "./permission-gateway.ts";
export type {
  OfficialPermissionGateway,
  OfficialPermissionGatewayOptions,
  PermissionGatewayResult,
  PermissionPresetCatalog,
  PermissionPresetOption,
} from "./permission-gateway.ts";
export {
  createOfficialSessionGateway,
  isOfficialEndpointUnavailable,
  OfficialGatewayTransportError,
  SESSION_REMOTE_DESCRIPTOR,
  SESSION_REMOTE_ENDPOINTS,
} from "./gateway.ts";
export type {
  OfficialGatewayResult,
  OfficialModelCatalog,
  OfficialModelSelection,
  OfficialSessionGateway,
  OfficialSessionGatewayOptions,
  OfficialSessionHistoryRecord,
  OfficialSessionList,
  OfficialSessionPage,
  OfficialSessionPageRequest,
  OfficialSessionProjections,
  OfficialSessionSummary,
} from "./gateway.ts";
export {
  createOfficialWorkspaceGateway,
  WORKSPACE_FOLLOW_ENDPOINT,
  WORKSPACE_REMOTE_DESCRIPTOR,
  WORKSPACE_REMOTE_ENDPOINTS,
} from "./workspace-gateway.ts";
export type {
  OfficialWorkspaceArchiveValue,
  OfficialWorkspaceBaseline,
  OfficialWorkspaceCreateValue,
  OfficialWorkspaceDeleteValue,
  OfficialWorkspaceFollowFrame,
  OfficialWorkspaceFollowIncrement,
  OfficialWorkspaceGateway,
  OfficialWorkspaceGatewayOptions,
  OfficialWorkspaceOrderValue,
  OfficialWorkspacePinValue,
  OfficialWorkspaceValue,
  OfficialWorkspaceView,
} from "./workspace-gateway.ts";
