/** Local Loader contract around the pinned official workspace implementation. */
import { z } from 'zod'
export * from './index.ts'
export const name = '@dsh-base/client-workspace'
export const Config = z.object({}).default({})
