interface Queue {push:(command:unknown[])=>unknown}
declare global {interface Window {$crisp?:Queue;CRISP_WEBSITE_ID?:string}}
/** No script, tracker or identity is sent until an explicit support action. */
export class CrispSupport {
  private script?:HTMLScriptElement;private pending?:Promise<void>;private cancel?:()=>void;private disposed=false;private loaded=false;
  open(websiteId:string):Promise<void>{
    if(this.disposed||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(websiteId))return Promise.reject(new Error('Unavailable'));
    if(window.CRISP_WEBSITE_ID&&window.CRISP_WEBSITE_ID!==websiteId)return Promise.reject(new Error('Different support configuration'));
    if(this.pending)return this.pending;
    if(this.loaded){window.$crisp?.push(['do','chat:show']);window.$crisp?.push(['do','chat:open']);return Promise.resolve();}
    window.CRISP_WEBSITE_ID=websiteId;const queue:Queue=window.$crisp??([] as unknown[][]);window.$crisp=queue;queue.push(['do','chat:open']);
    this.pending=new Promise<void>((resolve,reject)=>{
      const script=document.createElement('script');this.script=script;script.src='https://client.crisp.chat/l.js';script.async=true;
      const stop=(error?:Error)=>{clearTimeout(timer);this.cancel=undefined;this.pending=undefined;script.onload=null;script.onerror=null;if(error){script.remove();reject(error);}else{this.loaded=true;resolve();}};
      const timer=setTimeout(()=>stop(new Error('Support timeout')),15_000);this.cancel=()=>stop(new Error('Disposed'));
      script.onload=()=>{if(this.disposed)stop(new Error('Disposed'));else stop();};script.onerror=()=>stop(new Error('Support unavailable'));document.head.append(script);
    });return this.pending;
  }
  dispose():void{this.disposed=true;this.cancel?.();this.script?.remove();if(this.loaded)window.$crisp?.push(['do','chat:hide']);}
}
