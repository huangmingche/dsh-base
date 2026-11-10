/** Authenticated Workers HTTP seam for the unchanged official Session export. */
import type { Context } from '@deepseek-ai/cordis';
import type { WorkerHandler } from '@dsh-base/cloudflare-worker-http';
import { SessionId } from '@deepseek-ai/dsh-session';
import { SessionPersistenceNotFoundError } from '@deepseek-ai/dsh-session-persistence';
import { handleSessionHostRequest } from '@dsh-base/cloudflare-worker-session-host';
import { createExportRuntime, type HostCall } from './runtime.ts';

export const name = '@dsh-base/cloudflare-worker-session-export';
export const inject = ['http', 'auth'];
export const Config = undefined;
const PATHS = new Set(['/api/session.export', '/api/session.markdown']);

/** Preserve opaque failures and prohibit shared/proxy caching of any export response. */
function privateResponse(response: Response, method: string): Response {
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'private, no-store');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('vary', 'Cookie, Authorization');
  return new Response(method === 'HEAD' ? null : response.body, { status: response.status, headers });
}

export function createSessionExportHandler(auth: { session(request: Request, env: unknown): Promise<{ id: string } | undefined> }): WorkerHandler {
  return async (request, env) => {
    const url = new URL(request.url);
    if (!PATHS.has(url.pathname)) return undefined;
    const reply = (text: string, status: number, headers?: HeadersInit) => privateResponse(new Response(text, { status, headers }), request.method);
    const origin = request.headers.get('origin');
    if (origin !== null && origin !== url.origin) return reply('untrusted origin', 403);
    if (request.method !== 'GET' && request.method !== 'HEAD') return reply('method not allowed', 405, { allow: 'GET, HEAD' });
    const user = await auth.session(request, env);
    if (!user) return reply('unauthenticated', 401);
    const keys = [...url.searchParams.keys()];
    const sessionId = url.searchParams.get('sessionId');
    const descendants = url.searchParams.get('includeDescendants');
    if (!sessionId || keys.some(key => !['sessionId', 'includeDescendants'].includes(key)) || keys.length !== new Set(keys).size
      || (descendants !== null && descendants !== 'true' && descendants !== 'false')) return reply('invalid export query', 400);
    const call: HostCall = async (method, params, signal) => {
      signal.throwIfAborted();
      const response = await handleSessionHostRequest(new Request('https://session-host/api/session-host', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, params }), signal,
      }), env, user.id);
      signal.throwIfAborted();
      if (!response) throw new Error('Session Host unavailable');
      const body = await response.json() as { result?: unknown; error?: { code?: unknown } };
      signal.throwIfAborted();
      if (body.error?.code === 'not_found' || body.error?.code === 'session/not-found') throw new SessionPersistenceNotFoundError(SessionId(sessionId));
      if (body.error) throw new Error('Session Host export failed');
      if (!response.ok) throw new Error('Session Host unavailable');
      return body.result;
    };
    let runtime: Awaited<ReturnType<typeof createExportRuntime>> | undefined;
    try {
      runtime = await createExportRuntime(call, sessionId, request.signal);
      const route = runtime.routes.get(url.pathname);
      if (!route) { await runtime.dispose(); return reply('session export unavailable', 503); }
      const response = privateResponse(await route.fetch(request), request.method);
      if (response.body === null) { await runtime.dispose(); return response; }
      const reader = response.body.getReader();
      const scope = runtime;
      let disposed = false;
      const dispose = async () => { if (!disposed) { disposed = true; await scope.dispose(); } };
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const part = await reader.read();
            if (part.done) { await dispose(); controller.close(); }
            else controller.enqueue(part.value);
          } catch {
            await reader.cancel().catch(() => {}); await dispose();
            controller.error(new Error('Session export stream failed'));
          }
        },
        async cancel(reason) { try { await reader.cancel(reason); } finally { await dispose(); } },
      });
      return new Response(body, { status: response.status, headers: response.headers });
    } catch {
      await runtime?.dispose();
      request.signal.throwIfAborted();
      return reply('session export failed', 500);
    }
  };
}

export function apply(ctx: Context): void {
  ctx.provide('sessionLogExport', true);
  ctx.effect(() => ctx.http.use(createSessionExportHandler(ctx.auth)), 'dsh-base: official Session export routes');
}
