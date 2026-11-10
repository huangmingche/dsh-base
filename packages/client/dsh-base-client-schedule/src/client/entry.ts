/** Pinned official Schedule plugin with an optional Host creation gate. */
import { z } from 'zod'
export * from './index.ts'
export const name = '@dsh-base/client-schedule'
export const Config = z.object({}).default({})
