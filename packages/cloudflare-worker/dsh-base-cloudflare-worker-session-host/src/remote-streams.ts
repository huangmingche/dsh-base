/**
 * Official `session` stream bridge over the Workers-native Session Host.
 *
 * The Gateway stream mux (`/api/remote.mux`) carries each logical stream here;
 * every stream dispatch goes through the same owner-scoped Session Host DO as
 * the unary bridge, so the official journal and the custom transport observe
 * one durable Session. Token deltas stay on the Agent-bound `/api/agent-live`
 * WebSocket: this bridge only owns the durable journal projection.
 */
import type {
  WireStreamHandler,
  WireStreamInvocation,
  WireStreamRegistry,
} from "@dsh-base/cloudflare-worker-wire-rpc";
import {
  buildSessionHistory,
  SessionWireSequencer,
  type SessionHistorySnapshot,
  type SessionLiveAttempt,
} from "@dsh-base/session-wire";
import { toOfficialProjections } from './remote-mapping.ts';
import { SessionRpcFault } from "./remote-contract.ts";
import { toolResultValueFor } from "./tool-result-mapping.ts";
import { createHostCall, readHostLive, hostChanges } from "./host-call.ts";
import { argsOf, isRecord, requestOf } from "./remote.ts";

/** One durable message row as the Host page read returns it. */
type HostPage = SessionHistorySnapshot;

/** Read the ordinary-Session address; direct-subagent follow is not bridged yet. */
function followSessionId(request: Record<string, unknown>, endpoint: string): string {
  const address = request.address;
  if (!isRecord(address)) {
    throw new SessionRpcFault("gateway/bad-request", `${endpoint}: address is invalid`, { endpoint, field: "address" });
  }
  if (address.kind === "subagent") {
    throw new SessionRpcFault("session/subagent-unavailable", `${endpoint}: direct-subagent follow is not available on the Workers-native Host yet`, { endpoint });
  }
  if (address.kind !== "session" || typeof address.sessionId !== "string" || address.sessionId === "") {
    throw new SessionRpcFault("gateway/bad-request", `${endpoint}: address must carry a session id`, { endpoint, field: "address.sessionId" });
  }
  return address.sessionId;
}

/**
 * Stream the official follow frames for one durable Session: one opening
 * snapshot followed by dense journal events. Assistant live chunks remain on
 * the Agent WebSocket; the browser seam interleaves them.
 */
async function* followStream(
  invocation: WireStreamInvocation,
  sessionId: string,
  signal: AbortSignal,
): AsyncIterable<unknown> {
  const call = createHostCall(invocation);
  let sequencer: SessionWireSequencer | undefined;
  for await (const change of hostChanges(invocation, signal, sessionId)) {
    if (sequencer !== undefined && change.topics.length > 0 && !change.topics.some(topic => topic === 'sessions' || topic === 'live')) continue;
    const page = await call("history", { sessionId }) as HostPage;
    if (sequencer === undefined) {
      const rawProjections = await call("projections", { sessionId }) as Record<string, unknown>;
      sequencer = new SessionWireSequencer(page.records ?? [], { turns: page.turns, forkSeed: page.forkSeed });
      yield {
        type: "snapshot",
        header: { version: 1, id: sessionId, createdAt: Date.now(), isSeeded: page.forkSeed !== undefined },
        cursor: sequencer.cursor, records: [...sequencer.records], hasMore: false,
        projections: toOfficialProjections(rawProjections),
        assistantStream: { revision: 0 },
      };
    } else {
      for (const record of sequencer.pushMessages(page.records ?? [], page.turns)) yield record;
    }
    const live = await readHostLive(invocation, sessionId);
    for (const record of sequencer.observeLive(live)) yield record;
  }
}

/**
 * Stream the official control baseline. Client-local projection changes (for
 * example the permission preset) are interleaved by the browser seam until the
 * Host owns them.
 */
async function* controlStream(invocation: WireStreamInvocation, signal: AbortSignal): AsyncIterable<unknown> {
  const call = createHostCall(invocation);
  const previous = new Map<string, string>();
  let first = true;
  for await (const change of hostChanges(invocation, signal)) {
    if (!first && change.topics.length > 0 && !change.topics.includes('sessions')) continue;
    const sessions = new Map<string, { sessionId: string }>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const listing = await call('list', cursor === undefined ? {} : { cursor }) as { sessions: { sessionId: string }[]; cursor?: string };
      for (const session of listing.sessions) sessions.set(session.sessionId, session);
      cursor = listing.cursor;
      if (cursor !== undefined) {
        if (cursors.has(cursor)) throw new SessionRpcFault('gateway/result-invalid', 'Session list cursor did not advance', {});
        cursors.add(cursor);
      }
    } while (cursor !== undefined && !signal.aborted);
    const projections: Record<string, unknown> = {};
    const deltas: unknown[] = [];
    for (const { sessionId } of sessions.values()) {
      if (signal.aborted) return;
      const baseline = toOfficialProjections(await call('projections', { sessionId }) as Record<string, unknown>);
      const { values, asOfSeq: cursor } = baseline;
      projections[sessionId] = baseline;
      const signature = JSON.stringify(values);
      if (!first && previous.get(sessionId) !== signature) deltas.push({ type: 'projection', sessionId, seq: cursor, changes: Object.entries(values).map(([key, val]) => ({ key, val })) });
      previous.set(sessionId, signature);
    }
    if (first) { first = false; yield { type: 'baseline', value: { projections } }; }
    else yield* deltas;
  }
}

/**
 * Stream the official tool-result inspection value for one journal anchor.
 *
 * The durable result may appear after the inspector opens (a turn still
 * settling), so an unavailable first read waits for a committed invalidation.
 * @param invocation - mux invocation carrying the owner-scoped Host call.
 * @param request - `{ sessionId, seq }` official inspection request.
 * @param signal - abort signal from the logical stream.
 */
async function* toolResultsWatchStream(
  invocation: WireStreamInvocation,
  request: Record<string, unknown>,
  signal: AbortSignal,
): AsyncIterable<unknown> {
  const sessionId = request.sessionId;
  const seq = request.seq;
  if (typeof sessionId !== "string" || sessionId === "") {
    throw new SessionRpcFault("gateway/bad-request", "toolResults/watch: sessionId is required", { endpoint: "toolResults/watch", field: "sessionId" });
  }
  if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 0) {
    throw new SessionRpcFault("gateway/bad-request", "toolResults/watch: seq must be a non-negative integer", { endpoint: "toolResults/watch", field: "seq" });
  }
  const call = createHostCall(invocation);
  let previous: string | undefined;
  for await (const change of hostChanges(invocation, signal)) {
    if (change.topics.length > 0 && !change.topics.includes('sessions')) continue;
    const page = await call("history", { sessionId }) as HostPage;
    const value = toolResultValueFor(buildSessionHistory(page.records ?? [], undefined, page.turns, page.forkSeed), seq);
    const signature = JSON.stringify(value);
    if (signature !== previous) { previous = signature; yield value; }
  }
}

/**
 * Register the migrated `session` stream endpoints on the Gateway stream mux.
 * @param wireStream - stream registry provided by the wire-RPC plugin.
 * @returns disposer withdrawing every stream this bridge registered.
 */
export function registerSessionStreamEndpoints(wireStream: WireStreamRegistry): () => void {
  const disposers: Array<() => void> = [];
  const register = (method: string, handler: WireStreamHandler): void => {
    disposers.push(wireStream.register(`session/${method}`, handler));
  };

  register("follow", (payload, invocation) => {
    const endpoint = "session/follow";
    const request = requestOf(argsOf(payload, endpoint), endpoint);
    const sessionId = followSessionId(request, endpoint);
    return followStream(invocation, sessionId, invocation.request.signal);
  });

  register("control", (payload, invocation) => {
    argsOf(payload, "session/control");
    return controlStream(invocation, invocation.request.signal);
  });

  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}

/**
 * Register the official `toolResults/watch` inspection stream.
 * @param wireStream - stream registry provided by the wire-RPC plugin.
 * @returns disposer withdrawing the endpoint.
 */
export function registerToolResultStreamEndpoints(wireStream: WireStreamRegistry): () => void {
  return wireStream.register("toolResults/watch", (payload, invocation) => {
    const endpoint = "toolResults/watch";
    const request = requestOf(argsOf(payload, endpoint), endpoint);
    return toolResultsWatchStream(invocation, request, invocation.request.signal);
  });
}
