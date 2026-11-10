/** Actual browser navigation and official atoms. Provider/auth traffic remains local fixtures. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {acceptanceLaunchOptions,closeAcceptanceBrowser} from '../../../../apps/web/scripts/acceptance-config.mjs';
const root=resolve(import.meta.dirname,'../../../..'),app=resolve(root,'apps/web'),require=createRequire(resolve(app,'package.json'));
const vite=await import(require.resolve('vite')),puppeteer=require('puppeteer-core'),out=resolve(root,'.artifacts/waffo-payment-panel-browser');
const config={configFile:resolve(app,'vite.parity.config.ts'),root:resolve(import.meta.dirname,'browser'),build:{outDir:resolve(out,'bundle'),emptyOutDir:true},logLevel:'error'};
const catalog={provider:'waffo',ready:true,priceSource:'deployment',plans:[{id:'pro',name:'Pro',productId:'PROD_1234567890abcdefghijkl',type:'subscription',currency:'USD',price:{amount:'19.00',interval:'month',intervalCount:1},features:[{id:'platform_ai',label:'Platform AI'}]}]};
let server,browser;const cases=[];
try {
 await mkdir(out,{recursive:true});await vite.build(config);server=await vite.preview({...config,preview:{host:'127.0.0.1',port:0,strictPort:true}});
 const origin=`http://127.0.0.1:${server.httpServer.address().port}`;browser=await puppeteer.launch(acceptanceLaunchOptions());
 for(const locale of ['en','zh'])for(const theme of ['light','dark'])for(const width of [1280,390]){
  const page=await browser.newPage();page.setDefaultTimeout(15000);let signedIn=false;const checkouts=[],errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setViewport({width,height:1000});await page.emulateMediaFeatures([{name:'prefers-color-scheme',value:theme},{name:'prefers-reduced-motion',value:'reduce'}]);await page.setRequestInterception(true);
  page.on('request',request=>{const url=new URL(request.url());const respond=value=>request.respond({status:200,contentType:'application/json',body:JSON.stringify(value)});
   if(url.hostname==='pancake.waffo.ai')return request.respond({status:200,contentType:'text/html',body:'<p>Hosted checkout fixture</p>'});
   if(url.origin!==origin)return request.abort();
   if(url.pathname==='/api/auth-policy')return respond({signUpEnabled:false,email:{enabled:false,ready:false,provider:null},googleEnabled:false});
   if(url.pathname==='/api/auth/get-session')return respond(signedIn?{user:{id:'alice'}}:null);
   if(url.pathname==='/api/auth/sign-in/username'){signedIn=true;return respond({user:{id:'alice'}});}
   if(url.pathname==='/api/payments')return respond(catalog);
   if(url.pathname==='/api/payments/account')return respond({orders:[],portalAvailable:true});
   if(url.pathname==='/api/payments/checkout'){checkouts.push({body:JSON.parse(request.postData()),key:request.headers()['idempotency-key']});return respond({id:'fixture',url:'https://pancake.waffo.ai/store/fixture#token=fixture'});}
   if(url.pathname.startsWith('/api/'))return request.abort();return request.continue();
  });
  await page.goto(locale==='zh' ? origin+'/zh-CN' : origin+'/');await page.waitForSelector('[data-waffo-panel][data-state="ready"]');
  assert.equal(await page.$eval('[data-plan-price]',element=>element.textContent.includes('19')),true);
  assert.equal(await page.$eval('main',element=>element.textContent.includes('Platform AI')),true);
  const styles=await page.evaluate(()=>{const read=selector=>{const el=document.querySelector(selector),css=getComputedStyle(el),box=el.getBoundingClientRect();return {background:css.backgroundColor,borderRadius:css.borderRadius,color:css.color,font:css.font,height:box.height,width:box.width};};return [read('[data-payment-plan] button'),read('#reference button')];});
  assert.deepEqual(styles[0],styles[1],'the payment panel uses the unchanged official Button');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:resolve(out,`${locale}-${theme}-${width}.png`)});
  await page.click('[data-payment-plan] button');await page.waitForSelector('[data-auth-step="identifier"]');assert.equal(checkouts.length,0,'guest cannot create a checkout');
  const intent=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('dsh-base:checkout-intent')));assert.equal(intent.planId,'pro');
  await page.type('input[name="username"]','alice');await page.click('[data-auth-dialog] button[type="submit"]');await page.waitForSelector('[data-auth-step="password"]');
  await page.type('input[name="password"]','fixture-password');await page.click('[data-auth-dialog] button[type="submit"]');
  await page.waitForFunction(()=>location.hostname==='pancake.waffo.ai');assert.equal(checkouts.length,1);assert.equal(checkouts[0].key,intent.key);assert.equal(checkouts[0].body.planId,'pro');assert.equal(checkouts[0].body.returnPath,'/?payment=return');assert.equal(checkouts[0].body.analyticsConsent,false);
  assert.deepEqual(errors,[]);cases.push({locale,theme,width,officialButton:true,guestNoCheckout:true,loginIntentRestored:true,stableIdempotency:true});await page.close();
 }
 await writeFile(resolve(out,'report.json'),JSON.stringify({ok:true,cases},null,2));console.log(`payment panel: ${cases.length} browser cases passed`);
}finally{await closeAcceptanceBrowser(browser);await server?.close();}
