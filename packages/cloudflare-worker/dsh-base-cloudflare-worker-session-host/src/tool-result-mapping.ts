/**
 * Pure mapping for the official `toolResults/watch` inspection value.
 *
 * The official Host keeps live-only tool results; the Workers-native Host keeps
 * durable `tool/result` journal events. This projects a durable result message
 * back into the official `SessionToolResultValue` shape so the Trajectory
 * inspector can display it after a reload (and while a turn is still settling).
 */

/** One dense journal record, structurally matching `@dsh-base/session-wire`. */
export interface ToolResultWireRecord {
  readonly event: {
    readonly type: string;
    readonly seq: number;
    readonly data: unknown;
  };
}

/** Official inspection value. */
export type ToolResultValue =
  | { readonly available: false }
  | { readonly available: true; readonly value: unknown };

/**
 * Project the durable tool result anchored at one journal sequence.
 * @param records - dense wire journal for the Session.
 * @param seq - inclusive anchor event sequence requested by the inspector.
 * @returns the result value, or unavailable when the anchor is not a tool result.
 */
export function toolResultValueFor(records: readonly ToolResultWireRecord[], seq: number): ToolResultValue {
  for (const record of records) {
    if (record.event.seq !== seq) continue;
    if (record.event.type !== "tool/result") return { available: false };
    if (typeof record.event.data !== "object" || record.event.data === null) return { available: false };
    const message = (record.event.data as { readonly message?: unknown }).message;
    if (typeof message !== "object" || message === null) return { available: false };
    const content = (message as { readonly content?: unknown }).content;
    if (!Array.isArray(content)) return { available: false };
    const texts: string[] = [];
    for (const part of content) {
      if (typeof part !== "object" || part === null) continue;
      if ((part as { readonly type?: unknown }).type === "text" && typeof (part as { readonly text?: unknown }).text === "string") {
        texts.push((part as { readonly text: string }).text);
      }
    }
    if (texts.length === 0) return { available: false };
    const text = texts.join("\n");
    try {
      return { available: true, value: JSON.parse(text) as unknown };
    } catch {
      return { available: true, value: text };
    }
  }
  return { available: false };
}
