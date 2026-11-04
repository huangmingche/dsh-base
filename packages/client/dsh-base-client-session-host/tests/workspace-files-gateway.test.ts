/** Official workspace-files client gateway contract. */
import assert from "node:assert/strict";
import {
  createOfficialWorkspaceFilesGateway,
  WORKSPACE_FILES_ENDPOINTS,
} from "../src/workspace-files-gateway.ts";

const seen: Array<{ endpoint: string; payload: unknown }> = [];
const gateway = createOfficialWorkspaceFilesGateway({
  baseUrl: "http://invalid.local",
  fetch: (async (input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { rpcId: string; payload: unknown };
    const endpoint = String(input).split("/api/")[1] ?? "";
    seen.push({ endpoint, payload: body.payload });
    const value = endpoint.endsWith("/stat")
      ? { absolutePath: "/Conversation.md", version: "v1", bytes: 2 }
      : endpoint.endsWith("/read")
        ? { absolutePath: "/Conversation.md", version: "v1", bytes: 2, offset: 1, text: "hi", lines: 1, eof: true }
        : endpoint.endsWith("/readBytes")
          ? { absolutePath: "/Conversation.md", version: "v1", bytes: 2, offset: 0, dataBase64: "aGk=", eof: true }
          : { path: "", entries: [{ name: "Conversation.md", type: "file", size: 2 }], truncated: false };
    return new Response(JSON.stringify({
      type: "server-response",
      rpcId: body.rpcId,
      result: { ok: true, value },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch,
});

assert.deepEqual(await gateway.list("s1", ""), {
  ok: true,
  value: { path: "", entries: [{ name: "Conversation.md", type: "file", size: 2 }], truncated: false },
});
assert.deepEqual(await gateway.stat("s1", "Conversation.md"), {
  ok: true,
  value: { absolutePath: "/Conversation.md", version: "v1", bytes: 2 },
});
assert.deepEqual(await gateway.read("s1", "Conversation.md", { offset: 1, limit: 10 }), {
  ok: true,
  value: { absolutePath: "/Conversation.md", version: "v1", bytes: 2, offset: 1, text: "hi", lines: 1, eof: true },
});
const bytes = await gateway.readBytes("s1", "Conversation.md");
assert.equal(bytes.ok, true);
if (bytes.ok) assert.deepEqual([...bytes.value.data], [104, 105]);
assert.deepEqual(seen.map((entry) => entry.endpoint), [
  WORKSPACE_FILES_ENDPOINTS.list,
  WORKSPACE_FILES_ENDPOINTS.stat,
  WORKSPACE_FILES_ENDPOINTS.read,
  WORKSPACE_FILES_ENDPOINTS.readBytes,
]);
assert.deepEqual(seen[0]?.payload, { args: { workspaceFileScope: "s1", path: "" } });
assert.deepEqual(seen[2]?.payload, { args: { workspaceFileScope: "s1", path: "Conversation.md", range: { offset: 1, limit: 10 } } });
assert.deepEqual(seen[3]?.payload, { args: { workspaceFileScope: "s1", path: "Conversation.md", options: {} } });

const connectionCalls: Array<{ channel: string; endpoint: string; payload: unknown }> = [];
const connected = createOfficialWorkspaceFilesGateway({
  baseUrl: "http://invalid.local",
  connection: () => ({
    rpc: {
      call: async (channel: string, endpoint: string, payload: unknown) => {
        connectionCalls.push({ channel, endpoint, payload });
        return { ok: true, value: { path: "", entries: [], truncated: false } };
      },
    },
  }) as never,
});
await connected.list("s1", "");
assert.deepEqual(connectionCalls, [{
  channel: "/api",
  endpoint: WORKSPACE_FILES_ENDPOINTS.list,
  payload: { args: { workspaceFileScope: "s1", path: "" } },
}]);
console.log("session-host: official workspace files gateway passed");
