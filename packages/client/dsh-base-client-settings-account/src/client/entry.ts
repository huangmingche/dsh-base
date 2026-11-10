/** Pinned official account plugin with an optional unavailable presentation. */
import { z } from 'zod'
export * from './index.ts'
export { AccountSection } from './AccountSection.tsx'
export const name = '@dsh-base/client-settings-account'
export const Config = z.object({}).default({})
