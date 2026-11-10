/** Draft and compare-and-swap state for the site document; independent of React. */
import { validateSiteSettingsValues, type SiteSettingsSnapshot, type SiteSettingsValues } from '@dsh-base/site-config/settings';

type Draft = Record<string, unknown>;
export type SettingsFailure = 'load' | 'save' | 'conflict' | 'forbidden' | 'invalid';
export interface GlobalSettingsState {
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly baseline?: SiteSettingsSnapshot;
  readonly draft?: Draft;
  readonly dirty: boolean;
  readonly saving: boolean;
  readonly saved: boolean;
  readonly failure?: SettingsFailure;
  readonly issues: readonly string[];
}
const clone = <T>(value: T): T => structuredClone(value);
export function readDraft(draft: Draft | undefined, path: readonly string[]): unknown {
  let value: unknown = draft;
  for (const key of path) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
    value = (value as Draft)[key];
  }
  return value;
}
function writeDraft(draft: Draft, path: readonly string[], value: unknown): Draft {
  if (path.length === 0 || path.some(key => ['__proto__', 'prototype', 'constructor'].includes(key))) throw new Error('Invalid settings path');
  const result = clone(draft);
  let target = result;
  for (const key of path.slice(0, -1)) {
    const old = target[key];
    target[key] = old !== null && typeof old === 'object' && !Array.isArray(old) ? old : {};
    target = target[key] as Draft;
  }
  const key = path.at(-1)!;
  if (value === undefined) delete target[key]; else target[key] = clone(value);
  return result;
}
function snapshotFrom(value: unknown): SiteSettingsSnapshot | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (!Number.isSafeInteger(raw.revision) || Number(raw.revision) < 0 || typeof raw.canEdit !== 'boolean' || !['deployment', 'saved'].includes(String(raw.source))) return undefined;
  const publicPagePaths = Array.isArray(raw.publicPagePaths) && raw.publicPagePaths.every(path => typeof path === 'string') ? raw.publicPagePaths as string[] : undefined;
  // A withdrawn page can retain saved metadata. Keep it visible so an
  // administrator can remove it; only new writes require active page paths.
  const validated = validateSiteSettingsValues(raw.values, null);
  return validated.ok ? { revision: Number(raw.revision), values: validated.value, canEdit: raw.canEdit, source: raw.source as SiteSettingsSnapshot['source'], ...(publicPagePaths ? { publicPagePaths } : {}) } : undefined;
}
export class GlobalSettingsStore {
  private state: GlobalSettingsState = { status: 'idle', dirty: false, saving: false, saved: false, issues: [] };
  private listeners = new Set<() => void>();
  private sequence = 0;
  private disposed = false;
  private readonly fetcher: typeof fetch;
  private readonly onSaved: (value: SiteSettingsValues) => void | Promise<unknown>;
  constructor(fetcher: typeof fetch = fetch, onSaved: (value: SiteSettingsValues) => void | Promise<unknown> = () => {}) { this.fetcher = (input, init) => fetcher.call(globalThis, input, init); this.onSaved = onSaved; }
  getSnapshot = (): GlobalSettingsState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(state: GlobalSettingsState): void { if (this.disposed) return; this.state = state; for (const listener of this.listeners) listener(); }
  ensure = (): void => { if (this.state.status === 'idle') void this.reload(); };
  reload = async (): Promise<boolean> => {
    if (this.disposed || this.state.saving || this.state.status === 'loading') return false;
    const sequence = ++this.sequence;
    this.publish({ ...this.state, status: 'loading', saved: false, failure: undefined });
    try {
      const response = await this.fetcher('/api/site-settings', { headers: { accept: 'application/json' }, credentials: 'same-origin', cache: 'no-store' });
      const next = response.ok ? snapshotFrom(await response.json()) : undefined;
      if (!next) throw new Error('Site settings could not be loaded');
      if (this.disposed || sequence !== this.sequence) return false;
      this.publish({ status: 'ready', baseline: next, draft: clone(next.values) as unknown as Draft, dirty: false, saving: false, saved: false, issues: [] });
      return true;
    } catch {
      if (sequence === this.sequence) this.publish({ ...this.state, status: 'error', failure: 'load' });
      return false;
    }
  };
  edit = (path: readonly string[], value: unknown): void => {
    if (this.disposed || !this.state.baseline?.canEdit || !this.state.draft || this.state.saving || this.state.status === 'loading') return;
    // An optional Analytics document starts disabled, including when an ID is filled in first.
    let base = path.join('.') === 'analytics.google.measurementId' && readDraft(this.state.draft, ['analytics', 'google', 'enabled']) === undefined
      ? writeDraft(this.state.draft, ['analytics', 'google', 'enabled'], false) : this.state.draft;
    if (path.join('.') === 'analytics.conversions.campaigns' && readDraft(base, ['analytics', 'conversions', 'mode']) === undefined) base = writeDraft(base, ['analytics', 'conversions', 'mode'], 'off');
    const draft = writeDraft(base, path, value);
    const validation = validateSiteSettingsValues(draft, this.state.baseline.publicPagePaths);
    this.publish({ ...this.state, draft, dirty: JSON.stringify(draft) !== JSON.stringify(this.state.baseline.values), saved: false, failure: undefined, issues: validation.ok ? [] : validation.issues });
  };
  discard = (): void => {
    if (!this.state.baseline || this.state.saving) return;
    this.publish({ ...this.state, draft: clone(this.state.baseline.values) as unknown as Draft, dirty: false, saved: false, failure: undefined, issues: [] });
  };
  save = async (): Promise<boolean> => {
    const { baseline, draft, dirty, saving } = this.state;
    if (this.disposed || !baseline?.canEdit || !draft || !dirty || saving || this.state.status === 'loading') return false;
    const validated = validateSiteSettingsValues(draft, baseline.publicPagePaths);
    if (!validated.ok) { this.publish({ ...this.state, failure: 'invalid', issues: validated.issues, saved: false }); return false; }
    this.publish({ ...this.state, saving: true, saved: false, failure: undefined });
    try {
      const response = await this.fetcher('/api/site-settings', { method: 'PUT', headers: { 'content-type': 'application/json', accept: 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ expectedRevision: baseline.revision, values: validated.value }) });
      const body: unknown = await response.json().catch(() => undefined);
      if (!response.ok) {
        const raw = body !== null && typeof body === 'object' ? body as { issues?: unknown } : undefined;
        const issues = Array.isArray(raw?.issues) ? raw.issues.filter((item): item is string => typeof item === 'string') : [];
        this.publish({ ...this.state, saving: false, saved: false, failure: response.status === 409 ? 'conflict' : response.status === 403 || response.status === 401 ? 'forbidden' : 'save', issues,
          ...(response.status === 403 || response.status === 401 ? { baseline: { ...baseline, canEdit: false } } : {}) });
        return false;
      }
      const next = snapshotFrom(body);
      if (!next) throw new Error('Invalid save response');
      this.publish({ status: 'ready', baseline: next, draft: clone(next.values) as unknown as Draft, dirty: false, saving: false, saved: true, issues: [] });
      await Promise.resolve(this.onSaved(next.values)).catch(() => {});
      return true;
    } catch {
      this.publish({ ...this.state, saving: false, saved: false, failure: 'save' });
      return false;
    }
  };
  dispose(): void { this.disposed = true; this.sequence++; this.listeners.clear(); }
}
