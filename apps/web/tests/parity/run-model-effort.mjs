#!/usr/bin/env node
import { acceptanceLaunchOptions, closeAcceptanceBrowser } from "../../scripts/acceptance-config.mjs";
/** Compare official model-menu rendering and verify real effort selection plus truthful capability withdrawal. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const app=resolve(import.meta.dirname,"../.."),requireFromApp=createRequire(resolve(app,"package.json"));
const puppeteer=requireFromApp("puppeteer-core").default,vite=await import(requireFromApp.resolve("vite"));
const configFile=resolve(app,"vite.parity.config.ts"),output=resolve(app,"dist/parity-evidence");
let browser,server;const cases=[];
try {
  await mkdir(output,{recursive:true});await vite.build({configFile,logLevel:"error"});
  server=await vite.preview({configFile,logLevel:"error",preview:{host:"127.0.0.1",port:0,strictPort:true}});const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
  browser=await puppeteer.launch(acceptanceLaunchOptions());
  const open=async(locale,side,state)=>{
    const page=await browser.newPage();page.setDefaultTimeout(10000);await page.setViewport({width:1280,height:900});const errors=[];
    page.on("pageerror",e=>errors.push(e.message));page.on("console",m=>{if(m.type()==="error")errors.push(m.text())});
    await page.goto(`${origin}/?${new URLSearchParams({surface:"model-effort",locale,side,state})}`,{waitUntil:"networkidle0"});
    await page.click("#root button");await page.waitForSelector('[role="menuitem"]');await page.evaluate(()=>document.fonts.ready);return {page,errors};
  };
  const clickMenu=(page,key)=>page.evaluate(key=>[...document.querySelectorAll('[role="menuitem"]')].find(button=>button.textContent.startsWith(window.__EFFORT_PARITY__.copy[key])).click(),key);
  const root=async page=>{ await page.bringToFront();if(await page.$eval('#root button',button=>button.getAttribute('aria-expanded')!=="true"))await page.click('#root button');else if(!(await page.$('[role="menuitem"]')))await page.keyboard.press('Escape');await page.waitForSelector('[role="menuitem"]'); };
  const rootRows=page=>page.evaluate(()=>[...document.querySelectorAll('[role="menuitem"]')].map(button=>({label:button.children[0].textContent,height:button.getBoundingClientRect().height,icon:button.querySelector('svg')?.getAttribute('data-icon'),disabled:button.disabled,title:button.title,opacity:getComputedStyle(button).opacity})));
  for(const locale of ["en","zh"]){
    const reference=await open(locale,"reference","supported"),adapted=await open(locale,"adapted","supported");
    for(const pane of ["root","effort"]){
      await root(reference.page);if(pane==="effort")await clickMenu(reference.page,"menu.effort");
      const a=await reference.page.screenshot({path:resolve(output,`model-${locale}-${pane}-official.png`),captureBeyondViewport:false});
      await root(adapted.page);if(pane==="effort")await clickMenu(adapted.page,"menu.effort");
      const b=await adapted.page.screenshot({path:resolve(output,`model-${locale}-${pane}-adapted.png`),captureBeyondViewport:false});
      assert.ok(Buffer.from(a).equals(Buffer.from(b)),`${locale}/${pane}: supported selector must retain official pixels`);
    }
    // Exercise the unchanged official interaction for every advertised value.
    // Each selection must carry the exact requested effort, including Off.
    for (const effort of ["off", "low", "high", "max"]) {
      for (const session of [reference, adapted]) {
        await root(session.page);
        await clickMenu(session.page, "menu.effort");
        const item = await session.page.evaluateHandle(id => [...document.querySelectorAll('[role="menuitemradio"]')].find(button => button.textContent.trim().toLowerCase() === id), effort);
        assert.ok(item.asElement(), `effort ${effort} is visible`);
        await item.asElement().focus();
        await session.page.keyboard.press("Enter");
        await session.page.waitForFunction(id => window.__EFFORT_PARITY__.calls.at(-1)?.reasoningEffort === id, {}, effort);
      }
      assert.deepEqual(await adapted.page.evaluate(()=>window.__EFFORT_PARITY__.calls), await reference.page.evaluate(()=>window.__EFFORT_PARITY__.calls));
    }
    assert.deepEqual(await adapted.page.evaluate(()=>window.__EFFORT_PARITY__.calls.map(call=>call.reasoningEffort)), ["off", "low", "high", "max"]);
    await adapted.page.evaluate(()=>{ window.__EFFORT_PARITY__.calls.length = 0; });
    await root(adapted.page); await clickMenu(adapted.page,"menu.effort");
    // Capability withdrawal while an effort pane is already open must not bypass the guard.
    await adapted.page.evaluate(()=>window.__EFFORT_PARITY__.withdraw());
    await adapted.page.waitForFunction(()=>[...document.querySelectorAll('[role="menuitemradio"]')].every(button=>button.disabled));
    await adapted.page.evaluate(()=>[...document.querySelectorAll('[role="menuitemradio"]')].forEach(button=>button.click()));
    assert.deepEqual(await adapted.page.evaluate(()=>window.__EFFORT_PARITY__.calls),[]);
    assert.deepEqual(reference.errors,[]);assert.deepEqual(adapted.errors,[]);await reference.page.close();await adapted.page.close();
    cases.push({locale,state:"supported-reference",rootAndEffortPixelsIdentical:true,keyboardEfforts:["off","low","high","max"],withdrawalBlocked:true});
    const original=await open(locale,"reference","unavailable"),disabled=await open(locale,"adapted","unavailable");
    await root(original.page);const officialRows=await rootRows(original.page);
    await original.page.screenshot({path:resolve(output,`model-${locale}-unavailable-official.png`),captureBeyondViewport:false});
    await root(disabled.page);const actualRows=await rootRows(disabled.page);
    assert.deepEqual(actualRows.map(({label,height,icon})=>({label,height,icon})),officialRows.map(({label,height,icon})=>({label,height,icon})),"official two-row menu labels, height and icons stay intact");
    assert.equal(actualRows[0].disabled,false);assert.equal(actualRows[1].disabled,true);
    assert.equal(actualRows[1].title,await disabled.page.evaluate(()=>window.__EFFORT_PARITY__.copy["effort.unavailableReason"]));
    assert.ok(Number(actualRows[1].opacity)<1);
    await clickMenu(disabled.page,"menu.effort");await disabled.page.keyboard.press("Tab");
    assert.equal(await disabled.page.$('[role="menuitemradio"]'),null,"disabled effort cannot drill via pointer or keyboard");
    assert.deepEqual(await disabled.page.evaluate(()=>window.__EFFORT_PARITY__.calls),[]);
    await disabled.page.screenshot({path:resolve(output,`model-${locale}-unavailable-adapted.png`),captureBeyondViewport:false});
    await clickMenu(disabled.page,"menu.model");
    await disabled.page.evaluate(()=>[...document.querySelectorAll('[role="menuitemradio"]')].find(button=>button.textContent.includes("Next model")).click());
    assert.deepEqual(await disabled.page.evaluate(()=>window.__EFFORT_PARITY__.calls),[{provider:"fixture",model:"next"}],"ordinary model selection remains available and carries no effort");
    assert.deepEqual(original.errors,[]);assert.deepEqual(disabled.errors,[]);await original.page.close();await disabled.page.close();
    cases.push({locale,state:"unavailable-effort",officialMenuPreserved:true,visibleDisabledLocalized:true,modelOnlySelection:true});
  }
  await writeFile(resolve(output,"model-effort-report.json"),JSON.stringify({ok:true,scope:"Pinned official model selector compared with the capability fork. Supported root/effort pixels match and all four efforts use the same keyboard selection and exact requests; unavailable Host reasoning remains the same visible menu row, disabled with localized explanation; model-only selection stays operational. No claim that the unavailable state is supported upstream behavior.",cases},null,2));
  console.log(`model effort capability: ${cases.length} Chromium cases passed`);
}finally{await closeAcceptanceBrowser(browser);await server?.close();}
