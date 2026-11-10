/** Durable Object state for runtime plugin management (enable/config overrides). */
import { GATEWAY_BUNDLE_MEMBERS, isGatewayModule, isManageableModule, normalizeOwnerPluginOverrides, validatePluginConfig } from '../../../boot/dsh-base-plugin-management/src/index.ts'
import { resolveFetchAllowlist } from '../../../boot/dsh-base-plugin-management/src/fetch-policy.ts'

interface Override {
  disabled?: boolean
  config?: Record<string, unknown>
}

interface ControlState {
  revision: number
  overrides: Record<string, Override>
  sessions?: Record<string, Record<string, Override>>
}

const EMPTY: ControlState = { revision: 0, overrides: {} }

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'cache-control': 'no-store' } })
}

function validJsonConfig(value: unknown, depth = 0): string | undefined {
  if (depth > 16) return 'plugin-manager/config-too-deep'
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return undefined
  if (typeof value === 'number') return Number.isFinite(value) ? undefined : 'plugin-manager/config-invalid'
  if (Array.isArray(value)) {
    for (const item of value) { const failure = validJsonConfig(item, depth + 1); if (failure !== undefined) return failure }
    return undefined
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (/api.?key|secret|token|password|module|expression|^https?:/iu.test(key)) return 'plugin-manager/config-sensitive'
      const failure = validJsonConfig(item, depth + 1); if (failure !== undefined) return failure
    }
    return undefined
  }
  return 'plugin-manager/config-invalid'
}

function error(code: string, message: string, status: number): Response {
  return json({ error: { code, message, details: {} } }, status)
}

/** Persist plugin-control overrides used by the client boot composition. */
export class PluginControl {
  private readonly state: DurableObjectState
  private readonly env: { readonly FETCH_ALLOWLIST?: string }
  constructor(state: DurableObjectState, env: { readonly FETCH_ALLOWLIST?: string } = {}) { this.state = state; this.env = env }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname !== '/api/plugin-control' && url.pathname !== '/api/plugin-manager') return json({ error: 'not_found' }, 404)
    if (request.method === 'GET') {
      const state = (await this.state.storage.get<ControlState>('control')) ?? EMPTY
      const sessionId = url.searchParams.get('sessionId')
      const projected = url.pathname === '/api/plugin-manager' ? { ...state, overrides: normalizeOwnerPluginOverrides(state.overrides) } : state
      return json(sessionId === null ? projected : { ...projected, session: state.sessions?.[sessionId] ?? {} })
    }
    if (request.method !== 'PUT' && request.method !== 'PATCH') {
      return json({ error: 'method_not_allowed' }, 405)
    }
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return json({ error: 'invalid_json' }, 400)
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return json({ error: 'invalid_body' }, 400)
    }
    const sessionId = (body as { sessionId?: unknown }).sessionId
    if (sessionId !== undefined && (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > 200)) return json({ error: 'invalid_session' }, 400)
    const name = (body as { name?: unknown }).name
    if (typeof name !== 'string' || name.length === 0 || name.length > 200) {
      return json({ error: 'invalid_name' }, 400)
    }
    // Owner-facing management is restricted to the deployment allowlist. The
    // admin-only /api/plugin-control path keeps its broader deployment scope.
    if (url.pathname === '/api/plugin-manager' && !isManageableModule(name)) {
      return error('plugin-manager/not-manageable', 'This plugin is not in the deployment-managed allowlist.', 403)
    }
    const reset = (body as { reset?: unknown }).reset
    if (reset !== undefined && reset !== true) return json({ error: 'invalid_reset' }, 400)
    const disabled = (body as { disabled?: unknown }).disabled
    const config = (body as { config?: unknown }).config
    const expectedRevision = (body as { expectedRevision?: unknown }).expectedRevision
    if (disabled !== undefined && typeof disabled !== 'boolean') return json({ error: 'invalid_disabled' }, 400)
    if (config !== undefined) {
      if (typeof config !== 'object' || config === null || Array.isArray(config)) return json({ error: 'invalid_config' }, 400)
      const invalid = validJsonConfig(config) ?? (url.pathname === '/api/plugin-manager' ? validatePluginConfig(name, config) : undefined)
      if (invalid !== undefined) return error(invalid, 'Plugin configuration is not accepted by this deployment.', 400)
      if (JSON.stringify(config).length > 4096) return error('plugin-manager/config-too-large', 'Plugin configuration is too large.', 400)
      if (url.pathname === '/api/plugin-manager' && name === '@dsh-base/cloudflare-think-fetch') {
        try { resolveFetchAllowlist(this.env.FETCH_ALLOWLIST, config) }
        catch { return error('plugin-manager/config-invalid', 'Fetch allowlist must stay within the deployment policy.', 400) }
      }
    }
    if (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 0)) {
      return json({ error: 'invalid_revision' }, 400)
    }
    // Compare-and-set and all bundle members share one transaction. Concurrent
    // tabs cannot both win the same revision or persist half of a bundle.
    return this.state.storage.transaction(async storage => {
      const current = (await storage.get<ControlState>('control')) ?? EMPTY
      if (expectedRevision !== undefined && expectedRevision !== current.revision) {
        return json({ error: { code: 'plugin-manager/stale-revision', message: 'Plugin settings changed in another tab.', details: { expectedRevision, revision: current.revision } } }, 409)
      }
      const manager = url.pathname === '/api/plugin-manager'
      const targets = manager && sessionId === undefined && isGatewayModule(name) && (disabled !== undefined || reset === true)
        ? GATEWAY_BUNDLE_MEMBERS : [name]
      const sessions = { ...(current.sessions ?? {}) }
      const overrides = { ...(sessionId === undefined ? current.overrides : sessions[sessionId] ?? {}) }
      for (const target of targets) {
        // Preserve scope-local fields without copying inherited defaults. Only
        // the named member receives a config patch; toggles/resets are grouped.
        const next: Override = { ...overrides[target] }
        if (disabled !== undefined) next.disabled = disabled
        if (config !== undefined && target === name) next.config = config as Record<string, unknown>
        if (reset === true) delete overrides[target]
        else overrides[target] = next
      }
      if (sessionId !== undefined) {
        if (Object.keys(overrides).length === 0) delete sessions[sessionId]
        else sessions[sessionId] = overrides
      }
      const state: ControlState = { revision: current.revision + 1, overrides: sessionId === undefined ? overrides : current.overrides, sessions }
      await storage.put('control', state)
      return json(manager ? { ...state, overrides: normalizeOwnerPluginOverrides(state.overrides) } : state)
    })
  }
}
