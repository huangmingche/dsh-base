#!/usr/bin/env node
import { acceptanceLaunchOptions, closeAcceptanceBrowser } from "../../scripts/acceptance-config.mjs";
/** Official command popup preservation and /model disabled-row regression. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
const app = resolve(import.meta.dirname, "../..");
const requireFromApp = createRequire(resolve(app, "package.json"));
const puppeteer = requireFromApp("puppeteer-core").default;
const vite = await import(requireFromApp.resolve("vite"));
const configFile = resolve(app, "vite.parity.config.ts");
const output = resolve(app, "dist/parity-evidence");
let server, browser;
const cases = [];
const snapshot = page => page.evaluate(() => ({ text: document.querySelector("#root").innerText, controls: [...document.querySelectorAll("input,[role='option']")].map(element => { const b=element.getBoundingClientRect(); return { tag:element.tagName, label:element.getAttribute("aria-label"), selected:element.getAttribute("aria-selected"), disabled:element.getAttribute("aria-disabled"), text:element.textContent, rect:[b.x,b.y,b.width,b.height].map(n=>Math.round(n*100)/100) }; }) }));
try {
  await mkdir(output, { recursive: true });
  await vite.build({ configFile, logLevel: "error" });
  server = await vite.preview({ configFile, logLevel: "error", preview: { host: "127.0.0.1", port: 0, strictPort: true } });
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await puppeteer.launch(acceptanceLaunchOptions());
  async function open(locale, state, side) {
    const page=await browser.newPage();page.setDefaultTimeout(10000);
    await page.setViewport({width:1280,height:900,deviceScaleFactor:1});
    const errors=[];page.on("pageerror",error=>errors.push(error.message));page.on("console",message=>{if(message.type()==="error")errors.push(message.text());});
    await page.goto(`${origin}/?${new URLSearchParams({surface:"commands",locale,state,side})}`,{waitUntil:"networkidle0"});
    await page.waitForFunction(()=>window.__COMMAND_PARITY__?.popup.state.getSnapshot().status==="ready");
    await page.evaluate(()=>document.fonts.ready);
    return {page,errors};
  }
  for (const locale of ["en","zh"]) {
    const reference=await open(locale,"standard","reference"), adapted=await open(locale,"standard","adapted");
    for(const target of [reference,adapted]) await target.page.evaluate(()=>document.activeElement?.blur());
    assert.deepEqual(await snapshot(adapted.page),await snapshot(reference.page),`${locale}: normal command rows changed`);
    const a=await reference.page.screenshot({path:resolve(output,`commands-${locale}-official.png`),captureBeyondViewport:false}),b=await adapted.page.screenshot({path:resolve(output,`commands-${locale}-adapted.png`),captureBeyondViewport:false});
    assert.ok(Buffer.from(a).equals(Buffer.from(b)),`${locale}: normal popup differs from pinned official pixels`);
    assert.deepEqual(reference.errors,[]);assert.deepEqual(adapted.errors,[]);
    cases.push({locale,state:"reference-comparison",screenshotSha256:createHash("sha256").update(a).digest("hex")});
    await reference.page.close();await adapted.page.close();
    for (const key of ["Enter","Tab"]) {
      const {page,errors}=await open(locale,"disabled","adapted");
      await page.evaluate(()=>{ const popup=window.__COMMAND_PARITY__.popup;const events=[];window.__COMMAND_PARITY__.events=events;for(const method of ['move','highlight','setSearch']){const original=popup[method].bind(popup);popup[method]=(...args)=>{const before=popup.state.getSnapshot().active;const value=original(...args);events.push({method,args,before,after:popup.state.getSnapshot().active,focused:document.activeElement?.tagName});return value;};} });
      assert.equal(await page.evaluate(()=>window.__COMMAND_PARITY__.options.find(option=>option.id==="fixture/blocked").disabled),true,"actual /model contribution must mark the disabled option");
      await page.focus("input");await page.type("input","Blocked");
      await page.waitForSelector('[role="option"][aria-disabled="true"]');
      const disabled=await page.$eval('[role="option"]',element=>({title:element.title,opacity:getComputedStyle(element).opacity,selected:element.getAttribute("aria-selected")}));
      assert.ok(disabled.title);assert.equal(disabled.opacity,"0.55");assert.equal(disabled.selected,"false");
      await page.click('[role="option"]');
      await page.focus("input");await page.keyboard.press(key);
      assert.deepEqual(await page.evaluate(()=>({calls:window.__COMMAND_PARITY__.calls,open:window.__COMMAND_PARITY__.popup.state.getSnapshot().open,counters:window.__COMMAND_PARITY__.counters})),{calls:[],open:true,counters:{consumed:0,focused:0}});
      // Pointer rejection is verified above. Move it outside the bottom-anchored
      // popup before restoring rows: unchanged official onMouseEnter can otherwise
      // highlight a row that is laid out under a stationary pointer after search.
      await page.mouse.move(0,0);
      await page.evaluate(()=>window.__COMMAND_PARITY__.popup.setSearch(""));
      await page.waitForFunction(()=>document.querySelectorAll('[role="option"]').length===3
        && document.querySelector('input').value==="" && window.__COMMAND_PARITY__.popup.state.getSnapshot().active===0);
      await page.focus("input");await page.keyboard.press("ArrowDown");
      assert.equal(await page.evaluate(()=>window.__COMMAND_PARITY__.popup.state.getSnapshot().active),2,"ArrowDown skips blocked row");
      await page.keyboard.press("ArrowUp");
      const afterUp=await page.evaluate(()=>window.__COMMAND_PARITY__.popup.state.getSnapshot().active);
      if(afterUp!==0)console.error('command navigation trace',locale,key,await page.evaluate(()=>window.__COMMAND_PARITY__.events));
      assert.equal(afterUp,0,"ArrowUp skips blocked row");
      await page.keyboard.press("ArrowUp");
      assert.equal(await page.evaluate(()=>window.__COMMAND_PARITY__.popup.state.getSnapshot().active),2,"ArrowUp wraps among available rows");
      assert.deepEqual(await page.evaluate(()=>window.__COMMAND_PARITY__.events.filter(event=>event.method==='move').map(({before,after})=>({before,after}))),
        [{before:0,after:2},{before:2,after:0},{before:0,after:2}],"keyboard moves must independently skip unavailable rows and wrap");
      await page.keyboard.press(key);
      await page.waitForFunction(()=>!window.__COMMAND_PARITY__.popup.state.getSnapshot().open);
      assert.deepEqual(await page.evaluate(()=>({calls:window.__COMMAND_PARITY__.calls,counters:window.__COMMAND_PARITY__.counters})),{calls:["fixture/enabled"],counters:{consumed:1,focused:1}});
      assert.deepEqual(errors,[]);cases.push({locale,state:"disabled-rows",key,unavailableSubmissions:0,enabledSubmissions:1});await page.close();
    }
  }
  const lock=JSON.parse(await readFile(resolve(app,"../../dsh-source.lock.json"),"utf8"));
  await writeFile(resolve(output,"commands-report.json"),JSON.stringify({ok:true,upstream:lock.commit,scope:"Pinned official command popup normal-state pixel/DOM comparison; actual /model options stay visible disabled with localized reasons; pointer, Enter/Tab and arrow navigation reject disabled rows.",cases},null,2));
  console.log(`command availability reference: ${cases.length} Chromium cases passed`);
} finally {await closeAcceptanceBrowser(browser);await server?.close();}
