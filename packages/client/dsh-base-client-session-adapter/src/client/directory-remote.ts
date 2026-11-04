/** The unchanged official browser picker owns UI; the Host owns paths and persistence. */
import type { ClientConnectionRpc } from "@deepseek-ai/dsh-client-connection/client";

export function createDirectoryRemote(rpc: () => Pick<ClientConnectionRpc, "call">) {
  const call = (method: string, args: Record<string, unknown>, signal?: AbortSignal) =>
    rpc().call("/api", `directoryPicker/${method}`, { args }, signal);
  return {
    pick: (signal?: AbortSignal) => call("pick", {}, signal),
    list: (path?: string, signal?: AbortSignal) => call("list", path === undefined ? {} : { path }, signal),
    createDirectory: (path: string, name: string) => call("createDirectory", { path, name }),
  };
}
