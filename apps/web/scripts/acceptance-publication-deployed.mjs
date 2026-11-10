#!/usr/bin/env node
/** Read-only anonymous publication acceptance. GET/HEAD only; no settings, accounts or payments are changed. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {LOCALE_IDS,localizePath,hreflangFor} from '../../../packages/boot/dsh-base-locale-path/src/index.ts';
import { assertBaseRegistry, assertNoRetiredLinks, retiredDocuments } from './acceptance-public-routes.mjs';

const raw=process.env.DSH_BASE_URL;
if(!raw)throw new Error('Set DSH_BASE_URL to the explicit Staging HTTPS origin');
const target=new URL(raw);
if(target.protocol!=='https:'||target.username||target.password||target.search||target.hash||target.pathname.replace(/\/+$/u,'')!=='')throw new Error('An explicit HTTPS origin without credentials or path is required');
const base=target.origin,baseline=process.argv.includes('--baseline');
const stamp=new Date().toISOString().replace(/[:.]/gu,'-');
const output=resolve(process.env.DSH_ACCEPTANCE_OUT??`.artifacts/acceptance/publication-staging/${baseline?'baseline-':''}${stamp}`);
if(existsSync(join(output,'report.json')))throw new Error('Evidence already exists; select a fresh DSH_ACCEPTANCE_OUT');
mkdirSync(join(output,'responses'),{recursive:true});
const report={base,mode:baseline?'baseline':'staging-acceptance',startedAt:new Date().toISOString(),expectedDeploymentVersion:process.env.DSH_EXPECTED_DEPLOYMENT_VERSION??null,
  versionEvidence:'The deployed workbench entry must match the local build.',requests:[],checks:[],errors:[]};
const decode=value=>value.replace(/&(?:amp|quot|lt|gt|apos|#39|#x[\da-f]+|#\d+);/giu,entity=>({ '&amp;':'&','&quot;':'"','&lt;':'<','&gt;':'>','&apos;':"'",'&#39;':"'" })[entity.toLowerCase()]??String.fromCodePoint(Number.parseInt(entity.slice(entity[2]?.toLowerCase()==='x'?3:2,-1),entity[2]?.toLowerCase()==='x'?16:10)));
const attributes=tag=>Object.fromEntries([...tag.matchAll(/([\w:-]+)=(["'])(.*?)\2/gu)].map(([,key,,value])=>[key,decode(value)]));
const links=html=>[...html.matchAll(/<link\b[^>]*>/giu)].map(match=>attributes(match[0]));
const plain=html=>decode(html.replace(/<[^>]+>/gu,' ').replace(/\s+/gu,' ')).trim();
const graphs=html=>[...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu)].map(match=>JSON.parse(match[1]));
const check=(name,fn)=>{try{fn();report.checks.push({name,ok:true});}catch(error){report.checks.push({name,ok:false});report.errors.push({name,error:String(error.message??error)});}};
async function get(path,{method='GET',accept='text/html',userAgent}={}){
  assert.ok(path.startsWith('/')&&!path.startsWith('//'),'probe stays on the selected deployment');
  const response=await fetch(`${base}${path}`,{method,headers:{accept,...(userAgent?{'user-agent':userAgent}:{})},redirect:'manual',credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(25000)});
  const bytes=new Uint8Array(await response.arrayBuffer()),body=new TextDecoder().decode(bytes);
  const id=String(report.requests.length+1).padStart(3,'0');
  const evidence={path,method,accept,status:response.status,headers:Object.fromEntries(['content-type','content-language','cache-control','x-robots-tag','location','etag'].flatMap(name=>response.headers.has(name)?[[name,response.headers.get(name)]]:[])),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),file:`responses/${id}.body`};
  writeFileSync(join(output,evidence.file),bytes);report.requests.push(evidence);
  return {...evidence,body};
}
const expectNoIndex=response=>assert.match(response.headers['x-robots-tag']??'',/noindex/u);
const expectHtml=response=>{assert.equal(response.status,200);assert.match(response.headers['content-type']??'',/text\/html/u);expectNoIndex(response);};


try{
  if(baseline){
    for(const path of ['/api/public-pages','/','/about','/pricing','/robots.txt','/sitemap.xml','/llms.txt','/manifest.webmanifest','/publication-unknown-baseline'])await get(path,{accept:path.startsWith('/api/')?'application/json':'text/html'});
    report.baselineOnly=true;
  }else{
    const inventoryResponse=await get('/api/public-pages',{accept:'application/json'});
    assert.equal(inventoryResponse.status,200,'the deployed publication registry is required');
    const inventory=JSON.parse(inventoryResponse.body);
    assert.ok(Array.isArray(inventory.pages),'registry returns pages');
    check('base registry publishes only the workbench in each supported language', () => assertBaseRegistry(inventory.pages));
    const assets = resolve(import.meta.dirname, '../.cloudflare/output/v0/workers/default/assets');
    const entry = readFileSync(join(assets, 'index.html'), 'utf8').match(/<script[^>]+src="([^"]+)"/u)?.[1];
    assert.match(entry ?? '', /^\/assets\/[\w.-]+\.js$/u);
    const script = await get(entry, {accept: '*/*'});
    check('deployed workbench entry matches the local build', () => {
      assert.equal(script.status, 200);
      assert.equal(script.sha256, createHash('sha256').update(readFileSync(join(assets, entry.slice(1)))).digest('hex'));
    });
    for(const page of inventory.pages){
      for(const locale of page.availableLocales){
        const path=localizePath(page.path,locale),response=await get(path),html=response.body;
        check(`${path}: published HTML, canonical, language and staging isolation`,()=>{
          expectHtml(response);assert.equal(response.headers['content-language'],hreflangFor(locale));
          assert.match(html,new RegExp(`<html lang="${hreflangFor(locale)}"`,'u'));
          assert.ok(/<meta name="robots" content="noindex, nofollow"/u.test(html));
          assert.ok(plain(/<title>([\s\S]*?)<\/title>/iu.exec(html)?.[1]??'').length>0,'localized title exists');
          const meta=[...html.matchAll(/<meta\b[^>]*>/giu)].map(match=>attributes(match[0]));
          assert.ok(meta.some(row=>row.name==='description'&&row.content?.trim()),'description exists');
          assert.equal(meta.find(row=>row.property==='og:url')?.content,`${base}${path}`,'Open Graph shares the canonical document');
          const canonical=links(html).filter(link=>link.rel==='canonical');assert.equal(canonical.length,1);assert.equal(canonical[0].href,`${base}${path}`);
          const alternates=links(html).filter(link=>link.rel==='alternate'&&link.hreflang);
          const wanted=page.availableLocales.map(language=>[hreflangFor(language),`${base}${localizePath(page.path,language)}`]);
          if(page.availableLocales.includes('en'))wanted.push(['x-default',`${base}${page.path}`]);
          assert.deepEqual(alternates.map(link=>[link.hreflang,link.href]).sort(),wanted.sort());
          assert.ok(graphs(html).some(graph=>graph['@type']==='WebSite'&&graph.inLanguage===hreflangFor(locale)));
        });
        check(`${path}: home uses the verified workbench and links only to current surfaces`, () => {
          assert.ok(html.includes(`src="${entry}"`));
          assertNoRetiredLinks([...html.matchAll(/<(?:a|link)\b[^>]*>/giu)].map(match => attributes(match[0]).href).filter(Boolean), base);
        });
      }
    }
    for(const accept of ['*/*','text/html']){
      const crawler = await get('/', {accept, userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'});
      check(`crawler Accept ${accept}: workbench is reachable`, () => { expectHtml(crawler); assert.ok(crawler.body.includes(`src="${entry}"`)); });
      for (const locale of ['en', 'zh']) {
        for (const route of [...retiredDocuments, '/publication-unknown-canary']) {
          const path = localizePath(route, locale);
          const response = await get(path, {accept});
          check(`${path} (${accept}): real 404`, () => { assert.equal(response.status, 404); assert.ok(!response.body.includes('rel="canonical"')); });
        }
      }
    }
    // locale-path:allow Explicit legacy/case variants verify canonical redirects; they are not generated navigation links.
    for(const [path,next]of [['/en/login','/login'],['/ZH-CN/login',localizePath('/login','zh')],['/EN','/']]){const response=await get(path);check(`${path}: canonical redirect`,()=>{assert.equal(response.status,301);assert.equal(response.headers.location,`${base}${next}`);});}
    for(const locale of ['en','zh']){
      const path=localizePath('/login',locale),response=await get(path);check(`${path}: public login remains unindexable`,()=>{expectHtml(response);assert.ok(!response.body.includes('rel="canonical"'));assert.equal(graphs(response.body).length,0);});
    }
    for(const path of [localizePath('/app/session/publication-private-canary','en'),localizePath('/app/workspace/publication-private-canary','zh')]){const response=await get(path);check(`${path}: anonymous private navigation requires login`,()=>{assert.equal(response.status,302);assert.match(response.headers.location??'',/\/login\?next=/u);expectNoIndex(response);});}
    const api=await get('/api/session-host',{accept:'application/json'});check('private session API remains unauthorized',()=>assert.equal(api.status,401));
    const sitemap=await get('/sitemap.xml',{accept:'application/xml'});check('Staging sitemap is empty and parseable',()=>{assert.equal(sitemap.status,200);assert.match(sitemap.headers['content-type']??'',/application\/xml/u);assert.match(sitemap.body,/<urlset\b/u);assert.doesNotMatch(sitemap.body,/<loc>|<lastmod>/u);});
    const robots=await get('/robots.txt',{accept:'text/plain'});check('Staging robots permits noindex discovery without sitemap submission',()=>{assert.equal(robots.status,200);assert.match(robots.body,/^User-agent: \*/mu);assert.match(robots.body,/^Allow: \/$/mu);assert.doesNotMatch(robots.body,/^Sitemap:|^Disallow: \/$/mu);for(const locale of LOCALE_IDS)for(const prefix of ['/api/','/app/session/','/app/workspace/'])assert.ok(robots.body.includes(`Disallow: ${localizePath(prefix,locale)}`));assert.doesNotMatch(robots.body,/Disallow: \/(?:zh-CN\/)?login/u);});
    for(const locale of LOCALE_IDS){
      const path=localizePath('/llms.txt',locale),response=await get(path),head=await get(path,{method:'HEAD'});
      check(`${path}: truthful public LLM summary, including HEAD`,()=>{assert.equal(response.status,200);assert.match(response.headers['content-type']??'',/text\/plain/u);assert.equal(response.headers['content-language'],hreflangFor(locale));assert.match(response.body,/^# /u);assert.equal(head.status,200);assert.equal(head.body,'');
        const listed=[...response.body.matchAll(/\]\(<([^>]+)>\)/gu)].map(match=>match[1]);const wanted=inventory.pages.filter(page=>page.indexable!==false&&page.availableLocales.includes(locale)).map(page=>`${base}${localizePath(page.path,locale)}`);assert.deepEqual(listed.sort(),wanted.sort());assert.doesNotMatch(response.body,/\/app\/session\/|\/app\/workspace\/|\/api\/|publication-private-canary/u);});
    }
    for(const locale of ['en','zh']){const path=localizePath('/manifest.webmanifest',locale),response=await get(path,{accept:'application/manifest+json'});check(`${path}: localized install manifest`,()=>{assert.equal(response.status,200);assert.match(response.headers['content-type']??'',/application\/manifest\+json/u);const manifest=JSON.parse(response.body);assert.equal(manifest.lang,hreflangFor(locale));assert.ok(manifest.name);assert.equal(new URL(manifest.start_url,base).origin,base);assert.equal(new URL(manifest.start_url,base).pathname.replace(/\/$/u,'')||'/',localizePath('/',locale));assert.ok(Array.isArray(manifest.icons)&&manifest.icons.length>=2);});}
    for(const path of ['/favicon.svg','/favicon-dark.svg','/icon-192.png','/icon-512.png']){const response=await get(path,{accept:'*/*'});check(`${path}: actual public asset`,()=>{assert.equal(response.status,200);assert.ok(response.bytes>0);assert.doesNotMatch(response.headers['content-type']??'',/text\/html/u);});}
    for (const path of ['/third-party-notices.txt', '/third-party/document-preview.txt']) {
      for (const method of ['GET', 'HEAD']) {
        for (const accept of ['text/html', 'text/plain']) {
          const response = await get(path, {method, accept});
          check(`${method} ${path} (${accept}): no public inventory`, () => {
            assert.equal(response.status, 404);
            assert.match(response.headers['content-type'] ?? '', /^text\/plain/iu);
            assert.equal(response.body, method === 'HEAD' ? '' : 'Not found');
          });
        }
      }
    }
    for(const path of ['/publication-missing.png','/publication-missing.webmanifest','/assets/public-content/third-party-notices.txt']){const response=await get(path,{accept:'*/*'});check(`${path}: missing asset is not SPA HTML`,()=>{assert.equal(response.status,404);assert.doesNotMatch(response.headers['content-type']??'',/text\/html/u);});}
  }
}catch(error){report.errors.push({name:'acceptance execution',error:String(error.stack??error)});}
report.completedAt=new Date().toISOString();report.ok=report.errors.length===0;
writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({ok:report.ok,mode:report.mode,requests:report.requests.length,checks:report.checks.length,failures:report.errors.length,output}));
if(!report.ok){console.error(JSON.stringify(report.errors,null,2));process.exitCode=1;}
