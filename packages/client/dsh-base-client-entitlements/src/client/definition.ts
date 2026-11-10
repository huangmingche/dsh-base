import { array, boolean, object, string, type PanelDefinition } from '@dsh-base/client-saas-ui/transport';
interface Feature {id:string;label?:string;planIds:string[]}
function read(value:unknown):Feature[] { return array(object(value).features).map(item=>{ const row=object(item); return {id:string(row.id),...(row.label===undefined?{}:{label:string(row.label)}),planIds:array(row.planIds).map(string)}; }); }
export const definition: PanelDefinition = {
  bundle:'dsh-base:entitlements',access:'account',
  load:async({request})=>read(await request('/api/entitlements')),
  view:(value)=>{const features=value as Feature[];return {empty:features.length===0,rows:features.map(feature=>({id:feature.id,facts:[{label:'feature',value:feature.label??feature.id},{label:'plans',value:feature.planIds.join(', ')}],actions:[{id:`check:${feature.id}`,label:'check',method:'GET',needsAuth:true,path:()=>`/api/entitlements?feature=${encodeURIComponent(feature.id)}`,parse:value=>{const result=object(value);return {feature:string(result.feature),allowed:boolean(result.allowed)};},result:value=>{const result=value as {feature:string;allowed:boolean};return [{label:'feature',value:result.feature},{label:'allowed',value:result.allowed?'✓':'—'}];}}]}))};},
};
