import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createAgentHandler } from '../src/route.ts';

// Exercise the installed, lockfile-pinned SDK router itself without starting a
// Worker or reaching a real Durable Object. Its routing leaf has no Workers globals.
const require = createRequire(new URL('../../../build/dsh-base-build-server-dependencies/package.json', import.meta.url));
const { routeAgentRequest } = await import(new URL('./agent-routing.js', pathToFileURL(require.resolve('agents'))));
const accesses = [];
const binding = label => ({
  idFromName(name) { accesses.push([label, 'id', name]); return name; },
  get(id) { accesses.push([label, 'get', id]); return { fetch: async request => {
    accesses.push([label, 'fetch', id, request.headers.get('upgrade')]);
    return new Response(label, { status: 200 });
  } }; },
});
const env = { DshAgent: binding('agent'), SESSION_HOST: binding('host'), AuthStore: binding('auth'), DshSubagent: binding('subagent') };
const rejected = [
  '/agents/dsh-agent/owner:B:session',
  '/agents/dsh-agent//owner:B:session',
  '/agents//dsh-agent/owner:B:session',
  '/agents/dsh-agent///owner:B:session',
  '/agents/dsh-agent/%2fowner:B:session',
  '/agents/dsh-agent/owner:A:session%2f..%2fowner:B:session',
  '/agents/dsh-agent/owner:A:session%5cowner:B:session',
  '/agents/dsh-agent/owner:A:session%252fowner:B:session',
  '/agents/dsh-agent/owner%3aB%3asession',
  '/agents/dsh-agent', '/agents/dsh-agent/', '/agents/dsh-agent//', '/agents', '/agents/',
  '/agents/dsh-agent/owner:A:',
  '/agents/session-host/owner:A:session', '/agents/auth-store/owner:A:session',
  '/agents/dsh-subagent/owner:A:session', '/agents/unknown/owner:A:session',
  '/agents/dsh-agent/owner:A:session/sub/dsh-subagent/child',
  '/agents/dsh-agent/owner:A:session/unknown',
];
let dispatches = 0;
const handler = createAgentHandler({ session: async () => ({ id: 'A' }) }, async (request, bindings) => {
  dispatches++;
  assert.deepEqual(Object.keys(bindings), ['DshAgent'], 'SDK receives no unrelated DO namespaces');
  return routeAgentRequest(request, bindings, { routingRetry: false });
});
for (const path of rejected) {
  for (const upgrade of [false, true]) {
    const response = await handler(new Request(`https://product.test${path}`, {
      headers: upgrade ? { upgrade: 'websocket', origin: 'https://product.test' } : {},
    }), env);
    assert.equal(response?.status, 403, `${path} must be rejected before SDK dispatch`);
    assert.equal(dispatches, 0);
    assert.deepEqual(accesses, [], 'invalid paths cannot resolve or fetch any Durable Object');
  }
}
for (const suffix of ['', '/live-stream']) {
  for (const upgrade of [false, true]) {
    const response = await handler(new Request(`https://product.test/agents/dsh-agent/owner:A:session${suffix}`, {
      headers: upgrade ? { upgrade: 'websocket', origin: 'https://product.test' } : {},
    }), env);
    assert.equal(response?.status, 200, 'canonical current-owner HTTP and WebSocket routes still reach the SDK');
  }
}
assert.equal(dispatches, 4);
assert.equal(accesses.length, 12);
assert.ok(accesses.every(([label, , name]) => label === 'agent' && name === 'owner:A:session'));
const anonymous = createAgentHandler({ session: async () => undefined }, async () => { throw new Error('anonymous SDK dispatch'); });
assert.equal((await anonymous(new Request('https://product.test/agents/dsh-agent/owner:A:session'), env))?.status, 401);
assert.equal(await handler(new Request('https://product.test/assets/file.js'), env), undefined);
console.log('agent routing: malformed, foreign-owner and other-namespace routes never dispatch; canonical owner HTTP/WebSocket uses the pinned SDK');
