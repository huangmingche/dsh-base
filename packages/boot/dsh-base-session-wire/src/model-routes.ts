/** Provider/model route identities shared by Host projections and plugins. */

/** Stable independent Cloudflare AI Gateway provider id. */
export const GATEWAY_PROVIDER_ID = 'cloudflare-ai-gateway'
/** Explicit provider prefix for new Gateway selections. */
export const GATEWAY_MODEL_PREFIX = `${GATEWAY_PROVIDER_ID}/`
/** Provider id of the existing official DeepSeek implementation. */
export const DEEPSEEK_PROVIDER_ID = 'deepseek-official'
/** Explicit prefix for new DeepSeek selections; bare ids remain legacy-compatible. */
export const DEEPSEEK_MODEL_PREFIX = `${DEEPSEEK_PROVIDER_ID}/`
/** Marker for old selections with no frozen provider identity. */
export const LEGACY_PROVIDER_ID = 'legacy'

export function gatewayModelId(model: string): string { return `${GATEWAY_MODEL_PREFIX}${model}` }
export function deepseekModelId(model: string): string { return `${DEEPSEEK_MODEL_PREFIX}${model}` }
export function isGatewayModelId(model: string): boolean { return model.startsWith(GATEWAY_MODEL_PREFIX) }
export function isDeepSeekModelId(model: string): boolean { return model.startsWith(DEEPSEEK_MODEL_PREFIX) }
export function isExplicitModelId(model: string): boolean { return isGatewayModelId(model) || isDeepSeekModelId(model) }
export function bareModelId(model: string): string {
  if (isGatewayModelId(model)) return model.slice(GATEWAY_MODEL_PREFIX.length)
  if (isDeepSeekModelId(model)) return model.slice(DEEPSEEK_MODEL_PREFIX.length)
  return model
}
export function providerForModelId(model: string): string {
  if (isGatewayModelId(model)) return GATEWAY_PROVIDER_ID
  if (isDeepSeekModelId(model)) return DEEPSEEK_PROVIDER_ID
  return LEGACY_PROVIDER_ID
}
