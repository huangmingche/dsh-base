/**
 * Official `schedule` namespace bridge.
 *
 * The Workers-native Host owns the durable task store and the alarm-driven
 * delivery engine; this module only maps the generated unary endpoints onto the
 * owner-scoped `/api/session-host` methods.
 */
import type { WireInvocation, WireRpc } from "@dsh-base/cloudflare-worker-wire-rpc";
import { SessionRpcFault } from "./remote-contract.ts";
import { createHostCall } from "./host-call.ts";
import { argsOf, requestOf } from "./remote.ts";

/** One endpoint registration helper. */
function registerEndpoint(wireRpc: WireRpc, disposers: Array<() => void>, method: string, handler: (payload: unknown, invocation: WireInvocation) => Promise<unknown> | unknown): void {
  disposers.push(wireRpc.register(`schedule/${method}`, handler));
}

/**
 * Register the migrated `schedule` unary endpoints.
 * @param wireRpc - generic wire-RPC endpoint registry.
 * @returns disposer withdrawing every endpoint.
 */
export function registerScheduleRemoteEndpoints(wireRpc: WireRpc): () => void {
  const disposers: Array<() => void> = [];
  const requestArgs = (payload: unknown, endpoint: string): Record<string, unknown> => requestOf(argsOf(payload, endpoint), endpoint);

  registerEndpoint(wireRpc, disposers, "deliveryLimits", async (payload, invocation) => {
    argsOf(payload, "schedule/deliveryLimits");
    return await createHostCall(invocation)("scheduleDeliveryLimits");
  });
  registerEndpoint(wireRpc, disposers, "create", async (payload, invocation) => {
    const endpoint = "schedule/create";
    const request = requestArgs(payload, endpoint);
    return await createHostCall(invocation)("scheduleCreate", { request });
  });
  registerEndpoint(wireRpc, disposers, "list", async (payload, invocation) => {
    const endpoint = "schedule/list";
    const request = requestArgs(payload, endpoint);
    return await createHostCall(invocation)("scheduleList", request);
  });
  registerEndpoint(wireRpc, disposers, "catalog", async (payload, invocation) => {
    argsOf(payload, "schedule/catalog");
    return await createHostCall(invocation)("scheduleCatalog");
  });
  registerEndpoint(wireRpc, disposers, "view", async (payload, invocation) => {
    const endpoint = "schedule/view";
    const request = requestArgs(payload, endpoint);
    return await createHostCall(invocation)("scheduleView", { id: request.id });
  });
  registerEndpoint(wireRpc, disposers, "history", async (payload, invocation) => {
    const endpoint = "schedule/history";
    const request = requestArgs(payload, endpoint);
    return await createHostCall(invocation)("scheduleHistory", request);
  });
  registerEndpoint(wireRpc, disposers, "run", async (payload, invocation) => {
    const endpoint = "schedule/run";
    const request = requestArgs(payload, endpoint);
    return await createHostCall(invocation)("scheduleRun", { id: request.id });
  });
  registerEndpoint(wireRpc, disposers, "deleteInactive", async (payload, invocation) => {
    argsOf(payload, "schedule/deleteInactive");
    return await createHostCall(invocation)("scheduleDeleteInactive");
  });
  registerEndpoint(wireRpc, disposers, "edit", async (payload, invocation) => {
    const endpoint = "schedule/edit";
    const request = requestArgs(payload, endpoint);
    if (typeof request.action !== "string") throw new SessionRpcFault("gateway/bad-request", `${endpoint}: action is required`, { endpoint });
    return await createHostCall(invocation)("scheduleEdit", request);
  });

  return () => { for (const dispose of disposers.reverse()) dispose(); };
}
