/** Settings method arguments over the official Connection RPC carrier, with an anonymous local mode. */
import type { ClientConnectionRpc } from "@deepseek-ai/dsh-client-connection/client";
import type { SettingsDescribeValue, SettingsNamespaceView, SettingsPathOpView } from "@deepseek-ai/dsh-settings/types";
import type { AnonymousSettingsDocument } from "./local-settings-document.ts";

type Failure = { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly details?: unknown } };
export type SettingsResult<T> = { readonly ok: true; readonly value: T } | Failure;

export interface SettingsRemoteOptions {
  readonly rpc: () => Pick<ClientConnectionRpc, "call">;
  /** Observe accepted values only; never invent a successful local write. */
  readonly accepted?: (namespace: SettingsNamespaceView) => void;
  readonly changed?: (namespace: SettingsNamespaceView) => void;
  /**
   * Anonymous local document. Enabled only when `isAnonymous` resolves true,
   * which the caller must derive from an explicit signed-out session answer.
   */
  readonly anonymous?: {
    readonly isAnonymous: () => Promise<boolean>;
    /** Constructed lazily: signed-in pages must not read or write localStorage. */
    readonly document: () => AnonymousSettingsDocument;
  };
}

/** RC4's Web settings card requests the deployment's search/fetch provider registry. */
export const unavailableWebRemote = {
  listProviders: async () => ({ ok: false as const, error: {
    code: "gateway/endpoint-unavailable",
    message: "The deployment does not serve the DSH web provider registry.",
    details: { endpoint: "web/listProviders" },
  } }),
};

/** The Host owns schemas, durable values, revision CAS and rejection semantics. */
export function createSettingsRemote(options: SettingsRemoteOptions) {
  const call = async <T>(method: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<SettingsResult<T>> =>
    await options.rpc().call("/api", `settings/${method}`, { args }, signal) as SettingsResult<T>;

  /** The anonymous document when the session answer is explicitly signed-out. */
  const local = async (): Promise<AnonymousSettingsDocument | undefined> => {
    if (options.anonymous === undefined) return undefined;
    try {
      return await options.anonymous.isAnonymous() ? options.anonymous.document() : undefined;
    } catch {
      return undefined;
    }
  };

  const write = async (method: "mutate" | "update" | "replace", ns: string, value: Record<string, unknown>, expectedRevision?: number) => {
    const document = await local();
    const result = document === undefined
      ? await call<SettingsNamespaceView>(method, {
        ns,
        ...value,
        ...(expectedRevision === undefined ? {} : { expectedRevision }),
      })
      : method === "mutate"
        ? document.mutate(ns, value.ops as readonly SettingsPathOpView[], expectedRevision)
        : method === "update"
          ? document.update(ns, value.patch as Record<string, unknown>, expectedRevision)
          : document.replace(ns, value.section as Record<string, unknown>, expectedRevision);
    if (result.ok) {
      options.accepted?.(result.value);
      options.changed?.(result.value);
    }
    return result;
  };

  return {
    describe: async () => {
      const document = await local();
      const result = document === undefined
        ? await call<SettingsDescribeValue>("describe", {})
        : document.describe();
      if (result.ok) for (const namespace of result.value.namespaces) options.accepted?.(namespace);
      return result;
    },
    mutate: (ns: string, ops: readonly SettingsPathOpView[], expectedRevision?: number) => write("mutate", ns, { ops }, expectedRevision),
    update: (ns: string, patch: Record<string, unknown>, expectedRevision?: number) => write("update", ns, { patch }, expectedRevision),
    replace: (ns: string, section: Record<string, unknown>, expectedRevision?: number) => write("replace", ns, { section }, expectedRevision),
    openSettingsDocument: async (signal?: AbortSignal) => {
      const document = await local();
      if (document !== undefined) {
        return { ok: false as const, error: { code: "settings/unavailable", message: "anonymous settings are local to this browser and have no Host document" } };
      }
      return await call<{ readonly opened: true }>("openSettingsDocument", {}, signal);
    },
  };
}
