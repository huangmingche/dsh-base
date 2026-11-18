import { watchSessionLive, type LiveSnapshot } from "./session-live-socket.ts";

type FollowInput<Frame> = { frame: Frame } | { live: LiveSnapshot | undefined };

/** Read at most one journal frame ahead and coalesce the Agent's cumulative snapshots. */
export async function* sessionFollowInputs<Frame>(
  sessionId: string,
  signal: AbortSignal,
  openJournal: (signal: AbortSignal) => AsyncIterable<Frame>,
  readLive: () => Promise<LiveSnapshot | undefined>,
): AsyncGenerator<FollowInput<Frame>> {
  if (signal.aborted) return;
  const lifetime = new AbortController();
  const scope = AbortSignal.any([signal, lifetime.signal]);
  const iterator = openJournal(scope)[Symbol.asyncIterator]();
  let journal: IteratorResult<Frame> | undefined;
  let failure: { error: unknown } | undefined;
  let socketSnapshot: LiveSnapshot | undefined;
  let liveChanged = false;
  let wake: (() => void) | undefined;
  const notify = (): void => wake?.();
  const readFrame = (): void => {
    void iterator.next().then(
      result => { journal = result; notify(); },
      error => { failure = { error }; notify(); },
    );
  };
  const stopLive = watchSessionLive(sessionId, scope, snapshot => {
    socketSnapshot = snapshot;
    liveChanged = true;
    notify();
  });
  scope.addEventListener("abort", notify, { once: true });
  try {
    readFrame();
    while (!scope.aborted) {
      if (failure) throw failure.error;
      if (journal) {
        const result = journal;
        journal = undefined;
        if (result.done) return;
        readFrame();
        yield { frame: result.value };
        continue;
      }
      if (liveChanged) {
        liveChanged = false;
        yield { live: socketSnapshot };
        continue;
      }
      // A connected Agent supplies the idle baseline and every revision by push.
      // While waiting for that baseline, keep the Host read fallback at the
      // live socket's reconnect cadence. There is only one pending journal read.
      let fallback = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      await new Promise<void>(resolve => {
        wake = resolve;
        if (socketSnapshot === undefined) {
          timer = setTimeout(() => { fallback = true; resolve(); }, 750);
        }
      });
      wake = undefined;
      clearTimeout(timer);
      if (fallback && !scope.aborted && socketSnapshot === undefined) {
        const live = await readLive();
        if (!scope.aborted && !liveChanged) yield { live };
      }
    }
  } finally {
    scope.removeEventListener("abort", notify);
    stopLive();
    lifetime.abort();
    await iterator.return?.();
  }
}
