import {useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import type {Context} from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import {Button,Modal} from '@deepseek-ai/dsh-client-ui-primitives';
import {translator} from '@dsh-base/client-saas-ui/locales';
import {object} from '@dsh-base/client-saas-ui/transport';
import {descriptions} from './copy.ts';
/** A confirmation link opens an official dialog; no subscription changes until the explicit click. */
export function mountConfirmation(ctx:Context):void {
  const address=new URL(location.href),token=address.searchParams.get('newsletterToken');
  if(!token||!/^[a-f0-9]{64}$/u.test(token))return;
  ctx.effect(()=>{
    const container=document.createElement('div');document.body.append(container);const root=createRoot(container);const controller=new AbortController();
    const clear=()=>{const current=new URL(location.href);current.searchParams.delete('newsletterToken');history.replaceState(history.state,'',`${current.pathname}${current.search}${current.hash}`);root.render(null);if(document.body.dataset.dshDocument==='/')location.reload();};
    function Confirmation(){const [busy,setBusy]=useState(false),[failed,setFailed]=useState(false),pending=useRef(false);const language=ctx.get('locale')?.getSnapshot().active??document.documentElement.lang.split('-')[0]??'en',t=translator(language);
      const confirm=async()=>{if(pending.current)return;pending.current=true;setBusy(true);setFailed(false);try{const response=await fetch('/api/saas/newsletter/confirm',{method:'POST',credentials:'same-origin',signal:controller.signal,headers:{'content-type':'application/json'},body:JSON.stringify({token})});if(!response.ok||object(await response.json()).subscribed!==true)throw new Error('Confirmation failed');if(!controller.signal.aborted)clear();}catch{if(!controller.signal.aborted)setFailed(true);}finally{pending.current=false;if(!controller.signal.aborted)setBusy(false);}};
      return <Modal open title={t('confirm')} description={descriptions[language as keyof typeof descriptions]??descriptions.en} closeLabel={t('close')} onClose={clear}>
        {failed?<p role="alert">{t('actionFailed')}</p>:null}<Button variant="primary" disabled={busy} onClick={()=>{void confirm();}}>{t(busy?'wait':'confirm')}</Button>
      </Modal>;
    }
    root.render(<Confirmation/>);return()=>{controller.abort();root.unmount();container.remove();};
  },'newsletter: explicit confirmation');
}
