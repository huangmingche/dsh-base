/** Public declaration preview uses a direct pinned readonly ProviderEditor oracle.
 * The default fork is compared separately to the pinned ModelsSection with explicit
 * Host contract fixtures. Public rows are never marked owner-configured to render them.
 */
import { useMemo, useState } from 'react';
import { Context } from '@deepseek-ai/cordis';
import { SettingsSchemaService } from '@deepseek-ai/dsh-client-ui-settings/src/client/schema.ts';
import { createSettingsSchemaOperations } from '@deepseek-ai/dsh-client-ui-settings-models/src/client/schema-operations.ts';
import { ProviderEditor as OfficialProviderEditor } from '@deepseek-ai/dsh-client-ui-settings-models/src/client/ProviderEditor.tsx';
import { ModelsSection as OfficialModelsSection } from '@deepseek-ai/dsh-client-ui-settings-models/src/client/ModelsSection.tsx';
import * as modelCopy from '@deepseek-ai/dsh-client-ui-settings-models/src/client/locales.ts';
import officialStyles from '@deepseek-ai/dsh-client-ui-settings-models/src/client/ModelsSection.module.css';
import { ModelsSection as AdaptedModelsSection } from '@dsh-base/client-deepseek-provider/client';
import { gatewayCopy } from '@dsh-base/client-gateway-provider/client';
import { DEPLOYMENT_MODELS, DEEPSEEK_SETTINGS_DEFAULTS, DEEPSEEK_SETTINGS_SCHEMA } from '@dsh-base/model-declarations';
import { AnonymousModelsSection } from '../../../../packages/client/dsh-base-client-account-launcher/src/client/AnonymousModelsSection.tsx';
import { createAnonymousModelsHost } from '../../../../packages/client/dsh-base-client-account-launcher/src/client/anonymous-models-host.ts';
import { modelsCopy } from '../../../../packages/client/dsh-base-client-account-launcher/src/client/locales.ts';

const referenceNamespace = {
  ns: 'llm-deepseek', schema: DEEPSEEK_SETTINGS_SCHEMA,
  value: DEEPSEEK_SETTINGS_DEFAULTS, base: DEEPSEEK_SETTINGS_DEFAULTS,
  user: {}, secrets: [], revision: 0, autoGenerate: false, applies: 'live',
};
export function AnonymousModelsFixture({ locale, adapted }: { locale: 'en' | 'zh'; adapted: boolean }) {
  const query = new URLSearchParams(location.search), mode = query.get('mode') ?? 'public', state = query.get('state') ?? 'ready';
  const calls = useMemo(() => [] as string[], []);
  const schema = useMemo(() => createSettingsSchemaOperations(new SettingsSchemaService(new Context())), []);
  const copy = modelsCopy(locale), t = (key: string) => (modelCopy[locale] as any)[key];
  const [frame, setFrame] = useState({ x: 24, y: 24, width: 688, setup: true });
  const host = useMemo(() => createAnonymousModelsHost(copy), [schema, locale]);
  const referenceOperations = useMemo(() => ({
    writeSettings: async () => { calls.push('writeSettings'); return { kind: 'refused', message: 'Readonly' }; },
    storeCredential: async () => { calls.push('storeCredential'); return 'Readonly'; },
    removeCredential: async () => { calls.push('removeCredential'); return 'Readonly'; },
    discoverModels: async () => { calls.push('public/discoverModels'); return { kind: 'found', models: DEPLOYMENT_MODELS.map(model => ({ id: model.id, name: model.label, contextWindow: model.contextWindow })) }; },
  }), []);
  const global = { calls, setFrame, copy, officialCopy: modelCopy[locale], gatewayCopy: gatewayCopy[locale], expectedModels: DEPLOYMENT_MODELS, host, mode, state };
  (window as any).__ANONYMOUS_MODELS_PARITY__ = global;
  if (mode === 'default' || mode === 'public-stale') {
    const configured = state !== 'empty';
    const snapshot = {
      status: state === 'loading' ? 'loading' : state === 'error' ? 'error' : 'ready',
      error: state === 'error' ? 'Host fixture failure' : null, credentialError: null, writable: state !== 'readonly',
      rows: [{ entry: { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [], active: true }, configured, removable: false,
        apiKeyEnv: 'DEEPSEEK_OFFICIAL_API_KEY', credential: state === 'no-key' ? undefined : { configured: !['missing-key', 'stale-missing'].includes(state), writable: false },
        ...(mode === 'public-stale' ? { derivedCredential: { configured: true, writable: false }, credentialChecks: { DEEPSEEK_OFFICIAL_API_KEY: { configured: state !== 'stale-missing', writable: false } } } : {}),
      }],
      namespaces: new Map([['llm-deepseek', referenceNamespace]]),
    };
    const controller = { store: { getSnapshot: () => snapshot, subscribe: () => () => {} }, load: async () => { calls.push('load'); } };
    const Component = adapted ? AdaptedModelsSection : OfficialModelsSection;
    return <main className="permission-fixture" style={{ fontSize: 13, lineHeight: '22px' }}><Component {...{
      controller, useSnapshot: (select: any) => select(snapshot), schema, operations: referenceOperations, t, renderSlot: () => null,
      ...(mode === 'public-stale' ? { presentation: 'public-declarations', onRequestAccess: () => { calls.push('local/signIn'); } } : {}),
    } as any} /></main>;
  }
  if (!adapted) return <main style={{ fontSize: 13, lineHeight: '22px' }}>
    <div className={frame.setup ? officialStyles.setupCard : officialStyles.rowCard} style={{ position: 'absolute', left: frame.x, top: frame.y, width: frame.width, padding: 0, border: 0, borderRadius: 0 }} data-reference-editor-container>
      <OfficialProviderEditor key={String(frame.setup)} {...{ provider: 'deepseek-official', displayName: 'DeepSeek', namespace: referenceNamespace,
        settingsPath: [], schema, operations: referenceOperations, readOnly: true, t, onClose: () => { calls.push('close'); },
      } as any} />
    </div>
  </main>;
  return <main style={{ width: 'calc(100% - 48px)', maxWidth: 720, margin: '24px auto', fontSize: 13, lineHeight: '22px' }}>
    <AnonymousModelsSection {...{ t, copy, schema, signIn: () => { calls.push('local/signIn'); }, gatewayT: (key: string) => (gatewayCopy[locale] as any)[key] } as any} />
  </main>;
}
