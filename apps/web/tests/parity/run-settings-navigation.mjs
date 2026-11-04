#!/usr/bin/env node
import { acceptanceLaunchOptions, closeAcceptanceBrowser } from "../../scripts/acceptance-config.mjs";
/** Integration regression: actual SlotRegistry and full settings apply must project one winning navigation row. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const app=resolve(import.meta.dirname,"../.."),requireFromApp=createRequire(resolve(app,"package.json"));
const puppeteer=requireFromApp("puppeteer-core").default,vite=await import(requireFromApp.resolve("vite"));
const configFile=resolve(app,"vite.parity.config.ts"),output=resolve(app,"dist/parity-evidence");
let browser,server;const cases=[];
const snapshot=page=>page.evaluate(()=>({text:document.body.innerText,nav:[...document.querySelectorAll('[role="dialog"] nav button')].map(button=>{const b=button.getBoundingClientRect();return {text:button.textContent,current:button.getAttribute("aria-current"),rect:[b.x,b.y,b.width,b.height].map(n=>Math.round(n*100)/100)};})}));
try{
  await mkdir(output,{recursive:true});await vite.build({configFile,logLevel:"error"});server=await vite.preview({configFile,logLevel:"error",preview:{host:"127.0.0.1",port:0,strictPort:true}});const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
  browser=await puppeteer.launch(acceptanceLaunchOptions());
  async function open(locale,side){const page=await browser.newPage();page.setDefaultTimeout(10000);await page.setViewport({width:1280,height:900,deviceScaleFactor:1});const errors=[];page.on("pageerror",e=>errors.push(e.message));page.on("console",m=>{if(m.type()==="error")errors.push(m.text())});await page.goto(`${origin}/?${new URLSearchParams({surface:"settings-navigation",locale,side})}`,{waitUntil:"networkidle0"});try{await page.waitForSelector('[role="dialog"] nav');}catch(error){console.error(errors);throw error;}await page.evaluate(()=>document.fonts.ready);return {page,errors};}
  for(const locale of ["en","zh"]){
    const reference=await open(locale,"reference"),adapted=await open(locale,"adapted");
    const actual=await adapted.page.evaluate(()=>({raw:window.__NAV_PARITY__.rawSections(),rows:window.__NAV_PARITY__.source.getSnapshot(),rawSteps:window.__NAV_PARITY__.rawOnboarding(),steps:window.__NAV_PARITY__.onboarding.getSnapshot(),labels:window.__NAV_PARITY__.labels}));
    assert.equal(actual.raw.filter(item=>item==="account").length,2,"account: raw inventory must retain original plus legitimate shadow");
    assert.equal(actual.raw.filter(item=>item==="agent-presets").length,1,"agent-presets: the marked fork replaces the disabled original in the active roster");
    for(const id of ["account","agent-presets"]){assert.equal(actual.rows.filter(item=>item.id===id).length,1,`${id}: navigation must contain only the public winning entry`);}
    assert.equal(actual.rawSteps.length,2);assert.equal(actual.steps.length,1,"onboarding must not execute the shadowed original twice");
    assert.equal(await adapted.page.$eval('[data-settings-content="account"]',el=>el.getAttribute("data-unavailable-winner")),"true");
    for(const section of ["account","agent-presets"]){
      if(section!=="account")for(const target of [reference,adapted])await target.page.evaluate(()=>[...document.querySelectorAll('[role="dialog"] nav button')].find(button=>button.textContent.trim()===window.__NAV_PARITY__.labels.presets).click());
      for(const target of [reference,adapted]){await target.page.waitForSelector(`[data-settings-content="${section}"]`);await target.page.evaluate(()=>document.activeElement?.blur());}
      assert.deepEqual(await snapshot(adapted.page),await snapshot(reference.page),`${locale}/${section}: official settings navigation and layout differ`);
      const a=await reference.page.screenshot({path:resolve(output,`settings-${locale}-${section}-official.png`),captureBeyondViewport:false}),b=await adapted.page.screenshot({path:resolve(output,`settings-${locale}-${section}-adapted.png`),captureBeyondViewport:false});assert.ok(Buffer.from(a).equals(Buffer.from(b)),`${locale}/${section}: official settings pixels differ`);
      cases.push({locale,section,uniqueNavigation:true,rawOriginalPreserved:true,screenshotSha256:createHash("sha256").update(a).digest("hex")});
    }
    await adapted.page.evaluate(()=>window.__NAV_PARITY__.removeAccount());
    await adapted.page.waitForFunction(()=>!window.__NAV_PARITY__.source.getSnapshot().some(row=>row.id==="account"));
    assert.equal(await adapted.page.evaluate(()=>[...document.querySelectorAll('[role="dialog"] nav button')].filter(button=>button.textContent.trim()===window.__NAV_PARITY__.labels.account).length),0);
    await adapted.page.evaluate(()=>window.__NAV_PARITY__.restoreAccount());
    await adapted.page.waitForFunction(()=>window.__NAV_PARITY__.source.getSnapshot().filter(row=>row.id==="account").length===1);
    await adapted.page.waitForFunction(()=>window.__NAV_PARITY__.rawSections().filter(id=>id==="account").length===2);
    assert.equal(await adapted.page.evaluate(()=>[...document.querySelectorAll('[role="dialog"] nav button')].filter(button=>button.textContent.trim()===window.__NAV_PARITY__.labels.account).length),1);
    assert.deepEqual(reference.errors,[]);assert.deepEqual(adapted.errors,[]);await reference.page.close();await adapted.page.close();
  }
  await writeFile(resolve(output,"settings-navigation-report.json"),JSON.stringify({ok:true,scope:"Real Cordis SlotRegistry, full official/fork settings apply, actual account/preset availability registrations, official SettingsRoot navigation and public winning-content selection. Original/shadow inventory is preserved; navigation and onboarding select one winner; account unregistration/re-registration stays unique.",cases},null,2));console.log(`settings navigation integration: ${cases.length} Chromium comparisons passed`);
}finally{await closeAcceptanceBrowser(browser);await server?.close();}
