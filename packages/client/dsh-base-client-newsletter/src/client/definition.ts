import {array,boolean,input,number,object,string,RequestFailure,type PanelAction,type PanelDefinition} from '@dsh-base/client-saas-ui/transport';
export interface Recovery {email:string;state:'confirming'|'unsubscribing';revision:number;operationAt:number;reconcilable:boolean}
export interface Status {enabled:boolean;ready:boolean;provider:string;turnstileSiteKey:string|null;subscribed?:boolean;canReconcile:boolean;recoveryUnavailable?:boolean;ownerUnavailable?:boolean;recoveries:Recovery[]}
function readRecoveries(value:unknown):Recovery[]{
  const rows=array(object(value).items);if(rows.length>100)throw new Error('Invalid recovery list');
  return rows.map(value=>{const row=object(value),email=string(row.email),revision=number(row.revision),operationAt=number(row.operationAt);
    if(!email||email.length>254||!['confirming','unsubscribing'].includes(String(row.state))||!Number.isSafeInteger(revision)||revision<0||!Number.isSafeInteger(operationAt)||operationAt<0||!Number.isFinite(new Date(operationAt).getTime()))throw new Error('Invalid recovery record');
    return {email,state:row.state as Recovery['state'],revision,operationAt,reconcilable:boolean(row.reconcilable)};
  });
}
export function recoveryAction(row:Recovery):PanelAction{return {
  id:`reconcile:${row.email}`,label:'recoveryAction',needsAuth:true,disabled:!row.reconcilable,
  fields:[{id:'reviewedProvider',label:'reviewedProvider',type:'checkbox',required:true}],path:()=>'/api/saas/newsletter/reconcile',
  body:values=>{if(input(values,'reviewedProvider')!=='true')throw new Error('Provider review is required');return {email:row.email,expectedRevision:row.revision,reviewedProvider:true};},
  parse:value=>{const raw=object(value),email=string(raw.email),subscribed=boolean(raw.subscribed),revision=number(raw.revision);if(email!==row.email||revision!==row.revision+1||raw.state!==(subscribed?'confirmed':'revoked'))throw new Error('Invalid recovery result');return {email,subscribed};},
  result:value=>{const result=value as {email:string;subscribed:boolean};return [{label:'email',value:result.email},{label:'subscribe',value:result.subscribed?'✓':'—'}];},
};}
export const definition:PanelDefinition={bundle:'dsh-base:newsletter',access:'public',checkSession:true,
  load:async({request,authenticated}):Promise<Status>=>{const raw=object(await request('/api/saas/newsletter/status')),status={enabled:boolean(raw.enabled),ready:boolean(raw.ready),provider:string(raw.provider),turnstileSiteKey:raw.turnstileSiteKey===null?null:string(raw.turnstileSiteKey)};
    const result:Status={...status,canReconcile:false,recoveries:[]};
    if(!authenticated)return result;
    // Recovery must remain reachable while the public feature or sender is disabled.
    try{result.recoveries=readRecoveries(await request('/api/saas/newsletter/reconcile'));result.canReconcile=true;}
    catch(error){if(error instanceof RequestFailure&&error.status===401)throw error;if(!(error instanceof RequestFailure&&error.status===403))result.recoveryUnavailable=true;}
    if(status.enabled&&status.ready){try{result.subscribed=boolean(object(await request('/api/saas/newsletter')).subscribed);}catch(error){if(error instanceof RequestFailure&&error.status===401)throw error;result.ownerUnavailable=true;}}
    return result;},
  view:(value,t)=>{const state=value as Status,publicReady=state.enabled&&state.ready;return {available:publicReady||state.canReconcile,
    notice:state.canReconcile?t('recoveryHelp'):state.recoveryUnavailable?t('recoveryUnavailable'):undefined,
    facts:[{label:'provider',value:state.provider},{label:'status',value:t(publicReady?'ready':'unavailable')},...typeof state.subscribed==='boolean'?[{label:'subscribe',value:t(state.subscribed?'yes':'no')}]:[],...state.ownerUnavailable?[{label:'subscribe',value:t('unavailable')}]:[],...state.canReconcile?[{label:'recoveryTitle',value:state.recoveries.length===0?t('noRecovery'):String(state.recoveries.length)}]:[]],
    rows:state.canReconcile?state.recoveries.map(row=>({id:`reconcile:${row.email}`,facts:[{label:'email',value:row.email},{label:'status',value:t(row.state)},{label:'operationAt',value:new Date(row.operationAt).toISOString()},...!row.reconcilable?[{label:'recoveryAction',value:t('recoveryWait')}]:[]],actions:[recoveryAction(row)]})):[]};},
  actions:value=>{const state=value as Status;return [{id:'subscribe',label:'subscribe',disabled:!state.enabled||!state.ready||!state.turnstileSiteKey,challenge:state.turnstileSiteKey,challengeAction:'newsletter',fields:[{id:'email',label:'email',type:'email',required:true,maxLength:254},{id:'consent',label:'consent',type:'checkbox',required:true}],path:()=>'/api/saas/newsletter/subscribe',body:values=>{if(input(values,'consent')!=='true')throw new Error('Consent required');return {email:input(values,'email'),consent:true,turnstileToken:input(values,'turnstileToken')};},parse:value=>{if(object(value).accepted!==true)throw new Error('Invalid response');return null;}} as PanelAction,
    {id:'unsubscribe',label:'unsubscribe',needsAuth:true,disabled:!state.enabled||!state.ready||state.subscribed===false||state.ownerUnavailable===true,method:'DELETE',path:()=>'/api/saas/newsletter',parse:value=>{if(object(value).ok!==true)throw new Error('Invalid response');return null;}} as PanelAction];},
};
