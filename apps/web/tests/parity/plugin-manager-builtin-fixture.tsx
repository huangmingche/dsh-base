/** Original exported forms versus the mounted unavailable-card adapters. */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ShellCard } from '@deepseek-ai/dsh-client-ui-settings-shell/src/client/ShellCard.tsx';
import { AgentLoopCard } from '@deepseek-ai/dsh-client-ui-settings-agent-loop/src/client/AgentLoopCard.tsx';
import { WebSearchCard } from '@deepseek-ai/dsh-client-ui-settings-web-search/src/client/WebSearchCard.tsx';
import * as webSearchPlugin from '@deepseek-ai/dsh-client-ui-settings-web-search/client';
import { Context } from '@deepseek-ai/cordis';
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client';
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client';
import { SubagentCard } from '@deepseek-ai/dsh-client-ui-settings-subagent/src/client/SubagentCard.tsx';
import * as shellCopy from '@deepseek-ai/dsh-client-ui-settings-shell/src/client/locales.ts';
import * as loopCopy from '@deepseek-ai/dsh-client-ui-settings-agent-loop/src/client/locales.ts';
import * as searchCopy from '@deepseek-ai/dsh-client-ui-settings-web-search/src/client/locales.ts';
import * as subagentCopy from '@deepseek-ai/dsh-client-ui-settings-subagent/src/client/locales.ts';
import {
  createUnavailableBuiltinFaces, UnavailableShellCard, UnavailableAgentLoopCard,
  UnavailableWebSearchCard, UnavailableSubagentCard,
} from '../../../../packages/client/dsh-base-client-plugin-management/src/client/builtin-availability.tsx';
import { builtinAvailability } from '../../../../packages/client/dsh-base-client-plugin-management/src/client/builtin-copy.ts';

const cards = {
  shell: { original: ShellCard, adapted: UnavailableShellCard, copy: shellCopy },
  'agent-loop': { original: AgentLoopCard, adapted: UnavailableAgentLoopCard, copy: loopCopy },
  'web-search': { original: WebSearchCard, adapted: UnavailableWebSearchCard, copy: searchCopy },
  subagent: { original: SubagentCard, adapted: UnavailableSubagentCard, copy: subagentCopy },
};
// Reference Host for the official provider-selection UI. No provider, credential or save leaves the fixture.
function servedWebSearch(locale: 'en' | 'zh') {
  const snapshot = { status: 'ready' as const, value: {}, base: {}, user: {}, revision: 1, writable: true };
  const scope = { getSnapshot: () => snapshot, subscribe: () => () => {}, mutate: async () => false };
  const ctx = new Context();
  new SlotRegistry(ctx);
  ctx.slots.register({ name: 'root', children: { 'plugins.item': { kind: 'list', scope: 'root' } } } as never, (() => null) as never);
  ctx.provide('configForms', { get: () => scope, whileServed: (_: string[], mount: () => () => void) => mount() } as never);
  const locales = new LocaleRuntime(ctx);
  locales.setLocale(locale);
  ctx.provide('locale', locales);
  const remote = {
    $on: () => () => {},
    web: { listProviders: async () => ({ ok: true, value: { search: [{ id: 'deepseek-official' }], fetch: [] } }) },
    credentials: { describe: async () => ({ ok: true, value: {} }) },
  };
  ctx.provide('remote', remote as never);
  ctx.provide('remote.web', remote.web as never);
  ctx.provide('remote.credentials', remote.credentials as never);
  const fiber = ctx.plugin(webSearchPlugin);
  const slots = ctx.slots;
  return { fiber, ctx, entry: () => slots.entriesOfSlot('plugins.item').find(item => item.options.id === 'web-search') };
}
export function PluginManagerBuiltinFixture({ id, locale, adapted, served = false }: { id: keyof typeof cards; locale: 'en' | 'zh'; adapted: boolean; served?: boolean }) {
  const faces = useMemo(() => createUnavailableBuiltinFaces(), []);
  const referenceSearch = useMemo(() => served ? servedWebSearch(locale) : undefined, [served, locale]);
  const [ready, setReady] = useState(false);
  useEffect(() => () => { for (const item of Object.values(faces)) item.dispose(); }, [faces]);
  useEffect(() => {
    if (!referenceSearch) return;
    let mounted = true;
    void referenceSearch.fiber.await().then(() => { if (mounted) setReady(true); });
    return () => { mounted = false; void referenceSearch.ctx.fiber.dispose(); };
  }, [referenceSearch]);
  if (referenceSearch && !ready) return null;
  const entry = referenceSearch?.entry();
  if (referenceSearch && !entry?.inject) throw new Error('The official web search plugin did not register its settings card');
  const face = (entry?.inject?.() ?? faces[id].face) as any;
  const definition = cards[id];
  const Component = (entry?.component ?? (adapted ? definition.adapted : definition.original)) as any;
  const props: any = {
    ...face, view: 'page', availability: () => builtinAvailability(id, locale),
    t: (key: string, values: Record<string, unknown> = {}) => String((definition.copy[locale] as any)[key] ?? key).replace(/\{([^}]+)\}/g, (_, name) => String(values[name] ?? '')),
  };
  for (const [name, source] of Object.entries(face.hooks) as any) {
    props[`use${name[0].toUpperCase()}${name.slice(1)}`] = (select: any) => select(useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot));
  }
  (window as any).__BUILTIN_PARITY__ = { id, snapshots: () => Object.fromEntries(Object.entries(face.hooks).map(([name, source]: any) => [name, source.getSnapshot()])) };
  if (referenceSearch) (window as any).__BUILTIN_PARITY__.registered = () => !!referenceSearch.entry();
  return <div style={{ padding: 32, maxWidth: 960, margin: 'auto' }} data-builtin-contract><Component {...props} /></div>;
}
