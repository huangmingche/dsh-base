import assert from 'node:assert/strict';import test from 'node:test';import {registerHooks} from 'node:module';
registerHooks({resolve(specifier,context,next){if(specifier==='@dsh-base/client-saas-ui/transport')return {url:new URL('../../../boot/dsh-base-saas-ui/src/transport.ts',import.meta.url).href,shortCircuit:true};return next(specifier,context);}});
const {definition}=await import('../src/client/definition.ts');
const key={id:'fixture-key',name:'Fixture',start:'fixture_',enabled:true,createdAt:'2026-11-17T00:00:00Z',expiresAt:null,permissions:{profile:['read']}};
test('key management exposes pagination without granting broader scopes',async()=>{
  const calls=[];const state=await definition.load({authenticated:true,request:async path=>{calls.push(path);return path.endsWith('/status')?{enabled:true,authenticated:true,scopes:['profile:read']}:{keys:Array.from({length:100},(_,i)=>({...key,id:`key-${i}`})),total:101,limit:100,offset:0};}});
  assert.deepEqual(calls,['/api/api-keys/status','/api/api-keys?limit=100&offset=0']);const actions=definition.actions(state),next=actions.find(action=>action.id==='page:100');assert.equal(next.path({},state),'/api/api-keys?limit=100&offset=100');
  const create=actions.find(action=>action.id==='create');assert.deepEqual(create.body({name:'Fixture',expiresInDays:'30'},state),{name:'Fixture',expiresInDays:30});for(const value of ['0','366','NaN'])assert.throws(()=>create.body({name:'Fixture',expiresInDays:value},state));
  const result=create.parse({key,secret:'only-once'});assert.deepEqual(create.result(result),[{label:'key',value:'only-once',sensitive:true}]);assert.throws(()=>create.parse({key:{...key,permissions:{profile:['write']}},secret:'invalid'}));
});
