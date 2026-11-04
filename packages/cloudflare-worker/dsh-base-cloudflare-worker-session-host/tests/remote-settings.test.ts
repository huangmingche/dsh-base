/** Official settings Remote bridge contract. */
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@dsh-base/session-wire") {
      return { url: new URL("../../../boot/dsh-base-session-wire/src/index.ts", import.meta.url).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { registerSettingsRemoteEndpoints, settingsViewsFromSnapshot, rejectUnsupportedSettingsWrite } = await import("../src/remote-settings.ts");
const describe = settingsViewsFromSnapshot({ revision: 4, values: { permission: { defaultPreset: "read-only" } } });
assert.equal(describe.writable, true);
assert.equal(describe.hasDocument, false);
const permission = describe.namespaces.find((view) => view.ns === "permission");
assert.equal(permission?.revision, 4);
assert.equal(permission?.value.defaultPreset, "read-only");
assert.equal(permission?.user.defaultPreset, "read-only");
assert.equal(permission?.base.defaultPreset, "workspace-write");
const general = describe.namespaces.find((view) => view.ns === "ui-settings-general");
assert.equal(general?.value.welcomeNoticeVersion, undefined);
assert.equal(describe.namespaces.find((view) => view.ns === "ui-settings")?.value.enabled, true);
assert.equal(describe.namespaces.find((view) => view.ns === "ui-theme")?.value.preference, "system");
assert.deepEqual(describe.namespaces.find((view) => view.ns === "locale")?.value, {});
const deepseek = describe.namespaces.find((view) => view.ns === "llm-deepseek");
assert.equal(deepseek?.schema.type, "object");
assert.equal(deepseek?.value.baseURL, "https://api.deepseek.com/v1");

// Original DeepSeek saved values remain visible/durable; the fork only
// disables the unsupported endpoint/catalog controls and the Host rejects writes.
{
  const historical = { baseURL: "https://api.deepseek.com/anthropic", models: [{ id: "legacy-model" }], apiKeyEnv: "LEGACY_KEY", futureFlag: true };
  const viewed = settingsViewsFromSnapshot({ revision: 7, values: { "llm-deepseek": historical } }).namespaces.find((view) => view.ns === "llm-deepseek");
  assert.equal(viewed?.value.baseURL, "https://api.deepseek.com/anthropic");
  assert.deepEqual(viewed?.value.models, [{ id: "legacy-model" }]);
  assert.equal(viewed?.user.apiKeyEnv, "LEGACY_KEY");
  assert.equal(viewed?.user.futureFlag, true);
  assert.deepEqual(historical, { baseURL: "https://api.deepseek.com/anthropic", models: [{ id: "legacy-model" }], apiKeyEnv: "LEGACY_KEY", futureFlag: true });
}

// The form's allowed defaults come from the actual mounted official preset
// catalog, so enabling/removing a configured preset cannot leave a stale enum.
{
  const { createPermissionRuntime } = await import('@dsh-base/cloudflare-worker-permissions/runtime');
  const runtime = await createPermissionRuntime();
  try {
    const schema = permission?.schema.dict?.defaultPreset as { type: string; list: Array<{ type: string; value: string }>; meta: { default: string } };
    const catalog = runtime.catalog();
    assert.equal(schema.type, 'union');
    assert.deepEqual(schema.list, catalog.defaultOptions.map(option => ({ type: 'const', value: option.value })));
    assert.equal(schema.meta.default, catalog.defaultPreset);
    for (const option of catalog.defaultOptions) assert.equal(runtime.catalog(option.value).defaultPreset, option.value);
  } finally { await runtime.dispose(); }
}

assert.doesNotThrow(() => rejectUnsupportedSettingsWrite("settings/update", "llm-deepseek", [["baseURL"]]));
assert.doesNotThrow(() => rejectUnsupportedSettingsWrite("settings/mutate", "llm-deepseek", [["models"]]));
assert.throws(() => rejectUnsupportedSettingsWrite("settings/update", "llm-cloudflare-gateway", [["baseURL"]]), /operator-managed/);
assert.doesNotThrow(() => rejectUnsupportedSettingsWrite("settings/update", "permission", [["defaultPreset"]]));
const registered: string[] = [];
const wireRpc = {
  register(method: string, _handler: unknown) { registered.push(method); return () => undefined; },
};
const dispose = registerSettingsRemoteEndpoints(wireRpc as never);
assert.deepEqual([...registered].sort(), [
  "settings/describe",
  "settings/mutate",
  "settings/openSettingsDocument",
  "settings/replace",
  "settings/update",
]);
dispose();
console.log("session-host: official settings Remote bridge passed");

// Public update/replace calls use the durable Host, including empty-object
// merges and revision conflicts, rather than a browser-only settings cache.
{
  const { DatabaseSync } = await import("node:sqlite");
  const { SettingsStore } = await import("../src/settings-store.ts");
  const { SessionHost } = await import("../src/host.ts");
  const { SqliteSessionHostStorage } = await import("../src/sqlite-storage.ts");
  const { dispatchSessionHost } = await import("../src/service.ts");
  const { HostChangeFeed, observeHostWrites } = await import('../src/change-feed.ts');
  const db = new DatabaseSync(":memory:");
  const raw = { exec(query: string, ...bindings: unknown[]) {
    const rows = db.prepare(query).all(...bindings as never[]) as Record<string, unknown>[];
    return { toArray: () => rows };
  } };
  const feed = new HostChangeFeed();
  const sql = observeHostWrites(raw, feed);
  const settings = new SettingsStore(sql);
  const host = new SessionHost(new SqliteSessionHostStorage(sql), [], undefined, settings);
  const handlers = new Map<string, (payload: unknown, invocation: unknown) => Promise<any>>();
  registerSettingsRemoteEndpoints({ register(method: string, handler: any) { handlers.set(method, handler); return () => undefined; } } as never);
  const invocation = { request: new Request('https://test.invalid/api/settings/update'), user: { id: "user" }, env: { SESSION_HOST: { idFromName: (name: string) => name, get: () => ({ async fetch(request: Request) {
    if (new URL(request.url).pathname.endsWith("/migrate/status")) return Response.json({ migrated: true });
    return Response.json(await dispatchSessionHost(host, await request.json() as never));
  } }) } } };
  const update = handlers.get("settings/update")!;
  const initial = await update({ args: { ns: "nested", patch: { view: { left: 1, right: 2 } } } }, invocation);
  const next = await update({ args: { ns: "nested", patch: { view: { left: 3 } }, expectedRevision: initial.revision } }, invocation);
  assert.deepEqual(next.value, { view: { left: 3, right: 2 } });
  const unchanged = await update({ args: { ns: "nested", patch: { view: {} } } }, invocation);
  assert.deepEqual(unchanged.value, next.value);
  await assert.rejects(update({ args: { ns: "nested", patch: {}, expectedRevision: initial.revision } }, invocation), (error: any) => error.code === "settings/conflict");
  await assert.rejects(update({ args: { ns: "nested", patch: [] } }, invocation), (error: any) => error.code === "gateway/bad-request");
  const replacement = await handlers.get("settings/replace")!({ args: { ns: "nested", section: { view: { only: true } } } }, invocation);
  assert.deepEqual(replacement.value, { view: { only: true } });
  console.log("session-host: public settings deep merge, replacement and conflicts passed");

  const original = settings.read();
  const abort = new AbortController();
  const iterator = feed.subscribe(abort.signal)[Symbol.asyncIterator]();
  const baseline = (await iterator.next()).value!.revision;
  let delivered = false;
  const pending = iterator.next().then(value => { delivered = true; return value; });
  for (const value of ['not-a-preset', 'auto', 'custom', '', null, 0, {}, []]) {
    for (const [method, payload] of [
      ['settings/mutate', { ns: 'permission', ops: [{ op: 'set', path: ['defaultPreset'], value }] }],
      ['settings/update', { ns: 'permission', patch: { defaultPreset: value } }],
      ['settings/replace', { ns: 'permission', section: { defaultPreset: value } }],
    ] as const) {
      await assert.rejects(handlers.get(method)!({ args: payload }, invocation),
        (error: unknown) => error instanceof Error && 'code' in error && error.code === 'gateway/bad-request');
      assert.deepEqual(settings.read(), original, `${method} preserves all namespaces and revision on rejection`);
    }
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(delivered, false, 'Remote validation failures must not broadcast owner settings changes');
  const accepted = await handlers.get('settings/mutate')!({ args: { ns: 'permission', ops: [
    { op: 'set', path: ['defaultPreset'], value: 'not-a-preset' },
    { op: 'set', path: ['defaultPreset'], value: 'read-only' },
  ] } }, invocation);
  assert.equal(accepted.revision, original.revision + 1);
  assert.equal(accepted.value.defaultPreset, 'read-only');
  assert.deepEqual((await pending).value, { type: 'invalidate', revision: baseline + 1, topics: ['settings'] });
  const reset = await handlers.get('settings/replace')!({ args: { ns: 'permission', section: {} } }, invocation);
  assert.equal(reset.value.defaultPreset, 'workspace-write');
  assert.deepEqual(reset.user, {});
  assert.deepEqual(settings.read().values.nested, original.values.nested, 'permission resets preserve unrelated namespaces');
  abort.abort();
  await iterator.return?.();
  db.close();
  console.log('session-host: actual permission catalog and three Remote mutation paths reject invalid defaults without writes or notifications');
}
