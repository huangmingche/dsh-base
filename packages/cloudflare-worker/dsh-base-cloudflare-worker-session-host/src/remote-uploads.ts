/** Official file upload and attachment Remote envelopes over the owner Host. */
import type { WireRpc } from "@dsh-base/cloudflare-worker-wire-rpc";
import { argsOf, isRecord, requestOf, sessionIdOf } from "./remote.ts";
import { createHostCall } from "./host-call.ts";
import { SessionRpcFault } from "./remote-contract.ts";
import { uploadError } from "./uploads.ts";
export function registerUploadRemoteEndpoints(rpc: WireRpc): () => void {
  const disposers = [
    rpc.register("fileUploads/upload", async (payload, invocation) => {
      const endpoint = "fileUploads/upload";
      const args = argsOf(payload, endpoint);
      const request = requestOf(args, endpoint);
      if (typeof request.data !== "string" || (request.name !== undefined && typeof request.name !== "string")) throw new SessionRpcFault("gateway/bad-request", "Invalid file upload", { endpoint });
      return createHostCall(invocation)("uploadFile", { sessionId: sessionIdOf(args, endpoint), data: request.data, name: request.name });
    }),
    rpc.register("session/attachment", async (payload, invocation) => {
      const endpoint = "session/attachment";
      const request = requestOf(argsOf(payload, endpoint), endpoint);
      await createHostCall(invocation)("state", { sessionId: sessionIdOf(request, endpoint) });
      if (!isRecord(request.attachment)) throw new SessionRpcFault("gateway/bad-request", "Invalid image attachment", { endpoint });
      throw uploadError("No normalized image attachments are available on this deployment", "IMAGE_PROCESSOR_UNAVAILABLE");
    }),
  ];
  return () => { for (const dispose of disposers.reverse()) dispose(); };
}
