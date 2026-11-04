import { eventStreamResponse } from './event-stream.ts';
import { handleUploadHttp } from "./upload-http.ts";
import { UploadStore } from "./uploads.ts";
/** Durable Object entry for the Workers-native Session Host HTTP API. */
import { getAgentByName } from "agents";
import type { SessionModelOption } from "./contract.ts";
import { createDurableObjectSessionHost, type DurableObjectSql } from "./durable-object.ts";
import { dispatchSessionHost, type SessionHostRequest } from "./service.ts";
import type { SessionHost, ApprovalContinuation } from "./host.ts";
import { agentName, ownerIdOf } from "./agent-name.ts";
import { WorkspaceFileStore, type R2BucketLike } from "./workspace-files.ts";
import { SettingsStore } from "./settings-store.ts";
import { CredentialStore } from "./credential-store.ts";
import { DEPLOYMENT_MODELS, type DeploymentModel } from "./model-catalog.ts";
import { bareModelId, deepseekModelId, gatewayModelId, isDeepSeekModelId, isGatewayModelId } from "../../../boot/dsh-base-session-wire/src/model-routes.ts";
import { ScheduleStore } from "./schedule-store.ts";
import { MaintenanceJobStore } from "./maintenance-jobs.ts";
import { commitMigration, dumpMigrationTables, migrationStatus } from "./migration.ts";
import type { SqlStorage } from "./sqlite-storage.ts";
import { SessionRpcFault } from "./remote-contract.ts";
import { countAssistantSteps, type ExecutionStatistics } from "./execution-stats.ts";
import { HostChangeFeed, observeHostWrites, invalidationResponse } from "./change-feed.ts";
import { projectModelSteps } from './step-projection.ts';
import { createPermissionRuntime } from '@dsh-base/cloudflare-worker-permissions/runtime';
import { PermissionStore } from './permissions-store.ts';

/** Structural subset of the Durable Object state used by this Host. */
export interface SessionHostObjectState {
  readonly storage: {
    readonly sql: DurableObjectSql;
    /** Present in the Workers runtime; test doubles may omit it. */
    readonly transactionSync?: <T>(operation: () => T) => T;
    /** Present in the Workers runtime; schedules the claim alarm. */
    setAlarm?(scheduledTime: number): Promise<void>;
  };
  /** Present in the Workers runtime; test doubles may omit it. */
  readonly id?: { readonly name?: string };
}

/** Bindings available to the Session Host Durable Object. */
export interface SessionHostObjectEnv {
  readonly SESSION_HOST?: { idFromName(name: string): unknown; get(id: unknown): { fetch(request: Request): Promise<Response> } };
  readonly WORKER_VERSION?: { readonly id: string };
  readonly AI_GATEWAY_ID?: string;
  readonly PLATFORM_AI_ENABLED?: string;
  /** Think agent namespace used to run claimed prompts. */
  readonly DshAgent?: Parameters<typeof getAgentByName>[0];
  /** Owner-scoped plugin control record used to project Think selections before each claim. */
  readonly PluginControl?: { idFromName(name: string): unknown; get(id: unknown): { fetch(request: Request): Promise<Response> } };
  /** R2 bucket holding real workspace file content bytes. */
  readonly FILES?: R2BucketLike;
  readonly CREDENTIALS_KEY?: string;
}

interface ThinkAgentRpc {
  ensureHistory(messages: readonly unknown[]): Promise<number>;
  cancelInput(requestId: string): Promise<void>;
  setModel(modelId: string): Promise<{ selected: string; contextWindow: number }>;
  setUserCredential(value: string | null): Promise<{ configured: boolean }>;
  setDeepSeekBaseURL(value: string | null): Promise<{ configured: boolean }>;
  freezeExecutionModel?(requestId: string, model: string): Promise<{ model: string }>;
  setThinkPlugins?(input: { disabled?: readonly string[]; config?: Record<string, unknown> }): Promise<{ disabled: string[] }>;
  uploadAttachment(input: { name: string; mediaType: string; dataBase64: string }): Promise<{
    id: string;
    name: string;
    mediaType: string;
    size: number;
  }>;
  admitInput(input: {
    executionConfig?: {model: string; reasoningEffort?: 'off'|'low'|'high'|'max'};
    requestId: string;
    text: string;
    attachments?: readonly { id: string; name: string; mediaType: string; size: number }[];
    uploadedFiles?: readonly { receiptId: string; file: { attachmentId: string; name: string; bytes: number } }[];
  }): Promise<{ submissionId: string; status?: string }>;
  waitForSubmission(submissionId: string): Promise<{ status: string; error?: string } | null>;
  takeTurnStats(): Promise<{ turns: number; steps: number; llmMs: number; ttftMs: number; ttftSteps: number; decodeMs: number; decodeTokens: number; contextBreakdown?: { systemTokens: number; toolsTokens: number } }>;
  getLiveAttempt(): Promise<{ attemptId: string; turn: number; step: number; revision: number; chunks: ReadonlyArray<{ type: string; index: number; text: string }> } | undefined>;
  getMessages(): Promise<Array<{
    id: string;
    role: string;
    parts: readonly unknown[];
    readonly metadata?: { readonly dshContext?: unknown; readonly usage?: Record<string, number> } & Record<string, unknown>;
  }>>;
  /** Durable-pause and codemode approvals awaiting a human decision. */
  pendingApprovals(): Promise<Array<{
    executionId: string;
    source: "action" | "codemode";
    descriptor: {
      toolCallId?: string;
      action: string;
      summary: string;
      risk?: "low" | "medium" | "high";
    };
  }>>;
  approveExecution(executionId: string): Promise<unknown>;
  rejectExecution(executionId: string): Promise<unknown>;
  beginInputContinuation(requestId: string, approvalId: string, userMessageId?: string): Promise<{ status: string; error?: string }>;
  getInputExecution(requestId: string): Promise<{ status: string; sdkRequestId?: string; error?: string } | undefined>;
  getExecutionStats(sdkRequestId: string): Promise<ExecutionStatistics | undefined>;
  resolveToolApproval(input: { requestId: string; userMessageId?: string; toolCallId: string; approved: boolean }): Promise<{ resolved: boolean; status?: string; error?: string }>;
  setUserCredential(value: string | null): { configured: boolean };
  systemPromptDebug(): Promise<{ text: string; error?: string; waterfallRuns: number; context: Array<{ id: string; kind: string; text: string }>; contextInjectionError?: string; tools: string[]; workspaceInstructionsLength: number; lastRefreshError?: string; workspaceReadLog?: Array<{ path: string; ok: boolean; bytes?: number; error?: string }> }>;
}

const PATH = "/api/session-host";


function catalogFor(platformEnabled: boolean, ownerAvailable: boolean, deepseekModels: readonly DeploymentModel[] = DEPLOYMENT_MODELS): readonly DeploymentModel[] {
  return [
    ...ownerAvailable ? deepseekModels.map(model => ({ ...model, id: deepseekModelId(model.id) })) : [],
    ...platformEnabled ? DEPLOYMENT_MODELS.map(model => ({ ...model, id: gatewayModelId(model.id) })) : [],
  ];
}

/** Read the owner-selected DeepSeek catalog from the settings section. */
function deepseekModelsFromSettings(values: Record<string, Record<string, unknown>> | undefined): readonly DeploymentModel[] {
  const raw = values?.["llm-deepseek"]?.models;
  // Missing means the schema default; an explicit empty/invalid array is a real
  // empty owner directory and must not silently restore the deployment models.
  if (raw === undefined) return DEPLOYMENT_MODELS;
  if (!Array.isArray(raw)) return [];
  const models = raw.flatMap((entry): DeploymentModel[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const { id, name, contextWindow } = entry as { id?: unknown; name?: unknown; contextWindow?: unknown };
    return typeof id === "string" && id !== ""
      ? [{ id, label: typeof name === "string" && name !== "" ? name : id, contextWindow: typeof contextWindow === "number" ? contextWindow : 1_048_576 }]
      : [];
  });
  return models;
}

function deepseekCredentialRef(values: Record<string, Record<string, unknown>> | undefined): string {
  const ref = values?.["llm-deepseek"]?.apiKeyEnv;
  return typeof ref === "string" && ref !== "" ? ref : "DEEPSEEK_OFFICIAL_API_KEY";
}

function json(value: unknown, status = 200): Response {
  // JSON drops undefined properties. A completed void RPC must still carry its
  // explicit acknowledgement; never manufacture a result for an empty object.
  const body = typeof value === "object" && value !== null && Object.hasOwn(value, "result")
    && (value as { result?: unknown }).result === undefined
    ? { ...value, result: null } : value;
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}


/** Owner id used by local test objects without an owner name. */
const LOCAL_OWNER_ID = "local";

/** Durable Object Host: contract dispatch over its SQLite storage. */
export class SessionHostObject {
  private readonly changes = new HostChangeFeed();
  private readonly state: SessionHostObjectState;
  private readonly env: SessionHostObjectEnv | undefined;
  private readonly livePushes = new Map<string, unknown>();
  private readonly claims = new Map<string, { submissionId: string; result: Promise<Response> }>();
  /** Better Auth owner encoded in the stable `owner:<userId>:default-v49` storage name. */
  private readonly ownerId: string | undefined;
  /** R2-backed workspace file store; absent without the `FILES` binding. */
  private readonly files: WorkspaceFileStore | undefined;
  /** AES-GCM store; missing keys disable writes and reject reads of stored secrets. */
  private readonly credentials: CredentialStore | undefined;
  /** Durable Host task store and alarm engine source. */
  private readonly schedules: ScheduleStore;
  /** Durable interval registrations for maintenance callbacks. */
  private readonly jobs: MaintenanceJobStore;
  private readonly uploads: UploadStore;
  private permissionStore: Promise<PermissionStore> | undefined;

  constructor(state: SessionHostObjectState, env?: SessionHostObjectEnv) {
    const originalState = state;
    const observed = observeHostWrites({
      exec: (query, ...bindings) => originalState.storage.sql.exec(query, ...bindings),
      ...(state.storage.transactionSync === undefined ? {} : { transactionSync: <T>(operation: () => T) => originalState.storage.transactionSync!(operation) }),
    }, this.changes);
    state = { id: originalState.id, storage: {
      sql: observed,
      ...(observed.transactionSync === undefined ? {} : { transactionSync: observed.transactionSync }),
      ...(originalState.storage.setAlarm === undefined ? {} : { setAlarm: (time: number) => originalState.storage.setAlarm!(time) }),
    } };
    this.state = state;
    this.env = env;
    this.ownerId = ownerIdOf(state.id?.name);
    const bucket = env?.FILES;
    this.files = bucket === undefined
      ? undefined
      : new WorkspaceFileStore(
        { exec: (query, ...bindings) => state.storage.sql.exec(query, ...bindings) },
        bucket,
        this.ownerId ?? LOCAL_OWNER_ID,
      );
    this.credentials = new CredentialStore(
      { exec: (query, ...bindings) => state.storage.sql.exec(query, ...bindings) },
      env?.CREDENTIALS_KEY,
    );
    this.schedules = new ScheduleStore({ exec: (query, ...bindings) => state.storage.sql.exec(query, ...bindings) });
    this.uploads = new UploadStore({ exec: (query, ...bindings) => state.storage.sql.exec(query, ...bindings) }, bucket, this.ownerId ?? LOCAL_OWNER_ID);
    this.jobs = new MaintenanceJobStore({ exec: (query, ...bindings) => state.storage.sql.exec(query, ...bindings) });
    this.state.storage.sql.exec("CREATE TABLE IF NOT EXISTS dsh_session_host_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    // Maintenance registrations are seeded lazily by maintenanceList/Run and
    // by the alarm; keeping the constructor free of async seeding means a bad
    // maintenance callback can never make the whole owner unreachable.
  }

  /** Hide model-visible context snapshots from the Host transcript UI. */
  private visibleMessages<T extends { readonly id: string; readonly role: string; readonly parts: readonly unknown[]; readonly metadata?: { readonly dshContext?: unknown; readonly dshModelSource?: unknown } }>(messages: readonly T[]): T[] {
    return projectModelSteps(messages.filter((message) => message.metadata?.dshContext !== true)).map(message => {
      if (message.parts.some(part => typeof part === 'object' && part !== null && (part as {type?: string}).type === 'data-dsh-step')) return message;
      const source = message.metadata?.dshModelSource as { provider?: unknown; model?: unknown } | undefined;
      if (message.role !== "assistant" || typeof source?.provider !== "string" || typeof source.model !== "string") return message;
      return { ...message, parts: [...message.parts.filter(part => typeof part !== "object" || part === null || (part as { type?: unknown }).type !== "data-dsh-model-source"),
        { type: "data-dsh-model-source", data: { ...source } }] };
    });
  }

  /** Agent Durable Object name owned by this Host's account. */
  private agentFor(sessionId: string): string {
    return agentName(this.ownerId, sessionId);
  }

  /** Session Host over this Durable Object's SQLite and synchronous transactions. */
  private host(): ReturnType<typeof createDurableObjectSessionHost> {
    return createDurableObjectSessionHost(
      this.state.storage.sql,
      [
        ...(this.env?.PLATFORM_AI_ENABLED === "true" && Boolean(this.env.AI_GATEWAY_ID?.trim()) ? DEPLOYMENT_MODELS.map(model => ({ ...model, id: gatewayModelId(model.id) })) : []),
        ...DEPLOYMENT_MODELS.map(model => ({ ...model, id: deepseekModelId(model.id) })),
      ],
      this.state.storage.transactionSync === undefined
        ? undefined
        : <T>(operation: () => T): T => this.state.storage.transactionSync!(operation),
      this.files,
      new SettingsStore({ exec: (query, ...bindings) => this.state.storage.sql.exec(query, ...bindings) }),
      this.credentials,
      this.schedules,
      this.jobs,
      () => this.state.storage.setAlarm?.(Date.now() + 50),
      this.uploads,
      this.changes,
      () => this.permissionStore ??= createPermissionRuntime().then(runtime => {
        const sql = { exec: (query: string, ...bindings: unknown[]) => this.state.storage.sql.exec(query, ...bindings), transactionSync: this.state.storage.transactionSync };
        const settings = new SettingsStore(sql);
        return new PermissionStore(sql, runtime, () => {
          const preset = settings.read().values.permission?.defaultPreset;
          return typeof preset === 'string' ? preset : 'workspace-write';
        });
      }),
    );
  }

  /**
   * Drive queued submissions without a browser: a prompt only persists a
   * submission, so the alarm is what guarantees the turn still runs if the
   * composer tab closes before its fire-and-forget claim lands.
   */
  async alarm(): Promise<void> {
    const host = this.host();
    const nowIso = new Date().toISOString();
    // Ensure registrations then run due maintenance (cleanup/recovery), then
    // due Host tasks.
    host.ensureMaintenanceJobs();
    const maintenance = await host.runDueMaintenance(nowIso).catch(() => ({ ran: 0 }) as { ran: number; nextDueAtMs?: number });
    const scheduled = await host.processDueSchedules(nowIso).catch(() => ({ delivered: 0 }) as { delivered: 0; nextDueAt?: string });
    if (this.env?.DshAgent !== undefined) {
      const denied = (await host.policyDeniedApprovals())[0];
      if (denied !== undefined) {
        const result = await this.resolveApproval({...denied, decision:'rejected'});
        if (!result.ok) console.error('dsh-base policy denial recovery failed', result.status);
      }
    }
    const queued = await host.queuedSubmissions();
    const next = this.env?.DshAgent === undefined ? undefined : queued[0];
    if (next !== undefined) {
      try {
        const response = await this.fetch(new Request(`https://session-host${PATH}/claim`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId: next.sessionId, submissionId: next.submissionId }),
        }));
        if (!response.ok) console.error("dsh-base session-host: alarm claim failed", await response.text().catch(() => ""));
      } catch (error) {
        console.error("dsh-base session-host: alarm claim failed", error);
      }
    }
    const remaining = await host.queuedSubmissions().catch(() => []);
    const candidateAt = [
      remaining.length > 0 && this.env?.DshAgent !== undefined ? Date.now() + 3_000 : undefined,
      scheduled.nextDueAt === undefined ? undefined : Date.parse(scheduled.nextDueAt),
      maintenance.nextDueAtMs,
      this.env?.DshAgent !== undefined && (await host.policyDeniedApprovals()).length > 0 ? Date.now() + 50 : undefined,
    ].filter((value): value is number => value !== undefined && Number.isFinite(value));
    if (candidateAt.length > 0) {
      await this.state.storage.setAlarm?.(Math.max(Math.min(...candidateAt), Date.now() + 50));
    }
  }

  /** Serialize transcript commits for one session; a restarted owner resumes by request id. */
  private async claim(sessionId: string, submissionId: string): Promise<Response> {
    while (this.claims.has(sessionId)) {
      const active = this.claims.get(sessionId)!;
      const result = await active.result;
      if (active.submissionId === submissionId) return result.clone();
    }
    const result = this.executeClaim(sessionId, submissionId);
    this.claims.set(sessionId, { submissionId, result });
    try { return (await result).clone(); }
    finally { if (this.claims.get(sessionId)?.result === result) this.claims.delete(sessionId); }
  }

  /** Retried after archive or cancellation transport failure; tombstones win late admission. */
  private async stopSessionActivity(host: SessionHost, sessionId: string): Promise<void> {
    const requestIds = await host.activeRequestIds(sessionId);
    if (requestIds.length > 0) {
      if (this.env?.DshAgent === undefined) throw new Error("agent_binding_missing");
      const agent = await getAgentByName(this.env.DshAgent, this.agentFor(sessionId)) as unknown as ThinkAgentRpc;
      for (const requestId of requestIds) await agent.cancelInput(requestId);
    }
    await host.cancel({ sessionId });
  }

  /** Read settings without letting a broken DeepSeek key affect Gateway. */
  private async readSettingsValues(): Promise<Record<string, Record<string, unknown>> | undefined> {
    try { return (await this.host().settingsDescribe()).values; } catch { return undefined; }
  }

  private platformEnabled(): boolean {
    return this.env?.PLATFORM_AI_ENABLED === "true" && Boolean(this.env.AI_GATEWAY_ID?.trim());
  }

  private async readCredentialSafe(ref: string): Promise<{ value?: string; error?: unknown }> {
    if (this.credentials === undefined) return {};
    try {
      const value = await this.credentials.get(ref);
      return value === undefined || value === null ? {} : { value };
    } catch (error) { return { error }; }
  }

  /** Resolve and inject credential/provider settings before an input executes.
   * @returns the explicit provider/model identity frozen for this input.
   */
  private async configureAgentForModel(agent: ThinkAgentRpc, model: string): Promise<string> {
    const settings = await this.readSettingsValues();
    const ref = deepseekCredentialRef(settings);
    if (isGatewayModelId(model)) {
      // Explicit Gateway must not read or decrypt DeepSeek credentials.
      await agent.setUserCredential(null);
      if (typeof agent.setDeepSeekBaseURL === "function") await agent.setDeepSeekBaseURL(null);
      return model;
    }
    if (isDeepSeekModelId(model)) {
      const credential = await this.readCredentialSafe(ref);
      if (credential.error !== undefined) throw new Error(`DeepSeek credential could not be read: ${credential.error instanceof Error ? credential.error.message : String(credential.error)}`);
      if (credential.value === undefined) throw new Error("The explicit DeepSeek provider requires an owner API key; it never falls back to Cloudflare AI Gateway");
      await agent.setUserCredential(credential.value);
      const baseURL = settings?.["llm-deepseek"]?.baseURL;
      if (typeof agent.setDeepSeekBaseURL === "function") await agent.setDeepSeekBaseURL(typeof baseURL === "string" && baseURL.trim() !== "" ? baseURL : null);
      return model;
    }
    // Legacy frozen input with no provider identity: resolve once and freeze.
    // A read/decrypt error is NOT "unconfigured" and must never fall back.
    const credential = await this.readCredentialSafe(ref);
    if (credential.error !== undefined) throw new Error(`Legacy DeepSeek credential could not be read; refusing platform fallback: ${credential.error instanceof Error ? credential.error.message : String(credential.error)}`);
    const bare = bareModelId(model);
    if (credential.value !== undefined) {
      await agent.setUserCredential(credential.value);
      const baseURL = settings?.["llm-deepseek"]?.baseURL;
      if (typeof agent.setDeepSeekBaseURL === "function") await agent.setDeepSeekBaseURL(typeof baseURL === "string" && baseURL.trim() !== "" ? baseURL : null);
      return deepseekModelId(bare);
    }
    if (!this.platformEnabled()) throw new Error("The legacy selection requires the original DeepSeek key or platform Gateway; neither is available");
    await agent.setUserCredential(null);
    if (typeof agent.setDeepSeekBaseURL === "function") await agent.setDeepSeekBaseURL(null);
    return gatewayModelId(bare);
  }

  /** Read the owner control record and project optional Think tools before a turn/approval. */
  private async applyThinkPluginSelection(agent: ThinkAgentRpc, sessionId: string): Promise<string[]> {
    if (this.env?.PluginControl === undefined) return [];
    if (typeof agent.setThinkPlugins !== "function") return [];
    const owner = /^owner:(.+):default-v49$/u.exec(this.state.id?.name ?? "")?.[1];
    if (owner === undefined) throw new Error("plugin_owner_identity_unavailable");
    const id = this.env.PluginControl.idFromName(`owner:${owner}:plugins`);
    const response = await this.env.PluginControl.get(id).fetch(new Request(`https://plugin-control/api/plugin-manager?sessionId=${encodeURIComponent(sessionId)}`, { headers: { accept: "application/json" } }));
    if (!response.ok) throw new Error(`plugin_selection_unavailable:${response.status}`);
    const state = await response.json() as { overrides?: Record<string, { disabled?: boolean; config?: unknown }>; session?: Record<string, { disabled?: boolean; config?: unknown }> };
    const effective = (name: string) => state.session?.[name] ?? state.overrides?.[name];
    const disabled = ["@dsh-base/cloudflare-think-fetch", "@dsh-base/cloudflare-think-memory"].filter(name => effective(name)?.disabled === true).map(name => name.endsWith("-memory") ? "memory" : "fetch");
    await agent.setThinkPlugins({ disabled, config: { fetch: effective("@dsh-base/cloudflare-think-fetch")?.config ?? {} } });
    return disabled;
  }

  private async executeClaim(sessionId: string, submissionId: string): Promise<Response> {
    if (this.env?.DshAgent === undefined) return json({ error: "agent_binding_missing" }, 500);
    const host = this.host();
    // A durable recovery wake remains scheduled until the claim settles.
    await this.state.storage.setAlarm?.(Date.now() + 30_000);
    try {
      if ((await host.state({ sessionId })).archived) {
        await this.stopSessionActivity(host, sessionId);
        return json({ result: { submissionId, status: "cancelled", messages: 0 } });
      }
      const continuation = await host.approvalContinuation(sessionId, submissionId);
      if (continuation !== undefined) return this.executeApproval(continuation);
      await host.runSubmission({ sessionId, submissionId, resume: true }, async (submission) => {
        const agent = await getAgentByName(this.env!.DshAgent!, this.agentFor(sessionId)) as unknown as ThinkAgentRpc;
        void await this.applyThinkPluginSelection(agent, sessionId);
        await agent.ensureHistory(await host.executionHistory(sessionId));
        const executionConfig = await host.inputExecutionConfig(sessionId, submission.requestId);
        if (executionConfig === undefined) throw new Error("input_configuration_unavailable: no frozen model is available for this input");
        const resolvedModel = await this.configureAgentForModel(agent, executionConfig.model);
        if (resolvedModel !== executionConfig.model) await host.freezeInputModel(sessionId, submission.requestId, resolvedModel);
        // Every ordinary claim idempotently reconciles Think's durable ledger,
        // including recovery after Host freeze succeeded but the previous Think
        // RPC was interrupted. A missing first-time ledger is tolerated because
        // admitInput below creates it with the effective config.
        if (typeof agent.freezeExecutionModel === "function") {
          try { await agent.freezeExecutionModel(submission.requestId, resolvedModel) }
          catch (error) { if (!String(error).includes("input_configuration_unavailable")) throw error }
        }
        const effectiveExecutionConfig = { ...executionConfig, model: resolvedModel };
        const uploaded = [];
        const uploadedFiles = [];
        for (const reference of submission.attachments ?? []) {
          if (reference.receiptId && reference.file) { uploadedFiles.push({ receiptId: reference.receiptId, file: reference.file }); continue; }
          const stored = await host.attachment(reference.attachmentId);
          uploaded.push(await agent.uploadAttachment({
            name: stored.name,
            mediaType: stored.mediaType,
            dataBase64: stored.dataBase64,
          }));
        }
        const accepted = await agent.admitInput({
          requestId: submission.requestId,
          text: submission.text,
          ...(effectiveExecutionConfig.model === "" ? {} : { executionConfig: effectiveExecutionConfig }),
          ...(uploaded.length === 0 ? {} : { attachments: uploaded }),
          ...(uploadedFiles.length === 0 ? {} : { uploadedFiles }),
        });
        const inspection = accepted.status === "cancelled" ? { status: "cancelled" } : await agent.waitForSubmission(accepted.submissionId);
        if (inspection?.status === "error") {
          const failure = new Error(inspection.error ?? "agent turn failed");
          failure.name = "AgentExecutionFailed";
          throw failure;
        }
        if (inspection === null || inspection.status === "pending" || inspection.status === "running") throw new Error("agent execution has not completed");
        if (inspection.status === "cancelled" || inspection.status === "aborted" || inspection.status === "skipped") await host.cancel({ sessionId });
        const messages = this.visibleMessages(await agent.getMessages());
        const turnStats = await agent.takeTurnStats();
        const admittedAt = messages.findIndex((message) => message.id === submission.requestId);
        const turnMessages = admittedAt < 0 ? [] : messages.slice(admittedAt + 1);
        const usage = [...turnMessages].reverse().find((message) => message.role === "assistant" && message.metadata?.usage !== undefined)?.metadata?.usage;
        const previous = await host.projections({ sessionId }) as {
          _dshBaseSubmissionId?: string;
          tokenUsage?: { uncachedInputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; outputTokens?: number };
          sessionStats?: { turns?: number; steps?: number; llmMs?: number; toolMs?: number; ttftMs?: number; ttftSteps?: number; decodeMs?: number; decodeTokens?: number };
        };
        if (previous._dshBaseSubmissionId === submission.submissionId) {
          return { messages: messages.map((message) => ({ id: message.id, role: message.role, parts: message.parts })), projections: previous };
        }
        const priorUsage = previous.tokenUsage;
        const tokenUsage = usage === undefined ? priorUsage : {
          uncachedInputTokens: (priorUsage?.uncachedInputTokens ?? 0) + Math.max(0, usage.inputTokens - usage.cacheReadTokens - usage.cacheWriteTokens),
          cacheReadTokens: (priorUsage?.cacheReadTokens ?? 0) + usage.cacheReadTokens,
          cacheWriteTokens: (priorUsage?.cacheWriteTokens ?? 0) + usage.cacheWriteTokens,
          outputTokens: (priorUsage?.outputTokens ?? 0) + usage.outputTokens,
        };
        const stats = previous.sessionStats;
        const sessionStats = {
          turns: messages.filter((message) => message.role === "user").length,
          steps: countAssistantSteps(messages),
          llmMs: (stats?.llmMs ?? 0) + turnStats.llmMs,
          toolMs: stats?.toolMs ?? 0,
          ttftMs: (stats?.ttftMs ?? 0) + turnStats.ttftMs,
          ttftSteps: (stats?.ttftSteps ?? 0) + turnStats.ttftSteps,
          decodeMs: (stats?.decodeMs ?? 0) + turnStats.decodeMs,
          decodeTokens: (stats?.decodeTokens ?? 0) + turnStats.decodeTokens,
        };
        const contextBreakdown = turnStats.contextBreakdown === undefined ? undefined : {
          systemTokens: turnStats.contextBreakdown.systemTokens,
          toolsTokens: turnStats.contextBreakdown.toolsTokens,
          messageTokens: Math.max(0, (usage?.inputTokens ?? 0) - turnStats.contextBreakdown.systemTokens - turnStats.contextBreakdown.toolsTokens),
        };
        return {
          messages: messages.map((message) => ({ id: message.id, role: message.role, parts: message.parts })),
          projections: {
            _dshBaseSubmissionId: submission.submissionId,
            ...(usage === undefined ? {} : { usage }),
            ...(tokenUsage === undefined ? {} : { tokenUsage }),
            sessionStats,
            ...(contextBreakdown === undefined ? {} : { contextBreakdown }),
          },
        };
      });
    } catch (error) {
      // The alarm may have already claimed this submission; a duplicate claim
      // is a successful observation of the current Host state.
      if (error instanceof Error && error.message.startsWith("submission is not queued")) {
        return json(await host.state({ sessionId }));
      }
      console.error("dsh-base session-host: claim failed", error);
      return json({ error: "claim_failed", message: "claim failed" }, 500);
    }
    return json(await host.state({ sessionId }));
  }

  /** A human decision and automatic recovery share the same per-Session writer. */
  private async resolveApproval(input: { sessionId: string; toolCallId?: string; executionId?: string; decision: "approved" | "rejected" }): Promise<Response> {
    const key = `approval:${input.toolCallId ?? input.executionId}:${input.decision}`;
    while (this.claims.has(input.sessionId)) {
      const active = this.claims.get(input.sessionId)!;
      const result = await active.result;
      if (active.submissionId === key) return result.clone();
    }
    const result = (async () => {
      try {
        if (!this.env?.DshAgent) return json({ error: "agent_binding_missing" }, 503);
        const host = this.host();
        if ((await host.permissionSnapshot({sessionId:input.sessionId})).approval === 'never') input = {...input,decision:'rejected'};
        const agent = await getAgentByName(this.env.DshAgent, this.agentFor(input.sessionId)) as unknown as ThinkAgentRpc;
        // The first approval card can precede the original claim's final sync.
        // After its writer settles, persist the exact Agent transcript first.
        const messages = this.visibleMessages(await agent.getMessages());
        await host.syncAgentMessages({ sessionId: input.sessionId, messages });
        const execution = input.executionId === undefined ? undefined : (await agent.pendingApprovals()).find(row => row.executionId === input.executionId);
        const targets = execution === undefined ? [] : await host.approvalTargets(input.sessionId);
        const executionTarget = execution === undefined ? undefined : targets.find(target => target.executionId === execution.executionId
          || (execution.descriptor.toolCallId !== undefined && target.toolCallId === execution.descriptor.toolCallId));
        const intent = await host.beginApproval(input, executionTarget);
        return intent.settled ? json({ result: { accepted: true } }) : this.executeApproval(intent);
      } catch (error) {
        if (error instanceof SessionRpcFault) return json({ error: { code: error.code, message: error.message } }, error.code === "session/approval-conflict" ? 409 : 400);
        return json({ error: { code: "session/approval-failed", message: error instanceof Error ? error.message : String(error) } }, 503);
      }
    })();
    this.claims.set(input.sessionId, { submissionId: key, result });
    try { return (await result).clone(); }
    finally { if (this.claims.get(input.sessionId)?.result === result) this.claims.delete(input.sessionId); }
  }

  /** Continue the original input; never re-claim its already completed Think submission. */
  private async executeApproval(intent: ApprovalContinuation): Promise<Response> {
    if (!this.env?.DshAgent) return json({ error: "agent_binding_missing" }, 503);
    await this.state.storage.setAlarm?.(Date.now() + 30_000);
    const host = this.host();
    try {
      if ((await host.state({ sessionId: intent.sessionId })).archived) {
        await this.stopSessionActivity(host, intent.sessionId);
        return json({ error: "session_archived" }, 409);
      }
      const agent = await getAgentByName(this.env.DshAgent, this.agentFor(intent.sessionId)) as unknown as ThinkAgentRpc;
      const disabledThink = await this.applyThinkPluginSelection(agent, intent.sessionId);
      if (disabledThink.includes("memory") && intent.executionId !== undefined) {
        const pending = await agent.pendingApprovals();
        const row = pending.find(candidate => candidate.executionId === intent.executionId);
        if (row?.descriptor.action === "remember_fact") {
          await host.blockApprovalRecovery(intent, "The memory capability was disabled after this approval was requested; cancel and ask again.");
          return json({ error: { code: "session/approval-capability-disabled", message: "The memory capability was disabled after this approval was requested." } }, 409);
        }
      }
      const frozen = await host.inputExecutionConfig(intent.sessionId, intent.requestId);
      if (frozen === undefined) {
        await host.blockApprovalRecovery(intent, 'Original model configuration is unavailable; cancel this request and submit it again.');
        return json({ error: { code: 'session/input-configuration-unavailable', message: 'Original model configuration is unavailable; cancel this request and submit it again.' } }, 409);
      }
      const resolvedModel = await this.configureAgentForModel(agent, frozen.model);
      const effectiveModel = resolvedModel;
      if (resolvedModel !== frozen.model) {
        await host.freezeInputModel(intent.sessionId, intent.requestId, resolvedModel);
        if (typeof agent.freezeExecutionModel === "function") await agent.freezeExecutionModel(intent.requestId, resolvedModel);
      } else if (typeof agent.freezeExecutionModel === "function") {
        await agent.freezeExecutionModel(intent.requestId, effectiveModel);
      }
      const initial = await agent.beginInputContinuation(intent.requestId, intent.toolCallId ?? intent.executionId!, intent.userMessageId);
      let outcome: { status?: string; error?: string } = initial;
      if (intent.toolCallId !== undefined) {
        const result = await agent.resolveToolApproval({ requestId: intent.requestId, userMessageId: intent.userMessageId, toolCallId: intent.toolCallId, approved: intent.decision === "approved" });
        if (!result.resolved) outcome = { status: "failed", error: "Approval continuation is unavailable" };
        else outcome = result;
      } else if (intent.executionId !== undefined) {
        // Durable-pause approval consumes its pending row exactly once. Its
        // model continuation is queued by Think, so read the actual input
        // lifecycle instead of calling an action outcome a completed turn.
        const pending = await agent.pendingApprovals();
        if (pending.some(row => row.executionId === intent.executionId)) {
          if (intent.decision === "rejected") await agent.rejectExecution(intent.executionId);
          else await agent.approveExecution(intent.executionId);
        }
        outcome = await agent.getInputExecution(intent.requestId) ?? { status: "running" };
      }
      const messages = this.visibleMessages(await agent.getMessages());
      const execution = await agent.getInputExecution(intent.requestId);
      const statistics = execution?.sdkRequestId === undefined ? undefined : await agent.getExecutionStats(execution.sdkRequestId);
      await host.finishApproval(intent, messages, outcome, statistics);
      if (outcome.status === "running" || outcome.status === undefined) await this.state.storage.setAlarm?.(Date.now() + 3_000);
      return json({ result: { accepted: true } });
    } catch (error) {
      if (String(error).includes('input_configuration_unavailable')) {
        await host.blockApprovalRecovery(intent,'Original model configuration is unavailable; cancel this request and submit it again.');
        return json({error:{code:'session/input-configuration-unavailable',message:'Original model configuration is unavailable; cancel this request and submit it again.'}},409);
      }
      // Retain continuing + its atomic decision for alarm recovery. A lost RPC
      // is not evidence the model finished or that the user's decision failed.
      await this.state.storage.setAlarm?.(Date.now() + 3_000);
      return json({ error: "approval_failed", message: error instanceof Error ? error.message : String(error) }, 503);
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === `${PATH}/changes` && request.method === 'GET') return invalidationResponse(this.changes, request.signal);
    if (url.pathname === `${PATH}/upload-file`) return handleUploadHttp(this.host(), request);
    if (url.pathname === `${PATH}/internal/live` && request.method === "POST") {
      const expected = (this.env as unknown as { AUTH_SECRET?: string } | undefined)?.AUTH_SECRET ?? "";
      if (expected === "" || request.headers.get("x-dsh-live-token") !== expected) return json({ error: "unauthorized" }, 401);
      let body: unknown;
      try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }
      const record = typeof body === "object" && body !== null ? (body as { live?: unknown }).live : undefined;
      const sessionId = url.searchParams.get("sessionId") ?? (typeof body === "object" && body !== null ? (body as { sessionId?: unknown }).sessionId : undefined);
      if (typeof sessionId !== "string") return json({ error: "invalid_live_push" }, 400);
      if (record === undefined) this.livePushes.delete(sessionId);
      else this.livePushes.set(sessionId, record);
      this.changes.publish(['live']);
      return json({ ok: true });
    }
    // The Agent pushes its live attempt into a session-keyed instance of this
    // class (see think-core `pushLiveAttempt`); the follow bridge reads that
    // instance directly so it can publish tool events while the turn runs, when
    // this DO's owner transport is still busy with the claim.
    if (url.pathname === `${PATH}/live-push` && request.method === "GET") {
      const sessionId = url.searchParams.get("sessionId");
      if (sessionId === null) return json({ error: "invalid_live_request" }, 400);
      return json({ live: this.livePushes.get(sessionId) ?? null });
    }
    if (url.pathname.startsWith(`${PATH}/migrate/`)) {
      const host = this.host();
      const sql: SqlStorage = {
        exec: (query, ...bindings) => this.state.storage.sql.exec(query, ...bindings),
        ...(this.state.storage.transactionSync === undefined ? {} : {
          transactionSync: <T>(operation: () => T): T => this.state.storage.transactionSync!(operation),
        }),
      };
      if (url.pathname === `${PATH}/migrate/status` && request.method === "GET") return json(migrationStatus(sql));
      if (url.pathname === `${PATH}/migrate/export` && request.method === "GET") return json(dumpMigrationTables(sql));
      if (url.pathname === `${PATH}/migrate/commit` && request.method === "POST") {
        let input: unknown;
        try { input = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }
        if (typeof input !== "object" || input === null || Array.isArray(input)) return json({ error: "invalid_snapshot" }, 400);
        try {
          return json(commitMigration(sql, input, (sidecar) => host.restoreMigrationSidecar(sidecar as never)));
        } catch (error) {
          return json({ error: "migration_failed", message: error instanceof Error ? error.message : String(error) }, 503);
        }
      }
      // Legacy split import/sidecar/mark requests cannot produce an atomic
      // completion receipt. Old callers must retry through the current Worker.
      return json({ error: "migration_atomic_commit_required" }, 409);
    }
    if (url.pathname === `${PATH}/claim` && request.method === "POST") {
      if (this.env?.DshAgent === undefined) return json({ error: "agent_binding_missing" }, 500);
      let claimBody: unknown;
      try {
        claimBody = await request.json();
      } catch {
        return json({ error: "invalid_json" }, 400);
      }
      if (typeof claimBody !== "object" || claimBody === null || Array.isArray(claimBody)) {
        return json({ error: "invalid_body" }, 400);
      }
      const sessionId = (claimBody as { sessionId?: unknown }).sessionId;
      const submissionId = (claimBody as { submissionId?: unknown }).submissionId;
      if (typeof sessionId !== "string" || typeof submissionId !== "string") {
        return json({ error: "invalid_claim" }, 400);
      }
      return this.claim(sessionId, submissionId);
    }
    if (url.pathname === `${PATH}/control` && request.method === "GET") {
      const host = this.host();
      return eventStreamResponse(signal => host.control(signal), request.signal);
    }
    if (url.pathname === `${PATH}/live-events` && request.method === 'GET') {
      const sessionId = url.searchParams.get('sessionId');
      if (!sessionId) return json({ error: 'invalid_live_request' }, 400);
      const self = this;
      const liveKey = sessionId;
      async function* events(signal: AbortSignal) {
        let previous: string | undefined;
        for await (const change of self.changes.subscribe(signal)) {
          if (change.topics.length > 0 && !change.topics.includes('live')) continue;
          const live = self.livePushes.get(liveKey) ?? null;
          const next = JSON.stringify(live);
          if (next !== previous) { previous = next; yield { live }; }
        }
      }
      return eventStreamResponse(events, request.signal);
    }
    if (url.pathname === `${PATH}/live-stream` && request.method === 'GET') {
      const sessionId = url.searchParams.get('sessionId');
      if (!sessionId) return json({ error: 'invalid_live_request' }, 400);
      await this.host().state({ sessionId });
      const namespace = this.env?.SESSION_HOST;
      if (!namespace) return json({ error: 'session_host_binding_missing' }, 503);
      const name = this.agentFor(sessionId);
      return namespace.get(namespace.idFromName(name)).fetch(new Request(`https://session-host${PATH}/live-events?sessionId=${encodeURIComponent(name)}`, { signal: request.signal }));
    }
    if (url.pathname === `${PATH}/live` && request.method === "GET") {
      if (this.env?.DshAgent === undefined) return json({ error: "agent_binding_missing" }, 500);
      const sessionId = url.searchParams.get("sessionId");
      if (sessionId === null) return json({ error: "invalid_live_request" }, 400);
      try {
        const agent = await getAgentByName(this.env.DshAgent, this.agentFor(sessionId)) as unknown as ThinkAgentRpc;
        return json({ live: await agent.getLiveAttempt() });
      } catch (error) {
        return json({ live: undefined, error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (url.pathname === `${PATH}/follow` && request.method === "GET") {
      const sessionId = url.searchParams.get("sessionId");
      const after = Number.parseInt(url.searchParams.get("after") ?? "0", 10);
      if (sessionId === null || !Number.isSafeInteger(after) || after < 0) {
        return json({ error: "invalid_follow_request" }, 400);
      }
      const host = this.host();
      if (url.searchParams.get("kind") !== "subagent") {
        try {
          await host.state({ sessionId });
        } catch {
          return json({ error: "not_found" }, 404);
        }
      }
      return eventStreamResponse(signal => host.follow({
        address: url.searchParams.get("kind") === "subagent"
          ? { kind: "subagent", childSessionId: sessionId }
          : { kind: "session", sessionId },
        signal,
      }), request.signal);
    }
    if (url.pathname !== PATH) return json({ error: "not_found" }, 404);
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return json({ error: "invalid_body" }, 400);
    }
    const candidate = body as { id?: unknown; method?: unknown; params?: unknown };
    if (typeof candidate.method !== "string") return json({ error: "invalid_method" }, 400);
    if (candidate.id !== undefined && typeof candidate.id !== "string") return json({ error: "invalid_request_id" }, 400);
    const requestBody: SessionHostRequest = { method: candidate.method, params: candidate.params, ...(candidate.id === undefined ? {} : { id: candidate.id }) };
    if (candidate.method === 'recordModelRequest' || candidate.method === 'recordStepStart' || candidate.method === 'workspaceFileWriteFromAgent') {
      const secret = (this.env as unknown as {AUTH_SECRET?: string})?.AUTH_SECRET;
      if (!secret || request.headers.get('x-dsh-internal-token') !== secret) return json({error:'unauthorized'}, 403);
    }
    if (requestBody.method === "runtimeInfo") return json({ result: { versionId: this.env?.WORKER_VERSION?.id ?? null, turnLifecycle: 1 } });
    if (requestBody.method === "modelAccess" || requestBody.method === "models" || requestBody.method === "selectModel") {
      const settingsHost = this.host();
      let settingsValues: Record<string, Record<string, unknown>> | undefined;
      try { settingsValues = (await settingsHost.settingsDescribe()).values; } catch { settingsValues = undefined; }
      const deepseekRef = deepseekCredentialRef(settingsValues);
      const safeOwner = await this.readCredentialSafe(deepseekRef);
      const ownerAvailable = safeOwner.value !== undefined && safeOwner.error === undefined;
      const ownerError = safeOwner.error !== undefined;
      const platformEnabled = this.platformEnabled();
      const deepseekModels = deepseekModelsFromSettings(settingsValues);
      if (requestBody.method === "modelAccess") {
        const gatewayCatalog = platformEnabled ? catalogFor(true, false) : [];
        return json({ result: {
          platformEnabled,
          ownerKeyConfigured: ownerAvailable,
          ownerKeyError: ownerError,
          effective: platformEnabled ? "platform-gateway" : ownerAvailable ? "owner-byok" : "unavailable",
          protocol: "openai-chat-completions",
          catalog: catalogFor(platformEnabled, ownerAvailable, deepseekModels),
          providers: {
            "cloudflare-ai-gateway": { available: platformEnabled, catalog: gatewayCatalog },
            "deepseek-official": { available: ownerAvailable, catalog: ownerAvailable ? catalogFor(false, true, deepseekModels) : [] },
          },
        } });
      }
      if (requestBody.method === "models") {
        return json({ ...(requestBody.id === undefined ? {} : { id: requestBody.id }), result: catalogFor(platformEnabled, ownerAvailable, deepseekModels) });
      }
      const requestedModel = (requestBody.params as { model?: unknown } | undefined)?.model;
      const model = typeof requestedModel === "string" ? requestedModel : "";
      const gatewaySelection = isGatewayModelId(model);
      const deepseekSelection = isDeepSeekModelId(model);
      if (gatewaySelection) {
        if (!platformEnabled) return json({ error: { code: "model/unavailable", message: "Cloudflare AI Gateway is not enabled for this deployment." } }, 409);
        // Deliberately no DeepSeek credential read on the Gateway path.
      } else if (deepseekSelection) {
        if (!ownerAvailable) return json({ error: { code: "model/unavailable", message: ownerError ? "The DeepSeek API key could not be read." : "The owner DeepSeek API key is not configured." } }, 409);
      } else {
        return json({ error: { code: "model/unavailable", message: "Legacy bare model ids are read-only compatibility and cannot be selected as a new route." } }, 409);
      }
    }
    const host = this.host();
    if (requestBody.method === "claim") {
      const params = requestBody.params as { sessionId?: unknown; submissionId?: unknown } | undefined;
      if (typeof params?.sessionId !== "string" || typeof params?.submissionId !== "string") return json({ error: "invalid_claim" }, 400);
      return this.claim(params.sessionId, params.submissionId);
    }
    if (requestBody.method === "workspaceArchive") {
      const params = requestBody.params as { sessionId?: unknown } | undefined;
      if (typeof params?.sessionId !== "string") return json({ error: { code: "gateway/bad-request", message: "archive requires a sessionId" } }, 400);
      const result = await dispatchSessionHost(host, requestBody);
      if ("error" in result) return json(result);
      // Archive is already durable. Keep the wake before cross-DO cancellation
      // so a crash/transport loss cannot strand a running archived Session.
      await this.state.storage.setAlarm?.(Date.now() + 3_000);
      try {
        await this.stopSessionActivity(host, params.sessionId);
        return json(result);
      } catch (error) {
        return json({ error: { code: "workspace/stop-failed", message: error instanceof Error ? error.message : String(error) } }, 503);
      }
    }
    if (requestBody.method === "cancel") {
      const params = requestBody.params as { sessionId?: unknown } | undefined;
      if (typeof params?.sessionId !== "string") return json({ error: "invalid_cancel" }, 400);
      if (this.env?.DshAgent === undefined) return json({ error: "agent_binding_missing" }, 503);
      try {
        await this.stopSessionActivity(host, params.sessionId);
        return json({ result: null });
      } catch (error) {
        return json({ error: "cancel_failed", message: error instanceof Error ? error.message : String(error) }, 503);
      }
    }
    if (requestBody.method === "live") {
      if (this.env?.DshAgent === undefined) return json({ error: "agent_binding_missing" }, 500);
      const liveParams = typeof requestBody.params === "object" && requestBody.params !== null
        ? requestBody.params as { sessionId?: unknown }
        : {};
      if (typeof liveParams.sessionId !== "string") return json({ error: "invalid_live_request" }, 400);
      const pushed = this.livePushes.get(liveParams.sessionId);
      if (pushed !== undefined) return json({ result: { live: pushed } });
      try {
        const agent = await getAgentByName(this.env.DshAgent, this.agentFor(liveParams.sessionId)) as unknown as ThinkAgentRpc;
        return json({ result: { live: await agent.getLiveAttempt() ?? null } });
      } catch (error) {
        return json({ error: { code: "session/live-unavailable", message: error instanceof Error ? error.message : String(error) } }, 503);
      }
    }
    if (requestBody.method === "pendingApprovals" || requestBody.method === "resolveApproval") {
      if (this.env?.DshAgent === undefined) return json({ error: "agent_binding_missing" }, 500);
      const approvalParams = typeof requestBody.params === "object" && requestBody.params !== null
        ? requestBody.params as { sessionId?: unknown; executionId?: unknown; toolCallId?: unknown; decision?: unknown }
        : {};
      if (typeof approvalParams.sessionId !== "string") return json({ error: "invalid_approval_request" }, 400);
      if (requestBody.method === "resolveApproval") {
        const tool = typeof approvalParams.toolCallId === "string" && approvalParams.toolCallId.trim() !== "";
        const execution = typeof approvalParams.executionId === "string" && approvalParams.executionId.trim() !== "";
        if (tool === execution || (approvalParams.toolCallId !== undefined && !tool) || (approvalParams.executionId !== undefined && !execution)) return json({ error: "invalid_approval_request" }, 400);
        // The official Allow once seam (including already deployed clients)
        // uses this explicit spelling. Normalize before storing/idempotency;
        // no other truthy or non-rejected value authorizes an action.
        const decision = approvalParams.decision === "allowed-once" ? "approved" : approvalParams.decision;
        if (decision !== "approved" && decision !== "rejected") return json({ error: "invalid_approval_decision" }, 400);
        return this.resolveApproval({ sessionId: approvalParams.sessionId,
          ...(typeof approvalParams.toolCallId === "string" ? { toolCallId: approvalParams.toolCallId } : { executionId: approvalParams.executionId as string }),
          decision,
        });
      }
      try {
        const agent = await getAgentByName(this.env.DshAgent, this.agentFor(approvalParams.sessionId)) as unknown as ThinkAgentRpc;
        if (requestBody.method === "pendingApprovals") {
          const pendingExecutions = await agent.pendingApprovals();
          // Approval-gated tool calls are not durable-pause rows; they park as
          // an `approval-requested` part in the Agent transcript.
          const messages = this.visibleMessages(await agent.getMessages());
          const targets = await host.approvalTargets(approvalParams.sessionId, messages);
          const allowedTools = new Set(targets.map(target => target.toolCallId));
          const approvals = pendingExecutions.filter(row => targets.some(target => target.executionId === row.executionId
            || (row.descriptor.toolCallId !== undefined && target.toolCallId === row.descriptor.toolCallId)));
          const toolApprovals: Array<{ toolCallId: string; toolName: string; summary?: string; input?: unknown }> = [];
          for (const message of messages) {
            for (const part of message.parts ?? []) {
              const row = part as Record<string, unknown>;
              if (row["state"] !== "approval-requested" || typeof row["toolCallId"] !== "string" || !allowedTools.has(row["toolCallId"])) continue;
              const descriptor = typeof row["approval"] === "object" && row["approval"] !== null
                ? (row["approval"] as { readonly descriptor?: { readonly summary?: unknown } }).descriptor
                : undefined;
              toolApprovals.push({
                toolCallId: row["toolCallId"],
                toolName: typeof row["toolName"] === "string" ? row["toolName"] : "tool",
                ...(typeof descriptor?.summary === "string" ? { summary: descriptor.summary } : {}),
                ...(row["input"] === undefined ? {} : { input: row["input"] }),
              });
            }
          }
          return json({ result: { approvals, toolApprovals } });
        }
        return json({ error: "invalid_approval_request" }, 400);
      } catch (error) {
        return json({ error: "approval_failed", message: error instanceof Error ? error.message : String(error) }, 500);
      }
    }
    let response = await dispatchSessionHost(host, {
      ...(typeof requestBody.id === "string" ? { id: requestBody.id } : {}),
      method: requestBody.method,
      params: requestBody.params,
    });
    if((requestBody.method==='history'||requestBody.method==='page')&&'result' in response){
      const params=requestBody.params as {sessionId?:unknown;address?:{sessionId?:unknown;childSessionId?:unknown}}|undefined;
      const sessionId=params?.sessionId??params?.address?.sessionId??params?.address?.childSessionId;
      if(typeof sessionId==='string')try{
        // Inspect the history already read for this response. Healthy streams
        // do not perform a second transcript read or contact the Agent.
        if(await host.needsToolResultReconciliation(sessionId,response.result as Parameters<SessionHost['needsToolResultReconciliation']>[1])){
          if(!this.env?.DshAgent)throw new Error('Agent history unavailable');
          const agent=await getAgentByName(this.env.DshAgent,this.agentFor(sessionId)) as unknown as ThinkAgentRpc;
          const changed=await host.repairCompletedToolResults(sessionId,this.visibleMessages(await agent.getMessages()));
          if(changed>0)response=await dispatchSessionHost(host,requestBody);
        }
      }catch(error){
        if(error instanceof SessionRpcFault)return json({error:{code:error.code,message:error.message}},400);
        return json({error:{code:'session/history-recovery-unavailable',message:'Stored tool results could not be reconciled from the Agent history; retry this read.'}},503);
      }
    }
    if (requestBody.method === "prompt") {
      // Grace period: the browser's fire-and-forget claim normally lands in
      // well under a second and cancels this alarm. Only a vanished tab (or a
      // lost claim request) lets the alarm own the turn.
      await this.state.storage.setAlarm?.(Date.now() + 3_000);
    }
    if (requestBody.method === "scheduleCreate" || requestBody.method === "scheduleEdit" || requestBody.method === "scheduleRun") {
      const result = typeof response === "object" && response !== null && "result" in response
        ? (response as { result?: unknown }).result
        : undefined;
      const scheduledAt = typeof result === "object" && result !== null && typeof (result as { scheduledAt?: unknown }).scheduledAt === "string"
        ? Date.parse((result as { scheduledAt: string }).scheduledAt)
        : undefined;
      const immediate = requestBody.method === "scheduleRun" || (scheduledAt !== undefined && scheduledAt <= Date.now());
      await this.state.storage.setAlarm?.(immediate ? Date.now() + 50 : scheduledAt !== undefined ? scheduledAt : Date.now() + 50);
    }
    return json(response, "error" in response ? 400 : 200);
  }
}
