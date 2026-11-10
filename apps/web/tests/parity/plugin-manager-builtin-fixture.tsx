/** Original exported forms versus the mounted unavailable-card adapters. */
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { ShellCard } from '@deepseek-ai/dsh-client-ui-settings-shell/src/client/ShellCard.tsx';
import { AgentLoopCard } from '@deepseek-ai/dsh-client-ui-settings-agent-loop/src/client/AgentLoopCard.tsx';
import { WebSearchCard } from '@deepseek-ai/dsh-client-ui-settings-web-search/src/client/WebSearchCard.tsx';
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
export function PluginManagerBuiltinFixture({ id, locale, adapted }: { id: keyof typeof cards; locale: 'en' | 'zh'; adapted: boolean }) {
  const faces = useMemo(() => createUnavailableBuiltinFaces(), []);
  useEffect(() => () => { for (const item of Object.values(faces)) item.dispose(); }, [faces]);
  const face = faces[id].face as any;
  const definition = cards[id];
  const Component = (adapted ? definition.adapted : definition.original) as any;
  const props: any = {
    ...face, view: 'page', availability: () => builtinAvailability(id, locale),
    t: (key: string, values: Record<string, unknown> = {}) => String((definition.copy[locale] as any)[key] ?? key).replace(/\{([^}]+)\}/g, (_, name) => String(values[name] ?? '')),
  };
  for (const [name, source] of Object.entries(face.hooks) as any) {
    props[`use${name[0].toUpperCase()}${name.slice(1)}`] = (select: any) => select(useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot));
  }
  (window as any).__BUILTIN_PARITY__ = { id, snapshots: () => Object.fromEntries(Object.entries(face.hooks).map(([name, source]: any) => [name, source.getSnapshot()])) };
  return <div style={{ padding: 32, maxWidth: 960, margin: 'auto' }} data-builtin-contract><Component {...props} /></div>;
}
