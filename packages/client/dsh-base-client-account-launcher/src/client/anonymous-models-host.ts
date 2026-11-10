/** A local public declaration view, never an owner settings or credential read. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-ui-renderer/src/client/bind.ts'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelsSectionController, ModelsSettingsState, ModelsOperations } from '@dsh-base/client-deepseek-provider/client'
import { DEEPSEEK_SETTINGS_SCHEMA, DEEPSEEK_SETTINGS_DEFAULTS, DEPLOYMENT_MODELS } from '@dsh-base/model-declarations'
import type { ModelsCopy } from './locales.ts'

/** These local namespace views describe public defaults, not persisted user layers. */
export function publicModelNamespaces(): ReadonlyMap<string, SettingsNamespaceView> {
  const defaults = structuredClone(DEEPSEEK_SETTINGS_DEFAULTS)
  return new Map<string, SettingsNamespaceView>([
    ['llm-deepseek', { ns: 'llm-deepseek', autoGenerate: false, schema: structuredClone(DEEPSEEK_SETTINGS_SCHEMA),
      value: defaults, base: structuredClone(defaults), user: {}, secrets: [], revision: 0, applies: 'live' }],
    ['llm-cloudflare-gateway', { ns: 'llm-cloudflare-gateway', autoGenerate: false,
      schema: { type: 'object', dict: {}, meta: { default: {} } }, value: {}, base: {}, user: {}, secrets: [], revision: 0, applies: 'live' }],
  ])
}

/** No Context or Remote is accepted, so all reads and defensive refusals stay local. */
export function createAnonymousModelsHost(copy: ModelsCopy) {
  const state: ModelsSettingsState = {
    status: 'ready', error: null, credentialError: null, writable: false,
    rows: [
      { entry: { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [], active: false },
        configured: false, removable: false, apiKeyEnv: undefined, credential: undefined },
      { entry: { provider: 'cloudflare-ai-gateway', displayName: 'Cloudflare AI Gateway', settingsNs: 'llm-cloudflare-gateway', settingsPath: [], active: false },
        configured: false, removable: false, apiKeyEnv: undefined, credential: undefined },
    ],
    namespaces: publicModelNamespaces(),
  }
  const store = createSnapshotStore(state)
  const controller: ModelsSectionController = { store, load: async () => {} }
  const operations: ModelsOperations = {
    storeCredential: async () => copy.signInRequired,
    removeCredential: async () => copy.signInRequired,
    writeSettings: async () => ({ kind: 'refused', message: copy.signInRequired }),
    // Read-only ModelListEditor may discover on mount. Return declarations only,
    // never contact a provider or treat its private availability as known.
    discoverModels: async (namespace, request) => namespace === 'llm-deepseek'
      && request.provider === 'deepseek-official' && !request.apiKey
      ? { kind: 'found', models: DEPLOYMENT_MODELS.map(({ id, label, contextWindow }) => ({ id, name: label, contextWindow })) }
      : { kind: 'refused', message: copy.signInRequired },
  }
  return { controller, useSnapshot: bindSnapshotSelector(store), operations }
}
