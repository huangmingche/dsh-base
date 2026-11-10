import assert from "node:assert/strict";
import { PluginControl } from "../src/control.ts";
import { controlHandler } from "../src/index.ts";
import { GATEWAY_CLIENT_MODULE, GATEWAY_THINK_MODULE } from "../../../boot/dsh-base-plugin-management/src/index.ts";

class MemoryStorage {
  data = new Map<string, unknown>();
  writes = 0;
  failCommit = false;
  private pending = Promise.resolve();
  async get(key: string) { return this.data.get(key) as never }
  async put(key: string, value: unknown) { this.writes++; this.data.set(key, value) }
  transaction<T>(callback: (storage: MemoryStorage) => Promise<T>): Promise<T> {
    const result = this.pending.then(async () => {
      const draft = new MemoryStorage();
      draft.data = structuredClone(this.data);
      const value = await callback(draft);
      if (this.failCommit) throw new Error("fixture storage commit failure");
      this.data = draft.data;
      this.writes += draft.writes;
      return value;
    });
    this.pending = result.then(() => undefined, () => undefined);
    return result;
  }
}
const objects = new Map<string, PluginControl>();
const env = { PluginControl: { idFromName: (name: string) => name, get: (name: string) => {
  let object = objects.get(name);
  if (object === undefined) { object = new PluginControl({ storage: new MemoryStorage() } as never); objects.set(name, object) }
  return object;
} } };
let user = { id: "owner-a" };
const auth = { async session() { return user } };
const req = (method: string, path: string, body?: unknown) => new Request(`https://app.example.test${path}`, {
  method, headers: { "content-type": "application/json", origin: "https://app.example.test" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
// Authentication and owner isolation.
assert.equal((await controlHandler(req("GET", "/api/plugin-manager"), env, { async session() { return undefined } }))?.status, 401);
assert.equal((await controlHandler(req("GET", "/api/plugin-manager/inventory"), env, { async session() { return undefined } }))?.status, 401);
const emptyA = await controlHandler(req("GET", "/api/plugin-manager"), env, auth);
assert.equal(emptyA?.status, 200);
assert.deepEqual(await emptyA?.json(), { revision: 0, overrides: {}, ownerId: "owner-a" });
const allowed = await controlHandler(req("PUT", "/api/plugin-manager", { name: "@dsh-base/cloudflare-think-fetch", disabled: true, expectedRevision: 0 }), env, auth);
assert.equal(allowed?.status, 200);
assert.deepEqual((await allowed?.json() as { overrides: Record<string, unknown> }).overrides, { "@dsh-base/cloudflare-think-fetch": { disabled: true } });
user = { id: "owner-b" };
const emptyB = await controlHandler(req("GET", "/api/plugin-manager"), env, auth);
assert.deepEqual(await emptyB?.json(), { revision: 0, overrides: {}, ownerId: "owner-b" }, "another owner cannot see or inherit the first owner's selection");
user = { id: "owner-a" };
const persisted = await controlHandler(req("GET", "/api/plugin-manager"), env, auth);
assert.deepEqual((await persisted?.json() as { overrides: Record<string, unknown> }).overrides, { "@dsh-base/cloudflare-think-fetch": { disabled: true } });
// Allowlist, validation, concurrency and origin all fail closed without mutating state.
assert.equal((await controlHandler(req("PUT", "/api/plugin-manager", { name: "@dsh-base/client-deepseek-provider", disabled: true }), env, auth))?.status, 403);
assert.equal((await controlHandler(req("PUT", "/api/plugin-manager", { name: "@dsh-base/cloudflare-think-fetch", disabled: "yes" }), env, auth))?.status, 400);
assert.equal((await controlHandler(req("PUT", "/api/plugin-manager", { name: "@dsh-base/cloudflare-think-fetch", disabled: false, expectedRevision: 0 }), env, auth))?.status, 409);
const stale = await controlHandler(req("PATCH", "/api/plugin-manager", { name: "@dsh-base/cloudflare-think-fetch", expectedRevision: 99 }), env, auth);
assert.equal(stale?.status, 409);
assert.equal((await controlHandler(new Request("https://app.example.test/api/plugin-manager", { method: "GET", headers: { origin: "https://evil.example.test" } }), env, auth))?.status, 403);
// Inventory endpoint returns the actual Worker loader rows supplied by its caller.
const inventory = await controlHandler(req("GET", "/api/plugin-manager/inventory"), env, auth, () => [
  { entryId: "cloudflare:worker:http", moduleName: "@dsh-base/cloudflare-worker-http", origin: "custom", enabled: true, fiberPhase: "active" } as never,
]);
assert.deepEqual((await inventory?.json() as { entries: unknown[] }).entries.length, 1);
assert.equal((await controlHandler(req("PUT", "/api/plugin-manager", { name: "@dsh-base/cloudflare-think-fetch", config: { apiKey: "fixture-only-secret", module: "https://example.invalid/module.js", expression: "fixture_expression" } }), env, auth))?.status, 400);
let deep: Record<string, unknown> = { allowed: true }; for (let index = 0; index < 20; index += 1) deep = { nested: deep };
assert.equal((await controlHandler(req("PUT", "/api/plugin-manager", { name: "@dsh-base/cloudflare-think-fetch", config: deep }), env, auth))?.status, 400);
const unchanged = await controlHandler(req("GET", "/api/plugin-manager"), env, auth);
const unchangedBody = await unchanged?.json() as { revision: number; overrides: Record<string, unknown> };
assert.equal(unchangedBody.revision, 1, "refusals do not write"); assert.deepEqual(unchangedBody.overrides, { "@dsh-base/cloudflare-think-fetch": { disabled: true } }, "refused config never replaces the existing record");
// Fetch configuration is checked against the DO's deployment policy before any
// owner/session override or revision is persisted.
const policyStore = new MemoryStorage();
const policyControl = new PluginControl({ storage: policyStore } as never, { FETCH_ALLOWLIST: "https://developers.cloudflare.com/docs/**" });
const savedConfig = { allowlist: ["https://developers.cloudflare.com/docs/guide/**"] };
assert.equal((await policyControl.fetch(req("PUT", "/api/plugin-manager", { name: "@dsh-base/cloudflare-think-fetch", config: savedConfig }))).status, 200);
const snapshot = JSON.stringify(await policyStore.get("control"));
for (const allowlist of [
  ["https://developers.cloudflare.com.attacker.example/docs/**"],
  ["https://developers.cloudflare.com:444/docs/**"],
  ["https://developers.cloudflare.com/docs-other/**"],
  ["https://developers.cloudflare.com/docs/%2e%2e/private/**"],
  ["https://developers.cloudflare.com@attacker.example/docs/**"],
  ["https://developers.cloudflare.com/docs/**?ignored=true"],
  ["https://developers.cloudflare.com/docs/guide/**", "https://attacker.example/**"],
]) for (const scope of [{}, { sessionId: "session-a" }]) {
  const rejected = await policyControl.fetch(req("PUT", "/api/plugin-manager", { name: "@dsh-base/cloudflare-think-fetch", config: { allowlist }, ...scope }));
  assert.equal(rejected.status, 400, allowlist.join(","));
  assert.equal(JSON.stringify(await policyStore.get("control")), snapshot, "rejected owner/session policy preserves both overrides and revision");
}
assert.equal((await policyControl.fetch(req("PUT", "/api/plugin-manager", { name: "@dsh-base/cloudflare-think-fetch", config: { allowlist: [] } }))).status, 200, "explicit empty policy still inherits deployment restrictions");
// Session patches preserve existing local fields without snapshotting inherited
// owner fields. Later owner changes therefore keep flowing to unset fields.
const fetchName = "@dsh-base/cloudflare-think-fetch";
const writePolicy = async (body: Record<string, unknown>) => {
  const result = await policyControl.fetch(req("PATCH", "/api/plugin-manager", { name: fetchName, ...body }));
  assert.equal(result.status, 200);
  return result.json() as Promise<{ overrides: Record<string, { disabled?: boolean; config?: unknown }>; sessions: Record<string, Record<string, { disabled?: boolean; config?: unknown }>> }>;
};
await writePolicy({ disabled: true, config: savedConfig });
let patched = await writePolicy({ sessionId: "config-only", config: { allowlist: [] } });
assert.deepEqual(patched.sessions["config-only"][fetchName], { config: { allowlist: [] } }, "a config patch must not freeze the owner disabled flag");
patched = await writePolicy({ disabled: false });
assert.equal(({ ...patched.overrides[fetchName], ...patched.sessions["config-only"][fetchName] }).disabled, false, "later owner enablement is inherited");
patched = await writePolicy({ sessionId: "config-only", disabled: true });
assert.deepEqual(patched.sessions["config-only"][fetchName], { config: { allowlist: [] }, disabled: true }, "a toggle preserves the Session config");
patched = await writePolicy({ sessionId: "config-only", config: savedConfig });
assert.deepEqual(patched.sessions["config-only"][fetchName], { config: savedConfig, disabled: true }, "a config patch preserves the Session disabled flag");
patched = await writePolicy({ sessionId: "toggle-only", disabled: true });
assert.deepEqual(patched.sessions["toggle-only"][fetchName], { disabled: true }, "a toggle must not freeze the owner config");
patched = await writePolicy({ config: { allowlist: [] } });
assert.deepEqual(({ ...patched.overrides[fetchName], ...patched.sessions["toggle-only"][fetchName] }).config, { allowlist: [] });
const rebuiltControl = new PluginControl({ storage: policyStore } as never, { FETCH_ALLOWLIST: "https://developers.cloudflare.com/docs/**" });
const reloaded = await (await rebuiltControl.fetch(req("GET", "/api/plugin-manager?sessionId=config-only"))).json() as { session: Record<string, unknown> };
assert.deepEqual(reloaded.session[fetchName], { config: savedConfig, disabled: true }, "Session fields survive control DO reconstruction");
console.log("plugin control owner management: auth, owner isolation, persistent selection, allowlist, validation, concurrency, origin and real Worker inventory passed");
console.log("plugin control Session patches: preserve local fields and inherit changing owner defaults without copying them");

// The existing client package is the public bundle identity. Older callers may
// still send either member: owner toggles/reset always commit the pair together.
const gatewayStore = new MemoryStorage();
const gatewayControl = new PluginControl({ storage: gatewayStore } as never);
const gatewayRequest = (body: Record<string, unknown>) => req("PATCH", "/api/plugin-manager", body);
const readGateway = async (path = "/api/plugin-manager") => (await gatewayControl.fetch(req("GET", path))).json() as Promise<{ revision: number; overrides: Record<string, { disabled?: boolean; config?: unknown }>; sessions?: Record<string, Record<string, unknown>>; session?: Record<string, unknown> }>;
for (const [client, think, expected] of [[true, false, false], [false, true, true], [true, undefined, false], [undefined, true, true]] as const) {
  const original = {
    revision: 7,
    overrides: {
      ...(client === undefined ? {} : { [GATEWAY_CLIENT_MODULE]: { disabled: client, config: {} } }),
      ...(think === undefined ? {} : { [GATEWAY_THINK_MODULE]: { disabled: think } }),
      [fetchName]: { disabled: true },
    },
    sessions: { isolated: { [GATEWAY_THINK_MODULE]: { disabled: !expected } } },
  };
  await gatewayStore.put("control", original);
  const read = await readGateway("/api/plugin-manager?sessionId=isolated");
  assert.equal(read.overrides[GATEWAY_CLIENT_MODULE].disabled, expected, "legacy card state follows the actual provider decision");
  assert.equal(read.overrides[GATEWAY_THINK_MODULE].disabled, expected, "migration never flips the actual model service");
  assert.deepEqual(read.session, original.sessions.isolated, "Session overrides are not coupled to a global UI component");
  assert.deepEqual(await gatewayStore.get("control"), original, "read projection neither writes nor advances revision");
  assert.deepEqual(await readGateway("/api/plugin-control"), original, "deployment administration keeps independent module semantics");
}
await gatewayStore.put("control", { revision: 0, overrides: {}, sessions: { preserved: { [GATEWAY_THINK_MODULE]: { disabled: false } } } });
const writesBeforeToggle = gatewayStore.writes;
const disabledGateway = await gatewayControl.fetch(gatewayRequest({ name: GATEWAY_CLIENT_MODULE, disabled: true, expectedRevision: 0 }));
assert.equal(disabledGateway.status, 200);
let gateway = await readGateway();
assert.equal(gateway.revision, 1);
assert.equal(gatewayStore.writes, writesBeforeToggle + 1, "a bundle commits one storage write");
assert.deepEqual(gateway.overrides, { [GATEWAY_CLIENT_MODULE]: { disabled: true }, [GATEWAY_THINK_MODULE]: { disabled: true } });
assert.deepEqual(gateway.sessions?.preserved, { [GATEWAY_THINK_MODULE]: { disabled: false } });
const concurrent = await Promise.all([
  gatewayControl.fetch(gatewayRequest({ name: GATEWAY_CLIENT_MODULE, disabled: false, expectedRevision: 1 })),
  gatewayControl.fetch(gatewayRequest({ name: GATEWAY_THINK_MODULE, disabled: true, expectedRevision: 1 })),
]);
assert.deepEqual(concurrent.map(response => response.status).sort(), [200, 409], "only one concurrent compare-and-set may commit");
gateway = await readGateway();
assert.equal(gateway.revision, 2);
assert.equal(gateway.overrides[GATEWAY_CLIENT_MODULE].disabled, gateway.overrides[GATEWAY_THINK_MODULE].disabled);
const beforeFailure = structuredClone(await gatewayStore.get("control"));
gatewayStore.failCommit = true;
await assert.rejects(gatewayControl.fetch(gatewayRequest({ name: GATEWAY_THINK_MODULE, disabled: true, expectedRevision: 2 })), /commit failure/);
gatewayStore.failCommit = false;
assert.deepEqual(await gatewayStore.get("control"), beforeFailure, "failed commit cannot leave one member toggled");
assert.equal((await gatewayControl.fetch(gatewayRequest({ name: GATEWAY_THINK_MODULE, reset: true, expectedRevision: 2 }))).status, 200);
gateway = await readGateway();
assert.equal(gateway.revision, 3);
assert.deepEqual(gateway.overrides, {}, "reset through a legacy member alias resets the complete owner bundle");
assert.deepEqual(gateway.sessions?.preserved, { [GATEWAY_THINK_MODULE]: { disabled: false } });
assert.equal((await gatewayControl.fetch(gatewayRequest({ name: GATEWAY_THINK_MODULE, sessionId: "isolated", disabled: true, expectedRevision: 3 }))).status, 200);
gateway = await readGateway();
assert.deepEqual(gateway.overrides, {}, "Session writes do not change the account bundle");
assert.deepEqual(gateway.sessions?.isolated, { [GATEWAY_THINK_MODULE]: { disabled: true } }, "Session writes do not fabricate a client runtime entry");
assert.equal((await gatewayControl.fetch(gatewayRequest({ name: GATEWAY_THINK_MODULE, disabled: true, expectedRevision: 4 }))).status, 200);
gateway = await readGateway();
assert.deepEqual(gateway.overrides, { [GATEWAY_CLIENT_MODULE]: { disabled: true }, [GATEWAY_THINK_MODULE]: { disabled: true } }, "the legacy Think toggle also targets the complete owner bundle");
assert.equal((await gatewayControl.fetch(req("PATCH", "/api/plugin-control", { name: GATEWAY_CLIENT_MODULE, disabled: false, expectedRevision: 5 }))).status, 200);
assert.deepEqual((await readGateway("/api/plugin-control")).overrides, { [GATEWAY_CLIENT_MODULE]: { disabled: false }, [GATEWAY_THINK_MODULE]: { disabled: true } }, "administrator controls retain per-module deployment selection");
console.log("Gateway bundle control: Think-authoritative legacy reads, atomic member aliases/reset, concurrent CAS, storage rollback, deployment and Session isolation passed");
