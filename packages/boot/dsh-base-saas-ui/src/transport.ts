/** Browser-only, same-origin JSON transport and request lifecycle; no feature endpoints are chosen here. */
export type Values = Readonly<Record<string, string | File>>;
export interface Field { readonly id: string; readonly label: string; readonly type?: 'text' | 'email' | 'password' | 'number' | 'file' | 'textarea' | 'checkbox' | 'select'; readonly required?: boolean; readonly value?: string; readonly minLength?: number; readonly maxLength?: number; readonly accept?: string; readonly options?: readonly {value: string; label: string; translated?: boolean}[] }
export interface Fact { readonly label: string; readonly value: string; readonly href?: string; readonly sensitive?: boolean }
export interface Row { readonly id: string; readonly facts: readonly Fact[]; readonly actions?: readonly PanelAction[] }
export interface PanelView { readonly facts?: readonly Fact[]; readonly rows?: readonly Row[]; readonly empty?: boolean; readonly notice?: string; readonly available?: boolean }
export interface PanelAction {
  readonly id: string; readonly label: string; readonly fields?: readonly Field[]; readonly disabled?: boolean; readonly needsAuth?: boolean;
  readonly challenge?: string | null;
  readonly challengeAction?: string;
  readonly method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; readonly path: (values: Values, data: unknown) => string;
  readonly body?: (values: Values, data: unknown) => unknown; readonly binary?: (values: Values) => File;
  readonly parse?: (value: unknown) => unknown; readonly result?: (value: unknown) => readonly Fact[];
  readonly replace?: (previous: unknown, response: unknown, values: Values) => unknown;
}
export interface RequestOptions { readonly method?: string; readonly json?: unknown; readonly binary?: File }
export interface Loader { readonly authenticated: boolean; request: (path: string, options?: RequestOptions) => Promise<unknown> }
export interface PanelDefinition {
  readonly bundle: string; readonly access: 'public' | 'account'; readonly checkSession?: boolean;
  readonly load: (loader: Loader) => Promise<unknown>;
  readonly view: (data: unknown, text: (key: string) => string) => PanelView;
  readonly actions?: (data: unknown) => readonly PanelAction[];
}
export interface PanelState { readonly status: 'idle' | 'loading' | 'ready' | 'error' | 'denied'; readonly auth: 'unknown' | 'guest' | 'signed-in'; readonly data?: unknown; readonly busy?: string; readonly failed?: boolean; readonly refreshFailed?: boolean; readonly saved?: boolean; readonly result?: readonly Fact[]; readonly revision: number }
export class RequestFailure extends Error { readonly status: number; constructor(status: number) { super('Request failed'); this.status = status; } }
export const object = (value: unknown): Record<string, unknown> => { if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid object'); return value as Record<string, unknown>; };
export const string = (value: unknown): string => { if (typeof value !== 'string' || value.length > 100_000) throw new Error('Invalid text'); return value; };
export const boolean = (value: unknown): boolean => { if (typeof value !== 'boolean') throw new Error('Invalid boolean'); return value; };
export const number = (value: unknown): number => { if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid number'); return value; };
export const array = (value: unknown): readonly unknown[] => { if (!Array.isArray(value) || value.length > 500) throw new Error('Invalid list'); return value; };
export const input = (values: Values, key: string): string => { const value = values[key]; if (typeof value !== 'string') throw new Error('Invalid form value'); return value; };
export function sameOriginPath(path: string): string { if (!path.startsWith('/api/') || path.startsWith('//') || /[\\\u0000-\u001f#]/u.test(path)||!new URL(path,'https://local.invalid').pathname.startsWith('/api/')) throw new Error('Invalid API path'); return path; }
export class PanelStore {
  private state: PanelState = { status: 'idle', auth: 'unknown', revision: 0 };
  private listeners = new Set<() => void>(); private controller?: AbortController; private disposed = false;
  readonly definition: PanelDefinition; private fetcher: typeof fetch; private signIn: () => void;
  constructor(definition: PanelDefinition, fetcher: typeof fetch, signIn: () => void) { this.definition = definition; this.fetcher = fetcher; this.signIn = signIn; }
  getSnapshot = (): PanelState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(state: PanelState): void { if (!this.disposed) { this.state = state; for (const listener of this.listeners) listener(); } }
  private async request(path: string, signal: AbortSignal, options: RequestOptions = {}): Promise<unknown> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (options.json !== undefined) headers['content-type'] = 'application/json';
    if (options.binary) headers['content-type'] = options.binary.type || 'application/octet-stream';
    const response = await this.fetcher(sameOriginPath(path), { method: options.method ?? 'GET', credentials: 'same-origin', cache: 'no-store', signal, headers,
      ...(options.binary ? { body: options.binary } : options.json !== undefined ? { body: JSON.stringify(options.json) } : {}) });
    if (!response.ok) throw new RequestFailure(response.status);
    const body = await response.text(); if (body.length > 1_000_000) throw new Error('Response too large');
    return body ? JSON.parse(body) as unknown : null;
  }
  private async load(controller: AbortController): Promise<{ auth: PanelState['auth']; data?: unknown }> {
    let auth: PanelState['auth'] = 'unknown';
    if (this.definition.access === 'account' || this.definition.checkSession) {
      try {
        const session = await this.request('/api/auth/get-session', controller.signal);
        if (session === null) auth = 'guest';
        else { const user = object(object(session).user); if (!string(user.id)) throw new Error('Invalid session'); auth = 'signed-in'; }
      } catch (error) { if (error instanceof RequestFailure && error.status === 401) auth = 'guest'; else throw error; }
    }
    if (this.definition.access === 'account' && auth !== 'signed-in') return { auth };
    const data = await this.definition.load({ authenticated: auth === 'signed-in', request: (path, options) => this.request(path, controller.signal, options) });
    return { auth, data };
  }
  ensure = (): void => { if (this.state.status === 'idle') void this.reload(); };
  reload = async (): Promise<void> => {
    if (this.disposed || this.state.status === 'loading' || this.state.busy) return;
    const controller = new AbortController(); this.controller = controller;
    this.publish({ status: 'loading', auth: 'unknown', revision: this.state.revision });
    try { const next = await this.load(controller); if (!controller.signal.aborted) this.publish({ status: 'ready', ...next, revision: this.state.revision + 1 }); }
    catch (error) { if (!controller.signal.aborted) this.failLoad(error); }
    finally { if (this.controller === controller) this.controller = undefined; }
  };
  private failLoad(error: unknown): void {
    const unauthorized = error instanceof RequestFailure && error.status === 401;
    this.publish({ status: unauthorized ? 'ready' : error instanceof RequestFailure && error.status === 403 ? 'denied' : 'error', auth: unauthorized ? 'guest' : 'unknown', revision: this.state.revision + 1 });
  }
  run = async (id: string, values: Values): Promise<void> => {
    if (this.disposed || this.state.busy || this.state.status !== 'ready' || this.state.data === undefined) return;
    const view = this.definition.view(this.state.data, key => key);
    const actions = [...this.definition.actions?.(this.state.data) ?? [], ...view.rows?.flatMap(row => row.actions ?? []) ?? []];
    const action = actions.find(value => value.id === id); if (!action || action.disabled || view.available === false) return;
    if (action.needsAuth && this.state.auth !== 'signed-in') { this.signIn(); return; }
    const controller = new AbortController(); this.controller = controller;
    this.publish({ ...this.state, busy: id, failed: false, saved: false, result: undefined });
    try {
      const binary = action.binary?.(values);
      const response = await this.request(action.path(values, this.state.data), controller.signal, { method: action.method ?? 'POST', ...(binary ? { binary } : { json: action.body?.(values, this.state.data) }) });
      const value = action.parse ? action.parse(response) : response;
      const result = action.result?.(value);
      if (controller.signal.aborted) return;
      // A one-time API key must remain copyable even if the subsequent list refresh fails.
      this.publish({...this.state,result,saved:true,failed:false});
      try {
        const next = action.replace ? { auth: this.state.auth, data: action.replace(this.state.data, value, values) } : await this.load(controller);
        if (!controller.signal.aborted) this.publish({ status: 'ready', ...next, saved: true, result, revision: this.state.revision + 1 });
      } catch (error) {
        if(error instanceof RequestFailure&&[401,403].includes(error.status))throw error;
        if(!controller.signal.aborted)this.publish({...this.state,busy:undefined,result,saved:true,refreshFailed:true,revision:this.state.revision+1});
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        if (error instanceof RequestFailure && [401, 403].includes(error.status)) { this.failLoad(error); if (error.status === 401) this.signIn(); }
        else this.publish({ ...this.state, busy: undefined, failed: true, result: undefined });
      }
    } finally { if (this.controller === controller) this.controller = undefined; }
  };
  clearResult = (): void => { this.publish({ ...this.state, result: undefined, saved: false }); };
  leave = (): void => { this.controller?.abort(); this.controller=undefined; this.publish({status:'idle',auth:'unknown',revision:this.state.revision+1}); };
  dispose(): void { this.disposed = true; this.controller?.abort(); this.listeners.clear(); this.state = { status: 'idle', auth: 'unknown', revision: 0 }; }
}
