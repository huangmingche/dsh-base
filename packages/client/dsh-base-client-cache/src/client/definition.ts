import { boolean,input,object,type PanelDefinition } from '@dsh-base/client-saas-ui/transport';
export const definition:PanelDefinition={bundle:'dsh-base:cache',access:'public',checkSession:true,
  load:async({request,authenticated})=>{const status=object(await request('/api/saas/cache/status')),ready=boolean(status.ready),enabled=boolean(status.enabled);let canManage=false;
    if(enabled&&ready&&authenticated){try{await request('/api/saas/cache');canManage=true;}catch(error){if(!(error instanceof Error&&'status'in error&&error.status===403))throw error;}}
    return {enabled,ready,canManage};},
  view:(value,t)=>{const state=object(value);return {available:state.enabled===true&&state.ready===true,notice:state.canManage===true?undefined:t('denied')};},
  actions:value=>[{id:'invalidate',label:'remove',needsAuth:true,disabled:object(value).canManage!==true,fields:[{id:'key',label:'key',required:true,maxLength:256}],method:'DELETE',path:values=>`/api/saas/cache?key=${encodeURIComponent(input(values,'key'))}`,parse:value=>{if(object(value).ok!==true)throw new Error('Invalid response');return null;}}],
};
