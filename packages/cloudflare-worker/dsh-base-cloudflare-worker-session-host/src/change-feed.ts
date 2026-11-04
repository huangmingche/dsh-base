import { eventStreamResponse } from './event-stream.ts';
import type { SqlStorage } from './sqlite-storage.ts';

/** Invalidation carries no account data; readers reload their authoritative snapshot. */
export interface HostInvalidation { type: 'invalidate'; revision: number; topics: string[] }

/** Bounded, event-driven fanout. Reconnecting subscribers always receive a baseline. */
export class HostChangeFeed {
  private revision = 0;
  private readonly listeners = new Set<(event: HostInvalidation) => void>();

  publish(topics: Iterable<string>): void {
    const event: HostInvalidation = { type: 'invalidate', revision: ++this.revision, topics: [...new Set(topics)] };
    for (const listener of this.listeners) listener(event);
  }

  subscribe(signal: AbortSignal): AsyncIterable<HostInvalidation> {
    const feed = this;
    return { async *[Symbol.asyncIterator]() {
      let pending: HostInvalidation | undefined = { type: 'invalidate', revision: feed.revision, topics: [] };
      let wake: (() => void) | undefined;
      const onChange = (event: HostInvalidation) => {
        pending = { ...event, topics: [...new Set([...(pending?.topics ?? []), ...event.topics])] };
        wake?.();
      };
      const onAbort = () => wake?.();
      feed.listeners.add(onChange);
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        while (!signal.aborted) {
          if (pending === undefined) await new Promise<void>(resolve => { wake = resolve; });
          wake = undefined;
          if (signal.aborted) break;
          const event = pending;
          pending = undefined;
          if (event !== undefined) yield event;
        }
      } finally {
        feed.listeners.delete(onChange);
        signal.removeEventListener('abort', onAbort);
      }
    } };
  }
}

function topicFor(query: string): string | undefined {
  const table = /^\s*(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|REPLACE\s+INTO|UPDATE(?:\s+OR\s+\w+)?|DELETE\s+FROM)\s+["`]?([a-z_]+)/i.exec(query)?.[1];
  if (table === undefined) return undefined;
  if (table.includes('setting')) return 'settings';
  if (table.includes('credential')) return 'credentials';
  if (table.includes('schedule')) return 'schedule';
  return 'sessions';
}

/** Notify after successful synchronous SQL transactions; rollbacks publish nothing. */
export function observeHostWrites(sql: SqlStorage, feed: HostChangeFeed): SqlStorage {
  let transactionTopics: Set<string> | undefined;
  return {
    exec(query, ...bindings) {
      const result = sql.exec(query, ...bindings);
      const topic = topicFor(query);
      if (topic !== undefined && Number(sql.exec('SELECT changes() AS affected').toArray()[0]?.affected ?? 0) > 0) {
        if (transactionTopics !== undefined) transactionTopics.add(topic);
        else feed.publish([topic]);
      }
      return result;
    },
    ...(sql.transactionSync === undefined ? {} : { transactionSync<T>(operation: () => T): T {
      const parent = transactionTopics;
      const topics = new Set<string>();
      transactionTopics = topics;
      try {
        const result = sql.transactionSync!(operation);
        if (parent !== undefined) for (const topic of topics) parent.add(topic);
        else if (topics.size > 0) feed.publish(topics);
        return result;
      } finally { transactionTopics = parent; }
    } }),
  };
}

/** Pull-based SSE encoding propagates cancellation to the owning subscription. */
export function invalidationResponse(feed: HostChangeFeed, requestSignal: AbortSignal): Response {
  return eventStreamResponse(signal => feed.subscribe(signal), requestSignal, 'invalidate');
}
