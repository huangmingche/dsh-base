/** Owner-scoped durable change notifications forwarded to the official Remote event face. */
export interface OwnerChangeSource {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
  close(): void;
}

export function subscribeOwnerInvalidations(options: {
  readonly url: string;
  readonly emit: (event: string, ...args: unknown[]) => void;
  readonly source?: (url: string) => OwnerChangeSource;
  readonly error: (error: Error) => void;
  readonly changed?: (topics: readonly string[] | undefined, baseline: boolean) => void;
}): () => void {
  const source = (options.source ?? (url => new EventSource(url, { withCredentials: true })))(options.url);
  let disposed = false;
  let revision: number | undefined;
  // Reconnect baselines close the read/subscribe race even when no further
  // mutation follows. The browser owns retry/backoff and Last-Event-ID.
  const open = () => { revision = undefined; };
  const receive = (event: Event) => {
    if (disposed) return;
    try {
      const value: unknown = JSON.parse((event as MessageEvent<string>).data);
      if (value === null || typeof value !== "object") throw new Error("Invalid owner change notification");
      const frame = value as { type?: unknown; revision?: unknown; topics?: unknown };
      if (frame.type !== "invalidate" || typeof frame.revision !== "number" || !Number.isSafeInteger(frame.revision) || frame.revision < 0
        || (frame.topics !== undefined && (!Array.isArray(frame.topics) || !frame.topics.every(topic => typeof topic === "string")))) {
        throw new Error("Invalid owner change notification");
      }
      if (revision !== undefined && frame.revision <= revision) return;
      const baseline = revision === undefined;
      revision = frame.revision;
      const topics = frame.topics as string[] | undefined;
      options.changed?.(topics, baseline);
      const includes = (topic: string) => baseline || topics === undefined || topics.includes(topic);
      if (includes("settings")) {
        options.emit("settings/document-updated");
        options.emit("permission-presets/catalog-changed");
      }
      if (includes("schedule")) options.emit("schedule/changed");
      if (includes("credentials")) {
        options.emit("credentials/reference-updated");
        options.emit("credentials/record-updated");
      }
    } catch (error) {
      options.error(error instanceof Error ? error : new Error(String(error)));
    }
  };
  source.addEventListener("open", open);
  source.addEventListener("message", receive);
  source.addEventListener("invalidate", receive);
  return () => {
    if (disposed) return;
    disposed = true;
    source.removeEventListener("open", open);
    source.removeEventListener("message", receive);
    source.removeEventListener("invalidate", receive);
    source.close();
  };
}
