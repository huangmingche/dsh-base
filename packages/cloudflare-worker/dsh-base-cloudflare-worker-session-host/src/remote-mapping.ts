import { DEPLOYMENT_MODELS } from "./model-catalog.ts";
import { DEEPSEEK_PROVIDER_ID, GATEWAY_PROVIDER_ID, LEGACY_PROVIDER_ID, deepseekModelId, gatewayModelId, providerForModelId } from "../../../boot/dsh-base-session-wire/src/model-routes.ts";
import { DISABLED_IMAGE_LIMITS } from "./uploads.ts";
/**
 * Pure value mapping for the official `session` RPC bridge.
 *
 * The Workers-native Session Host speaks its own durable row shape. This
 * module translates those rows into the values the generated official Session
 * Remote descriptor returns, without importing a Host or Client package. It
 * contains no I/O, so the mapping is unit-testable on its own.
 */
import { assistantStepMessageSource, type SessionWireRecord } from "@dsh-base/session-wire";
import { FIXED_AGENT_PRESET_ID } from "../../../boot/dsh-base-agent-presets/src/index.ts";
import type { SessionListRow } from "./contract.ts";

/** One reasoning effort advertised for a DeepSeek model. */
export interface SessionReasoningEffort {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
}

/** Reasoning metadata attached to a catalog model. */
export interface SessionModelReasoning {
  readonly efforts: readonly SessionReasoningEffort[];
  readonly defaultEffort?: string;
  readonly unavailable?: boolean;
  readonly unavailableReason?: string;
}

/** One model in the official Host-generation catalog. */
export interface SessionCatalogModel {
  readonly id: string;
  readonly name: string;
  readonly reasoning?: SessionModelReasoning;
  readonly unavailable?: boolean;
  readonly unavailableReason?: string;
}

/** Official model catalog value used by the model-selection UI. */
export interface SessionModelCatalog {
  readonly default: { readonly provider: string; readonly model: string };
  readonly routableProviders: readonly string[];
  readonly groups: readonly {
    readonly id: string;
    readonly name: string;
    readonly models: readonly SessionCatalogModel[];
  }[];
  readonly failures: readonly { readonly id: string; readonly name: string; readonly message: string }[];
}

/** Reasoning metadata advertised for the DeepSeek routes. */
const DEEPSEEK_REASONING: SessionModelReasoning = {
  efforts: [
    { id: "off", name: "Off", description: "Use for simple tasks that do not need reasoning." },
    { id: "low", name: "Low", description: "Prefer for routine or latency-sensitive tasks." },
    { id: "high", name: "High", description: "The default balance for most tasks." },
    { id: "max", name: "Max", description: "Reserve for the hardest quality-first tasks." },
  ],
  defaultEffort: "high",
};

/** Projection values every list row carries in this deployment. */
export interface SessionSummaryProjections {
  readonly kind: "cached";
  readonly values: { readonly title: string; readonly agentPreset: string };
}

/** One `session/list` row in the official descriptor shape. */
export interface SessionSummary {
  readonly agentAvailable: true;
  readonly sessionId: string;
  readonly updatedAt: number;
  readonly running: boolean;
  readonly blank: boolean;
  readonly cwd?: string;
  readonly workspaceId?: string;
  readonly projections: SessionSummaryProjections;
}

/**
 * Project one durable Host row into the official SessionSummary value.
 * @param row - row read from the Workers-native Host.
 * @returns the descriptor-compatible summary row.
 */
export function toOfficialSummary(row: SessionListRow): SessionSummary {
  const title = row.title === "" ? (row.displayTitle ?? "New Session") : row.title;
  return {
    agentAvailable: true,
    sessionId: row.sessionId,
    updatedAt: row.updatedAt,
    running: row.running,
    blank: row.blank,
    ...(row.cwd === undefined ? {} : { cwd: row.cwd }),
    ...(row.workspaceId === undefined ? {} : { workspaceId: row.workspaceId }),
    projections: { kind: "cached", values: { title, agentPreset: FIXED_AGENT_PRESET_ID } },
  };
}

/** Passive Session state in the official descriptor shape. */
export interface SessionState {
  readonly cursor: number;
  readonly active: boolean;
  readonly running: boolean;
  readonly queue: readonly unknown[] | null;
  readonly pendingInput: readonly string[];
}

/**
 * Project the Host's passive state read into the official SessionState value.
 * @param state - Host state read.
 * @returns descriptor-compatible passive state.
 */
export function toOfficialState(
  state: { readonly running?: boolean },
  queued?: readonly SessionQueueRow[],
): SessionState {
  return {
    cursor: 0,
    active: true,
    running: state.running ?? false,
    queue: queued === undefined
      ? null
      : queued.map((item) => ({
        id: item.submissionId,
        placement: "queued" as const,
        ...(item.requestId === "" ? {} : { rpcId: item.requestId }),
        content: [{ type: "text", text: item.text }],
      })),
    pendingInput: [],
  };
}

/** One durable queued submission projected to the official Session state. */
export interface SessionQueueRow {
  readonly submissionId: string;
  readonly requestId: string;
  readonly text: string;
  readonly createdAt: number;
}

/** Sequenced projection block returned by `session/projections`. */
export interface SessionProjections {
  readonly kind: "sequenced";
  readonly asOfSeq: number;
  readonly values: Record<string, unknown>;
}

/**
 * Wrap raw Host projection values in the official sequenced baseline block.
 * @param values - projections read from the Host.
 * @returns descriptor-compatible projections value.
 */
export function toOfficialProjections(values: Record<string, unknown>): SessionProjections {
  const { _dshBaseProjectionRevision: revision, ...projectionValues } = values;
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0) throw new Error("Host projection revision is unavailable");
  return { kind: "sequenced", asOfSeq: revision, values: { ...Object.fromEntries(Object.entries(projectionValues).filter(([key]) => !key.startsWith("_dshBase"))), imageLimits: DISABLED_IMAGE_LIMITS } };
}

/**
 * Build the official model catalog from actual Host provider catalogs.
 * Only DeepSeek and Cloudflare AI Gateway are selectable; historical bare ids
 * are projection compatibility, never a third selectable provider.
 * @param models - explicit provider model options reported by the Host.
 * @param catalogs - optional provider catalogs when a model directory is empty.
 */
export function toOfficialModelCatalog(
  models: readonly { readonly id?: unknown; readonly label?: unknown }[],
  catalogs?: { readonly deepseek?: readonly { readonly id: string; readonly label: string }[]; readonly gateway?: readonly { readonly id: string; readonly label: string }[] },
): SessionModelCatalog {
  const hostIds = new Set(models.map((model) => String(model.id)));
  const hostDeepSeek = models.flatMap(model => {
    const id = typeof model.id === "string" ? model.id : "";
    if (!id.startsWith("deepseek-official/")) return [];
    const bare = id.slice("deepseek-official/".length);
    return [{ id: bare, label: typeof model.label === "string" && model.label !== "" ? model.label : bare }];
  });
  const deepseekCatalog = catalogs?.deepseek
    ?? (hostDeepSeek.length > 0 ? hostDeepSeek : DEPLOYMENT_MODELS.map(model => ({ id: model.id, label: model.label })));
  const deepseekAvailable = hostIds.has(deepseekModelId(deepseekCatalog[0]?.id ?? ""));
  const gatewayAvailable = DEPLOYMENT_MODELS.some(model => hostIds.has(gatewayModelId(model.id)));
  const gatewayCatalog = catalogs?.gateway ?? DEPLOYMENT_MODELS.map(model => ({ id: model.id, label: model.label }));
  const deepseek = deepseekCatalog.map((model): SessionCatalogModel => ({
    id: deepseekModelId(model.id),
    name: model.label,
    reasoning: DEEPSEEK_REASONING,
    ...(deepseekAvailable ? {} : { unavailable: true, unavailableReason: "The owner DeepSeek API key is not configured or could not be read." }),
  }));
  const gateway = gatewayCatalog.map((model): SessionCatalogModel => ({
    id: gatewayModelId(model.id),
    name: model.label,
    reasoning: DEEPSEEK_REASONING,
    ...(gatewayAvailable ? {} : { unavailable: true, unavailableReason: "Cloudflare AI Gateway is not enabled for this deployment." }),
  }));
  const routableProviders = [
    ...deepseekAvailable ? [DEEPSEEK_PROVIDER_ID] : [],
    ...gatewayAvailable ? [GATEWAY_PROVIDER_ID] : [],
  ];
  const defaultModel = gatewayAvailable
    ? { provider: GATEWAY_PROVIDER_ID, model: gatewayModelId(gatewayCatalog[0]?.id ?? "") }
    : deepseekAvailable
      ? { provider: DEEPSEEK_PROVIDER_ID, model: deepseekModelId(deepseekCatalog[0]?.id ?? "") }
      : { provider: DEEPSEEK_PROVIDER_ID, model: "" };
  return {
    default: defaultModel,
    routableProviders,
    groups: [
      { id: DEEPSEEK_PROVIDER_ID, name: "DeepSeek", models: deepseek },
      { id: GATEWAY_PROVIDER_ID, name: "Cloudflare AI Gateway", models: gateway },
    ],
    failures: [],
  };
}

/**
 * Project a Host model selection into the official `session/selectModel` value.
 * @param request - validated selection request from the official wire.
 * @param selected - model id the Host accepted.
 * @returns the normalized selection value.
 */
export function toOfficialSelection(
  request: { readonly provider?: string; readonly model: string },
  selected: string,
  reasoningEffort?: string,
): { readonly selected: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string } } {
  return {
    selected: {
      provider: request.provider ?? providerForModelId(request.model),
      model: selected,
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    },
  };
}

/** Message budget the official Host applies when `maxMessages` is omitted. */
export const DEFAULT_PAGE_MESSAGES = 50;

/** Event types that count toward the official history message budget. */
const PAGE_MESSAGE_TYPES: ReadonlySet<string> = new Set(["user/message", "assistant/message"]);

/** Page record with the optional surface sources the official cut honors. */
export type SessionPageRecord = SessionWireRecord & {
  readonly event: SessionWireRecord["event"] & { readonly sourceEventSeqs?: unknown };
};

/** Validated window fields of one official `session/page` request. */
export interface SessionPageWindow {
  /** Inclusive journal cut; omission selects the newest record. */
  readonly throughSeq?: number;
  /** Exclusive upper cut of an older page. */
  readonly beforeSeq?: number;
  /** Positive user/assistant message budget. */
  readonly maxMessages?: number;
  /** Turn-boundary stop rule applied after the message budget. */
  readonly turnWindow?: {
    readonly minMessages: number;
    readonly minTurns: number;
  };
}

/** One official `session/page` value. */
export interface SessionPageValue {
  readonly records: readonly SessionWireRecord[];
  readonly hasMore: boolean;
}

/**
 * Cut one message-aligned page from the shared Session journal.
 *
 * The journal seq space is dense and ascending, so `throughSeq` is the
 * inclusive official cut and `beforeSeq` the exclusive upper bound of an older
 * page; `-1` selects the empty page. Backwards iteration mirrors the official
 * Host: a message budget stops at the oldest message (and any cited source)
 * while a Turn window stops at a Turn start once both minima are met.
 * @param records - complete journal in ascending, dense seq order.
 * @param request - validated page window from the official request.
 * @returns the chronological page and whether older records remain.
 */
export function cutSessionPage(
  records: readonly SessionPageRecord[],
  request: SessionPageWindow,
): SessionPageValue {
  if (request.throughSeq === -1) return { records: [], hasMore: false };
  const firstSeq = records[0]?.event.seq;
  const lastSeq = records.at(-1)?.event.seq;
  if (firstSeq === undefined || lastSeq === undefined) return { records: [], hasMore: false };
  const through = request.throughSeq ?? lastSeq;
  const upper = request.beforeSeq === undefined ? through + 1 : Math.min(through + 1, request.beforeSeq);
  const end = Math.min(records.length, Math.max(0, upper - firstSeq));
  const maxMessages = request.maxMessages ?? DEFAULT_PAGE_MESSAGES;
  const turnWindow = request.turnWindow;
  let count = 0;
  let turns = 0;
  let cut = 0;
  for (let index = end - 1; index >= 0; index -= 1) {
    const event = records[index]!.event;
    if (turnWindow !== undefined && event.type === "turn/start") {
      turns += 1;
      if (count >= turnWindow.minMessages && turns >= turnWindow.minTurns) {
        cut = index;
        break;
      }
    }
    if (!PAGE_MESSAGE_TYPES.has(event.type)) continue;
    count += 1;
    let groupStart = index;
    const sources = event.sourceEventSeqs;
    if (Array.isArray(sources)) {
      for (const source of sources) {
        if (typeof source === "number") groupStart = Math.min(groupStart, source - firstSeq);
      }
    }
    if (count >= maxMessages) {
      cut = Math.max(0, groupStart);
      break;
    }
  }
  return { records: records.slice(cut, end), hasMore: cut > 0 };
}



/**
 * Map an official inclusive event-sequence fork cut onto the Host's durable
 * message-id fork boundary.
 *
 * Official `session/fork.atSeq` addresses the dense wire journal; the Workers
 * Host copies messages up to one durable id. The latest projected message id at
 * or before the cut is the last message the fork keeps.
 * @param records - dense wire journal for the source Session.
 * @param atSeq - inclusive event-sequence cut.
 * @returns the durable message id at or before the cut, or undefined when the
 * cut precedes the first projected message.
 */
export function forkMessageBoundaryFor(records: readonly SessionWireRecord[], atSeq: number): { messageId: string; assistantStep?: number } | undefined {
  let boundary: { messageId: string; assistantStep?: number } | undefined;
  for (const record of records) {
    if (record.event.seq > atSeq) break;
    const data = record.event.data;
    if (typeof data !== "object" || data === null || Array.isArray(data)) continue;
    if (record.event.type === "user/message") {
      const id = (data as { id?: unknown }).id;
      if (typeof id === "string" && id !== "") boundary = { messageId: id };
    } else if (record.event.type === "assistant/message") {
      const message = (data as { message?: { id?: unknown } }).message;
      if (typeof message?.id === "string" && message.id !== "") boundary = assistantStepMessageSource(message.id) ?? { messageId: message.id };
    }
  }
  return boundary;
}
/** Raw Host message identity for callers that do not need a within-message cut. */
export function forkMessageIdFor(records: readonly SessionWireRecord[], atSeq: number): string | undefined {
  return forkMessageBoundaryFor(records, atSeq)?.messageId;
}
