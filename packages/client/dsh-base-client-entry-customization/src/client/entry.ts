/** Local Loader contract around the pinned official browser implementation. */
import { z } from 'zod'
export * from './index.ts'
export const name = '@dsh-base/client-entry-customization'
export const Config = z.object({}).default({})
