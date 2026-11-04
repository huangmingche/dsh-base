/** Authenticated calls into the existing `/api/session-host` Worker transport. */
import type { WireInvocation } from "@dsh-base/cloudflare-worker-wire-rpc";
import type { SessionLiveAttempt } from "@dsh-base/session-wire";
import { SessionRpcFault } from "./remote-contract.ts";
import { handleSessionHostRequest } from "./worker-http.ts";
import { agentName } from "./agent-name.ts";
import { HostChangeFeed, type HostInvalidation } from './change-feed.ts';

type JsonRecord = Record<string, unknown>;

/** Translate one Host error envelope into a stable Remote failure. */
export function sessionHostFault(error: { readonly code?: unknown; readonly message?: unknown; readonly details?: unknown }): SessionRpcFault {
  const message = typeof error.message === "string" ? error.message : "Session Host request failed";
  if (typeof error.code === "string" && (error.code.startsWith("directory-picker/") || error.code.startsWith("workspace-file/") || error.code.startsWith("schedule/") || error.code.startsWith("settings/") || error.code.startsWith("workspace/") || error.code.startsWith("session/") || error.code.startsWith("permission/"))) {
    return new SessionRpcFault(error.code, message, typeof error.details === "object" && error.details !== null ? error.details as Record<string, unknown> : {});
  }
  if (typeof error.code === "string" && error.code.startsWith("workspace-file/")) {
    // File failures already carry the official vocabulary; `unavailable` means
    // the deployment has no R2 store, which the browser seam falls back on.
    return error.code === "workspace-file/unavailable"
      ? new SessionRpcFault("gateway/endpoint-unavailable", message, {})
      : new SessionRpcFault(error.code, message, {});
  }
  switch (error.code) {
    case "not_found":
      return new SessionRpcFault("session/not-found", message, {});
    case "invalid_request":
      return new SessionRpcFault("gateway/bad-request", message, {});
    case "gateway/bad-request":
      return new SessionRpcFault("gateway/bad-request", message, {});
    case "gateway/endpoint-unavailable":
      return new SessionRpcFault("gateway/endpoint-unavailable", message, typeof error.details === "object" && error.details !== null ? error.details as Record<string, unknown> : {});
    case "unknown_method":
      // A deployment without this Host capability reports it explicitly.
      return new SessionRpcFault("gateway/endpoint-unavailable", message, {});
    default:
      return new SessionRpcFault("gateway/internal", message, {});
  }
}

/** Call the existing Host transport as the invoker, through the same owner DO. */
export function createHostCall(invocation: WireInvocation) {
  return async (method: string, params: JsonRecord = {}): Promise<unknown> => {
    const request = new Request("https://session-host/api/session-host", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method, params }),
      signal: invocation.request.signal,
    });
    const response = await handleSessionHostRequest(request, invocation.env, invocation.user.id);
    if (response === undefined) throw new SessionRpcFault("gateway/internal", "Session Host route is unavailable", {});
    const body = await response.json() as {
      readonly result?: unknown;
      readonly error?: { readonly code?: unknown; readonly message?: unknown; readonly details?: unknown };
    };
    if (body.error !== undefined) {
      throw sessionHostFault(typeof body.error === "object" && body.error !== null
        ? body.error : { code: "gateway/internal", message: String(body.error) });
    }
    if (!response.ok) throw new SessionRpcFault("gateway/internal", `Session Host returned HTTP ${response.status}`, {});
    return body.result;
  };
}


/**
 * Read the live model attempt the Agent pushed for this Session.
 *
 * The Agent cannot answer a read while its own turn is running, so live
 * attempts are pushed into a session-keyed Session Host instance and read from
 * there. Reading the owner instance would only observe the state after the
 * turn settled, which is too late for the live tool rows.
 * @param invocation - authenticated stream invocation carrying Worker bindings.
 * @param sessionId - durable Session whose live attempt is read.
 * @returns the current live attempt, or null when the Agent has none.
 */
export async function readHostLive(
  invocation: WireInvocation,
  sessionId: string,
): Promise<SessionLiveAttempt | null> {
  const namespace = (invocation.env as {
    readonly SESSION_HOST?: {
      idFromName(name: string): unknown;
      get(id: unknown): { fetch(input: string): Promise<Response> };
    };
  }).SESSION_HOST;
  if (namespace === undefined) return null;
  // The Agent pushes under its owner-scoped DO name; read the same instance.
  const name = agentName(invocation.user.id, sessionId);
  const stub = namespace.get(namespace.idFromName(name));
  const response = await stub.fetch(`https://session-host/api/session-host/live-push?sessionId=${encodeURIComponent(name)}`);
  if (!response.ok) return null;
  const body = await response.json() as { readonly live?: SessionLiveAttempt | null };
  return body.live ?? null;
}

/** Subscribe before reading snapshots; initial invalidations make reconnects race-free. */
export async function* hostChanges(invocation: WireInvocation, signal: AbortSignal, sessionId?: string): AsyncIterable<HostInvalidation> {
  const abort = new AbortController();
  const stop = () => abort.abort();
  signal.addEventListener('abort', stop, { once: true });
  if (signal.aborted) abort.abort();
  const feed = new HostChangeFeed();
  let failure: unknown;
  const consume = async (responsePromise: Promise<Response | undefined>) => {
    const response = await responsePromise;
    if (response === undefined || !response.ok || response.body === null) throw new Error(`Host change stream unavailable: ${response?.status ?? 'missing'}`);
    const reader = response.body.getReader();
    const cancelReader = () => { void reader.cancel().catch(() => {}); };
    abort.signal.addEventListener('abort', cancelReader, { once: true });
    if (abort.signal.aborted) cancelReader();
    const decoder = new TextDecoder();
    let buffered = '';
    try {
      while (!abort.signal.aborted) {
        const chunk = await reader.read();
        if (chunk.done) { if (!abort.signal.aborted) throw new Error('Host change stream closed'); break; }
        buffered += decoder.decode(chunk.value, { stream: true });
        let end;
        while ((end = buffered.indexOf('\n\n')) >= 0) {
          const frame = buffered.slice(0, end); buffered = buffered.slice(end + 2);
          const data = frame.split('\n').find(line => line.startsWith('data: '));
          if (data !== undefined) {
            const event = JSON.parse(data.slice(6)) as HostInvalidation;
            if (event.type !== 'invalidate' || !Array.isArray(event.topics)) throw new Error('Invalid Host change frame');
            feed.publish(event.topics);
          }
        }
        if (buffered.length > 65536) throw new Error('Oversized Host change frame');
      }
    } finally { abort.signal.removeEventListener('abort', cancelReader); await reader.cancel().catch(() => {}); }
  };
  const tasks: Promise<void>[] = [];
  const start = (response: Promise<Response | undefined>) => tasks.push(consume(response).catch(error => { if (!abort.signal.aborted) { failure = error; feed.publish(['error']); } }));
  const ownerRequest = new Request('https://session-host/api/session-host/changes', { signal: abort.signal });
  start(handleSessionHostRequest(ownerRequest, invocation.env, invocation.user.id));
  if (sessionId !== undefined) {
    const namespace = (invocation.env as { SESSION_HOST?: { idFromName(name: string): unknown; get(id: unknown): { fetch(request: Request): Promise<Response> } } }).SESSION_HOST;
    if (namespace !== undefined) {
      const stub = namespace.get(namespace.idFromName(agentName(invocation.user.id, sessionId)));
      start(stub.fetch(new Request('https://session-host/api/session-host/changes', { signal: abort.signal })));
    }
  }
  try {
    for await (const event of feed.subscribe(abort.signal)) {
      if (failure !== undefined) throw failure;
      yield event;
    }
  } finally { abort.abort(); signal.removeEventListener('abort', stop); await Promise.all(tasks); }
}
