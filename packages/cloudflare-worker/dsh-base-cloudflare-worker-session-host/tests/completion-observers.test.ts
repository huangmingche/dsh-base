/** Actual Cordis service lifetime and actual owner SQLite DO completion, without any network. */
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {Context} from '@deepseek-ai/cordis';
import {registerHooks} from 'node:module';
registerHooks({resolve(specifier,context,next){if(specifier==='agents')return {url:'data:text/javascript,export async function getAgentByName(){throw new Error(%22network forbidden%22)}',shortCircuit:true};return next(specifier,context);}});
const hostPlugin=await import('../src/index.ts');
const {SessionHostObject}=await import('../src/do.ts');
import {notifyCompleted} from '../src/completion-observers.ts';
import type {SessionHost} from '../src/host.ts';
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
const writes:unknown[]=[];
const analytics={name:'fixture:analytics',apply(ctx:Context){ctx.provide('siteAnalytics',{ready:()=>true,async recordConversion(env:unknown,event:unknown){writes.push({env,event});return {status:'recorded'};}} as never);}};
for(const providerFirst of [false,true]){
 const ctx=new Context();ctx.provide('http',{use(){return()=>{};}} as never);ctx.provide('auth',{async session(){return undefined;}} as never);
 let provider=providerFirst?await ctx.plugin(analytics):undefined;await ctx.plugin(hostPlugin);await settle();
 const baseline=writes.length;assert.equal(await notifyCompleted({source:'fixture'},'owner-a'),providerFirst);assert.equal(writes.length,baseline+(providerFirst?1:0));
 if(!provider){provider=await ctx.plugin(analytics);await settle();}
 assert.equal(await notifyCompleted({},'owner-b'),true);
 await provider.dispose();await settle();const removed=writes.length;assert.equal(await notifyCompleted({},'owner-c'),false);assert.equal(writes.length,removed);
 provider=await ctx.plugin(analytics);await settle();assert.equal(await notifyCompleted({},'owner-d'),true);
 await ctx.fiber.dispose();assert.equal(await notifyCompleted({},'owner-e'),false);
}
let d1Reads=0;
const sqlite=new DatabaseSync(':memory:');
const sql={exec(query:string,...args:unknown[]){const rows=sqlite.prepare(query).all(...args as never[]);return {toArray:()=>rows,[Symbol.iterator]:()=>rows[Symbol.iterator]()};}};
const state={id:{name:'owner:real-owner:default-v49'},storage:{sql,transactionSync<T>(fn:()=>T):T{sqlite.exec('BEGIN');try{const value=fn();sqlite.exec('COMMIT');return value;}catch(error){sqlite.exec('ROLLBACK');throw error;}},async setAlarm(){}}};
const owner=new SessionHostObject(state,{AUTH_DB:{withSession(){d1Reads++;throw new Error('analytics must not access D1 without a mounted plugin');}}} as never);
const host=(owner as unknown as {host():SessionHost}).host();
await host.create({sessionId:'s',title:'Private title'});
const complete=async(id:string)=>{const accepted=await host.prompt({sessionId:'s',text:'Private content',requestId:id});return host.runSubmission({sessionId:'s',submissionId:accepted.submissionId},async()=>({messages:[{id,role:'user',parts:[{type:'text',text:'private'}]},{id:`answer-${id}`,role:'assistant',parts:[{type:'text',text:'completed'}]}]}));};
assert.equal((await complete('one')).status,'completed');assert.equal(d1Reads,0,'real DO completion cannot instantiate a statistics implementation');
const ctx=new Context();ctx.provide('http',{use(){return()=>{};}} as never);ctx.provide('auth',{async session(){return undefined;}} as never);await ctx.plugin(hostPlugin);await ctx.plugin(analytics);await settle();
const before=writes.length;assert.equal((await complete('two')).status,'completed');assert.equal(writes.length,before+1,'previous absence can retry on a later genuine completion');
assert.deepEqual((writes.at(-1) as any).event,{name:'activation',dedupeKey:'activation:real-owner',consent:false});
assert.equal((await complete('three')).status,'completed');assert.equal(writes.length,before+1,'DO avoids repeated writes after recorded activation');
await ctx.fiber.dispose();await complete('four');assert.equal(writes.length,before+1);assert.equal(d1Reads,0);
sqlite.close();console.log('Host completion observers: true plugin injection order, absence, disposal, reload and owner SQLite completion passed');
