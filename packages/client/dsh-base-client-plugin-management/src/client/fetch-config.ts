/** Host configuration state for the existing official row-configuration slot. */
export interface CurrentSessionSource {
  getSnapshot(): { readonly key: string | undefined };
  subscribe(listener: () => void): () => void;
}
type Scope = 'owner' | 'session';
interface State {
  readonly scope: Scope;
  readonly sessionId: string | undefined;
  readonly text: string;
  readonly revision: number;
  readonly ready: boolean;
  readonly busy: boolean;
  readonly status?: { readonly saved: true } | { readonly error: string };
}
const PATH = '/api/plugin-manager';
const NAME = '@dsh-base/cloudflare-think-fetch';
type Overrides = Record<string, { config?: { allowlist?: string[] } }>;
interface Control { revision?: number; overrides?: Overrides; session?: Overrides; error?: { message?: string } }

/** Bind edits to the official current Session, never a URL captured at boot. */
export function createFetchConfigStore(current: CurrentSessionSource, fetchImpl: typeof fetch = fetch) {
  let state: State = { scope: 'owner', sessionId: current.getSnapshot().key, text: '', revision: 0, ready: false, busy: false };
  let generation = 0;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<State>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const target = () => ({ scope: state.scope, sessionId: state.scope === 'session' ? state.sessionId : undefined });
  const matches = (captured: ReturnType<typeof target>, version: number) => version === generation
    && captured.scope === state.scope
    && (captured.scope === 'owner' || (captured.sessionId !== undefined
      && captured.sessionId === state.sessionId && captured.sessionId === current.getSnapshot().key));
  const load = async (): Promise<void> => {
    const captured = target(), version = ++generation;
    publish({ text: '', ready: false, busy: false, status: undefined });
    if (!matches(captured, version)) return;
    try {
      const suffix = captured.scope === 'session' ? `?sessionId=${encodeURIComponent(captured.sessionId!)}` : '';
      const response = await fetchImpl(`${PATH}${suffix}`, { headers: { accept: 'application/json' } });
      const body = await response.json() as Control;
      if (!matches(captured, version)) return;
      if (!response.ok) throw new Error(body.error?.message ?? 'Configuration read failed');
      const selected = captured.scope === 'session' ? body.session?.[NAME] : body.overrides?.[NAME];
      publish({ revision: Number(body.revision) || 0, text: (selected?.config?.allowlist ?? []).join('\n'), ready: true });
    } catch (error) {
      if (matches(captured, version)) publish({ status: { error: String(error) } });
    }
  };
  const syncSession = () => {
    const sessionId = current.getSnapshot().key;
    if (sessionId === state.sessionId) return;
    publish({ sessionId });
    if (state.scope === 'session') void load();
  };
  const write = async (restore: boolean): Promise<void> => {
    const captured = target();
    // The observable can change before React renders its notification. Reject
    // that old editor; never retarget its text or silently fall back to owner.
    if (!state.ready || state.busy || !matches(captured, generation)) { syncSession(); return; }
    const version = ++generation;
    const allowlist = state.text.split(/[,\n]/u).map(value => value.trim()).filter(Boolean);
    const body = {
      name: NAME,
      ...(restore && captured.scope === 'session' ? { reset: true } : { config: restore ? {} : { allowlist } }),
      ...(captured.scope === 'session' ? { sessionId: captured.sessionId } : {}),
      expectedRevision: state.revision,
    };
    publish({ busy: true, status: undefined });
    try {
      const response = await fetchImpl(PATH, { method: 'PUT', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json() as Control;
      if (!matches(captured, version)) return;
      if (!response.ok) throw new Error(result.error?.message ?? 'Configuration save failed');
      publish({ revision: Number(result.revision) || state.revision, ...(restore ? { text: '' } : {}), busy: false, status: { saved: true } });
    } catch (error) {
      if (matches(captured, version)) publish({ busy: false, status: { error: String(error) } });
    }
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    connect: () => {
      const unsubscribe = current.subscribe(syncSession);
      syncSession();
      void load();
      return () => { ++generation; unsubscribe(); };
    },
    setScope: (scope: Scope) => {
      if (scope === state.scope || (scope === 'session' && current.getSnapshot().key === undefined)) return;
      publish({ scope, sessionId: current.getSnapshot().key });
      void load();
    },
    setText: (text: string) => { if (state.ready && !state.busy) publish({ text, status: undefined }); },
    save: () => write(false),
    restore: () => write(true),
  };
}
