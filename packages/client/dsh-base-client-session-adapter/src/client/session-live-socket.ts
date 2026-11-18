import type { SessionLiveAttempt } from "@dsh-base/session-wire";

export type LiveSnapshot = SessionLiveAttempt | null;

/** Observe the Agent's cumulative live snapshots for the lifetime of one follow. */
export function watchSessionLive(
  sessionId: string,
  signal: AbortSignal,
  changed: (snapshot: LiveSnapshot | undefined) => void,
): () => void {
  let socket: WebSocket | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  const connect = (): void => {
    if (signal.aborted || typeof WebSocket === "undefined") return;
    const url = new URL("/api/agent-live", location.origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("sessionId", sessionId);
    const current = new WebSocket(url.href);
    socket = current;
    current.addEventListener("message", event => {
      if (socket !== current) return;
      try {
        const { live } = JSON.parse(String(event.data)) as { live?: LiveSnapshot };
        changed(live ?? null);
      } catch {}
    });
    current.addEventListener("error", () => { if (socket === current) current.close(); });
    current.addEventListener("close", () => {
      if (signal.aborted || socket !== current) return;
      socket = undefined;
      reconnectTimer = setTimeout(connect, 750);
      changed(undefined);
    });
  };
  const stop = (): void => {
    clearTimeout(reconnectTimer);
    const current = socket;
    socket = undefined;
    current?.close();
  };
  connect();
  signal.addEventListener("abort", stop, { once: true });
  return () => {
    signal.removeEventListener("abort", stop);
    stop();
  };
}
