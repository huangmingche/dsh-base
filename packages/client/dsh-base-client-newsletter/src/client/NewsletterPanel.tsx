import {Panel} from '@dsh-base/client-saas-ui';
import type {PanelAction,PanelView} from '@dsh-base/client-saas-ui/transport';
import type {Language} from '@dsh-base/client-saas-ui/locales';
import {recoveryLocales} from './recovery-locales.ts';
type Props=Parameters<typeof Panel>[0];
/** Add feature-owned recovery copy while the shared renderer retains unchanged official controls. */
export function NewsletterPanel(props:Props){
  const language=props.useLanguage(value=>value.active),copy=recoveryLocales[language as Language]??recoveryLocales.en;
  const local=(key:string)=>copy[key as keyof typeof copy]??key;
  const action=(value:PanelAction):PanelAction=>({...value,label:local(value.label),fields:value.fields?.map(field=>({...field,label:local(field.label)}))});
  const view=(value:PanelView):PanelView=>({...value,facts:value.facts?.map(fact=>({...fact,label:local(fact.label)})),rows:value.rows?.map(row=>({...row,facts:row.facts.map(fact=>({...fact,label:local(fact.label)})),actions:row.actions?.map(action)}))});
  return <Panel {...props} definition={{...props.definition,view:(data,t)=>view(props.definition.view(data,key=>copy[key as keyof typeof copy]??t(key))),actions:data=>props.definition.actions?.(data).map(action)??[]}}/>;
}
