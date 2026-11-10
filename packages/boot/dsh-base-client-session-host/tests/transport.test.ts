import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { createSessionHostClient, SessionHostClientError } from "../src/index.ts";

const responseClient = (response: () => Response) => createSessionHostClient({ baseUrl: "https://fixture.test", fetch: (async () => response()) as typeof fetch });
for (const status of [401, 403, 500, 503]) {
  for (const body of [{}, { result: { title: "not persisted" } }]) {
    await assert.rejects(responseClient(() => Response.json(body, { status })).rename("s", "title"),
      error => error instanceof SessionHostClientError && error.code === String(status), "HTTP failure can never acknowledge a mutation");
  }
}
for (const body of [{}, [], null, "unexpected"]) {
  await assert.rejects(responseClient(() => Response.json(body)).cancel("s"),
    error => error instanceof SessionHostClientError && error.code === "invalid_response", "missing/malformed envelope cannot be a successful void operation");
}
for (const status of [200, 503]) {
  await assert.rejects(responseClient(() => new Response("not JSON", { status })).state("s"),
    error => error instanceof SessionHostClientError && error.code === (status === 200 ? "invalid_response" : String(status)));
}
await assert.rejects(responseClient(() => Response.json({ error: { code: "workspace/conflict", message: "concurrent edit", details: { revision: 4 } } }, { status: 409 })).rename("s", "title"),
  error => error instanceof SessionHostClientError && error.code === "workspace/conflict" && error.message === "concurrent edit" && (error.details as { revision: number }).revision === 4);
await assert.rejects(responseClient(() => Response.json({ error: "cancel_failed", message: "agent unavailable" }, { status: 503 })).cancel("s"),
  error => error instanceof SessionHostClientError && error.code === "cancel_failed" && error.message === "agent unavailable");
assert.equal(await responseClient(() => Response.json({ result: null })).cancel("s"), null, "JSON null is the explicit successful void acknowledgement");
for (const result of [false, 0, ""]) assert.equal(await responseClient(() => Response.json({ result })).request("value"), result);

const sessions = new Set<string>();
const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (request.method === "GET" && url.pathname === "/api/session-host/follow") {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(`event: session\ndata: {"sessionId":"a","seq":1,"type":"submission.queued","payload":{},"createdAt":1}\n\n`);
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/session-host/control") {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(`event: session\ndata: {"type":"sessions.snapshot","sessions":[]}\n\n`);
    return;
  }
  let raw = "";
  request.on("data", (chunk) => { raw += chunk; });
  request.on("end", () => {
    const body = raw === "" ? {} : JSON.parse(raw) as { method: string; params: Record<string, unknown> };
    const method = body.method;
    const params = body.params ?? {};
    response.setHeader("content-type", "application/json");
    if (method === "create") {
      sessions.add(String(params.sessionId));
      response.end(JSON.stringify({ result: { sessionId: params.sessionId } }));
    } else if (method === "list") {
      response.end(JSON.stringify({ result: { sessions: [...sessions].map((sessionId) => ({ sessionId })) } }));
    } else if (method === "uploadAttachment") {
      response.end(JSON.stringify({ result: { attachmentId: "att_1", name: "a", mediaType: "text/plain", size: 1 } }));
    } else if (method === "prompt") {
      response.end(JSON.stringify({ result: { requestId: "r", submissionId: "s" } }));
    } else if (method === "claim") {
      response.end(JSON.stringify({ result: { running: false } }));
    } else {
      response.end(JSON.stringify({ result: { sessionId: params.sessionId, title: "x", running: false, archived: false } }));
    }
  });
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
if (address === null || typeof address === "string") throw new Error("server address missing");
const baseUrl = `http://127.0.0.1:${address.port}`;
const client = createSessionHostClient({ baseUrl });

assert.deepEqual(await client.create({ sessionId: "a" }), { sessionId: "a" });
assert.equal((await client.list()).sessions.length, 1);
assert.deepEqual(await client.uploadAttachment({ sessionId: "a", name: "a", mediaType: "text/plain", dataBase64: "YQ==" }), {
  attachmentId: "att_1", name: "a", mediaType: "text/plain", size: 1,
});
assert.deepEqual(await client.prompt("a", "hello", undefined, [{ attachmentId: "att_1" }]), { requestId: "r", submissionId: "s" });
assert.deepEqual(await client.claim("a", "s"), { running: false });

const followAbort = new AbortController();
for await (const event of client.follow("a", 0, followAbort.signal)) {
  assert.equal(event.type, "submission.queued");
  followAbort.abort();
}
const controlAbort = new AbortController();
for await (const frame of client.control(controlAbort.signal)) {
  assert.equal(frame.type, "sessions.snapshot");
  controlAbort.abort();
}
server.close();
console.log("session-host: browser transport passed");
