/** Caller enforcement over real SQLite payment projections; no provider requests. */
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
registerHooks({resolve(specifier,context,next){
  if(specifier==='agents')return {url:'data:text/javascript,export async function getAgentByName(){throw Error("unexpected Agent execution")}',shortCircuit:true};
  return next(specifier,context);
}});
const {SessionHostObject}=await import('../src/do.ts');
const payments=new DatabaseSync(':memory:');
payments.exec(readFileSync(new URL('../../dsh-base-cloudflare-worker-payment-waffo/schema.sql',import.meta.url),'utf8'));
const AUTH_DB={withSession(){return {prepare(query:string){let parameters:unknown[]=[];return {
  bind(...values:unknown[]){parameters=values;return this;},async first(){return payments.prepare(query).get(...parameters as never[])??null;},
};}};}};
const suffix='1234567890abcdefghijkl',scope=`test:MER_${suffix}:STO_${suffix}`;
const env={AUTH_SECRET:'test-internal-secret',AUTH_DB,AUTH_BASE_URL:'https://app.example',WAFFO_ENABLED:'true',WAFFO_ENVIRONMENT:'test',
  WAFFO_MERCHANT_ID:`MER_${suffix}`,WAFFO_STORE_ID:`STO_${suffix}`,WAFFO_PRIVATE_KEY:'fixture',
  WAFFO_PLANS_JSON:JSON.stringify([{id:'pro',productId:`PROD_${suffix}`,type:'subscription',currency:'USD'}]),
  ENTITLEMENTS_FEATURES_JSON:'[{"id":"pro-ai","planIds":["pro"]}]',ENTITLEMENTS_OPERATIONS_JSON:'{"platform_ai":"pro-ai"}',
  PLATFORM_AI_ENABLED:'true',AI_GATEWAY_ID:'fixture-gateway'};
const hosts:DatabaseSync[]=[];
function host(owner:string|undefined,bindings:unknown=env){const db=new DatabaseSync(':memory:');hosts.push(db);return new SessionHostObject({id:{name:owner===undefined?'isolated':`owner:${owner}:default-v49`},storage:{sql:{exec(query:string,...values:unknown[]){
  const rows=db.prepare(query).all(...values as never[]);return {toArray:()=>rows,[Symbol.iterator]:()=>rows[Symbol.iterator]()};
}}}},bindings as never);}
const alice=host('alice'),bob=host('bob');
const authorize=(target:typeof alice,params:Record<string,unknown>={operation:'platform_ai'},token: string|undefined=env.AUTH_SECRET)=>target.fetch(new Request('https://host/api/session-host',{method:'POST',headers:token===undefined?{}:{'x-dsh-internal-token':token},body:JSON.stringify({method:'authorizeOperation',params})}));
try {
  assert.equal((await authorize(alice,undefined,'wrong')).status,403,'public browser requests cannot invoke internal authorization');
  assert.equal((await authorize(alice,{operation:'platform_ai',ownerId:'bob'})).status,400,'owner identities are never accepted in the payload');
  assert.equal((await authorize(alice,{operation:'unprotected-alias'})).status,400,'the platform provider cannot be bypassed with another operation');
  assert.equal((await authorize(alice)).status,402,'unpaid owner is denied');
  const calls:string[]=[];const agent={async setUserCredential(){calls.push('credential');},async setDeepSeekBaseURL(){calls.push('endpoint');}};
  const configure=(alice as unknown as {configureAgentForModel(agent:unknown,model:string,disabled:string[]):Promise<string>}).configureAgentForModel.bind(alice);
  await assert.rejects(configure(agent,'cloudflare-ai-gateway/deepseek-flash',[]),error=>error instanceof Error&&error.name==='AgentExecutionFailed'&&error.message==='entitlement_required');
  assert.deepEqual(calls,[],'Host denial happens before gateway execution or credential configuration');
  payments.prepare(`INSERT INTO dsh_waffo_orders(scope,id,user_id,checkout_id,plan_id,kind,status,period_end,refunded,eligible,revision,last_event,updated_at)
    VALUES(?,?,?,?,?,'subscription','active',?,0,1,1,'fixture',?)`).run(scope,'order','alice','checkout','pro',new Date(Date.now()+3600000).toISOString(),Date.now());
  assert.equal((await authorize(alice)).status,200);
  assert.equal((await authorize(bob)).status,402,'another owner cannot reuse the grant');
  await configure(agent,'cloudflare-ai-gateway/deepseek-flash',[]);assert.deepEqual(calls,['credential','endpoint']);
  payments.prepare("UPDATE dsh_waffo_orders SET eligible=0,refunded=1 WHERE id='order'").run();
  assert.equal((await authorize(alice)).status,402,'refund revokes the next call');
  payments.prepare("UPDATE dsh_waffo_orders SET eligible=1,refunded=0,period_end=? WHERE id='order'").run(new Date(Date.now()-1000).toISOString());
  assert.equal((await authorize(alice)).status,402,'known expiry denies without waiting for a webhook');
  assert.equal((await authorize(host(undefined))).status,402,'configured paid operations require a trusted owner');
  assert.equal((await authorize(host(undefined,{...env,ENTITLEMENTS_OPERATIONS_JSON:'{}'}))).status,200,'no mapping preserves the existing free policy');
  assert.equal((await authorize(host('alice',{...env,ENTITLEMENTS_OPERATIONS_JSON:'not-json'}))).status,503,'malformed policy fails closed');
  assert.equal((await authorize(host('alice',{...env,AUTH_DB:undefined}))).status,503,'missing authoritative storage is unavailable, never paid access');
  console.log('paid inference: owner-scoped internal authentication, Host preflight, refunds, expiry, default free and fail-closed outages');
} finally {payments.close();for(const db of hosts)db.close();}
