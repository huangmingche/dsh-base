import { registerUploadRemoteEndpoints } from "./remote-uploads.ts";
/** Workers-native official Session Host — Worker HTTP route and library exports. */
import type { Context } from "@deepseek-ai/cordis";
import type { WorkerHandler } from "@dsh-base/cloudflare-worker-http";
import { registerSessionRemoteEndpoints } from "./remote.ts";
import { registerSessionStreamEndpoints, registerToolResultStreamEndpoints } from "./remote-streams.ts";
import { registerRemoteAccessStreamEndpoint } from './remote-access.ts';
import { registerPermissionPresetEndpoints } from "./remote-permissions.ts";
import { registerWorkspaceRemoteEndpoints, registerWorkspaceStreamEndpoints } from "./remote-workspace.ts";
import { registerWorkspaceFilesRemoteEndpoints, registerWorkspaceFilesStreamEndpoints } from "./remote-workspace-files.ts";
import { registerScheduleRemoteEndpoints } from "./remote-schedule.ts";
import { registerDirectoryPickerRemoteEndpoints } from "./remote-directories.ts";
import { registerSettingsRemoteEndpoints } from "./remote-settings.ts";
import { agentName } from "./agent-name.ts";
import { getAgentByName } from "agents";
import { handleSessionHostRequest } from "./worker-http.ts";
import { SESSION_HOST_STORAGE_ID } from "./migration.ts";

export type { SessionHostReadContract } from "./storage.ts";
export type { SessionHostStorage, SessionMessageRecord, SessionRecord } from "./storage.ts";
export type * from "./contract.ts";
export { SessionHost } from "./host.ts";
export { WorkspaceFileStore, WorkspaceFileError } from "./workspace-files.ts";
export type {
  R2BucketLike,
  WorkspaceFileBytesPage,
  WorkspaceFileEntry,
  WorkspaceFileListing,
  WorkspaceFileScope,
  WorkspaceFileStat,
  WorkspaceFileTextPage,
  WorkspaceFileWriteResult,
} from "./workspace-files.ts";
export { SqliteSessionHostStorage } from "./sqlite-storage.ts";
export type { SqlCursor, SqlStorage } from "./sqlite-storage.ts";
export { createDurableObjectSessionHost } from "./durable-object.ts";
export type { DurableObjectSql } from "./durable-object.ts";
export { dispatchSessionHost, parseModelCatalog } from "./service.ts";
export type { SessionHostErrorResponse, SessionHostRequest, SessionHostResponse } from "./service.ts";
export { SessionHostObject } from "./do.ts";
export type { SessionHostObjectEnv, SessionHostObjectState } from "./do.ts";
export { handleSessionHostRequest } from "./worker-http.ts";
export type { SessionHostWorkerEnv } from "./worker-http.ts";
export { registerSessionRemoteEndpoints } from "./remote.ts";
export { registerSessionStreamEndpoints, registerToolResultStreamEndpoints } from "./remote-streams.ts";
export { registerPermissionPresetEndpoints } from "./remote-permissions.ts";
export {
  registerWorkspaceRemoteEndpoints,
  registerWorkspaceStreamEndpoints,
} from "./remote-workspace.ts";
export { registerScheduleRemoteEndpoints } from "./remote-schedule.ts";
export { registerDirectoryPickerRemoteEndpoints } from "./remote-directories.ts";
export { registerSettingsRemoteEndpoints } from "./remote-settings.ts";
export {
  registerWorkspaceFilesRemoteEndpoints,
  registerWorkspaceFilesStreamEndpoints,
} from "./remote-workspace-files.ts";
export type { WorkspaceBaseline, WorkspaceView } from "./remote-workspace.ts";
export type { WorkspaceView as SessionHostWorkspaceView } from "./host.ts";

export const name = "@dsh-base/cloudflare-worker-session-host";
export const inject = ["http", "auth"];
export const Config = undefined;

export function apply(ctx: Context): void {
  const authenticated: WorkerHandler = async (request, env) => {
    // This handler runs before later API/static handlers; it must not claim
    // requests outside its own route or it would turn every unauthenticated
    // request (public control GET, assets) into a session-host 401.
    const pathname = new URL(request.url).pathname;
    if (!pathname.startsWith("/api/session-host") && pathname !== "/api/session/uploadFileBinary") return undefined;
    const user = await ctx.auth.session(request, env);
    if (user === undefined) return Response.json({ error: "unauthenticated", source: "session-host" }, { status: 401 });
    if (pathname === "/api/session/uploadFileBinary") {
      const target = new URL(request.url); target.pathname = "/api/session-host/upload-file";
      request = new Request(target, request);
    }
    return handleSessionHostRequest(request, env, user.id);
  };
  ctx.effect(() => ctx.http.use(authenticated), "dsh-base: session host API");
  // Operator/acceptance surface for the rendered official system prompt. This
  // reads through the owner-scoped Agent DO binding, so it never exposes another
  // account's prompt and needs no Session Host Durable Object code change.
  const systemPromptRoute: WorkerHandler = async (request, env) => {
    const pathname = new URL(request.url).pathname;
    if (pathname !== "/api/system-prompt") return undefined;
    if (request.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });
    const user = await ctx.auth.session(request, env);
    if (user === undefined) return Response.json({ error: "unauthenticated" }, { status: 401 });
    let payload: unknown;
    try { payload = await request.json(); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }
    const sessionId = typeof payload === "object" && payload !== null && typeof (payload as { sessionId?: unknown }).sessionId === "string"
      ? (payload as { sessionId: string }).sessionId
      : undefined;
    if (sessionId === undefined) return Response.json({ error: "invalid_session" }, { status: 400 });
    const binding = (env as unknown as { DshAgent?: Parameters<typeof getAgentByName>[0] }).DshAgent;
    if (binding === undefined) return Response.json({ error: "agent_binding_missing" }, { status: 500 });
    try {
      const agent = await getAgentByName(binding, agentName(user.id, sessionId)) as unknown as {
        systemPromptDebug(): Promise<{ text: string; error?: string; waterfallRuns: number; context: Array<{ id: string; kind: string; text: string }>; contextInjectionError?: string; tools: string[]; workspaceInstructionsLength: number; lastRefreshError?: string; workspaceReadLog?: Array<{ path: string; ok: boolean; bytes?: number; error?: string }> }>;
        compactNow(): Promise<{ compacted: boolean; eventError?: string }>;
      };
      if (payload !== null && typeof payload === "object" && (payload as { compact?: unknown }).compact === true) {
        return Response.json(await agent.compactNow());
      }
      return Response.json(await agent.systemPromptDebug());
    } catch (error) {
      return Response.json({ error: "system_prompt_failed", message: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
  };
  ctx.effect(() => ctx.http.use(systemPromptRoute), "dsh-base: system prompt debug API");
  // Explicit recovery backup of settings and user-facing schedules. Ordinary
  // code releases preserve the same owner storage identity and need no export.
  const sidecarRoute: WorkerHandler = async (request, env) => {
    if (new URL(request.url).pathname !== "/api/session-host/export-sidecar") return undefined;
    if (request.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });
    const user = await ctx.auth.session(request, env);
    if (user === undefined) return Response.json({ error: "unauthenticated" }, { status: 401 });
    const typed = env as unknown as {
      SESSION_HOST?: DurableObjectNamespace;
      SESSION_HOST_GENERATION?: string;
      FILES?: { put(key: string, value: Uint8Array): Promise<unknown> };
    };
    if (typed.SESSION_HOST === undefined) {
      return Response.json({ error: "session_host_binding_missing" }, { status: 500 });
    }
    if (typed.FILES === undefined) return Response.json({ error: "backup_storage_unavailable" }, { status: 503 });
    const stub = typed.SESSION_HOST.get(typed.SESSION_HOST.idFromName(`owner:${user.id}:${SESSION_HOST_STORAGE_ID}`));
    const call = async (method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
      const response = await stub.fetch(new Request("https://session-host/api/session-host", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method, params }),
      }));
      const body = await response.json() as { readonly result?: unknown; readonly error?: unknown };
      if (!response.ok || body.error !== undefined) throw new Error(`${method} failed`);
      return body.result;
    };
    try {
      const settings = await call("settingsDescribe");
      const schedules = await call("scheduleCatalog");
      const payload = JSON.stringify({ version: 1, ownerId: user.id, exportedAt: new Date().toISOString(), settings, schedules });
      if (typed.FILES !== undefined) {
        await typed.FILES.put(`owner/${user.id}/migration/v49-sidecar.json`, new TextEncoder().encode(payload));
      }
      return Response.json({ exported: true, bytes: payload.length, settings: settings !== undefined, schedules: Array.isArray(schedules) ? schedules.length : 0 });
    } catch (error) {
      return Response.json({ error: "sidecar_export_failed", message: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
  };
  ctx.effect(() => ctx.http.use(sidecarRoute), "dsh-base: migration sidecar export API");
  // The official `session/*` and `workspace/*` RPC endpoints are optional
  // infrastructure: they register only when the generic wire-RPC plugin is
  // composed. The custom `/api/session-host` transport above never depends on
  // them, so a deployment that omits wire-RPC keeps the stable fallback.
  ctx.inject(["wireRpc"], (scope) => {
    const disposers = [registerSessionRemoteEndpoints(scope.wireRpc), registerUploadRemoteEndpoints(scope.wireRpc), registerPermissionPresetEndpoints(scope.wireRpc)];
    return () => { for (const dispose of disposers.reverse()) dispose(); };
  });
  ctx.inject(["wireRpc"], (scope) => registerWorkspaceRemoteEndpoints(scope.wireRpc));
  ctx.inject(["wireRpc"], (scope) => registerWorkspaceFilesRemoteEndpoints(scope.wireRpc));
  ctx.inject(["wireRpc"], (scope) => registerScheduleRemoteEndpoints(scope.wireRpc));
  ctx.inject(["wireRpc"], (scope) => registerSettingsRemoteEndpoints(scope.wireRpc));
  ctx.inject(["wireRpc"], (scope) => registerDirectoryPickerRemoteEndpoints(scope.wireRpc));
  // The official stream endpoints ride the Gateway mux. Streams are optional
  // infrastructure in the same way: the custom transport above never depends on
  // them, so a deployment without the mux keeps the stable fallback.
  ctx.inject(["wireStream"], (scope) => registerSessionStreamEndpoints(scope.wireStream));
  ctx.inject(["wireStream"], (scope) => registerRemoteAccessStreamEndpoint(scope.wireStream));
  ctx.inject(["wireStream"], (scope) => registerToolResultStreamEndpoints(scope.wireStream));
  ctx.inject(["wireStream"], (scope) => registerWorkspaceStreamEndpoints(scope.wireStream));
  ctx.inject(["wireStream"], (scope) => registerWorkspaceFilesStreamEndpoints(scope.wireStream));
}
