/** Settings method arguments over the official Connection RPC carrier. */
import type { ClientConnectionRpc } from "@deepseek-ai/dsh-client-connection/client";
import type { SettingsDescribeValue, SettingsNamespaceView, SettingsPathOpView } from "@deepseek-ai/dsh-settings/types";

type Failure = { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly details?: unknown } };
export type SettingsResult<T> = { readonly ok: true; readonly value: T } | Failure;

export interface SettingsRemoteOptions {
  readonly rpc: () => Pick<ClientConnectionRpc, "call">;
  /** Observe accepted values only; never invent a successful local write. */
  readonly accepted?: (namespace: SettingsNamespaceView) => void;
  readonly changed?: (namespace: SettingsNamespaceView) => void;
}

/** The Host owns schemas, durable values, revision CAS and rejection semantics. */
export function createSettingsRemote(options: SettingsRemoteOptions) {
  const call = async <T>(method: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<SettingsResult<T>> =>
    await options.rpc().call("/api", `settings/${method}`, { args }, signal) as SettingsResult<T>;

  const write = async (method: "mutate" | "update" | "replace", ns: string, value: Record<string, unknown>, expectedRevision?: number) => {
    const result = await call<SettingsNamespaceView>(method, {
      ns,
      ...value,
      ...(expectedRevision === undefined ? {} : { expectedRevision }),
    });
    if (result.ok) {
      options.accepted?.(result.value);
      options.changed?.(result.value);
    }
    return result;
  };

  return {
    describe: async () => {
      const result = await call<SettingsDescribeValue>("describe", {});
      if (result.ok) for (const namespace of result.value.namespaces) options.accepted?.(namespace);
      return result;
    },
    mutate: (ns: string, ops: readonly SettingsPathOpView[], expectedRevision?: number) => write("mutate", ns, { ops }, expectedRevision),
    update: (ns: string, patch: Record<string, unknown>, expectedRevision?: number) => write("update", ns, { patch }, expectedRevision),
    replace: (ns: string, section: Record<string, unknown>, expectedRevision?: number) => write("replace", ns, { section }, expectedRevision),
    openSettingsDocument: (signal?: AbortSignal) => call<{ readonly opened: true }>("openSettingsDocument", {}, signal),
  };
}
