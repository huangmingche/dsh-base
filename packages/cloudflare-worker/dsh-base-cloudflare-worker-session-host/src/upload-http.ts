/** Host-only face of the official upload route, unchanged at the pinned release. */
import { handleFileUploadHttp } from "@deepseek-ai/dsh-client-file-upload/src/http-route.ts";
import type { SessionHost } from "./host.ts";
import { uploadError } from "./uploads.ts";

export function handleUploadHttp(host: SessionHost, request: Request): Promise<Response> {
  // The handler reads only these two Host methods; Cordis service identity stays
  // outside this Workers transport seam.
  const service = {
    uploadStream: (input: Parameters<SessionHost["uploadFileStream"]>[0]) => host.uploadFileStream(input),
    uploadImageStream: async () => { throw uploadError("This deployment has no image normalization processor", "IMAGE_PROCESSOR_UNAVAILABLE"); },
  };
  return handleFileUploadHttp(service as unknown as Parameters<typeof handleFileUploadHttp>[0], request);
}
