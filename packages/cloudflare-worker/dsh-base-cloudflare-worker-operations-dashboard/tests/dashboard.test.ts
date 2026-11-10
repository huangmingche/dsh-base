import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createOperationsHandler,operationsSnapshot} from '../src/index.ts';
const request=()=>new Request('https://app.example/api/operations-dashboard');
test('operations counts require a verified administrator before reading data',async()=>{
 const anonymous=createOperationsHandler({async session(){return undefined;}},()=>undefined);
 assert.equal((await anonymous(request(),{}))!.status,401);
 const handler=createOperationsHandler({async session(){return {id:'member',username:'member',email:'private@example.test'};}},()=>undefined);
 assert.equal((await handler(request(),{SITE_ADMIN_USER_IDS:'["admin"]'}))!.status,403);
 assert.equal((await handler(request(),{SITE_ADMIN_USER_IDS:'broken'}))!.status,403);
 const response=await handler(request(),{SITE_ADMIN_USER_IDS:'["member"]'});
 assert.equal(response!.status,200);assert.deepEqual(await response!.json(),{users:{available:false},payments:{available:false},email:{available:false}});
});
test('missing optional schemas are unavailable, successful zero is a real zero',async()=>{
 const db={withSession(){return {prepare(sql:string){return {async first(){if(sql.includes('"user"'))return {total:2};throw new Error('missing');},async all(){return {results:[{state:'accepted',total:3},{state:'unknown',total:1}]};}};}};}} as unknown as D1Database;
 const snapshot=await operationsSnapshot({AUTH_DB:db},{ready:()=>true,async summary(){return {orders:0,activeSubscriptions:0,refundedOrders:0};}});
 assert.deepEqual(snapshot,{users:{available:true,total:2},payments:{available:true,orders:0,activeSubscriptions:0,refundedOrders:0},email:{available:true,sending:0,accepted:3,rejected:0,unknown:1}});
 assert.ok(!JSON.stringify(snapshot).includes('private@example.test'));
 const broken={withSession(){throw new Error('outage');}} as unknown as D1Database;
 assert.deepEqual(await operationsSnapshot({AUTH_DB:broken},{ready:()=>true,async summary(){throw new Error('outage');}}),{users:{available:false},payments:{available:false},email:{available:false}});
});
