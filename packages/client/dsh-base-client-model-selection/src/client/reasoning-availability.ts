/** Deployment capability metadata extends the official reasoning inventory. */
import type {} from '@deepseek-ai/dsh-typert-protocol'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** Workers advertises this official surface but has no runtime implementation. */
    'gateway/endpoint-unavailable': { readonly capability?: string; readonly provider?: string; readonly model?: string }
  }
}

export function reasoningUnavailable(reasoning: unknown): boolean {
  return reasoning !== null && typeof reasoning === 'object'
    && (reasoning as { unavailable?: boolean }).unavailable === true
}

export function reasoningUnavailableReason(reasoning: unknown): string | undefined {
  if (!reasoningUnavailable(reasoning)) return undefined
  const reason = (reasoning as { unavailableReason?: unknown }).unavailableReason
  return typeof reason === 'string' ? reason : undefined
}
