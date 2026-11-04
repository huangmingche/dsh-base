/**
 * Official-style client descriptor for the Workers-native `session` namespace.
 *
 * The generated `@deepseek-ai/dsh-api-remotes` client calls
 * `session/<method>` through the official `{ type: 'client-request', payload:
 * { args } }` envelope. This module reproduces that wire contract over the
 * Worker bridge and keeps the custom `/api/session-host` transport available as
 * a fallback: it is a migration seam, not a second business implementation.
 */
import type { ConnectionHandle } from "@deepseek-ai/dsh-client-connection/client";

/** One official Remote result envelope. */
export type OfficialGatewayResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };

/** Failure produced by the HTTP carrier rather than by a Remote method. */
export class OfficialGatewayTransportError extends Error {
  /** HTTP status when the carrier returned one. */
  readonly status: number | undefined;

  /**
   * @param message - carrier diagnostic.
   * @param status - HTTP status when available.
   */
  constructor(message: string, status?: number) {
    super(message);
    this.name = "OfficialGatewayTransportError";
    this.status = status;
  }
}

/** Options for the official-style Session gateway. */
export interface OfficialSessionGatewayOptions {
  /** Origin of the Workers deployment serving `/api/session/*`. */
  readonly baseUrl: string;
  /** Fetch implementation override for tests. */
  readonly fetch?: typeof globalThis.fetch;
  /**
   * Resolve the official Connection service when its plugin is active. Reads
   * are resolved lazily because the Connection plugin activates after the
   * session seam in the static composition.
   */
  readonly connection?: () => ConnectionHandle | undefined;
}

/** One `session/list` summary in the shape the official client consumes. */
export interface OfficialSessionSummary {
  readonly agentAvailable: boolean;
  readonly sessionId: string;
  readonly updatedAt: number;
  readonly running: boolean;
  readonly blank: boolean;
  readonly displayTitle?: string;
  readonly cwd?: string;
  readonly projections?: unknown;
}

/** Result of `session/list`. */
export interface OfficialSessionList {
  readonly items: readonly OfficialSessionSummary[];
}

/** Result of `session/projections`. */
export interface OfficialSessionProjections {
  readonly kind: string;
  readonly asOfSeq: number;
  readonly values: Record<string, unknown>;
}

/** Result of `session/modelCatalog`. */
export interface OfficialModelCatalog {
  readonly default: { readonly provider: string; readonly model: string };
  readonly routableProviders: readonly string[];
  readonly groups: readonly {
    readonly id: string;
    readonly name: string;
    readonly models: readonly {
      readonly id: string;
      readonly name: string;
      readonly reasoning?: unknown;
      readonly unavailable?: boolean;
      readonly unavailableReason?: string;
    }[];
  }[];
  readonly failures: readonly unknown[];
}

/** Result of `session/selectModel`. */
export interface OfficialModelSelection {
  readonly selected: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string };
}

/** One official Session journal record returned by `session/page`. */
export interface OfficialSessionHistoryRecord {
  readonly type: "event";
  readonly event: {
    readonly type: string;
    readonly seq: number;
    readonly time: number;
    readonly data: unknown;
    readonly surfaceOp?: "append";
  };
}

/** Result of `session/page`: one chronological page with dense seqs. */
export interface OfficialSessionPage {
  readonly records: readonly OfficialSessionHistoryRecord[];
  readonly hasMore: boolean;
}

/** One `session/page` request bound to an ordinary Session address. */
export interface OfficialSessionPageRequest {
  readonly sessionId: string;
  /** Inclusive journal cut; omission selects the Host's newest record. */
  readonly throughSeq?: number;
  /** Exclusive upper cut of an older page. */
  readonly beforeSeq?: number;
  /** Positive user/assistant message budget. */
  readonly maxMessages?: number;
  /** Optional Turn-boundary stop rule. */
  readonly turnWindow?: {
    readonly minMessages: number;
    readonly minTurns: number;
  };
}

/** One official prompt content part. */
export type OfficialPromptContentPart =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly mediaType: string; readonly data: string; readonly name?: string }
  | { readonly type: "file"; readonly receiptId: string };

/** Result of `session/prompt`. */
export interface OfficialPromptReceipt {
  readonly accepted: true;
  /** Worker-host extension: the durable submission the alarm/claim observes. */
  readonly submissionId?: string;
}

/** The official Session method set this increment bridges. */
export const SESSION_REMOTE_ENDPOINTS = Object.freeze({
  list: "session/list",
  state: "session/state",
  projections: "session/projections",
  create: "session/create",
  fork: "session/fork",
  rename: "session/rename",
  selectModel: "session/selectModel",
  modelCatalog: "session/modelCatalog",
  cancel: "session/cancel",
  page: "session/page",
  prompt: "session/prompt",
  updateQueue: "session/updateQueue",
} as const);

/** Discoverable descriptor metadata for the migrated namespace. */
export const SESSION_REMOTE_DESCRIPTOR = Object.freeze({
  namespace: "session",
  methods: Object.freeze(Object.keys(SESSION_REMOTE_ENDPOINTS)),
});

/** Remote codes that mean "this deployment has no such endpoint". */
const ENDPOINT_UNAVAILABLE_CODES: ReadonlySet<string> = new Set([
  "gateway/endpoint-unavailable",
  "gateway/method-mismatch",
  "gateway/definition-unavailable",
]);

/**
 * Whether a failure means the official endpoint is absent (so the caller may
 * fall back to the custom transport) rather than a business refusal.
 * @param error - thrown carrier error or returned Remote failure.
 * @returns true when the endpoint itself is unavailable.
 */
export function isOfficialEndpointUnavailable(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const value = error as { readonly status?: unknown; readonly code?: unknown; readonly message?: unknown };
  if (value.status === 404 || value.status === 405) return true;
  if (typeof value.code === "string" && ENDPOINT_UNAVAILABLE_CODES.has(value.code)) return true;
  return typeof value.message === "string" && /HTTP (?:404|405)\b/.test(value.message);
}

/** One official-style caller for the Session namespace. */
export interface OfficialSessionGateway {
  list(input?: { readonly cursor?: string }, signal?: AbortSignal): Promise<OfficialGatewayResult<OfficialSessionList>>;
  state(sessionId: string, signal?: AbortSignal): Promise<OfficialGatewayResult<Record<string, unknown>>>;
  projections(sessionId: string, signal?: AbortSignal): Promise<OfficialGatewayResult<OfficialSessionProjections>>;
  create(input: {
    readonly title?: string;
    readonly sessionId?: string;
    readonly workspaceId?: string;
    readonly cwd?: string;
    readonly agentPreset?: string;
  }, signal?: AbortSignal): Promise<OfficialGatewayResult<{ readonly sessionId: string; readonly agentPreset?: string }>>;
  fork(input: {
    readonly sessionId: string;
    readonly messageId?: string;
    readonly atSeq?: number;
    readonly allowMigration?: boolean;
  }, signal?: AbortSignal): Promise<OfficialGatewayResult<{ readonly sessionId: string }>>;
  rename(sessionId: string, title: string, signal?: AbortSignal): Promise<OfficialGatewayResult<{ readonly title: string; readonly seq: number }>>;
  selectModel(input: {
    readonly sessionId: string;
    readonly provider?: string;
    readonly model: string;
    readonly reasoningEffort?: string;
  }, signal?: AbortSignal): Promise<OfficialGatewayResult<OfficialModelSelection>>;
  modelCatalog(signal?: AbortSignal): Promise<OfficialGatewayResult<OfficialModelCatalog>>;
  cancel(sessionId: string, signal?: AbortSignal): Promise<OfficialGatewayResult<{ readonly accepted: true }>>;
  page(input: OfficialSessionPageRequest, signal?: AbortSignal): Promise<OfficialGatewayResult<OfficialSessionPage>>;
  prompt(input: {
    readonly sessionId: string;
    readonly requestId: string;
    readonly mode: "queue" | "steer";
    readonly content: readonly OfficialPromptContentPart[];
    readonly clientTimeZone?: string;
  }, signal?: AbortSignal): Promise<OfficialGatewayResult<OfficialPromptReceipt>>;
  updateQueue(input: {
    readonly sessionId: string;
    readonly itemId: string;
    readonly action:
      | { readonly kind: "edit"; readonly content: readonly { readonly type: "text"; readonly text: string }[] }
      | { readonly kind: "remove" }
      | { readonly kind: "steer" };
  }, signal?: AbortSignal): Promise<OfficialGatewayResult<{ readonly accepted: true }>>;
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

/**
 * Create the official-style Session gateway.
 * @param options - deployment origin, optional fetch override, and Connection accessor.
 * @returns official `session/*` caller with `{ ok, value }` result envelopes.
 */
export function createOfficialSessionGateway(options: OfficialSessionGatewayOptions): OfficialSessionGateway {
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);

  async function call<T>(method: keyof typeof SESSION_REMOTE_ENDPOINTS, args: Record<string, unknown>, signal?: AbortSignal): Promise<OfficialGatewayResult<T>> {
    const endpoint = SESSION_REMOTE_ENDPOINTS[method];
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
    const response = await fetcher(`${options.baseUrl.replace(/\/+$/, "")}/api/${endpoint}`, {
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
    list: (input = {}, signal) => call("list", { _request: input }, signal),
    state: (sessionId, signal) => call("state", { request: { sessionId } }, signal),
    projections: (sessionId, signal) => call("projections", { request: { sessionId } }, signal),
    create: (input, signal) => call("create", { request: input }, signal),
    fork: (input, signal) => call("fork", {
      request: {
        sessionId: input.sessionId,
        ...(input.messageId === undefined ? {} : { messageId: input.messageId }),
        ...(input.atSeq === undefined ? {} : { atSeq: input.atSeq }),
        ...(input.allowMigration === undefined ? {} : { allowMigration: input.allowMigration }),
      },
    }, signal),
    rename: (sessionId, title, signal) => call("rename", { request: { sessionId, title } }, signal),
    selectModel: (input, signal) => call("selectModel", {
      request: {
        sessionId: input.sessionId,
        ...(input.provider === undefined ? {} : { provider: input.provider }),
        model: input.model,
        ...(input.reasoningEffort === undefined ? {} : { reasoningEffort: input.reasoningEffort }),
      },
    }, signal),
    modelCatalog: (signal) => call("modelCatalog", {}, signal),
    cancel: (sessionId, signal) => call("cancel", { request: { sessionId } }, signal),
    prompt: (input, signal) => call("prompt", { request: input }, signal),
    updateQueue: (input, signal) => call("updateQueue", { request: input }, signal),
    page: (input, signal) => call("page", {
      request: {
        address: { kind: "session", sessionId: input.sessionId },
        ...(input.throughSeq === undefined ? {} : { throughSeq: input.throughSeq }),
        ...(input.beforeSeq === undefined ? {} : { beforeSeq: input.beforeSeq }),
        ...(input.maxMessages === undefined ? {} : { maxMessages: input.maxMessages }),
        ...(input.turnWindow === undefined ? {} : { turnWindow: input.turnWindow }),
      },
    }, signal),
  };
}
