import assert from 'node:assert/strict';import test from 'node:test';import {createRequire,registerHooks} from 'node:module';import {readFileSync} from 'node:fs';
import {registerOfficialSourceHooks} from '../../../../scripts/build/official-source-hook.mjs';
registerOfficialSourceHooks();const app=createRequire(new URL('../../../../apps/web/package.json',import.meta.url)),{transformSync}=app('esbuild');
registerHooks({resolve(specifier,context,next){
  const helper={'@dsh-base/client-saas-ui':'index.ts','@dsh-base/client-saas-ui/transport':'transport.ts','@dsh-base/client-saas-ui/locales':'locales.ts'};
  if(helper[specifier])return {url:new URL(`../../../boot/dsh-base-saas-ui/src/${helper[specifier]}`,import.meta.url).href,shortCircuit:true};
  if(specifier==='@dsh-base/client-auth-login/request')return {url:new URL('../../dsh-base-client-auth-login/src/client/request.ts',import.meta.url).href,shortCircuit:true};
  if(specifier==='react'||specifier.startsWith('react/')||specifier.startsWith('react-dom')||specifier==='zod')return next(specifier,{...context,parentURL:new URL('../../../../apps/web/package.json',import.meta.url).href});
  return next(specifier,context);
},load(url,context,next){if(url.endsWith('.css'))return {format:'module',shortCircuit:true,source:'export default new Proxy({}, {get:(_,key)=>String(key)})'};
  if(url.endsWith('.tsx'))return {format:'module',shortCircuit:true,source:transformSync(readFileSync(new URL(url),'utf8'),{loader:'tsx',jsx:'automatic',format:'esm',target:'es2022'}).code};return next(url,context);}});
const {definition,recoveryAction}=await import('../src/client/definition.ts');
const {PanelStore,RequestFailure}=await import('@dsh-base/client-saas-ui/transport');
const {NewsletterPanel}=await import('../src/client/NewsletterPanel.tsx');
const {recoveryLocales}=await import('../src/client/recovery-locales.ts');
const {descriptions}=await import('../src/client/copy.ts');
const React=await import('react'),{renderToStaticMarkup}=await import('react-dom/server'),{Button,Switch}=await import('@deepseek-ai/dsh-client-ui-primitives');
const status={enabled:false,ready:false,provider:'resend',turnstileSiteKey:null};
const row={email:'fixture@example.invalid',state:'confirming',revision:7,operationAt:1794873600000,reconcilable:true};
const noop=()=>{};
const load=(authenticated,request)=>definition.load({authenticated,request});
test('administrator recovery remains reachable when public subscriptions are disabled',async()=>{
  const calls=[];const data=await load(true,async path=>{calls.push(path);return path.endsWith('/status')?status:{items:[row]};});
  assert.deepEqual(calls,['/api/saas/newsletter/status','/api/saas/newsletter/reconcile']);assert.equal(data.canReconcile,true);assert.equal(definition.view(data,key=>key).available,true);
  assert.ok(definition.actions(data).every(action=>action.disabled));assert.equal(definition.view(data,key=>key).rows[0].actions[0].disabled,false);
});
test('guests never request recovery, and normal users cannot see administrator records',async()=>{
  const calls=[];const guest=await load(false,async path=>{calls.push(path);return status;});assert.deepEqual(calls,['/api/saas/newsletter/status']);assert.equal(guest.canReconcile,false);
  const user=await load(true,async path=>{if(path.endsWith('/status'))return {...status,enabled:true,ready:true};if(path.endsWith('/reconcile'))throw new RequestFailure(403);return {subscribed:true};});
  assert.equal(user.subscribed,true);assert.equal(user.canReconcile,false);assert.deepEqual(definition.view(user,key=>key).rows,[]);
});
test('administrator recovery is independent of owner email verification and handles unavailable reads',async()=>{
  const data=await load(true,async path=>{if(path.endsWith('/status'))return {...status,enabled:true,ready:true};if(path.endsWith('/reconcile'))return {items:[row]};throw new RequestFailure(403);});assert.equal(data.canReconcile,true);assert.equal(data.ownerUnavailable,true);
  const failed=await load(true,async path=>{if(path.endsWith('/status'))return status;throw new RequestFailure(503);});assert.equal(failed.recoveryUnavailable,true);assert.equal(failed.canReconcile,false);assert.deepEqual(failed.recoveries,[]);
  await assert.rejects(load(true,async path=>{if(path.endsWith('/status'))return status;throw new RequestFailure(401);}),error=>error.status===401);
});
test('recovery requires explicit review and validates exact provider-confirmed results',()=>{
  const action=recoveryAction(row);assert.throws(()=>action.body({reviewedProvider:'false'},{}));assert.throws(()=>action.body({},{}));
  assert.deepEqual(action.body({reviewedProvider:'true'},{}),{email:row.email,expectedRevision:7,reviewedProvider:true});
  assert.deepEqual(action.parse({email:row.email,subscribed:true,state:'confirmed',revision:8}),{email:row.email,subscribed:true});
  for(const result of [{email:'other@example.invalid',subscribed:true,state:'confirmed',revision:8},{email:row.email,subscribed:true,state:'revoked',revision:8},{email:row.email,subscribed:true,state:'confirmed',revision:7}])assert.throws(()=>action.parse(result));
  assert.equal(recoveryAction({...row,reconcilable:false}).disabled,true);
});
test('real request lifecycle submits one reviewed version and never reports a conflict as success',async()=>{
  let recovered=false,conflict=false;const posts=[];
  const store=new PanelStore(definition,async(path,options)=>{
    if(String(path).endsWith('get-session'))return Response.json({user:{id:'admin'}});
    if(String(path).endsWith('/status'))return Response.json(status);
    if(options?.method==='POST'){posts.push(JSON.parse(options.body));if(conflict)return Response.json({error:'newsletter_revision_conflict'},{status:409});recovered=true;return Response.json({email:row.email,subscribed:false,state:'revoked',revision:8});}
    return Response.json({items:recovered?[]:[row]});
  },()=>assert.fail('already authenticated'));
  await store.reload();await store.run(`reconcile:${row.email}`,{reviewedProvider:'false'});assert.equal(posts.length,0);
  conflict=true;await store.run(`reconcile:${row.email}`,{reviewedProvider:'true'});assert.equal(store.getSnapshot().saved,false);assert.equal(store.getSnapshot().failed,true);
  conflict=false;await store.run(`reconcile:${row.email}`,{reviewedProvider:'true'});assert.equal(store.getSnapshot().saved,true);assert.deepEqual(store.getSnapshot().data.recoveries,[]);assert.deepEqual(posts.at(-1),{email:row.email,expectedRevision:7,reviewedProvider:true});store.dispose();
});
test('eight localized recovery surfaces retain unchanged official buttons and switches',async()=>{
  const data=await load(true,async path=>path.endsWith('/status')?status:{items:[row,{...row,email:'waiting@example.invalid',state:'unsubscribing',reconcilable:false}]});
  for(const [language,copy]of Object.entries(recoveryLocales)){
    assert.deepEqual(Object.keys(copy).sort(),Object.keys(recoveryLocales.en).sort());
    const html=renderToStaticMarkup(React.createElement(NewsletterPanel,{view:'page',definition,descriptions,ensure:noop,reload:noop,run:async()=>{},clearResult:noop,leave:noop,signIn:noop,useLanguage:select=>select({active:language}),usePanel:select=>select({status:'ready',auth:'signed-in',data,revision:1})}));
    assert.ok(html.includes(copy.recoveryTitle));assert.ok(html.includes(copy.recoveryWait));assert.ok(html.includes(copy.reviewedProvider));
    const referenceButton=renderToStaticMarkup(React.createElement(Button,{size:'sm',variant:'primary',type:'submit',disabled:true},copy.recoveryAction));assert.ok(html.includes(referenceButton));
    const referenceSwitch=renderToStaticMarkup(React.createElement(Switch,{label:copy.reviewedProvider,checked:false,disabled:false,onChange:noop}));assert.ok(html.includes(referenceSwitch));
    assert.doesNotMatch(html,/recoveryTitle|recoveryHelp|reviewedProvider<|operationAt</u);
  }
});
