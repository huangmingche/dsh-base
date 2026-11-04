import { providerForModelId } from '../../../boot/dsh-base-session-wire/src/model-routes.ts';
import { InputExecutionLedger, type InputExecution, type ExecutionStatistics, type InputExecutionConfig, type ModelStepEvidence } from "./input-execution.ts";
import { readUploadedFile, uploadedFileContext, type UploadedFileRef, type UploadedFilePage } from "./uploaded-files.ts";
import { assertSessionActive } from "./session-activity.ts";
import { replaceDurableContext } from "./durable-context.ts";
import { approvalNoticeIds, prepareApprovalContext } from "./approval-context.ts";
/** Framework for composing one Think agent out of agent plugins. */
import { Think, type Action, type SessionContextOptions, type ThinkModel } from "@cloudflare/think";
import { callable } from "agents";
import type { ToolSet } from "ai";
import { WorkerSystemPrompt, type PromptContribution } from "./system-prompt.ts";
import { CHAT_SKILLS } from "@dsh-base/chat-skills";
import { createCompactFunction } from "agents/sessions";
import { generateText } from "ai";

/** One prompt-context block contributed by an agent plugin. */
export type ContextBlock = { label: string } & SessionContextOptions;

/** Durable runtime services an agent plugin may use from tools/actions. */
export interface DshAgentRuntime {
  reasoningEffort(): InputExecutionConfig['reasoningEffort'];
  /** Read immutable file bytes admitted to this owner Session. */
  readUploadedFile(receiptId: string, offset?: number, limit?: number): Promise<UploadedFilePage>;
  /** Persist one model-approved durable fact. */
  rememberFact(fact: string): void;
  /** Read durable facts for recall and context assembly. */
  listFacts(): readonly string[];
  /** Per-turn BYOK credential the Host decrypted for this owner, if any. */
  userCredential(): string | undefined;
  /** Host-resolved DeepSeek endpoint for the current explicit/legacy direct selection. */
  deepSeekBaseURL?(): string | undefined;
  /** Report one provider attempt that follows a failed attempt (model retry). */
  noteModelRetry?(failure: { readonly message: string }): void;
  /** Per-plugin JSON config selected by the owner; plugins narrow their own deployment limits. */
  pluginConfig?(name: string): unknown;
}

/** A dsh-base agent plugin: one capability composed into the agent. */
export interface DshPlugin<Env = unknown> {
  /** Stable plugin id, used for diagnostics and composition order. */
  readonly name: string;
  /** Contributes the model that serves turns. Select the provider by model id. */
  readonly model?: (env: Env, modelId?: string, runtime?: DshAgentRuntime) => ThinkModel;
  /** Whether this plugin owns the selected model id; omitted means any. */
  readonly matchesModel?: (env: Env, modelId: string) => boolean;
  /** Deployment persona text for the official persona-prefix slot. */
  readonly persona?: string;
  /** Contributes sections to the official DSH system-prompt registry. */
  readonly prompt?: (env: Env, agent: DshAgentRuntime) => readonly PromptContribution[];
  /** Legacy prompt-context blocks; rendered only when the official registry fails. */
  readonly context?: () => readonly ContextBlock[];
  /** Contributes model-facing tools. */
  readonly tools?: (env: Env, agent: DshAgentRuntime) => ToolSet;
  /** Contributes durable, approval-aware Think actions. */
  readonly actions?: (env: Env, agent: DshAgentRuntime) => Readonly<Record<string, Action>>;
}

/** Durable text-attachment reference accepted by the composer. */
export interface AgentAttachmentRef {
  readonly id: string;
  readonly name: string;
  readonly mediaType: string;
  readonly size: number;
}

/** Context windows for the advertised DeepSeek models. */
const MODEL_CONTEXT_WINDOWS: Readonly<Record<string, number>> = {
  "deepseek-flash": 1_048_576,
  "deepseek-v4-pro": 1_048_576,
};

/** The only advertised model catalog: DeepSeek through Cloudflare AI Gateway. */
const MODEL_CATALOG = ["deepseek-flash", "deepseek-v4-pro"] as const;

/** Context window for one configured model id. */
function contextWindow(modelId: string): number {
  return MODEL_CONTEXT_WINDOWS[modelId] ?? 128_000;
}

/** Maximum text attachment accepted in this Host version. */
const ATTACHMENT_LIMIT_BYTES = 512 * 1024;
/** Maximum attachment count per admitted turn. */
const ATTACHMENT_LIMIT_COUNT = 4;
/** Maximum characters injected from one attachment into the prompt. */
const ATTACHMENT_PROMPT_LIMIT = 60_000;

/** Escape attachment metadata before putting it into a prompt block. */
function escapeAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

/** Compose one Think agent class out of agent plugins; the class owns no capability. */
export function composeAgent<Env extends Cloudflare.Env>(plugins: readonly DshPlugin<Env>[]) {
  class ComposedAgent extends Think<Env> implements DshAgentRuntime {
    private turnStartedAt: number | undefined;
    private stepStartedAt: number | undefined;
    private firstTokenAt: number | undefined;
    private turnStats = { turns: 0, steps: 0, llmMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0 };
    private statsRequestId: string | undefined;
    private contextBreakdown: {systemTokens:number;toolsTokens:number} | undefined;
    private liveTurn = 0;
    private liveStep = 0;
    private liveAttemptId: string | undefined;
    private liveStepId: string | undefined;
    private liveRequestId: string | undefined;
    private approvalNoticeBaseline: ReadonlySet<string> = new Set();
    private readonly approvalWork = new Map<string, Promise<{ resolved: boolean } & InputExecution>>();
    private approvalTail: Promise<unknown> = Promise.resolve();
    private liveRevision = 0;
    private liveChunks: Array<{ type: string; index: number; text: string; time: number; id?: string; name?: string }> = [];
    private readonly liveToolIndices = new Map<string, number>();
    private readonly liveBlockIndices = new Map<string, number>();
    private readonly liveToolCallTimes = new Map<string,number>();
    private liveSettledSteps: ModelStepEvidence[] = [];
    private activeExecutionConfig: InputExecutionConfig | undefined;
    private liveToolCalls: Array<{ callId: string; name: string; input?: unknown; state: "running" | "done"; output?: unknown; startedAt:number; endedAt?:number }> = [];
    private livePushScheduled = false;
    private readonly liveSockets = new Set<{ send(data: string): void; close(code?: number, reason?: string): void; addEventListener(type: string, listener: () => void): void }>();
    private userCredentialValue: string | undefined;
    private deepSeekBaseURLValue: string | undefined;
    private promptRegistry: WorkerSystemPrompt | undefined;
    private promptFailureReported = false;
    private promptError: string | undefined;
    private workspaceCwd = "/";
    private workspaceInstructions = "";
    private globalInstructions = "";
    private clientTimeZone: string | undefined;
    private permissionPreset = "workspace-write";
    private modelRetries = 0;
    private lastTimeSnapshotAt: number | undefined;
    private contextInjectionError: string | undefined;
    private lastRefreshError: string | undefined;
    private workspaceReadLog: Array<{ path: string; ok: boolean; bytes?: number; error?: string }> = [];

    constructor(...args: unknown[]) {
      super(...(args as [DurableObjectState, Env]));
      this.ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS dsh_agent_facts (id INTEGER PRIMARY KEY AUTOINCREMENT, fact TEXT NOT NULL, created_at INTEGER NOT NULL)",
      );
      this.ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS dsh_agent_attachments (id TEXT PRIMARY KEY, name TEXT NOT NULL, media_type TEXT NOT NULL, data TEXT NOT NULL, size INTEGER NOT NULL, created_at INTEGER NOT NULL)",
      );
      this.ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS dsh_agent_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
      );
      this.ctx.storage.sql.exec(
        "DELETE FROM dsh_agent_settings WHERE key = 'model' AND value NOT IN ('deepseek-flash', 'deepseek-v4-pro')",
      );
    }

    /** Optional Think capabilities disabled for this session selection. */
    private disabledThinkPlugins = this.readThinkPluginState().disabled
    private thinkPluginConfig = this.readThinkPluginState().config

    private readThinkPluginState(): { disabled: Set<string>; config: Record<string, unknown> } {
      let row: { value?: unknown } | undefined
      try {
        row = this.ctx.storage.sql.exec("SELECT value FROM dsh_agent_settings WHERE key = 'plugin-selection'").toArray()[0] as { value?: unknown } | undefined
      } catch { return { disabled: new Set(), config: {} } }
      if (typeof row?.value !== 'string') return { disabled: new Set(), config: {} }
      try {
        const value = JSON.parse(row.value) as { disabled?: unknown; config?: unknown }
        const disabled = new Set(Array.isArray(value.disabled) ? value.disabled.filter((name): name is string => typeof name === 'string') : [])
        const config = typeof value.config === 'object' && value.config !== null && !Array.isArray(value.config) ? value.config as Record<string, unknown> : {}
        return { disabled, config }
      } catch { return { disabled: new Set(), config: {} } }
    }

    /** Apply the Host's persisted owner/session projection before the next model call. */
    setThinkPlugins(input: { disabled?: readonly string[]; config?: Record<string, unknown> }): { disabled: string[] } {
      const disabled = new Set((input.disabled ?? []).filter(name => name === 'fetch' || name === 'memory'))
      const config = typeof input.config === 'object' && input.config !== null && !Array.isArray(input.config) ? input.config : {}
      this.disabledThinkPlugins = disabled
      this.thinkPluginConfig = config
      this.promptRegistry = undefined
      this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS dsh_agent_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
      this.ctx.storage.sql.exec("INSERT INTO dsh_agent_settings (key, value) VALUES ('plugin-selection', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify({ disabled: [...disabled], config }))
      return { disabled: [...disabled] }
    }

    pluginConfig(name: string): unknown { return this.thinkPluginConfig[name] }

    private activePlugins(): readonly DshPlugin<Env>[] {
      return plugins.filter(plugin => !this.disabledThinkPlugins.has(plugin.name))
    }

    /** The decrypted BYOK credential for this execution, when configured. */
    userCredential(): string | undefined {
      return this.userCredentialValue;
    }

    /** Host claim injects the owner's credential before the turn starts. */
    @callable()
    setUserCredential(value: string | null): { configured: boolean } {
      this.userCredentialValue = typeof value === "string" && value !== "" ? value : undefined;
      return { configured: this.userCredentialValue !== undefined };
    }

    /** Host approval/restart freezes a legacy input's resolved explicit provider. */
    @callable()
    freezeExecutionModel(requestId: string, model: string): { model: string } {
      const config = this.inputLedger().freezeModel(requestId, model);
      if (config === undefined) throw new Error('input_configuration_unavailable');
      if (this.activeExecutionConfig?.model !== model) this.activeExecutionConfig = { ...(this.activeExecutionConfig ?? config), model };
      return { model: config.model };
    }

    /** Host claim injects the owner's selected DeepSeek endpoint only for direct routes. */
    @callable()
    setDeepSeekBaseURL(value: string | null): { configured: boolean } {
      this.deepSeekBaseURLValue = typeof value === "string" && value.trim() !== "" ? value : undefined;
      return { configured: this.deepSeekBaseURLValue !== undefined };
    }

    /** Runtime seam consumed by the DeepSeek BYOK provider. */
    deepSeekBaseURL(): string | undefined {
      return this.deepSeekBaseURLValue;
    }

    rememberFact(fact: string): void {
      this.ctx.storage.sql.exec("INSERT INTO dsh_agent_facts (fact, created_at) VALUES (?, ?)", fact, Date.now());
    }

    listFacts(): readonly string[] {
      return [...this.ctx.storage.sql.exec<{ fact: string }>("SELECT fact FROM dsh_agent_facts ORDER BY id")]
        .map((row) => row.fact);
    }

    /**
     * Stamp provider usage onto the assistant message. The AI SDK's finish
     * stream part is the only provider-agnostic usage source Think exposes.
     */
    messageMetadata = ({ part }: {
      part: { type?: string; totalUsage?: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
        inputTokenDetails?: { cacheReadTokens?: number; cacheWriteTokens?: number };
        outputTokenDetails?: { reasoningTokens?: number };
      } };
    }): Record<string, unknown> | undefined => {
      if (part.type !== "finish" || part.totalUsage === undefined) return undefined;
      const usage = part.totalUsage;
      return {
        usage: {
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
          totalTokens: usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
          cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens ?? 0,
          cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens ?? 0,
          reasoningTokens: usage.outputTokenDetails?.reasoningTokens ?? 0,
        },
      };
    };

    /**
     * Store one text attachment in the Agent SQLite database. The composer only
     * sends the reference in its outbox; the bytes never enter localStorage.
     */
    @callable()
    async uploadAttachment(input: {
      name: string;
      mediaType: string;
      dataBase64: string;
    }): Promise<AgentAttachmentRef> {
      if (typeof input.name !== "string" || input.name.trim() === "" || input.name.length > 200) {
        throw new Error("invalid_attachment_name");
      }
      if (typeof input.mediaType === "string" && input.mediaType.startsWith("image/")) throw new Error("IMAGE_PROCESSOR_UNAVAILABLE");
      if (typeof input.mediaType !== "string"
        || (!input.mediaType.startsWith("text/") && !input.mediaType.startsWith("image/"))) {
        throw new Error("unsupported_attachment_type");
      }
      if (typeof input.dataBase64 !== "string" || input.dataBase64 === "") {
        throw new Error("invalid_attachment_data");
      }
      let bytes: Uint8Array;
      try {
        bytes = Uint8Array.from(atob(input.dataBase64), (char) => char.charCodeAt(0));
      } catch {
        throw new Error("invalid_attachment_data");
      }
      if (bytes.byteLength > ATTACHMENT_LIMIT_BYTES) throw new Error("attachment_too_large");
      const id = `att_${crypto.randomUUID()}`;
      this.ctx.storage.sql.exec(
        "INSERT INTO dsh_agent_attachments (id, name, media_type, data, size, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        id, input.name.trim(), input.mediaType, input.dataBase64, bytes.byteLength, Date.now(),
      );
      return { id, name: input.name.trim(), mediaType: input.mediaType, size: bytes.byteLength };
    }

    /** Read stored attachments and split prompt text from multimodal file parts. */
    private resolveAttachments(attachments: readonly AgentAttachmentRef[]): {
      prompt: string;
      files: Array<{ type: "file"; mediaType: string; filename: string; url: string }>;
    } {
      if (attachments.length > ATTACHMENT_LIMIT_COUNT) throw new Error("too_many_attachments");
      let remaining = ATTACHMENT_PROMPT_LIMIT;
      const blocks: string[] = [];
      const files: Array<{ type: "file"; mediaType: string; filename: string; url: string }> = [];
      for (const attachment of attachments) {
        if (typeof attachment.id !== "string" || !/^att_[0-9a-f-]{36}$/.test(attachment.id)) {
          throw new Error("invalid_attachment_reference");
        }
        const row = [...this.ctx.storage.sql.exec<{
          name: string;
          media_type: string;
          data: string;
        }>("SELECT name, media_type, data FROM dsh_agent_attachments WHERE id = ?", attachment.id)].at(0);
        if (row === undefined) throw new Error("attachment_not_found");
        if (row.media_type.startsWith("image/")) throw new Error("IMAGE_PROCESSOR_UNAVAILABLE");
        let content: string;
        try {
          content = new TextDecoder().decode(Uint8Array.from(atob(row.data), (char) => char.charCodeAt(0)));
        } catch {
          throw new Error("invalid_attachment_data");
        }
        if (content.length > remaining) content = content.slice(0, remaining);
        remaining -= content.length;
        blocks.push(
          `<dsh-attachment name="${escapeAttribute(row.name)}" media="${escapeAttribute(row.media_type)}">\n${content.replaceAll("</dsh-attachment>", "&lt;/dsh-attachment&gt;")}\n</dsh-attachment>`,
        );
        if (remaining <= 0) break;
      }
      return {
        prompt: blocks.length === 0 ? "" : `\n\n${blocks.join("\n")}`,
        files,
      };
    }

    /**
     * Durable admission boundary for the composer. Think owns FIFO
     * serialization, idempotency and the submission ledger.
     */
    @callable()
    async admitInput(input: {
      requestId: string;
      text: string;
      attachments?: readonly AgentAttachmentRef[];
      uploadedFiles?: readonly UploadedFileRef[];
      executionConfig?: InputExecutionConfig;
    }): Promise<{
      submissionId: string;
      accepted: boolean;
      status: string;
    }> {
      if (typeof input.requestId !== "string" || input.requestId === ""
        || typeof input.text !== "string"
        || (input.text.trim() === "" && (input.attachments?.length ?? 0) === 0 && (input.uploadedFiles?.length ?? 0) === 0)) {
        throw new Error("invalid_input");
      }
      if ([...this.ctx.storage.sql.exec("SELECT key FROM dsh_agent_settings WHERE key = ?", `cancelled:${input.requestId}`)].length > 0) {
        return { submissionId: input.requestId, accepted: false, status: "cancelled" };
      }
      const configuration = this.inputLedger().configuration(input.requestId) ?? input.executionConfig;
      if (configuration === undefined) throw new Error('input_configuration_unavailable');
      this.activeExecutionConfig = this.inputLedger().configure(input.requestId, configuration);
      // Official host-side skill injection: a prompt starting with `/<name>`
      // resolves the user-invocable skill and its body becomes durable context.
      const skillMatch = /^\/([a-z0-9][a-z0-9-]*)(?:\s|$)/u.exec(input.text.trim());
      const skill = skillMatch === null ? undefined : CHAT_SKILLS.find((candidate) => candidate.name === skillMatch[1]);
      // A replay must not rewrite the instructions of an already admitted
      // turn. The marker also covers a crash between context persistence and
      // Think admission; partial context writes never advance it.
      const previousContext = [...this.ctx.storage.sql.exec<{ value: string }>(
        "SELECT value FROM dsh_agent_settings WHERE key = 'context-admission'",
      )].at(0)?.value;
      if (previousContext !== input.requestId && await this.session.getMessage(input.requestId) === null) {
        try {
          await this.injectDurableContext(skill);
          this.ctx.storage.sql.exec(
            "INSERT INTO dsh_agent_settings (key, value) VALUES ('context-admission', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            input.requestId,
          );
          this.contextInjectionError = undefined;
        } catch (error) {
          this.contextInjectionError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
          throw error;
        }
      }
      const attachments = input.attachments ?? [];
      const resolved = this.resolveAttachments(attachments);
      const uploadedContext = await uploadedFileContext(input.uploadedFiles ?? [], receiptId => this.readUploadedFile(receiptId));
      const text = `${input.text}${resolved.prompt}${uploadedContext}`;
      const result = await this.submitMessages([
        {
          id: input.requestId,
          role: "user",
          parts: [
            ...(text === "" ? [] : [{ type: "text" as const, text }]),
            ...resolved.files,
          ],
        },
      ], { idempotencyKey: input.requestId, channel: "web" });
      if ([...this.ctx.storage.sql.exec("SELECT key FROM dsh_agent_settings WHERE key = ?", `cancelled:${input.requestId}`)].length > 0) {
        await this.cancelSubmission(result.submissionId);
        return { submissionId: result.submissionId, accepted: false, status: "cancelled" };
      }
      return { submissionId: result.submissionId, accepted: result.accepted, status: result.status };
    }

    /** Page backwards over the durable transcript; no model turn is run. */
    @callable()
    async historyPage(input?: { before?: string; limit?: number }): Promise<{
      messages: unknown[];
      hasMore: boolean;
      before?: string;
    }> {
      const limit = Math.max(1, Math.min(100, Math.floor(input?.limit ?? 20)));
      const all = await this.getMessages();
      const requested = typeof input?.before === "string" ? input.before : undefined;
      const end = requested === undefined ? all.length : all.findIndex((message) => message.id === requested);
      if (end < 0) throw new Error("history_cursor_not_found");
      const start = Math.max(0, end - limit);
      const messages = all.slice(start, end);
      const before = start > 0 ? all[start]?.id : undefined;
      return { messages, hasMore: start > 0, ...(before === undefined ? {} : { before }) };
    }

    /**
     * Import a transcript into a fresh Agent without starting a model turn.
     * Used by the client's "Fork conversation" action after it creates a new
     * chat session; Think's addMessages keeps the imported path linear.
     */
    @callable()
    async importHistory(messages: readonly unknown[]): Promise<number> {
      if (!Array.isArray(messages)) throw new Error("invalid_history");
      if (messages.length === 0 || messages.length > 500) throw new Error("invalid_history_length");
      const normalized = messages.map((message) => {
        if (typeof message !== "object" || message === null) throw new Error("invalid_history_message");
        const candidate = message as { id?: unknown; role?: unknown; parts?: unknown };
        if (typeof candidate.id !== "string" || !Array.isArray(candidate.parts)
          || (candidate.role !== "user" && candidate.role !== "assistant" && candidate.role !== "system")) {
          throw new Error("invalid_history_message");
        }
        return candidate;
      });
      await this.addMessages(normalized as never);
      return normalized.length;
    }

    /** Host is the seed for a new/forked execution; never replace admitted history. */
    @callable()
    async ensureHistory(messages: readonly unknown[]): Promise<number> {
      const existing = await this.getMessages();
      if (existing.some((message) => (message.metadata as { dshContext?: boolean } | undefined)?.dshContext !== true)) return 0;
      return messages.length === 0 ? 0 : this.importHistory(messages);
    }

    /** A durable tombstone closes the cancel-before-admission race. */
    @callable()
    async cancelInput(requestId: string): Promise<void> {
      if (typeof requestId !== "string" || requestId === "") throw new Error("invalid_request_id");
      this.ctx.storage.sql.exec("INSERT OR REPLACE INTO dsh_agent_settings (key, value) VALUES (?, 'cancelled')", `cancelled:${requestId}`);
      const execution = this.inputLedger().get(requestId);
      this.inputLedger().set(requestId, { ...execution, status: "cancelled" });
      if (execution?.sdkRequestId !== undefined) this.cancelChat(execution.sdkRequestId, "Host cancelled the input");
      const active = await this.listSubmissions({ status: ["pending", "running"] });
      for (const submission of active) {
        if (submission.idempotencyKey === requestId || submission.requestId === requestId) await this.cancelSubmission(submission.submissionId);
      }
    }

    /** Delete every persisted message in this session (user-invoked clear). */
    @callable()
    async clearHistory(): Promise<number> {
      const count = (await this.getMessages()).length;
      await this.clearMessages();
      return count;
    }

    /** Active pending/running submissions for the outbox reconciler. */
    @callable()
    async activeSubmissions(): Promise<unknown[]> {
      return this.listSubmissions({ status: ["pending", "running"] });
    }

    /** Durable cancellation across the RPC boundary. */
    @callable()
    async cancelSubmissionById(submissionId: string): Promise<unknown> {
      return this.cancelSubmission(submissionId);
    }

    /** Inspect one durable submission from the outbox reconciler. */
    @callable()
    async inspectSubmissionById(submissionId: string): Promise<unknown> {
      return this.inspectSubmission(submissionId);
    }

    /** Recent submission ledger rows for diagnostics and queue UI. */
    @callable()
    async recentSubmissions(limit = 20): Promise<unknown[]> {
      return this.listSubmissions({ limit });
    }

    /**
     * Web channel policy. Think's resolver calls messengerFromChannel() for
     * every configured channel before checking its kind, so the explicit web
     * policy must retain an ingress object even though the implicit channel
     * already owns the WebSocket transport.
     */
    configureChannels(): ReturnType<Think<Env>["configureChannels"]> {
      return {
        web: {
          kind: "web",
          capabilities: { canStream: true, canEditMessages: true },
          ingress: { transport: "websocket" },
          instructions: "You are dsh-base, a helpful AI assistant running on Cloudflare Workers.",
          maxTurns: 16,
        },
      };
    }

    /** Channel inventory for diagnostics and future provider UIs. */
    @callable()
    async channelOptions(): Promise<{ channels: string[]; active: string }> {
      return { channels: ["web"], active: "web" };
    }

    /** Durable model catalog: DeepSeek on Cloudflare AI Gateway only. */
    private modelCatalog(): string[] {
      return [...MODEL_CATALOG];
    }

    /** Current durable model selection, falling back to the deployment default. */
    private selectedModel(): string {
      if (this.activeExecutionConfig !== undefined) return this.activeExecutionConfig.model;
      const row = [...this.ctx.storage.sql.exec<{ value: string }>(
        "SELECT value FROM dsh_agent_settings WHERE key = 'model'",
      )].at(0);
      const models = this.modelCatalog();
      if (row !== undefined && models.includes(row.value)) return row.value;
      return models[0]!;
    }

    reasoningEffort(): InputExecutionConfig['reasoningEffort'] { return this.activeExecutionConfig?.reasoningEffort; }

    /** Client model catalog plus the current selection. */
    @callable()
    async modelOptions(): Promise<{ models: string[]; selected: string; contextWindow: number }> {
      const selected = this.selectedModel();
      return { models: this.modelCatalog(), selected, contextWindow: contextWindow(selected) };
    }

    /** Persist one per-session model selection. */
    @callable()
    async setModel(modelId: string): Promise<{ selected: string; contextWindow: number }> {
      const models = this.modelCatalog();
      if (typeof modelId !== "string" || !models.includes(modelId)) throw new Error("invalid_model");
      this.ctx.storage.sql.exec(
        "INSERT INTO dsh_agent_settings (key, value) VALUES ('model', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        modelId,
      );
      return { selected: modelId, contextWindow: contextWindow(modelId) };
    }

    /** Start a new turn and snapshot the assembled prompt composition. */
    async beforeTurn(ctx?: { system?: unknown; tools?: unknown; requestId?: string; model?: unknown }): Promise<Awaited<ReturnType<Think<Env>["beforeTurn"]>>> {
      const history = await this.getMessages();
      this.approvalNoticeBaseline = approvalNoticeIds(history);
      const actualUser = history.findLast(message => message.role === "user" && (message.metadata as { dshContext?: boolean } | undefined)?.dshContext !== true);
      this.liveRequestId = actualUser === undefined ? undefined : this.inputLedger().canonicalRequestId(actualUser.id);
      if (this.liveRequestId !== undefined) {
        this.activeExecutionConfig = this.inputLedger().configuration(this.liveRequestId);
        if (this.activeExecutionConfig === undefined) throw new Error('input_configuration_unavailable');
      }
      if (this.liveRequestId !== undefined && ctx?.requestId !== undefined) this.inputLedger().start(this.liveRequestId, ctx.requestId);
      // Providers report aggregate token usage, not a system/tools split.
      // Character-count guesses must not appear as measured accounting.
      this.contextBreakdown = undefined;
      this.liveTurn += 1;
      this.turnStartedAt = Date.now();
      this.stepStartedAt = undefined;
      this.firstTokenAt = undefined;
      this.turnStats = { turns: 1, steps: 0, llmMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0 };
      this.statsRequestId = ctx?.requestId;
      this.liveSettledSteps = [];
      // Capture the already resolved model for this inference, not the mutable
      // Session picker. Later model changes must never rewrite historical source.
      const model = ctx?.model;
      const modelId = typeof model === "object" && model !== null && "modelId" in model && typeof model.modelId === "string" ? model.modelId : undefined;
      const requestedModel = this.activeExecutionConfig?.model ?? modelId ?? 'unknown';
      const previousSteps = (history.at(-1)?.metadata as { dshSteps?: ModelStepEvidence[] } | undefined)?.dshSteps ?? [];
      const sdkRequestId = ctx?.requestId;
      if (this.liveRequestId !== undefined && sdkRequestId !== undefined) {
        await this.callHost('recordModelRequest', { requestId: this.liveRequestId, sdkRequestId, model: requestedModel,
          ...(this.reasoningEffort() === undefined ? {} : { reasoningEffort: this.reasoningEffort() }) }, true);
      }
      return { messageMetadata: ({ part, continuation }) => {
        const usage = this.messageMetadata({ part });
        if (part.type !== 'start' && part.type !== 'finish') return usage;
        const steps = sdkRequestId === undefined ? [] : this.inputLedger().steps(sdkRequestId).map(step=>this.liveRequestId===undefined?step:this.currentStepEvidence(step,this.liveRequestId));
        const responseModel = steps.at(-1)?.responseModel;
        return { ...usage, dshModelSource: { provider: providerForModelId(requestedModel), model: responseModel ?? 'unknown', requestedModel,
          ...(this.reasoningEffort() === undefined ? {} : { reasoningEffort: this.reasoningEffort() }) },
          dshSteps: [...(continuation ? previousSteps : []), ...steps] };
      } };
    }

    /** Time one model step from its start. */
    /** Record one tool call as soon as it is about to execute. */
    async beforeToolCall(ctx: { toolCallId?: string; toolName?: string; input?: unknown }): Promise<void> {
      await this.assertHostSessionActive();
      if (ctx.toolCallId === undefined || ctx.toolName === undefined) return;
      if (this.liveRequestId !== undefined) this.inputLedger().recordToolTiming(this.liveRequestId,ctx.toolCallId,Date.now());
      this.liveToolCalls.push({ callId: ctx.toolCallId, name: ctx.toolName, input: ctx.input, state: "running", startedAt:Date.now() });
      this.broadcastLive();
      this.scheduleLivePush(false);
    }

    /** Record one tool outcome for the live process row. */
    afterToolCall(ctx: { toolCallId?: string; toolName?: string; output?: unknown; success?: boolean }): void {
      if (ctx.toolCallId === undefined) return;
      const row = this.liveToolCalls.find(call => call.callId === ctx.toolCallId);
      if (row === undefined) return;
      row.state = "done";
      row.endedAt = Date.now();
      if (this.liveRequestId !== undefined) this.inputLedger().recordToolTiming(this.liveRequestId,ctx.toolCallId,row.endedAt,true);
      row.output = ctx.success === false ? { error: String(ctx.output ?? "tool failed") } : ctx.output;
      this.broadcastLive();
      this.scheduleLivePush(false);
    }

    async beforeStep(ctx?: { readonly messages?: readonly unknown[]; readonly stepNumber?: number }): Promise<{ readonly messages?: readonly unknown[] } | void> {
      await this.assertHostSessionActive();
      this.liveStep += 1;
      this.liveAttemptId = crypto.randomUUID();
      this.liveStepId = this.statsRequestId === undefined ? undefined : `${this.statsRequestId}:${this.turnStats.steps}`;
      this.liveRevision = 0;
      this.liveChunks = [];
      this.liveToolCalls = [];
      this.liveToolIndices.clear();
      this.liveBlockIndices.clear();
      this.liveToolCallTimes.clear();
      this.stepStartedAt = Date.now();
      if (this.liveRequestId !== undefined && this.statsRequestId !== undefined && this.liveStepId !== undefined) {
        this.stepStartedAt = this.inputLedger().startStep(this.statsRequestId, this.liveStepId, this.stepStartedAt);
        // Persist the entered Step before inference/live delivery. A provider
        // failure with no tokens or assistant message must survive reload.
        await this.callHost('recordStepStart', { requestId: this.liveRequestId, sdkRequestId: this.statsRequestId,
          stepId: this.liveStepId, startedAt: this.stepStartedAt }, true);
      }
      this.broadcastLive();
      this.scheduleLivePush(true);
      this.firstTokenAt = undefined;
      // A policy change queues context only; it never starts an inference. Read
      // current facts at the actual next Step, including approval continuations.
      const modelMessages = [...(ctx?.messages ?? [])];
      try {
        const snapshot = await this.injectStepTime();
        modelMessages.push({role:'user',content:snapshot});
      } catch (error) {
        this.contextInjectionError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      }
      const messages = await prepareApprovalContext(this.session, await this.callHost('approvalModelContext', {}), this.approvalNoticeBaseline, modelMessages);
      return Array.isArray(ctx?.messages) ? {messages} : undefined;
    }

    /** Record the first visible stream delta as the TTFT boundary. */
    onChunk(ctx: { chunk?: { type?: string; index?: number; textDelta?: string; delta?: string; text?: string; id?: string; toolName?: string; toolCallId?:string } }): void {
      const chunk = ctx.chunk;
      if (chunk === undefined) return;
      if (chunk.type === 'tool-call' && chunk.toolCallId !== undefined) { this.liveToolCallTimes.set(chunk.toolCallId,Date.now()); return; }
      if (chunk.type === 'tool-input-start' && chunk.id !== undefined) {
        const index = this.liveBlockIndices.size;
        this.liveBlockIndices.set(`tool:${chunk.id}`, index);
        this.liveToolIndices.set(chunk.id, index);
        this.liveChunks.push({ type: 'tool-call-delta', index, id: chunk.id, ...(chunk.toolName === undefined ? {} : { name: chunk.toolName }), text: '', time: Date.now() });
      } else if (chunk.type === 'tool-input-delta' && chunk.id !== undefined && this.liveToolIndices.has(chunk.id)) {
        this.liveChunks.push({ type: 'tool-call-delta', index: this.liveToolIndices.get(chunk.id)!, id: chunk.id, text: chunk.delta ?? '', time: Date.now() });
      } else if (chunk.type !== "text-delta" && chunk.type !== "reasoning-delta") return;
      else {
      const text = chunk.textDelta ?? chunk.delta ?? chunk.text ?? "";
      if (text === "") return;
      if (this.firstTokenAt === undefined) this.firstTokenAt = Date.now();
      const key = `${chunk.type}:${chunk.id ?? chunk.index ?? 0}`;
      if (!this.liveBlockIndices.has(key)) this.liveBlockIndices.set(key, this.liveBlockIndices.size);
      this.liveChunks.push({ type: chunk.type, index: this.liveBlockIndices.get(key)!, text, time: Date.now() });
      }
      this.liveRevision += 1;
      this.broadcastLive();
      this.scheduleLivePush(false);
    }

    /** Accept one browser live socket so chunks can bypass RPC while the turn is running. */
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      if (url.pathname.endsWith("/live-stream")) {
        if ((request.headers.get("upgrade") ?? "").toLowerCase() !== "websocket") {
          return new Response("Expected WebSocket", { status: 426 });
        }
        const pair = new (globalThis as unknown as { WebSocketPair: new () => [never, never] }).WebSocketPair() as unknown as [unknown, unknown];
        const client = pair[0];
        const server = pair[1] as unknown as {
          accept(): void;
          send(data: string): void;
          close(code?: number, reason?: string): void;
          addEventListener(type: string, listener: () => void): void;
        };
        server.accept();
        this.liveSockets.add(server);
        server.addEventListener("close", () => { this.liveSockets.delete(server); });
        this.broadcastLive();
        return new Response(null, { status: 101, webSocket: client as never });
      }
      return super.fetch(request);
    }

    /** Push one live snapshot to every accepted browser socket. */
    private broadcastLive(): void {
      const live = this.liveAttemptId === undefined ? null : {
        attemptId: this.liveAttemptId, ...(this.liveRequestId === undefined ? {} : { requestId: this.liveRequestId }), turn: this.liveTurn, step: this.liveStep, revision: this.liveRevision,
        chunks: this.liveChunks, tools: this.liveToolCalls, stepId:this.liveStepId, startedAt: this.stepStartedAt, settledMessages: this.settledStepMessages(),
      };
      const message = JSON.stringify({ live });
      for (const socket of this.liveSockets) {
        try { socket.send(message); } catch { this.liveSockets.delete(socket); }
      }
    }

    /** Push the current live attempt into the owning SessionHost Durable Object. */
    private scheduleLivePush(immediate: boolean): void {
      if (this.livePushScheduled) return;
      this.livePushScheduled = true;
      setTimeout(() => {
        this.livePushScheduled = false;
        const task = this.pushLiveAttempt();
        const ctx = this.ctx as unknown as { waitUntil?: (promise: Promise<unknown>) => void };
        if (ctx.waitUntil !== undefined) ctx.waitUntil(task);
        else void task;
      }, immediate ? 0 : 25);
    }

    private async pushLiveAttempt(): Promise<void> {
      const sessionId = this.name;
      const env = this.env as unknown as { SESSION_HOST?: { idFromName(name: string): unknown; get(id: unknown): { fetch(input: string, init?: RequestInit): Promise<Response> } }; AUTH_SECRET?: string };
      if (sessionId === undefined || env.SESSION_HOST === undefined) return;
      const stub = env.SESSION_HOST.get(env.SESSION_HOST.idFromName(sessionId));
      const body = JSON.stringify({ live: this.liveAttemptId === undefined ? undefined : {
        attemptId: this.liveAttemptId, ...(this.liveRequestId === undefined ? {} : { requestId: this.liveRequestId }), turn: this.liveTurn, step: this.liveStep, revision: this.liveRevision,
        chunks: this.liveChunks, tools: this.liveToolCalls, stepId:this.liveStepId, startedAt: this.stepStartedAt, settledMessages: this.settledStepMessages(),
      } });
      await stub.fetch(`https://session-host/api/session-host/internal/live?sessionId=${encodeURIComponent(sessionId)}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-dsh-live-token": env.AUTH_SECRET ?? "" },
        body,
      }).catch(() => {});
    }

    /** Current live attempt for the Host's live stream endpoint. */
    /**
     * Resolve one approval-requested tool call outside Think's chat protocol.
     *
     * The Workers Host drives turns through RPC/claims rather than Think's chat
     * client, so it owns the approval card. This bridge applies the recorded
     * decision and continues the paused turn, which executes the approved tool.
     * @param input - correlated tool call and the human decision.
     * @returns whether the transcript accepted the approval update.
     */
    private inputLedger(): InputExecutionLedger { return new InputExecutionLedger(this.ctx.storage); }

    /** Read evidence updated by late approval execution without rewriting SDK content. */
    async getMessages(): ReturnType<Think<Env>['getMessages']> {
      const messages = await super.getMessages();
      let requestId: string | undefined;
      return messages.map(message => {
        if (message.role === 'user' && (message.metadata as {dshContext?:boolean}|undefined)?.dshContext !== true) requestId = this.inputLedger().canonicalRequestId(message.id);
        const metadata = message.metadata as {dshSteps?:ModelStepEvidence[]}|undefined;
        if (message.role !== 'assistant' || !Array.isArray(metadata?.dshSteps) || requestId === undefined) return message;
        return {...message,metadata:{...(typeof message.metadata === 'object' && message.metadata !== null ? message.metadata : {}),dshSteps:metadata.dshSteps.map(step=>this.currentStepEvidence(step,requestId!))}};
      });
    }

    private currentStepEvidence(step: ModelStepEvidence, requestId: string): ModelStepEvidence {
      const calls = step.parts.filter(part=>typeof part==='object' && part!==null && 'toolCallId' in part) as {toolCallId:string}[];
      const toolTimings = calls.flatMap(call=> {
        const timing=this.inputLedger().toolTiming(requestId,call.toolCallId) ?? step.toolTimings?.find(item=>item.callId===call.toolCallId);
        return timing===undefined?[]:[timing];
      });
      return {...step,toolTimings,assistantAt:step.assistantAt??step.endedAt,endedAt:Math.max(step.endedAt,...toolTimings.map(timing=>timing.endedAt??step.endedAt))};
    }

    /** Actual SDK response lifecycle, correlated back to the applied user input. */
    async onChatResponse(result: Parameters<Think<Env>["onChatResponse"]>[0]): Promise<void> {
      const ledger = this.inputLedger();
      const requestId = ledger.userFor(result.requestId);
      if (requestId === undefined) return;
      const previous = ledger.statistics(result.requestId);
      const stats = this.statsRequestId === result.requestId ? { ...this.turnStats, contextBreakdown: this.contextBreakdown } : previous;
      const usage = (result.message?.metadata as { usage?: ExecutionStatistics["usage"] } | undefined)?.usage;
      ledger.recordStatistics({ sdkRequestId: result.requestId,
        steps: stats?.steps ?? 0, llmMs: stats?.llmMs ?? 0, ttftMs: stats?.ttftMs ?? 0, ttftSteps: stats?.ttftSteps ?? 0, decodeMs: stats?.decodeMs ?? 0, decodeTokens: stats?.decodeTokens ?? 0,
        ...(stats?.contextBreakdown === undefined ? {} : { contextBreakdown: stats.contextBreakdown }),
        ...(usage === undefined ? {} : { usage }),
      }, true);
      const pending = await this.inputAwaitingApproval(requestId);
      ledger.settle(requestId, result.requestId,
        result.status === "aborted" ? "cancelled" : result.status === "error" ? "failed" : pending ? "awaiting-approval" : "completed",
        result.error);
    }

    private async inputAwaitingApproval(requestId: string): Promise<boolean> {
      const messages = await this.getMessages();
      const start = messages.findIndex(message => message.id === this.inputLedger().userMessageId(requestId));
      if (start === -1) throw new Error("approval_input_not_found");
      for (const message of messages.slice(start + 1)) {
        if (message.role === "user" && (message.metadata as { dshContext?: boolean } | undefined)?.dshContext !== true) break;
        if (message.parts.some(part => "state" in part && part.state === "approval-requested")) return true;
      }
      return (await this.pendingApprovals()).length > 0;
    }

    @callable()
    async getInputExecution(requestId: string): Promise<InputExecution | undefined> { return this.inputLedger().get(requestId); }

    /** Stable accounting for one SDK execution, including approval continuations. */
    @callable()
    async getExecutionStats(sdkRequestId: string): Promise<ExecutionStatistics | undefined> {
      const value = this.inputLedger().statistics(sdkRequestId);
      if (!value?.complete) return undefined;
      const { complete: _complete, ...statistics } = value;
      return statistics;
    }

    @callable()
    async beginInputContinuation(requestId: string, approvalId: string, userMessageId?: string): Promise<InputExecution> {
      if (!requestId || !approvalId) throw new Error("invalid_continuation_identity");
      const actualId = userMessageId ?? this.inputLedger().userMessageId(requestId);
      const message = await this.session.getMessage(actualId);
      if (message?.role !== "user") throw new Error("approval_input_not_found");
      this.inputLedger().bindUser(requestId, actualId);
      this.activeExecutionConfig = this.inputLedger().configuration(requestId);
      if (this.activeExecutionConfig === undefined) throw new Error('input_configuration_unavailable');
      return this.inputLedger().begin(requestId, approvalId);
    }

    /** Apply each decision once; let the actual SDK finish or recover the continuation. */
    @callable()
    async resolveToolApproval(input: { requestId: string; userMessageId?: string; toolCallId: string; approved: boolean }): Promise<{ resolved: boolean } & InputExecution> {
      const key = `${input.requestId}:${input.toolCallId}`;
      this.inputLedger().decision(input.requestId, input.toolCallId, input.approved);
      const existing = this.approvalWork.get(key);
      if (existing !== undefined) return existing;
      const work = this.approvalTail.then(() => this.resolveInputToolApproval(input));
      this.approvalTail = work.catch(() => undefined);
      this.approvalWork.set(key, work);
      try { return await work; } finally { this.approvalWork.delete(key); }
    }

    private async resolveInputToolApproval(input: { requestId: string; userMessageId?: string; toolCallId: string; approved: boolean }): Promise<{ resolved: boolean } & InputExecution> {
      const ledger = this.inputLedger();
      const approvalId = input.toolCallId;
      const before = await this.beginInputContinuation(input.requestId, approvalId, input.userMessageId);
      const intent = ledger.intent(input.requestId, approvalId);
      if (intent?.phase === "started" || intent?.phase === "settled" || before.status === "cancelled" || before.status === "completed" || before.status === "failed") return { resolved: true, ...before };
      const messages = await this.getMessages();
      const start = messages.findIndex(message => message.id === ledger.userMessageId(input.requestId));
      if (start === -1) throw new Error("approval_input_not_found");
      let found = false;
      for (const message of messages.slice(start + 1)) {
        if (message.role === "user" && (message.metadata as { dshContext?: boolean } | undefined)?.dshContext !== true) break;
        if (message.parts.some(part => "toolCallId" in part && part.toolCallId === input.toolCallId)) found = true;
      }
      if (!found) throw new Error("approval_tool_not_found");
      // The pinned SDK has no public tool-decision API outside its WebSocket
      // protocol. This existing compatibility seam calls only its idempotent
      // state transition; inference uses the public protected continuation API.
      const apply = (this as unknown as { _applyToolApproval?: (toolCallId: string, approved: boolean) => Promise<void> })._applyToolApproval;
      if (typeof apply !== "function") throw new Error("approval_runtime_unavailable");
      await apply.call(this, input.toolCallId, input.approved);
      if (await this.inputAwaitingApproval(input.requestId)) {
        return { resolved: true, ...ledger.settle(input.requestId, undefined, "awaiting-approval") };
      }
      try {
        // Rejection is a tool result, not a cancellation of the user request.
        // Both decisions continue after all parallel approval cards settle.
        const result = await this.continueLastTurn(undefined, { channel: "approval" });
        const pending = await this.inputAwaitingApproval(input.requestId);
        const current = ledger.settle(input.requestId, result.requestId || undefined,
          result.status === "aborted" ? "cancelled" : result.status === "error" || result.status === "skipped" ? "failed" : pending ? "awaiting-approval" : "completed",
          result.error ?? (result.status === "skipped" ? "Approval continuation was skipped" : undefined));
        return { resolved: true, ...current };
      } catch (error) {
        // A failed RPC/isolate does not prove durable inference failed. Its
        // beforeTurn intent remains running and recovery owns the outcome.
        if (ledger.intent(input.requestId, approvalId)?.phase === "prepared") ledger.settle(input.requestId, undefined, "failed", error instanceof Error ? error.message : String(error));
        throw error;
      } finally {
        this.liveChunks = [];
        this.liveAttemptId = undefined;
        this.broadcastLive();
        await this.pushLiveAttempt();
      }
    }

    @callable()
    async getLiveAttempt(): Promise<{
      attemptId: string;
      requestId?: string;
      turn: number;
      step: number;
      revision: number;
      startedAt?: number;
      stepId?: string;
      settledMessages?: readonly { id: string; role: string; parts: readonly unknown[] }[];
      chunks: ReadonlyArray<{ type: string; index: number; text: string }>;
      tools: ReadonlyArray<{ callId: string; name: string; input?: unknown; state: "running" | "done"; output?: unknown }>;
    } | undefined> {
      if (this.liveAttemptId === undefined) return undefined;
      return {
        attemptId: this.liveAttemptId,
        ...(this.liveRequestId === undefined ? {} : { requestId: this.liveRequestId }),
        turn: this.liveTurn,
        step: this.liveStep,
        revision: this.liveRevision,
        chunks: this.liveChunks,
        tools: this.liveToolCalls,
        startedAt: this.stepStartedAt,
        stepId:this.liveStepId,
        settledMessages: this.settledStepMessages(),
      };
    }

    /** Fold one completed step's wall times and output token count. */
    onStepEnd(ctx: { usage?: { outputTokens?: number }; text?: string; reasoningText?: string; reasoning?: unknown; content?: readonly unknown[]; toolCalls?: readonly { toolCallId: string; toolName: string; input: unknown }[]; toolResults?: readonly { toolCallId: string; output?: unknown }[]; response?: { modelId?: string } }): void {
      const start = this.stepStartedAt;
      const first = this.firstTokenAt;
      if (start === undefined) return;
      const end = Date.now();
      if (this.statsRequestId !== undefined) {
        const evidence: ModelStepEvidence = { id: `${this.statsRequestId}:${this.turnStats.steps}`, startedAt: start, endedAt: end, assistantAt:end,
          requestedModel: this.selectedModel(), ...(this.reasoningEffort() === undefined ? {} : { reasoningEffort: this.reasoningEffort() }),
          ...(ctx.response?.modelId === undefined ? {} : { responseModel: ctx.response.modelId }), chunks: [...this.liveChunks],
          toolTimings: this.liveToolCalls.map(({callId,startedAt,endedAt}) => ({callId,startedAt,...(endedAt === undefined ? {} : {endedAt})})),
          toolCallTimes:[...this.liveToolCallTimes].map(([callId,time])=>({callId,time})),
          parts: [
            ...(ctx.reasoningText ? [{ type: 'reasoning', text: ctx.reasoningText }] : Array.isArray(ctx.reasoning) ? ctx.reasoning.filter(part => part?.type === 'reasoning' && typeof part.text === 'string').map(part => ({type:'reasoning',text:part.text})) : []),
            ...(ctx.text ? [{ type: 'text', text: ctx.text }] : []),
            ...(ctx.toolCalls ?? []).map(call => {
              const result = ctx.toolResults?.find(item => item.toolCallId === call.toolCallId);
              const failure = ctx.content?.find(item => typeof item === 'object' && item !== null && (item as {toolCallId?:unknown}).toolCallId === call.toolCallId && ['tool-error','tool-output-denied'].includes(String((item as {type?:unknown}).type))) as {type?:string;error?:unknown}|undefined;
              return { type: `tool-${call.toolName}`, toolName: call.toolName, toolCallId: call.toolCallId, input: call.input,
                state: failure?.type === 'tool-output-denied' ? 'output-denied' : failure ? 'output-error' : result === undefined ? 'input-available' : 'output-available',
                ...(failure === undefined ? {} : {errorText: String(failure.error ?? 'Tool approval denied')}), ...(result === undefined ? {} : { output: result.output }) };
            }),
          ],
        };
        this.inputLedger().recordStep(this.statsRequestId, evidence);
        this.liveSettledSteps = [...this.inputLedger().steps(this.statsRequestId)];
        this.broadcastLive(); this.scheduleLivePush(true);
      }
      this.turnStats.steps += 1;
      this.turnStats.llmMs += Math.max(0, end - start);
      if (first !== undefined) {
        this.turnStats.ttftMs += Math.max(0, first - start);
        this.turnStats.ttftSteps += 1;
        this.turnStats.decodeMs += Math.max(0, end - first);
        this.turnStats.decodeTokens += ctx.usage?.outputTokens ?? 0;
      }
      this.stepStartedAt = undefined;
      this.firstTokenAt = undefined;
      if (this.statsRequestId !== undefined) this.inputLedger().recordStatistics({ sdkRequestId: this.statsRequestId, ...this.turnStats, contextBreakdown: this.contextBreakdown }, false);
    }

    private settledStepMessages() {
      return this.liveSettledSteps.map(step => ({ id: `dsh-sdk-step:${step.id}`, role: 'assistant', parts: [
        ...step.parts, { type: 'data-dsh-step', data: { ...step, parts: undefined } },
        { type: 'data-dsh-model-source', data: { provider: providerForModelId(step.requestedModel), model: step.responseModel ?? 'unknown', requestedModel: step.requestedModel, reasoningEffort: step.reasoningEffort } },
      ] }));
    }

    /** Host claim takes the completed turn's timings once. */
    @callable()
    async takeTurnStats(): Promise<typeof this.turnStats & { contextBreakdown?: { systemTokens: number; toolsTokens: number } }> {
      const stats = this.turnStats;
      this.turnStats = { turns: 0, steps: 0, llmMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0 };
      this.liveChunks = [];
      this.liveAttemptId = undefined;
      this.broadcastLive();
      void this.pushLiveAttempt();
      return { ...stats, ...(this.contextBreakdown === undefined ? {} : {contextBreakdown:this.contextBreakdown}) };
    }

    getModel(): ThinkModel {
      const modelId = this.selectedModel();
      const provider = this.activePlugins().find((plugin) => plugin.model
        && (plugin.matchesModel?.(this.env, modelId) ?? true));
      if (!provider?.model) throw new Error(`dsh-base composition has no model provider for ${modelId}`);
      return provider.model(this.env, modelId, this);
    }

    /** Human-readable label for the selected model id. */
    private modelLabel(): string {
      return this.selectedModel() === "deepseek-v4-pro" ? "DeepSeek-V4-Pro" : "DeepSeek-V4.1-Flash";
    }

    /** Provider description for the identity section. */
    private providerLabel(): string {
      return this.selectedModel().startsWith("cloudflare-ai-gateway/") ? "Cloudflare AI Gateway" : "the user's configured DeepSeek API credential";
    }

    /** Build the official prompt registry on first use (sections are static; values render fresh). */
    private ensurePromptRegistry(): WorkerSystemPrompt | undefined {
      if (this.promptRegistry !== undefined) return this.promptRegistry;
      try {
        const personaPrefix = this.activePlugins().find((plugin) => plugin.persona !== undefined)?.persona ?? "";
        const registry = new WorkerSystemPrompt({ personaPrefix });
        registry.variable("model", () => this.modelLabel());
        registry.variable("model_id", () => this.selectedModel());
        registry.variable("model_provider", () => this.providerLabel());
        registry.variable("current_time_utc", () => new Date().toISOString());
        // Product presentation listener: normalize the assembled sections before
        // the official renderer joins them, keeping the prompt free of accidental
        // triple blank lines and trailing whitespace.
        registry.waterfall((assembly) => {
          const sections = (assembly as { sections?: Array<{ text?: string }> }).sections;
          if (!Array.isArray(sections)) return;
          for (const section of sections) {
            if (typeof section.text !== "string") continue;
            section.text = section.text.replace(/\n{3,}/gu, "\n\n").trimEnd();
          }
        });
        registry.section({
          name: "agent:model-identity",
          order: 5900,
          text: "You are {{model}} (model id {{model_id}}), served by {{model_provider}}. When the user asks which model or assistant you are, state this model identity directly. Do not claim that the deployment withholds the model name, and do not answer that you cannot know which model you are.",
        });
        registry.section({
          name: "agent:memory",
          order: 6100,
          text: () => {
            const facts = this.listFacts();
            return facts.length === 0 ? "" : `Durable facts the user asked you to remember:\n${facts.map((fact) => `- ${fact}`).join("\n")}`;
          },
        });
        registry.section({
          name: "agent:runtime",
          order: "HARNESS_SOURCE",
          text: "Runtime: Cloudflare Workers Durable Object (Workers-native Host).",
        });
        for (const plugin of this.activePlugins()) {
          for (const contribution of plugin.prompt?.(this.env, this) ?? []) registry.section(contribution);
        }
        this.promptRegistry = registry;
        return registry;
      } catch (error) {
        this.promptError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        if (!this.promptFailureReported) {
          this.promptFailureReported = true;
          console.error("dsh-base think: official system-prompt registry unavailable, using fallback", error);
        }
        return undefined;
      }
    }

    /** Internal Host stub for retry-event forwarding. */
    /** Parent Sessions share the durable Host archive gate before model and tool steps. */
    private async assertHostSessionActive(): Promise<void> {
      const name = (this.ctx as unknown as { readonly id?: { readonly name?: string } }).id?.name;
      if (typeof name !== "string" || !name.startsWith("owner:")) return;
      const stub = this.sessionHostStub();
      if (stub === undefined) throw new Error("Session activity gate unavailable");
      await assertSessionActive(stub, this.hostSessionId());
    }

    async readUploadedFile(receiptId: string, offset?: number, limit?: number): Promise<UploadedFilePage> {
      return readUploadedFile(this.sessionHostStub(), this.hostSessionId(), receiptId, offset, limit);
    }

    private sessionHostStub(): { fetch(request: Request): Promise<Response> } | undefined {
      const env = this.env as unknown as {
        readonly SESSION_HOST?: DurableObjectNamespace;
        readonly SESSION_HOST_GENERATION?: string;
      };
      const name = (this.ctx as unknown as { readonly id?: { readonly name?: string } }).id?.name;
      if (env.SESSION_HOST === undefined || env.SESSION_HOST_GENERATION === undefined || typeof name !== "string") return undefined;
      const rest = name.startsWith("owner:") ? name.slice("owner:".length) : name;
      const separator = rest.indexOf(":");
      if (separator <= 0) return undefined;
      return env.SESSION_HOST.get(env.SESSION_HOST.idFromName(`owner:${rest.slice(0, separator)}:${env.SESSION_HOST_GENERATION}`));
    }

    private async callHost(method: string, params: Record<string, unknown>, internal = false): Promise<unknown> {
      const stub = this.sessionHostStub();
      const name = (this.ctx as unknown as {id?:{name?:string}}).id?.name;
      if (stub === undefined) {
        if (name?.startsWith('owner:')) throw new Error('Session Host policy unavailable');
        return undefined; // isolated hook tests have no deployed owner transport
      }
      const secret = (this.env as unknown as {AUTH_SECRET?:string}).AUTH_SECRET;
      if (internal && !secret) throw new Error('Session Host internal authentication unavailable');
      const response = await stub.fetch(new Request('https://session-host/api/session-host', {method:'POST', headers:{'content-type':'application/json', ...(internal ? {'x-dsh-internal-token':secret!} : {})},
        body:JSON.stringify({method,params:{sessionId:this.hostSessionId(),...params}})}));
      const body = await response.json() as {result?:unknown;error?:unknown};
      if (!response.ok || body.error !== undefined || !Object.hasOwn(body,'result')) throw new Error(`${method} failed`);
      return body.result;
    }

    async authorizeAction(ctx: Parameters<Think<Env>['authorizeAction']>[0]): Promise<Awaited<ReturnType<Think<Env>['authorizeAction']>>> {
      const policy = await this.callHost('permissionSnapshot', {}) as {approval?:string}|undefined;
      if ((ctx.kind === 'approval-gated' || ctx.kind === 'durable-pause') && policy?.approval === 'never') return {allowed:false,reason:'permission/denied: approval-disabled'};
      return super.authorizeAction(ctx);
    }

    /** Forward one model retry to the Host session event log (official nodes read these). */
    private async emitModelRetry(failure: { readonly message: string }, retry: number): Promise<void> {
      const stub = this.sessionHostStub();
      const name = (this.ctx as unknown as { readonly id?: { readonly name?: string } }).id?.name;
      const sessionId = typeof name === "string" ? name.slice(name.lastIndexOf(":") + 1) : "";
      if (stub === undefined || sessionId === "") return;
      const payload = {
        retryId: `retry-${this.liveTurn}-${this.liveStep}-${retry}`,
        turn: this.liveTurn,
        step: this.liveStep,
        provider: "deepseek",
        mode: "normal",
        policyKey: "default",
        retry,
        maxRetries: 2,
        delayMs: 0,
        failure: { kind: "transient", message: failure.message },
      };
      await this.emitSessionEvent(sessionId, "llm/retry", payload).catch(() => undefined);
      await this.emitSessionEvent(sessionId, "llm/retry-started", { retryId: payload.retryId, turn: payload.turn, step: payload.step, retry }).catch(() => undefined);
    }

    /** Append one Host session event (official transcript nodes consume these). */
    private async emitSessionEvent(sessionId: string, type: string, payload: unknown): Promise<void> {
      const stub = this.sessionHostStub();
      if (stub === undefined || sessionId === "") return;
      await stub.fetch(new Request("https://session-host/api/session-host", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method: "appendSessionEvent", params: { sessionId, type, payload } }),
      }));
    }

    /** Session id parsed from the owner-scoped Agent name. */
    private hostSessionId(): string {
      const name = (this.ctx as unknown as { readonly id?: { readonly name?: string } }).id?.name;
      return typeof name === "string" ? name.slice(name.lastIndexOf(":") + 1) : "";
    }

    /** Map Think message ids to Host event seqs for shadowed compaction ranges. */
    private async shadowedSeqs(sessionId: string, excludeFirstId: string | undefined): Promise<number[]> {
      const stub = this.sessionHostStub();
      if (stub === undefined || sessionId === "") return [];
      try {
        const response = await stub.fetch(new Request("https://session-host/api/session-host", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ method: "page", params: { address: { kind: "session", sessionId }, limit: 100 } }),
        }));
        const body = await response.json() as { result?: { records?: Array<{ id: string; seq: number }> } };
        return (body.result?.records ?? []).filter((record) => record.id !== excludeFirstId).map((record) => record.seq);
      } catch {
        return [];
      }
    }

    /**
     * Configure Think compaction with model summarization. Both manual and
     * automatic compactions flow through this wrapper, which emits the official
     * `compaction/start|summary|end` session events the transcript nodes read.
     */
    configureSession(thinkSession: Parameters<Think<Env>["configureSession"]>[0]): ReturnType<Think<Env>["configureSession"]> {
      const summarize = async (prompt: string): Promise<string> => {
        const model = (this as unknown as { resolveModel(model?: unknown): unknown }).resolveModel(this.getModel());
        const result = await generateText({ model: model as never, prompt });
        return result.text;
      };
      const compactFn = createCompactFunction({ summarize });
      thinkSession.onCompaction(async (messages) => {
        const sessionId = this.hostSessionId();
        const compactionId = `compaction-${Date.now()}`;
        const before = await this.getMessages();
        const seqs = await this.shadowedSeqs(sessionId, before[0]?.id);
        await this.emitSessionEvent(sessionId, "compaction/start", { compactionId, turn: null }).catch(() => undefined);
        try {
          const result = await compactFn(messages);
          if (result !== null && result !== undefined) {
            const summaryText = typeof result.summary === "string" ? result.summary : "Conversation compacted.";
            await this.emitSessionEvent(sessionId, "compaction/summary", {
              compactionId,
              summary: [{ type: "text", text: summaryText }],
              shadowedRange: seqs.length === 0 ? { start: 1, end: Math.max(1, before.length) } : { start: seqs[0], end: seqs.at(-1) },
              shadowedSeqs: seqs,
              shadowedTokenCount: 0,
              provider: "deepseek",
              model: this.selectedModel(),
              rawOutput: [{ type: "text", text: summaryText }],
            }).catch(() => undefined);
          }
          await this.emitSessionEvent(sessionId, "compaction/end", { compactionId, turn: null }).catch(() => undefined);
          return result;
        } catch (error) {
          await this.emitSessionEvent(sessionId, "compaction/end", {
            compactionId,
            turn: null,
            error: error instanceof Error ? error.message : String(error),
          }).catch(() => undefined);
          throw error;
        }
      });
      thinkSession.onCompactionError((error) => {
        const message = error instanceof Error ? error.message : String(error);
        void this.emitSessionEvent(this.hostSessionId(), "compaction/end", {
          compactionId: `compaction-error-${Date.now()}`,
          turn: null,
          error: message,
        }).catch(() => undefined);
      });
      // Enable automatic compaction near the model context limit.
      thinkSession.compactAfter(800_000);
      return thinkSession;
    }

    /** Manual compaction used by operators/acceptance; events come from the wrapper. */
    @callable()
    async compactNow(): Promise<{ compacted: boolean }> {
      try {
        const result = await (this as unknown as { session: { compact(): Promise<unknown> } }).session.compact();
        return { compacted: result !== null && result !== undefined };
      } catch {
        return { compacted: false };
      }
    }

    /** Called by the model provider when an SDK retry is starting. */
    noteModelRetry(failure: { readonly message: string }): void {
      this.modelRetries += 1;
      void this.emitModelRetry(failure, this.modelRetries);
    }

    /**
     * Read working directory and workspace instruction files from the owner's
     * Session Host Durable Object through the internal binding. This uses the
     * existing Host methods, so no Host generation bump or data migration is
     * involved. New admission fails closed if an authoritative read fails.
     */
    private async refreshWorkspaceContext(): Promise<void> {
      const env = this.env as unknown as {
        readonly SESSION_HOST?: DurableObjectNamespace;
        readonly SESSION_HOST_GENERATION?: string;
      };
      const name = (this.ctx as unknown as { readonly id?: { readonly name?: string } }).id?.name;
      if (env.SESSION_HOST === undefined || env.SESSION_HOST_GENERATION === undefined || typeof name !== "string") return;
      const rest = name.startsWith("owner:") ? name.slice("owner:".length) : name;
      const separator = rest.indexOf(":");
      if (separator <= 0) return;
      const ownerId = rest.slice(0, separator);
      const sessionId = rest.slice(separator + 1);
      if (sessionId === "") return;
      try {
        const stub = env.SESSION_HOST.get(env.SESSION_HOST.idFromName(`owner:${ownerId}:${env.SESSION_HOST_GENERATION}`));
        const call = async (method: string, params: Record<string, unknown>): Promise<unknown> => {
          const response = await stub.fetch(new Request("https://session-host/api/session-host", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ method, params }),
          }));
          const body = await response.json() as { readonly result?: unknown; readonly error?: { readonly code?: string } };
          if (!response.ok || body.error !== undefined || !("result" in body)) {
            const error = new Error(`${method} failed: ${body.error?.code ?? response.status}`);
            Object.assign(error, { code: body.error?.code });
            throw error;
          }
          return body.result;
        };
        const listed = await call("list", {}) as { readonly sessions?: ReadonlyArray<{ readonly sessionId: string; readonly cwd?: string }> };
        const session = listed.sessions?.find((entry) => entry.sessionId === sessionId);
        if (session === undefined) throw new Error("Workspace context Session not found");
        const workspaceCwd = session.cwd ?? "/";
        const settings = await call("settingsDescribe", {}) as {
          readonly values?: Record<string, Record<string, unknown>>;
        };
        const client = settings.values?.["dsh-base:client"];
        const clientTimeZone = typeof client?.timeZone === "string" && client.timeZone !== "" ? client.timeZone : undefined;
        const global = settings.values?.["dsh-base:instructions"];
        const globalInstructions = typeof global?.text === "string" ? global.text : "";
        const permission = await call('permissionSnapshot',{sessionId}) as {currentValue?:unknown};
        if (typeof permission.currentValue !== 'string') throw new Error('Session permission snapshot is unavailable');
        const permissionPreset = permission.currentValue;
        const candidates = ["AGENTS.md", "CLAUDE.md", "AGENTS.local.md", "CLAUDE.local.md"];
        // Official discovery walks the project chain broad-to-specific. The
        // workspace root is this Host's project root; sessions whose cwd is a
        // nested directory get each ancestor directory's candidates as well.
        const cwdSegments = (workspaceCwd === "/" ? "" : workspaceCwd)
          .split("/").filter((segment) => segment !== "" && segment !== ".");
        const directories = [""];
        for (const segment of cwdSegments) directories.push(directories.at(-1) === "" ? segment : `${directories.at(-1)}/${segment}`);
        const chunks: string[] = [];
        let remaining = 65_536;
        const seen = new Set<string>();
        this.workspaceReadLog = [];
        for (const directory of directories) {
          for (const candidate of candidates) {
            if (remaining <= 0) break;
            const path = directory === "" ? candidate : `${directory}/${candidate}`;
            try {
              // Missing is authoritative absence, not a transient error.
              // Retry other failures once, then stop admission instead of
              // silently keeping obsolete or partially loaded instructions.
              let page: { readonly text?: string } | undefined;
              for (let attempt = 0; attempt < 2; attempt += 1) {
                try {
                  page = await call("workspaceFileRead", { sessionId, path, offset: 1, limit: 5000 }) as { readonly text?: string };
                  break;
                } catch (error) {
                  if ((error as { code?: string }).code === "workspace-file/not-found") break;
                  if (attempt === 1) throw error;
                  await new Promise((resolve) => setTimeout(resolve, 100));
                }
              }
              if (page === undefined) continue;
              if (typeof page.text !== "string") throw new Error(`Invalid workspace instruction response: ${path}`);
              this.workspaceReadLog.push({ path, ok: true, bytes: page.text.length });
              const trimmed = page.text.trim();
              if (trimmed === "" || seen.has(trimmed)) continue;
              seen.add(trimmed);
              const text = page.text.length > remaining ? `${page.text.slice(0, remaining)}\n[truncated]` : page.text;
              chunks.push(`### ${path}\n${text}`);
              remaining -= text.length;
            } catch (error) {
              this.workspaceReadLog.push({ path, ok: false, error: error instanceof Error ? error.message : String(error) });
              throw error;
            }
          }
        }
        this.workspaceCwd = workspaceCwd;
        this.clientTimeZone = clientTimeZone;
        this.globalInstructions = globalInstructions;
        this.permissionPreset = permissionPreset;
        this.workspaceInstructions = chunks.length === 0 ? "" : `Workspace instruction files (loaded from the Session Workspace):\n\n${chunks.join("\n\n")}`;
        this.lastRefreshError = undefined;
      } catch (error) {
        this.lastRefreshError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        throw error;
      }
    }

    /** One durable user-role context message for the official-style snapshots. */
    private contextMessage(id: string, kind: string, text: string): { id: string; role: "user"; parts: Array<{ type: "text"; text: string }>; metadata: { dshContext: true; kind: string } } {
      return {
        id,
        role: "user",
        parts: [{ type: "text", text }],
        metadata: { dshContext: true, kind },
      };
    }

    /** Local/UTC time snapshot plus elapsed time since the previous snapshot. */
    private timeSnapshot(): { text: string; local: string; zone: string } {
      const now = new Date();
      const zone = this.clientTimeZone ?? "UTC";
      let local = now.toISOString();
      try {
        local = new Intl.DateTimeFormat("en-US", {
          timeZone: zone,
          dateStyle: "medium",
          timeStyle: "long",
        }).format(now);
      } catch {
        local = now.toISOString();
      }
      const elapsed = this.lastTimeSnapshotAt === undefined ? undefined : Math.max(0, Math.round((now.getTime() - this.lastTimeSnapshotAt) / 1000));
      this.lastTimeSnapshotAt = now.getTime();
      const text = [
        `Current time: ${local} (${zone}); UTC: ${now.toISOString()}.`,
        ...(elapsed === undefined ? [] : [`Elapsed since the previous time snapshot: ${elapsed}s.`]),
      ].join(" ");
      return { text, local, zone };
    }

    /** Persist one per-step time snapshot and return its model-facing text. */
    private async injectStepTime(): Promise<string> {
      const snapshot = this.timeSnapshot();
      await this.addMessages([this.contextMessage(`dsh-context:time:${crypto.randomUUID()}`, "time", snapshot.text)] as never, {
        mode: "append",
        broadcast: false,
      });
      return snapshot.text;
    }

    /** Update current instruction snapshots without branching conversation history. */
    private async injectDurableContext(skill?: { name: string; body: string }): Promise<void> {
      await this.refreshWorkspaceContext();
      const baselineTime = this.timeSnapshot();
      const messages = [
        this.contextMessage("dsh-context:working-directory", "working-directory", `Your working directory is ${this.workspaceCwd}.`),
        // The admission baseline guarantees a durable time row even when a turn
        // produces no model step (beforeStep never runs for it).
        this.contextMessage(`dsh-context:time:${crypto.randomUUID()}:admit`, "time", baselineTime.text),
      ];
      if (this.globalInstructions !== "") {
        messages.push(this.contextMessage("dsh-context:global-instructions", "global-instructions", `User-global instructions (AGENTS.md):\n${this.globalInstructions}`));
      }
      if (this.workspaceInstructions !== "") {
        messages.push(this.contextMessage("dsh-context:workspace-instructions", "workspace-instructions", this.workspaceInstructions));
      }
      if (skill !== undefined) messages.push(this.contextMessage(`dsh-context:skill:${skill.name}`, "skill", skill.body));
      await replaceDurableContext(this.session, messages);
    }

    /** Render with the official registry; fall back to the legacy blocks on failure. */
    private async renderSystemPrompt(): Promise<string> {
      const registry = this.ensurePromptRegistry();
      if (registry !== undefined) {
        try {
          await this.refreshWorkspaceContext();
          return await registry.render();
        }
        catch (error) {
          this.promptError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
          if (!this.promptFailureReported) {
            this.promptFailureReported = true;
            console.error("dsh-base think: system-prompt render failed, using fallback", error);
          }
        }
      }
      const legacy = this.activePlugins().flatMap((plugin) => plugin.context?.() ?? []);
      const facts = this.listFacts();
      const blocks = legacy.map((block) => (block as unknown as { provider?: { get?: () => Promise<string> } }).provider?.get);
      const texts = await Promise.all(blocks.map((get) => (get === undefined ? "" : get())));
      const fallback = [
        `You are ${this.modelLabel()} (model id ${this.selectedModel()}), served by ${this.providerLabel()}.`,
        ...texts.filter((text) => text !== ""),
        ...(facts.length === 0 ? [] : [`Durable facts the user asked you to remember:\n${facts.map((fact) => `- ${fact}`).join("\n")}`]),
      ];
      return fallback.join("\n\n");
    }

    /** One rendered official system prompt block for the Think runtime. */
    configureContext(): ContextBlock[] {
      return [{
        label: "system-prompt",
        provider: { get: async () => await this.renderSystemPrompt() },
      }];
    }

    /** Operator/acceptance surface: the currently rendered official system prompt. */
    @callable()
    async systemPromptDebug(): Promise<{
      text: string;
      error?: string;
      waterfallRuns: number;
      context: Array<{ id: string; kind: string; text: string }>;
      contextInjectionError?: string;
      tools: string[];
      workspaceInstructionsLength: number;
      lastRefreshError?: string;
      workspaceReadLog?: Array<{ path: string; ok: boolean; bytes?: number; error?: string }>;
    }> {
      const text = await this.renderSystemPrompt();
      const messages = await this.getMessages();
      const context = messages.flatMap((message) => {
        const metadata = message.metadata as { dshContext?: unknown; kind?: unknown } | undefined;
        if (metadata?.dshContext !== true) return [];
        const text = message.parts.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n");
        return [{ id: message.id, kind: typeof metadata.kind === "string" ? metadata.kind : "context", text }];
      });
      return {
        text,
        ...(this.promptError === undefined ? {} : { error: this.promptError }),
        waterfallRuns: this.promptRegistry?.waterfallRuns() ?? 0,
        context,
        tools: Object.keys(this.getTools()),
        workspaceInstructionsLength: this.workspaceInstructions.length,
        ...(this.lastRefreshError === undefined ? {} : { lastRefreshError: this.lastRefreshError }),
        ...(this.workspaceReadLog.length === 0 ? {} : { workspaceReadLog: this.workspaceReadLog }),
        ...(this.contextInjectionError === undefined ? {} : { contextInjectionError: this.contextInjectionError }),
      };
    }

    getTools(): ToolSet {
      const tools = Object.assign({}, ...this.activePlugins().map((plugin) => plugin.tools?.(this.env, this) ?? {}));
      // Read-only Sessions cannot delegate work that may act on the workspace.
      if (this.permissionPreset === "read-only") delete (tools as Record<string, unknown>).delegate_task;
      return tools;
    }

    getActions(): Readonly<Record<string, Action>> {
      return Object.assign({}, ...this.activePlugins().map((plugin) => plugin.actions?.(this.env, this) ?? {}));
    }
  }

  return ComposedAgent;
}
