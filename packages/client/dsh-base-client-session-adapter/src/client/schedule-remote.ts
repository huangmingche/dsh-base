/** Full official Schedule argument shapes over the existing Connection RPC. */
import type { ClientConnectionRpc } from "@deepseek-ai/dsh-client-connection/client";

interface ScheduleRemoteOptions {
  readonly rpc: () => Pick<ClientConnectionRpc, "call">;
  readonly changed: () => void;
}

/** No action rewriting or browser task state: the Host owns schedule semantics. */
export function createScheduleRemote(options: ScheduleRemoteOptions) {
  const call = async (method: string, request?: Record<string, unknown>, changes = false) => {
    const result = await options.rpc().call("/api", `schedule/${method}`, {
      args: request === undefined ? {} : { request },
    });
    if (result.ok && changes) options.changed();
    return result;
  };
  return {
    deliveryLimits: () => call("deliveryLimits"),
    catalog: () => call("catalog"),
    list: (request: Record<string, unknown>) => call("list", request),
    view: (request: Record<string, unknown>) => call("view", request),
    create: (request: Record<string, unknown>) => call("create", request, true),
    edit: (request: Record<string, unknown>) => call("edit", request, true),
    run: (request: Record<string, unknown>) => call("run", request, true),
    history: (request: Record<string, unknown>) => call("history", request),
    deleteInactive: () => call("deleteInactive", undefined, true),
  };
}
