/** Official permission catalog gateway contract. */
import assert from "node:assert/strict";
import { createOfficialPermissionGateway, PERMISSION_REMOTE_ENDPOINT } from "../src/permission-gateway.ts";

const catalog = {
  options: [{ value: "read-only", name: "read-only" }],
  defaultOptions: [{ value: "read-only", name: "read-only" }],
  defaultPreset: "read-only",
};
const seen: Array<{ endpoint: string; payload: unknown }> = [];
const gateway = createOfficialPermissionGateway({
  baseUrl: "http://invalid.local",
  fetch: (async (input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { rpcId: string; payload: unknown };
    const endpoint = String(input).split("/api/")[1] ?? "";
    seen.push({ endpoint, payload: body.payload });
    return new Response(JSON.stringify({
      type: "server-response",
      rpcId: body.rpcId,
      result: { ok: true, value: catalog },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch,
});
assert.deepEqual(await gateway.catalog(), { ok: true, value: catalog });
assert.equal(seen[0]?.endpoint, PERMISSION_REMOTE_ENDPOINT);
assert.deepEqual(seen[0]?.payload, { args: {} });

const connectionCalls: Array<{ channel: string; endpoint: string; payload: unknown }> = [];
const connected = createOfficialPermissionGateway({
  baseUrl: "http://invalid.local",
  connection: () => ({
    rpc: {
      call: async (channel: string, endpoint: string, payload: unknown) => {
        connectionCalls.push({ channel, endpoint, payload });
        return { ok: true, value: catalog };
      },
    },
  }) as never,
});
assert.deepEqual(await connected.catalog(), { ok: true, value: catalog });
assert.deepEqual(connectionCalls, [{ channel: "/api", endpoint: PERMISSION_REMOTE_ENDPOINT, payload: { args: {} } }]);
console.log("session-host: official permission gateway passed");
