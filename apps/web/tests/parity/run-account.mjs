#!/usr/bin/env node
import { acceptanceLaunchOptions, closeAcceptanceBrowser } from "../../scripts/acceptance-config.mjs";
/** Billing availability over the official section; local identity/sign-out stay live. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const app=resolve(import.meta.dirname,"../.."), requireFromApp=createRequire(resolve(app,"package.json"));
const puppeteer=requireFromApp("puppeteer-core").default,vite=await import(requireFromApp.resolve("vite"));
const configFile=resolve(app,"vite.parity.config.ts"),output=resolve(app,"dist/parity-evidence");
let browser,server;const cases=[];
const snapshot=page=>page.evaluate(()=>({text:document.querySelector("#root").innerText,links:[...document.querySelectorAll("#root a")].map(a=>{const b=a.getBoundingClientRect();return {text:a.textContent,href:a.getAttribute("href"),opacity:getComputedStyle(a).opacity,rect:[b.x,b.y,b.width,b.height].map(n=>Math.round(n*100)/100)};})}));
try{
  await mkdir(output,{recursive:true});await vite.build({configFile,logLevel:"error"});
  server=await vite.preview({configFile,logLevel:"error",preview:{host:"127.0.0.1",port:0,strictPort:true}});const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
  browser=await puppeteer.launch(acceptanceLaunchOptions());
  async function open(locale,state,side){const page=await browser.newPage();page.setDefaultTimeout(10000);await page.setViewport({width:1280,height:900,deviceScaleFactor:1});const errors=[],popups=[];page.on("pageerror",e=>errors.push(e.message));page.on("console",m=>{if(m.type()==="error")errors.push(m.text())});page.on("popup",p=>popups.push(p));await page.goto(`${origin}/?${new URLSearchParams({surface:"account",locale,state,side})}`,{waitUntil:"networkidle0"});await page.waitForFunction(()=>window.__ACCOUNT_PARITY__?.registered===true);await page.evaluate(()=>document.fonts.ready);return {page,errors,popups};}
  for(const locale of ["en","zh"]){
    const reference=await open(locale,"section","reference"),adapted=await open(locale,"section","adapted");
    assert.deepEqual(await snapshot(adapted.page),await snapshot(reference.page),`${locale}: account section changed beyond declared unavailable state`);
    const a=await reference.page.screenshot({path:resolve(output,`account-${locale}-official.png`),captureBeyondViewport:false}),b=await adapted.page.screenshot({path:resolve(output,`account-${locale}-adapted.png`),captureBeyondViewport:false});assert.ok(Buffer.from(a).equals(Buffer.from(b)));
    assert.equal(await adapted.page.evaluate(()=>window.__ACCOUNT_PARITY__.registeredLocale),"settings.account","seam must explicitly bind the original locale; StoredEntry.options does not carry renderer localization");
    const data=await snapshot(adapted.page);assert.match(data.text,/Local User/);assert.match(data.text,locale==="zh"?/不提供账单服务/:/Billing is unavailable/);assert.ok(data.links.length>=4);assert.ok(data.links.every(link=>link.opacity==="0.55"&&!link.href.includes("/login")));
    const before=adapted.page.url();
    for(const link of await adapted.page.$$("#root a")){await link.click();await link.focus();await adapted.page.keyboard.press("Enter");await adapted.page.keyboard.press("Space");}
    await adapted.page.click("#root a",{button:"middle"});
    const guarded=await adapted.page.evaluate(()=>{const a=document.querySelector("#root a");return ["click","auxclick","contextmenu"].map(type=>!a.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,button:type==="click"?0:type==="auxclick"?1:2})));});
    assert.deepEqual(guarded,[true,true,true]);assert.equal(adapted.page.url(),before);assert.equal(adapted.popups.length,0);assert.deepEqual(await adapted.page.evaluate(()=>window.__ACCOUNT_PARITY__.calls),[]);assert.deepEqual(reference.errors,[]);assert.deepEqual(adapted.errors,[]);
    cases.push({locale,state:"unavailable-billing",visibleLinks:data.links.length,blockedPointerKeyboardAuxAndContext:true,billingCalls:0,screenshotSha256:createHash("sha256").update(a).digest("hex")});await reference.page.close();await adapted.page.close();
    const menu=await open(locale,"menu","adapted");
    await menu.page.click("#root button");await menu.page.waitForSelector('[role="menuitem"]');
    await menu.page.evaluate(()=>[...document.querySelectorAll('[role="menuitem"]')].find(item=>item.textContent.trim()===window.__ACCOUNT_PARITY__.copy.signOut).click());
    await menu.page.waitForSelector('[role="dialog"]');
    await menu.page.evaluate(()=>[...document.querySelectorAll('[role="dialog"] button')].find(button=>button.textContent.trim()===window.__ACCOUNT_PARITY__.copy.signOut).click());
    await menu.page.waitForFunction(()=>window.__ACCOUNT_PARITY__.calls.includes("account/signOut"));
    assert.deepEqual(await menu.page.evaluate(()=>window.__ACCOUNT_PARITY__.calls),["account/signOut"]);assert.deepEqual(menu.errors,[]);
    cases.push({locale,state:"unchanged-account-menu",signOutCalls:1});await menu.page.close();
  }
  await writeFile(resolve(output,"account-report.json"),JSON.stringify({ok:true,scope:"Original exported account section compared under explicit disabled billing semantics; real seam registration and guarded links; unchanged official launcher retains local profile and sign-out interaction. Controlled identity fixture, not a deployed account test.",cases},null,2));console.log(`account billing availability: ${cases.length} Chromium cases passed`);
}finally{await closeAcceptanceBrowser(browser);await server?.close();}
