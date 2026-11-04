/** Official directory-picker wire contract over the logical Host directory store. */
import type { WireRpc } from "@dsh-base/cloudflare-worker-wire-rpc";
import { argsOf } from "./remote.ts";
import { createHostCall } from "./host-call.ts";
import { SessionRpcFault } from "./remote-contract.ts";

export function registerDirectoryPickerRemoteEndpoints(wireRpc: WireRpc): () => void {
  const disposers = [
    wireRpc.register("directoryPicker/pick", async (payload) => {
      argsOf(payload, "directoryPicker/pick");
      throw new SessionRpcFault("directory-picker/unavailable", "This Host serves logical directory browsing, not a native OS chooser", { capability: "browse" });
    }),
    wireRpc.register("directoryPicker/list", async (payload, invocation) => {
      const { path } = argsOf(payload, "directoryPicker/list");
      if (path !== undefined && typeof path !== "string") throw new SessionRpcFault("gateway/bad-request", "path must be a string");
      if (invocation.request.signal.aborted) throw new SessionRpcFault("gateway/cancelled", "Directory listing was aborted");
      const listing = await createHostCall(invocation)("directoryList", path === undefined ? {} : { path });
      if (invocation.request.signal.aborted) throw new SessionRpcFault("gateway/cancelled", "Directory listing was aborted");
      return listing;
    }),
    wireRpc.register("directoryPicker/createDirectory", async (payload, invocation) => {
      const { path, name } = argsOf(payload, "directoryPicker/createDirectory");
      if (typeof path !== "string" || typeof name !== "string") throw new SessionRpcFault("gateway/bad-request", "path and name must be strings");
      return createHostCall(invocation)("directoryCreate", { path, name });
    }),
  ];
  return () => { for (const dispose of disposers.reverse()) dispose(); };
}
