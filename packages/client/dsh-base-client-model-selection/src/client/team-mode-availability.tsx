/** Read-only model-menu fallback when the Host cannot run Agent Teams. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-team/types'
import type { SessionProjectionMap } from '@deepseek-ai/dsh-api-session-controller/client'
import { TeamModeToggle, type TeamModeToggleProps } from '@deepseek-ai/dsh-client-ui-agent-team/src/client/TeamModeToggle.tsx'
import type {} from '@deepseek-ai/dsh-client-ui-agent-team/client'

const reasons = {
  en: 'Agent Teams are unavailable on this deployment.',
  zh: '当前部署不支持智能体团队。',
  ja: 'この環境ではエージェントチームを利用できません。',
  es: 'Los equipos de agentes no están disponibles en este entorno.',
  fr: 'Les équipes d’agents ne sont pas disponibles dans cet environnement.',
  de: 'Agententeams sind in dieser Umgebung nicht verfügbar.',
  ru: 'Команды агентов недоступны в этом окружении.',
  pt: 'As equipes de agentes não estão disponíveis neste ambiente.',
}

type ProjectionKey = Extract<keyof SessionProjectionMap, string>
const unavailable: Partial<SessionProjectionMap> = { agentTeam: { enabled: false, tasks: [] } }
type AvailabilityProps = Omit<TeamModeToggleProps, 'selectTeamMode' | 'requestDisableConfirmation'> & {
  unavailableReason(): string
}

function UnavailableTeamMode(props: AvailabilityProps) {
  // Supply the disabled display value only to this control. The Session's real
  // projections (including its model and subagent identity) remain authoritative.
  function useDisplayProjection<K extends ProjectionKey>(key: K): SessionProjectionMap[K] | undefined
  function useDisplayProjection<K extends ProjectionKey, S>(key: K, select: (value: SessionProjectionMap[K] | undefined) => S): S
  function useDisplayProjection<K extends ProjectionKey, S>(key: K, select?: (value: SessionProjectionMap[K] | undefined) => S) {
    const value = props.useProjection(key) ?? unavailable[key]
    return select ? select(value) : value
  }
  return <TeamModeToggle {...props} locked useProjection={useDisplayProjection}
    t={(key, params) => key === 'mode.description' ? `${props.t(key, params)} ${props.unavailableReason()}` : props.t(key, params)}
    selectTeamMode={async () => props.unavailableReason()}
    requestDisableConfirmation={() => props.reportFailure(props.unavailableReason())} />
}

export function registerTeamModeAvailability(ctx: Context): void {
  ctx.slots.inject('conversation.input.model.options', () => ctx.slots.register({
    name: 'conversation.input.model.options', id: 'agent-team', locale: 'agent-team',
    // Same cell as the official priority-0 control. A capable Host wins
    // automatically when its real remote.agentTeams service activates.
    priority: 1,
    inject: () => ({ unavailableReason: () => {
      const locale = ctx.locale.getSnapshot().active as keyof typeof reasons
      return reasons[locale] ?? reasons.en
    } }),
  }, UnavailableTeamMode))
}
