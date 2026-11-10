/** Mount the real optional count plugin in an actual official slot registry. */
import React from 'react';
import { Context } from '@deepseek-ai/cordis';
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client';
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store';
import { configLedgerSource, rowConfigKey } from '@deepseek-ai/dsh-client-ui-plugin-manager/src/client/config-ledger.ts';
import * as subagent from '@deepseek-ai/dsh-client-ui-settings-subagent/src/client/locales.ts';
import * as search from '@deepseek-ai/dsh-client-ui-settings-web-search/src/client/locales.ts';
import * as loop from '@deepseek-ai/dsh-client-ui-settings-agent-loop/src/client/locales.ts';
import * as shell from '@deepseek-ai/dsh-client-ui-settings-shell/src/client/locales.ts';
import { apply as applyCounts } from '../../../../packages/client/dsh-base-client-plugin-counts/src/client/index.ts';

export function createCountsFixture(locale: 'en' | 'zh', mounted: boolean, navigation = false) {
  // Long fixture content makes row/item navigation observable rather than relying on browser scroll clamping.
  const navigationForm = () => <div data-navigation-form>{Array.from({ length: 24 }, (_, index) => <p key={index}><label>Fixture setting {index + 1} <input defaultValue={String(index + 1)} /></label></p>)}</div>;
  const ctx = new Context();
  const dictionaries = new Map<string, Record<string, Record<string, string>>>();
  const localeStore = createSnapshotStore({ active: locale, revision: 1 });
  const bind = (namespace: string) => (key: string, values: Record<string, unknown> = {}) =>
    String(dictionaries.get(namespace)?.[locale]?.[key] ?? key).replace(/\{([^}]+)\}/g, (_, key) => String(values[key] ?? ''));
  ctx.provide('locale', { ...localeStore, bind, register: (namespace: string, dictionary: any) => {
    dictionaries.set(namespace, dictionary); return () => dictionaries.delete(namespace);
  } } as never);
  new SlotRegistry(ctx);
  const slots = ctx.get('slots')!;
  slots.register({ name: 'root', children: {
    'plugins.item': { kind: 'list', scope: 'root' },
    'plugins.bundle.config': { kind: 'keyed', scope: 'root' },
    'plugins.row.config': { kind: 'keyed', scope: 'root' },
    'dsh-base.plugins.group.summary': { kind: 'single', scope: 'root', inline: true },
  } } as never, (() => null) as never);
  const items = [
    ['subagent', subagent[locale].subagentTitle, subagent[locale].subagentDescription],
    ['web-search', search[locale].title, search[locale].description],
    ['agent-loop', loop[locale].title, loop[locale].description],
    ['shell', shell[locale].title, shell[locale].description],
  ];
  for (const [order, [id, title, description]] of items.entries()) {
    slots.register({ name: 'plugins.item', id, order, label: () => title } as never,
      (({ view }: { view: string }) => view === 'summary' ? description : navigation ? navigationForm() : null) as never);
  }
  if (navigation) slots.register({ name: 'plugins.row.config', key: rowConfigKey('dsh-base:ai-chat-core', 'client:session-adapter') } as never,
    (({ view }: { view: string }) => view === 'summary' ? 'Navigation fixture configuration' : navigationForm()) as never);
  if (mounted) applyCounts(ctx);
  return {
    config: configLedgerSource(ctx),
    registrationCount: () => slots.entriesOfSlot('dsh-base.plugins.group.summary').length,
    renderSlot: (name: string, owner: any, options: any) => {
      const entry = slots.entriesOfSlot(name as never).find(entry => (options?.only === undefined || entry.options.id === options.only) && (options?.entryKey === undefined || entry.options.key === options.entryKey));
      if (!entry) return options?.fallback ?? null;
      const Component = entry.component as React.ComponentType<any>;
      return <Component {...entry.inject?.() as any} {...owner} t={bind(entry.locale ?? '')} />;
    },
  };
}
