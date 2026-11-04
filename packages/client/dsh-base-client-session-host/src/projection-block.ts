/** Host-owned projection clock, deliberately separate from the chat journal cursor. */
export function hostProjectionBlock(raw: Record<string, unknown>): { kind: 'sequenced'; asOfSeq: number; values: Record<string, unknown> } {
  const revision = raw._dshBaseProjectionRevision;
  const values = Object.fromEntries(Object.entries(raw).filter(([key]) => !key.startsWith("_dshBase")));
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) throw new Error('Host projection revision is unavailable');
  return { kind: 'sequenced', asOfSeq: revision, values };
}

/** Legacy SSE carries invalidations; every value still comes from an atomic Host snapshot. */
export async function* hostProjectionControl(client: Pick<import('./index.ts').SessionHostClient, 'control' | 'projections'>, signal: AbortSignal): AsyncIterable<unknown> {
  let first = true;
  const revisions = new Map<string, number>();
  for await (const frame of client.control(signal)) {
    const projections: Record<string, ReturnType<typeof hostProjectionBlock>> = {};
    const changes: unknown[] = [];
    for (const value of frame.sessions) {
      if (typeof value !== 'object' || value === null || !('sessionId' in value) || typeof value.sessionId !== 'string') continue;
      const sessionId = value.sessionId;
      const block = hostProjectionBlock(await client.projections(sessionId));
      projections[sessionId] = block;
      if (!first && block.asOfSeq > (revisions.get(sessionId) ?? -1)) changes.push({ type: 'projection', sessionId, seq: block.asOfSeq, changes: Object.entries(block.values).map(([key, val]) => ({ key, val })) });
      revisions.set(sessionId, Math.max(block.asOfSeq, revisions.get(sessionId) ?? -1));
    }
    if (first) { first = false; yield { type: 'baseline', value: { projections } }; }
    else yield* changes;
  }
}
