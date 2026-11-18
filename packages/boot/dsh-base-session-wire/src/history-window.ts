import type { SessionWireRecord } from "./index.ts";

/** Message budget the official Host applies when `maxMessages` is omitted. */
export const DEFAULT_PAGE_MESSAGES = 50;

/** Event types that count toward the official history message budget. */
const PAGE_MESSAGE_TYPES: ReadonlySet<string> = new Set(["user/message", "assistant/message"]);

/** Page record with the optional surface sources the official cut honors. */
export type SessionPageRecord = SessionWireRecord & {
  readonly event: SessionWireRecord["event"] & { readonly sourceEventSeqs?: unknown };
};

/** Validated window fields of one official `session/page` request. */
export interface SessionPageWindow {
  /** Inclusive journal cut; omission selects the newest record. */
  readonly throughSeq?: number;
  /** Exclusive upper cut of an older page. */
  readonly beforeSeq?: number;
  /** Positive user/assistant message budget. */
  readonly maxMessages?: number;
  /** Turn-boundary stop rule applied after the message budget. */
  readonly turnWindow?: {
    readonly minMessages: number;
    readonly minTurns: number;
  };
}

/** One official `session/page` value. */
export interface SessionPageValue {
  readonly records: readonly SessionWireRecord[];
  readonly hasMore: boolean;
}

/**
 * Cut one message-aligned page from the shared Session journal.
 *
 * The journal seq space is dense and ascending, so `throughSeq` is the
 * inclusive official cut and `beforeSeq` the exclusive upper bound of an older
 * page; `-1` selects the empty page. Backwards iteration mirrors the official
 * Host: a message budget stops at the oldest message (and any cited source)
 * while a Turn window stops at a Turn start once both minima are met.
 * @param records - complete journal in ascending, dense seq order.
 * @param request - validated page window from the official request.
 * @returns the chronological page and whether older records remain.
 */
export function cutSessionPage(
  records: readonly SessionPageRecord[],
  request: SessionPageWindow,
): SessionPageValue {
  if (request.throughSeq === -1) return { records: [], hasMore: false };
  const firstSeq = records[0]?.event.seq;
  const lastSeq = records.at(-1)?.event.seq;
  if (firstSeq === undefined || lastSeq === undefined) return { records: [], hasMore: false };
  const through = request.throughSeq ?? lastSeq;
  const upper = request.beforeSeq === undefined ? through + 1 : Math.min(through + 1, request.beforeSeq);
  const end = Math.min(records.length, Math.max(0, upper - firstSeq));
  const maxMessages = request.maxMessages ?? DEFAULT_PAGE_MESSAGES;
  const turnWindow = request.turnWindow;
  let count = 0;
  let turns = 0;
  let cut = 0;
  for (let index = end - 1; index >= 0; index -= 1) {
    const event = records[index]!.event;
    if (turnWindow !== undefined && event.type === "turn/start") {
      turns += 1;
      if (count >= turnWindow.minMessages && turns >= turnWindow.minTurns) {
        cut = index;
        break;
      }
    }
    if (!PAGE_MESSAGE_TYPES.has(event.type) || event.surfaceOp !== "append") continue;
    count += 1;
    let groupStart = index;
    const sources = event.sourceEventSeqs;
    if (Array.isArray(sources)) {
      for (const source of sources) {
        if (typeof source === "number") groupStart = Math.min(groupStart, source - firstSeq);
      }
    }
    if (count >= maxMessages) {
      cut = Math.max(0, groupStart);
      break;
    }
  }
  return { records: records.slice(cut, end), hasMore: cut > 0 };
}
