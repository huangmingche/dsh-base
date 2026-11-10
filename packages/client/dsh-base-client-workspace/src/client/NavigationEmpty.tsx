/** Keep official empty-state styling for pending or failed account checks. */
import { IconQueueOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { NavigationAvailability } from '@dsh-base/client-session-adapter/navigation-access'
import css from './rows/WorkspaceBrowser.module.css'

export function NavigationEmpty({ availability }: {
  availability: NavigationAvailability
}) {
  // Anonymous visitors request login from actions, not a second sidebar prompt.
  if (availability.state === 'anonymous') return null
  return (
    <div className={css.emptyState} data-row-key="empty" data-workspace-access={availability.state}>
      <IconQueueOutlineRegular size={24} />
      <div>{availability.emptyLabel}</div>
    </div>
  )
}
