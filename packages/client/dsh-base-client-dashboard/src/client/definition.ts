import { boolean, number, object, type Fact, type PanelDefinition } from '@dsh-base/client-saas-ui/transport';
interface Section {available:boolean; values:Record<string,number>}
function read(value:unknown):Record<string,Section> {
  const raw=object(value), result:Record<string,Section>={};
  for(const [key,fields] of Object.entries({users:['total'],payments:['orders','activeSubscriptions','refundedOrders'],email:['sending','accepted','rejected','unknown']})) {
    const section=object(raw[key]),available=boolean(section.available);result[key]={available,values:{}};
    if(available)for(const field of fields)result[key]!.values[field]=number(section[field]);
  }return result;
}
export const definition:PanelDefinition={bundle:'dsh-base:dashboard',access:'account',load:async({request})=>read(await request('/api/operations-dashboard')),
  view:(value,t)=>{const sections=value as Record<string,Section>;return {facts:Object.entries(sections).flatMap(([key,section]):Fact[]=>section.available?Object.entries(section.values).map(([label,value])=>({label:label==='total'?'users':label,value:String(value)})):[{label:key==='payments'?'orders':key,value:t('unavailable')}])};},
};
