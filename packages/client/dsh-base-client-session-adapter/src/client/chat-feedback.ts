/**
 * Durable message feedback over the owner's settings document.
 *
 * The official feedback Remote exposes list/put/delete with optimistic version
 * checks. Workers has no feedback table here, so items live under the
 * `dsh-base:feedback` settings namespace keyed by Session and message id, which
 * survives reloads and forks without adding Session Host Durable Object code.
 */

/** Structural transport used by the feedback helpers. */
export interface FeedbackTransport {
  request(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

/** Official message-feedback item shape. */
export interface MessageFeedbackItemLike {
  readonly messageId: string;
  readonly rating: string;
  readonly note?: string;
  readonly category?: string;
  readonly version: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

const NAMESPACE = "dsh-base:feedback";

type FeedbackStore = Record<string, Record<string, MessageFeedbackItemLike>>;

function storeOf(value: unknown): FeedbackStore {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const output: FeedbackStore = {};
  for (const [sessionId, items] of Object.entries(value as Record<string, unknown>)) {
    if (typeof items !== "object" || items === null || Array.isArray(items)) continue;
    const byMessage: Record<string, MessageFeedbackItemLike> = {};
    for (const [messageId, item] of Object.entries(items as Record<string, unknown>)) {
      if (typeof item !== "object" || item === null) continue;
      const candidate = item as Partial<MessageFeedbackItemLike>;
      if (typeof candidate.rating !== "string" || (typeof candidate.version !== "number" && typeof candidate.version !== "string")) continue;
      byMessage[messageId] = {
        messageId,
        rating: candidate.rating,
        ...(typeof candidate.note === "string" ? { note: candidate.note } : {}),
        ...(typeof candidate.category === "string" ? { category: candidate.category } : {}),
        version: String(candidate.version),
        createdAt: typeof candidate.createdAt === "number" ? candidate.createdAt : Date.now(),
        updatedAt: typeof candidate.updatedAt === "number" ? candidate.updatedAt : Date.now(),
      };
    }
    output[sessionId] = byMessage;
  }
  return output;
}

async function readStore(transport: FeedbackTransport): Promise<{ revision: number; store: FeedbackStore }> {
  const snapshot = await transport.request("settingsDescribe", {}) as { revision?: number; values?: Record<string, unknown> };
  if (!Number.isSafeInteger(snapshot.revision) || (snapshot.revision as number) < 0) {
    throw new Error("The Host returned an invalid settings revision.");
  }
  return { revision: snapshot.revision as number, store: storeOf(snapshot.values?.[NAMESPACE]) };
}

/** List feedback items for one Session. */
export async function listMessageFeedback(transport: FeedbackTransport, sessionId: string): Promise<MessageFeedbackItemLike[]> {
  const { store } = await readStore(transport);
  return Object.values(store[sessionId] ?? {}).sort((left, right) => left.messageId.localeCompare(right.messageId));
}

/** Put one feedback item with the official optimistic version contract. */
export async function putMessageFeedback(
  transport: FeedbackTransport,
  request: { sessionId: string; messageId: string; rating: string; note?: string; category?: string; ifVersion: string | null },
): Promise<{ ok: true; value: MessageFeedbackItemLike } | { ok: false; error: { code: "version-conflict"; current: MessageFeedbackItemLike | null } }> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { store, revision } = await readStore(transport);
    const existing = store[request.sessionId]?.[request.messageId];
    if (request.ifVersion !== (existing?.version ?? null)) {
      return { ok: false, error: { code: "version-conflict", current: existing ?? null } };
    }
    const now = Date.now();
    const item: MessageFeedbackItemLike = {
      messageId: request.messageId,
      rating: request.rating,
      ...(request.note === undefined ? {} : { note: request.note }),
      ...(request.category === undefined ? {} : { category: request.category }),
      version: crypto.randomUUID(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    try {
      await transport.request("settingsMutate", {
        ns: NAMESPACE,
        expectedRevision: revision,
        ops: [{ op: "set", path: [request.sessionId, request.messageId], value: item }],
      });
      return { ok: true, value: item };
    } catch (error) {
      if ((error as { readonly code?: unknown }).code !== "settings/conflict") {
        throw error;
      }
    }
  }
  return { ok: false, error: { code: "version-conflict", current: (await readStore(transport)).store[request.sessionId]?.[request.messageId] ?? null } };
}

/** Delete one feedback item with the official optimistic version contract. */
export async function deleteMessageFeedback(
  transport: FeedbackTransport,
  request: { sessionId: string; messageId: string; ifVersion: string },
): Promise<{ ok: true; value: { absent: true } } | { ok: false; error: { code: "version-conflict"; current: MessageFeedbackItemLike | null } }> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { store, revision } = await readStore(transport);
    const existing = store[request.sessionId]?.[request.messageId];
    if (existing === undefined) return { ok: true, value: { absent: true } };
    if (request.ifVersion !== existing.version) {
      return { ok: false, error: { code: "version-conflict", current: existing ?? null } };
    }
    try {
      await transport.request("settingsMutate", {
        ns: NAMESPACE,
        expectedRevision: revision,
        ops: [{ op: "unset", path: [request.sessionId, request.messageId] }],
      });
      return { ok: true, value: { absent: true } };
    } catch (error) {
      if ((error as { readonly code?: unknown }).code !== "settings/conflict") throw error;
    }
  }
  return { ok: false, error: { code: "version-conflict", current: (await readStore(transport)).store[request.sessionId]?.[request.messageId] ?? null } };
}
