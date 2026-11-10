/** Isolate-local plugin lifecycle bridge. This module owns no statistics implementation. */
export type CompletedObserver = (env: unknown, ownerId: string) => boolean | Promise<boolean>;
const observers = new Set<CompletedObserver>();
export function registerCompletedObserver(observer: CompletedObserver): () => void {
  observers.add(observer);
  return () => { observers.delete(observer); };
}
/** Only a durably completed Host turn calls this; absent providers perform no work. */
export async function notifyCompleted(env: unknown, ownerId: string): Promise<boolean> {
  let accepted = false;
  for (const observer of [...observers]) {
    try { if (await observer(env, ownerId)) accepted = true; } catch { /* Optional observers cannot affect the turn. */ }
  }
  return accepted;
}
