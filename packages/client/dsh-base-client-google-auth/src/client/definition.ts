import { boolean, object, type PanelDefinition } from '@dsh-base/client-saas-ui/transport';
export const definition: PanelDefinition = {
  bundle: 'dsh-base:google-auth', access: 'public',
  load: async ({request}) => ({ enabled: boolean(object(await request('/api/auth-policy')).googleEnabled) }),
  view: (value, t) => ({ available: object(value).enabled === true, facts: [{label:'provider',value:'Google'}, {label:'status',value:t(object(value).enabled ? 'ready':'disabled')}] }),
};
