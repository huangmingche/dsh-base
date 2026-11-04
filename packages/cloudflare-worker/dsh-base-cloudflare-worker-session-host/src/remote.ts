/**
 * Official `session` RPC bridge over the Workers-native Session Host.
 *
 * Each generated Remote endpoint (`session/list`, `session/state`, ...) accepts
 * the official `{ args }` payload and dispatches to the same Durable Object
 * transport that `/api/session-host` serves. One migrated dependency therefore
 * never opens a second source of truth: the official and custom callers observe
 * the same durable Session rows.
 *
 * Stream methods are served by the Gateway stream mux through `remote-streams.ts`.
 */
import type { WireHandler, WireInvocation, WireRpc } from "@dsh-base/cloudflare-worker-wire-rpc";
import { buildSessionHistory, assistantStepMessageSource } from "@dsh-base/session-wire";
import type { SessionHistorySnapshot } from "@dsh-base/session-wire";
import { FIXED_AGENT_PRESET_ID } from "../../../boot/dsh-base-agent-presets/src/index.ts";
import { GATEWAY_PROVIDER_ID, deepseekModelId, isDeepSeekModelId, isGatewayModelId } from "../../../boot/dsh-base-session-wire/src/model-routes.ts";
import { SessionRpcFault } from "./remote-contract.ts";
import {
  cutSessionPage,
  DEFAULT_PAGE_MESSAGES,
  forkMessageBoundaryFor,
  toOfficialModelCatalog,
  toOfficialProjections,
  toOfficialSelection,
  toOfficialState,
  type SessionQueueRow,
  toOfficialSummary,
  type SessionPageWindow,
} from "./remote-mapping.ts";
import type { SessionListRow } from "./contract.ts";
import { handleSessionHostRequest } from "./worker-http.ts";
import { createHostCall } from "./host-call.ts";

type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidArguments(endpoint: string): SessionRpcFault {
  return new SessionRpcFault("gateway/arguments-invalid", `${endpoint}: payload must contain exactly one plain-object args field`, { endpoint });
}

function invalidRequest(endpoint: string, field: string): SessionRpcFault {
  return new SessionRpcFault("gateway/bad-request", `${endpoint}: ${field} is invalid`, { endpoint, field });
}

/** Unwrap the official `{ args }` payload shape. */
export function argsOf(payload: unknown, endpoint: string): JsonRecord {
  if (!isRecord(payload) || Object.keys(payload).length !== 1 || Object.keys(payload)[0] !== "args" || !isRecord(payload.args)) {
    throw invalidArguments(endpoint);
  }
  return payload.args;
}

/** Read the request object a direct Remote method receives. */
export function requestOf(args: JsonRecord, endpoint: string): JsonRecord {
  const request = args.request;
  if (request === undefined) return {};
  if (!isRecord(request)) throw invalidRequest(endpoint, "request");
  return request;
}

/** Read the reserved empty list request shape. */
function listRequestOf(args: JsonRecord, endpoint: string): JsonRecord {
  const request = args._request;
  if (request === undefined) return {};
  if (!isRecord(request)) throw invalidRequest(endpoint, "_request");
  return request;
}

export function sessionIdOf(request: JsonRecord, endpoint: string): string {
  const sessionId = request.sessionId;
  if (typeof sessionId !== "string" || sessionId === "") throw invalidRequest(endpoint, "sessionId");
  return sessionId;
}

function optionalString(value: unknown, field: string, endpoint: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw invalidRequest(endpoint, field);
  return value;
}

function optionalInteger(value: unknown, field: string, endpoint: string, minimum: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || Object.is(value, -0)) {
    throw invalidRequest(endpoint, field);
  }
  return value;
}

/** Read the ordinary-Session address; direct-subagent history is not bridged yet. */
function pageSessionId(request: JsonRecord, endpoint: string): string {
  const address = request.address;
  if (!isRecord(address)) throw invalidRequest(endpoint, "address");
  if (address.kind === "subagent") {
    throw new SessionRpcFault("session/subagent-unavailable", `${endpoint}: direct-subagent history is not available on the Workers-native Host yet`, { endpoint });
  }
  if (address.kind !== "session" || typeof address.sessionId !== "string" || address.sessionId === "") {
    throw invalidRequest(endpoint, "address.sessionId");
  }
  return address.sessionId;
}

/** Validate the official page window fields before the Host reads history. */
function pageWindowOf(request: JsonRecord, endpoint: string): SessionPageWindow {
  const throughSeq = optionalInteger(request.throughSeq, "throughSeq", endpoint, -1);
  const beforeSeq = optionalInteger(request.beforeSeq, "beforeSeq", endpoint, 0);
  const maxMessages = optionalInteger(request.maxMessages, "maxMessages", endpoint, 1);
  let turnWindow: SessionPageWindow["turnWindow"];
  if (request.turnWindow !== undefined) {
    if (!isRecord(request.turnWindow)) throw invalidRequest(endpoint, "turnWindow");
    const minMessages = optionalInteger(request.turnWindow.minMessages, "turnWindow.minMessages", endpoint, 1);
    const minTurns = optionalInteger(request.turnWindow.minTurns, "turnWindow.minTurns", endpoint, 1);
    if (minMessages === undefined || minTurns === undefined || minMessages > (maxMessages ?? DEFAULT_PAGE_MESSAGES)) {
      throw invalidRequest(endpoint, "turnWindow");
    }
    turnWindow = { minMessages, minTurns };
  }
  return {
    ...(throughSeq === undefined ? {} : { throughSeq }),
    ...(beforeSeq === undefined ? {} : { beforeSeq }),
    ...(maxMessages === undefined ? {} : { maxMessages }),
    ...(turnWindow === undefined ? {} : { turnWindow }),
  };
}

/**
 * Register every migrated unary `session/*` endpoint on the generic wire-RPC
 * service.
 * @param wireRpc - endpoint registry provided by the Worker wire-RPC plugin.
 * @returns disposer withdrawing every endpoint this bridge registered.
 */
export function registerSessionRemoteEndpoints(wireRpc: WireRpc): () => void {
  const disposers: Array<() => void> = [];
  const register = (method: string, handler: WireHandler): void => {
    disposers.push(wireRpc.register(`session/${method}`, handler));
  };

  register("list", async (payload, invocation) => {
    const endpoint = "session/list";
    const request = listRequestOf(argsOf(payload, endpoint), endpoint);
    const initialCursor = optionalString(request.cursor, "cursor", endpoint);
    const call = createHostCall(invocation);
    const items: ReturnType<typeof toOfficialSummary>[] = [];
    let cursor = initialCursor;
    for (let page = 0; page < 20; page += 1) {
      const result = await call("list", cursor === undefined ? {} : { cursor }) as {
        readonly sessions?: readonly unknown[];
        readonly cursor?: unknown;
      };
      for (const row of result.sessions ?? []) {
        if (!isRecord(row)) continue;
        items.push(toOfficialSummary(row as unknown as SessionListRow));
      }
      cursor = typeof result.cursor === "string" ? result.cursor : undefined;
      if (cursor === undefined) break;
    }
    return { items };
  });

  register("state", async (payload, invocation) => {
    const endpoint = "session/state";
    const request = requestOf(argsOf(payload, endpoint), endpoint);
    const call = createHostCall(invocation);
    const sessionId = sessionIdOf(request, endpoint);
    const state = await call("state", { sessionId }) as { readonly running?: boolean };
    const queued = await call("queue", { sessionId }) as { readonly items?: readonly SessionQueueRow[] };
    return toOfficialState(state, queued.items ?? []);
  });

  register("projections", async (payload, invocation) => {
    const endpoint = "session/projections";
    const request = requestOf(argsOf(payload, endpoint), endpoint);
    const values = await createHostCall(invocation)("projections", { sessionId: sessionIdOf(request, endpoint) }) as Record<string, unknown>;
    return toOfficialProjections(values);
  });

  register("create", async (payload, invocation) => {
    const endpoint = "session/create";
    const request = requestOf(argsOf(payload, endpoint), endpoint);
    const input: JsonRecord = { reuseBlankOnly: true };
    for (const field of ["title", "sessionId", "workspaceId", "cwd"] as const) {
      const value = optionalString(request[field], field, endpoint);
      if (value !== undefined) input[field] = value;
    }
    const agentPreset = optionalString(request.agentPreset, "agentPreset", endpoint);
    // Only the canonical fixed Think composition exists here. Official modes
    // keep their official ids and are refused instead of being aliased.
    if (agentPreset !== undefined && agentPreset !== FIXED_AGENT_PRESET_ID) {
      throw new SessionRpcFault("gateway/endpoint-unavailable", "Only the fixed Think composition is available in this Workers-native deployment", { endpoint, agentPreset });
    }
    const result = await createHostCall(invocation)("create", input) as { readonly sessionId?: unknown };
    if (typeof result.sessionId !== "string") throw new SessionRpcFault("gateway/result-invalid", `${endpoint}: Host returned no sessionId`, { endpoint });
    return { sessionId: result.sessionId, agentPreset: FIXED_AGENT_PRESET_ID };
  });

  register("fork", async (payload, invocation) => {
    const endpoint = "session/fork";
    const request = requestOf(argsOf(payload, endpoint), endpoint);
    const sessionId = sessionIdOf(request, endpoint);
    const call = createHostCall(invocation);
    let messageId = optionalString(request.messageId, "messageId", endpoint);
    let assistantStep: number | undefined;
    if (messageId !== undefined) { const source = assistantStepMessageSource(messageId); if (source) { messageId = source.messageId; assistantStep = source.assistantStep; } }
    if (request.atSeq !== undefined && (typeof request.atSeq !== 'number' || !Number.isSafeInteger(request.atSeq) || request.atSeq < 0)) throw invalidRequest(endpoint, 'atSeq');
    const result = await call("fork", { sessionId, ...(request.atSeq === undefined ? {} : { atSeq: request.atSeq }), ...(messageId === undefined ? {} : { messageId }), ...(assistantStep === undefined ? {} : { assistantStep }) }) as { readonly sessionId?: unknown };
    if (typeof result.sessionId !== "string") throw new SessionRpcFault("gateway/result-invalid", `${endpoint}: Host returned no sessionId`, { endpoint });
    return { sessionId: result.sessionId };
  });

  register("rename", async (payload, invocation) => {
    const endpoint = "session/rename";
    const request = requestOf(argsOf(payload, endpoint), endpoint);
    const sessionId = sessionIdOf(request, endpoint);
    if (typeof request.title !== "string") throw invalidRequest(endpoint, "title");
    const result = await createHostCall(invocation)("rename", { sessionId, title: request.title }) as { readonly title?: unknown; readonly projectionRevision?: unknown };
    if (typeof result.title !== "string" || typeof result.projectionRevision !== "number" || !Number.isSafeInteger(result.projectionRevision) || result.projectionRevision < 0) throw new SessionRpcFault("gateway/endpoint-unavailable", "Host rename acknowledgement has no projection revision", { endpoint });
    return { title: result.title, seq: result.projectionRevision };
  });

  register("selectModel", async (payload, invocation) => {
    const endpoint = "session/selectModel";
    const request = requestOf(argsOf(payload, endpoint), endpoint);
    const sessionId = sessionIdOf(request, endpoint);
    if (typeof request.model !== "string" || request.model === "") throw invalidRequest(endpoint, "model");
    const provider = optionalString(request.provider, "provider", endpoint);
    const reasoningEffort = optionalString(request.reasoningEffort, "reasoningEffort", endpoint);
    if (provider !== undefined && provider !== "deepseek-official" && provider !== GATEWAY_PROVIDER_ID) throw invalidRequest(endpoint, "provider");
    if (provider === GATEWAY_PROVIDER_ID && !isGatewayModelId(request.model)) throw invalidRequest(endpoint, "model");
    const selectedModel = provider === undefined
      ? request.model
      : provider === "deepseek-official" && !isDeepSeekModelId(request.model)
        ? deepseekModelId(request.model)
        : request.model;
    if (provider === GATEWAY_PROVIDER_ID && !isGatewayModelId(selectedModel)) throw invalidRequest(endpoint, "model");
    if (reasoningEffort !== undefined && !["off", "low", "high", "max"].includes(reasoningEffort)) throw invalidRequest(endpoint, "reasoningEffort");
    const result = await createHostCall(invocation)("selectModel", { sessionId, model: selectedModel, ...(reasoningEffort === undefined ? {} : { reasoningEffort }) }) as { readonly model?: unknown; readonly reasoningEffort?: unknown };
    if (typeof result.model !== "string" || result.model === "" || (result.reasoningEffort !== undefined && (typeof result.reasoningEffort !== "string" || !["off", "low", "high", "max"].includes(result.reasoningEffort))) || (reasoningEffort !== undefined && result.reasoningEffort === undefined)) {
      throw new SessionRpcFault("gateway/endpoint-unavailable", "Host did not acknowledge the model selection", { endpoint });
    }
    return toOfficialSelection({ ...(provider === undefined ? {} : { provider }), model: selectedModel }, result.model, result.reasoningEffort as string | undefined);
  });

  register("modelCatalog", async (payload, invocation) => {
    argsOf(payload, "session/modelCatalog");
    const call = createHostCall(invocation);
    const access = await call("modelAccess") as {
      readonly providers?: Readonly<Record<string, { readonly available: boolean; readonly catalog: readonly { readonly id: string; readonly label: string }[] }>>;
    };
    const models = await call("models") as readonly { readonly id?: unknown; readonly label?: unknown }[];
    const catalog = (id: string) => {
      const provider = access.providers?.[id];
      if (provider?.available !== true) return undefined;
      return provider.catalog.map(model => ({ id: model.id.replace(new RegExp(`^${id}/`), ""), label: model.label }));
    };
    return toOfficialModelCatalog(models, { deepseek: catalog("deepseek-official"), gateway: catalog("cloudflare-ai-gateway") });
  });

  register("cancel", async (payload, invocation) => {
    const endpoint = "session/cancel";
    const request = requestOf(argsOf(payload, endpoint), endpoint);
    await createHostCall(invocation)("cancel", { sessionId: sessionIdOf(request, endpoint) });
    return { accepted: true };
  });

  register("updateQueue", async (payload, invocation) => {
    const endpoint = "session/updateQueue";
    const request = requestOf(argsOf(payload, endpoint), endpoint);
    const sessionId = sessionIdOf(request, endpoint);
    if (typeof request.itemId !== "string" || request.itemId === "") throw invalidRequest(endpoint, "itemId");
    if (!isRecord(request.action)) throw invalidRequest(endpoint, "action");
    const action = request.action;
    const call = createHostCall(invocation);
    switch (action.kind) {
      case "remove":
        await call("updateQueue", { sessionId, itemId: request.itemId, action: "remove" });
        return { accepted: true };
      case "edit": {
        const content = Array.isArray(action.content) ? action.content : [];
        const text = content
          .filter((part) => isRecord(part) && part.type === "text" && typeof part.text === "string")
          .map((part) => String((part as { readonly text: string }).text))
          .join("\n");
        if (text.trim() === "") throw new SessionRpcFault("gateway/bad-request", `${endpoint}: edit content must carry text`, { endpoint });
        await call("editQueueItem", { sessionId, submissionId: request.itemId, text });
        return { accepted: true };
      }
      case "steer":
        // The Workers-native Host admits queue entries one at a time; steering
        // a queued item into the active turn is not implemented yet.
        throw new SessionRpcFault("session/steer-unavailable", `${endpoint}: steering a queued input is not available on this Host yet`, { endpoint });
      default:
        throw invalidRequest(endpoint, "action.kind");
    }
  });

  register("page", async (payload, invocation) => {
    const endpoint = "session/page";
    const request = requestOf(argsOf(payload, endpoint), endpoint);
    const sessionId = pageSessionId(request, endpoint);
    const window = pageWindowOf(request, endpoint);
    const history = await createHostCall(invocation)("history", { sessionId }) as SessionHistorySnapshot;
    const records = buildSessionHistory(history.records ?? [], undefined, history.turns, history.forkSeed);
    const lastSeq = records.at(-1)?.event.seq ?? -1;
    if (window.throughSeq !== undefined && window.throughSeq > lastSeq) {
      throw new SessionRpcFault("gateway/bad-request", `${endpoint}: history cut ${String(window.throughSeq)} exceeds ${String(lastSeq)}`, { endpoint });
    }
    return cutSessionPage(records, window);
  });

  register("prompt", async (payload, invocation) => {
    const endpoint = "session/prompt";
    const request = requestOf(argsOf(payload, endpoint), endpoint);
    const sessionId = sessionIdOf(request, endpoint);
    const requestId = optionalString(request.requestId, "requestId", endpoint);
    if (requestId === undefined || requestId === "") throw invalidRequest(endpoint, "requestId");
    const mode = optionalString(request.mode, "mode", endpoint);
    if (mode !== undefined && mode !== "queue" && mode !== "steer") throw invalidRequest(endpoint, "mode");
    const content = request.content;
    if (!Array.isArray(content)) throw invalidRequest(endpoint, "content");
    const call = createHostCall(invocation);
    const texts: string[] = [];
    const receiptIds: string[] = [];
    const attachments: Array<{ attachmentId: string; name: string; mediaType: string; size: number }> = [];
    for (const part of content) {
      if (!isRecord(part)) throw invalidRequest(endpoint, "content");
      if (part.type === "text" && typeof part.text === "string") {
        texts.push(part.text);
        continue;
      }
      if (part.type === "image" && typeof part.data === "string" && typeof part.mediaType === "string") {
        const uploaded = await call("uploadAttachment", {
          sessionId,
          name: typeof part.name === "string" && part.name !== "" ? part.name : "image",
          mediaType: part.mediaType,
          dataBase64: part.data,
        }) as { readonly attachmentId?: unknown; readonly name?: unknown; readonly mediaType?: unknown; readonly size?: unknown };
        if (typeof uploaded.attachmentId !== "string") {
          throw new SessionRpcFault("gateway/result-invalid", `${endpoint}: Host returned no attachment id`, { endpoint });
        }
        attachments.push({
          attachmentId: uploaded.attachmentId,
          name: typeof uploaded.name === "string" ? uploaded.name : "image",
          mediaType: typeof uploaded.mediaType === "string" ? uploaded.mediaType : part.mediaType,
          size: typeof uploaded.size === "number" ? uploaded.size : 0,
        });
        continue;
      }
      if (part.type === "file" && typeof part.receiptId === "string" && part.receiptId !== "") {
        receiptIds.push(part.receiptId);
        continue;
      }
      throw invalidRequest(endpoint, "content");
    }
    const text = texts.join("\n");
    if (text.trim() === "" && attachments.length === 0 && receiptIds.length === 0) {
      throw new SessionRpcFault("gateway/bad-request", `${endpoint}: prompt must contain text or an image`, { endpoint });
    }
    const result = await call("prompt", {
      sessionId,
      text,
      requestId,
      ...(attachments.length === 0 ? {} : { attachments }),
      ...(receiptIds.length === 0 ? {} : { receiptIds }),
    }) as { readonly submissionId?: unknown };
    // The official value is only the receipt; `submissionId` is returned as a
    // compatible extension so the browser seam can keep observing projections
    // while the alarm owns the actual turn.
    return {
      accepted: true,
      ...(typeof result.submissionId === "string" ? { submissionId: result.submissionId } : {}),
    };
  });

  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}
