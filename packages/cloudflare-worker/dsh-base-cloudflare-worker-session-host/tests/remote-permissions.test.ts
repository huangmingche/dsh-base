/** Authenticated owner catalog bridge, strict Host dispatch and real preset catalog. */
import assert from 'node:assert/strict';
import { registerPermissionPresetEndpoints } from '../src/remote-permissions.ts';
import { dispatchSessionHost } from '../src/service.ts';
import { createPermissionRuntime } from '@dsh-base/cloudflare-worker-permissions/runtime';

const runtime = await createPermissionRuntime();
const handlers = new Map<string, (payload: unknown, invocation: unknown) => Promise<unknown>>();
const defaults = new Map([['alice', 'read-only'], ['bob', 'workspace-write']]);
const names: string[] = [];
let failure: string | undefined;
const rpc = { register(method: string, handler: (payload: unknown, invocation: unknown) => Promise<unknown>) { handlers.set(method, handler); return () => handlers.delete(method); } };
const dispose = registerPermissionPresetEndpoints(rpc as never);
const context = (owner: string) => ({ request: new Request('https://host/api/wire'), user: { id: owner }, rpcId: "wire-command-retry", env: { SESSION_HOST: {
  idFromName(name: string) { names.push(name); return name; },
  get(name: string) {
    assert.equal(name, `owner:${owner}:default-v49`);
    return { async fetch(request: Request) {
      if (new URL(request.url).pathname.endsWith('/migrate/status')) return Response.json({ migrated: true });
      const body = await request.json() as { method: string; params?: { sessionId?: string; line?: string; rpcId?: string } };
      if (body.method === 'permissionCommands') { assert.equal(body.params?.sessionId, 's'); return Response.json({ result: runtime.commands() }); }
      if (body.method === 'executePermissionCommand') {
        assert.equal(body.params?.rpcId, 'wire-command-retry');
        return Response.json({ result: { commandId: 'cmd-from-host', result: body.params?.line === '/permission invalid' ? { kind: 'error', text: 'unknown preset "invalid"' } : { kind: 'success', text: 'preset read-only' } } });
      }
      assert.equal(body.method, 'permissionCatalog');
      return Response.json(failure ? { error: { code: failure, message: 'catalog unavailable' } } : { result: runtime.catalog(defaults.get(owner)) });
    } };
  },
} } });
try {
  assert.deepEqual([...handlers.keys()], ['permissionPresets/catalog', 'commands/list', 'commands/execute']);
  const call = (owner: string) => handlers.get('permissionPresets/catalog')!({ args: {} }, context(owner)) as Promise<ReturnType<typeof runtime.catalog>>;
  const first = await call('alice');
  assert.equal(first.defaultPreset, 'read-only');
  assert.deepEqual(first.options.map(option => option.value), ['read-only', 'workspace-write', 'danger-full-access']);
  assert.equal((await call('bob')).defaultPreset, 'workspace-write');
  defaults.set('alice', 'danger-full-access');
  assert.equal((await call('alice')).defaultPreset, 'danger-full-access', 'catalog reads current owner settings on every invocation');
  assert.equal((await call('bob')).defaultPreset, 'workspace-write', 'another owner remains independent');
  assert.ok(names.includes('owner:alice:default-v49') && names.includes('owner:bob:default-v49'));
  failure = 'gateway/endpoint-unavailable';
  await assert.rejects(call('alice'), (error: { code?: string }) => error.code === failure);
  const descriptor = await handlers.get('commands/list')!({ args: { sessionId: 's' } }, context('alice')) as { definitionId: string }[];
  assert.equal(descriptor[0].definitionId, '@deepseek-ai/dsh-permission-presets');
  const execute = (line: string, attachments: unknown = []) => handlers.get('commands/execute')!({ args: { sessionId: 's', line, attachments } }, context('alice'));
  assert.deepEqual(await execute('/permission read-only'), { commandId: 'cmd-from-host', result: { kind: 'success', text: 'preset read-only' } });
  await assert.rejects(execute('/permission invalid'), (error: { code?: string; details?: {commandId?: string} }) => error.code === 'command/failed' && error.details?.commandId === 'cmd-from-host');
  await assert.rejects(execute('/permission read-only', null), (error: {code?:string}) => error.code === 'gateway/bad-request');

  const calls: unknown[] = [];
  const host = {
    permissionCatalog() { return runtime.catalog('read-only'); },
    permissionSnapshot(input: unknown) { calls.push(input); return { currentValue: 'read-only', sandbox: 'read-only', approval: 'ask' }; },
    selectPermission(input: unknown) { calls.push(input); return { currentValue: 'workspace-write', sandbox: 'workspace-write', approval: 'ask' }; },
  };
  const catalog = await dispatchSessionHost(host as never, { id: 'read', method: 'permissionCatalog' });
  assert.equal(catalog.id, 'read'); assert.ok('result' in catalog);
  const selected = await dispatchSessionHost(host as never, { id: 'select', method: 'selectPermission', params: { sessionId: 's', preset: 'workspace-write' } });
  assert.equal(selected.id, 'select'); assert.ok('result' in selected);
  assert.deepEqual(calls, [{ sessionId: 's', preset: 'workspace-write' }]);
  for (const params of [{}, { sessionId: 's' }, { sessionId: '', preset: 'workspace-write' }, { sessionId: 's', preset: 7 }]) {
    const result = await dispatchSessionHost(host as never, { method: 'selectPermission', params });
    assert.ok('error' in result && result.error.code === 'gateway/bad-request');
  }
  assert.equal(calls.length, 1, 'invalid request never mutates policy');
} finally { dispose(); await runtime.dispose(); }
assert.equal(handlers.size, 0);
console.log('session-host: real owner permission catalog, fresh settings, failure propagation and strict policy dispatch passed');
