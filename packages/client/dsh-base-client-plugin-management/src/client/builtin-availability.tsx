/** Retain absent official configuration cards without claiming their Host namespaces exist. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { Tag, type SettingsFormScope } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactNode } from 'react'
import { ShellCard, type ShellCardProps } from '@deepseek-ai/dsh-client-ui-settings-shell/src/client/ShellCard.tsx'
import { ShellCardController } from '@deepseek-ai/dsh-client-ui-settings-shell/src/client/shell-card-controller.ts'
import { AgentLoopCard, type AgentLoopCardProps } from '@deepseek-ai/dsh-client-ui-settings-agent-loop/src/client/AgentLoopCard.tsx'
import { AgentLoopCardController } from '@deepseek-ai/dsh-client-ui-settings-agent-loop/src/client/agent-loop-card-controller.ts'
import { WebSearchCard, type WebSearchCardProps } from '@deepseek-ai/dsh-client-ui-settings-web-search/src/client/WebSearchCard.tsx'
import { WebSearchCardController } from '@deepseek-ai/dsh-client-ui-settings-web-search/src/client/web-search-card-controller.ts'
import { SubagentCard, type SubagentCardProps } from '@deepseek-ai/dsh-client-ui-settings-subagent/src/client/SubagentCard.tsx'
import { SubagentLimitsCardController } from '@deepseek-ai/dsh-client-ui-settings-subagent/src/client/subagent-limits-card-controller.ts'
import { SubagentModelSelectionCardController } from '@deepseek-ai/dsh-client-ui-settings-subagent/src/client/subagent-model-selection-card-controller.ts'
import { subagentCardFace } from '@deepseek-ai/dsh-client-ui-settings-subagent/src/client/subagent-card-controller.ts'
import { BUILTIN_ITEMS, builtinAvailability } from './builtin-copy.ts'

interface AvailabilityProps { availability: () => { label: string; reason: string } }
function Availability({ view, availability: read, children }: AvailabilityProps & { view: 'summary' | 'page'; children: ReactNode }) {
  const availability = read()
  return <>{children}{view === 'summary'
    ? <> <span title={availability.reason} data-builtin-unavailable><Tag tone="neutral">{availability.label}</Tag></span></>
    : <p role="status" data-builtin-unavailable>{availability.reason}</p>}</>
}
export function UnavailableShellCard(props: ShellCardProps & AvailabilityProps) { return <Availability {...props}><ShellCard {...props} /></Availability> }
export function UnavailableAgentLoopCard(props: AgentLoopCardProps & AvailabilityProps) { return <Availability {...props}><AgentLoopCard {...props} /></Availability> }
export function UnavailableWebSearchCard(props: WebSearchCardProps & AvailabilityProps) { return <Availability {...props}><WebSearchCard {...props} /></Availability> }
export function UnavailableSubagentCard(props: SubagentCardProps & AvailabilityProps) { return <Availability {...props}><SubagentCard {...props} /></Availability> }

/** A truthful absent section, used only while the real describe view excludes it. */
function absentScope<T>(): SettingsFormScope<T> {
  const snapshot = { status: 'unavailable' as const, value: undefined, base: undefined, user: undefined, revision: undefined, writable: false }
  return { getSnapshot: () => snapshot, subscribe: () => () => {}, mutate: async () => false }
}

/** The unavailable page owns no credentials or model requests; attempts remain explicit failures. */
const unavailableContext = {
  remote: {
    web: { listProviders: async () => ({ ok: false, error: { code: 'gateway/endpoint-unavailable', message: 'Web providers are unavailable.' } }) },
    credentials: {
      describe: async () => ({ ok: false, error: { code: 'gateway/endpoint-unavailable', message: 'The official web search provider is unavailable.' } }),
      set: async () => ({ ok: false, error: { code: 'gateway/endpoint-unavailable', message: 'The official web search provider is unavailable.' } }),
    },
    session: { modelCatalog: async () => ({ ok: false, error: { code: 'gateway/endpoint-unavailable', message: 'Subagent model selection is unavailable.' } }) },
  },
} as unknown as Context

/** Unchanged official controllers derive their unavailable state from absent form scopes. */
export function createUnavailableBuiltinFaces() {
  const shell = new ShellCardController(absentScope())
  const loop = new AgentLoopCardController(absentScope())
  const web = new WebSearchCardController({ web: absentScope(), api: absentScope(), legacy: absentScope() }, unavailableContext)
  const limits = new SubagentLimitsCardController(absentScope())
  const models = new SubagentModelSelectionCardController(absentScope(), unavailableContext)
  return {
    shell: { face: shell.inject(), dispose: () => shell.dispose() },
    'agent-loop': { face: loop.inject(), dispose: () => loop.dispose() },
    'web-search': { face: web.inject(), dispose: () => web.dispose() },
    subagent: { face: subagentCardFace(limits.inject(), models.inject()), dispose: () => { limits.dispose(); models.dispose() } },
  }
}

/** Register only missing official entries; the real companion owns every served namespace. */
export function installUnavailableBuiltins(ctx: Context): () => void {
  return ctx.slots.inject('plugins.item', () => {
    const faces = createUnavailableBuiltinFaces()
    const active = new Map<string, () => void>()
    const describe = ctx.configForms.describe()
    const sync = () => {
      const view = describe.getSnapshot().view
      if (view === undefined) return // Unknown or failed reads do not prove absence.
      const served = new Set(view.namespaces.map(item => item.ns))
      for (const item of BUILTIN_ITEMS) {
        const missing = !item.namespaces.some(ns => served.has(ns))
        if (!missing) { active.get(item.id)?.(); active.delete(item.id); continue }
        if (active.has(item.id)) continue
        const availability = () => builtinAvailability(item.id, ctx.locale.getSnapshot().active)
        // Official slots explicitly support lower-precedence shadow entries:
        // an original registering earlier in the same publication wins before
        // this observer removes its fallback, without duplicate-id failures.
        const base = { name: 'plugins.item' as const, id: item.id, order: item.order, priority: 100 }
        let stop: () => void
        switch (item.id) {
          case 'shell': stop = ctx.slots.register({ ...base, locale: 'settings.shell', label: () => ctx.locale.bind('settings.shell')('title'), inject: () => ({ ...faces.shell.face, availability }) }, UnavailableShellCard); break
          case 'agent-loop': stop = ctx.slots.register({ ...base, locale: 'settings.agentLoop', label: () => ctx.locale.bind('settings.agentLoop')('title'), inject: () => ({ ...faces['agent-loop'].face, availability }) }, UnavailableAgentLoopCard); break
          case 'web-search': stop = ctx.slots.register({ ...base, locale: 'settings.webSearch', label: () => ctx.locale.bind('settings.webSearch')('title'), inject: () => ({ ...faces['web-search'].face, availability }) }, UnavailableWebSearchCard); break
          case 'subagent': stop = ctx.slots.register({ ...base, locale: 'settings.subagent', label: () => ctx.locale.bind('settings.subagent')('subagentTitle'), inject: () => ({ ...faces.subagent.face, availability }) }, UnavailableSubagentCard); break
        }
        active.set(item.id, stop)
      }
    }
    const unsubscribe = describe.subscribe(sync)
    sync()
    void describe.ensure()
    return () => {
      unsubscribe()
      for (const stop of active.values()) stop()
      for (const value of Object.values(faces)) value.dispose()
    }
  })
}
