import { firstCronOccurrence, officialCron } from './schedule-cron.ts';
import { FIXED_AGENT_PRESET_ID } from "../../../boot/dsh-base-agent-presets/src/index.ts";
import { prepareFork } from './fork-seed.ts';
import type { SessionForkSeed } from '@dsh-base/session-wire';
import { deriveSessionProjections } from "@dsh-base/session-wire";
import { HostChangeFeed } from './change-feed.ts';
import type { PermissionStore } from './permissions-store.ts';
import { assertFilePermission } from '@dsh-base/cloudflare-worker-permissions/executor';
import { UploadStore, uploadBytes, base64Bytes, uploadError, DISABLED_IMAGE_LIMITS, type FileRef } from "./uploads.ts";
/** Workers-native implementation of the official Session read contract. */
import { canonicalDirectoryPath } from "./logical-directories.ts";
import { SessionRpcFault } from "./remote-contract.ts";
import { activeSubmission, pendingToolApproval, turnStates } from "./turn-lifecycle.ts";
import { countExecutionSteps, withExecutionStatistics, type ExecutionStatistics } from "./execution-stats.ts";
import type { SessionListRow, SessionModelOption } from "./contract.ts";
import { SettingsStore, type SettingsOperation } from "./settings-store.ts";
import { DEPLOYMENT_MODELS } from "./model-catalog.ts";
import { bareModelId, deepseekModelId, isDeepSeekModelId, isExplicitModelId, providerForModelId } from "../../../boot/dsh-base-session-wire/src/model-routes.ts";
import { assertSettingsPatchSupported, assertSettingsWriteSupported } from "./settings-write-policy.ts";
import { CredentialStore, type CredentialInfo } from "./credential-store.ts";
import { ScheduleInputError, ScheduleStore, type ScheduleEntry, type ScheduleRecordLike, type ScheduleTargetLike } from "./schedule-store.ts";
import { nextDailyOccurrence, nextWeeklyOccurrence, parseLocalTime, requireTimeZone } from "./schedule-recurrence.ts";
import { firstRRuleOccurrence, officialRRule } from "./schedule-rrule.ts";
import { MaintenanceJobStore, type MaintenanceJobRun, type MaintenanceJobSchedule } from "./maintenance-jobs.ts";
import type { SessionQueueRow } from "./remote-mapping.ts";
import type {
  SessionInputExecutionConfig,
  SessionModelRequest,
  SessionStepStart,
  SessionReasoningEffort,
  SessionHostAttachment,
  SessionHostAttachmentRef,
  SessionHostEvent,
  SessionHostReadContract,
  SessionHostStorage,
  SessionHostSubmission,
  SessionMessageRecord,
  SessionRecord,
  SessionWorkspaceFlags,
  SessionWorkspaceRecord,
  SessionTranscriptSnapshot,
  SessionTurnState,
  SessionHostSubmissionStatus,
} from "./storage.ts";
import {
  decodeBase64,
  encodeBase64,
  WorkspaceFileError,
  type WorkspaceFileListing,
  type WorkspaceFileScope,
  type WorkspaceFileStat,
  type WorkspaceFileStore,
  type WorkspaceFileTextPage,
  type WorkspaceFileWriteResult,
} from "./workspace-files.ts";

/** Page size used when the caller omits one. */
const DEFAULT_PAGE_SIZE = 50;

/** One durable Workspace projected in the official `WorkspaceView` wire shape. */
export interface WorkspaceView {
  readonly workspaceId: string;
  readonly path: string;
  readonly title: string;
  readonly sessionIds: readonly string[];
  /** ISO-8601 creation instant. */
  readonly createdAt: string;
  /** ISO-8601 last-mutation instant. */
  readonly updatedAt: string;
}

/** Durable approval decision retained until its original input reaches a final state. */
export interface ApprovalContinuation {
  readonly sessionId: string;
  readonly submissionId: string;
  readonly requestId: string;
  readonly userMessageId: string;
  readonly toolCallId?: string;
  readonly executionId?: string;
  readonly decision: "approved" | "rejected";
  readonly settled?: boolean;
}

function toRow(record: SessionRecord, extra: {
  cwd?: string;
  workspaceId?: string;
  pinned?: boolean;
  archived?: boolean;
} = {}): SessionListRow {
  return {
    sessionId: record.sessionId,
    title: record.title,
    displayTitle: record.title,
    running: record.running,
    blank: record.blank,
    updatedAt: record.updatedAt,
    ...extra,
  };
}

const DEFAULT_WORKSPACE_ID = "default";
const DEFAULT_WORKSPACE_PATH = "/";

function decodeCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const offset = Number.parseInt(cursor, 10);
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("invalid session cursor");
  return offset;
}

function workspaceViewLike(
  workspace: SessionWorkspaceRecord,
  data: { bySession: Map<string, { workspaceId: string; position: number }> },
): WorkspaceView {
  return {
    workspaceId: workspace.workspaceId,
    path: workspace.path,
    title: workspace.title,
    sessionIds: membershipsOf(workspace.workspaceId, data.bySession),
    createdAt: new Date(workspace.createdAt).toISOString(),
    updatedAt: new Date(workspace.updatedAt).toISOString(),
  };
}

/** Session ids accounted to one Workspace in manual position order. */
function membershipsOf(
  workspaceId: string,
  bySession: Map<string, { workspaceId: string; position: number }>,
): string[] {
  return [...bySession.entries()]
    .filter(([, value]) => value.workspaceId === workspaceId)
    .sort((left, right) => left[1].position - right[1].position)
    .map(([sessionId]) => sessionId);
}

/**
 * Filter the persisted per-Session flags into the official registry sets.
 *
 * `listSessionFlags` enumerates flag rows oldest first, so reversing the pinned
 * entries yields the official most-recently-pinned-first order. A no-op flag
 * write is skipped by the Host, and `INSERT OR REPLACE` moves a changed row to
 * the end, so re-pinning after unpinning fronts the Session again.
 */
function workspaceFlagSets(flags: Readonly<Record<string, SessionWorkspaceFlags>>): {
  archivedSessionIds: string[];
  pinnedSessionIds: string[];
} {
  const entries = Object.entries(flags);
  return {
    archivedSessionIds: entries.filter(([, value]) => value.archived).map(([sessionId]) => sessionId),
    pinnedSessionIds: entries.filter(([, value]) => value.pinned).map(([sessionId]) => sessionId).reverse(),
  };
}

/** Move one id before another, DOM-insertBefore-like; an invalid pair is unchanged. */
function insertIdBefore(ids: readonly string[], id: string, beforeId?: string): string[] {
  if (!ids.includes(id) || (beforeId !== undefined && !ids.includes(beforeId)) || beforeId === id) return [...ids];
  const without = ids.filter((candidate) => candidate !== id);
  const at = beforeId === undefined ? without.length : without.indexOf(beforeId);
  return [...without.slice(0, at), id, ...without.slice(at)];
}

/** Concatenate the text parts of one durable transcript record. */
function transcriptText(parts: readonly unknown[]): string {
  let text = "";
  for (const part of parts) {
    if (typeof part !== "object" || part === null) continue;
    const candidate = part as { type?: unknown; text?: unknown };
    if (candidate.type !== "text" || typeof candidate.text !== "string") continue;
    text += candidate.text;
  }
  return text;
}

/** Render the durable transcript as the seeded workspace markdown document. */
function transcriptMarkdown(records: readonly SessionMessageRecord[]): string {
  const lines = ["# Conversation transcript", ""];
  for (const record of records) {
    if (record.role !== "user" && record.role !== "assistant") continue;
    const text = transcriptText(record.parts);
    if (text === "") continue;
    lines.push(`## ${record.role === "assistant" ? "Assistant" : "User"}`, "", text, "");
  }
  return lines.join("\n");
}

/** Structural object check shared by schedule validation. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Next interval occurrence strictly after `now`. */
function nextEvery(scheduledAt: string, everySeconds: number, now: Date): string {
  let next = new Date(scheduledAt).getTime();
  const step = everySeconds * 1000;
  while (next <= now.getTime()) next += step;
  return new Date(next).toISOString();
}

/** Read-only Host backed by a Durable Object storage port. */
export class SessionHost implements SessionHostReadContract {
  private readonly storage: SessionHostStorage;
  private readonly catalog: readonly SessionModelOption[];
  private readonly files: WorkspaceFileStore | undefined;
  private readonly settings: SettingsStore | undefined;
  private readonly credentials: CredentialStore | undefined;
  private readonly schedules: ScheduleStore | undefined;
  private readonly jobs: MaintenanceJobStore | undefined;
  private readonly uploads: UploadStore | undefined;
  private readonly wakeClaim: (() => void | Promise<void>) | undefined;
  private readonly changes: HostChangeFeed;
  private readonly permissionStore: (() => Promise<PermissionStore>) | undefined;

  /**
   * @param storage - durable Session storage port.
   * @param catalog - model options this Host offers.
   * @param files - R2-backed workspace file store; omitted in a deployment
   * without the `FILES` binding, where every file method reports
   * `workspace-file/unavailable`.
   * @param settings - durable per-owner settings store; omitted only by tests.
   */
  constructor(
    storage: SessionHostStorage,
    catalog: readonly SessionModelOption[],
    files?: WorkspaceFileStore,
    settings?: SettingsStore,
    credentials?: CredentialStore,
    schedules?: ScheduleStore,
    jobs?: MaintenanceJobStore,
    wakeClaim?: () => void | Promise<void>,
    uploads?: UploadStore,
    changes = new HostChangeFeed(),
    permissionStore?: () => Promise<PermissionStore>,
  ) {
    this.storage = storage;
    this.catalog = catalog;
    this.files = files;
    this.settings = settings;
    this.credentials = credentials;
    this.schedules = schedules;
    this.jobs = jobs;
    this.wakeClaim = wakeClaim;
    this.uploads = uploads;
    this.changes = changes;
    this.permissionStore = permissionStore;
  }

  private async workspaceData(): Promise<{
    workspaces: readonly SessionWorkspaceRecord[];
    bySession: Map<string, { workspaceId: string; position: number }>;
    flags: Readonly<Record<string, SessionWorkspaceFlags>>;
  }> {
    let workspaces = await this.storage.listWorkspaces();
    if (workspaces.length === 0) {
      const now = Date.now();
      await this.storage.putWorkspace({
        workspaceId: DEFAULT_WORKSPACE_ID,
        title: "Workspace",
        path: DEFAULT_WORKSPACE_PATH,
        position: 0,
        createdAt: now,
        updatedAt: now,
      });
      workspaces = await this.storage.listWorkspaces();
    }
    const sessions = await this.storage.listSessions();
    let memberships = await this.storage.listMemberships();
    const known = new Set(memberships.map((membership) => membership.sessionId));
    const missing = sessions.filter((session) => !known.has(session.sessionId));
    if (missing.length > 0) {
      let position = memberships.length;
      for (const session of missing) {
        await this.storage.putMembership(DEFAULT_WORKSPACE_ID, session.sessionId, position++);
      }
      memberships = await this.storage.listMemberships();
    }
    const bySession = new Map<string, { workspaceId: string; position: number }>();
    for (const membership of memberships) {
      bySession.set(membership.sessionId, { workspaceId: membership.workspaceId, position: membership.position });
    }
    return { workspaces, bySession, flags: await this.storage.listSessionFlags() };
  }

  /** Official Workspace baseline consumed by ui-workspace. */
  async workspaceState(): Promise<{
    items: WorkspaceView[];
    archivedSessionIds: string[];
    pinnedSessionIds: string[];
  }> {
    const data = await this.workspaceData();
    return {
      items: data.workspaces.map((workspace) => workspaceViewLike(workspace, data)),
      ...workspaceFlagSets(data.flags),
    };
  }

  private async workspaceForSession(sessionId: string): Promise<{ workspaceId: string; position: number }> {
    const data = await this.workspaceData();
    return data.bySession.get(sessionId) ?? { workspaceId: DEFAULT_WORKSPACE_ID, position: 0 };
  }

  /** Reads project the durable queue; elapsed time cannot prove execution failed. */
  private async reconcileRunning(record: SessionRecord): Promise<SessionRecord> {
    const submissions = await this.lifecycleSubmissions(record.sessionId);
    const running = submissions.some((submission) => activeSubmission(submission.status));
    return running === record.running ? record : { ...record, running };
  }

  async list(input: { cursor?: string }): Promise<{ sessions: readonly SessionListRow[]; cursor?: string }> {
    const offset = decodeCursor(input.cursor);
    const data = await this.workspaceData();
    const all = [...await this.storage.listSessions()].sort(
      (left, right) => right.updatedAt - left.updatedAt || left.sessionId.localeCompare(right.sessionId),
    );
    const workspaceById = new Map(data.workspaces.map((workspace) => [workspace.workspaceId, workspace]));
    const sessions = (await Promise.all(all.slice(offset, offset + DEFAULT_PAGE_SIZE).map(async (record) => {
      const repaired = await this.reconcileRunning(record);
      const membership = data.bySession.get(repaired.sessionId);
      const workspace = membership === undefined ? undefined : workspaceById.get(membership.workspaceId);
      const flags = data.flags[repaired.sessionId];
      return toRow(repaired, {
        ...(workspace === undefined ? {} : {
          cwd: workspace.path,
          workspaceId: workspace.workspaceId,
        }),
        ...(flags === undefined ? {} : { pinned: flags.pinned, archived: flags.archived }),
      });
    })));
    const next = offset + sessions.length;
    return { sessions, ...(next < all.length ? { cursor: String(next) } : {}) };
  }

  async state(input: { sessionId: string }): Promise<{
    sessionId: string;
    title: string;
    running: boolean;
    archived: boolean;
    model?: string;
  }> {
    const current = await this.requireSession(input.sessionId);
    const record = await this.reconcileRunning(current);
    return {
      sessionId: record.sessionId,
      title: record.title,
      running: record.running,
      archived: record.archived,
      ...(record.model === undefined ? {} : { model: record.model }),
      ...(record.reasoningEffort === undefined ? {} : { reasoningEffort: record.reasoningEffort }),
    };
  }

  async page(input: {
    address: { kind: "session"; sessionId: string } | { kind: "subagent"; childSessionId: string };
    before?: number;
    limit?: number;
  }): Promise<{ records: readonly SessionMessageRecord[]; turns: readonly SessionTurnState[]; hasMore: boolean; before?: number }> {
    const sessionId = input.address.kind === "session" ? input.address.sessionId : input.address.childSessionId;
    const snapshot = await this.transcriptSnapshot(sessionId);
    const limit = Math.max(1, Math.min(100, Math.floor(input.limit ?? DEFAULT_PAGE_SIZE)));
    const available = snapshot.records.filter(record => input.before === undefined || record.seq < input.before);
    const page = { records: available.slice(-limit), hasMore: available.length > limit };
    const before = page.hasMore && page.records.length > 0 ? page.records[0]?.seq : undefined;
    return { ...page, turns: turnStates(snapshot), ...(snapshot.forkSeed === undefined ? {} : { forkSeed: snapshot.forkSeed }), ...(before === undefined ? {} : { before }) };
  }

  async projections(input: { sessionId: string }): Promise<Record<string, unknown>> {
    await this.requireSession(input.sessionId);
    if (this.permissionStore !== undefined) (await this.permissionStore()).initialize(input.sessionId);
    const snapshot = await this.storage.projectionSnapshot?.(input.sessionId);
    const state = snapshot?.session ?? await this.requireSession(input.sessionId);
    const raw: Record<string,unknown> = { ...(snapshot?.values ?? await this.storage.getProjections(input.sessionId)), imageLimits: DISABLED_IMAGE_LIMITS };
    if(snapshot !== undefined) raw.sessionStats = { ...(raw.sessionStats as Record<string,unknown> | undefined), turns:snapshot.turns, steps:countExecutionSteps(raw,snapshot.stepCounts) };
    return { ...raw, ...deriveSessionProjections(raw, state), ...(snapshot === undefined ? {} : { _dshBaseProjectionRevision: snapshot.revision }) };
  }

  private async permissions(): Promise<PermissionStore> {
    if (this.permissionStore === undefined) throw new SessionRpcFault('gateway/endpoint-unavailable', 'Session permission runtime unavailable');
    return this.permissionStore();
  }
  async permissionCatalog() { return (await this.permissions()).catalog(); }
  async permissionCommands(input: {sessionId: string}) { return (await this.permissions()).commands(input.sessionId); }
  async executePermissionCommand(input: {sessionId: string; line: string; attachments: readonly unknown[]; rpcId: string}) {
    const result = await (await this.permissions()).executeCommand(input.sessionId, input.line, input.attachments, input.rpcId);
    await this.wakeClaim?.();
    return result;
  }
  async permissionSnapshot(input: {sessionId: string}) { return (await this.permissions()).snapshot(input.sessionId); }
  async approvalModelContext(input: {sessionId: string}) { return (await this.permissions()).modelContext(input.sessionId); }
  async selectPermission(input: {sessionId: string; preset: string}) {
    const snapshot = (await this.permissions()).select(input.sessionId, input.preset);
    // The durable policy is authoritative immediately. Alarm recovery applies
    // never-policy denials to pending calls even if this response is lost.
    await this.wakeClaim?.();
    return { currentValue: snapshot.currentValue };
  }

  async policyDeniedApprovals(): Promise<readonly {sessionId:string;toolCallId?:string;executionId?:string}[]> {
    if (this.permissionStore === undefined) return [];
    const store = await this.permissionStore();
    const denied: {sessionId:string;toolCallId?:string;executionId?:string}[] = [];
    for (const session of await this.storage.listSessions()) {
      const targets = await this.approvalTargets(session.sessionId);
      if (targets.length === 0 || store.snapshot(session.sessionId).approval !== 'never') continue;
      const blocked = new Set((await this.storage.listEvents(session.sessionId,0,100_000)).filter(event=>event.type === 'submission.approval-unavailable').map(event=>(event.payload as {requestId?:unknown}).requestId));
      for (const target of targets.filter(target=>!blocked.has(target.requestId))) denied.push({sessionId:session.sessionId,
        ...(target.toolCallId === undefined ? {executionId:target.executionId} : {toolCallId:target.toolCallId})});
    }
    return denied;
  }

  async blockApprovalRecovery(intent: ApprovalContinuation, message: string): Promise<void> {
    const submission = await this.storage.getSubmission(intent.submissionId);
    if (submission === undefined || !activeSubmission(submission.status)) return;
    await this.transitionSubmission(submission,'awaiting-approval','submission.approval-unavailable',{submissionId:intent.submissionId,requestId:intent.requestId,message});
  }

  /**
   * Read the complete durable transcript in append order for journal projection.
   * @param input - Session whose transcript is read.
   * @returns every durable message in append order.
   */
  async history(input: { sessionId: string }): Promise<{ records: readonly SessionMessageRecord[]; turns: readonly SessionTurnState[]; forkSeed?: import('@dsh-base/session-wire').SessionForkSeed }> {
    const snapshot = await this.transcriptSnapshot(input.sessionId);
    return { records: snapshot.records, turns: turnStates(snapshot), ...(snapshot.forkSeed === undefined ? {} : { forkSeed: snapshot.forkSeed }) };
  }

  /** Detect the prior duplicate-Step projection fault without calling the model. */
  async needsToolResultReconciliation(sessionId: string, known?: {records:readonly SessionMessageRecord[];turns:readonly SessionTurnState[]}): Promise<boolean> {
    const snapshot=known??await this.history({sessionId});
    const completed=new Set(snapshot.turns.filter(turn=>turn.status==='completed').map(turn=>turn.userMessageId));
    let eligible=false;
    return snapshot.records.some(message=>{
      if(message.role==='user'){eligible=completed.has(message.id);return false;}
      return eligible && message.role==='assistant' && message.parts.some(part=>typeof part==='object' && part!==null && (part as {type?:unknown}).type==='data-dsh-step')
        && message.parts.some(part=>typeof part==='object' && part!==null && typeof (part as {toolCallId?:unknown}).toolCallId==='string' && ['input-available','approval-requested','approval-responded'].includes(String((part as {state?:unknown}).state)));
    });
  }

  async repairCompletedToolResults(sessionId:string,messages:readonly {id:string;role:string;parts:readonly unknown[]}[]):Promise<number> {
    await this.requireSession(sessionId);
    if(this.storage.repairCompletedToolResults===undefined)throw new Error('Atomic tool result repair unavailable');
    return this.storage.repairCompletedToolResults(sessionId,messages);
  }

  private async transcriptSnapshot(sessionId: string): Promise<SessionTranscriptSnapshot> {
    if (this.storage.transcriptSnapshot) return this.storage.transcriptSnapshot(sessionId);
    const inheritedTurns = (await this.storage.getProjections(sessionId))._dshBaseInheritedTurns;
    return { session: await this.requireSession(sessionId), records: await this.storage.readAllMessages(sessionId),
      submissions: await this.storage.listSubmissions(sessionId), events: await this.storage.listEvents(sessionId, 0, 100_000),
      ...(Array.isArray(inheritedTurns) ? { inheritedTurns: inheritedTurns as SessionTurnState[] } : {}) };
  }

  private async transitionSubmission(submission: SessionHostSubmission, status: SessionHostSubmissionStatus, type: string, payload: unknown): Promise<SessionHostSubmission> {
    if (this.storage.transitionSubmission) return this.storage.transitionSubmission(submission.submissionId, status, type, payload);
    const latest = await this.storage.getSubmission(submission.submissionId);
    if (latest?.status === "cancelled") return latest;
    const next = { ...submission, status, updatedAt: Date.now() };
    await this.storage.putSubmission(next);
    await this.storage.appendEvent(submission.sessionId, type, payload);
    const record = await this.requireSession(submission.sessionId);
    const running = (await this.storage.listSubmissions(submission.sessionId)).some(row => activeSubmission(row.status));
    await this.storage.putSession({ ...record, running, updatedAt: Date.now() });
    return next;
  }

  /** Repair the old completed-at-tool-pause row before queue/stop admission. */
  private async lifecycleSubmissions(sessionId: string): Promise<readonly SessionHostSubmission[]> {
    const snapshot = await this.transcriptSnapshot(sessionId);
    const waiting = new Set(turnStates(snapshot).filter(turn => turn.status === "awaiting-approval").map(turn => turn.requestId));
    return Promise.all(snapshot.submissions.map(row => row.status === "completed" && waiting.has(row.requestId)
      ? this.transitionSubmission(row, "awaiting-approval", "submission.awaiting-approval", { submissionId: row.submissionId, recoveredLegacy: true }) : row));
  }

  async rename(input: { sessionId: string; title: string }): Promise<{ title: string; projectionRevision?: number }> {
    const record = await this.requireSession(input.sessionId);
    const title = input.title.trim();
    if (title === "") throw new Error("session title must not be empty");
    if (this.storage.renameSession) return this.storage.renameSession(input.sessionId, title);
    await this.storage.putSession({ ...record, title, updatedAt: Date.now() });
    return { title };
  }

  async selectModel(input: { sessionId: string; model: string; reasoningEffort?: string }): Promise<SessionInputExecutionConfig> {
    const record = await this.requireSession(input.sessionId);
    if (!isExplicitModelId(input.model)) throw new SessionRpcFault("gateway/bad-request", "Legacy bare model ids are read-only compatibility; select an explicit DeepSeek or Cloudflare AI Gateway model", { model: input.model });
    const settingsModels = this.settings?.read().values["llm-deepseek"]?.models;
    const explicitDirectory = Array.isArray(settingsModels);
    const configuredDeepSeek = isDeepSeekModelId(input.model)
      ? explicitDirectory
        ? settingsModels.some(model => typeof model === "object" && model !== null && deepseekModelId(String((model as { id?: unknown }).id)) === input.model)
        : DEPLOYMENT_MODELS.some(model => deepseekModelId(model.id) === input.model)
      : false;
    const known = isDeepSeekModelId(input.model)
      ? explicitDirectory ? configuredDeepSeek : this.catalog.some(option => option.id === input.model) || configuredDeepSeek
      : this.catalog.some(option => option.id === input.model);
    if (!known) throw new SessionRpcFault("gateway/bad-request", `unknown model: ${input.model}`, { model: input.model });
    const selection = this.executionConfig(input.model, input.reasoningEffort);
    if (this.storage.selectModel) return this.storage.selectModel(input.sessionId, selection);
    await this.storage.putSession({ ...record, ...selection, updatedAt: Date.now() });
    return selection;
  }

  /** Select the real default from the active provider catalogs, never a static Flash fallback. */
  private currentDefaultModel(): string | undefined {
    const gateway = this.catalog.find(option => option.id.startsWith("cloudflare-ai-gateway/"));
    if (gateway !== undefined) return gateway.id;
    const models = this.settings?.read().values["llm-deepseek"]?.models;
    if (Array.isArray(models)) {
      const first = models.find(model => typeof model === "object" && model !== null && typeof (model as { id?: unknown }).id === "string" && (model as { id: string }).id !== "");
      return first === undefined ? undefined : deepseekModelId((first as { id: string }).id);
    }
    return this.catalog.find(option => option.id.startsWith("deepseek-official/"))?.id;
  }

  private executionConfig(model: string, effort?: string): SessionInputExecutionConfig {
    const configurable = bareModelId(model) === "deepseek-flash" || bareModelId(model) === "deepseek-v4-pro";
    if (effort !== undefined && (!configurable || !["off", "low", "high", "max"].includes(effort))) {
      throw new SessionRpcFault("gateway/bad-request", "Unsupported reasoning effort for this model", { model, reasoningEffort: effort });
    }
    return { model, ...(configurable ? { reasoningEffort: (effort ?? "high") as SessionReasoningEffort } : {}) };
  }

  /** Persist the resolved legacy route for this frozen input only. */
  async freezeInputModel(sessionId: string, requestId: string, model: string): Promise<void> {
    await this.requireSession(sessionId);
    if (this.storage.freezeInputModel !== undefined) { this.storage.freezeInputModel(sessionId, requestId, model); return; }
    const saved = (await this.storage.getProjections(sessionId))._dshBaseInputConfigs as Record<string, SessionInputExecutionConfig> | undefined;
    const existing = saved?.[requestId];
    if (existing === undefined) throw new SessionRpcFault("gateway/bad-request", "No frozen input configuration exists", { requestId });
    if (existing.model === model) return;
    if (isExplicitModelId(existing.model)) throw new SessionRpcFault("session/conflict", "An explicit provider route is already frozen for this input", { requestId, current: existing.model, model });
    await this.storage.putProjections(sessionId, { ...(await this.storage.getProjections(sessionId)), _dshBaseInputConfigs: { ...saved, [requestId]: { ...existing, model } } });
  }

  /** Read only the configuration admitted for this input, never today's picker. */
  async inputExecutionConfig(sessionId: string, requestId: string): Promise<SessionInputExecutionConfig | undefined> {
    await this.requireSession(sessionId);
    if (this.storage.getInputExecutionConfig) return this.storage.getInputExecutionConfig(sessionId, requestId);
    const saved = (await this.storage.getProjections(sessionId))._dshBaseInputConfigs as Record<string, SessionInputExecutionConfig> | undefined;
    return saved?.[requestId];
  }

  /** Internal execution evidence, recorded before the actual model pipeline. */
  async recordModelRequest(request: SessionModelRequest): Promise<void> {
    await this.requireSession(request.sessionId);
    if (!request.requestId || !request.sdkRequestId || !request.model) throw new SessionRpcFault("gateway/bad-request", "Model request identity is required", {});
    if (!this.storage.recordModelRequest) throw new SessionRpcFault("gateway/endpoint-unavailable", "Atomic model request recording is unavailable", {});
    await this.storage.recordModelRequest(request);
  }

  /** Persist before-token step evidence; only the authenticated Think path calls this. */
  async recordStepStart(step: SessionStepStart): Promise<void> {
    await this.requireSession(step.sessionId);
    if (!step.requestId || !step.sdkRequestId || !step.stepId || !Number.isSafeInteger(step.startedAt) || step.startedAt < 0) throw new SessionRpcFault("gateway/bad-request", "Step identity and start time are required", {});
    if (!this.storage.recordStepStart) throw new SessionRpcFault("gateway/endpoint-unavailable", "Atomic step start recording is unavailable", {});
    await this.storage.recordStepStart(step);
  }

  async models(): Promise<readonly SessionModelOption[]> {
    return this.catalog;
  }

  /** Create without resetting named Sessions; the official face reuses only blank Sessions. */
  async create(input: { title?: string; sessionId?: string; workspaceId?: string; cwd?: string; reuseBlankOnly?: boolean; agentPreset?: string } = {}): Promise<{ sessionId: string }> {
    // The fixed runtime composes only Think; official preset ids are real
    // identities, never aliases for this composition.
    if (input.agentPreset !== undefined && input.agentPreset !== FIXED_AGENT_PRESET_ID) {
      throw new SessionRpcFault("gateway/endpoint-unavailable", "Only the fixed Think composition is available in this Workers-native deployment", { agentPreset: input.agentPreset });
    }
    if (input.workspaceId !== undefined && input.cwd !== undefined) throw new SessionRpcFault("gateway/bad-request", "session.create accepts workspaceId or cwd, not both", {});
    if (input.sessionId === "" || input.workspaceId === "" || input.cwd === "") throw new SessionRpcFault("gateway/bad-request", "Session identity and location must not be empty", {});
    const data = await this.workspaceData();
    let workspace = input.workspaceId === undefined ? undefined : data.workspaces.find(item => item.workspaceId === input.workspaceId);
    if (input.workspaceId !== undefined && workspace === undefined) throw new SessionRpcFault("workspace/not-found", "Workspace not found", { workspaceId: input.workspaceId });
    if (input.cwd !== undefined) {
      const cwd = canonicalDirectoryPath(input.cwd);
      workspace = data.workspaces.find(item => item.path === cwd);
      if (workspace === undefined) {
        if (input.sessionId !== undefined && await this.storage.getSession(input.sessionId) !== undefined) {
          const placement = data.bySession.get(input.sessionId);
          const existingCwd = data.workspaces.find(item => item.workspaceId === placement?.workspaceId)?.path ?? "/";
          throw new SessionRpcFault("session/conflict", "Session belongs to another working directory", { sessionId: input.sessionId, requestedCwd: cwd, existingCwd });
        }
        throw new SessionRpcFault("gateway/endpoint-unavailable", "Creating an ungrouped Session at an unregistered directory is unavailable; select a registered logical Workspace", { cwd });
      }
    }
    workspace ??= data.workspaces.find(item => item.workspaceId === DEFAULT_WORKSPACE_ID) ?? data.workspaces[0];
    if (workspace === undefined) throw new SessionRpcFault("workspace/not-found", "No default Workspace exists", {});
    const sessionId = input.sessionId ?? crypto.randomUUID();
    const now = Date.now();
    const title = input.title?.trim() || "New Session";
    const wasPresent = await this.storage.getSession(sessionId);
    const permissionStore = this.permissionStore === undefined ? undefined : await this.permissionStore();
    const created = await this.storage.createSession({
      sessionId,
      title,
      running: false,
      blank: true,
      archived: false,
      createdAt: now,
      updatedAt: now,
    }, { workspaceId: workspace.workspaceId, cwd: workspace.path, permissionPreset: permissionStore?.catalog().defaultPreset,
      requireLocation: input.reuseBlankOnly === true || input.workspaceId !== undefined || input.cwd !== undefined,
      ...(input.workspaceId === undefined ? {} : { requestedWorkspaceId: input.workspaceId }),
      reuseBlankOnly: input.reuseBlankOnly === true,
    });
    permissionStore?.initialize(created.sessionId, wasPresent === undefined || created.sessionId !== sessionId);
    return created;
  }

  /** Store one Host attachment scoped to a Session. */
  async uploadAttachment(input: {
    sessionId: string;
    name: string;
    mediaType: string;
    dataBase64: string;
  }): Promise<SessionHostAttachmentRef> {
    await this.requireSession(input.sessionId);
    if (typeof input.name !== "string" || input.name.trim() === "" || input.name.length > 200) {
      throw new Error("invalid_attachment_name");
    }
    if (typeof input.mediaType === "string" && input.mediaType.startsWith("image/")) throw uploadError("This deployment has no image normalization processor", "IMAGE_PROCESSOR_UNAVAILABLE");
    if (typeof input.mediaType !== "string"
      || (!input.mediaType.startsWith("text/") && !input.mediaType.startsWith("image/"))) {
      throw new Error("unsupported_attachment_type");
    }
    if (typeof input.dataBase64 !== "string" || input.dataBase64 === "") throw new Error("invalid_attachment_data");
    let size: number;
    try {
      size = Uint8Array.from(atob(input.dataBase64), (char) => char.charCodeAt(0)).byteLength;
    } catch {
      throw new Error("invalid_attachment_data");
    }
    if (size > 512 * 1024) throw new Error("attachment_too_large");
    const attachment: SessionHostAttachment = {
      attachmentId: `att_${crypto.randomUUID()}`,
      sessionId: input.sessionId,
      name: input.name,
      mediaType: input.mediaType,
      dataBase64: input.dataBase64,
      size,
      createdAt: Date.now(),
    };
    await this.storage.putAttachment(attachment);
    return {
      attachmentId: attachment.attachmentId,
      name: attachment.name,
      mediaType: attachment.mediaType,
      size: attachment.size,
    };
  }

  /** Read one stored attachment (the claim runtime uploads it to Think). */
  async attachment(attachmentId: string): Promise<SessionHostAttachment> {
    const attachment = await this.storage.getAttachment(attachmentId);
    if (attachment === undefined) throw new Error(`attachment not found: ${attachmentId}`);
    return attachment;
  }

  async uploadFileStream(input: { sessionId: string; data: AsyncIterable<Uint8Array>; name?: string; signal?: AbortSignal }) {
    const session = await this.requireSession(input.sessionId);
    if (session.archived) throw new SessionRpcFault("session/archived", "Session is archived", { sessionId: input.sessionId });
    if (!this.uploads) throw uploadError("Attachment storage is unavailable", "STORAGE_UNAVAILABLE");
    this.ensureMaintenanceJobs();
    await this.wakeClaim?.();
    const bytes = await uploadBytes(input.data, input.signal);
    if ((await this.requireSession(input.sessionId)).archived) throw new SessionRpcFault("session/archived", "Session is archived", { sessionId: input.sessionId });
    return this.uploads.save(input.sessionId, bytes, input.name, input.signal);
  }

  async uploadFile(input: { sessionId: string; data: string; name?: string }) {
    const bytes = base64Bytes(input.data);
    return this.uploadFileStream({ ...input, data: (async function* () { yield bytes; })() });
  }

  async uploadedFileRead(input: { sessionId: string; receiptId: string; offset?: number; limit?: number }) {
    await this.requireSession(input.sessionId);
    if (!this.uploads) throw uploadError("Attachment storage is unavailable", "STORAGE_UNAVAILABLE");
    return this.uploads.read(input.sessionId, input.receiptId, input.offset, input.limit);
  }

  /** Queue one prompt as a durable user message + submission; a Worker claims it. */
  async prompt(input: {
    sessionId: string;
    text: string;
    requestId?: string;
    attachments?: readonly SessionHostAttachmentRef[];
    receiptIds?: readonly string[];
  }): Promise<{ requestId: string; submissionId: string }> {
    const record = await this.requireSession(input.sessionId);
    const requestId = input.requestId ?? crypto.randomUUID();
    const previous = (await this.storage.listSubmissions(input.sessionId)).find((submission) => submission.requestId === requestId);
    if (previous !== undefined) return { requestId, submissionId: previous.submissionId };
    if (record.archived) throw new SessionRpcFault("session/archived", "Session is archived", { sessionId: input.sessionId });
    const text = input.text.trim();
    if (text === "" && (input.attachments?.length ?? 0) === 0 && (input.receiptIds?.length ?? 0) === 0) {
      throw new Error("prompt must contain text or an attachment");
    }
    const resolvedAttachments: SessionHostAttachmentRef[] = [];
    for (const reference of input.attachments ?? []) {
      const stored = await this.storage.getAttachment(reference.attachmentId);
      if (stored === undefined || stored.sessionId !== input.sessionId) throw new Error(`attachment not found: ${reference.attachmentId}`);
      if (stored.mediaType.startsWith("image/")) throw uploadError("This deployment has no image normalization processor", "IMAGE_PROCESSOR_UNAVAILABLE");
      resolvedAttachments.push({
        attachmentId: stored.attachmentId,
        name: stored.name,
        mediaType: stored.mediaType,
        size: stored.size,
      });
    }
    for (const receiptId of new Set(input.receiptIds ?? [])) {
      if (!this.uploads) throw uploadError("Attachment storage is unavailable", "STORAGE_UNAVAILABLE");
      const stored = this.uploads.resolve(input.sessionId, receiptId);
      if (stored.request_id !== null && stored.request_id !== requestId) throw uploadError("Upload receipt was already admitted", "FILE_NOT_STAGED");
      resolvedAttachments.push({ attachmentId: stored.attachment_id, name: stored.name, mediaType: "application/octet-stream", size: stored.bytes, receiptId,
        file: { attachmentId: stored.attachment_id, name: stored.name, bytes: stored.bytes } });
    }
    const now = Date.now();
    const parts: unknown[] = [
      ...(text === "" ? [] : [{ type: "text", text }]),
      ...resolvedAttachments.map((attachment) => attachment.file ? { type: "file", attachment: attachment.file } : { type: "attachment", ...attachment }),
    ];
    const submission: SessionHostSubmission = {
      submissionId: crypto.randomUUID(),
      sessionId: input.sessionId,
      requestId,
      text,
      ...(resolvedAttachments.length === 0 ? {} : { attachments: resolvedAttachments }),
      status: "queued",
      createdAt: now,
      updatedAt: now,
    };
    const derivedTitle = record.title === "New Session" && text !== ""
      ? `${text.split("\n")[0]!.slice(0, 60)}${text.split("\n")[0]!.length > 60 ? "…" : ""}`
      : record.title;
    const defaultModel = this.currentDefaultModel();
    const defaultConfig = defaultModel === undefined ? undefined : this.executionConfig(defaultModel);
    if (this.storage.admitSubmission !== undefined) return this.storage.admitSubmission(submission, parts, derivedTitle, input.receiptIds, defaultConfig);
    if ((input.receiptIds?.length ?? 0) > 0) throw uploadError("Atomic attachment admission is unavailable", "STORAGE_UNAVAILABLE");
    // Compatibility storage ports have no transaction primitive. Preserve their
    // evidence separately; production SQLite freezes this with admission above.
    const current = await this.requireSession(input.sessionId);
    const model = current.model ?? defaultModel;
    if (model !== undefined) {
      const projection = await this.storage.getProjections(input.sessionId);
      const configs = projection._dshBaseInputConfigs as Record<string, SessionInputExecutionConfig> | undefined;
      await this.storage.putProjections(input.sessionId, { ...projection, _dshBaseInputConfigs: { ...configs, [requestId]: this.executionConfig(model, current.reasoningEffort) } });
    }
    await this.storage.appendMessages(input.sessionId, [{ id: requestId, seq: await this.storage.nextMessageSeq(input.sessionId), role: "user", parts }]);
    await this.storage.putSubmission(submission);
    await this.storage.appendEvent(input.sessionId, "submission.queued", submission);
    await this.storage.putSession({
      ...record,
      title: derivedTitle,
      running: true,
      blank: false,
      updatedAt: now,
    });
    return { requestId, submissionId: submission.submissionId };
  }

  /** Cancel queued/running submissions for a Session. */
  async cancel(input: { sessionId: string }): Promise<void> {
    const record = await this.requireSession(input.sessionId);
    const submissions = await this.lifecycleSubmissions(input.sessionId);
    for (const submission of submissions) {
      if (!activeSubmission(submission.status)) continue;
      const cancelled: SessionHostSubmission = {
        ...submission,
        status: "cancelled",
        updatedAt: Date.now(),
      };
      await this.transitionSubmission(submission, "cancelled", "submission.cancelled", cancelled);
    }
    await this.storage.putSession({ ...record, running: false, updatedAt: Date.now() });
  }

  /** Request identities used to cancel the matching durable agent execution. */
  async activeRequestIds(sessionId: string): Promise<readonly string[]> {
    await this.requireSession(sessionId);
    return (await this.lifecycleSubmissions(sessionId))
      .filter((entry) => activeSubmission(entry.status))
      .map((entry) => entry.requestId);
  }

  /** Read the durable queued/running submissions in admission order. */
  async queue(input: { sessionId: string }): Promise<{ items: SessionQueueRow[] }> {
    await this.requireSession(input.sessionId);
    const submissions = await this.storage.listSubmissions(input.sessionId);
    return {
      items: submissions
        .filter((submission) => submission.status === "queued")
        .sort((left, right) => left.createdAt - right.createdAt)
        .map((submission) => ({
          submissionId: submission.submissionId,
          requestId: submission.requestId,
          text: submission.text,
          createdAt: submission.createdAt,
        })),
    };
  }

  /** Edit the text of one still-queued submission. */
  async editQueueItem(input: { sessionId: string; submissionId: string; text: string }): Promise<void> {
    await this.requireSession(input.sessionId);
    const submission = await this.storage.getSubmission(input.submissionId);
    if (submission === undefined || submission.sessionId !== input.sessionId) throw new Error("submission not found");
    if (submission.status !== "queued") throw new Error(`submission is not queued: ${submission.status}`);
    const next: SessionHostSubmission = { ...submission, text: input.text, updatedAt: Date.now() };
    await this.storage.putSubmission(next);
    await this.storage.appendEvent(input.sessionId, "submission.edited", next);
  }

  /** Remove or retry one queue submission; retry requeues it durably. */
  async updateQueue(input: { sessionId: string; itemId: string; action: "remove" | "retry" | "clear" }): Promise<void> {
    await this.requireSession(input.sessionId);
    const submissions = await this.storage.listSubmissions(input.sessionId);
    for (const submission of submissions) {
      const selected = input.action === "clear"
        ? submission.status === "queued"
        : submission.submissionId === input.itemId;
      if (!selected) continue;
      if (submission.status !== "queued") throw new SessionRpcFault("session/queue-item-not-found", "Queued item is no longer pending", { itemId: input.itemId });
      const next: SessionHostSubmission = {
        ...submission,
        status: input.action === "retry" ? "queued" : "cancelled",
        updatedAt: Date.now(),
      };
      await this.transitionSubmission(submission, next.status, input.action === "retry" ? "submission.requeued" : "submission.cancelled", next);
    }
  }

  /**
   * Claim one queued submission, let a model runtime produce the transcript,
   * then persist the resulting messages and submission status.
   */
  async runSubmission(input: {
    sessionId: string;
    submissionId: string;
    /** Resume a durable execution after the owner process lost its claim. */
    resume?: boolean;
  }, run: (submission: SessionHostSubmission) => Promise<{
    messages: readonly { id: string; role: string; parts: readonly unknown[] }[];
    projections?: Record<string, unknown>;
  }>): Promise<{
    submissionId: string;
    status: "completed" | "failed" | "cancelled" | "awaiting-approval";
    messages: number;
  }> {
    const submission = await this.storage.getSubmission(input.submissionId);
    if (submission === undefined || submission.sessionId !== input.sessionId) throw new Error("submission not found");
    if (submission.status !== "queued" && !(input.resume && submission.status === "running")) throw new Error(`submission is not queued: ${submission.status}`);
    const ordered = await this.lifecycleSubmissions(input.sessionId);
    const earlier = ordered.slice(0, ordered.findIndex(entry => entry.submissionId === input.submissionId)).find(entry => activeSubmission(entry.status));
    if (earlier !== undefined) throw new Error("submission is not queued: an earlier turn is still active");
    if ((await this.requireSession(input.sessionId)).archived) throw new SessionRpcFault("session/archived", "Session is archived", { sessionId: input.sessionId });
    const running: SessionHostSubmission = { ...submission, status: "running", updatedAt: Date.now() };
    await this.transitionSubmission(submission, "running", "submission.running", running);
    try {
      const result = await run(running);
      const messages = await this.syncTranscript(input.sessionId, result.messages);
      if (result.projections !== undefined) {
        const current = await this.storage.getProjections(input.sessionId);
        await this.storage.putProjections(input.sessionId, { ...current, ...result.projections });
      }
      // A cancellation arriving during execution remains authoritative.
      const latest = await this.storage.getSubmission(input.submissionId);
      const start = messages.findIndex(message => message.id === running.requestId);
      const end = messages.findIndex((message, index) => index > start && message.role === "user");
      const awaiting = pendingToolApproval(messages.slice(start + 1, end < 0 ? undefined : end));
      const completed: SessionHostSubmission = { ...running, status: latest?.status === "cancelled" ? "cancelled" : awaiting ? "awaiting-approval" : "completed", updatedAt: Date.now() };
      const committed = await this.transitionSubmission(completed, completed.status, `submission.${completed.status}`, completed);
      return { submissionId: committed.submissionId, status: committed.status as "completed" | "cancelled" | "awaiting-approval", messages: messages.length };
    } catch (error) {
      const latest = await this.storage.getSubmission(input.submissionId);
      if (latest?.status === "cancelled") throw error;
      // A transport interruption is not evidence the durable agent failed.
      // Retain its request id and resume it on the next alarm.
      if (input.resume && !(error instanceof Error && error.name === "AgentExecutionFailed")) {
        await this.storage.appendEvent(input.sessionId, "submission.interrupted", { submissionId: running.submissionId });
        await this.wakeClaim?.();
        throw error;
      }
      const failed: SessionHostSubmission = { ...running, status: "failed", updatedAt: Date.now() };
      await this.transitionSubmission(failed, "failed", "submission.failed", {
        submissionId: failed.submissionId,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * List every queued submission across Sessions. The Durable Object alarm uses
   * this to drive turns even when the browser that queued them closed.
   * @returns queued submissions in Session list order.
   */
  async queuedSubmissions(): Promise<readonly { readonly sessionId: string; readonly submissionId: string }[]> {
    const queued: Array<{ sessionId: string; submissionId: string }> = [];
    const rows = await this.storage.listSessions();
    for (const session of rows) {
      const submissions = await this.lifecycleSubmissions(session.sessionId);
      for (const submission of submissions) {
        // An archived waiting input still needs cancellation compensation.
        if (session.archived && activeSubmission(submission.status)) {
          queued.push({ sessionId: submission.sessionId, submissionId: submission.submissionId });
          break;
        }
        if (submission.status === "awaiting-approval") break;
        if (submission.status === "queued" || submission.status === "running" || submission.status === "continuing") {
          queued.push({ sessionId: submission.sessionId, submissionId: submission.submissionId });
          break;
        }
      }
    }
    return queued;
  }

  /** Recover an accepted decision without replaying the original Think submission. */
  async approvalContinuation(sessionId: string, submissionId: string): Promise<ApprovalContinuation | undefined> {
    const snapshot = await this.transcriptSnapshot(sessionId);
    if (snapshot.submissions.find(row => row.submissionId === submissionId)?.status !== "continuing") return undefined;
    const event = [...snapshot.events].reverse().find(row => row.type === "submission.approval-continuing"
      && (row.payload as { submissionId?: unknown } | null)?.submissionId === submissionId);
    if (!event) throw new Error("Approval continuation has no durable decision");
    return event.payload as ApprovalContinuation;
  }

  /** Only approvals owned by a known, nonterminal input can be acted on. */
  async approvalTargets(sessionId: string, messages?: readonly { id: string; role: string; parts: readonly unknown[] }[]): Promise<Array<{ requestId: string; userMessageId: string; toolCallId?: string; executionId?: string }>> {
    const snapshot = await this.transcriptSnapshot(sessionId);
    if (snapshot.session.archived) return [];
    const records = messages === undefined ? snapshot.records : messages.map((message, index) => ({ ...message, seq: index + 1 }));
    const turns = turnStates({ ...snapshot, records });
    return turns.flatMap(turn => {
      if (!snapshot.submissions.some(row => row.requestId === turn.requestId) || !["running", "awaiting-approval"].includes(turn.status)) return [];
      const start = records.findIndex(record => record.id === turn.userMessageId);
      const end = records.findIndex((record, index) => index > start && record.role === "user");
      return records.slice(start + 1, end < 0 ? undefined : end).flatMap(record => record.role !== "assistant" ? [] : record.parts.flatMap(part => {
        if (typeof part !== "object" || part === null) return [];
        const row = part as { state?: string; toolCallId?: string; output?: { status?: string; executionId?: string } };
        if (row.state !== "approval-requested" && row.output?.status !== "paused") return [];
        return [{ requestId: turn.requestId, userMessageId: turn.userMessageId,
          ...(typeof row.toolCallId === "string" ? { toolCallId: row.toolCallId } : {}),
          ...(typeof row.output?.executionId === "string" ? { executionId: row.output.executionId } : {}) }];
      }));
    });
  }

  /** Persist running before allowing any approved action or continuation to run. */
  async beginApproval(input: { sessionId: string; toolCallId?: string; executionId?: string; decision: "approved" | "rejected" }, executionTarget?: { requestId: string; userMessageId: string }): Promise<ApprovalContinuation> {
    const snapshot = await this.transcriptSnapshot(input.sessionId);
    if (snapshot.session.archived) throw new SessionRpcFault("session/archived", "Session is archived", { sessionId: input.sessionId });
    const previous = [...snapshot.events].reverse().find(row => row.type === "submission.approval-continuing"
      && (input.toolCallId !== undefined ? (row.payload as ApprovalContinuation).toolCallId === input.toolCallId : (row.payload as ApprovalContinuation).executionId === input.executionId));
    const previousIntent = previous?.payload as ApprovalContinuation | undefined;
    if (previousIntent && previousIntent.decision !== input.decision) throw new SessionRpcFault("session/approval-conflict", "Approval already has a different decision", {});
    const target = input.toolCallId === undefined ? executionTarget : (await this.approvalTargets(input.sessionId)).find(row => row.toolCallId === input.toolCallId);
    if (!target && !previousIntent) throw new SessionRpcFault("session/approval-not-found", "Approval is not owned by a pending input", {});
    const submission = previousIntent === undefined
      ? snapshot.submissions.find(row => row.requestId === target?.requestId)
      : snapshot.submissions.find(row => row.submissionId === previousIntent.submissionId);
    if (!submission) throw new SessionRpcFault("session/approval-not-found", "Approval has no owning input", {});
    if (submission.status === "cancelled") throw new SessionRpcFault("session/approval-cancelled", "Input was cancelled", {});
    if (previousIntent && (submission.status === "completed" || submission.status === "failed")) return { ...previousIntent, settled: true };
    const intent: ApprovalContinuation = { ...input, submissionId: submission.submissionId, requestId: submission.requestId, userMessageId: previousIntent?.userMessageId ?? target!.userMessageId };
    // Production state and decision are one SQLite transaction. A failed event
    // insert cannot strand an input in either waiting or continuing.
    await this.transitionSubmission(submission, "continuing", "submission.approval-continuing", intent);
    await this.wakeClaim?.();
    return intent;
  }

  /** Commit the continued transcript before publishing its lifecycle outcome. */
  async finishApproval(intent: ApprovalContinuation, messages: readonly { id: string; role: string; parts: readonly unknown[] }[], result: { status?: string; error?: string } = {}, statistics?: ExecutionStatistics): Promise<void> {
    await this.syncTranscript(intent.sessionId, messages);
    const latest = await this.storage.getSubmission(intent.submissionId);
    if (!latest) throw new Error("Approval input disappeared");
    const start = messages.findIndex(message => message.id === intent.userMessageId);
    if (start < 0) throw new Error("Approval transcript lost its owning user message");
    await this.storage.putProjections(intent.sessionId, withExecutionStatistics(await this.storage.getProjections(intent.sessionId), messages, statistics));
    const status = latest.status === "cancelled" ? "cancelled" : result.status === "error" || result.status === "failed" ? "failed"
      : result.status === "aborted" || result.status === "skipped" || result.status === "cancelled" ? "cancelled"
      : result.status === "completed" ? "completed"
      : result.status === "awaiting-approval" ? "awaiting-approval"
      : "continuing";
    await this.transitionSubmission(latest, status, `submission.${status}`, { submissionId: latest.submissionId, authoritative: true, ...(result.error === undefined ? {} : { message: result.error }) });
    await this.wakeClaim?.();
  }

  /** Reload the session list only after committed changes. */
  async *control(signal: AbortSignal): AsyncIterable<{ type: "sessions.snapshot"; sessions: readonly SessionListRow[] }> {
    for await (const _change of this.changes.subscribe(signal)) {
      const { sessions } = await this.list({});
      yield { type: "sessions.snapshot", sessions };
    }
  }

  /** Official browse service over owner-scoped logical workspace directories. */
  async directoryList(path?: string) {
    if (this.storage.directoryList === undefined) throw new SessionRpcFault("directory-picker/unavailable", "Logical directory storage is unavailable", { capability: "unavailable" });
    return this.storage.directoryList(path);
  }

  async directoryCreate(path: string, name: string): Promise<string> {
    if (this.storage.directoryCreate === undefined) throw new SessionRpcFault("directory-picker/unavailable", "Logical directory storage is unavailable", { capability: "unavailable" });
    return this.storage.directoryCreate(path, name);
  }

  /** Initialize or return the default Workspace. */
  async workspaceInitializeDefault(): Promise<{ workspace: ReturnType<typeof workspaceViewLike> }> {
    const data = await this.workspaceData();
    const workspace = data.workspaces.find((item) => item.workspaceId === DEFAULT_WORKSPACE_ID) ?? data.workspaces[0]!;
    return { workspace: workspaceViewLike(workspace, data) };
  }

  /** Create or idempotently resolve one logical Workspace path. */
  async workspaceCreate(input: { path?: string; title?: string } = {}): Promise<{ workspace: WorkspaceView; created: boolean }> {
    const data = await this.workspaceData();
    const now = Date.now();
    const path = canonicalDirectoryPath(input.path?.trim() || `/workspace-${now}`);
    const existing = data.workspaces.find((workspace) => workspace.path === path);
    if (existing !== undefined) return { workspace: workspaceViewLike(existing, data), created: false };
    const workspace: SessionWorkspaceRecord = {
      workspaceId: `ws_${crypto.randomUUID()}`,
      title: input.title?.trim() || path.split("/").filter(Boolean).at(-1) || "Workspace",
      path,
      position: Math.max(-1, ...data.workspaces.map((item) => item.position)) + 1,
      createdAt: now,
      updatedAt: now,
    };
    await this.storage.putWorkspace(workspace);
    const next = await this.workspaceData();
    return { workspace: workspaceViewLike(workspace, next), created: true };
  }

  /** Rename one Workspace. */
  async workspaceRename(input: { workspaceId: string; title: string }): Promise<{ workspace: WorkspaceView }> {
    const data = await this.workspaceData();
    const workspace = data.workspaces.find((item) => item.workspaceId === input.workspaceId);
    if (workspace === undefined) throw new Error("workspace not found");
    const title = input.title.trim();
    if (title === "") throw new Error("workspace title must not be empty");
    const updated = { ...workspace, title, updatedAt: Date.now() };
    await this.storage.putWorkspace(updated);
    const next = await this.workspaceData();
    return { workspace: workspaceViewLike(updated, next) };
  }

  /**
   * Move one Workspace within the registry display order.
   * @param input - moved Workspace and optional anchor Workspace.
   * @returns the complete resulting Workspace order.
   */
  async workspaceInsertBefore(input: { workspaceId: string; beforeWorkspaceId?: string }): Promise<{ workspaceIds: string[] }> {
    const data = await this.workspaceData();
    const order = data.workspaces.map((workspace) => workspace.workspaceId);
    if (!order.includes(input.workspaceId)) throw new Error("workspace not found");
    if (input.beforeWorkspaceId !== undefined && !order.includes(input.beforeWorkspaceId)) {
      throw new Error("workspace not found");
    }
    const moved = insertIdBefore(order, input.workspaceId, input.beforeWorkspaceId);
    if (moved.every((id, index) => id === order[index])) return { workspaceIds: order };
    const now = Date.now();
    for (const [position, workspaceId] of moved.entries()) {
      const workspace = data.workspaces.find((item) => item.workspaceId === workspaceId);
      if (workspace === undefined) throw new Error("workspace not found");
      await this.storage.putWorkspace({ ...workspace, position, updatedAt: now });
    }
    return { workspaceIds: moved };
  }

  /**
   * Move one accounted Session within a Workspace's manual order.
   * @param input - owning Workspace, moved Session, and optional anchor Session.
   * @returns the complete updated Workspace projection.
   */
  async workspaceInsertSessionBefore(input: {
    workspaceId: string;
    sessionId: string;
    beforeSessionId?: string;
  }): Promise<{ workspace: WorkspaceView }> {
    const data = await this.workspaceData();
    const workspace = data.workspaces.find((item) => item.workspaceId === input.workspaceId);
    if (workspace === undefined) throw new Error("workspace not found");
    const order = membershipsOf(workspace.workspaceId, data.bySession);
    if (!order.includes(input.sessionId)) throw new Error("workspace session is not accounted");
    if (input.beforeSessionId !== undefined && !order.includes(input.beforeSessionId)) {
      throw new Error("workspace anchor session is not accounted");
    }
    const moved = insertIdBefore(order, input.sessionId, input.beforeSessionId);
    const now = Date.now();
    const updated = moved.every((id, index) => id === order[index])
      ? workspace
      : { ...workspace, updatedAt: now };
    if (updated !== workspace) {
      for (const [position, sessionId] of moved.entries()) {
        await this.storage.putMembership(workspace.workspaceId, sessionId, position);
      }
      await this.storage.putWorkspace(updated);
    }
    const next = await this.workspaceData();
    return { workspace: workspaceViewLike(updated, next) };
  }

  /** Delete one Workspace and move its Sessions to the default Workspace. */
  async workspaceDelete(input: { workspaceId: string }): Promise<void> {
    const data = await this.workspaceData();
    if (!data.workspaces.some((item) => item.workspaceId === input.workspaceId)) throw new Error("workspace not found");
    if (input.workspaceId === DEFAULT_WORKSPACE_ID) throw new Error("cannot delete the default workspace");
    const fallback = data.workspaces.find((item) => item.workspaceId === DEFAULT_WORKSPACE_ID) ?? data.workspaces[0];
    if (fallback === undefined) throw new Error("workspace not found");
    const memberships = await this.storage.listMemberships();
    const fallbackOrder = memberships.filter((item) => item.workspaceId === fallback.workspaceId);
    let position = Math.max(-1, ...fallbackOrder.map((item) => item.position)) + 1;
    for (const membership of memberships.filter((item) => item.workspaceId === input.workspaceId)) {
      await this.storage.putMembership(fallback.workspaceId, membership.sessionId, position++);
    }
    await this.storage.deleteWorkspaceMemberships(input.workspaceId);
    await this.storage.deleteWorkspace(input.workspaceId);
  }

  /** Commit archive admission before the DO stops the durable Agent. */
  async workspaceArchive(input: { sessionId: string; stopActivity?: boolean }): Promise<void> {
    await this.lifecycleSubmissions(input.sessionId);
    if (this.storage.archiveSession !== undefined) return this.storage.archiveSession(input.sessionId, input.stopActivity === true);
    const record = await this.requireSession(input.sessionId);
    const active = await this.activeRequestIds(input.sessionId);
    if (!record.archived && !input.stopActivity && active.length > 0) throw new SessionRpcFault("workspace/session-active", "Session has active work", { sessionId: input.sessionId, activity: [{ kind: "turn", items: active.map(id => ({ id })) }] });
    await this.storage.putSessionFlags(input.sessionId, { pinned: false, archived: true });
    await this.storage.putSession({ ...record, archived: true, updatedAt: Date.now() });
  }

  /** Persist one session's workspace flags; a no-op write keeps flag order. */
  async workspaceSetFlags(input: { sessionId: string; pinned?: boolean; archived?: boolean }): Promise<void> {
    if (input.archived === true) return this.workspaceArchive({ sessionId: input.sessionId });
    const record = await this.requireSession(input.sessionId);
    const data = await this.workspaceData();
    const current = data.flags[input.sessionId] ?? { pinned: false, archived: false };
    const next = {
      pinned: input.pinned ?? current.pinned,
      archived: input.archived ?? current.archived,
    };
    if (next.pinned !== current.pinned || next.archived !== current.archived) {
      await this.storage.putSessionFlags(input.sessionId, next);
    }
    if (input.archived !== undefined && record.archived !== input.archived) {
      await this.storage.putSession({ ...record, archived: input.archived, updatedAt: Date.now() });
    }
  }

  /** List the direct children of one Session workspace directory. */
  async workspaceFileList(input: { sessionId: string; path: string }): Promise<WorkspaceFileListing> {
    const { store, scope } = await this.workspaceFileContext(input.sessionId);
    return store.list(scope, input.path);
  }

  /** Report one workspace file's identity, version, and byte size. */
  async workspaceFileStat(input: { sessionId: string; path: string }): Promise<WorkspaceFileStat> {
    const { store, scope } = await this.workspaceFileContext(input.sessionId);
    return store.stat(scope, input.path);
  }

  /** Read one 1-based page of lines from one workspace file. */
  async workspaceFileRead(input: {
    sessionId: string;
    path: string;
    offset?: number;
    limit?: number;
  }): Promise<WorkspaceFileTextPage> {
    const { store, scope } = await this.workspaceFileContext(input.sessionId);
    return store.read(scope, input.path, {
      ...(input.offset === undefined ? {} : { offset: input.offset }),
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    });
  }

  /** Read one byte window of one workspace file and encode it for JSON. */
  async workspaceFileReadBytes(input: {
    sessionId: string;
    path: string;
    offset?: number;
    length?: number;
  }): Promise<{ absolutePath: string; version: string; bytes?: number; offset: number; dataBase64: string; eof: boolean }> {
    const { store, scope } = await this.workspaceFileContext(input.sessionId);
    const page = await store.readBytes(scope, input.path, {
      ...(input.offset === undefined ? {} : { offset: input.offset }),
      ...(input.length === undefined ? {} : { length: input.length }),
    });
    return {
      absolutePath: page.absolutePath,
      version: page.version,
      ...(page.bytes === undefined ? {} : { bytes: page.bytes }),
      offset: page.offset,
      dataBase64: encodeBase64(page.data),
      eof: page.eof,
    };
  }

  /** Write one new immutable version of one workspace file. */
  async workspaceFileWrite(input: {
    sessionId: string;
    path: string;
    dataBase64: string;
    mediaType?: string;
  }): Promise<WorkspaceFileWriteResult> {
    const data = decodeBase64(input.dataBase64);
    const { store, scope } = await this.workspaceFileContext(input.sessionId);
    return store.write(scope, input.path, data, input.mediaType);
  }

  /** Model-action boundary; explicit user file editing keeps its separate service. */
  async workspaceFileWriteFromAgent(input: {sessionId:string;path:string;dataBase64:string;mediaType?:string}): Promise<WorkspaceFileWriteResult> {
    const {store,scope} = await this.workspaceFileContext(input.sessionId);
    const snapshot = await this.permissionSnapshot({sessionId:input.sessionId});
    try {
      assertFilePermission(snapshot,{ownerId:store.ownerId,targetOwnerId:store.ownerId,sessionWorkspaceId:scope.workspaceId,targetWorkspaceId:scope.workspaceId,
        sessionWorkspaceRoot:scope.root,targetWorkspaceRoot:scope.root,path:input.path,write:true});
    } catch(error) {
      throw new SessionRpcFault('permission/denied',error instanceof Error ? error.message : String(error));
    }
    return store.write(scope,input.path,decodeBase64(input.dataBase64),input.mediaType);
  }

  /**
   * Seed the real `Conversation.md` workspace file from the durable transcript.
   *
   * Idempotent: when the Session workspace already holds any file the existing
   * tree is left untouched and the method returns undefined.
   * @param input - Session whose transcript is seeded.
   * @returns the seeded file's stat, or undefined when a file already existed.
   */
  async workspaceFileEnsureTranscript(input: { sessionId: string }): Promise<WorkspaceFileWriteResult | undefined> {
    const { store, scope } = await this.workspaceFileContext(input.sessionId);
    if (store.hasFiles(scope)) return undefined;
    const history = await this.history({ sessionId: input.sessionId });
    const markdown = transcriptMarkdown(history.records);
    return store.write(scope, "Conversation.md", new TextEncoder().encode(markdown), "text/markdown; charset=utf-8");
  }

  /** Seed a new/forked execution from completed Host history only. */
  async executionHistory(sessionId: string): Promise<readonly SessionMessageRecord[]> {
    await this.requireSession(sessionId);
    const records = await this.storage.readAllMessages(sessionId);
    const pending = (await this.storage.listSubmissions(sessionId)).filter((entry) => entry.status === "queued" || entry.status === "running");
    const ids = new Set(pending.map((entry) => this.pendingMessage(records, entry)?.id ?? entry.requestId));
    return records.filter((record) => !ids.has(record.id)).map(record => ({ ...record, parts: record.parts.filter(part => typeof part !== "object" || part === null || !['data-dsh-model-source','data-dsh-step'].includes(String((part as { type?: unknown }).type))).map(part => {
      if (typeof part !== "object" || part === null || (part as { type?: unknown }).type !== "file") return part;
      if (!this.uploads) throw uploadError("File history storage is unavailable", "STORAGE_UNAVAILABLE");
      const ref = this.uploads.admittedReference(sessionId, (part as { attachment: FileRef }).attachment);
      return { type: "text", text: `Previously admitted file (untrusted user data): ${JSON.stringify(ref)}. Use read_uploaded_file with this receiptId to read its contents.` };
    }) }));
  }

  private pendingMessage(records: readonly SessionMessageRecord[], submission: SessionHostSubmission): SessionMessageRecord | undefined {
    return records.find((record) => record.id === submission.requestId)
      // Old deployments used a random user message id before admission.
      ?? [...records].reverse().find((record) => record.role === "user" && transcriptText(record.parts) === submission.text);
  }

  /** Think owns admitted messages; Host owns inputs not admitted yet. */
  private async transcriptWithQueue(sessionId: string, messages: readonly { id: string; role: string; parts: readonly unknown[] }[]): Promise<SessionMessageRecord[]> {
    const pending = (await this.storage.listSubmissions(sessionId)).filter((entry) => entry.status === "queued");
    const records = await this.storage.readAllMessages(sessionId);
    const ids = new Set(messages.map((message) => message.id));
    const queued = pending.flatMap((entry) => {
      if (ids.has(entry.requestId)) return [];
      const record = this.pendingMessage(records, entry);
      return record === undefined ? [] : [{ ...record, id: entry.requestId }];
    });
    return [...messages, ...queued].map((message, index) => ({ ...message, seq: index + 1 }));
  }

  private async syncTranscript(sessionId: string, messages: readonly { id: string; role: string; parts: readonly unknown[] }[]): Promise<SessionMessageRecord[]> {
    if (this.storage.syncMessages !== undefined) return this.storage.syncMessages(sessionId, messages);
    const merged = await this.transcriptWithQueue(sessionId, messages);
    await this.storage.replaceMessages(sessionId, merged);
    return merged;
  }

  /** Synchronise admitted history without discarding later queued inputs. */
  async syncAgentMessages(input: {
    sessionId: string;
    messages: readonly { id: string; role: string; parts: readonly unknown[] }[];
  }): Promise<void> {
    const record = await this.requireSession(input.sessionId);
    await this.syncTranscript(input.sessionId, input.messages);
    const pending = (await this.storage.listSubmissions(input.sessionId)).some((entry) => activeSubmission(entry.status));
    await this.storage.putSession({ ...record, running: pending, blank: false, updatedAt: Date.now() });
    await this.storage.appendEvent(input.sessionId, "agent.synced", { messages: input.messages.length });
  }

  /** Read the durable per-owner settings document. */
  async settingsDescribe(): Promise<{ readonly writable: true; readonly revision: number; readonly values: Readonly<Record<string, Record<string, unknown>>> }> {
    const snapshot = this.settings?.read() ?? { revision: 0, values: {} };
    return { writable: true, revision: snapshot.revision, values: snapshot.values };
  }

  /** Apply one settings mutation against its expected revision. */
  async settingsMutate(input: { ns: string; ops: readonly SettingsOperation[]; expectedRevision?: number }): Promise<{ readonly writable: true; readonly revision: number; readonly values: Readonly<Record<string, Record<string, unknown>>> }> {
    assertSettingsWriteSupported("settingsMutate", input.ns, input.ops);
    if (this.settings === undefined) throw new Error("settings storage is not configured");
    const snapshot = this.settings.mutate(input);
    return { writable: true, revision: snapshot.revision, values: snapshot.values };
  }

  async settingsUpdate(input: { ns: string; patch: Record<string, unknown>; expectedRevision?: number }): Promise<{ readonly writable: true; readonly revision: number; readonly values: Readonly<Record<string, Record<string, unknown>>> }> {
    assertSettingsPatchSupported("settingsUpdate", input.ns, input.patch);
    if (this.settings === undefined) throw new Error("settings storage is not configured");
    return { writable: true, ...this.settings.update(input) };
  }

  /** Describe encrypted credential references without returning values. */
  async credentialsDescribe(input: { refs: readonly string[] }): Promise<{ readonly writable: boolean; readonly entries: Readonly<Record<string, CredentialInfo>> }> {
    if (this.credentials === undefined) return { writable: false, entries: Object.fromEntries(input.refs.map((ref) => [ref, { configured: false, writable: false }])) };
    return { writable: this.credentials.writable, entries: this.credentials.describe(input.refs) };
  }

  /** Encrypt and store one credential value. */
  async credentialsSet(input: { ref: string; value: string }): Promise<void> {
    if (this.credentials === undefined) throw new Error("credential storage is not configured");
    await this.credentials.set(input.ref, input.value);
  }

  /** Remove one stored credential. */
  async credentialsUnset(input: { ref: string }): Promise<void> {
    if (this.credentials === undefined) throw new Error("credential storage is not configured");
    this.credentials.unset(input.ref);
  }

  /** Interrogate the DeepSeek endpoint with a stored or supplied BYOK key. */
  async llmDiscoverModels(input: { settingsNs: string; apiKey?: string; baseURL?: string }): Promise<{ models: Array<{ id: string; name?: string }> }> {
    const credential = input.apiKey !== undefined && input.apiKey !== ""
      ? input.apiKey
      : this.credentials === undefined ? undefined : await this.credentials.get("DEEPSEEK_OFFICIAL_API_KEY").catch(() => undefined);
    if (credential === undefined || credential === "") {
      const error = new Error("no DeepSeek API key is configured") as Error & { code?: string };
      error.code = "llm/model-discovery-rejected";
      throw error;
    }
    const base = (input.baseURL === undefined || input.baseURL === "" ? "https://api.deepseek.com/v1" : input.baseURL).replace(/\/+$/, "");
    const response = await fetch(`${base}/models`, { headers: { authorization: `Bearer ${credential}`, accept: "application/json" } });
    if (!response.ok) {
      const error = new Error(`DeepSeek model listing refused with HTTP ${response.status}`) as Error & { code?: string };
      error.code = "llm/model-discovery-rejected";
      throw error;
    }
    const body = await response.json() as { readonly data?: unknown };
    const rows = Array.isArray(body.data) ? body.data : [];
    return {
      models: rows.flatMap((row) => {
        if (typeof row !== "object" || row === null) return [];
        const id = (row as { readonly id?: unknown }).id;
        if (typeof id !== "string" || id === "") return [];
        const ownedBy = (row as { readonly owned_by?: unknown }).owned_by;
        return [{ id, ...(typeof ownedBy === "string" ? { name: ownedBy } : {}) }];
      }),
    };
  }

  /** Append one session event (used by the Agent retry bridge). */
  async appendSessionEvent(input: { sessionId: string; type: string; payload: unknown }): Promise<{ seq: number }> {
    await this.requireSession(input.sessionId);
    const event = await this.storage.appendEvent(input.sessionId, input.type, input.payload);
    return { seq: event.seq };
  }

  /** Restore the R2 migration sidecar (settings document + user-facing tasks). */
  restoreMigrationSidecar(input: {
    settings?: { revision?: number; values?: Readonly<Record<string, Readonly<Record<string, unknown>>>> };
    schedules?: readonly ScheduleEntry[];
  }): { settings: number; schedules: number } {
    if (!isRecord(input)) throw new Error("invalid migration sidecar");
    if (input.settings !== undefined && (!isRecord(input.settings) || !isRecord(input.settings.values)
      || !Number.isSafeInteger(input.settings.revision) || Number(input.settings.revision) < 0
      || Object.values(input.settings.values).some((value) => !isRecord(value)))) throw new Error("invalid migration settings");
    if (input.schedules !== undefined && !Array.isArray(input.schedules)) throw new Error("invalid migration schedules");
    // An older sidecar must not erase a newer document included in the SQL
    // snapshot, and a missing sidecar field is not an instruction to clear it.
    const settings = this.settings === undefined || input.settings === undefined
      || this.settings.read().revision >= Number(input.settings.revision)
      ? 0 : this.settings.restore(input.settings.values!, input.settings.revision);
    const schedules = this.schedules === undefined || input.schedules === undefined ? 0 : this.schedules.restore(input.schedules);
    return { settings, schedules };
  }

  /** Register the Host's durable maintenance callbacks once. */
  ensureMaintenanceJobs(): { nextDueAtMs?: number } {
    if (this.jobs === undefined) return {};
    this.jobs.ensureInterval("cleanupFiles", 3600);
    this.jobs.ensureInterval("pruneSchedules", 3600);
    this.jobs.ensureInterval("recoverSubmissions", 120);
    return { nextDueAtMs: this.jobs.nextDueAtMs() };
  }

  /** Execute one maintenance callback by kind. */
  private async runMaintenanceCallback(kind: string, options: { olderThanMs?: number } = {}): Promise<Record<string, unknown>> {
    if (kind === "cleanupFiles") {
      const attachments = await this.uploads?.cleanup({ olderThanMs: options.olderThanMs });
      const versions = this.files === undefined ? { skipped: "files-unconfigured" } : await this.files.pruneVersions({ olderThanMs: options.olderThanMs });
      return { ...versions, ...(attachments === undefined ? {} : { attachments }) };
    }
    if (kind === "pruneSchedules") {
      if (this.schedules === undefined) return { skipped: "schedules-unconfigured" };
      return { deletedSchedules: this.schedules.pruneEnded({ olderThanMs: options.olderThanMs }) };
    }
    if (kind === "recoverSubmissions") {
      const queued = await this.queuedSubmissions();
      if (queued.length > 0) await this.wakeClaim?.();
      return { queued: queued.length, wokeClaim: queued.length > 0 };
    }
    throw new Error(`unknown maintenance job: ${kind}`);
  }

  private maintenanceDelay(intervalSeconds: number, detail: Record<string, unknown>): number {
    const attachments = detail.attachments as { hasMore?: boolean; failed?: number } | undefined;
    return attachments?.hasMore ? (attachments.failed ? 60_000 : 5_000) : intervalSeconds * 1000;
  }

  /** Execute every due maintenance callback and journal the outcome. */
  async runDueMaintenance(nowIso: string): Promise<{ ran: number; nextDueAtMs?: number }> {
    if (this.jobs === undefined) return { ran: 0 };
    const nowMs = Date.parse(nowIso);
    let ran = 0;
    for (const schedule of this.jobs.due(nowMs)) {
      const startedAt = Date.now();
      let status: "ok" | "failed" = "ok";
      let detail: Record<string, unknown> = {};
      try { detail = await this.runMaintenanceCallback(schedule.kind); }
      catch (error) {
        status = "failed";
        detail = { error: error instanceof Error ? error.message : String(error) };
      }
      const finishedAt = Date.now();
      this.jobs.recordRun({ kind: schedule.kind, status, startedAt, finishedAt, detail, nextAt: finishedAt + this.maintenanceDelay(schedule.intervalSeconds, detail) });
      ran += 1;
    }
    return { ran, ...(this.jobs.nextDueAtMs() === undefined ? {} : { nextDueAtMs: this.jobs.nextDueAtMs() }) };
  }

  /** List the durable registrations plus the recent run journal. */
  maintenanceList(): { schedules: readonly MaintenanceJobSchedule[]; history: readonly MaintenanceJobRun[]; nextDueAtMs?: number } {
    if (this.jobs === undefined) return { schedules: [], history: [] };
    this.ensureMaintenanceJobs();
    return {
      schedules: this.jobs.list(),
      history: this.jobs.history(20),
      ...(this.jobs.nextDueAtMs() === undefined ? {} : { nextDueAtMs: this.jobs.nextDueAtMs() }),
    };
  }

  /** Run one maintenance callback immediately (operator/acceptance path). */
  async maintenanceRun(input: { kind: string; olderThanMs?: number }): Promise<{ kind: string; run: MaintenanceJobRun; schedules: readonly MaintenanceJobSchedule[] }> {
    if (this.jobs === undefined) throw new Error("maintenance jobs are not configured");
    this.ensureMaintenanceJobs();
    if (!this.jobs.list().some((schedule) => schedule.kind === input.kind)) throw new Error(`unknown maintenance job: ${input.kind}`);
    const schedule = this.jobs.list().find((entry) => entry.kind === input.kind)!;
    const startedAt = Date.now();
    let status: "ok" | "failed" = "ok";
    let detail: Record<string, unknown> = {};
    try { detail = await this.runMaintenanceCallback(input.kind, input.olderThanMs === undefined ? {} : { olderThanMs: input.olderThanMs }); }
    catch (error) {
      status = "failed";
      detail = { error: error instanceof Error ? error.message : String(error) };
    }
    const run = this.jobs.recordRun({
      kind: input.kind,
      status,
      startedAt,
      finishedAt: Date.now(),
      detail,
      nextAt: Date.now() + this.maintenanceDelay(schedule.intervalSeconds, detail),
    });
    await this.wakeClaim?.();
    return { kind: input.kind, run, schedules: this.jobs.list() };
  }

  /** Recent maintenance journal. */
  maintenanceHistory(input: { limit?: number } = {}): readonly MaintenanceJobRun[] {
    if (this.jobs === undefined) return [];
    this.ensureMaintenanceJobs();
    return this.jobs.history(input.limit ?? 20);
  }

  /** Official delivery limits. */
  scheduleDeliveryLimits(): { newSessionIntervalSeconds: number } {
    return { newSessionIntervalSeconds: 5 };
  }

  /** Validate one timing selector into a stored record and next occurrence. */
  private scheduleTiming(timing: unknown, now: Date): { record: Omit<ScheduleRecordLike, "id" | "title" | "prompt">; scheduledAt: string } {
    if (typeof timing !== "object" || timing === null) throw new ScheduleInputError("invalid_rule", "timing is required");
    const value = timing as Record<string, unknown>;
    if (value.kind === "cron") {
      if (!isRecord(value.cron) || Object.keys(value.cron).sort().join(',') !== 'expression,time_zone') throw new ScheduleInputError('invalid_rule', 'cron must contain exactly expression and time_zone');
      const first = firstCronOccurrence(value.cron.expression, value.cron.time_zone, now);
      return { record: { kind: 'cron', ...first }, scheduledAt: first.scheduledAt };
    }
    if (value.kind === "rrule") {
      const first = firstRRuleOccurrence(value.rrule, now);
      return { record: { kind: "rrule", ...first }, scheduledAt: first.scheduledAt };
    }
    if (value.kind === "after") {
      const seconds = value.after_seconds;
      if (typeof seconds !== "number" || !Number.isSafeInteger(seconds) || seconds < 1) throw new ScheduleInputError("invalid_rule", "after_seconds must be a positive integer");
      return { record: { kind: "after", afterSeconds: seconds, scheduledAt: new Date(now.getTime() + seconds * 1000).toISOString() }, scheduledAt: new Date(now.getTime() + seconds * 1000).toISOString() };
    }
    if (value.kind === "at") {
      if (typeof value.at !== "string") throw new ScheduleInputError("invalid_rule", "at must be an RFC 3339 string");
      const at = new Date(value.at);
      if (Number.isNaN(at.getTime())) throw new ScheduleInputError("invalid_rule", "at is not a valid instant");
      if (at.getTime() <= now.getTime()) throw new ScheduleInputError("invalid_rule", "at must be in the future");
      return { record: { kind: "at", scheduledAt: at.toISOString() }, scheduledAt: at.toISOString() };
    }
    if (value.kind === "daily") {
      if (!isRecord(value.daily)) throw new ScheduleInputError("invalid_rule", "daily is required");
      let time: ReturnType<typeof parseLocalTime>;
      let zone: string;
      try {
        time = parseLocalTime(String(value.daily.time));
        zone = requireTimeZone(String(value.daily.time_zone));
      } catch (error) {
        throw new ScheduleInputError("invalid_rule", error instanceof Error ? error.message : "invalid daily timing");
      }
      const next = nextDailyOccurrence(now, time, zone);
      const normalized = `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}:${String(time.second).padStart(2, "0")}.${String(time.millisecond).padStart(3, "0")}`;
      return { record: { kind: "daily", time: normalized, timeZone: zone, scheduledAt: next.toISOString() }, scheduledAt: next.toISOString() };
    }
    if (value.kind === "weekly") {
      if (!isRecord(value.weekly)) throw new ScheduleInputError("invalid_rule", "weekly is required");
      let time: ReturnType<typeof parseLocalTime>;
      let zone: string;
      try {
        time = parseLocalTime(String(value.weekly.time));
        zone = requireTimeZone(String(value.weekly.time_zone));
      } catch (error) {
        throw new ScheduleInputError("invalid_rule", error instanceof Error ? error.message : "invalid weekly timing");
      }
      const weekdays = Array.isArray(value.weekly.weekdays) ? value.weekly.weekdays.map(Number) : [];
      let next: Date;
      try {
        next = nextWeeklyOccurrence(now, time, zone, weekdays);
      } catch (error) {
        throw new ScheduleInputError("invalid_rule", error instanceof Error ? error.message : "invalid weekly timing");
      }
      const normalized = `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}:${String(time.second).padStart(2, "0")}.${String(time.millisecond).padStart(3, "0")}`;
      return { record: { kind: "weekly", time: normalized, timeZone: zone, weekdays: [...new Set(weekdays)].sort((left, right) => left - right), scheduledAt: next.toISOString() }, scheduledAt: next.toISOString() };
    }
    if (value.kind === "every") {
      const seconds = value.every_seconds;
      if (typeof seconds !== "number" || !Number.isSafeInteger(seconds) || seconds < 60) throw new ScheduleInputError("invalid_rule", "every_seconds must be an integer of at least 60");
      return { record: { kind: "every", everySeconds: seconds, scheduledAt: new Date(now.getTime() + seconds * 1000).toISOString() }, scheduledAt: new Date(now.getTime() + seconds * 1000).toISOString() };
    }
    throw new ScheduleInputError("invalid_rule", `unsupported schedule timing: ${String(value.kind)}`);
  }

  /** Validate one target selector. */
  private scheduleTarget(target: unknown): ScheduleTargetLike {
    if (target === undefined) return { kind: "new_once", sessionId: crypto.randomUUID(), create: {} };
    if (typeof target !== "object" || target === null) throw new ScheduleInputError("invalid_target", "target is invalid");
    const value = target as Record<string, unknown>;
    if (value.kind === "session") {
      if (typeof value.sessionId !== "string" || value.sessionId === "") throw new ScheduleInputError("invalid_target", "session target requires sessionId");
      return { kind: "session", sessionId: value.sessionId };
    }
    if (value.kind === "new_once") return { kind: "new_once", sessionId: crypto.randomUUID(), create: isRecord(value.create) ? value.create : {} };
    if (value.kind === "new") return { kind: "new", create: isRecord(value.create) ? value.create : {} };
    throw new ScheduleInputError("invalid_target", "unsupported schedule target");
  }

  private requireSchedules(): ScheduleStore {
    if (this.schedules === undefined) throw new Error("schedule storage is not configured");
    return this.schedules;
  }

  /** Create one durable Host task. */
  scheduleCreate(input: { request: Record<string, unknown> }): ScheduleEntry {
    const request = input.request;
    const title = typeof request.title === "string" ? request.title.trim() : "";
    const prompt = typeof request.prompt === "string" ? request.prompt.trim() : "";
    if (title === "" || title.length > 120) throw new ScheduleInputError("invalid_prompt", "title must contain 1-120 characters");
    if (prompt === "") throw new ScheduleInputError("invalid_prompt", "prompt is required");
    const now = new Date();
    const timing = this.scheduleTiming(request.timing, now);
    const target = this.scheduleTarget(request.target);
    const id = `schedule-${crypto.randomUUID()}`;
    const record: ScheduleRecordLike = { id, title, prompt, ...timing.record };
    return this.requireSchedules().create({
      record,
      target,
      involvedSessionIds: target.kind === "session" ? [target.sessionId] : [],
      createdAt: now.toISOString(),
    });
  }

  /** Official Host-wide task list. */
  scheduleList(input: { active?: boolean; limit?: number; offset?: number } = {}): { items: ScheduleEntry[]; shown: number; total: number; limit: number; offset: number } {
    const page = this.requireSchedules().list(input);
    return { items: page.items, shown: page.items.length, total: page.total, limit: page.limit, offset: page.offset };
  }

  /** Official Host-wide task catalog. */
  scheduleCatalog(): ScheduleEntry[] {
    return this.requireSchedules().list({ limit: 500 }).items;
  }

  /** Official task read. */
  scheduleView(input: { id: string }): ScheduleEntry | { id: string; code: "schedule_not_found" } {
    return this.requireSchedules().view(input.id) ?? { id: input.id, code: "schedule_not_found" };
  }

  /** Official saved-delivery history page. */
  scheduleHistory(input: { id: string; limit: number; before?: string }): unknown {
    return this.requireSchedules().history(input);
  }

  /** Official edit/delete action. */
  scheduleEdit(input: { id: string; action: "update" | "delete"; patch?: Record<string, unknown>; expectedUpdatedAt?: string | null }): unknown {
    const store = this.requireSchedules();
    const current = store.view(input.id);
    if (input.action === "delete" || current === undefined) return store.edit(input);
    const patch = input.patch ?? {};
    const now = new Date();
    const timing = patch.timing !== undefined ? this.scheduleTiming(patch.timing, now).record
      : patch.active === true && current.kind === "cron" ? { kind: "cron", ...firstCronOccurrence(current.expression, current.timeZone, now) }
      : patch.active === true && current.kind === "rrule" ? { kind: "rrule", ...firstRRuleOccurrence(current.rrule, now) } : undefined;
    const title = typeof patch.title === "string" ? patch.title.trim() : current.title;
    const prompt = typeof patch.prompt === "string" ? patch.prompt.trim() : current.prompt;
    if (title === "" || title.length > 120 || prompt === "") throw new ScheduleInputError("invalid_prompt", "task title and prompt must be non-empty");
    const record = timing === undefined ? { ...current, title, prompt } : { id: current.id, title, prompt, ...timing };
    const target = patch.target === undefined ? undefined : this.scheduleTarget(patch.target);
    return store.edit({ ...input, record, ...(target === undefined ? {} : { target }) });
  }

  /** Official bulk removal of ended/paused tasks. */
  scheduleDeleteInactive(): { deleted: number } {
    return { deleted: this.requireSchedules().deleteInactive() };
  }

  /** Deliver one stored task now (manual run or alarm due path). */
  private async deliverSchedule(entry: ScheduleEntry, now: Date, manual = false): Promise<{ submissionId?: string; sessionId: string; entry?: ScheduleEntry }> {
    const store = this.requireSchedules();
    let target = entry.target;
    let sessionId: string;
    if (target.kind === "new") {
      const created = await this.create({ title: entry.title });
      sessionId = created.sessionId;
    } else if (target.kind === "new_once") {
      try { await this.requireSession(target.sessionId); } catch { await this.create({ sessionId: target.sessionId, title: entry.title }); }
      sessionId = target.sessionId;
      target = { kind: "session", sessionId };
    } else {
      sessionId = target.sessionId;
    }
    try {
      if ((await this.requireSession(sessionId)).archived) throw new Error("session archived");
    } catch {
      const ended = store.deliver(entry.id, {
        scheduledAt: entry.scheduledAt,
        deliveredAt: now.toISOString(),
        messageId: `schedule-undeliverable-${entry.id}`,
        targetSessionId: sessionId,
      }, { target, status: "ended" });
      return { sessionId, entry: ended };
    }
    const recurrence = manual ? undefined : entry.kind === 'cron' ? officialCron(entry.expression, entry.timeZone).resolve(entry.scheduledAt, now.getTime())
      : entry.kind === "rrule" ? officialRRule(entry.rrule).resolve(entry.scheduledAt, now.getTime()) : undefined;
    const occurrenceAt = recurrence?.occurrenceAt ?? entry.scheduledAt;
    const delivery = await this.prompt({ sessionId, text: entry.prompt, requestId: `schedule:${entry.id}:${manual ? `manual:${crypto.randomUUID()}` : occurrenceAt}` });
    const deliveredAt = now.toISOString();
    let nextScheduledAt: string | undefined;
    if (manual) nextScheduledAt = entry.scheduledAt;
    else if (entry.kind === "rrule" || entry.kind === "cron") nextScheduledAt = recurrence?.nextScheduledAt;
    else if (entry.kind === "every") nextScheduledAt = nextEvery(entry.scheduledAt, entry.everySeconds ?? 60, now);
    else if (entry.kind === "daily" && entry.time !== undefined && entry.timeZone !== undefined) {
      try { nextScheduledAt = nextDailyOccurrence(now, parseLocalTime(entry.time), entry.timeZone).toISOString(); } catch { nextScheduledAt = undefined; }
    } else if (entry.kind === "weekly" && entry.time !== undefined && entry.timeZone !== undefined) {
      try { nextScheduledAt = nextWeeklyOccurrence(now, parseLocalTime(entry.time), entry.timeZone, entry.weekdays ?? []).toISOString(); } catch { nextScheduledAt = undefined; }
    }
    const record: ScheduleRecordLike = { ...entry, ...(nextScheduledAt === undefined ? {} : { scheduledAt: nextScheduledAt }) };
    const status = manual ? entry.status : nextScheduledAt === undefined ? "ended" : "active";
    const next = store.deliver(entry.id, {
      scheduledAt: manual ? now.toISOString() : occurrenceAt,
      deliveredAt,
      messageId: delivery.submissionId,
      targetSessionId: sessionId,
      prompt: entry.prompt,
    }, { record, target, status });
    return { submissionId: delivery.submissionId, sessionId, entry: next };
  }

  /** Alarm driver: deliver every due task and report the next occurrence. */
  async processDueSchedules(nowIso: string): Promise<{ delivered: number; nextDueAt?: string }> {
    if (this.schedules === undefined) return { delivered: 0 };
    const now = new Date(nowIso);
    let delivered = 0;
    for (const entry of this.schedules.due(nowIso)) {
      try { await this.deliverSchedule(entry, now); delivered += 1; } catch { /* one bad task must not stop the scheduler */ }
    }
    const next = this.schedules.nextDueAt();
    return { delivered, ...(next === undefined ? {} : { nextDueAt: next }) };
  }

  /** Manual `schedule/run`: deliver a task immediately. */
  async scheduleRun(input: { id: string }): Promise<ScheduleEntry | { id: string; code: "schedule_not_found" }> {
    const entry = this.requireSchedules().view(input.id);
    if (entry === undefined) return { id: input.id, code: "schedule_not_found" };
    const result = await this.deliverSchedule(entry, new Date(), true);
    return result.entry ?? this.requireSchedules().view(input.id)!;
  }

  /** Follow committed journal changes without polling. */
  async *follow(input: {
    address: { kind: "session"; sessionId: string } | { kind: "subagent"; childSessionId: string };
    signal: AbortSignal;
  }): AsyncIterable<SessionHostEvent> {
    const sessionId = input.address.kind === "session" ? input.address.sessionId : input.address.childSessionId;
    await this.requireSession(sessionId);
    let after = 0;
    for await (const _change of this.changes.subscribe(input.signal)) {
      let events;
      do {
        events = await this.storage.listEvents(sessionId, after, 50);
        for (const event of events) { after = event.seq; yield event; }
      } while (events.length === 50 && !input.signal.aborted);
    }
  }

  /** Fork the exact official event prefix and close its open tail with the pinned official algorithm. */
  async fork(input: { sessionId: string; atSeq?: number; messageId?: string; assistantStep?: number; sessionIdNew?: string }): Promise<{ sessionId: string }> {
    const snapshot = await this.transcriptSnapshot(input.sessionId);
    const source = snapshot.session;
    const raw = await this.storage.getProjections(source.sessionId);
    if (input.assistantStep !== undefined && input.messageId === undefined) throw new SessionRpcFault("gateway/bad-request", "assistantStep requires a message boundary", {});
    const prepared = prepareFork({ ...input, records: snapshot.records, turns: turnStates(snapshot), forkSeed: raw._dshBaseForkSeed as SessionForkSeed | undefined });
    const copied = prepared.messages;
    const sessionId = input.sessionIdNew ?? crypto.randomUUID();
    const now = Date.now();
    const target: SessionRecord = { ...source, sessionId, title: `${source.title} (fork)`, running: false,
      blank: copied.length === 0, archived: false, createdAt: now, updatedAt: now };
    // Usage/latency accumulated after a cursor cannot be assigned to its prefix.
    // New execution starts fresh accounting; the inherited journal owns history.
    const { usage: _usage, tokenUsage: _tokens, contextPressure: _pressure, contextBreakdown: _breakdown,
      sessionStats: _stats, _dshBaseAppliedExecutions: _executions, _dshBasePermissionCommands: _commandReceipts,
      _dshBaseInputConfigs: _inputConfigs, _dshBaseModelRequest: _modelRequest, _dshBaseExecutionSteps: _stepEvidence,
      _dshBaseApprovalNotices: _approvalNotices,
      _dshBaseSubmissionId: _submission, _dshBaseProjectionRevision: _revision, ...inherited } = raw;
    const sourcePart = copied.findLast(row => row.role === 'assistant')?.parts.findLast(part => typeof part === 'object' && part !== null && (part as { type?: unknown }).type === 'data-dsh-model-source') as { data?: { provider?: string; model?: string; requestedModel?: string; reasoningEffort?: string } } | undefined;
    const known = sourcePart?.data;
    const requestedModel = known?.requestedModel ?? (known?.model === 'deepseek-flash' || known?.model === 'deepseek-v4-pro' ? known.model : undefined);
    const projections = { ...inherited, ...withExecutionStatistics({_dshBaseForkSeed:prepared.seed}, copied),
      modelSelection: { lastUsed: known?.provider && requestedModel ? { provider: known.provider, model: requestedModel, ...(known.reasoningEffort === undefined ? {} : { reasoningEffort: known.reasoningEffort }) } : null,
        next: source.model ? { provider: providerForModelId(source.model), model: source.model, ...(source.reasoningEffort === undefined ? {} : { reasoningEffort: source.reasoningEffort }) } : null },
      _dshBaseInheritedTurns: prepared.turns, _dshBaseForkSeed: prepared.seed };
    if (this.storage.forkSession) await this.storage.forkSession(source.sessionId, target, copied, projections);
    else {
      if (await this.storage.getSession(sessionId)) throw new SessionRpcFault("gateway/bad-request", "Fork target Session already exists", {});
      if (copied.some(message => message.parts.some(part => typeof part === "object" && part !== null && (part as { type?: unknown }).type === "file"))) throw uploadError("Atomic file fork is unavailable", "STORAGE_UNAVAILABLE");
      await this.storage.putSession(target);
      await this.storage.appendMessages(sessionId, copied);
      await this.storage.putProjections(sessionId, projections);
    }
    return { sessionId };
  }

  /** The configured workspace file store, or the `unavailable` failure when absent. */
  private requireFileStore(): WorkspaceFileStore {
    if (this.files === undefined) {
      throw new WorkspaceFileError("workspace-file/unavailable", "workspace file storage is not configured (FILES R2 binding missing)");
    }
    return this.files;
  }

  /** Resolve one Session's Workspace root and validate the file store is present. */
  private async workspaceFileContext(sessionId: string): Promise<{ store: WorkspaceFileStore; scope: WorkspaceFileScope }> {
    const store = this.requireFileStore();
    await this.requireSession(sessionId);
    const data = await this.workspaceData();
    const membership = data.bySession.get(sessionId);
    const workspace = membership === undefined
      ? undefined
      : data.workspaces.find((item) => item.workspaceId === membership.workspaceId);
    const fallback = workspace ?? data.workspaces.find((item) => item.workspaceId === DEFAULT_WORKSPACE_ID) ?? data.workspaces[0];
    return {
      store,
      scope: {
        workspaceId: fallback?.workspaceId ?? DEFAULT_WORKSPACE_ID,
        root: fallback?.path ?? DEFAULT_WORKSPACE_PATH,
      },
    };
  }

  private async requireSession(sessionId: string): Promise<SessionRecord> {
    const record = await this.storage.getSession(sessionId);
    if (record === undefined) throw new Error(`session not found: ${sessionId}`);
    return record;
  }
}
