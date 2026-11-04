/** JSON transport for the Workers-native Session Host contract. */
import type { SessionModelOption } from "./contract.ts";
import type { SessionHost } from "./host.ts";
import { WorkspaceFileError } from "./workspace-files.ts";

/** One request from the browser/Worker transport layer. */
export interface SessionHostRequest {
  readonly id?: string;
  readonly method: string;
  readonly params?: unknown;
}

/** One successful response. */
export interface SessionHostResponse {
  readonly id?: string;
  readonly result: unknown;
}

/** One failed response; never hides a contract error. */
export interface SessionHostErrorResponse {
  readonly id?: string;
  readonly error: { readonly code: string; readonly message: string; readonly details?: Record<string, unknown> };
}

type Params = Record<string, unknown>;

function paramsOf(request: SessionHostRequest): Params {
  return typeof request.params === "object" && request.params !== null
    ? request.params as Params
    : {};
}

/** Required Session id for one workspace file request. */
function workspaceSessionId(params: Params): string {
  if (typeof params.sessionId !== "string" || params.sessionId === "") {
    throw new WorkspaceFileError("gateway/bad-request", "workspace file request requires a sessionId");
  }
  return params.sessionId;
}

/** Workspace path for one workspace file request; omitted means the workspace root. */
function workspacePath(params: Params): string {
  const value = params.path;
  if (value === undefined) return "";
  if (typeof value !== "string") throw new WorkspaceFileError("gateway/bad-request", "workspace file path must be a string");
  return value;
}

/** Optional numeric argument parsed defensively from JSON or numeric text. */
function optionalNumber(params: Params, key: string): number | undefined {
  const value = params[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new WorkspaceFileError("gateway/bad-request", `${key} must be a number`);
}

/** Required base64 payload for one workspace file write. */
function workspaceDataBase64(params: Params): string {
  if (typeof params.dataBase64 !== "string") {
    throw new WorkspaceFileError("gateway/bad-request", "workspace file write requires a dataBase64 string");
  }
  return params.dataBase64;
}

/** Dispatch one Host request; the Worker route adds transport concerns only. */
export async function dispatchSessionHost(
  host: SessionHost,
  request: SessionHostRequest,
): Promise<SessionHostResponse | SessionHostErrorResponse> {
  try {
    const params = paramsOf(request);
    switch (request.method) {
      case "uploadFile":
        if (typeof params.data !== "string" || (params.name !== undefined && typeof params.name !== "string")) throw new Error("invalid upload data");
        return { result: await host.uploadFile({ sessionId: workspaceSessionId(params), data: params.data, ...(typeof params.name === "string" ? { name: params.name } : {}) }) };
      case "uploadedFileRead":
        if (typeof params.receiptId !== "string") throw new Error("invalid receiptId");
        return { result: await host.uploadedFileRead({ sessionId: workspaceSessionId(params), receiptId: params.receiptId, offset: optionalNumber(params, "offset"), limit: optionalNumber(params, "limit") }) };
      case "list":
        return { ...(request.id === undefined ? {} : { id: request.id }), result: await host.list({ ...(typeof params.cursor === "string" ? { cursor: params.cursor } : {}) }) };
      case "state":
        return { ...(request.id === undefined ? {} : { id: request.id }), result: await host.state({ sessionId: String(params.sessionId) }) };
      case "page":
        return { ...(request.id === undefined ? {} : { id: request.id }), result: await host.page({
          address: params.address as never,
          ...(typeof params.before === "number" ? { before: params.before } : {}),
          ...(typeof params.limit === "number" ? { limit: params.limit } : {}),
        }) };
      case "history":
        return { ...(request.id === undefined ? {} : { id: request.id }), result: await host.history({ sessionId: String(params.sessionId) }) };
      case "projections":
        return { ...(request.id === undefined ? {} : { id: request.id }), result: await host.projections({ sessionId: String(params.sessionId) }) };
      case "rename":
        return { ...(request.id === undefined ? {} : { id: request.id }), result: await host.rename({ sessionId: String(params.sessionId), title: String(params.title) }) };
      case "recordStepStart":
        await host.recordStepStart({ sessionId: String(params.sessionId ?? ""), requestId: String(params.requestId ?? ""), sdkRequestId: String(params.sdkRequestId ?? ""), stepId: String(params.stepId ?? ""), startedAt: typeof params.startedAt === "number" ? params.startedAt : NaN });
        return { ...(request.id === undefined ? {} : { id: request.id }), result: null };
      case "recordModelRequest":
        await host.recordModelRequest({ sessionId: String(params.sessionId ?? ""), requestId: String(params.requestId ?? ""), sdkRequestId: String(params.sdkRequestId ?? ""), model: String(params.model ?? ""), ...(params.reasoningEffort === undefined ? {} : { reasoningEffort: params.reasoningEffort as import("./storage.ts").SessionReasoningEffort }) });
        return { ...(request.id === undefined ? {} : { id: request.id }), result: null };
      case "selectModel":
        return { ...(request.id === undefined ? {} : { id: request.id }), result: await host.selectModel({ sessionId: String(params.sessionId), model: String(params.model), ...(params.reasoningEffort === undefined ? {} : { reasoningEffort: String(params.reasoningEffort) }) }) };
      case "models":
        return { ...(request.id === undefined ? {} : { id: request.id }), result: await host.models() };
      case "permissionCatalog":
        return { ...(request.id === undefined ? {} : { id: request.id }), result: await host.permissionCatalog() };
      case "permissionCommands":
        return { ...(request.id === undefined ? {} : { id: request.id }), result: await host.permissionCommands({ sessionId: workspaceSessionId(params) }) };
      case "executePermissionCommand":
        if (typeof params.line !== 'string' || !Array.isArray(params.attachments) || typeof params.rpcId !== 'string' || params.rpcId === '') throw new WorkspaceFileError('gateway/bad-request', 'Invalid permission command invocation');
        return { ...(request.id === undefined ? {} : { id: request.id }), result: await host.executePermissionCommand({ sessionId: workspaceSessionId(params), line: params.line, attachments: params.attachments, rpcId: params.rpcId }) };
      case "permissionSnapshot":
        return { ...(request.id === undefined ? {} : { id: request.id }), result: await host.permissionSnapshot({ sessionId: workspaceSessionId(params) }) };
      case "approvalModelContext":
        return { ...(request.id === undefined ? {} : { id: request.id }), result: await host.approvalModelContext({ sessionId: workspaceSessionId(params) }) };
      case "selectPermission":
        if (typeof params.preset !== "string" || params.preset.length === 0) throw new WorkspaceFileError("gateway/bad-request", "permission selection requires a preset");
        return { ...(request.id === undefined ? {} : { id: request.id }), result: await host.selectPermission({ sessionId: workspaceSessionId(params), preset: params.preset }) };
      case "workspaceState":
        return { ...(request.id === undefined ? {} : { id: request.id }), result: await host.workspaceState() };
      case "workspaceInitializeDefault":
        return { ...(request.id === undefined ? {} : { id: request.id }), result: await host.workspaceInitializeDefault() };
      case "workspaceCreate":
        return { ...(request.id === undefined ? {} : { id: request.id }), result: await host.workspaceCreate({
          ...(typeof params.path === "string" ? { path: params.path } : {}),
          ...(typeof params.title === "string" ? { title: params.title } : {}),
        }) };
      case "workspaceRename":
        return { ...(request.id === undefined ? {} : { id: request.id }), result: await host.workspaceRename({
          workspaceId: String(params.workspaceId),
          title: String(params.title),
        }) };
      case "workspaceDelete":
        return { ...(request.id === undefined ? {} : { id: request.id }), result: await host.workspaceDelete({ workspaceId: String(params.workspaceId) }) };
      case "workspaceInsertBefore":
        return { ...(request.id === undefined ? {} : { id: request.id }), result: await host.workspaceInsertBefore({
          workspaceId: String(params.workspaceId),
          ...(typeof params.beforeWorkspaceId === "string" ? { beforeWorkspaceId: params.beforeWorkspaceId } : {}),
        }) };
      case "workspaceInsertSessionBefore":
        return { ...(request.id === undefined ? {} : { id: request.id }), result: await host.workspaceInsertSessionBefore({
          workspaceId: String(params.workspaceId),
          sessionId: String(params.sessionId),
          ...(typeof params.beforeSessionId === "string" ? { beforeSessionId: params.beforeSessionId } : {}),
        }) };
      case "workspaceArchive":
        return { ...(request.id === undefined ? {} : { id: request.id }), result: await host.workspaceArchive({ sessionId: String(params.sessionId), stopActivity: params.stopActivity === true }) };
      case "directoryList":
        if (params.path !== undefined && typeof params.path !== "string") throw new Error("path must be a string");
        return { result: await host.directoryList(params.path as string | undefined) };
      case "directoryCreate":
        if (typeof params.path !== "string" || typeof params.name !== "string") throw new Error("path and name must be strings");
        return { result: await host.directoryCreate(params.path, params.name) };
      case "workspaceSetFlags":
        return { ...(request.id === undefined ? {} : { id: request.id }), result: await host.workspaceSetFlags({
          sessionId: String(params.sessionId),
          ...(typeof params.pinned === "boolean" ? { pinned: params.pinned } : {}),
          ...(typeof params.archived === "boolean" ? { archived: params.archived } : {}),
        }) };
      case "workspaceFileList":
        return { ...(request.id === undefined ? {} : { id: request.id }), result: await host.workspaceFileList({
          sessionId: workspaceSessionId(params),
          path: workspacePath(params),
        }) };
      case "workspaceFileStat":
        return { ...(request.id === undefined ? {} : { id: request.id }), result: await host.workspaceFileStat({
          sessionId: workspaceSessionId(params),
          path: workspacePath(params),
        }) };
      case "workspaceFileRead": {
        const offset = optionalNumber(params, "offset");
        const limit = optionalNumber(params, "limit");
        return { ...(request.id === undefined ? {} : { id: request.id }), result: await host.workspaceFileRead({
          sessionId: workspaceSessionId(params),
          path: workspacePath(params),
          ...(offset === undefined ? {} : { offset }),
          ...(limit === undefined ? {} : { limit }),
        }) };
      }
      case "workspaceFileReadBytes": {
        const offset = optionalNumber(params, "offset");
        const length = optionalNumber(params, "length");
        return { ...(request.id === undefined ? {} : { id: request.id }), result: await host.workspaceFileReadBytes({
          sessionId: workspaceSessionId(params),
          path: workspacePath(params),
          ...(offset === undefined ? {} : { offset }),
          ...(length === undefined ? {} : { length }),
        }) };
      }
      case "workspaceFileWriteFromAgent":
      case "workspaceFileWrite": {
        const mediaType = params.mediaType;
        if (mediaType !== undefined && typeof mediaType !== "string") {
          throw new WorkspaceFileError("gateway/bad-request", "mediaType must be a string");
        }
        return { ...(request.id === undefined ? {} : { id: request.id }), result: await host[request.method === 'workspaceFileWriteFromAgent' ? 'workspaceFileWriteFromAgent' : 'workspaceFileWrite']({
          sessionId: workspaceSessionId(params),
          path: workspacePath(params),
          dataBase64: workspaceDataBase64(params),
          ...(mediaType === undefined ? {} : { mediaType }),
        }) };
      }
      case "workspaceFileEnsureTranscript":
        return { ...(request.id === undefined ? {} : { id: request.id }), result: await host.workspaceFileEnsureTranscript({
          sessionId: workspaceSessionId(params),
        }) };
      case "uploadAttachment":
        return { ...(request.id === undefined ? {} : { id: request.id }), result: await host.uploadAttachment({
          sessionId: String(params.sessionId),
          name: String(params.name),
          mediaType: String(params.mediaType),
          dataBase64: String(params.dataBase64),
        }) };
      case "prompt":
        if (params.receiptIds !== undefined && (!Array.isArray(params.receiptIds) || !params.receiptIds.every(value => typeof value === "string" && value !== ""))) throw new Error("invalid upload receipts");
        return { ...(request.id === undefined ? {} : { id: request.id }), result: await host.prompt({
          sessionId: String(params.sessionId),
          text: typeof params.text === "string" ? params.text : "",
          ...(typeof params.requestId === "string" ? { requestId: params.requestId } : {}),
          ...(Array.isArray(params.attachments) ? { attachments: params.attachments as never } : {}),
          ...(Array.isArray(params.receiptIds) && params.receiptIds.every(value => typeof value === "string") ? { receiptIds: params.receiptIds as string[] } : {}),
        }) };
      case "cancel":
        return { ...(request.id === undefined ? {} : { id: request.id }), result: await host.cancel({ sessionId: String(params.sessionId) }) };
      case "claim":
        return { ...(request.id === undefined ? {} : { id: request.id }), error: { code: "unsupported", message: "claim requires the Durable Object agent binding" } };
      case "appendSessionEvent":
        return { ...(request.id === undefined ? {} : { id: request.id }), result: await host.appendSessionEvent({
          sessionId: String(params.sessionId),
          type: String(params.type),
          payload: params.payload,
        }) };
      case "restoreSidecar":
        return { ...(request.id === undefined ? {} : { id: request.id }), result: host.restoreMigrationSidecar(
          typeof params.sidecar === "object" && params.sidecar !== null ? params.sidecar as never : {},
        ) };
      case "maintenanceList":
        return { ...(request.id === undefined ? {} : { id: request.id }), result: host.maintenanceList() };
      case "maintenanceRun":
        return { ...(request.id === undefined ? {} : { id: request.id }), result: await host.maintenanceRun({
          kind: String(params.kind),
          ...(typeof params.olderThanMs === "number" ? { olderThanMs: params.olderThanMs } : {}),
        }) };
      case "maintenanceHistory":
        return { ...(request.id === undefined ? {} : { id: request.id }), result: host.maintenanceHistory({ ...(typeof params.limit === "number" ? { limit: params.limit } : {}) }) };
      case "scheduleDeliveryLimits":
        return { ...(request.id === undefined ? {} : { id: request.id }), result: host.scheduleDeliveryLimits() };
      case "scheduleCreate": {
        const createRequest = typeof params.request === "object" && params.request !== null ? params.request as Record<string, unknown> : {};
        return { ...(request.id === undefined ? {} : { id: request.id }), result: host.scheduleCreate({ request: createRequest }) };
      }
      case "scheduleList":
        return { ...(request.id === undefined ? {} : { id: request.id }), result: host.scheduleList({
          ...(typeof params.active === "boolean" ? { active: params.active } : {}),
          ...(typeof params.limit === "number" ? { limit: params.limit } : {}),
          ...(typeof params.offset === "number" ? { offset: params.offset } : {}),
        }) };
      case "scheduleCatalog":
        return { ...(request.id === undefined ? {} : { id: request.id }), result: host.scheduleCatalog() };
      case "scheduleView":
        return { ...(request.id === undefined ? {} : { id: request.id }), result: host.scheduleView({ id: String(params.id) }) };
      case "scheduleHistory":
        return { ...(request.id === undefined ? {} : { id: request.id }), result: host.scheduleHistory({
          id: String(params.id),
          limit: typeof params.limit === "number" ? params.limit : 50,
          ...(typeof params.before === "string" ? { before: params.before } : {}),
        }) };
      case "scheduleEdit":
        return { ...(request.id === undefined ? {} : { id: request.id }), result: host.scheduleEdit({
          id: String(params.id),
          action: params.action === "delete" ? "delete" : "update",
          ...(typeof params.patch === "object" && params.patch !== null ? { patch: params.patch as Record<string, unknown> } : {}),
          ...(params.expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt: typeof params.expectedUpdatedAt === "string" ? params.expectedUpdatedAt : null }),
        }) };
      case "scheduleRun":
        return { ...(request.id === undefined ? {} : { id: request.id }), result: await host.scheduleRun({ id: String(params.id) }) };
      case "scheduleDeleteInactive":
        return { ...(request.id === undefined ? {} : { id: request.id }), result: host.scheduleDeleteInactive() };
      case "llmDiscoverModels":
        return { ...(request.id === undefined ? {} : { id: request.id }), result: await host.llmDiscoverModels({
          settingsNs: String(params.settingsNs),
          ...(typeof params.apiKey === "string" ? { apiKey: params.apiKey } : {}),
          ...(typeof params.baseURL === "string" ? { baseURL: params.baseURL } : {}),
        }) };
      case "credentialsDescribe": {
        const refs = Array.isArray(params.refs) ? params.refs.map(String) : [];
        return { ...(request.id === undefined ? {} : { id: request.id }), result: await host.credentialsDescribe({ refs }) };
      }
      case "credentialsSet":
        await host.credentialsSet({ ref: String(params.ref), value: String(params.value) });
        return { ...(request.id === undefined ? {} : { id: request.id }), result: null };
      case "credentialsUnset":
        await host.credentialsUnset({ ref: String(params.ref) });
        return { ...(request.id === undefined ? {} : { id: request.id }), result: null };
      case "settingsDescribe":
        return { ...(request.id === undefined ? {} : { id: request.id }), result: await host.settingsDescribe() };
      case "settingsUpdate":
        if (typeof params.patch !== "object" || params.patch === null || Array.isArray(params.patch)) throw new Error("settings update requires an object patch");
        return { ...(request.id === undefined ? {} : { id: request.id }), result: await host.settingsUpdate({
          ns: String(params.ns), patch: params.patch as Record<string, unknown>,
          ...(typeof params.expectedRevision === "number" ? { expectedRevision: params.expectedRevision } : {}),
        }) };
      case "settingsMutate": {
        const ops = Array.isArray(params.ops) ? params.ops as Array<Record<string, unknown>> : [];
        return { ...(request.id === undefined ? {} : { id: request.id }), result: await host.settingsMutate({
          ns: String(params.ns),
          expectedRevision: typeof params.expectedRevision === "number" ? params.expectedRevision : undefined,
          ops: ops.map((operation) => ({
            op: operation.op === "unset" ? "unset" as const : "set" as const,
            path: Array.isArray(operation.path) ? operation.path.map(String) : [],
            ...(operation.value === undefined ? {} : { value: operation.value }),
          })),
        }) };
      }
      case "queue":
        return { ...(request.id === undefined ? {} : { id: request.id }), result: await host.queue({ sessionId: String(params.sessionId) }) };
      case "editQueueItem":
        return { ...(request.id === undefined ? {} : { id: request.id }), result: await host.editQueueItem({
          sessionId: String(params.sessionId),
          submissionId: String(params.submissionId),
          text: typeof params.text === "string" ? params.text : "",
        }) };
      case "updateQueue":
        return { ...(request.id === undefined ? {} : { id: request.id }), result: await host.updateQueue({
          sessionId: String(params.sessionId),
          itemId: String(params.itemId),
          action: String(params.action) as "remove" | "retry" | "clear",
        }) };
      case "create":
        for (const field of ["sessionId", "title", "workspaceId", "cwd", "agentPreset"]) {
          if (params[field] !== undefined && typeof params[field] !== "string") throw new WorkspaceFileError("gateway/bad-request", `${field} must be a string`);
        }
        if (params.reuseBlankOnly !== undefined && typeof params.reuseBlankOnly !== "boolean") throw new WorkspaceFileError("gateway/bad-request", "reuseBlankOnly must be a boolean");
        return { ...(request.id === undefined ? {} : { id: request.id }), result: await host.create({
          ...(typeof params.title === "string" ? { title: params.title } : {}),
          ...(typeof params.sessionId === "string" ? { sessionId: params.sessionId } : {}),
          ...(typeof params.workspaceId === "string" ? { workspaceId: params.workspaceId } : {}),
          ...(typeof params.cwd === "string" ? { cwd: params.cwd } : {}),
          ...(typeof params.agentPreset === "string" ? { agentPreset: params.agentPreset } : {}),
          ...(params.reuseBlankOnly === true ? { reuseBlankOnly: true } : {}),
        }) };
      case "fork":
        if (params.atSeq !== undefined && (typeof params.atSeq !== "number" || !Number.isSafeInteger(params.atSeq) || params.atSeq < 0)) throw new WorkspaceFileError("gateway/bad-request", "atSeq must be a non-negative integer");
        if (params.assistantStep !== undefined && (typeof params.assistantStep !== "number" || !Number.isSafeInteger(params.assistantStep) || params.assistantStep < 0)) throw new WorkspaceFileError("gateway/bad-request", "assistantStep must be a non-negative integer");
        return { ...(request.id === undefined ? {} : { id: request.id }), result: await host.fork({
          sessionId: String(params.sessionId),
          ...(typeof params.atSeq === "number" ? { atSeq: params.atSeq } : {}),
          ...(typeof params.messageId === "string" ? { messageId: params.messageId } : {}),
          ...(typeof params.assistantStep === "number" ? { assistantStep: params.assistantStep } : {}),
          ...(typeof params.sessionIdNew === "string" ? { sessionIdNew: params.sessionIdNew } : {}),
        }) };
      default:
        return { ...(request.id === undefined ? {} : { id: request.id }), error: { code: "unknown_method", message: `unknown Session Host method: ${request.method}` } };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const explicit = (error as { readonly code?: string }).code;
    const code = typeof explicit === "string" && explicit !== ""
      ? explicit
      : message.includes("not found") ? "not_found" : "invalid_request";
    return { ...(request.id === undefined ? {} : { id: request.id }), error: { code, message, ...((error as { details?: Record<string, unknown> }).details === undefined ? {} : { details: (error as { details: Record<string, unknown> }).details }) } };
  }
}

/** Model catalog helper for static Worker model options. */
export function parseModelCatalog(value: string | undefined, fallback: readonly SessionModelOption[]): readonly SessionModelOption[] {
  if (value === undefined || value.trim() === "") return fallback;
  return value.split(",").map((id) => id.trim()).filter((id) => id !== "").map((id) => ({
    id,
    label: id,
    contextWindow: 128_000,
  }));
}
