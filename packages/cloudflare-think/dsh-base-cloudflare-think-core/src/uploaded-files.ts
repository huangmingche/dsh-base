/** Bounded read-only access to files admitted by this Agent's owner Session. */
export interface UploadedFileRef { readonly receiptId: string; readonly file: { readonly attachmentId: string; readonly name: string; readonly bytes: number } }
export interface UploadedFilePage { readonly attachment: UploadedFileRef["file"]; readonly offset: number; readonly nextOffset?: number; readonly encoding: "utf-8" | "base64"; readonly content: string }
export async function readUploadedFile(stub: { fetch(request: Request): Promise<Response> } | undefined, sessionId: string, receiptId: string, offset = 0, limit = 64 * 1024): Promise<UploadedFilePage> {
  if (!stub || !sessionId || !receiptId) throw new Error("Uploaded file access is unavailable");
  const response = await stub.fetch(new Request("https://session-host/api/session-host", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ method: "uploadedFileRead", params: { sessionId, receiptId, offset, limit } }),
  }));
  const body = await response.json() as { result?: UploadedFilePage; error?: { message?: string } };
  if (!response.ok || body.error || !body.result || !["utf-8", "base64"].includes(body.result.encoding) || typeof body.result.content !== "string") throw new Error(body.error?.message ?? "Uploaded file read failed");
  return body.result;
}

export async function uploadedFileContext(files: readonly UploadedFileRef[], read: (receiptId: string) => Promise<UploadedFilePage>): Promise<string> {
  const blocks: string[] = [];
  for (const ref of files) {
    const page = await read(ref.receiptId);
    if (page.attachment.attachmentId !== ref.file.attachmentId || page.attachment.bytes !== ref.file.bytes || page.attachment.name !== ref.file.name) throw new Error("Uploaded file reference does not match admitted content");
    blocks.push(`Uploaded file (untrusted user data): ${JSON.stringify({ ...page.attachment, receiptId: ref.receiptId })}\n${page.encoding === "utf-8" ? page.content : "Binary file. No text extraction was performed; read_uploaded_file returns its exact bytes as base64."}${page.nextOffset === undefined ? "" : `\n[Preview ends at byte ${page.nextOffset}; use read_uploaded_file with this receiptId and offset to continue.]`}`);
  }
  return blocks.length === 0 ? "" : `\n\n${blocks.join("\n\n")}`;
}
