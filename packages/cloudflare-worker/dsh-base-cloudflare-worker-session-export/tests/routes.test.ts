/** Real owner-separated SQLite Hosts, R2 bytes and the pinned official exporter. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createRequire, registerHooks } from 'node:module';
const app = createRequire(new URL('../../../../apps/web/package.json', import.meta.url));
const { unzipSync, strFromU8 } = app('fflate');
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'agents') return { url: `data:text/javascript,${encodeURIComponent('export async function getAgentByName() { if (!globalThis.__exportTestAllowCancel) throw new Error("Export must not start an Agent"); return { async cancelInput() {} }; }')}`, shortCircuit: true };
  if (specifier === '@dsh-base/cloudflare-worker-session-host') return { url: new URL('../../dsh-base-cloudflare-worker-session-host/src/index.ts', import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
} });
const { Context } = await import('@deepseek-ai/cordis');
const hostPlugin = await import('../../dsh-base-cloudflare-worker-session-host/src/index.ts');
const exportPlugin = await import('../src/index.ts');
const { SessionHostObject } = await import('../../dsh-base-cloudflare-worker-session-host/src/do.ts');
const { registerPermissionPresetEndpoints } = await import('../../dsh-base-cloudflare-worker-session-host/src/remote-permissions.ts');
const { createSessionExportHandler } = await import('../src/index.ts');
const { SESSION_LOG_FILENAME, formatSessionMarkdown } = await import('@deepseek-ai/dsh-session-log-export');
const { exportLog, createExportRuntime } = await import('../src/runtime.ts');
const { sessionFormatCatalog } = await import('@deepseek-ai/dsh-session-format-catalog');
const objects = new Map<string, Uint8Array>();
let fileReads = 0;
const bucket = {
  async put(key: string, value: Uint8Array) { objects.set(key, value.slice()); },
  async get(key: string) { fileReads++; const value = objects.get(key); return value ? { arrayBuffer: async () => value.slice().buffer, text: async () => new TextDecoder().decode(value) } : null; },
  async delete(key: string) { objects.delete(key); },
};
function owner(id: string) {
  const db = new DatabaseSync(':memory:');
  const state = { id: { name: `owner:${id}:default-v49` }, storage: {
    sql: { exec(query: string, ...bindings: unknown[]) { const rows = db.prepare(query).all(...bindings as never[]) as Record<string, unknown>[]; return { toArray: () => rows, [Symbol.iterator]: () => rows[Symbol.iterator]() }; } },
    transactionSync<T>(run: () => T): T { db.exec('BEGIN'); try { const result = run(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } },
    async setAlarm() {},
  } };
  const host = new SessionHostObject(state, { DshAgent: {} as never, FILES: bucket, PLATFORM_AI_ENABLED: 'true', AI_GATEWAY_ID: 'test-gateway' });
  const call = async (method: string, params: Record<string, unknown> = {}) => {
    const response = await host.fetch(new Request('https://host/api/session-host', { method: 'POST', body: JSON.stringify({ method, params }) }));
    const body = await response.json() as { result?: any; error?: unknown };
    assert.equal(body.error, undefined, JSON.stringify(body)); return body.result;
  };
  return { db, host, call };
}
const alice = owner('alice'), bob = owner('bob');
await alice.call('create', { sessionId: 'session-a', title: '完整会话' });
await alice.call('rename', { sessionId: 'session-a', title: '完整会话' });
await alice.call('create', { sessionId: 'sibling-a' });
await bob.call('create', { sessionId: 'private-b' });
await bob.call('rename', { sessionId: 'private-b', title: 'BOB PRIVATE' });
const fileBytes = new TextEncoder().encode('附件 bytes\n');
const upload = await alice.call('uploadFile', { sessionId: 'session-a', name: 'notes.txt', data: Buffer.from(fileBytes).toString('base64') });
const accepted = await alice.call('prompt', { sessionId: 'session-a', requestId: 'prompt-1', text: 'First question', receiptIds: [upload.receiptId] });
assert.ok(accepted);
alice.db.prepare("UPDATE dsh_session_host_submissions SET status = 'completed' WHERE session_id = ?").run('session-a');
// Durable long history, far beyond a browser page, without model/tool execution.
const insert = alice.db.prepare('INSERT INTO dsh_session_host_messages (session_id, id, seq, role, parts) VALUES (?, ?, ?, ?, ?)');
const previous = Number(alice.db.prepare('SELECT MAX(seq) AS n FROM dsh_session_host_messages WHERE session_id = ?').get('session-a')?.n ?? 0);
for (let i = 0; i < 150; i++) {
  insert.run('session-a', `message-${i}`, previous + i + 1, i % 2 ? 'assistant' : 'user', JSON.stringify([{ type: 'text', text: `Historical message ${i}` }]));
  if (i % 2 === 0) alice.db.prepare('INSERT INTO dsh_session_host_submissions VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(`submission-${i}`, 'session-a', `message-${i}`, `Historical message ${i}`, '[]', 'completed', 1000 + i, 1001 + i);
}
alice.db.prepare('UPDATE dsh_session_host_messages SET parts = ? WHERE session_id = ? AND id = ?').run(JSON.stringify([
  { type: 'step-start' },
  { type: 'dynamic-tool', toolName: 'fetch_url', toolCallId: 'export-tool', state: 'output-available', input: { url: 'https://example.invalid' }, output: 'durable tool output' },
  { type: 'text', text: 'Historical message 1' },
]), 'session-a', 'message-1');
const seen: string[] = [];
let failHost = false;
const env = { SESSION_HOST: {
  idFromName(name: string) { seen.push(name); return name; },
  get(name: string) { const selected = name === 'owner:alice:default-v49' ? alice : name === 'owner:bob:default-v49' ? bob : undefined;
    assert.ok(selected, `unexpected owner ${name}`);
    return { async fetch(request: Request) {
      if (failHost) throw new Error('PRIVATE_INTERNAL_PATH');
      if (new URL(request.url).pathname.endsWith('/migrate/status')) return Response.json({ migrated: true });
      return selected.host.fetch(request);
    } };
  },
} };
const handler = createSessionExportHandler({ async session(request) { const id = request.headers.get('test-user'); return id ? { id } : undefined; } });
const run = async (path: string, options: { method?: string; user?: string | null; headers?: HeadersInit; signal?: AbortSignal } = {}) => {
  const headers = new Headers(options.headers);
  if (options.user !== null) headers.set('test-user', options.user ?? 'alice');
  const response = await handler(new Request(`https://app.test${path}`, { method: options.method ?? 'GET', headers, signal: options.signal }), env);
  assert.ok(response); assert.equal(response.headers.get('cache-control'), 'private, no-store'); return response;
};
for (const path of ['/api/session.export', '/api/session.markdown']) {
  const before = seen.length;
  assert.equal((await run(`${path}?sessionId=session-a`, { user: null })).status, 401);
  assert.equal(seen.length, before, 'anonymous must not touch any owner object');
  for (const query of ['', '?sessionId=', '?sessionId=session-a&sessionId=private-b', '?sessionId=session-a&owner=bob', '?sessionId=session-a&includeDescendants=maybe']) assert.equal((await run(path + query)).status, 400);
  assert.equal((await run(`${path}?sessionId=session-a`, { method: 'POST' })).status, 405);
  assert.equal((await run(`${path}?sessionId=session-a`, { headers: { origin: 'https://evil.test' } })).status, 403);
  assert.equal((await run(`${path}?sessionId=private-b`)).status, 404, 'foreign Session is indistinguishable from missing');
  assert.equal((await run(`${path}?sessionId=missing`)).status, 404);
  assert.equal((await run(`${path}?sessionId=session-a`, { user: 'bob' })).status, 404);
  const head = await run(`${path}?sessionId=session-a`, { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(await head.text(), '');
}
assert.ok(seen.every(name => name === 'owner:alice:default-v49' || name === 'owner:bob:default-v49'));
// Actual public Host prompt -> cancel lifecycle, without SQL fixture mutation.
await alice.call('create', { sessionId: 'cancelled-session' });
await alice.call('prompt', { sessionId: 'cancelled-session', requestId: 'cancelled-input', text: 'Cancel this input' });
(globalThis as any).__exportTestAllowCancel = true;
await alice.call('cancel', { sessionId: 'cancelled-session' });
(globalThis as any).__exportTestAllowCancel = false;
const cancellationZip = await run('/api/session.export?sessionId=cancelled-session');
assert.equal(cancellationZip.status, 200);
const cancellationFiles = unzipSync(new Uint8Array(await cancellationZip.arrayBuffer()));
const cancellationRows = strFromU8(cancellationFiles[SESSION_LOG_FILENAME]).trimEnd().split('\n').map((line: string) => JSON.parse(line));
const cancellationRestore = sessionFormatCatalog.createRestore(cancellationRows[0], { recovery: 'strict', validation: 'current' });
for (const row of cancellationRows.slice(1)) cancellationRestore.decodeRow(row);
assert.equal(cancellationRestore.finish().header.id, 'cancelled-session');
assert.ok(cancellationRows.some((row: any) => row.type === 'turn/end' && row.data.reason?.kind === 'aborted' && row.data.reason.reason?.kind === 'user'));
// The exact original /export handler is available only with the export plugin.
const commandRoutes = new Map<string, any>();
let enabled = true;
const disposeCommands = registerPermissionPresetEndpoints({ register(method, handler) { commandRoutes.set(method, handler); return () => commandRoutes.delete(method); } }, () => enabled);
const invoke = (method: string, args: unknown, rpcId = 'export-command', user = 'alice') => commandRoutes.get(method)({ args }, { request: new Request('https://app.test/api/wire'), env, user: { id: user }, method, rpcId });
const catalog = await invoke('commands/list', { sessionId: 'session-a' });
assert.equal(catalog.find((item: any) => item.name === 'export').definitionId, '@deepseek-ai/dsh-session-log-export');
const commandArgs = { sessionId: 'session-a', line: '/export', attachments: [] };
const receipt = await invoke('commands/execute', commandArgs);
assert.deepEqual(receipt.result, { kind: 'success', text: 'Session log download requested.' });
assert.deepEqual(await invoke('commands/execute', commandArgs), receipt, 'retries preserve one durable receipt');
assert.equal(alice.db.prepare("SELECT COUNT(*) AS n FROM dsh_session_host_events WHERE session_id = 'session-a' AND type IN ('command/run','command/done')").get()?.n, 2);
await assert.rejects(invoke('commands/execute', { ...commandArgs, line: '/export /tmp/file' }, 'path-command'), (error: any) => error.code === 'command/failed' && error.details.result.text.includes('does not accept a path'));
await assert.rejects(invoke('commands/execute', { ...commandArgs, attachments: [{ type: 'file', receiptId: 'staged' }] }, 'file-command'), (error: any) => error.code === 'command/failed');
await assert.rejects(invoke('commands/execute', { ...commandArgs, line: '/export different' }), (error: any) => error.code === 'session/command-conflict');
await assert.rejects(invoke('commands/execute', commandArgs, 'foreign-command', 'bob'), (error: any) => error.code === 'session/not-found');
enabled = false;
assert.ok(!(await invoke('commands/list', { sessionId: 'session-a' })).some((item: any) => item.name === 'export'));
disposeCommands();
const snapshot = await alice.call('logExportSnapshot', { sessionId: 'session-a' });
const markdown = await run('/api/session.markdown?sessionId=session-a');
assert.equal(markdown.status, 200);
const text = await markdown.text();
assert.equal(text, formatSessionMarkdown(exportLog(snapshot).events));
assert.match(text, /^# 完整会话/); assert.match(text, /Historical message 0/); assert.match(text, /Historical message 149/);
assert.ok(!text.includes('BOB PRIVATE'));
const archiveResponse = await run('/api/session.export?sessionId=session-a&includeDescendants=true');
assert.equal(archiveResponse.status, 200); assert.equal(archiveResponse.headers.get('content-type'), 'application/zip');
assert.match(archiveResponse.headers.get('content-disposition')!, /dsh-session-session-a.zip/);
const archive = unzipSync(new Uint8Array(await archiveResponse.arrayBuffer())) as Record<string, Uint8Array>;
const log = strFromU8(archive[SESSION_LOG_FILENAME]);
const rows = log.trimEnd().split('\n').map((line: string) => JSON.parse(line));
const restore = sessionFormatCatalog.createRestore(rows[0], { recovery: 'strict', validation: 'current' });
for (const row of rows.slice(1)) restore.decodeRow(row);
assert.equal(restore.finish().header.id, 'session-a', 'official current-format codec restores the exported artifact');
assert.ok(rows.some((row: any) => row.type === 'tool/call' && row.data.callId === 'export-tool'));
assert.ok(rows.some((row: any) => row.type === 'tool/result' && JSON.stringify(row.data).includes('durable tool output')));
assert.ok(rows.some((row: any) => row.type === 'user/message' && row.surfaceOp === 'append'));
assert.ok(rows.some((row: any) => row.type === 'turn/start' && row.time === 1000));
assert.match(log, /Historical message 0/); assert.match(log, /Historical message 149/);
assert.ok(!log.includes('BOB PRIVATE'));
assert.deepEqual(Object.keys(archive).filter(path => path.startsWith('subagents/')), [], 'ordinary Sessions do not become descendants');
const filePath = Object.keys(archive).find(path => path.startsWith('files/'));
assert.ok(filePath); assert.deepEqual(archive[filePath], fileBytes);
assert.equal(fileReads > 0, true);
// Ordinary forks retain exactly their official seed and the latest owner title.
const fork = await alice.call('fork', { sessionId: 'session-a', title: 'fork old' });
await alice.call('rename', { sessionId: fork.sessionId, title: 'Fork latest title' });
const forkResponse = await run(`/api/session.export?sessionId=${fork.sessionId}`);
assert.equal(forkResponse.status, 200);
const forkZip = unzipSync(new Uint8Array(await forkResponse.arrayBuffer()));
const forkRows = strFromU8(forkZip[SESSION_LOG_FILENAME]).trimEnd().split('\n').map((line: string) => JSON.parse(line));
const forkRestore = sessionFormatCatalog.createRestore(forkRows[0], { recovery: 'strict', validation: 'current' });
for (const row of forkRows.slice(1)) forkRestore.decodeRow(row);
const forkArtifact = forkRestore.finish();
assert.equal(forkArtifact.header.isSeeded, true);
assert.equal(forkRows.filter((row: any) => row.type === 'session/end-seed' && row.data.inherited).length, 1);
assert.ok(forkArtifact.inheritedEventCount > 0);
assert.match(await (await run(`/api/session.markdown?sessionId=${fork.sessionId}`)).text(), /^# Fork latest title/);
// Legacy history with no durable Turn ending is readable, but never forged into a valid native log.
await alice.call('create', { sessionId: 'legacy' });
for (let i = 0; i < 4; i++) insert.run('legacy', `legacy-${i}`, i + 1, i % 2 ? 'assistant' : 'user', JSON.stringify([{ type: 'text', text: `Legacy ${i}` }]));
for (const method of ['HEAD', 'GET']) assert.equal((await run('/api/session.export?sessionId=legacy', { method })).status, 500);
assert.match(await (await run('/api/session.markdown?sessionId=legacy')).text(), /Legacy 3/);
const before = fileReads;
await assert.rejects(alice.call('logExportFile', { sessionId: 'sibling-a', file: upload.file }));
assert.equal(fileReads, before, 'cross-Session references are rejected before R2 reads');
const privateUpload = await bob.call('uploadFile', { sessionId: 'private-b', name: 'secret.txt', data: btoa('PRIVATE FILE') });
await assert.rejects(alice.call('logExportFile', { sessionId: 'session-a', file: privateUpload.file }));
const staged = await alice.call('uploadFile', { sessionId: 'session-a', name: 'unsubmitted.txt', data: btoa('NOT ADMITTED') });
await assert.rejects(alice.call('logExportFile', { sessionId: 'session-a', file: staged.file }));
const controller = new AbortController(); controller.abort();
await assert.rejects(run('/api/session.export?sessionId=session-a', { signal: controller.signal }), /abort/i);
const readsBeforeCancel = fileReads;
const cancelled = await run('/api/session.export?sessionId=session-a&includeDescendants=true');
await cancelled.body!.cancel('consumer stopped');
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(fileReads, readsBeforeCancel, 'cancel before attachment pull does not continue R2 reads');
const midAbort = new AbortController();
const interrupted = await run('/api/session.export?sessionId=session-a', { signal: midAbort.signal });
midAbort.abort();
await assert.rejects(interrupted.arrayBuffer(), /Session export stream failed/);
assert.equal(fileReads, readsBeforeCancel, 'request abort stops pending attachment reads');
const key = [...objects.keys()].find(key => key.startsWith('owner/alice/') && key.includes(upload.receiptId))!;
objects.delete(key);
const missingArchive = unzipSync(new Uint8Array(await (await run('/api/session.export?sessionId=session-a')).arrayBuffer()));
assert.ok(missingArchive[SESSION_LOG_FILENAME]);
assert.equal(Object.hasOwn(missingArchive, filePath), false);
assert.equal(strFromU8(missingArchive['attachments-missing.txt']), `${filePath}\tAttachment not found\n`);
objects.set(key, new TextEncoder().encode('corrupt'));
const corrupt = await run('/api/session.export?sessionId=session-a');
await assert.rejects(corrupt.arrayBuffer(), /Session export stream failed/);
objects.set(key, fileBytes);
failHost = true;
const failed = await run('/api/session.markdown?sessionId=session-a');
assert.equal(failed.status, 500); assert.ok(!(await failed.text()).includes('PRIVATE_INTERNAL_PATH'));
failHost = false;
const runtime = await createExportRuntime(async () => { throw new Error('unused'); }, 'session-a', new AbortController().signal);
assert.equal(runtime.command.name, 'export'); assert.equal(runtime.command.definitionId, '@deepseek-ai/dsh-session-log-export');
await runtime.dispose();
// Mount the actual plugins in Cordis: an undeclared service read passes a
// callback stub but throws in production. Exercise both provider orders and
// unload/reload without losing the always-available permission endpoints.
for (const exportFirst of [false, true]) {
  const ctx = new Context();
  const mountedRoutes = new Map<string, any>();
  ctx.provide('http', { use() { return () => {}; } } as never);
  ctx.provide('auth', { async session() { return { id: 'alice' }; } } as never);
  ctx.provide('wireRpc', { register(method: string, handler: unknown) {
    assert.ok(!mountedRoutes.has(method), `duplicate endpoint ${method}`);
    mountedRoutes.set(method, handler); return () => mountedRoutes.delete(method);
  } });
  let exporter = exportFirst ? await ctx.plugin(exportPlugin) : undefined;
  await ctx.plugin(hostPlugin);
  // Dependency-fiber activation/disposal settles on the next task.
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  const mountedCatalog = () => mountedRoutes.get('commands/list')({ args: { sessionId: 'session-a' } }, {
    request: new Request('https://app.test/api/wire'), env, user: { id: 'alice' }, method: 'commands/list', rpcId: 'mounted-list',
  });
  await settle();
  let items = await mountedCatalog();
  assert.equal(items.some((item: any) => item.name === 'export'), exportFirst);
  assert.ok(items.some((item: any) => item.name === 'permission'));
  if (!exporter) { exporter = await ctx.plugin(exportPlugin); await settle(); }
  assert.ok((await mountedCatalog()).some((item: any) => item.name === 'export'));
  await exporter.dispose(); await settle();
  items = await mountedCatalog();
  assert.ok(items.some((item: any) => item.name === 'permission'));
  assert.ok(!items.some((item: any) => item.name === 'export'));
  exporter = await ctx.plugin(exportPlugin); await settle();
  assert.ok((await mountedCatalog()).some((item: any) => item.name === 'export'));
  await ctx.fiber.dispose();
  assert.equal(mountedRoutes.size, 0);
}
alice.db.close(); bob.db.close();
console.log('Session export: unchanged official routes, full owner snapshots, Markdown, streamed ZIP, admitted R2 files, HEAD, authorization, errors and cancellation passed');
