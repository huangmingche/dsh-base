import {array,boolean,input,object,string,type PanelAction,type PanelDefinition} from '@dsh-base/client-saas-ui/transport';
interface Profile {user:{id:string;name:string;username:string;email:string;emailVerified:boolean;image:string|null;avatarFileId:string|null};canChangePassword:boolean;files:{id:string;name:string}[]}
const okay=(value:unknown)=>{if(object(value).ok!==true)throw new Error('Invalid response');return null;};
export const definition:PanelDefinition={bundle:'dsh-base:account-profile',access:'account',
  load:async({request}):Promise<Profile>=>{
    const raw=object(await request('/api/saas/account-profile')),user=object(raw.user);
    let status:Record<string,unknown>|undefined;
    try{status=object(await request('/api/saas/files/status'));}catch{/* Optional storage status does not prevent profile editing. */}
    const files:Profile['files']=[];
    if(status?.enabled===true&&status.ready===true){
      const owned=new Map<string,{id:string;name:string;contentType:string}>();
      const cursorPattern=/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/u;
      let cursor:string|null=null;
      for(let page=0;page<3;page++){
        const response=object(await request(`/api/saas/files?limit=100${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`));
        const items=array(response.items);
        if(items.length>100)throw new Error('Invalid file page');
        for(const value of items){const row=object(value),id=string(row.id);owned.set(id,{id,name:string(row.name),contentType:string(row.contentType)});}
        if(owned.size>200)throw new Error('File inventory exceeds account limit');
        const next=response.nextCursor;
        if(next===null){cursor=null;break;}
        if(typeof next!=='string'||!cursorPattern.test(next)||(cursor!==null&&next<=cursor)||items.length===0||string(object(items[items.length-1]).id)!==next)throw new Error('Invalid file cursor');
        cursor=next;
      }
      if(cursor!==null)throw new Error('Incomplete file inventory');
      for(const row of owned.values())if(['image/png','image/jpeg','image/webp','image/gif','image/avif'].includes(row.contentType))files.push({id:row.id,name:row.name});
    }
    return {user:{id:string(user.id),name:string(user.name),username:string(user.username),email:string(user.email),emailVerified:boolean(user.emailVerified),image:user.image===null?null:string(user.image),avatarFileId:user.avatarFileId===null?null:string(user.avatarFileId)},canChangePassword:boolean(raw.canChangePassword),files};
  },
  view:(value,t)=>{const {user}=value as Profile;return {facts:[{label:'name',value:user.name},{label:'username',value:user.username},{label:'email',value:user.email},{label:'verified',value:t(user.emailVerified?'yes':'no')}]};},
  actions:value=>{const state=value as Profile;return [
    {id:'name',label:'save',needsAuth:true,method:'PUT',fields:[{id:'name',label:'name',required:true,value:state.user.name,maxLength:80}],path:()=>'/api/saas/account-profile',body:values=>({name:input(values,'name')}),parse:okay},
    {id:'avatar',label:'save',needsAuth:true,method:'PUT',fields:[{id:'avatar',label:'avatar',type:'select',value:state.user.avatarFileId??'',options:[{value:'',label:'none',translated:true},...state.files.map(file=>({value:file.id,label:file.name}))]}],path:()=>'/api/saas/account-profile',body:values=>({name:state.user.name,avatarFileId:input(values,'avatar')||null}),parse:okay},
    {id:'password',label:'changePassword',needsAuth:true,disabled:!state.canChangePassword,fields:[{id:'currentPassword',label:'currentPassword',type:'password',required:true,maxLength:128},{id:'newPassword',label:'newPassword',type:'password',required:true,minLength:8,maxLength:128}],path:()=>'/api/saas/account-profile/password',body:values=>({currentPassword:input(values,'currentPassword'),newPassword:input(values,'newPassword')}),parse:okay},
  ] satisfies PanelAction[];},
};
