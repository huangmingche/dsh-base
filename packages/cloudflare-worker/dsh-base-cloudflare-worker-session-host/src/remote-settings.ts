/**
 * Official `settings` Remote bridge over the durable Host settings document.
 *
 * This Host seam projects the official namespace contracts with
 * durable namespace values and the same revision compare-and-set semantics
 * `settings/mutate|update|replace` require. A native settings-document editor is
 * unavailable, so `openSettingsDocument` reports the endpoint as unavailable
 * instead of pretending to open a file.
 */
import type { WireInvocation, WireRpc } from "@dsh-base/cloudflare-worker-wire-rpc";
import { SessionRpcFault } from "./remote-contract.ts";
import { createHostCall } from "./host-call.ts";
import { DEPLOYMENT_MODELS } from "./model-catalog.ts";
import { argsOf, isRecord } from "./remote.ts";
import { PERMISSION_DEFAULT_OPTIONS, DEFAULT_PERMISSION_PRESET } from '@dsh-base/cloudflare-worker-permissions/settings';

type JsonRecord = Record<string, unknown>;

/** Minimal schemastery envelope for a namespace form. */
interface SchemaEnvelope {
  readonly type: "object";
  readonly dict?: Readonly<Record<string, unknown>>;
  readonly meta?: Readonly<Record<string, unknown>>;
}

const PERMISSION_SCHEMA: SchemaEnvelope = {
  type: "object",
  dict: {
    // Official schemastery union envelope, derived from the same configured
    // table used by the mounted permission service, never an independent enum.
    defaultPreset: { type: "union", list: PERMISSION_DEFAULT_OPTIONS.map(value => ({ type: "const", value })), meta: { default: DEFAULT_PERMISSION_PRESET } },
  },
};
const GENERAL_SCHEMA: SchemaEnvelope = {
  type: "object",
  dict: {
    welcomeNoticeVersion: { type: "string" },
  },
};
const DEEPSEEK_MODEL_SCHEMA = {
  type: "object",
  dict: {
    id: { type: "string", meta: { required: true } },
    name: { type: "string" },
    contextWindow: { type: "number" },
  },
} as const;
const DEEPSEEK_SCHEMA: SchemaEnvelope = {
  type: "object",
  dict: {
    apiKeyEnv: { type: "string", meta: { default: "DEEPSEEK_OFFICIAL_API_KEY", role: "credential-ref", volatile: true } },
    baseURL: { type: "string", meta: { default: "https://api.deepseek.com/v1" } },
    models: { type: "list", inner: DEEPSEEK_MODEL_SCHEMA, meta: { default: DEPLOYMENT_MODELS.map(model => ({ id: model.id, name: model.label, contextWindow: model.contextWindow })) } },
  },
  meta: { default: {} },
};
const KNOWN_SCHEMAS: Readonly<Record<string, SchemaEnvelope>> = {
  permission: PERMISSION_SCHEMA,
  "ui-settings-general": GENERAL_SCHEMA,
  "llm-deepseek": DEEPSEEK_SCHEMA,
  "llm-cloudflare-gateway": { type: "object", dict: {}, meta: { default: {} } },
  // Data contracts from the pinned official Host registrations; no browser
  // implementation is evaluated in the Worker runtime.
  "ui-settings": { type: "object", dict: { enabled: { type: "boolean", meta: { default: true } } } },
  locale: { type: "object", dict: { preference: { type: "string", meta: { required: false } } } },
  "ui-theme": {
    type: "object",
    dict: {
      preference: { type: "union", list: ["light", "dark", "system"].map((value) => ({ type: "const", value })), meta: { default: "system" } },
      fontSize: { type: "number", meta: { default: 14, min: 10, max: 22, step: 1 } },
      codeFontSize: { type: "number", meta: { default: 11, min: 10, max: 16, step: 1 } },
      terminalFontSize: { type: "number", meta: { default: 13, min: 10, max: 20, step: 1 } },
      textFontFamily: { type: "string", meta: { default: "" } },
      codeFontFamily: { type: "string", meta: { default: "" } },
      terminalFontFamily: { type: "string", meta: { default: "" } },
    },
  },
};
const DEFAULT_VALUES: Readonly<Record<string, JsonRecord>> = {
  permission: { defaultPreset: DEFAULT_PERMISSION_PRESET },
  "ui-settings-general": {},
  "llm-deepseek": { apiKeyEnv: "DEEPSEEK_OFFICIAL_API_KEY", baseURL: "https://api.deepseek.com/v1", models: DEPLOYMENT_MODELS.map(model => ({ id: model.id, name: model.label, contextWindow: model.contextWindow })) },
  "llm-cloudflare-gateway": {},
  "ui-settings": { enabled: true },
  locale: {},
  "ui-theme": { preference: "system", fontSize: 14, codeFontSize: 11, terminalFontSize: 13, textFontFamily: "", codeFontFamily: "", terminalFontFamily: "" },
};

/** Read the flat official argument object (multi-parameter methods use flat args). */
function flatArgs(payload: unknown, endpoint: string): JsonRecord {
  const args = argsOf(payload, endpoint);
  return isRecord(args.request) ? args.request : args;
}

/** Build the official describe value from one durable snapshot. */
export function settingsViewsFromSnapshot(snapshot: { readonly revision?: unknown; readonly values?: unknown }): {
  readonly writable: true;
  readonly hasDocument: false;
  readonly namespaces: ReadonlyArray<{
    readonly ns: string;
    readonly autoGenerate: false;
    readonly schema: SchemaEnvelope;
    readonly value: JsonRecord;
    readonly user: JsonRecord;
    readonly base: JsonRecord;
    readonly applies: "live";
    readonly secrets: ReadonlyArray<{ readonly path: readonly string[]; readonly set: boolean }>;
    readonly revision: number;
  }>;
} {
  const values = isRecord(snapshot.values) ? snapshot.values as Record<string, JsonRecord> : {};
  const revision = typeof snapshot.revision === "number" ? snapshot.revision : 0;
  const names = [...new Set([...Object.keys(DEFAULT_VALUES), ...Object.keys(values)])];
  return {
    writable: true,
    hasDocument: false,
    namespaces: names.map((ns) => {
      const base = DEFAULT_VALUES[ns] ?? {};
      const stored = values[ns] ?? {};
      const visibleBase = base;
      const visibleStored = stored;
      return {
        ns,
        autoGenerate: false,
        schema: KNOWN_SCHEMAS[ns] ?? { type: "object" as const },
        value: { ...visibleBase, ...visibleStored },
        user: { ...visibleStored },
        base: { ...visibleBase },
        applies: "live" as const,
        secrets: [],
        revision,
      };
    }),
  };
}


/** Deployment-owned settings namespaces whose runtime does not consume edits. */
export function rejectUnsupportedSettingsWrite(endpoint: string, ns: string, paths: readonly (readonly string[])[]): void {
  void paths;
  if (ns === 'llm-cloudflare-gateway') throw new SessionRpcFault('gateway/endpoint-unavailable', `${endpoint}: Cloudflare AI Gateway settings are operator-managed`, { endpoint, ns });
}

/** Convert one namespace view from the official describe value. */
function viewOf(describe: ReturnType<typeof settingsViewsFromSnapshot>, ns: string): unknown {
  return describe.namespaces.find((view) => view.ns === ns) ?? {
    ns,
    autoGenerate: false,
    schema: { type: "object" },
    value: {},
    user: {},
    base: {},
    applies: "live",
    secrets: [],
    revision: describe.namespaces[0]?.revision ?? 0,
  };
}

/**
 * Register the official `settings` unary endpoints.
 * @param wireRpc - generic wire-RPC endpoint registry.
 * @returns disposer withdrawing every endpoint.
 */
export function registerSettingsRemoteEndpoints(wireRpc: WireRpc): () => void {
  const disposers: Array<() => void> = [];
  const register = (method: string, handler: (payload: unknown, invocation: WireInvocation) => Promise<unknown> | unknown): void => {
    disposers.push(wireRpc.register(`settings/${method}`, handler));
  };

  register("describe", async (payload, invocation) => {
    argsOf(payload, "settings/describe");
    const snapshot = await createHostCall(invocation)("settingsDescribe", {}) as { readonly revision?: unknown; readonly values?: unknown };
    return settingsViewsFromSnapshot(snapshot);
  });

  register("mutate", async (payload, invocation) => {
    const endpoint = "settings/mutate";
    const request = flatArgs(payload, endpoint);
    if (typeof request.ns !== "string" || request.ns === "") throw new SessionRpcFault("gateway/bad-request", `${endpoint}: ns is required`, { endpoint });
    if (!Array.isArray(request.ops)) throw new SessionRpcFault("gateway/bad-request", `${endpoint}: ops are required`, { endpoint });
    rejectUnsupportedSettingsWrite(endpoint, request.ns, request.ops.map(op => Array.isArray(op?.path) ? op.path : []));
    const expectedRevision = typeof request.expectedRevision === "number" ? request.expectedRevision : undefined;
    try {
      const snapshot = await createHostCall(invocation)("settingsMutate", {
        ns: request.ns,
        ops: request.ops,
        ...(expectedRevision === undefined ? {} : { expectedRevision }),
      }) as { readonly revision?: unknown; readonly values?: unknown };
      return viewOf(settingsViewsFromSnapshot(snapshot), request.ns);
    } catch (error) {
      if (error instanceof SessionRpcFault && error.code === "settings/conflict") throw error;
      throw error;
    }
  });

  register("update", async (payload, invocation) => {
    const endpoint = "settings/update";
    const request = flatArgs(payload, endpoint);
    if (typeof request.ns !== "string" || request.ns === "") throw new SessionRpcFault("gateway/bad-request", `${endpoint}: ns is required`, { endpoint });
    if (!isRecord(request.patch)) throw new SessionRpcFault("gateway/bad-request", `${endpoint}: patch must be an object`, { endpoint });
    rejectUnsupportedSettingsWrite(endpoint, request.ns, Object.keys(request.patch).map(key => [key]));
    const expectedRevision = typeof request.expectedRevision === "number" ? request.expectedRevision : undefined;
    const snapshot = await createHostCall(invocation)("settingsUpdate", {
      ns: request.ns,
      patch: request.patch,
      ...(expectedRevision === undefined ? {} : { expectedRevision }),
    }) as { readonly revision?: unknown; readonly values?: unknown };
    return viewOf(settingsViewsFromSnapshot(snapshot), request.ns);
  });

  register("replace", async (payload, invocation) => {
    const endpoint = "settings/replace";
    const request = flatArgs(payload, endpoint);
    if (typeof request.ns !== "string" || request.ns === "") throw new SessionRpcFault("gateway/bad-request", `${endpoint}: ns is required`, { endpoint });
    if (!isRecord(request.section)) throw new SessionRpcFault("gateway/bad-request", `${endpoint}: section must be an object`, { endpoint });
    rejectUnsupportedSettingsWrite(endpoint, request.ns, Object.keys(request.section).map(key => [key]));
    const expectedRevision = typeof request.expectedRevision === "number" ? request.expectedRevision : undefined;
    const snapshot = await createHostCall(invocation)("settingsMutate", {
      ns: request.ns,
      ops: [{ op: "set", path: [], value: request.section }],
      ...(expectedRevision === undefined ? {} : { expectedRevision }),
    }) as { readonly revision?: unknown; readonly values?: unknown };
    return viewOf(settingsViewsFromSnapshot(snapshot), request.ns);
  });

  register("openSettingsDocument", async () => {
    throw new SessionRpcFault("gateway/endpoint-unavailable", "settings/openSettingsDocument: this Host has no native settings document editor", { endpoint: "settings/openSettingsDocument" });
  });

  return () => { for (const dispose of disposers.reverse()) dispose(); };
}
