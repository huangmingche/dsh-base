/** Fail closed at the model/tool boundary when the durable Host archived this Session. */
export async function assertSessionActive(stub: { fetch(request: Request): Promise<Response> }, sessionId: string): Promise<void> {
  const response = await stub.fetch(new Request("https://session-host/api/session-host", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ method: "state", params: { sessionId } }),
  }));
  const body = await response.json() as { result?: { archived?: unknown }; error?: unknown };
  if (!response.ok || body.error !== undefined || typeof body.result?.archived !== "boolean") throw new Error("Session activity gate unavailable");
  if (body.result.archived) throw new Error("Session is archived");
}
