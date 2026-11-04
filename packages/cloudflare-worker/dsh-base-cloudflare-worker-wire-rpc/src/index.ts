/** Worker foundation for the official DSH Gateway RPC envelope and Remote stream mux. */
import type { Context } from "@deepseek-ai/cordis";
import type { WorkerHandler } from "@dsh-base/cloudflare-worker-http";
import { getAgentByName } from "agents";
import { RemoteStreamMux } from "./mux.ts";
import type { WireStreamHandler, WireStreamInvocation, WireStreamRegistry } from "./mux.ts";

export { RemoteStreamMux } from "./mux.ts";
export type { MuxSocketLike, WireStreamHandler, WireStreamInvocation, WireStreamRegistry } from "./mux.ts";

export const name = "@dsh-base/cloudflare-worker-wire-rpc";
export const inject = ["http", "auth"];

/** One official RPC endpoint handler. */
export type WireHandler = (payload: unknown, context: WireInvocation) => Promise<unknown> | unknown;

/** Per-call facts supplied to an endpoint handler. */
export interface WireInvocation {
  readonly request: Request;
  /** Worker bindings of the request being served. */
  readonly env: unknown;
  /** Authenticated user the request was admitted for. */
  readonly user: { readonly id: string };
  readonly method: string;
  readonly rpcId: string;
}

/**
 * Failure that crosses the official RPC envelope with a stable Remote code.
 *
 * Endpoint handlers throw this instead of a plain `Error` when a caller must
 * observe a business or gateway code rather than the generic `gateway/internal`.
 */
export class WireRpcError extends Error {
  /** Stable `<namespace>/<reason>` Remote failure code. */
  readonly code: string;
  /** JSON-safe failure details carried beside the code. */
  readonly details: Record<string, unknown>;

  /**
   * @param code - Remote failure code returned to the caller.
   * @param message - correction-oriented diagnostic without sensitive values.
   * @param details - JSON-safe context for the failure.
   */
  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "WireRpcError";
    this.code = code;
    this.details = details;
  }
}

/** Registry of official Gateway endpoints. */
export interface WireRpc {
  register(method: string, handler: WireHandler): () => void;
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    wireRpc: WireRpc;
    wireStream: WireStreamRegistry;
  }
}

interface ClientEnvelope {
  readonly type: "client-request";
  readonly rpcId: string;
  readonly method: string;
  readonly payload: unknown;
}

interface ServerEnvelope {
  readonly type: "server-response";
  readonly rpcId: string;
  readonly result:
    | { readonly ok: true; readonly value: unknown }
    | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly details: Record<string, unknown> } };
}

/** Exact WebSocket route carrying every official Remote stream. */
const STREAM_MUX_PATH = "/api/remote.mux";

const RESERVED = [/^\/api\/auth\//, /^\/api\/session-host/, /^\/api\/plugin-control/];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Accept a coded failure from this package or any plugin that mirrors its shape. */
function isCodedFailure(error: unknown): error is Error & { code: string; details: Record<string, unknown> } {
  if (!(error instanceof Error)) return false;
  const value = error as { code?: unknown; details?: unknown };
  return typeof value.code === "string" && isRecord(value.details);
}

function parseEnvelope(value: unknown): ClientEnvelope | undefined {
  if (!isRecord(value) || value.type !== "client-request" || typeof value.rpcId !== "string" || typeof value.method !== "string") return undefined;
  if (!Object.hasOwn(value, "payload")) return undefined;
  return { type: "client-request", rpcId: value.rpcId, method: value.method, payload: value.payload };
}

function response(rpcId: string, result: ServerEnvelope["result"]): Response {
  return Response.json({ type: "server-response", rpcId, result } satisfies ServerEnvelope, {
    headers: { "cache-control": "no-store" },
  });
}

function failure(rpcId: string, code: string, message: string, details: Record<string, unknown> = {}): Response {
  return response(rpcId, { ok: false, error: { code, message, details } });
}

/**
 * Accept one authenticated stream upgrade and serve its logical streams.
 * @param request - authenticated upgrade request.
 * @param env - Worker bindings.
 * @param user - authenticated user.
 * @param open - stream endpoint dispatcher shared by this connection.
 * @returns the `101` switch-protocol response owning the client socket.
 */
function acceptStreamMux(
  request: Request,
  env: unknown,
  user: { readonly id: string },
  open: (endpoint: string, payload: unknown, invocation: WireStreamInvocation, signal: AbortSignal) => Promise<AsyncIterable<unknown>>,
): Response {
  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];
  server.accept();
  const mux = new RemoteStreamMux(open);
  mux.handle(server, { request, env, user: { id: user.id }, method: "", rpcId: "" });
  return new Response(null, { status: 101, webSocket: client });
}

export function apply(ctx: Context): void {
  const handlers = new Map<string, WireHandler>();
  const streams = new Map<string, WireStreamHandler>();
  ctx.provide("wireRpc", {
    register(method, handler) {
      if (handlers.has(method)) throw new Error(`wireRpc: duplicate endpoint ${method}`);
      handlers.set(method, handler);
      return () => { if (handlers.get(method) === handler) handlers.delete(method); };
    },
  } satisfies WireRpc);
  ctx.provide("wireStream", {
    register(endpoint, handler) {
      if (streams.has(endpoint)) throw new Error(`wireStream: duplicate endpoint ${endpoint}`);
      streams.set(endpoint, handler);
      return () => { if (streams.get(endpoint) === handler) streams.delete(endpoint); };
    },
  } satisfies WireStreamRegistry);
  handlers.set("$ping", (payload) => ({ ping: true, payload }));
  handlers.set("$events/result", (payload) => {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new Error("invalid remote event result");
    }
    const result = payload as Record<string, unknown>;
    if (typeof result.clientId !== "string" || typeof result.eventId !== "string" || typeof result.outcome !== "object" || result.outcome === null) {
      throw new Error("invalid remote event result");
    }
    return { accepted: true };
  });

  const openStream = async (
    endpoint: string,
    payload: unknown,
    invocation: WireStreamInvocation,
    _signal: AbortSignal,
  ): Promise<AsyncIterable<unknown>> => {
    const handler = streams.get(endpoint);
    if (handler === undefined) {
      throw new WireRpcError("gateway/endpoint-unavailable", `no Worker stream handler for ${endpoint}`, { endpoint });
    }
    return handler(payload, invocation);
  };

  const handler: WorkerHandler = async (request, env) => {
    const url = new URL(request.url);
    if (url.pathname === "/api/agent-live" && request.method === "GET") {
      const user = await ctx.auth.session(request, env);
      if (user === undefined) return new Response("Unauthorized", { status: 401 });
      const sessionId = url.searchParams.get("sessionId");
      const namespace = (env as { DshAgent?: Parameters<typeof getAgentByName>[0] }).DshAgent;
      if (sessionId === null || namespace === undefined) return new Response("Missing session", { status: 400 });
      if ((request.headers.get("upgrade") ?? "").toLowerCase() !== "websocket") return new Response("Expected WebSocket", { status: 426 });
      // Owner-scoped Agent name; the browser only knows its Session id.
      const agent = await getAgentByName(namespace, `owner:${user.id}:${sessionId}`) as unknown as { fetch(input: Request): Promise<Response> };
      return agent.fetch(new Request("https://agent/live-stream", { headers: request.headers }));
    }
    if (url.pathname === "/plugins/events" && request.method === "GET") {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(": connected\n\n"));
          const timer = setInterval(() => {
            try { controller.enqueue(new TextEncoder().encode(": keepalive\n\n")); } catch { clearInterval(timer); }
          }, 15_000);
        },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" } });
    }

    if (!url.pathname.startsWith("/api/") || RESERVED.some(pattern => pattern.test(url.pathname))) return undefined;
    if (url.pathname === STREAM_MUX_PATH && request.method === "GET") {
      const user = await ctx.auth.session(request, env);
      if (user === undefined) return new Response("Unauthorized", { status: 401 });
      if ((request.headers.get("upgrade") ?? "").toLowerCase() !== "websocket") return new Response("Expected WebSocket", { status: 426 });
      return acceptStreamMux(request, env, user, openStream);
    }
    if (request.method !== "POST") return undefined;
    const user = await ctx.auth.session(request, env);
    if (user === undefined) return new Response(JSON.stringify({ error: "unauthenticated" }), { status: 401, headers: { "content-type": "application/json" } });
    const envelope = parseEnvelope(await request.json().catch(() => undefined));
    if (envelope === undefined) return new Response(JSON.stringify({ error: "invalid_wire_envelope" }), { status: 400, headers: { "content-type": "application/json" } });
    const method = url.pathname.slice("/api/".length);
    if (envelope.method !== method) return failure(envelope.rpcId, "gateway/method-mismatch", `envelope method ${envelope.method} does not match route ${method}`);
    const endpoint = handlers.get(method);
    if (endpoint === undefined) return failure(envelope.rpcId, "gateway/endpoint-unavailable", `no Worker handler for ${method}`);
    try {
      return response(envelope.rpcId, { ok: true, value: await endpoint(envelope.payload, { request, env, user, method, rpcId: envelope.rpcId }) });
    } catch (error) {
      if (isCodedFailure(error)) return failure(envelope.rpcId, error.code, error.message, error.details);
      console.error(`dsh-base wire-rpc: ${method} failed`, error);
      return failure(envelope.rpcId, "gateway/internal", "internal error");
    }
  };
  ctx.effect(() => ctx.http.use(handler), "dsh-base: wire RPC envelope");
}
