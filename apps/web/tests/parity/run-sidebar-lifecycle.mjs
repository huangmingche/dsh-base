#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { acceptanceLaunchOptions, closeAcceptanceBrowser } from '../../scripts/acceptance-config.mjs';
const app=resolve(import.meta.dirname,'../..'),requireFromApp=createRequire(resolve(app,'package.json'));
const vite=await import(requireFromApp.resolve('vite')),puppeteer=requireFromApp('puppeteer-core').default;
const configFile=resolve(app,'vite.parity.config.ts'),output=resolve(app,'dist/parity-evidence');
let browser,server;
try {
 await vite.build({configFile,logLevel:'error'});server=await vite.preview({configFile,logLevel:'error',preview:{host:'127.0.0.1',port:0,strictPort:true}});
 browser=await puppeteer.launch(acceptanceLaunchOptions());const page=await browser.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?surface=sidebar-lifecycle`,{waitUntil:'networkidle0'});
 await page.waitForFunction(()=>window.__SIDEBAR_LIFECYCLE__!==undefined,{timeout:15000});
 const report=await page.evaluate(()=>window.__SIDEBAR_LIFECYCLE__);assert.equal(report.ok,true,report.error);assert.equal(report.cases.length,5);assert.deepEqual(errors,[]);
 await mkdir(output,{recursive:true});await writeFile(resolve(output,'sidebar-lifecycle-report.json'),JSON.stringify(report,null,2));console.log('sidebar lifecycle: 5 actual official SessionReference cases passed');
}finally{await closeAcceptanceBrowser(browser);await server?.close();}
