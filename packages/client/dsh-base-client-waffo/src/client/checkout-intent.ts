/** An intent is navigation state, never proof of payment or authorization. */
export interface CheckoutIntent {readonly planId:string;readonly key:string;readonly returnPath:string;readonly locale:string;readonly createdAt:number;readonly userId?:string}
export interface CheckoutIntentStorage {read():CheckoutIntent|undefined;write(value:CheckoutIntent):void;clear():void}
export const CHECKOUT_INTENT_TTL=30*60_000;
const storageKey='dsh-base:checkout-intent';
export function safePaymentPath(value:string):string {
  if(value.length>2048||!value.startsWith('/')||value.startsWith('//')||/[\\\u0000-\u0020\u007f]/u.test(value)||/%(?:2f|5c|0[0-9a-f]|1[0-9a-f]|7f)/iu.test(value))throw new Error('Invalid payment path');
  return value;
}
export function readCheckoutIntent(value:unknown,now=Date.now()):CheckoutIntent|undefined {
  if(typeof value!=='object'||value===null||Array.isArray(value))return;
  const row=value as Record<string,unknown>;
  if(Object.keys(row).some(key=>!['planId','key','returnPath','locale','createdAt','userId'].includes(key))
    ||typeof row.planId!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/u.test(row.planId)||typeof row.key!=='string'||!/^[a-zA-Z0-9_-]{16,128}$/u.test(row.key)
    ||typeof row.locale!=='string'||row.locale.length>20||typeof row.returnPath!=='string'||typeof row.createdAt!=='number'||!Number.isSafeInteger(row.createdAt)
    ||now-row.createdAt<0||now-row.createdAt>CHECKOUT_INTENT_TTL||(row.userId!==undefined&&(typeof row.userId!=='string'||!row.userId||row.userId.length>256)))return;
  try {safePaymentPath(row.returnPath);}catch{return;}
  return row as unknown as CheckoutIntent;
}
export function resumePath(path:string,key:string):string {const url=new URL(safePaymentPath(path),'https://local.invalid');url.searchParams.set('checkout_intent',key);return url.pathname+url.search+url.hash;}
export function resumeKey(path:string):string|null {try {const url=new URL(safePaymentPath(path),'https://local.invalid');return url.searchParams.getAll('checkout_intent').length===1?url.searchParams.get('checkout_intent'):null;}catch{return null;}}
export function browserCheckoutIntents():CheckoutIntentStorage {
  return {read(){try {const raw=sessionStorage.getItem(storageKey);const value=raw===null?undefined:readCheckoutIntent(JSON.parse(raw));if(!value)sessionStorage.removeItem(storageKey);return value;}catch{return undefined;}},
    write(value){sessionStorage.setItem(storageKey,JSON.stringify(value));},clear(){try {sessionStorage.removeItem(storageKey);}catch{/* No private credential is retained. */}}};
}
