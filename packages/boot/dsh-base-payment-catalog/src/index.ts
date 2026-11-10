/** Public deployment declarations only: no credentials, provider requests or inferred prices. */
export interface PlanPrice {readonly amount:string;readonly interval?:'day'|'week'|'month'|'year';readonly intervalCount?:number}
export interface PaymentPlan {readonly id:string;readonly name?:string;readonly description?:string;readonly productId:string;readonly type:'one_time'|'subscription';readonly currency:string;readonly price?:PlanPrice}
export interface FeatureDeclaration {readonly id:string;readonly label?:string;readonly planIds:readonly string[]}
export interface PublicPaymentPlan extends PaymentPlan {readonly features:readonly {id:string;label:string}[]}
export interface PublicPaymentCatalog {readonly provider:'waffo';readonly ready:boolean;readonly plans:readonly PublicPaymentPlan[];readonly priceSource:'deployment'}
const object=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value);
const text=(value:unknown,max:number):value is string=>typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/u.test(value);
export const identifier=(value:unknown):value is string=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,80}$/u.test(value);
export function validPrice(value:unknown,type:PaymentPlan['type'],currency:string):value is PlanPrice {
  if(!object(value)||Object.keys(value).some(key=>!['amount','interval','intervalCount'].includes(key))||typeof value.amount!=='string'||!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/u.test(value.amount))return false;
  const fraction=value.amount.split('.')[1]?.length??0;
  try {if(fraction>(new Intl.NumberFormat('en',{style:'currency',currency}).resolvedOptions().maximumFractionDigits??2))return false;}catch{return false;}
  if(type==='one_time')return value.interval===undefined&&value.intervalCount===undefined;
  return ['day','week','month','year'].includes(String(value.interval))&&Number.isSafeInteger(value.intervalCount)&&Number(value.intervalCount)>=1&&Number(value.intervalCount)<=120;
}
export function parsePlans(value:unknown):readonly PaymentPlan[]|undefined {
  if(!Array.isArray(value)||value.length>100)return undefined;
  const result:PaymentPlan[]=[];
  for(const row of value){
    if(!object(row)||Object.keys(row).some(key=>!['id','name','description','productId','type','currency','price'].includes(key))||!identifier(row.id)
      ||!text(row.productId,80)||!/^PROD_[a-zA-Z0-9]{22}$/u.test(row.productId)||!['one_time','subscription'].includes(String(row.type))
      ||typeof row.currency!=='string'||!/^[A-Z]{3}$/u.test(row.currency)||(row.name!==undefined&&!text(row.name,120))
      ||(row.description!==undefined&&!text(row.description,500))||(row.price!==undefined&&!validPrice(row.price,row.type as PaymentPlan['type'],row.currency))
      ||result.some(plan=>plan.id===row.id||(plan.productId===row.productId&&plan.currency===row.currency)))return undefined;
    result.push({id:row.id,productId:row.productId,type:row.type as PaymentPlan['type'],currency:row.currency,
      ...(row.name===undefined?{}:{name:row.name as string}),...(row.description===undefined?{}:{description:row.description as string}),
      ...(row.price===undefined?{}:{price:{...row.price as PlanPrice}})});
  }
  return result;
}
export function parseFeatures(value:unknown):readonly FeatureDeclaration[]|undefined {
  if(!Array.isArray(value)||value.length>100)return undefined;
  const result:FeatureDeclaration[]=[];
  for(const row of value){
    if(!object(row)||Object.keys(row).some(key=>!['id','label','planIds'].includes(key))||!identifier(row.id)
      ||(row.label!==undefined&&!text(row.label,160))||!Array.isArray(row.planIds)||!row.planIds.length||row.planIds.length>100
      ||!row.planIds.every(identifier)||new Set(row.planIds).size!==row.planIds.length||result.some(feature=>feature.id===row.id))return undefined;
    result.push({id:row.id,...(row.label===undefined?{}:{label:row.label as string}),planIds:[...row.planIds]});
  }
  return result;
}
/** Build-time SSR shares the exact declared plan/feature projection used by the API. Ready requires live Worker configuration. */
export function publicCatalogFromDeployment(value:{waffoPlans?:unknown;entitlementFeatures?:unknown},ready=false):PublicPaymentCatalog {
  const plans=parsePlans(value.waffoPlans??[]),features=parseFeatures(value.entitlementFeatures??[]);
  if(!plans||!features||features.some(feature=>feature.planIds.some(id=>!plans.some(plan=>plan.id===id))))return {provider:'waffo',ready:false,plans:[],priceSource:'deployment'};
  return {provider:'waffo',ready,priceSource:'deployment',plans:plans.map(plan=>({...plan,features:features.filter(feature=>feature.planIds.includes(plan.id)).map(feature=>({id:feature.id,label:feature.label??feature.id}))}))};
}
export function publicCatalog(env:unknown,ready=false):PublicPaymentCatalog {
  try {const value=env as {WAFFO_PLANS_JSON?:string;ENTITLEMENTS_FEATURES_JSON?:string};return publicCatalogFromDeployment({waffoPlans:JSON.parse(value?.WAFFO_PLANS_JSON??'[]'),entitlementFeatures:JSON.parse(value?.ENTITLEMENTS_FEATURES_JSON??'[]')},ready);}
  catch{return {provider:'waffo',ready:false,plans:[],priceSource:'deployment'};}
}
