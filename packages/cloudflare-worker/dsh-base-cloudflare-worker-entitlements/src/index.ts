import type {Context} from '@deepseek-ai/cordis';
import type {WorkerHandler} from '@dsh-base/cloudflare-worker-http';
import type {AuthFace} from '@dsh-base/cloudflare-worker-auth';
import type {PaymentService} from '@dsh-base/cloudflare-worker-payment-waffo';
import {identifier,parseFeatures,type FeatureDeclaration} from '../../dsh-base-cloudflare-worker-payment-waffo/src/catalog.ts';
import {paymentConfig} from '../../dsh-base-cloudflare-worker-payment-waffo/src/config.ts';
import {PaymentStore} from '../../dsh-base-cloudflare-worker-payment-waffo/src/store.ts';
export const name='@dsh-base/cloudflare-worker-entitlements';
export const inject=['http','auth','payments'];
export const Config=undefined;
export type {FeatureDeclaration} from '../../dsh-base-cloudflare-worker-payment-waffo/src/catalog.ts';
export interface EntitlementDecision {readonly allowed:boolean;readonly reason:'allowed'|'no_entitlement'|'unavailable'|'unknown_feature'}
export interface EntitlementService {
  declarations(env:unknown):readonly FeatureDeclaration[];
  authorize(env:unknown,userId:string,feature:string):Promise<EntitlementDecision>;
  authorizeOperation(env:unknown,userId:string|undefined,operation:string):Promise<EntitlementDecision>;
}
declare module '@deepseek-ai/cordis' {interface Context {entitlements:EntitlementService}}
export function declarations(env:unknown):readonly FeatureDeclaration[]|undefined {
  try {
    const result=parseFeatures(JSON.parse((env as {ENTITLEMENTS_FEATURES_JSON?:string})?.ENTITLEMENTS_FEATURES_JSON??'null'));
    return result?.length?result:undefined;
  }catch{return undefined;}
}
export function operationDeclarations(env:unknown):Readonly<Record<string,string>>|undefined {
  try {const value:unknown=JSON.parse((env as {ENTITLEMENTS_OPERATIONS_JSON?:string})?.ENTITLEMENTS_OPERATIONS_JSON??'{}');
    if(typeof value!=='object'||value===null||Array.isArray(value)||Object.keys(value).length>100)return undefined;
    if(!Object.entries(value).every(([operation,feature])=>identifier(operation)&&identifier(feature)))return undefined;
    return value as Record<string,string>;
  }catch{return undefined;}
}
export function createEntitlements(payments:Pick<PaymentService,'ready'|'allows'>):EntitlementService {
  const authorize=async(env:unknown,userId:string,feature:string):Promise<EntitlementDecision>=>{
    const configured=declarations(env);
    if(!configured||!payments.ready(env))return {allowed:false,reason:'unavailable'};
    const declaration=configured.find(row=>row.id===feature);
    if(!declaration)return {allowed:false,reason:'unknown_feature'};
    if(typeof userId!=='string'||userId.length===0)return {allowed:false,reason:'no_entitlement'};
    try {const allowed=await payments.allows(env,userId,declaration.planIds);return {allowed,reason:allowed?'allowed':'no_entitlement'};}
    catch{return {allowed:false,reason:'unavailable'};}
  };
  return {declarations:env=>declarations(env)??[],authorize,async authorizeOperation(env,userId,operation){
    const mapping=operationDeclarations(env);
    if(!mapping||!identifier(operation))return {allowed:false,reason:'unavailable'};
    const feature=Object.hasOwn(mapping,operation)?mapping[operation]:undefined;
    if(feature===undefined)return {allowed:true,reason:'allowed'};
    if(!declarations(env)?.some(row=>row.id===feature))return {allowed:false,reason:'unavailable'};
    return authorize(env,userId??'',feature);
  }};
}
export class EntitlementError extends Error {
  readonly status:402|503;readonly code:'entitlement_required'|'entitlements_unavailable';
  constructor(unavailable:boolean){const code=unavailable?'entitlements_unavailable':'entitlement_required';super(code);this.name='EntitlementError';this.status=unavailable?503:402;this.code=code;}
}
/** Trusted server callers must derive owner identity themselves. Undeclared operations preserve the deployment's free behavior. */
export async function assertOperationAllowed(env:unknown,userId:string|undefined,operation:string):Promise<void> {
  const service=createEntitlements({ready:environment=>paymentConfig(environment as Parameters<typeof paymentConfig>[0])!==undefined,
    allows:async(environment,user,plans)=>{const config=paymentConfig(environment as Parameters<typeof paymentConfig>[0]);if(!config)throw new Error('payments unavailable');return new PaymentStore(config).allows(user,plans);}});
  const decision=await service.authorizeOperation(env,userId,operation);
  if(!decision.allowed)throw new EntitlementError(decision.reason==='unavailable'||decision.reason==='unknown_feature');
}
export function createEntitlementHandler(auth:AuthFace,service:EntitlementService):WorkerHandler {
  return async(request,env)=>{
    const url=new URL(request.url);
    if(url.pathname!=='/api/entitlements')return undefined;
    const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});
    if(request.method!=='GET')return json({error:'method_not_allowed'},405);
    try {
      const user=await auth.session(request,env);if(!user)return json({error:'unauthenticated'},401);
      const feature=url.searchParams.get('feature');
      if(feature===null)return json({features:service.declarations(env)});
      if(!identifier(feature)||[...url.searchParams.keys()].some(key=>key!=='feature')||url.searchParams.getAll('feature').length!==1)return json({error:'invalid_feature'},400);
      const decision=await service.authorize(env,user.id,feature);
      return json({feature,...decision},decision.reason==='unavailable'?503:decision.reason==='unknown_feature'?404:200);
    }catch{return json({error:'entitlements_unavailable'},503);}
  };
}
export function apply(ctx:Context):void {
  const service=createEntitlements(ctx.payments);
  ctx.provide('entitlements',service);
  ctx.effect(()=>ctx.http.use(createEntitlementHandler(ctx.auth,service),13),'dsh-base: paid feature authorization');
}
