import {useEffect,useRef,useState} from 'react';
import {Button} from '@deepseek-ai/dsh-client-ui-primitives';
import type {InjectFace,PropsRuntime} from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client';
import {translator,type Language} from '@dsh-base/client-saas-ui/locales';
import type {PanelStore} from '@dsh-base/client-saas-ui/transport';
import fieldCss from '@deepseek-ai/dsh-client-ui-primitives/src/settings-form/fields.module.css';
import type {CrispStatus} from './definition.ts';
import type {CrispSupport} from './support.ts';
import {descriptions} from './copy.ts';
interface Face{hooks:{status:Pick<PanelStore,'getSnapshot'|'subscribe'>;language:{getSnapshot:()=>{active:string};subscribe:(listener:()=>void)=>()=>void}};ensure:()=>void;reload:()=>void;support:CrispSupport}
export function CrispPanel(props:PropsRuntime<'plugins.bundle.config'>&InjectFace<Face>){const language=props.useLanguage(value=>value.active),t=translator(language),state=props.useStatus(value=>value),[busy,setBusy]=useState(false),[failed,setFailed]=useState(false),live=useRef(true);
  useEffect(()=>{live.current=true;if(props.view==='page')props.ensure();return()=>{live.current=false;};},[props.view,props.ensure]);
  if(props.view==='summary')return descriptions[language as Language]??descriptions.en;
  const status=state.data as CrispStatus|undefined,ready=state.status==='ready'&&status?.enabled===true&&!!status.websiteId,loading=state.status==='idle'||state.status==='loading';
  const open=async()=>{if(!ready||busy||!status?.websiteId)return;setBusy(true);setFailed(false);try{await props.support.open(status.websiteId);}catch{if(live.current)setFailed(true);}finally{if(live.current)setBusy(false);}};
  return <div data-crisp-panel data-state={state.status}><div className={fieldCss.field}><div className={fieldCss.head}><span className={fieldCss.label}>{t(loading?'loading':state.status==='error'?'failed':ready?'ready':'unavailable')}</span><Button size="sm" variant="outline" disabled={loading||busy} onClick={props.reload}>{t('refresh')}</Button></div></div>
    {failed?<p className={fieldCss.invalid} role="alert">{t('actionFailed')}</p>:null}<div className={fieldCss.field}><div className={fieldCss.head}><Button size="sm" variant="primary" disabled={!ready||busy} onClick={()=>{void open();}}>{t(busy?'wait':'openSupport')}</Button></div></div></div>;
}
