import {boolean,input,object,string,type PanelDefinition} from '@dsh-base/client-saas-ui/transport';
interface Status {enabled:boolean;ready:boolean;turnstileSiteKey:string|null}
export const definition:PanelDefinition={bundle:'dsh-base:contact',access:'public',
  load:async({request}):Promise<Status>=>{const raw=object(await request('/api/saas/contact/status'));return {enabled:boolean(raw.enabled),ready:boolean(raw.ready),turnstileSiteKey:raw.turnstileSiteKey===null?null:string(raw.turnstileSiteKey)};},
  view:value=>({available:(value as Status).enabled&&(value as Status).ready}),
  actions:value=>[{id:'contact',label:'send',disabled:!(value as Status).turnstileSiteKey,challenge:(value as Status).turnstileSiteKey,challengeAction:'contact',fields:[{id:'name',label:'name',required:true,maxLength:80},{id:'email',label:'email',type:'email',required:true,maxLength:254},{id:'message',label:'message',type:'textarea',required:true,minLength:10,maxLength:4000}],path:()=>'/api/saas/contact',body:values=>({name:input(values,'name'),email:input(values,'email'),message:input(values,'message'),turnstileToken:input(values,'turnstileToken')}),parse:value=>{if(object(value).accepted!==true)throw new Error('Invalid response');return null;}}],
};
