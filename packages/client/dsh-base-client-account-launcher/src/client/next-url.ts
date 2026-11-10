/** Shared local login route used by the account menu and unavailable workspace state. */
export { navigationLoginHref as buildLoginHref } from '../../../dsh-base-client-session-adapter/src/client/navigation-access.ts'

/** The parts of the current location that survive the login round trip. */
export interface CurrentLocation {
  readonly pathname: string
  readonly search: string
  readonly hash: string
}
