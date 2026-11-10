import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createEntitlements,createEntitlementHandler,declarations,assertOperationAllowed} from '../src/index.ts';
const env={ENTITLEMENTS_FEATURES_JSON:'[{"id":"exports","planIds":["pro","lifetime"]}]'};
test('configured features use only authenticated owner and known paid plan grants',async()=>{
 let observed:unknown;
 const service=createEntitlements({ready:()=>true,async allows(_env,user,plans){observed={user,plans};return user==='alice';}});
 assert.deepEqual(await service.authorize(env,'alice','exports'),{allowed:true,reason:'allowed'});
 assert.deepEqual(observed,{user:'alice',plans:['pro','lifetime']});
 assert.deepEqual(await service.authorize(env,'bob','exports'),{allowed:false,reason:'no_entitlement'});
 assert.deepEqual(await service.authorize(env,'alice','other'),{allowed:false,reason:'unknown_feature'});
 const handler=createEntitlementHandler({async session(){return {id:'alice',username:'alice',email:'private@example.test'};}},service);
 const response=await handler(new Request('https://app.example/api/entitlements?feature=exports'),env);
 assert.equal(response!.status,200);assert.equal((await response!.json() as {allowed:boolean}).allowed,true);
 assert.equal((await handler(new Request('https://app.example/api/entitlements?feature=exports&userId=bob'),env))!.status,400);
 const anonymous=createEntitlementHandler({async session(){return undefined;}},service);
 assert.equal((await anonymous(new Request('https://app.example/api/entitlements'),env))!.status,401);
});
test('only explicitly declared paid operations are gated, and malformed policies fail closed',async()=>{
 const service=createEntitlements({ready:()=>true,async allows(_env,user){return user==='alice';}});
 assert.deepEqual(await service.authorizeOperation({},undefined,'platform_ai'),{allowed:true,reason:'allowed'});
 const configured={...env,ENTITLEMENTS_OPERATIONS_JSON:'{"platform_ai":"exports"}'};
 assert.equal((await service.authorizeOperation(configured,'alice','platform_ai')).allowed,true);
 assert.equal((await service.authorizeOperation(configured,undefined,'platform_ai')).allowed,false);
 assert.equal((await service.authorizeOperation(configured,'bob','platform_ai')).allowed,false);
 assert.equal((await service.authorizeOperation(configured,'bob','unpriced_operation')).allowed,true);
 for(const mapping of ['null','[]','{"platform_ai":"unknown"}','bad'])assert.equal((await service.authorizeOperation({...env,ENTITLEMENTS_OPERATIONS_JSON:mapping},'alice','platform_ai')).allowed,false);
 await assertOperationAllowed({},undefined,'platform_ai');await assert.rejects(assertOperationAllowed({...env,ENTITLEMENTS_OPERATIONS_JSON:'bad'},'alice','platform_ai'),{code:'entitlements_unavailable',status:503});
});
test('missing configuration, malformed declarations and payment failures deny safely',async()=>{
 const service=createEntitlements({ready:()=>true,async allows(){throw new Error('D1 outage');}});
 assert.deepEqual(await service.authorize(env,'alice','exports'),{allowed:false,reason:'unavailable'});
 assert.deepEqual(await service.authorize({},'alice','exports'),{allowed:false,reason:'unavailable'});
 for(const raw of ['null','[]','[{"id":"x","planIds":[]}]','[{"id":"x","planIds":["p","p"]}]','[{"id":"x","planIds":["p"]},{"id":"x","planIds":["q"]}]']) assert.equal(declarations({ENTITLEMENTS_FEATURES_JSON:raw}),undefined);
});
