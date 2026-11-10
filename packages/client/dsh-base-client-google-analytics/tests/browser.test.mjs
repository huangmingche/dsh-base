/** Actual browser navigation and transport, with every request served locally. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { acceptanceLaunchOptions, closeAcceptanceBrowser } from '../../../../apps/web/scripts/acceptance-config.mjs';
import { localizePath } from '../../../boot/dsh-base-locale-path/src/index.ts';
const require = createRequire(new URL('../../../../apps/web/package.json', import.meta.url));
const { build } = require('esbuild');
const { default: puppeteer } = await import(require.resolve('puppeteer-core'));
const entry = fileURLToPath(new URL('../src/client/pageviews.ts', import.meta.url));
const boot = name => fileURLToPath(new URL(`../../../boot/${name}/src/index.ts`, import.meta.url));

test('real browser emits only canonical public paths, never credentials/referrers/private titles or third-party traffic', { timeout: 30_000 }, async () => {
  const built = await build({ stdin: { contents: `
    import { startPublicPageViews } from ${JSON.stringify(entry)};
    let google; const listeners = new Set();
    const source = { getSnapshot: () => ({ config: { analytics: { google } } }), subscribe: callback => { listeners.add(callback); return () => listeners.delete(callback); } };
    window.testAnalytics = { stop: startPublicPageViews(source, window, (input, init) => fetch(input, init)),
      update(value) { google = value; for (const callback of listeners) callback(); } };
  `, resolveDir: fileURLToPath(new URL('../../../../apps/web', import.meta.url)), loader: 'ts' }, bundle: true, write: false, platform: 'browser', format: 'iife',
    alias: { '@dsh-base/site-config': boot('dsh-base-site-config'), '@dsh-base/locale-path': boot('dsh-base-locale-path'), '@dsh-base/public-pages': boot('dsh-base-public-pages') } });
  let browser;
  const requests = [], external = [], errors = [];
  try {
    browser = await puppeteer.launch(acceptanceLaunchOptions());
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', async request => {
      const url = new URL(request.url());
      if (url.origin !== 'https://analytics-browser.test') { external.push(request.url()); return request.abort(); }
      if (url.pathname.startsWith('/api/')) {
        requests.push({ method: request.method(), path: url.pathname, body: request.postData(), headers: request.headers() });
        return request.respond({ status: 204 });
      }
      return request.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><title>PRIVATE_SESSION_TITLE</title><body></body>' });
    });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('https://analytics-browser.test/?token=PRIVATE_CREDENTIAL#PRIVATE_HASH');
    await page.evaluate(() => { document.cookie = 'private_session=PRIVATE_COOKIE; Secure; SameSite=Lax'; });
    await page.addScriptTag({ content: built.outputFiles[0].text });
    await page.evaluate(() => testAnalytics.update({ enabled: true, measurementId: 'G-TEST123456' }));
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual(requests, [], 'server readiness is required even with a configured identifier');
    await page.evaluate(() => testAnalytics.update({ enabled: true, ready: true, measurementId: 'G-TEST123456' }));
    for (let i = 0; requests.length < 1 && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(requests.length, 1);
    const first = requests[0];
    assert.equal(first.path, '/api/site-analytics/google'); assert.equal(first.method, 'POST');
    assert.deepEqual(JSON.parse(first.body), { path: '/' });
    assert.equal(first.headers.cookie, undefined); assert.equal(first.headers.referer ?? '', '');
    assert.equal(first.headers.origin, 'https://analytics-browser.test', 'server receives the normal same-origin POST boundary');
    await page.evaluate(() => {
      history.pushState({ secret: 'PRIVATE_STATE' }, 'PRIVATE_TITLE', '/?email=PRIVATE_EMAIL#PRIVATE_FRAGMENT');
      history.replaceState({}, '', '/#next'); dispatchEvent(new PopStateEvent('popstate'));
      document.title = 'PRIVATE_UPDATED_TITLE';
      history.pushState({}, '', '/app/session/PRIVATE_ID?apiKey=PRIVATE_KEY');
      history.replaceState({}, '', '/app/workspace/PRIVATE_WORKSPACE');
    });
    await new Promise(resolve => setTimeout(resolve, 150)); assert.equal(requests.length, 1);
    const translated = localizePath('/', 'zh');
    await page.evaluate(path => history.pushState({}, '', path), translated);
    for (let i = 0; requests.length < 2 && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(requests.length, 2); assert.deepEqual(JSON.parse(requests[1].body), { path: translated });
    await page.evaluate(() => { testAnalytics.update({ enabled: false }); history.pushState({}, '', '/'); testAnalytics.stop(); });
    await new Promise(resolve => setTimeout(resolve, 100)); assert.equal(requests.length, 2);
    for (const request of requests) {
      assert.equal(request.headers.cookie, undefined); assert.equal(request.headers.referer ?? '', '');
      assert.ok(!JSON.stringify(request).includes('PRIVATE_'));
    }
    assert.deepEqual(external, []); assert.deepEqual(errors, []);
    assert.deepEqual((await browser.cookies()).map(cookie => cookie.name), ['private_session'], 'no statistics cookie is created');
  } finally { await closeAcceptanceBrowser(browser); }
});
