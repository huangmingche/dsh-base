/** Local invalidations after accepted Host writes; approvals keep their waterfall. */
export function createRemoteInvalidations() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    on(event: string, listener: (...args: unknown[]) => void): () => void {
      const group = listeners.get(event) ?? new Set();
      listeners.set(event, group);
      group.add(listener);
      return () => {
        group.delete(listener);
        if (group.size === 0) listeners.delete(event);
      };
    },
    emit(event: string, ...args: unknown[]): void {
      for (const listener of [...(listeners.get(event) ?? [])]) listener(...args);
    },
    clear(): void { listeners.clear(); },
  };
}
