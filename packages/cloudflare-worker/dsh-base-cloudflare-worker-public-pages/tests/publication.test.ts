import assert from 'node:assert/strict';
import test from 'node:test';
import {apply, createPublicPages} from '../src/index.ts';
import {indexingPolicy, type PublicPage} from '../../../boot/dsh-base-public-pages/src/index.ts';
import {localizePath} from '../../../boot/dsh-base-locale-path/src/index.ts';
import {apply as applyHttp, type WorkerHttp} from '../../dsh-base-cloudflare-worker-http/src/index.ts';
import {apply as applyAssets} from '../../dsh-base-cloudflare-worker-assets/src/index.ts';
import {apply as applySeo} from '../../dsh-base-cloudflare-worker-seo/src/index.ts';
import {apply as applySitemap} from '../../dsh-base-cloudflare-worker-sitemap/src/index.ts';
import {apply as applyRobots} from '../../dsh-base-cloudflare-worker-robots/src/index.ts';
import {resolveSiteSeo} from '../../../boot/dsh-base-site-seo/src/index.ts';

const page: PublicPage = {path:'/guides/start',access:'public',status:'published',indexable:true,publishedAt:'2026-01-01',lastmod:'2026-01-02',availableLocales:['en'],copy:{en:{title:'Start',description:'A real guide'}}};
const owner = 'cloudflare:worker:guides';
const production = {SITE_INDEXING_ENABLED:'true',SITE_DEPLOYMENT_ENVIRONMENT:'production',AUTH_BASE_URL:'https://product.example.test'};

test('publication distinguishes visibility, indexing, actual languages, dates and lifecycle', async()=>{
  const service=createPublicPages(()=>Date.parse('2026-11-17'));
  service.register(owner,{list:()=>[page,{...page,path:'/draft',status:'draft'}, {...page,path:'/future',publishedAt:'2027-01-01'},
    {...page,path:'/archived',status:'archived'}, {...page,path:'/preview',indexable:false}, {...page,path:'/private',access:'authenticated',indexable:false}]});
  assert.deepEqual((await service.list({})).map(p=>p.path),['/','/guides/start','/preview']);
  assert.equal(await service.resolve({},page.path,'zh'),undefined);
  assert.equal((await service.resolve({},page.path,'en'))?.path,page.path);
});
test('providers cannot override base, reserved namespaces or one another',async()=>{
  for(const path of ['/','/api/private','/app/session/a','/app/workspace/a','/login','/zh-CN/guide','//external.test','/a?b=1','/a/../b']) {
    const service=createPublicPages();service.register(owner,{list:()=>[{...page,path}]});
    await assert.rejects(service.list({}),/Invalid|reserved/);
  }
  const service=createPublicPages();const dispose=service.register(owner,{list:()=>[page]});
  assert.throws(()=>service.register(owner,{list:()=>[]}),/duplicate/);
  const remove=service.register('cloudflare:worker:other',{list:()=>[page]});
  await assert.rejects(service.list({}),/Duplicate/);remove();dispose();
  assert.equal((await service.list({})).length,1);
});
test('indexing is opt-in production and requires a trusted HTTPS origin',()=>{
  for(const env of [{}, {...production,SITE_INDEXING_ENABLED:'false'}, {...production,SITE_DEPLOYMENT_ENVIRONMENT:'staging'}, {...production,AUTH_BASE_URL:'http://localhost:5173'}, {...production,AUTH_BASE_URL:'https://example.com'}]) assert.equal(indexingPolicy(env).enabled,false);
  assert.deepEqual(indexingPolicy(production),{enabled:true,origin:production.AUTH_BASE_URL});
});

function runtime(document = page) {
  const services=new Map<string,unknown>();
  const ctx={http:undefined as unknown as WorkerHttp,
    provide(name:string,value:unknown){services.set(name,value);Object.assign(this,{[name]:value});},
    get(name:string){return services.get(name);},effect(fn:()=>unknown){return fn();}};
  applyHttp(ctx as never);apply(ctx as never);
  const registry=services.get('publicPages') as ReturnType<typeof createPublicPages>;
  registry.register(owner,{list:()=>[document,{...page,path:'/unlisted',indexable:false}], renderBody:()=>'<main><h1>Start</h1><p>Real guide content.</p></main><script type="module" src="/assets/public.js"></script>'});
  ctx.provide('siteSettings',{read:async()=>({values:{seo:resolveSiteSeo({}).config}})});
  applySeo(ctx as never);applySitemap(ctx as never);applyRobots(ctx as never);applyAssets(ctx as never);
  const env={...production,ASSETS:{fetch:async()=>new Response('<!doctype html><html><head><title>App</title><script type="module" src="/assets/private-app.js"></script></head><body><div id="root"></div></body></html>',{headers:{'content-type':'text/html'}})}};
  return {ctx,env};
}
test('published HTML, sitemap and canonical agree; unavailable languages and unknown addresses are 404',async()=>{
  const {ctx,env}=runtime();
  const get=(path:string,accept='text/html')=>ctx.http.dispatch(new Request(production.AUTH_BASE_URL+path,{headers:{accept}}),env);
  const response=await get(page.path);assert.equal(response.status,200);const html=await response.text();
  assert.match(html,/Real guide content/);assert.match(html,/public\.js/);assert.doesNotMatch(html,/private-app\.js/);
  assert.match(html,/<title>Start<\/title>/);assert.doesNotMatch(html,/hreflang="zh-CN"/);
  assert.equal(response.headers.get('x-robots-tag'),null);
  assert.match(await (await get(page.path, '')).text(), /Real guide content/, 'a document without Accept still serves its actual content');
  for(const path of ['/missing','/zh-CN/guides/start','/made.up/path']) for(const accept of ['text/html','*/*']) assert.equal((await get(path,accept)).status,404);
  const xml=await (await get('/sitemap.xml')).text();assert.match(xml,/<loc>https:\/\/product.example.test\/guides\/start<\/loc>/);assert.doesNotMatch(xml,/unlisted/);
  assert.equal((await get('/unlisted')).headers.get('x-robots-tag'),'noindex, nofollow');
});
test('staging remains browseable but has empty sitemap and no sitemap submission hint',async()=>{
  const {ctx,env}=runtime();const staging={...env,SITE_DEPLOYMENT_ENVIRONMENT:'staging'};
  const get=(path:string)=>ctx.http.dispatch(new Request(production.AUTH_BASE_URL+path,{headers:{accept:'text/html'}}),staging);
  assert.equal((await get('/')).headers.get('x-robots-tag'),'noindex, nofollow');
  assert.doesNotMatch(await (await get('/sitemap.xml')).text(),/<loc>/);
  const robots=await (await get('/robots.txt')).text();assert.doesNotMatch(robots,/Sitemap:|Disallow: \/login/);assert.match(robots,/Allow: \//);
});
test('production aliases redirect to the configured canonical host',async()=>{
  const {ctx,env}=runtime();const response=await ctx.http.dispatch(new Request('https://alias.example.test/guides/start',{headers:{accept:'text/html'}}),env);
  assert.equal(response.status,301);assert.equal(response.headers.get('location'),production.AUTH_BASE_URL+'/guides/start');
});

test('retired base documents return 404 and are absent from public discovery',async()=>{
  const {ctx,env}=runtime();
  const retired=['/about','/guides/getting-started','/use-cases','/pricing','/privacy','/terms','/cookie','/blog','/blog/keep-product-features-in-plugins'];
  const registry=await ctx.http.dispatch(new Request(production.AUTH_BASE_URL+'/api/public-pages'),env);
  const {pages}=await registry.json() as {pages: PublicPage[]};
  const sitemap=await ctx.http.dispatch(new Request(production.AUTH_BASE_URL+'/sitemap.xml'),env);
  const xml=await sitemap.text();
  for(const route of retired) {
    assert.ok(!pages.some(page=>page.path===route));
    for(const locale of ['en','zh'] as const) {
      const path=localizePath(route,locale);
      assert.ok(!xml.includes(production.AUTH_BASE_URL+path+'<'));
      for(const method of ['GET','HEAD']) {
        const response=await ctx.http.dispatch(new Request(production.AUTH_BASE_URL+path,{method,headers:{accept:'text/html'}}),env);
        assert.equal(response.status,404,`${method} ${path}`);
        if(method==='HEAD') assert.equal(await response.text(),'');
      }
    }
  }
});

test('a downstream Worker may publish its own page at a released path',async()=>{
  const {ctx,env}=runtime({...page,path:'/about'});
  const response=await ctx.http.dispatch(new Request(production.AUTH_BASE_URL+'/about',{headers:{accept:'text/html'}}),env);
  assert.equal(response.status,200);
  assert.match(await response.text(),/Real guide content/);
});

test('localized canonical redirects cannot become external scheme-relative addresses',async()=>{
  const {ctx,env}=runtime();
  for(const path of ['/en//evil.test/path','/EN//evil.test/path']) {
    const response=await ctx.http.dispatch(new Request(production.AUTH_BASE_URL+path),env);
    assert.equal(response.status,301);
    assert.equal(new URL(response.headers.get('location')!).origin,production.AUTH_BASE_URL);
  }
});
