/** The public Session surface used to maintain one current instruction snapshot. */
export interface ContextMessage {
  id: string;
  role: "user";
  parts: Array<{ type: "text"; text: string }>;
  metadata: { dshContext: true; kind: string };
}

interface StoredMessage { id: string; metadata?: unknown }
export interface ContextSession {
  getHistory(): Promise<StoredMessage[]>;
  getMessage(id: string): Promise<unknown | null>;
  updateMessage(message: ContextMessage): Promise<unknown | null>;
  appendMessage(message: ContextMessage): Promise<unknown>;
  deleteMessages(ids: string[]): Promise<void>;
}

function contextKind(message: StoredMessage): string | undefined {
  const metadata = message.metadata as { dshContext?: unknown; kind?: unknown } | undefined;
  return metadata?.dshContext === true && typeof metadata.kind === "string" ? metadata.kind : undefined;
}

/**
 * Update existing snapshots independently, and append new snapshots at the
 * current leaf. Think.addMessages' batched upsert makes every existing id the
 * next message's parent; mixing old ids and new ones there forks the transcript.
 * The public Session deletion contract splices surviving children to their
 * nearest surviving ancestor, preserving user/assistant history.
 */
export async function replaceDurableContext(session: ContextSession, messages: readonly ContextMessage[]): Promise<void> {
  const history = await session.getHistory();
  const wanted = new Set(messages.map(message => message.id));
  const stale = history.filter(message => {
    const kind = contextKind(message);
    return kind !== undefined && kind !== "time" && kind !== "approval-policy-notice" && !wanted.has(message.id);
  }).map(message => message.id);
  if (stale.length > 0) await session.deleteMessages(stale);
  const activeIds = new Set(history.filter(message => !stale.includes(message.id)).map(message => message.id));
  for (const message of messages) {
    if (activeIds.has(message.id)) {
      if (await session.updateMessage(message) === null) throw new Error(`Context snapshot disappeared: ${message.id}`);
    } else {
      // Repair a legacy snapshot stranded on another branch. An idempotent
      // append of that id alone would return its old row, never move the leaf.
      if (await session.getMessage(message.id) !== null) await session.deleteMessages([message.id]);
      await session.appendMessage(message);
    }
  }
  const persisted = await session.getHistory();
  const persistedIds = new Set(persisted.map(message => message.id));
  for (const id of wanted) if (!persistedIds.has(id)) throw new Error(`Context snapshot not on active history: ${id}`);
  const timeIds = persisted.filter(message => contextKind(message) === "time").map(message => message.id);
  if (timeIds.length > 20) await session.deleteMessages(timeIds.slice(0, -20));
}
