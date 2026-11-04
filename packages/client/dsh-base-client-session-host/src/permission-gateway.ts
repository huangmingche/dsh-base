/**
 * Official-style client descriptor for the read-only `permissionPresets`
 * namespace. The deployment has no Host permission runtime yet; the catalog is
 * still served through the official envelope so the permission UI can consume
 * it exactly like the official descriptor.
 */
import type { ConnectionHandle } from "@deepseek-ai/dsh-client-connection/client";

/** One selectable permission preset. */
export interface PermissionPresetOption {
  readonly value: string;
  readonly name: string;
  readonly description?: string;
}

/** Process-level permission catalog. */
export interface PermissionPresetCatalog {
  readonly options: readonly PermissionPresetOption[];
  readonly defaultOptions: readonly PermissionPresetOption[];
  readonly defaultPreset: string;
}

/** One official Remote result envelope. */
export type PermissionGatewayResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };

/** Options for the permission catalog gateway. */
export interface OfficialPermissionGatewayOptions {
  readonly baseUrl: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly connection?: () => ConnectionHandle | undefined;
}

/** Official `permissionPresets/catalog` endpoint. */
export const PERMISSION_REMOTE_ENDPOINT = "permissionPresets/catalog";

/** Official-style caller for the read-only permission catalog. */
export interface OfficialPermissionGateway {
  catalog(signal?: AbortSignal): Promise<PermissionGatewayResult<PermissionPresetCatalog>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function newRpcId(): string {
  const cryptoFace = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (typeof cryptoFace?.randomUUID === "function") return cryptoFace.randomUUID();
  return `permission-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Create the official permission-catalog caller.
 * @param options - deployment origin, optional connection and fetch override.
 * @returns catalog gateway.
 */
export function createOfficialPermissionGateway(options: OfficialPermissionGatewayOptions): OfficialPermissionGateway {
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  const endpoint = PERMISSION_REMOTE_ENDPOINT;
  return {
    async catalog(signal) {
      const payload = { args: {} };
      const connection = options.connection?.();
      if (connection !== undefined) {
        return await connection.rpc.call("/api", endpoint, payload, signal) as PermissionGatewayResult<PermissionPresetCatalog>;
      }
      const rpcId = newRpcId();
      const response = await fetcher(`${options.baseUrl.replace(/\/+$/, "")}/api/${endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "client-request", rpcId, method: endpoint, payload }),
        ...(signal === undefined ? {} : { signal }),
      });
      if (!response.ok) throw new Error(`permissionPresets/catalog transport failure: HTTP ${response.status}`);
      const body = await response.json() as { readonly type?: unknown; readonly rpcId?: unknown; readonly result?: unknown };
      if (body.type !== "server-response" || body.rpcId !== rpcId || !isRecord(body.result)) {
        throw new Error("permissionPresets/catalog invalid server-response envelope");
      }
      const result = body.result;
      if (result.ok === true) return { ok: true, value: result.value as PermissionPresetCatalog };
      if (result.ok === false && isRecord(result.error)
        && typeof result.error.code === "string" && typeof result.error.message === "string") {
        return { ok: false, error: { code: result.error.code, message: result.error.message } };
      }
      throw new Error("permissionPresets/catalog invalid server-response result");
    },
  };
}
