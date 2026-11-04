#!/usr/bin/env node
import { acceptanceLaunchOptions, closeAcceptanceBrowser } from "../../scripts/acceptance-config.mjs";
/** Real official browser uploader and intake guards; controlled HTTP is separate from Host persistence tests. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const app=resolve(import.meta.dirname,"../.."),requireFromApp=createRequire(resolve(app,"package.json"));
const puppeteer=requireFromApp("puppeteer-core").default,vite=await import(requireFromApp.resolve("vite"));
const configFile=resolve(app,"vite.parity.config.ts"),output=resolve(app,"dist/parity-evidence");
let browser,server;const cases=[],requests=[];
const fixtureHost={name:"controlled-upload-host",configurePreviewServer(server){server.middlewares.use(async(req,res,next)=>{
  const url=new URL(req.url,"http://fixture.test");
  if(!["/api/session/uploadFileBinary","/api/fileUploads/upload","/api/session/attachment"].includes(url.pathname))return next();
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks);
  const body=url.pathname==="/api/session/uploadFileBinary"?undefined:JSON.parse(bytes.toString());
  requests.push({path:url.pathname,query:Object.fromEntries(url.searchParams),body,bytes:bytes.length});
  const name=url.searchParams.get("name")??body?.payload?.args?.request?.name??"file";
  if(name==="slow.txt")await new Promise(resolve=>setTimeout(resolve,200));
  const image=url.searchParams.has("mediaType");
  const result=image?{ok:false,error:{code:"session/attachment-invalid",message:"Image processing is unavailable",details:{reason:"IMAGE_PROCESSOR_UNAVAILABLE"}}}
    :name==="refuse.txt"?{ok:false,error:{code:"session/attachment-invalid",message:"fixture refusal",details:{reason:"FILE_NOT_STAGED"}}}
    :{ok:true,value:{receiptId:`receipt-${name}`,file:{attachmentId:"sha256-fixture",name,bytes:body?3:bytes.length}}};
  res.setHeader("content-type","application/json");res.end(JSON.stringify(body?{type:"server-response",rpcId:body.rpcId,result}:result));
});}};
try{
  await mkdir(output,{recursive:true});await vite.build({configFile,logLevel:"error"});
  server=await vite.preview({configFile,plugins:[fixtureHost],logLevel:"error",preview:{host:"127.0.0.1",port:0,strictPort:true}});const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
  browser=await puppeteer.launch(acceptanceLaunchOptions());
  for(const locale of ["en","zh"]){
    const page=await browser.newPage();page.setDefaultTimeout(10000);await page.setViewport({width:1280,height:900});const errors=[];
    page.on("pageerror",e=>errors.push(e.message));page.on("console",m=>{if(m.type()==="error")errors.push(m.text())});
    await page.goto(`${origin}/${locale==="zh"?"zh-CN/":""}agent/fixture?surface=upload&locale=${locale}`,{waitUntil:"networkidle0"});
    try{await page.waitForSelector('input[type="file"]');}catch(error){console.error(errors);throw error;}
    assert.equal(await page.$eval('input[type="file"]',element=>element.disabled),false,"shared file picker remains available");
    const before=requests.length;
    for(const method of ["picker","drop"]){
      const handled=await page.evaluate(method=>{
        const transfer=new DataTransfer();transfer.items.add(new File(["image"],"blocked.png",{type:"image/png"}));
        if(method==="picker") { const input=document.querySelector('input[type="file"]');input.files=transfer.files;input.dispatchEvent(new Event("change",{bubbles:true})); }
        else { const event=new DragEvent("drop",{bubbles:true,cancelable:true,dataTransfer:transfer});document.dispatchEvent(event);return event.defaultPrevented; }
        return true;
      },method);
      assert.equal(handled,true,`${locale}/${method}: real official intake handler must consume the event`);
      await page.waitForFunction(()=>document.body.innerText.includes(window.__UPLOAD_PARITY__.expectedImageMessage));
      assert.deepEqual(await page.evaluate(()=>window.__UPLOAD_PARITY__.calls),[],`${locale}/${method}: images must be refused before intake/upload`);
      assert.equal(requests.length,before);
      cases.push({locale,method,kind:"image",uploadRequests:0,localizedRefusal:true});
    }
    await page.evaluate(()=>{const transfer=new DataTransfer();transfer.items.add(new File(["ordinary file"],"picked.txt",{type:"text/plain"}));const input=document.querySelector('input[type="file"]');input.files=transfer.files;input.dispatchEvent(new Event("change",{bubbles:true}));});
    await page.waitForFunction(()=>window.__UPLOAD_PARITY__.outcomes.length===1);
    assert.equal(await page.evaluate(()=>window.__UPLOAD_PARITY__.outcomes[0].value.receiptId),"receipt-picked.txt");
    const raw=await page.evaluate(()=>window.__UPLOAD_PARITY__.raw());assert.equal(raw.value.receiptId,"receipt-raw.txt");
    const encoded=await page.evaluate(()=>window.__UPLOAD_PARITY__.bytes());assert.equal(encoded.value.receiptId,"receipt-encoded.txt");
    const refusal=await page.evaluate(()=>window.__UPLOAD_PARITY__.raw("refuse.txt"));assert.equal(refusal.ok,false);assert.equal(refusal.error.details.reason,"FILE_NOT_STAGED");
    const image=await page.evaluate(()=>window.__UPLOAD_PARITY__.image());assert.equal(image.ok,false);assert.equal(image.error.details.reason,"IMAGE_PROCESSOR_UNAVAILABLE");
    assert.equal(await page.evaluate(()=>window.__UPLOAD_PARITY__.abort()),"AbortError");
    assert.ok(requests.filter(request=>request.path==="/api/session/uploadFileBinary").every(request=>request.query.sessionId==="session-one"));
    assert.ok(requests.some(request=>request.path==="/api/fileUploads/upload"&&request.body.payload.args.sessionId==="session-one"&&request.body.payload.args.request.data==="YWJj"));
    await page.screenshot({path:resolve(output,`upload-${locale}-intake.png`),captureBeyondViewport:false});assert.deepEqual(errors,[]);await page.close();
    cases.push({locale,kind:"file-runtime",nativeWorker:true,rootRelativeDeepLink:true,receipt:true,encodedRpc:true,refusalPreserved:true,abort:true});
  }
  await writeFile(resolve(output,"upload-contract-report.json"),JSON.stringify({ok:true,scope:"Unchanged official InputBar and ComposerAttachments reject image picker/drop locally under the truthful zero-image Host contract; shared file intake invokes real official FileUploadRuntime Worker and Connection RPC with controlled HTTP. Persistence and receipt consumption require separate real Host acceptance.",cases},null,2));
  console.log(`official upload/intake contracts: ${cases.length} Chromium cases passed`);
}finally{await closeAcceptanceBrowser(browser);await server?.close();}
