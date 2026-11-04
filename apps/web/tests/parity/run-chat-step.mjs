#!/usr/bin/env node
/** Real pinned Assistant/TurnProcess React updates, compared with the native per-Step journal. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { acceptanceLaunchOptions, closeAcceptanceBrowser } from '../../scripts/acceptance-config.mjs';
const app=resolve(import.meta.dirname,'../..'),require=createRequire(resolve(app,'package.json'));
const vite=await import(require.resolve('vite')),puppeteer=require('puppeteer-core').default;
const configFile=resolve(app,'vite.parity.config.ts'),output=resolve(app,'dist/parity-evidence');let browser,server;
const report=[];
try {
 await vite.build({configFile,logLevel:'error',build:{minify:true}});server=await vite.preview({configFile,logLevel:'error',preview:{host:'127.0.0.1',port:0,strictPort:true}});
 browser=await puppeteer.launch(acceptanceLaunchOptions());
 for(const locale of ['en','zh']){
  const results=[];
  for(const side of ['reference','adapted']){
   const page=await browser.newPage(),errors=[];await page.setViewport({width:900,height:650});
   page.on('pageerror',e=>errors.push(e.stack??e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
   await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?surface=chat-step&locale=${locale}&side=${side}`,{waitUntil:'networkidle0'});
   await page.waitForFunction(()=>window.__CHAT_STEP__!==undefined);
   assert.equal(await page.$$eval('button[data-turn-process]',rows=>rows.length),0,'approval wait must not show Completed');
   const before=await page.evaluate(()=>window.__CHAT_STEP__.read());
   await page.evaluate(()=>window.__CHAT_STEP__.advance());await page.waitForSelector('button[data-turn-process]');
   const done=await page.evaluate(()=>window.__CHAT_STEP__.read());
   assert.deepEqual(done.turns,[1]);const ids=done.nodes.filter(n=>n.kind==='assistant-step').map(n=>n.id);assert.equal(ids.length,2);assert.equal(new Set(ids).size,2);assert.equal(before.nodes.find(n=>n.kind==='assistant-step').id,ids[0]);
   const content=()=>page.$eval('[data-chat-step-fixture]',el=>el.textContent);
   const completed=await content();assert.match(completed,/Fetching the page/);assert.match(completed,/Final answer: Page title/);
   assert.equal(await page.$$eval('button[data-turn-process]',rows=>rows.length),1);
   await page.click('button[data-turn-process]');assert.equal(await page.$eval('button[data-turn-process]',el=>el.getAttribute('aria-expanded')),'false');
   await page.click('button[data-turn-process]');assert.equal(await page.$eval('button[data-turn-process]',el=>el.getAttribute('aria-expanded')),'true');
   await page.evaluate(()=>window.__CHAT_STEP__.replay());await new Promise(r=>setTimeout(r,60));assert.equal(await content(),completed);
   await page.evaluate(()=>window.__CHAT_STEP__.reload());await new Promise(r=>setTimeout(r,60));assert.equal(await content(),completed);assert.equal(await page.$$eval('button[data-turn-process]',rows=>rows.length),1);
   assert.deepEqual((await page.evaluate(()=>window.__CHAT_STEP__.read())).nodes.filter(n=>n.kind==='assistant-step').map(n=>n.id),ids);
   const screenshot=await page.screenshot({ captureBeyondViewport: false });results.push({side,completed,screenshot});assert.deepEqual(errors,[]);report.push({locale,side,assistantIds:ids,oneTurn:true,steps:2,replay:true,reload:true,errors});await page.close();
  }
  assert.equal(results[0].completed,results[1].completed);assert.ok(Buffer.from(results[0].screenshot).equals(Buffer.from(results[1].screenshot)),'actual official renderer pixels match the native per-Step journal');
 }
 await mkdir(output,{recursive:true});await writeFile(resolve(output,'chat-step-report.json'),JSON.stringify(report,null,2));console.log('chat-step: 4 actual pinned React renderer cases; native/shared pixels, stable unique ids, one Turn, replay/reload and disclosure pass');
}finally{await closeAcceptanceBrowser(browser);await server?.close();}
