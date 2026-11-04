/** Workers Host services consumed by the unchanged official client plugins. */
import type { Context } from "@deepseek-ai/cordis";
import { z } from "zod";
import type { ConnectionHandle } from "@deepseek-ai/dsh-client-connection/client";
import { createWebConnectionRpc } from "@deepseek-ai/dsh-client-connection/src/client/rpc.ts";
import { installRemoteMount } from "./remote-mount.ts";
import { createSettingsRemote } from "./settings-remote.ts";
import { createScheduleRemote } from "./schedule-remote.ts";
import { createRemoteInvalidations } from "./remote-events.ts";
import { subscribeOwnerInvalidations } from "./owner-invalidations.ts";
import { createPermissionCommands } from "./permission-command.ts";
import { createApprovalBridge, createApprovalHostCall, type ApprovalPresentation } from "./approval-bridge.ts";
import { createScope } from "@deepseek-ai/dsh-api-session-controller/client";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import { getDirectory, type ChatRecord } from "@dsh-base/client-core";
import {
  hostProjectionBlock,
  hostProjectionControl,
  createOfficialPermissionGateway,
  createOfficialSessionGateway,
  createOfficialWorkspaceFilesGateway,
  createOfficialWorkspaceGateway,
  createSessionHostClient,
  isOfficialEndpointUnavailable,
  type OfficialGatewayResult,
  type OfficialModelCatalog,
  type OfficialPermissionGateway,
  type OfficialSessionGateway,
  type OfficialWorkspaceFilesGateway,
  type OfficialSessionList,
  type OfficialSessionPage,
  type OfficialSessionProjections,
  type OfficialWorkspaceGateway,
  type OfficialWorkspaceView,
} from "@dsh-base/client-session-host";
import { openWireStream, WireStreamFailure } from "@dsh-base/client-session-host/wire-stream";
import { createHostRemoteStream } from "@dsh-base/client-session-host/remote-stream";
import type { RemoteStreamOptions } from "@deepseek-ai/dsh-api-gateway/client";
import { fileReferenceCandidates, sessionReferenceCandidates } from "./chat-references.ts";
import { readLocalAccount, signOutLocalAccount, type LocalAccountUser } from "./account-transport.ts";
import { createDirectoryRemote } from "./directory-remote.ts";
import { createAttachmentRemotes } from "./attachment-remote.ts";
import { createModelSelectionRemote, REASONING_UNAVAILABLE_REASON } from "./model-selection-remote.ts";
import { createFixedAgentPresets } from "./fixed-agent-presets.ts";
import { agentPresetUnavailableReason, fixedAgentPresetCopy } from "../../../../boot/dsh-base-agent-presets/src/availability.ts";
import { FIXED_AGENT_PRESET_ID } from "../../../../boot/dsh-base-agent-presets/src/index.ts";
import { createWorkspaceFilesRemote } from "./workspace-files-remote.ts";
import { createReadOnlyPluginRemotes } from "./plugin-inventory-readonly.ts";
import { buildFallbackModelCatalog } from "./model-catalog-fallback.ts";
import { createCredentialsRemote } from "./persistence-remotes.ts";
import { feedbackUnavailableReason } from "@dsh-base/client-feedback-availability/availability";
import { CHAT_SKILLS } from "@dsh-base/chat-skills";
import { buildSessionHistory, SessionWireSequencer, SessionLiveFrameSequencer, type SessionHistoryMessage, type SessionHistorySnapshot, type SessionTurnState, type SessionLiveAttempt, type SessionWireRecord } from "@dsh-base/session-wire";

export const name = "@dsh-base/client-session-adapter";
export const Config = z.object({}).default({});
export const inject = ["slots", "connection", "typert"];

const emptyObservable = <T>(value: T) => ({ getSnapshot: () => value, subscribe: () => () => {} });

let clientContext: Context | undefined;

const hostTransport = typeof location === "undefined"
  ? undefined
  : createSessionHostClient({ baseUrl: location.origin });

/**
 * Official-style `session/*` descriptor over the Worker RPC bridge. The custom
 * `hostTransport` above remains the fallback for endpoints that are not
 * migrated yet or deployments that predate the bridge.
 */
const officialSessionGateway: OfficialSessionGateway | undefined = typeof location === "undefined"
  ? undefined
  : createOfficialSessionGateway({
      baseUrl: location.origin,
      connection: () => clientContext?.get("connection") as ConnectionHandle | undefined,
    });

/** Official-style `workspace/*` descriptor over the same Worker RPC bridge. */
const officialWorkspaceGateway: OfficialWorkspaceGateway | undefined = typeof location === "undefined"
  ? undefined
  : createOfficialWorkspaceGateway({
      baseUrl: location.origin,
      connection: () => clientContext?.get("connection") as ConnectionHandle | undefined,
    });

/** Official-style `workspaceFiles/*` descriptor over the Worker RPC bridge. */
const officialWorkspaceFilesGateway: OfficialWorkspaceFilesGateway | undefined = typeof location === "undefined"
  ? undefined
  : createOfficialWorkspaceFilesGateway({
      baseUrl: location.origin,
      connection: () => clientContext?.get("connection") as ConnectionHandle | undefined,
    });

/** Official-style read-only `permissionPresets/*` descriptor. */
const officialPermissionGateway: OfficialPermissionGateway | undefined = typeof location === "undefined"
  ? undefined
  : createOfficialPermissionGateway({
      baseUrl: location.origin,
      connection: () => clientContext?.get("connection") as ConnectionHandle | undefined,
    });

/**
 * Call the official Session endpoint first and fall back to the custom Host
 * transport only when the endpoint itself is unavailable. Business failures
 * and carrier failures after an admitted call are surfaced, so a mutation is
 * never replayed against the legacy transport.
 */
async function withOfficialSession<T>(
  official: () => Promise<OfficialGatewayResult<T>>,
  fallback: () => Promise<OfficialGatewayResult<T>>,
): Promise<OfficialGatewayResult<T>> {
  if (officialSessionGateway === undefined) return fallback();
  try {
    const result = await official();
    if (result.ok || !isOfficialEndpointUnavailable(result.error)) return result;
  } catch (error) {
    if (!isOfficialEndpointUnavailable(error)) return hostError(error);
  }
  try {
    return await fallback();
  } catch (error) {
    return hostError(error);
  }
}

/** Same fallback rule for the official `workspace/*` endpoints. */
async function withOfficialWorkspace<T>(
  official: () => Promise<OfficialGatewayResult<T>>,
  fallback: () => Promise<OfficialGatewayResult<T>>,
): Promise<OfficialGatewayResult<T>> {
  if (officialWorkspaceGateway === undefined) return fallback();
  try {
    const result = await official();
    if (result.ok || !isOfficialEndpointUnavailable(result.error)) return result;
  } catch (error) {
    if (!isOfficialEndpointUnavailable(error)) return hostError(error);
  }
  try {
    return await fallback();
  } catch (error) {
    return hostError(error);
  }
}

/** Official-first call for the read-only permission catalog. */
async function withOfficialPermission<T>(
  official: () => Promise<{ readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }>,
  fallback: () => Promise<{ readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }>,
): Promise<{ readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }> {
  if (officialPermissionGateway === undefined) return fallback();
  try {
    const result = await official();
    if (result.ok || !isOfficialEndpointUnavailable(result.error)) return result;
  } catch (error) {
    if (!isOfficialEndpointUnavailable(error)) return hostError(error);
  }
  try {
    return await fallback();
  } catch (error) {
    return hostError(error);
  }
}

async function listAllHostSessions(): Promise<Array<{
  sessionId: string;
  title?: string;
  blank?: boolean;
  cwd?: string;
  workspaceId?: string;
}>> {
  if (hostTransport === undefined) throw new Error("host transport missing");
  const sessions: Array<{ sessionId: string; title?: string; blank?: boolean; cwd?: string; workspaceId?: string }> = [];
  let cursor: string | undefined;
  // Load the complete Host baseline: a fixed page cap hides older Sessions
  // behind recent blank placeholders, which makes Workspace groups look empty.
  for (let page = 0; page < 2_000; page += 1) {
    const result = await hostTransport.list(cursor);
    sessions.push(...(result.sessions as Array<{ sessionId: string; title?: string; blank?: boolean; cwd?: string; workspaceId?: string }>));
    cursor = result.cursor;
    if (cursor === undefined) break;
  }
  return sessions;
}

/** Request ids awaiting their durable user/message echo in the follow stream. */
let lastReportedClientTimeZone: string | undefined;
const pendingPromptRequests: Array<{ requestId: string; text: string }> = [];
/** Durable user message ids already associated with a submission request id. */
const promptRpcByUserMessage = new Map<string, string>();
/** Prompt receipts waiting to open the live Thinking process row. */
const pendingPromptSignals: string[] = [];

function rpcIdForUser(message: { id: string }, text: string): string | undefined {
  const known = promptRpcByUserMessage.get(message.id);
  if (known !== undefined) return known;
  const index = pendingPromptRequests.findIndex((pending) => pending.text === text);
  if (index === -1) return undefined;
  const { requestId } = pendingPromptRequests.splice(index, 1)[0]!;
  promptRpcByUserMessage.set(message.id, requestId);
  return requestId;
}

function hostError(error: unknown): { ok: false; error: { code: string; message: string; details: unknown } } {
  const failure = error as { code?: string; message?: string; details?: unknown } | undefined;
  return { ok: false, error: {
    code: typeof failure?.code === "string" ? failure.code : "host_error",
    message: typeof failure?.message === "string" ? failure.message : String(error),
    details: failure?.details ?? {},
  } };
}

function tokenUsageFromValues(values: Record<string, unknown>): Record<string, number> | undefined {
  const direct = values.tokenUsage as Record<string, number> | undefined;
  if (direct !== undefined) return direct;
  const usage = values.usage as { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number } | undefined;
  if (usage === undefined) return undefined;
  return {
    uncachedInputTokens: Math.max(0, (usage.inputTokens ?? 0) - (usage.cacheReadTokens ?? 0) - (usage.cacheWriteTokens ?? 0)),
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
  };
}

function contextBreakdownFromValues(values: Record<string, unknown>): Record<string, number> | undefined {
  const direct = values.contextBreakdown as Record<string, number> | undefined;
  if (direct !== undefined) return direct;
  const usage = values.usage as { inputTokens?: number } | undefined;
  const pressure = usage?.inputTokens;
  if (pressure === undefined) return undefined;
  const systemTokens = Math.min(pressure, 1_500);
  const toolsTokens = Math.min(Math.max(0, pressure - systemTokens), 800);
  return { systemTokens, toolsTokens, messageTokens: Math.max(0, pressure - systemTokens - toolsTokens) };
}

function contextPressureFromValues(values: Record<string, unknown>): Record<string, number> | undefined {
  const usage = values.usage as { inputTokens?: number } | undefined;
  if (usage?.inputTokens === undefined) return undefined;
  return { pressureTokens: usage.inputTokens, contextWindow: 1_048_576 };
}

/**
 * Add the derived projection values the official chat UI reads from raw Host
 * usage counters. The shared normalization also preserves the official model
 * selection fold on legacy carriers and older Host deployments.
 */
// The Host computes values and revision at one SQLite boundary. A second
// browser-side state read would pair newer values with an older watermark.
async function projectionValuesFor(_sessionId: string, values: Record<string, unknown>): Promise<Record<string, unknown>> {
  return values;
}

function refreshOfficialSessions(): void {
  const sessions = clientContext?.get("sessions") as unknown as {
    refresh?: () => Promise<void>;
    refreshList?: () => Promise<void>;
  } | undefined;
  void (sessions?.refresh?.() ?? sessions?.refreshList?.())?.catch(() => {});
}

const USER_SOURCE = { kind: "user" } as const;
const REASONING = {
  efforts: [
    { id: "off", name: "Off", description: "Use for simple tasks that do not need reasoning." },
    { id: "low", name: "Low", description: "Prefer for routine or latency-sensitive tasks." },
    { id: "high", name: "High", description: "The default balance for most tasks." },
    { id: "max", name: "Max", description: "Reserve for the hardest quality-first tasks." },
  ],
  unavailable: true,
  unavailableReason: REASONING_UNAVAILABLE_REASON,
} as const;

function textOf(message: { parts?: readonly unknown[] }): string {
  if (!Array.isArray(message.parts)) return "";
  return message.parts
    .filter((part): part is { type: "text"; text: string } => (part as { type?: unknown }).type === "text")
    .map((part) => String(part.text ?? ""))
    .join("");
}

/** The page and both follow carriers share one causal journal projection. */
function officialHistory(
  messages: readonly SessionHistoryMessage[],
  rpcIdOf?: (message: { id: string }, text: string) => string | undefined,
  turns?: readonly SessionTurnState[],
  forkSeed?: SessionHistorySnapshot["forkSeed"],
): OfficialSessionPage["records"] {
  return buildSessionHistory(messages, rpcIdOf, turns, forkSeed);
}


/** Poll the custom Host transport; used until a Workspace stream delivers its baseline. */
async function* workspaceFollowLegacy(signal: AbortSignal): AsyncIterable<unknown> {
  let previous = "";
  let first = true;
  while (!signal.aborted) {
    let state: { items?: unknown[]; archivedSessionIds?: string[]; pinnedSessionIds?: string[] } | undefined;
    try { state = await hostTransport?.workspaceState() as typeof state; } catch {}
    if (state !== undefined) {
      const signature = JSON.stringify(state);
      if (signature !== previous) {
        previous = signature;
        const value = {
          items: state.items ?? [],
          archivedSessionIds: state.archivedSessionIds ?? [],
          pinnedSessionIds: state.pinnedSessionIds ?? [],
        };
        yield first ? { type: "baseline", value } : { type: "replace", value };
        first = false;
      }
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 1000);
      signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
    });
  }
}

/** Read the complete custom-transport archive/pin set after one flag write. */
async function workspaceFlagsFallback(
  sessionId: string,
  flags: { pinned?: boolean; archived?: boolean },
): Promise<{ archivedSessionIds: string[]; pinnedSessionIds: string[] }> {
  if (hostTransport === undefined) throw new Error("host transport missing");
  await hostTransport.workspaceSetFlags(sessionId, flags);
  const state = await hostTransport.workspaceState() as {
    archivedSessionIds?: string[];
    pinnedSessionIds?: string[];
  };
  return {
    archivedSessionIds: state.archivedSessionIds ?? [],
    pinnedSessionIds: state.pinnedSessionIds ?? [],
  };
}

/**
 * Consume the official `workspace/follow` mux stream and fall back to the
 * custom polling generator only when that stream fails before its baseline.
 */
async function* workspaceFollowWithFallback(signal: AbortSignal): AsyncIterable<unknown> {
  if (officialWorkspaceGateway === undefined
    || typeof location === "undefined"
    || typeof WebSocket === "undefined") {
    yield* workspaceFollowLegacy(signal);
    return;
  }
  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  if (signal.aborted) controller.abort();
  else signal.addEventListener("abort", onAbort, { once: true });
  let opened = false;
  try {
    for await (const frame of officialWorkspaceGateway.follow(controller.signal)) {
      if ((frame as { type?: string }).type === "baseline") opened = true;
      yield frame;
    }
  } catch (error) {
    if (!opened && !signal.aborted && isOfficialEndpointUnavailable(error)) {
      yield* workspaceFollowLegacy(signal);
      return;
    }
    throw error;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

const remoteWorkspace = {
  follow: workspaceFollowWithFallback,
  create: async (input: { path?: string; title?: string } = {}) => {
    const fallback = async (): Promise<OfficialGatewayResult<{ workspace: OfficialWorkspaceView; created?: boolean }>> => {
      if (hostTransport === undefined) return hostError(new Error("host transport missing"));
      try {
        const value = await hostTransport.workspaceCreate(input) as { workspace: OfficialWorkspaceView };
        return { ok: true, value };
      } catch (error) {
        return hostError(error);
      }
    };
    const path = input.path;
    if (path === undefined) return fallback();
    return withOfficialWorkspace<{ workspace: OfficialWorkspaceView; created?: boolean }>(
      () => officialWorkspaceGateway!.create({ path }),
      fallback,
    );
  },
  initializeDefault: async (signal?: AbortSignal) => {
    const fallback = async (): Promise<OfficialGatewayResult<{ workspace?: OfficialWorkspaceView }>> => {
      if (hostTransport === undefined) return hostError(new Error("host transport missing"));
      try {
        return { ok: true, value: await hostTransport.workspaceInitializeDefault() as { workspace: OfficialWorkspaceView } };
      } catch (error) {
        return hostError(error);
      }
    };
    const result = await withOfficialWorkspace<{ workspace?: OfficialWorkspaceView }>(
      () => officialWorkspaceGateway!.initializeDefault(signal),
      fallback,
    );
    if (!result.ok) return result;
    const workspace = result.value.workspace;
    return workspace === undefined ? { ok: true, value: undefined } : { ok: true, value: { workspace } };
  },
  rename: async ({ workspaceId, title }: { workspaceId: string; title: string }) => {
    const fallback = async (): Promise<OfficialGatewayResult<{ workspace: OfficialWorkspaceView }>> => {
      if (hostTransport === undefined) return hostError(new Error("host transport missing"));
      try {
        return { ok: true, value: await hostTransport.workspaceRename(workspaceId, title) as { workspace: OfficialWorkspaceView } };
      } catch (error) {
        return hostError(error);
      }
    };
    return withOfficialWorkspace<{ workspace: OfficialWorkspaceView }>(
      () => officialWorkspaceGateway!.rename({ workspaceId, title }),
      fallback,
    );
  },
  delete: async ({ workspaceId }: { workspaceId: string }) => {
    const fallback = async (): Promise<OfficialGatewayResult<{ deleted: true }>> => {
      if (hostTransport === undefined) return hostError(new Error("host transport missing"));
      try {
        await hostTransport.workspaceDelete(workspaceId);
        return { ok: true, value: { deleted: true } };
      } catch (error) {
        return hostError(error);
      }
    };
    return withOfficialWorkspace<{ deleted: true }>(
      () => officialWorkspaceGateway!.delete({ workspaceId }),
      fallback,
    );
  },
  insertBefore: async ({ workspaceId, beforeWorkspaceId }: { workspaceId: string; beforeWorkspaceId?: string }) => {
    const fallback = async (): Promise<OfficialGatewayResult<{ workspaceIds: readonly string[] }>> => {
      if (hostTransport === undefined) return hostError(new Error("host transport missing"));
      try {
        return {
          ok: true,
          value: await hostTransport.request<{ workspaceIds: string[] }>("workspaceInsertBefore", {
            workspaceId,
            ...(beforeWorkspaceId === undefined ? {} : { beforeWorkspaceId }),
          }),
        };
      } catch (error) {
        return hostError(error);
      }
    };
    return withOfficialWorkspace<{ workspaceIds: readonly string[] }>(
      () => officialWorkspaceGateway!.insertBefore({
        workspaceId,
        ...(beforeWorkspaceId === undefined ? {} : { beforeWorkspaceId }),
      }),
      fallback,
    );
  },
  archiveSession: async ({ sessionId, stopActivity }: { sessionId: string; stopActivity?: boolean }) => {
    const fallback = async (): Promise<OfficialGatewayResult<{ archivedSessionIds: readonly string[] }>> => {
      try {
        const state = await workspaceFlagsFallback(sessionId, { archived: true });
        return { ok: true, value: { archivedSessionIds: state.archivedSessionIds } };
      } catch (error) {
        return hostError(error);
      }
    };
    return withOfficialWorkspace<{ archivedSessionIds: readonly string[] }>(
      () => officialWorkspaceGateway!.archiveSession({
        sessionId,
        ...(stopActivity === true ? { stopActivity: true } : {}),
      }),
      fallback,
    );
  },
  unarchiveSession: async ({ sessionId }: { sessionId: string }) => {
    const fallback = async (): Promise<OfficialGatewayResult<{ archivedSessionIds: readonly string[] }>> => {
      try {
        const state = await workspaceFlagsFallback(sessionId, { archived: false });
        return { ok: true, value: { archivedSessionIds: state.archivedSessionIds } };
      } catch (error) {
        return hostError(error);
      }
    };
    return withOfficialWorkspace<{ archivedSessionIds: readonly string[] }>(
      () => officialWorkspaceGateway!.unarchiveSession({ sessionId }),
      fallback,
    );
  },
  pinSession: async ({ sessionId }: { sessionId: string }) => {
    const fallback = async (): Promise<OfficialGatewayResult<{ pinnedSessionIds: readonly string[] }>> => {
      try {
        const state = await workspaceFlagsFallback(sessionId, { pinned: true });
        return { ok: true, value: { pinnedSessionIds: state.pinnedSessionIds } };
      } catch (error) {
        return hostError(error);
      }
    };
    return withOfficialWorkspace<{ pinnedSessionIds: readonly string[] }>(
      () => officialWorkspaceGateway!.pinSession({ sessionId }),
      fallback,
    );
  },
  unpinSession: async ({ sessionId }: { sessionId: string }) => {
    const fallback = async (): Promise<OfficialGatewayResult<{ pinnedSessionIds: readonly string[] }>> => {
      try {
        const state = await workspaceFlagsFallback(sessionId, { pinned: false });
        return { ok: true, value: { pinnedSessionIds: state.pinnedSessionIds } };
      } catch (error) {
        return hostError(error);
      }
    };
    return withOfficialWorkspace<{ pinnedSessionIds: readonly string[] }>(
      () => officialWorkspaceGateway!.unpinSession({ sessionId }),
      fallback,
    );
  },
  insertSessionBefore: async (
    { workspaceId, sessionId, beforeSessionId }: { workspaceId: string; sessionId: string; beforeSessionId?: string },
  ) => {
    const fallback = async (): Promise<OfficialGatewayResult<{ workspace: OfficialWorkspaceView }>> => {
      if (hostTransport === undefined) return hostError(new Error("host transport missing"));
      try {
        return {
          ok: true,
          value: await hostTransport.request<{ workspace: OfficialWorkspaceView }>("workspaceInsertSessionBefore", {
            workspaceId,
            sessionId,
            ...(beforeSessionId === undefined ? {} : { beforeSessionId }),
          }),
        };
      } catch (error) {
        return hostError(error);
      }
    };
    return withOfficialWorkspace<{ workspace: OfficialWorkspaceView }>(
      () => officialWorkspaceGateway!.insertSessionBefore({
        workspaceId,
        sessionId,
        ...(beforeSessionId === undefined ? {} : { beforeSessionId }),
      }),
      fallback,
    );
  },
};

interface LocalAccountView {
  readonly status: "signed-out" | "credential-stored";
  readonly links: { readonly usageUrl: string; readonly topUpUrl: string };
  readonly attempt: null | {
    readonly id: string;
    readonly phase: string;
    readonly authorizeUrl?: string;
    readonly expiresAt?: number;
    readonly errorCode?: string;
  };
}

const localAccountUser = readLocalAccount;

function localAccountView(user: LocalAccountUser | null, attempt: LocalAccountView["attempt"] = null): LocalAccountView {
  return {
    status: user === null ? "signed-out" : "credential-stored",
    // Required URL fields have no unavailable variant. The account availability
    // seam disables these anchors; they must never masquerade as a billing route.
    links: { usageUrl: `${location.origin}/#account-unavailable`, topUpUrl: `${location.origin}/#account-unavailable` },
    attempt,
  };
}

const remoteAccount = {
  getState: async () => {
    try { return { ok: true as const, value: localAccountView(await localAccountUser()) }; }
    catch (error) { return hostError(error); }
  },
  watch: async function* (signal: AbortSignal): AsyncGenerator<LocalAccountView> {
    let previous = "";
    while (!signal.aborted) {
      const view = localAccountView(await localAccountUser());
      const signature = JSON.stringify(view);
      if (signature !== previous) {
        previous = signature;
        yield view;
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 2000);
        signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
      });
    }
  },
  getProfile: async () => {
    try {
      const user = await localAccountUser();
      return { ok: true as const, value: user === null ? null : {
        status: "ready" as const,
        value: { id: user.id, name: user.username, contact: user.email, avatarUrl: null },
      } };
    } catch (error) { return hostError(error); }
  },
  // The official nullable contract means no balance service. The availability
  // wrapper supplies the visible disabled state without inventing a balance.
  getBalance: async () => ({ ok: true as const, value: null }),
  getUnnotifiedBonuses: async () => ({ ok: true as const, value: null }),
  ackBonusNotified: async () => ({ ok: true as const, value: false }),
  hasRunningAccountTasks: () => ({ ok: true as const, value: false }),
  watchExpiry: async function* (signal: AbortSignal): AsyncGenerator<"session-expired"> {
    while (!signal.aborted) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 60_000);
        signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
      });
    }
  },
  startSignIn: async () => ({ ok: true as const, value: localAccountView(null, {
    id: `local-${Date.now()}`,
    phase: "waiting-browser",
    authorizeUrl: `${location.origin}/login?popup=1`,
    expiresAt: Date.now() + 10 * 60 * 1000,
  }) }),
  cancelSignIn: async () => {
    try { return { ok: true as const, value: localAccountView(await localAccountUser()) }; }
    catch (error) { return hostError(error); }
  },
  signOut: async () => {
    try {
      await signOutLocalAccount();
      return { ok: true as const, value: localAccountView(null) };
    } catch (error) { return hostError(error); }
  },
};

/** Workspace file reads are authoritative; a missing endpoint is never a transcript. */
const remoteWorkspaceFiles = createWorkspaceFilesRemote(() => officialWorkspaceFilesGateway);

const remoteDirectoryPicker = createDirectoryRemote(() => connectionRpc());
const remoteAgentPresets = createFixedAgentPresets(
  () => fixedAgentPresetCopy(clientContext?.get("locale")?.getSnapshot().active),
);

const remotePermissionPresets = {
  catalog: async () => withOfficialPermission(
    () => officialPermissionGateway!.catalog(),
    async () => {
      if (hostTransport === undefined) return hostError(new Error("Host permission catalog is unavailable"));
      try { return { ok: true as const, value: await hostTransport.request<import("@deepseek-ai/dsh-permission-presets/client").PermissionCatalog>("permissionCatalog") }; }
      catch (error) { return hostError(error); }
    },
  ),
};

/* ---------------------------------------------------------------------------
 * Approval presentation bridge.
 *
 * The Workers Host drives turns outside Think's chat protocol, so it cannot
 * stream approval/request through the official Remote Event carrier. The Host
 * exposes pending approvals and accepts a decision; this bridge presents them to
 * the official ui-approval listeners through the same `remote.$on` waterfall
 * contract, with an Agent-scoped Cordis context as the listener `this`.
 * ------------------------------------------------------------------------- */

/** The unchanged UI listener owns every explicit decision and presentation lifetime. */
type ApprovalRequest = ApprovalPresentation;
type ApprovalListener = (
  this: unknown, request: ApprovalRequest, next: () => Promise<"allowed-once" | "rejected">,
) => Promise<"allowed-once" | "rejected">;
const approvalListeners = new Set<ApprovalListener>();
const approvalScopes = new Map<string, ReturnType<typeof createScope>>();
let approvalBridge: ReturnType<typeof createApprovalBridge> | undefined;

function approvalScopeOf(sessionId: string): unknown {
  let handle = approvalScopes.get(sessionId);
  if (handle === undefined) {
    if (clientContext === undefined) throw new Error("Approval Session scope is unavailable");
    handle = createScope(clientContext, sessionId as SessionId);
    approvalScopes.set(sessionId, handle);
  }
  return handle.ctx;
}

async function presentApproval(sessionId: string, request: ApprovalRequest): Promise<"allowed-once" | "rejected"> {
  const scopeCtx = approvalScopeOf(sessionId), listeners = [...approvalListeners];
  let index = 0;
  const next = async (): Promise<"allowed-once" | "rejected"> => {
    request.signal.throwIfAborted();
    const listener = listeners[index++];
    if (listener === undefined) throw new Error("No official approval listener accepted this request");
    return listener.call(scopeCtx, request, next);
  };
  return next();
}

const fallbackRpc = createWebConnectionRpc();
const connectionRpc = () => clientContext?.get("connection")?.rpc ?? fallbackRpc;
const attachmentRemotes = createAttachmentRemotes(connectionRpc);
const invalidations = createRemoteInvalidations();

const remoteToolResults = {
  watch: async function* (input: { sessionId: string; seq: number }, signal: AbortSignal) {
    if (typeof location !== "undefined") {
      let delivered = false;
      try {
        const stream = openWireStream<Record<string, unknown>>({
          baseUrl: location.origin,
          endpoint: "toolResults/watch",
          payload: { args: { request: { sessionId: input.sessionId, seq: input.seq } } },
          signal,
        });
        for await (const value of stream) {
          delivered = true;
          yield value;
        }
        if (delivered) return;
      } catch (error) {
        // Fall back only when the carrier failed before its opening item; a
        // failure after an item must not silently replay the inspection.
        if (delivered || !(error instanceof WireStreamFailure)) throw error;
      }
    }
    yield { available: false };
    while (!signal.aborted) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 5_000);
        signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
      });
    }
  },
};

const remote = {
  $on: (event: string, listener: ApprovalListener) => {
    if (event !== "approval/request") return invalidations.on(event, listener as unknown as (...args: unknown[]) => void);
    approvalListeners.add(listener);
    approvalBridge?.invalidate();
    return () => { approvalListeners.delete(listener); approvalBridge?.invalidate(); };
  },
  $host: { home: "", isLoopback: false },
  $stream: <Item>(options: RemoteStreamOptions<Item>) => {
    const connection = clientContext?.get("connection");
    if (connection === undefined) throw new Error("Remote stream requires the official Connection service");
    return createHostRemoteStream(connection, options);
  },
  workspace: remoteWorkspace,
  workspaceFiles: remoteWorkspaceFiles,
  toolResults: remoteToolResults,
  permissionPresets: remotePermissionPresets,
  agentPresets: remoteAgentPresets,
  account: remoteAccount,
  directoryPicker: remoteDirectoryPicker,
  fileUploads: attachmentRemotes.fileUploads,
  settings: createSettingsRemote({
    rpc: connectionRpc,
    changed: (namespace) => invalidations.emit("settings/document-updated", namespace.ns, namespace.revision),
  }),
  session: {
    attachment: attachmentRemotes.attachment,
    list: async () => withOfficialSession<OfficialSessionList>(
      () => officialSessionGateway!.list({}),
      async () => {
        if (hostTransport === undefined) return hostError(new Error("host transport or session address missing"));
        try {
          const sessions = await listAllHostSessions();
          return {
            ok: true,
            value: {
              items: sessions.map((raw) => {
                const row = raw as {
                  sessionId: string;
                  title?: string;
                  running?: boolean;
                  blank?: boolean;
                  updatedAt?: number;
                  cwd?: string;
                  workspaceId?: string;
                };
                return {
                  agentAvailable: true,
                  sessionId: row.sessionId,
                  updatedAt: row.updatedAt ?? Date.now(),
                  running: row.running ?? false,
                  blank: row.blank ?? false,
                  ...(row.cwd === undefined ? {} : { cwd: row.cwd }),
                  ...(row.title === undefined ? {} : { displayTitle: row.title }),
                  projections: {
                    kind: "cached",
                    values: { title: row.title ?? "New Session", agentPreset: FIXED_AGENT_PRESET_ID },
                  },
                };
              }),
            },
          };
        } catch (error) {
          return hostError(error);
        }
      },
    ),
    state: async ({ sessionId }: { sessionId: string }) => withOfficialSession<Record<string, unknown>>(
      () => officialSessionGateway!.state(sessionId),
      async () => {
        if (hostTransport === undefined) return hostError(new Error("host transport or session address missing"));
        try {
          const state = await hostTransport.state(sessionId) as { running?: boolean };
          return { ok: true, value: { cursor: 0, active: true, running: state.running ?? false, queue: null, pendingInput: [] } };
        } catch (error) {
          return hostError(error);
        }
      },
    ),
    projections: async ({ sessionId }: { sessionId: string }) => {
      const result = await withOfficialSession<OfficialSessionProjections | null>(
        () => officialSessionGateway!.projections(sessionId),
        async () => {
          if (hostTransport === undefined) return hostError(new Error("host transport or session address missing"));
          try {
            const values = await hostTransport.projections(sessionId);
            return { ok: true, value: hostProjectionBlock(values) };
          } catch (error) {
            return hostError(error);
          }
        },
      );
      if (!result.ok || result.value === null) return result;
      try {
        return {
          ok: true,
          value: { ...result.value, values: await projectionValuesFor(sessionId, result.value.values) },
        };
      } catch (error) {
        return hostError(error);
      }
    },
    create: async (input: { workspaceId?: string; cwd?: string; sessionId?: string; agentPreset?: string } = {}) => {
      // The fixed runtime can only create its canonical Think composition. An
      // explicit official mode must be refused here, never silently aliased.
      if (input.agentPreset !== undefined && input.agentPreset !== FIXED_AGENT_PRESET_ID) {
        return { ok: false as const, error: {
          code: "agent-preset/unavailable",
          message: agentPresetUnavailableReason(clientContext?.get("locale")?.getSnapshot().active),
          details: { endpoint: "session/create", agentPreset: input.agentPreset },
        } };
      }
      const result = await withOfficialSession<{ sessionId: string; agentPreset?: string }>(
        () => officialSessionGateway!.create(input),
        async () => {
          if (hostTransport === undefined) return hostError(new Error("host transport missing"));
          try {
            const created = await hostTransport.create({
              ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
              ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
              ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
              ...(input.agentPreset === undefined ? {} : { agentPreset: input.agentPreset }),
            });
            return { ok: true, value: created };
          } catch (error) {
            return hostError(error);
          }
        },
      );
      if (result.ok) refreshOfficialSessions();
      return result;
    },
    fork: async (input: { sessionId: string; messageId?: string; atSeq?: number; allowMigration?: boolean }) => withOfficialSession<{ sessionId: string }>(
      () => officialSessionGateway!.fork(input),
      async () => {
        if (hostTransport === undefined) return hostError(new Error("host transport missing"));
        try {
          return { ok: true, value: await hostTransport.fork(input.sessionId, input.messageId) };
        } catch (error) {
          return hostError(error);
        }
      },
    ),
    rename: async ({ sessionId, title }: { sessionId: string; title: string }) => withOfficialSession<{ title: string; seq: number }>(
      () => officialSessionGateway!.rename(sessionId, title),
      async () => {
        if (hostTransport === undefined) return hostError(new Error("host transport missing"));
        try {
          const result = await hostTransport.rename(sessionId, title);
          if (typeof result.projectionRevision !== "number" || !Number.isSafeInteger(result.projectionRevision) || result.projectionRevision < 0) throw new Error("Host rename revision is unavailable");
          return { ok: true, value: { title: result.title, seq: result.projectionRevision } };
        } catch (error) {
          return hostError(error);
        }
      },
    ),
    prompt: async (input: {
      sessionId: string;
      requestId: string;
      mode?: "queue" | "steer";
      content?: readonly { type?: string; text?: string; mediaType?: string; data?: string; name?: string; receiptId?: string }[];
      clientTimeZone?: string;
    }) => {
      if (hostTransport === undefined) return hostError(new Error("host transport missing"));
      // Official steer semantics: interrupt the running turn before admitting
      // the new input. The Host cancels queued/running submissions; the new
      // prompt then becomes the next turn instead of silently queueing.
      if (input.mode === "steer") {
        try { await hostTransport.cancel(input.sessionId); }
        catch (error) { return hostError(error); }
      }
      // Persist the browser IANA zone once per zone through the existing durable
      // settings document; the Agent reads it for its time-context snapshots.
      if (typeof input.clientTimeZone === "string" && input.clientTimeZone !== "" && input.clientTimeZone !== lastReportedClientTimeZone) {
        await hostTransport.request("settingsMutate", {
          ns: "dsh-base:client",
          ops: [{ op: "set", path: ["timeZone"], value: input.clientTimeZone }],
        }).then(() => { lastReportedClientTimeZone = input.clientTimeZone; }).catch(() => undefined);
      }
      const content = Array.isArray(input.content) ? input.content : [];
      const text = content.filter((part) => part.type === "text").map((part) => String(part.text ?? "")).join("\n");
      // Claim owns execution; the Host control stream owns every projection.
      const observeClaim = async (submissionId: string): Promise<void> => {
        try { await hostTransport.claim(input.sessionId, submissionId); } catch { /* authoritative failure is retained by the Host */ }
      };
      const fallback = async (): Promise<{ ok: true; value: { accepted: true } } | { ok: false; error: { code: string; message: string } }> => {
        try {
          const submission = await hostTransport.prompt(input.sessionId, text, input.requestId);
          pendingPromptRequests.push({ requestId: input.requestId, text });
          pendingPromptSignals.push(input.sessionId);
          // The official SessionHost returns the durable admission receipt here;
          // the Turn runs on the Host and streams through `follow`.
          void observeClaim(submission.submissionId);
          refreshOfficialSessions();
          return { ok: true, value: { accepted: true as const } };
        } catch (error) {
          return hostError(error);
        }
      };
      if (officialSessionGateway === undefined) return fallback();
      const official = await withOfficialSession<{ accepted: true; submissionId?: string }>(
        () => officialSessionGateway!.prompt({
          sessionId: input.sessionId,
          requestId: input.requestId,
          mode: input.mode ?? "queue",
          content: content.map((part) => {
            if (part.type === "text") return { type: "text" as const, text: String(part.text ?? "") };
            if (part.type === "image") return {
              type: "image" as const,
              mediaType: String(part.mediaType ?? "image/png"),
              data: String(part.data ?? ""),
              ...(typeof part.name === "string" ? { name: part.name } : {}),
            };
            if (part.type === "file") return { type: "file" as const, receiptId: String(part.receiptId ?? "") };
            return { type: "text" as const, text: "" };
          }),
          ...(typeof input.clientTimeZone === "string" ? { clientTimeZone: input.clientTimeZone } : {}),
        }),
        fallback,
      );
      if (!official.ok) return official;
      pendingPromptRequests.push({ requestId: input.requestId, text });
      pendingPromptSignals.push(input.sessionId);
      // The Worker bridge returns the durable submission as a compatible
      // extension so the browser can keep observing projections; the alarm
      // owns the turn even if this observation never settles.
      if (official.value.submissionId !== undefined) void observeClaim(official.value.submissionId);
      refreshOfficialSessions();
      return { ok: true, value: { accepted: true } };
    },
    cancel: async ({ sessionId }: { sessionId: string }) => withOfficialSession<{ accepted: true }>(
      () => officialSessionGateway!.cancel(sessionId),
      async () => {
        if (hostTransport === undefined) return hostError(new Error("host transport missing"));
        try {
          await hostTransport.cancel(sessionId);
          return { ok: true, value: { accepted: true as const } };
        } catch (error) {
          return hostError(error);
        }
      },
    ),
    updateQueue: async (input: {
      sessionId: string;
      itemId: string;
      action:
        | { kind: "edit"; content: readonly { type: "text"; text: string }[] }
        | { kind: "remove" }
        | { kind: "steer" };
    }) => withOfficialSession<{ accepted: true }>(
      () => officialSessionGateway!.updateQueue(input),
      async () => {
        if (hostTransport === undefined) return hostError(new Error("host transport missing"));
        if (input.action.kind === "remove") {
          try {
            await hostTransport.updateQueue(input.sessionId, input.itemId, "remove");
            return { ok: true, value: { accepted: true as const } };
          } catch (error) {
            return hostError(error);
          }
        }
        return hostError(new Error("queue edit/steer is not available on the legacy transport"));
      },
    ),
    models: async () => {
      if (hostTransport === undefined) return hostError(new Error("host transport or session address missing"));
      try { return { ok: true, value: await hostTransport.models() }; } catch (error) { return hostError(error); }
    },
    selectModel: createModelSelectionRemote(
      (input) => withOfficialSession<{ selected: { provider: string; model: string; reasoningEffort?: string } }>(
        () => officialSessionGateway!.selectModel(input),
        async () => {
          if (hostTransport === undefined) return hostError(new Error("host transport missing"));
          try {
            const selected = await hostTransport.selectModel(input.sessionId, input.model, input.reasoningEffort);
            if (typeof selected?.model !== "string" || selected.model.length === 0) {
              return hostError(new Error("Host model selection acknowledgement is missing"));
            }
            return { ok: true, value: { selected: {
              provider: input.provider ?? (input.model.startsWith("cloudflare-ai-gateway/") ? "cloudflare-ai-gateway" : "deepseek-official"),
              model: selected.model,
              ...(selected.reasoningEffort === undefined ? {} : { reasoningEffort: selected.reasoningEffort }),
            } } };
          } catch (error) { return hostError(error); }
        },
      ),
      () => refreshOfficialSessions(),
    ),
    modelCatalog: async () => withOfficialSession<OfficialModelCatalog>(
      () => officialSessionGateway!.modelCatalog(),
      async () => {
        if (hostTransport === undefined) return hostError(new Error("host transport missing"));
        try {
          const access = await hostTransport.request<{ providers?: Record<string, { available: boolean; catalog: Array<{ id: string; label: string }> }> }>("modelAccess");
          const catalogValue = buildFallbackModelCatalog(access);
          return { ok: true, value: catalogValue };
        } catch (error) {
          return hostError(error);
        }
      },
    ),
    followLegacy: async function* (input: { address?: { sessionId?: string; childSessionId?: string } }, signal: AbortSignal) {
      const sessionId = input.address?.sessionId ?? input.address?.childSessionId;
      if (sessionId === undefined || hostTransport === undefined) return;
      let latestLive: SessionLiveAttempt | null | undefined;
      let liveSocket: WebSocket | undefined;
      const connectLiveSocket = (): void => {
        if (typeof WebSocket === "undefined") return;
        const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/agent-live?sessionId=${encodeURIComponent(sessionId)}`);
        liveSocket = socket;
        socket.addEventListener("message", event => {
          try { latestLive = (JSON.parse(String(event.data)) as { live?: SessionLiveAttempt | null }).live ?? null; } catch {}
        });
        socket.addEventListener("error", () => socket.close());
        socket.addEventListener("close", () => {
          if (signal.aborted || liveSocket !== socket) return;
          setTimeout(() => { if (!signal.aborted && liveSocket === socket) connectLiveSocket(); }, 750);
        });
      };
      connectLiveSocket();
      const close = () => liveSocket?.close();
      signal.addEventListener("abort", close, { once: true });
      try {
        const initial = await hostTransport.request<SessionHistorySnapshot>("history", { sessionId });
        const journal = new SessionWireSequencer(initial.records ?? [], { rpcIdOf: rpcIdForUser, turns: initial.turns, forkSeed: initial.forkSeed });
        const liveFrames = new SessionLiveFrameSequencer();
        for (const record of journal.records) liveFrames.accept(record);
        const initialProjections = await hostTransport.projections(sessionId) as Record<string, unknown>;
        yield { type: "snapshot", header: { version: 1, id: sessionId, createdAt: Date.now(), isSeeded: false },
          cursor: journal.cursor, records: [...journal.records], hasMore: false,
          projections: hostProjectionBlock(initialProjections), assistantStream: { revision: 0 } };
        let lastPageAt = 0;
        while (!signal.aborted) {
          await wireSleep(50, signal);
          if (signal.aborted) return;
          const records: SessionWireRecord[] = [];
          if (Date.now() - lastPageAt >= 250) {
            lastPageAt = Date.now();
            const page = await hostTransport.request<SessionHistorySnapshot>("history", { sessionId });
            records.push(...journal.pushMessages(page.records ?? [], page.turns));
          }
          const live = latestLive === undefined ? (await hostTransport.live(sessionId)).live : latestLive;
          records.push(...journal.observeLive(live));
          for (const record of records) {
            const settlements = liveFrames.accept(record);
            yield record;
            for (const settlement of settlements) yield settlement;
            if (record.event.type === "assistant/message") refreshOfficialSessions();
          }
          for (const frame of liveFrames.observe(live)) yield frame;
        }
      } finally {
        signal.removeEventListener("abort", close);
        liveSocket?.close();
      }
    },
    page: async (input: {
      address?: { kind?: string; sessionId?: string; childSessionId?: string };
      throughSeq?: number;
      beforeSeq?: number;
      maxMessages?: number;
      turnWindow?: { minMessages: number; minTurns: number };
    }) => {
      const sessionId = input.address?.sessionId ?? input.address?.childSessionId;
      if (sessionId === undefined || hostTransport === undefined) return hostError(new Error("host transport or session address missing"));
      const customPage = async (): Promise<OfficialGatewayResult<OfficialSessionPage>> => {
        try {
          const page = await hostTransport.request<SessionHistorySnapshot>("history", { sessionId });
          const all = officialHistory(page.records ?? [], rpcIdForUser, page.turns, page.forkSeed);
          const through = input.throughSeq;
          if (through === -1) return hostError(Object.assign(new Error("History cursor is not present in this session."), { code: "session/invalid-cursor" }));
          const records = through === undefined
            ? all
            : all.filter((record) => record.event.seq <= through);
          return { ok: true, value: { records, hasMore: records.length < all.length } };
        } catch (error) {
          return hostError(error);
        }
      };
      // The bridge serves ordinary Session addresses only; direct subagents keep
      // the custom read instead of surfacing its coded refusal.
      if (input.address?.childSessionId !== undefined) return customPage();
      return withOfficialSession<OfficialSessionPage>(
        () => officialSessionGateway!.page({
          sessionId,
          ...(input.throughSeq === undefined ? {} : { throughSeq: input.throughSeq }),
          ...(input.beforeSeq === undefined ? {} : { beforeSeq: input.beforeSeq }),
          ...(input.maxMessages === undefined ? {} : { maxMessages: input.maxMessages }),
          ...(input.turnWindow === undefined ? {} : { turnWindow: input.turnWindow }),
        }),
        customPage,
      );
    },
    controlLegacy: async function* (signal: AbortSignal) {
      if (hostTransport === undefined) throw new WireStreamFailure("gateway/carrier-failed", "Host control transport is unavailable");
      yield* hostProjectionControl(hostTransport, signal);
    },
  },
  commands: createPermissionCommands(connectionRpc, () => feedbackUnavailableReason(clientContext?.get("locale")?.getSnapshot().active)),
  subagents: {
    prompt: async () => hostError(Object.assign(new Error("Interactive subagent control is unavailable."), { code: "subagent/unavailable" })),
    interruptByParent: async () => hostError(Object.assign(new Error("Interactive subagent control is unavailable."), { code: "subagent/unavailable" })),
  },
};




/* ---------------------------------------------------------------------------
 * Phase C: Session follow/control on the Gateway stream mux.
 *
 * The official `api-session-controller` client consumes `remote.session.follow`
 * and `remote.session.control`. Both are served here from `/api/remote.mux`
 * logical streams, while token deltas stay on the Agent-bound
 * `/api/agent-live` WebSocket. A failure before the opening frame falls back to
 * the original custom transport; a failure after it surfaces so a stream is
 * never replayed twice.
 * ------------------------------------------------------------------------- */

type WireFollowInput = { address?: { sessionId?: string; childSessionId?: string } };
type LegacyFollow = (input: WireFollowInput, signal: AbortSignal) => AsyncIterable<unknown>;
type LegacyControl = (signal: AbortSignal) => AsyncIterable<unknown>;

const followLegacy = (remote.session as unknown as Record<string, unknown>).followLegacy as LegacyFollow;
const controlLegacy = (remote.session as unknown as Record<string, unknown>).controlLegacy as LegacyControl;

function wireSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(); return; }
    const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = (): void => { clearTimeout(timer); resolve(); };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function wireMuxAvailable(): boolean {
  return typeof location !== "undefined" && typeof WebSocket !== "undefined" && hostTransport !== undefined;
}

/** Build the official follow args for the current Session address. */
function wireFollowPayload(input: WireFollowInput): unknown {
  return { args: { request: { address: input.address, activate: true, assistantStream: true } } };
}

/** Enrich one user/message event with the prompt receipt correlation id. */
function wireEnrichUserEvent(event: { type?: string; data?: { id?: string; content?: unknown; source?: Record<string, unknown> } } | undefined): void {
  if (event?.type !== "user/message" || event.data === undefined || typeof event.data.id !== "string") return;
  const content = Array.isArray(event.data.content) ? event.data.content as Array<{ type?: string; text?: string }> : [];
  const text = content.filter((part) => part.type === "text" && typeof part.text === "string").map((part) => String(part.text)).join("");
  const rpcId = rpcIdForUser({ id: event.data.id }, text);
  if (rpcId !== undefined && typeof event.data.source?.rpcId !== "string") event.data.source = { ...USER_SOURCE, rpcId };
}

/** Add the client-local projection values the official snapshot baseline expects. */
function wireDecorateSnapshot(frame: Record<string, unknown>, sessionId: string): Record<string, unknown> {
  const projections = frame.projections as { asOfSeq?: number; values?: Record<string, unknown> } | undefined;
  const values: Record<string, unknown> = { ...(projections?.values ?? {}) };
  const records = Array.isArray(frame.records) ? frame.records : [];
  for (const record of records) {
    wireEnrichUserEvent((record as { event?: { type?: string; data?: { id?: string; content?: unknown; source?: Record<string, unknown> } } }).event);
  }
  return { ...frame, projections: { ...(projections ?? {}), values } };
}

/** Stream official follow frames from the Worker mux and interleave live token frames. */
async function* wireFollow(input: WireFollowInput, signal: AbortSignal): AsyncIterable<unknown> {
  const sessionId = input.address?.sessionId ?? input.address?.childSessionId;
  if (sessionId === undefined || hostTransport === undefined || typeof location === "undefined") {
    throw new WireStreamFailure("gateway/carrier-failed", "session follow has no address");
  }
  let latestLive: unknown;
  let liveSocket: WebSocket | undefined;
  const connectLiveSocket = (): void => {
    if (typeof WebSocket === "undefined") return;
    const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/agent-live?sessionId=${encodeURIComponent(sessionId)}`);
    liveSocket = socket;
    socket.addEventListener("message", (event) => {
      try { latestLive = (JSON.parse(String(event.data)) as { live?: unknown }).live; } catch {}
    });
    socket.addEventListener("error", () => socket.close());
    socket.addEventListener("close", () => {
      if (signal.aborted || liveSocket !== socket) return;
      setTimeout(() => { if (!signal.aborted && liveSocket === socket) connectLiveSocket(); }, 750);
    });
  };
  connectLiveSocket();

  const liveFrames = new SessionLiveFrameSequencer();
  const liveAttempt = async (): Promise<unknown[]> => {
    let live = latestLive as SessionLiveAttempt | null | undefined;
    if (live === undefined) live = (await hostTransport!.live(sessionId)).live;
    return liveFrames.observe(live);
  };

  const iterator = openWireStream<Record<string, unknown>>({
    baseUrl: location.origin,
    endpoint: "session/follow",
    payload: wireFollowPayload(input),
    signal,
  })[Symbol.asyncIterator]();
  let pending = iterator.next();
  let snapshotSeen = false;
  try {
    while (!signal.aborted) {
      // The prompt receipt queue is owned by the mux journal now; drain it so a
      // later fallback does not replay a stale turn signal.
      while (pendingPromptSignals.length > 0) {
        const pendingSession = pendingPromptSignals.shift();
        if (pendingSession === sessionId) break;
      }
      const result = await Promise.race([
        pending.then((entry) => ({ kind: "frame" as const, entry })),
        wireSleep(50, signal).then(() => ({ kind: "timeout" as const })),
      ]);
      if (signal.aborted) return;
      if (result.kind === "timeout") {
        for (const frame of await liveAttempt()) yield frame;
        continue;
      }
      const { value, done } = result.entry;
      if (done) {
        if (!snapshotSeen) throw new WireStreamFailure("gateway/carrier-closed", "session follow ended before its snapshot");
        return;
      }
      pending = iterator.next();
      const frame = value as Record<string, unknown>;
      if (frame.type === "snapshot") {
        snapshotSeen = true;
        for (const record of (frame.records ?? []) as SessionWireRecord[]) liveFrames.accept(record);
        yield wireDecorateSnapshot(frame, sessionId);
        continue;
      }
      if (frame.type === "event") {
        const event = frame.event as { type?: string; seq?: number; data?: { id?: string; content?: unknown; source?: Record<string, unknown> } } | undefined;
        wireEnrichUserEvent(event);
        const settlements = liveFrames.accept(frame as unknown as SessionWireRecord);
        yield frame;
        for (const settlement of settlements) yield settlement;
        if (event?.type === "assistant/message") refreshOfficialSessions();
        continue;
      }
      yield frame;
    }
  } finally {
    try { liveSocket?.close(); } catch {}
    await iterator.return?.(undefined);
  }
}

/** Stream the official control baseline over the mux while keeping client-local projections. */
async function* wireControl(signal: AbortSignal): AsyncIterable<unknown> {
  if (typeof location === "undefined") throw new WireStreamFailure("gateway/carrier-failed", "control stream has no origin");
  const iterator = openWireStream<Record<string, unknown>>({
    baseUrl: location.origin,
    endpoint: "session/control",
    payload: { args: {} },
    signal,
  })[Symbol.asyncIterator]();
  let pending = iterator.next();
  let baselineSeen = false;
  try {
    while (!signal.aborted) {
      const result = await Promise.race([
        pending.then((entry) => ({ kind: "frame" as const, entry })),
        wireSleep(200, signal).then(() => ({ kind: "timeout" as const })),
      ]);
      if (signal.aborted) return;
      if (result.kind === "timeout") continue;
      const { value, done } = result.entry;
      if (done) {
        if (!baselineSeen) throw new WireStreamFailure("gateway/carrier-closed", "control stream ended before its baseline");
        return;
      }
      pending = iterator.next();
      const frame = value as { type?: string };
      if (frame.type === "baseline") baselineSeen = true;
      yield frame;
    }
  } finally {
    await iterator.return?.(undefined);
  }
}

/** Wrap one wire stream with a fallback that only runs before its opening frame. */
async function* followWithFallback(input: WireFollowInput, signal: AbortSignal): AsyncIterable<unknown> {
  const approvalSession = input.address?.sessionId;
  const release = approvalSession === undefined ? undefined : approvalBridge?.retain(approvalSession);
  try { yield* followWithFallbackInner(input, signal); }
  finally { release?.(); }
}

/** Follow body after the approval-session bookkeeping. */
async function* followWithFallbackInner(input: WireFollowInput, signal: AbortSignal): AsyncIterable<unknown> {
  // Diagnostic/escape hatch: `?dsh-legacy-follow=1` keeps the pre-mux path.
  if (!wireMuxAvailable() || location.search.includes("dsh-legacy-follow")) { yield* followLegacy(input, signal); return; }
  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  if (signal.aborted) controller.abort();
  else signal.addEventListener("abort", onAbort, { once: true });
  let opened = false;
  try {
    for await (const frame of wireFollow(input, controller.signal)) {
      if ((frame as { type?: string }).type === "snapshot") opened = true;
      yield frame;
    }
  } catch (error) {
    if (!opened && !signal.aborted && isOfficialEndpointUnavailable(error)) { yield* followLegacy(input, signal); return; }
    throw error;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

/** Wrap the control stream with the same pre-baseline fallback rule. */
async function* controlWithFallback(signal: AbortSignal): AsyncIterable<unknown> {
  // Diagnostic/escape hatch: `?dsh-legacy-control=1` keeps the pre-mux path.
  if (!wireMuxAvailable() || location.search.includes("dsh-legacy-control")) { yield* controlLegacy(signal); return; }
  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  if (signal.aborted) controller.abort();
  else signal.addEventListener("abort", onAbort, { once: true });
  let opened = false;
  try {
    for await (const frame of wireControl(controller.signal)) {
      if ((frame as { type?: string }).type === "baseline") opened = true;
      yield frame;
    }
  } catch (error) {
    if (!opened && !signal.aborted && isOfficialEndpointUnavailable(error)) { yield* controlLegacy(signal); return; }
    throw error;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

// The official client sees the migrated implementations on the same service.
(remote.session as unknown as Record<string, unknown>).follow = followWithFallback;
(remote.session as unknown as Record<string, unknown>).control = controlWithFallback;


const modules = {
  entries: {
    state: emptyObservable({ entries: [] }),
    retry: async () => {},
    dismissRelease: () => {},
    releaseChange: emptyObservable(undefined),
  },
};

export async function apply(ctx: Context): Promise<void> {
  clientContext = ctx;
  const approvals = createApprovalBridge({
    call: createApprovalHostCall(location.origin), ready: () => approvalListeners.size > 0,
    present: presentApproval,
    releaseSession: async (sessionId) => { const scope = approvalScopes.get(sessionId); approvalScopes.delete(sessionId); await scope?.fiber.dispose(); },
    error: error => ctx.logger.error(`Approval bridge: ${error instanceof Error ? error.message : String(error)}`),
  });
  approvalBridge = approvals;
  const closeApprovals = () => { void approvals.dispose(); };
  window.addEventListener("pagehide", closeApprovals, { once: true });
  ctx.effect(() => async () => {
    window.removeEventListener("pagehide", closeApprovals);
    if (approvalBridge === approvals) approvalBridge = undefined;
    await approvals.dispose();
  }, "dsh-base: approval lifetime");
  ctx.inject(["connection"], scope => {
    const connection = scope.get("connection") as ConnectionHandle;
    scope.effect(() => connection.generation.subscribe(() => {
      if (connection.generation.getSnapshot() !== undefined) approvals.invalidate();
    }), "dsh-base: approval reconnect");
  });
  ctx.effect(() => () => { invalidations.clear(); }, "dsh-base: remote invalidations");
  ctx.effect(() => subscribeOwnerInvalidations({
    url: "/api/session-host/changes",
    emit: invalidations.emit,
    changed: (topics, baseline) => { if (baseline || topics === undefined || topics.includes("sessions")) approvals.invalidate(); },
    error: error => ctx.logger.warn(`Owner change stream: ${error.message}`),
  }), "dsh-base: owner change stream");
  // The unchanged official api-session-controller owns the sessions service.
  await installRemoteMount(ctx, remote);
  ctx.provide("remote.commands", remote.commands);
  ctx.provide("remote.subagents", remote.subagents);
  ctx.provide("remote.settings", remote.settings);
  ctx.provide("remote.session", remote.session);
  ctx.provide("remote.workspace", remoteWorkspace);
  ctx.provide("remote.account", remoteAccount);
  ctx.provide("remote.workspaceFiles", remoteWorkspaceFiles);
  ctx.provide("remote.fileUploads", attachmentRemotes.fileUploads);
  ctx.provide("remote.toolResults", remoteToolResults);
  ctx.provide("remote.permissionPresets", remotePermissionPresets);
  ctx.provide("remote.agentPresets", remoteAgentPresets);
  const jobsSubscribers = new Set<() => void>();
  const jobsSnapshot = { rows: {}, observed: {} } as const;
  const unavailable = (code: string) => ({ ok: false as const, error: { code, message: "not available in this Workers deployment" } });
  const remoteGoals = {
    get: async () => unavailable("unavailable"),
    edit: async () => unavailable("unavailable"),
    pause: async () => unavailable("unavailable"),
    resume: async () => unavailable("unavailable"),
    clear: async () => unavailable("unavailable"),
  };
  const remoteCredentials = createCredentialsRemote(hostTransport);
  const remoteUserQuestions = {
    attachWait: () => undefined,
    answer: async () => unavailable("unavailable"),
  };
  const remoteSkills = {
    list: async () => ({
      ok: true as const,
      value: {
        skills: CHAT_SKILLS.map((skill) => ({
          name: skill.name,
          description: skill.description,
          ...(skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse }),
          modelInvocable: skill.modelInvocable,
        })),
      },
    }),
  };
  const remoteFileReferences = {
    list: async (sessionId: string, query: string, signal: AbortSignal) => {
      if (hostTransport === undefined) return hostError(new Error("host transport missing"));
      try {
        return { ok: true as const, value: await fileReferenceCandidates(hostTransport, sessionId, query, signal) };
      } catch (error) {
        return { ok: false as const, error: { code: "file-reference/unavailable", message: error instanceof Error ? error.message : "file references unavailable" } };
      }
    },
    search: async (sessionId: string, query: string, signal: AbortSignal) => {
      if (hostTransport === undefined) return hostError(new Error("host transport missing"));
      try {
        return { ok: true as const, value: { items: await fileReferenceCandidates(hostTransport, sessionId, query, signal) } };
      } catch (error) {
        return hostError(error);
      }
    },
    resolve: async () => unavailable("file-reference/unavailable"),
  };
  const remoteSessionReferenceResolver = {
    candidates: async (sessionId: string, query: string) => {
      if (hostTransport === undefined) return hostError(new Error("host transport missing"));
      try {
        return { ok: true as const, value: await sessionReferenceCandidates(hostTransport, sessionId, query) };
      } catch (error) {
        return hostError(error);
      }
    },
    search: async () => unavailable("session-reference/unavailable"),
  };
  const remoteSchedule = createScheduleRemote({
    rpc: connectionRpc,
    changed: () => invalidations.emit("schedule/changed"),
  });
  const remoteDynamicCordisRunner = {
    inventory: async () => ({ ok: true as const, value: [] }),
    stopFromPanel: async () => unavailable("unavailable"),
    undefineFromPanel: async () => unavailable("unavailable"),
  };
  const emptyCordisRows: readonly never[] = Object.freeze([] as never[]);
  const dynamicCordisRunner = {
    getSnapshot: () => emptyCordisRows,
    subscribe: () => () => {},
    isLoaded: () => false,
    reconcileApprovals: () => {},
    activeRuns: emptyObservable(new Map()),
    lastRunError: emptyObservable(new Map()),
    renderFailures: emptyObservable(new Map()),
    approve: async () => unavailable("unavailable"),
    decline: async () => unavailable("unavailable"),
    startUserRun: async () => unavailable("unavailable"),
  };
  const remoteProductAnalytics = {
    report: async () => ({ ok: true as const, value: undefined }),
    watchPolicy: async function* () { return; },
  };
  interface DeploymentModelAccess {
    readonly platformEnabled: boolean;
    readonly ownerKeyConfigured: boolean;
    readonly effective: "owner-byok" | "platform-gateway" | "unavailable";
    readonly protocol: "openai-chat-completions";
    readonly catalog: ReadonlyArray<{ readonly id: string; readonly label: string; readonly contextWindow: number }>;
    readonly providers?: Readonly<Record<string, { readonly available: boolean; readonly catalog: DeploymentModelAccess["catalog"] }>>;
  }
  const readModelAccess = async (): Promise<DeploymentModelAccess> => {
    if (hostTransport === undefined) throw new Error("The Host transport is unavailable.");
    return await hostTransport.request<DeploymentModelAccess>("modelAccess");
  };
  const remoteLlm = {
    // The adapter registry is what the Host can actually route. Its presence is
    // derived from the Host's modelAccess, never from optimistic client state.
    listProviders: async () => {
      try {
        const access = await readModelAccess();
        const providers = access.providers;
        return { ok: true as const, value: [
          ...providers?.["deepseek-official"]?.available === true ? [{ id: "deepseek-official", name: "DeepSeek" }] : [],
          ...providers?.["cloudflare-ai-gateway"]?.available === true ? [{ id: "cloudflare-ai-gateway", name: "Cloudflare AI Gateway" }] : [],
        ] };
      } catch (error) {
        return { ok: false as const, error: { code: "llm/provider-unavailable", message: error instanceof Error ? error.message : "The Host model route is unavailable." } };
      }
    },
    listConfigurableProviders: async () => ({ ok: true as const, value: [
      {
        provider: "deepseek-official",
        displayName: "DeepSeek",
        settingsNs: "llm-deepseek",
        settingsPath: [],
        defaultBaseURL: "https://api.deepseek.com/v1",
      },
      {
        provider: "cloudflare-ai-gateway",
        displayName: "Cloudflare AI Gateway",
        settingsNs: "llm-cloudflare-gateway",
        settingsPath: [],
      },
    ] }),
    modelAccess: async () => {
      try { return { ok: true as const, value: await readModelAccess() }; }
      catch (error) { return { ok: false as const, error: { code: "llm/model-access-unavailable", message: error instanceof Error ? error.message : "The Host model route is unavailable." } }; }
    },
    discoverModels: async (settingsNs: string, request: { provider?: string; baseURL?: string; api?: string; apiKey?: string } = {}) => {
      if (hostTransport === undefined) return unavailable("unavailable");
      try {
        const result = await hostTransport.request("llmDiscoverModels", {
          settingsNs,
          ...(request.apiKey === undefined ? {} : { apiKey: request.apiKey }),
          ...(request.baseURL === undefined ? {} : { baseURL: request.baseURL }),
        }) as { readonly models?: ReadonlyArray<{ id: string; name?: string }> };
        return { ok: true as const, value: result.models ?? [] };
      } catch (error) {
        return { ok: false as const, error: { code: "llm/model-discovery-rejected", message: error instanceof Error ? error.message : "model discovery failed" } };
      }
    },
  };
  ctx.provide("modelAccess", { load: async () => await readModelAccess() });
  const readOnlyPluginRemotes = createReadOnlyPluginRemotes({
    entries: () => typeof window === "undefined" ? undefined : (window as unknown as { __DSH_BASE_PLUGINS__?: import("@dsh-base/plugin-loader-static").StaticPluginInspection[] }).__DSH_BASE_PLUGINS__,
    locale: () => clientContext?.get("locale")?.getSnapshot().active ?? "en",
  });
  const feedbackUnavailable = async () => ({ ok: false as const, error: {
    code: "feedback/unavailable",
    message: feedbackUnavailableReason(clientContext?.get("locale")?.getSnapshot().active), details: {},
  } });
  const remoteMessageFeedback = { list: feedbackUnavailable, put: feedbackUnavailable, delete: feedbackUnavailable };
  const remoteSessionFeedback = { record: feedbackUnavailable };
  Object.assign(remote as unknown as Record<string, unknown>, {
    goals: remoteGoals,
    credentials: remoteCredentials,
    userQuestions: remoteUserQuestions,
    skills: remoteSkills,
    fileReferences: remoteFileReferences,
    sessionReferenceResolver: remoteSessionReferenceResolver,
    pluginInventory: readOnlyPluginRemotes.inventory,
    pluginManager: readOnlyPluginRemotes.manager,
    pluginRegistryProbe: readOnlyPluginRemotes.registryProbe,
    llm: remoteLlm,
    schedule: remoteSchedule,
    productAnalytics: remoteProductAnalytics,
    dynamicCordisRunner: remoteDynamicCordisRunner,
    messageFeedback: remoteMessageFeedback,
    sessionFeedback: remoteSessionFeedback,
  });
  ctx.provide("remote.goals", remoteGoals);
  ctx.provide("remote.credentials", remoteCredentials);
  ctx.provide("remote.userQuestions", remoteUserQuestions);
  ctx.provide("remote.skills", remoteSkills);
  ctx.provide("remote.fileReferences", remoteFileReferences);
  ctx.provide("remote.sessionReferenceResolver", remoteSessionReferenceResolver);
  ctx.provide("remote.pluginInventory", readOnlyPluginRemotes.inventory);
  ctx.provide("remote.pluginManager", readOnlyPluginRemotes.manager);
  ctx.provide("remote.pluginRegistryProbe", readOnlyPluginRemotes.registryProbe);
  ctx.provide("remote.llm", remoteLlm);
  ctx.provide("remote.schedule", remoteSchedule);
  ctx.provide("remote.productAnalytics", remoteProductAnalytics);
  ctx.provide("remote.dynamicCordisRunner", remoteDynamicCordisRunner);
  ctx.provide("dynamicCordisRunner", dynamicCordisRunner);
  ctx.provide("remote.messageFeedback", remoteMessageFeedback);
  ctx.provide("remote.sessionFeedback", remoteSessionFeedback);
  const officialBoot = typeof import.meta === "undefined"
    || (import.meta as { env?: Record<string, string> }).env?.VITE_DSH_STATIC_BOOT !== "1";
  if (!officialBoot) ctx.provide("modules", modules);
  ctx.provide("jobs", {
    state: {
      getSnapshot: () => jobsSnapshot,
      subscribe: (listener: () => void) => { jobsSubscribers.add(listener); return () => { jobsSubscribers.delete(listener); }; },
    },
    watchRows: () => () => {},
    observe: () => () => {},
    kill: async () => false,
  });
  ctx.provide("remote.directoryPicker", remoteDirectoryPicker);
  ctx.inject(["modelDirectories", "uiSession"], (scope) => {
    const modelDirectories = scope.modelDirectories as unknown as {
      directoryFor: (sessionId: string) => { load: () => Promise<unknown> };
    };
    const uiSession = scope.uiSession as unknown as {
      adapter: { current: { getSnapshot: () => { key?: string } } };
    };
    const timer = setInterval(() => {
      const sessionId = uiSession.adapter.current.getSnapshot().key;
      if (sessionId === undefined) return;
      try {
        void modelDirectories.directoryFor(sessionId).load().then(() => clearInterval(timer)).catch(() => {});
      } catch {
        // the session scope is not ready yet
      }
    }, 1000);
    return () => clearInterval(timer);
  });
}
