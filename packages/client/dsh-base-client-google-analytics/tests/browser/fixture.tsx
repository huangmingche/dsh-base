import {createElement,useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {Context} from '@deepseek-ai/cordis';
import {Switch} from '@deepseek-ai/dsh-client-ui-primitives';
import {installThemeStyles} from '@deepseek-ai/dsh-client-ui-theme/src/client/styles.ts';
import '@deepseek-ai/dsh-client-ui-theme/src/styles/brand-font.css';
import '@deepseek-ai/dsh-client-web/src/base.css';
import {apply} from '../../src/client/index.ts';
import {conversionConsentSnapshot} from '../../src/client/consent.ts';
const params=new URL(location.href).searchParams,language=params.get('locale')??'en';
installThemeStyles(new Context());document.body.toggleAttribute('data-ds-dark-theme',params.get('theme')==='dark');
const style=document.createElement('style');style.textContent='body{margin:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px}*{animation:none!important;transition:none!important}main{box-sizing:border-box;max-width:650px;margin:auto;padding:24px}#reference{display:none}';document.head.append(style);
const listeners=new Set<()=>void>();let config={analytics:{google:{enabled:false,measurementId:'G-TEST1234',ready:true},conversions:{mode:'google',campaigns:['launch']}}};
const dictionaries=new Map(),entries:any[]=[],cleanup:(()=>void)[]=[];
const ctx={provide:(name:string,value:unknown)=>{(ctx as any)[name]=value;},inject:(names:string[],setup:(scope:any)=>void)=>{if(names.every(name=>name in ctx))setup(ctx);},effect:(setup:()=>void|(()=>void))=>{const clean=setup();if(clean)cleanup.push(clean);},siteConfig:{getSnapshot:()=>({config}),subscribe:(listener:()=>void)=>{listeners.add(listener);return()=>listeners.delete(listener);}},locale:{register:(name:string,dict:any)=>{dictionaries.set(name,dict);return()=>{};}},slots:{inject:(_name:string,setup:()=>unknown)=>setup(),register:(options:any,component:any)=>{entries.push({options,component});return()=>{};}}};
apply(ctx as never);const entry=entries[0],face=entry.options.inject(),dictionary=dictionaries.get(entry.options.locale)[language];
function Fixture(){const useConsent=(select:any)=>select(useSyncExternalStore(face.hooks.consent.subscribe,face.hooks.consent.getSnapshot));const state=useConsent((v:any)=>v);return <><main>{createElement(entry.component,{...face,useConsent,t:(key:string)=>dictionary[key]})}</main><div id="reference"><Switch checked={state.consent} disabled={!state.available} label={dictionary.label} onChange={()=>{}}/></div></>;}
(window as any).__ANALYTICS_FIXTURE__={snapshot:conversionConsentSnapshot,disable:()=>{config={...config,analytics:{...config.analytics,conversions:{mode:'off',campaigns:[]}}};for(const fn of listeners)fn();},dispose:()=>cleanup.reverse().forEach(fn=>fn())};
createRoot(document.getElementById('root')!).render(<Fixture/>);
