import { z } from "zod";
/** Start the official client-connection against the Workers stream mux. */
import type { Context } from "@deepseek-ai/cordis";
import type { ConnectionHandle, ConnectionHostInfo } from "@deepseek-ai/dsh-client-connection/client";

export const Config = z.object({}).default({});

export const name = "@dsh-base/client-wire-bootstrap";
export const inject = ["connection"];

const MUX_PATH = "/api/remote.mux";

function parseReady(text: unknown): ConnectionHostInfo | undefined {
  if (typeof text !== "string") return undefined;
  try {
    const frame = JSON.parse(text) as { type?: unknown; value?: { type?: unknown; host?: { home?: unknown } } };
    if (frame.type !== "item" || frame.value?.type !== "ready") return undefined;
    const home = frame.value.host?.home;
    return { home: typeof home === "string" ? home : "" };
  } catch {
    return undefined;
  }
}

export function apply(ctx: Context): void {
  const connection = ctx.get("connection") as ConnectionHandle;
  const disposeSource = connection.registerGenerationSource(async (signal, ready) => {
    const socket = connection.openWebSocket(MUX_PATH);
    let opened = false;
    let finish!: () => void;
    const ended = new Promise<void>((resolve) => { finish = resolve; });
    const abort = (): void => { finish(); };
    signal.addEventListener("abort", abort, { once: true });
    socket.addEventListener("error", () => { finish(); });
    socket.addEventListener("close", () => { finish(); });
    socket.addEventListener("message", (event) => {
      const host = parseReady((event as { data?: unknown }).data);
      if (host !== undefined) ready(host);
    });
    socket.addEventListener("open", () => {
      opened = true;
      socket.send(JSON.stringify({ type: "open", streamId: "generation", endpoint: "$events", payload: { args: {} } }));
    });
    try {
      await ended;
    } finally {
      signal.removeEventListener("abort", abort);
      if (opened) socket.close(1000, "generation ended");
    }
  });
  const loop = connection.start({
    onConnected: (host) => {
      (globalThis as { __DSH_WIRE_GENERATION__?: unknown }).__DSH_WIRE_GENERATION__ = { connected: true, host };
    },
    onStateChange: (state) => {
      (globalThis as { __DSH_WIRE_STATE__?: unknown }).__DSH_WIRE_STATE__ = state;
    },
  });
  ctx.effect(() => () => { loop.stop(); disposeSource(); }, "dsh-base: wire bootstrap generation");
}
