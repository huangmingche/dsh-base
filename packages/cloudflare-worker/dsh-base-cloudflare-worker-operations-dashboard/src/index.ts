import type {Context} from '@deepseek-ai/cordis';
import type {WorkerHandler} from '@dsh-base/cloudflare-worker-http';
import type {AuthFace} from '@dsh-base/cloudflare-worker-auth';
import type {PaymentService} from '@dsh-base/cloudflare-worker-payment-waffo';
import {isSiteAdministrator} from '../../dsh-base-cloudflare-worker-site-config/src/store.ts';
export const name='@dsh-base/cloudflare-worker-operations-dashboard';
export const inject=['http','auth'];
export const Config=undefined;
type Available<T>={readonly available:true}&T;
type Unavailable={readonly available:false};
export interface OperationsSnapshot {
  readonly users:Available<{total:number}>|Unavailable;
  readonly payments:Available<{orders:number;activeSubscriptions:number;refundedOrders:number}>|Unavailable;
  readonly email:Available<{sending:number;accepted:number;rejected:number;unknown:number}>|Unavailable;
}
interface DashboardEnv {readonly AUTH_DB?:D1Database;readonly SITE_ADMIN_USER_IDS?:unknown}
/** Each module reports its own absence/outage; unavailable must never appear as zero. */
export async function operationsSnapshot(env:DashboardEnv,payments?:Pick<PaymentService,'ready'|'summary'>):Promise<OperationsSnapshot> {
  const users=async():Promise<OperationsSnapshot['users']>=>{
    try {if(!env.AUTH_DB)return {available:false};
      const row=await env.AUTH_DB.withSession('first-primary').prepare('SELECT COUNT(*) AS total FROM "user"').first<{total:number}>();
      if(!row)return {available:false};return {available:true,total:row.total};
    }catch{return {available:false};}
  };
  const orders=async():Promise<OperationsSnapshot['payments']>=>{
    try {if(!payments?.ready(env))return {available:false};return {available:true,...await payments.summary(env)};}
    catch{return {available:false};}
  };
  const email=async():Promise<OperationsSnapshot['email']>=>{
    try {if(!env.AUTH_DB)return {available:false};
      const rows=await env.AUTH_DB.withSession('first-primary').prepare('SELECT state,COUNT(*) AS total FROM dsh_email_deliveries GROUP BY state').all<{state:string;total:number}>();
      const value={sending:0,accepted:0,rejected:0,unknown:0};
      for(const row of rows.results){if(!Object.hasOwn(value,row.state))return {available:false};value[row.state as keyof typeof value]=row.total;}
      return {available:true,...value};
    }catch{return {available:false};}
  };
  const [userCounts,paymentCounts,emailCounts]=await Promise.all([users(),orders(),email()]);
  return {users:userCounts,payments:paymentCounts,email:emailCounts};
}
export function createOperationsHandler(auth:AuthFace,payments:()=>Pick<PaymentService,'ready'|'summary'>|undefined):WorkerHandler {
  return async(request,environment)=>{
    if(new URL(request.url).pathname!=='/api/operations-dashboard')return undefined;
    const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
    if(request.method!=='GET')return json({error:'method_not_allowed'},405);
    try {
      const user=await auth.session(request,environment);if(!user)return json({error:'unauthenticated'},401);
      const env=(environment??{})as DashboardEnv;
      if(!isSiteAdministrator(env,user.id))return json({error:'site_admin_required'},403);
      return json(await operationsSnapshot(env,payments()));
    }catch{return json({error:'operations_unavailable'},503);}
  };
}
export function apply(ctx:Context):void {
  ctx.effect(()=>ctx.http.use(createOperationsHandler(ctx.auth,()=>ctx.get('payments')),34),'dsh-base: private operations counts');
}
