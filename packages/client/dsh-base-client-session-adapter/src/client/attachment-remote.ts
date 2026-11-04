/** Exact official upload/attachment namespace contracts over the Host RPC carrier. */
import type { ClientConnectionRpc } from "@deepseek-ai/dsh-client-connection/client";
import type { EncodedFileUploadRequest, FileUploadValue } from "@deepseek-ai/dsh-client-file-upload/types";
import type { ImageAttachmentRef } from "@deepseek-ai/dsh-attachment/types";

type Result<T> = { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly details?: unknown } };

export function createAttachmentRemotes(rpc: () => Pick<ClientConnectionRpc, "call">) {
  return {
    fileUploads: {
      upload: (sessionId: string, request: EncodedFileUploadRequest, signal?: AbortSignal) =>
        rpc().call("/api", "fileUploads/upload", { args: { sessionId, request } }, signal) as Promise<Result<FileUploadValue>>,
    },
    // The official Session client decodes this base64 string itself. Returning
    // Uint8Array here would corrupt its wire contract and historical previews.
    attachment: (request: { readonly sessionId: string; readonly attachment: ImageAttachmentRef }, signal?: AbortSignal) =>
      rpc().call("/api", "session/attachment", { args: { request } }, signal) as Promise<Result<{ readonly attachment: ImageAttachmentRef; readonly data: string }>>,
  };
}
