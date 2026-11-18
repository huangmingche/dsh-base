#!/usr/bin/env node
/** Non-empty official catalog reference versus the actual Workers inventory seam. */
import { acceptanceLaunchOptions, closeAcceptanceBrowser } from '../../scripts/acceptance-config.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { settle, stableCompare, stableScreenshot } from './stability.mjs';
import { readOfficialPluginCatalog, assertOfficialPluginCatalog, LOCAL_MANAGEABLE_BUNDLES, REPRESENTATIVE_OFFICIAL_BUNDLES } from './official-plugin-catalog-oracle.mjs';
import { readOwnedPluginInventory, READONLY_OWNED_BUNDLES, assertOwnedBundleCards, assertReadonlyOwnedDetail, assertOwnedComponentNames, readOwnedDetailNames, ownershipLabel } from './owned-plugin-inventory-oracle.mjs';
import { GATEWAY_BUNDLE, GATEWAY_COMPONENTS, assertGatewayBundleCard, assertGatewayBundleDetail } from './gateway-bundle-assertions.mjs';
import { assertOfficialCards, openMorePlugins, openPluginDetail, assertUnavailablePluginDetail, backFromPluginDetail, managerCopy } from './plugin-manager-assertions.mjs';
import { normalizeOwnedArtwork, restoreOwnedArtwork } from './owned-plugin-artwork-reference.mjs';
import { DSH_BASE_PLUGIN_ICON } from '../../../../packages/client/dsh-base-client-plugin-manager/src/client/brand-artwork.ts';
const app = resolve(import.meta.dirname, '../..');
const requireFromApp = createRequire(resolve(app, 'package.json'));
const puppeteer = requireFromApp('puppeteer-core').default;
const vite = await import(requireFromApp.resolve('vite'));
const configFile = resolve(app, 'vite.parity.config.ts');
const output = resolve(app, 'dist/parity-evidence');
const oracle = readOfficialPluginCatalog();
const ownedOracle = readOwnedPluginInventory();
let server, browser;
const cases = [];
const snapshot = page => page.evaluate(() => ({
  text: document.querySelector('#root').innerText,
  controls: [...document.querySelectorAll('#root button,#root input')].map(element => {
    const b = element.getBoundingClientRect();
    return { tag: element.tagName, label: element.getAttribute('aria-label'), text: element.textContent, disabled: element.matches(':disabled'), rect: [b.x, b.y, b.width, b.height].map(n => Math.round(n * 100) / 100) };
  }),
}));
try {
  await mkdir(output, { recursive: true });
  await vite.build({ configFile, logLevel: 'error' });
  server = await vite.preview({ configFile, logLevel: 'error', preview: { host: '127.0.0.1', port: 0, strictPort: true } });
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await puppeteer.launch(acceptanceLaunchOptions());
  async function open(locale, state, side) {
    const page = await browser.newPage();
    page.setDefaultTimeout(10000);
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    const errors = [];
    const apiRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url()); });
    await page.evaluateOnNewDocument(bundles => { window.__PLUGIN_CATALOG_REFERENCE__ = bundles; }, oracle.bundles);
    await page.evaluateOnNewDocument(owned => { window.__OWNED_PLUGIN_REFERENCE__ = owned; }, ownedOracle);
    await page.goto(`${origin}/?${new URLSearchParams({ surface: 'plugin-manager', locale, state, side })}`, { waitUntil: 'networkidle0' });
    if (state.startsWith('builtin:')) await page.waitForFunction(() => window.__BUILTIN_PARITY__ !== undefined);
    else await page.waitForFunction(state => window.__PLUGIN_PARITY__?.source?.getSnapshot().status === (state === 'readonly' ? 'unavailable' : state === 'failure:request' ? 'error' : 'ready'), {}, state);
    await page.evaluate(() => document.fonts.ready);
    return { page, errors, apiRequests };
  }
  async function compare(reference, adapted, label, { approvedAvailability = false, approvedDisabledSwitch = false, approvedManagementPolicy = false, locale } = {}) {
    const normalizationStyles = [];
    const ownedArtwork = await reference.page.$$eval('img', (images, canonical) => images.filter(image => image.getAttribute('src') === canonical).length, DSH_BASE_PLUGIN_ICON);
    if (ownedArtwork > 0) {
      for (const [side, { page }] of [['reference', reference], ['adapted', adapted]]) {
        await writeFile(resolve(output, `${label}-${side}-brand-actual.png`), await stableScreenshot(page, { captureBeyondViewport: false }));
      }
      assert.equal(await normalizeOwnedArtwork(reference.page, DSH_BASE_PLUGIN_ICON), ownedArtwork);
      assert.equal(await adapted.page.$$eval('[data-dsh-brand-artwork]', elements => elements.length), ownedArtwork);
      normalizationStyles.push({ restore: () => restoreOwnedArtwork(reference.page) });
    }
    if (approvedManagementPolicy) {
      // Host ownership text and its neutral tone are explicit user-approved
      // adaptations. Preserve the raw captures, then compare all official
      // geometry/pixels with only this specific paragraph aligned.
      for (const [side, { page }] of [['reference', reference], ['adapted', adapted]]) {
        await page.mouse.move(0, 0);
        await writeFile(resolve(output, `${label}-${side}-actual.png`), await stableScreenshot(page, { captureBeyondViewport: false }));
      }
      const original = await reference.page.$eval('[data-plugin-detail] > p[role="status"]', element => ({ text: element.textContent, className: element.className }));
      const adaptedReason = await adapted.page.$eval('[data-plugin-detail] > p[role="status"]', element => ({ text: element.textContent, className: element.className }));
      assert.equal(adaptedReason.text, ownershipLabel(locale));
      await reference.page.$eval('[data-plugin-detail] > p[role="status"]', (element, value) => { element.textContent = value.text; element.className = value.className; }, adaptedReason);
      normalizationStyles.push({ restore: async () => reference.page.$eval('[data-plugin-detail] > p[role="status"]', (element, value) => { element.textContent = value.text; element.className = value.className; }, original) });
    }
    if (approvedDisabledSwitch) {
      // A recognized Host marker fails closed even when a real fault wins the
      // status. Assert this one approved interaction change before comparing
      // all remaining original error content and pixels without any masking.
      for (const [side, { page }] of [['reference', reference], ['adapted', adapted]]) {
        const switches = await page.$$('[data-plugin-package] [role="switch"]');
        assert.equal(switches.length, 1, `${label}: exactly one marked failure switch`);
        assert.equal(await switches[0].evaluate(element => element.disabled), side === 'adapted', `${label}: marked fault fails closed`);
        await page.mouse.move(0, 0);
        await writeFile(resolve(output, `${label}-${side}-actual.png`), await stableScreenshot(page, { captureBeyondViewport: false }));
      }
      await reference.page.$eval('[data-plugin-package] [role="switch"]', element => { element.disabled = true; });
    }
    if (approvedAvailability) {
      // Assert new presentation before this call. Normalize only the named,
      // user-approved capsule/redundant paragraph differences; all remaining
      // original artwork, description, controls and layout still compare exactly.
      for (const [side, { page }] of [['reference', reference], ['adapted', adapted]]) {
        await page.mouse.move(0, 0);
        await writeFile(resolve(output, `${label}-${side}-actual.png`), await stableScreenshot(page, { captureBeyondViewport: false }));
        const marked = await page.evaluate(({ side, names, copy }) => {
          const roots = [...document.querySelectorAll('[data-plugin-package],[data-plugin-detail]')].filter(root => names.includes(root.getAttribute('data-plugin-package') ?? root.getAttribute('data-plugin-detail')));
          let count = 0;
          for (const root of roots) {
            const detail = root.hasAttribute('data-plugin-detail');
            const mark = element => { element.setAttribute('data-approved-availability-normalization', ''); count++; };
            if (side === 'adapted') root.querySelectorAll('[data-deployment-unavailable]').forEach(mark);
            else {
              for (const tag of root.querySelectorAll('[data-tone]')) {
                if (tag.textContent.trim() === copy.statusProblem || (!detail && tag.textContent.trim() === copy.statusNotInstalled)) mark(tag);
              }
              for (const paragraph of root.querySelectorAll('p[role="status"]')) {
                const expected = detail ? `${copy.reasonLabel}: ${copy.reasonUnsupportedPlatform}` : copy.reasonUnsupportedPlatform;
                if (paragraph.textContent.trim() === expected) mark(paragraph);
              }
            }
          }
          return count;
        }, { side, names: oracle.bundles.map(bundle => bundle.name), copy: managerCopy(locale) });
        assert.ok(marked > 0, `${label}: approved differences are explicit and scoped`);
        normalizationStyles.push({ page, handle: await page.addStyleTag({ content: '[data-approved-availability-normalization]{display:none!important}' }) });
      }
    }
    console.log(`plugin manager comparing ${label}`);
    // Compare every scroll viewport, including off-screen More cards. The same
    // official reference remains separate from the marked adapted fork.
    const scrollSelector = await reference.page.$('[data-plugin-body]') ? '[data-plugin-body]' : '#root';
    const dimensions = await reference.page.$eval(scrollSelector, element => ({ height: element.clientHeight, total: element.scrollHeight }));
    const positions = [0];
    for (let y = Math.max(1, dimensions.height - 100); y < dimensions.total - dimensions.height; y += Math.max(1, dimensions.height - 100)) positions.push(y);
    if (dimensions.total > dimensions.height) positions.push(dimensions.total - dimensions.height);
    const hashes = [];
    for (const [index, y] of positions.entries()) {
      for (const { page } of [reference, adapted]) {
        await page.$eval(scrollSelector, (element, value) => {
          element.scrollTop = value;
          // A background Chromium tab can defer native scroll delivery until
          // capture. Run the actual official scroll listener on both sides.
          element.dispatchEvent(new Event('scroll'));
        }, y);
        await page.mouse.move(0, 0);
        await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
        await settle(page);
      }
      assert.deepEqual(await snapshot(adapted.page), await snapshot(reference.page), `${label}/${index}: official text, controls and geometry`);
      const pair = await stableCompare(`${label}/${index}`,
        () => stableScreenshot(reference.page, { captureBeyondViewport: false }),
        () => stableScreenshot(adapted.page, { captureBeyondViewport: false }));
      assert.ok(pair.equal, `${label}/${index}: official viewport pixels differ (attempts ${pair.attempts})`);
      await writeFile(resolve(output, `${label}-${index}-official.png`), pair.a);
      await writeFile(resolve(output, `${label}-${index}-adapted.png`), pair.b);
      hashes.push(createHash('sha256').update(pair.a).digest('hex'));
    }
    cases.push({ label, viewports: positions.length, approvedAvailability, approvedDisabledSwitch, approvedManagementPolicy, approvedOwnedArtwork: ownedArtwork, screenshotSha256: hashes });
    if (approvedDisabledSwitch) await reference.page.$eval('[data-plugin-package] [role="switch"]', element => { element.disabled = false; });
    for (const { page, handle, restore } of normalizationStyles) {
      if (restore) { await restore(); continue; }
      await handle.evaluate(element => element.remove());
      await page.$$eval('[data-approved-availability-normalization]', elements => elements.forEach(element => element.removeAttribute('data-approved-availability-normalization')));
    }
  }
  for (const locale of ['en', 'zh']) {
    const reference = await open(locale, 'standard', 'reference');
    const adapted = await open(locale, 'standard', 'adapted');
    const raw = await adapted.page.evaluate(() => window.__PLUGIN_PARITY__.remotes.manager.listBundles());
    assert.equal(raw.ok, true);
    assertOfficialPluginCatalog(raw.value, oracle);
    for (const [side, { page }] of [['reference', reference], ['adapted', adapted]]) {
      const cards = await assertOfficialCards(page, oracle.main, locale, oracle, { legacy: side === 'reference' });
      for (const name of LOCAL_MANAGEABLE_BUNDLES) assert.ok(cards.some(card => card.name === name && !card.disabled), `${name}: local manageable feature remains present`);
    }
    await compare(reference, adapted, `plugin-manager-${locale}-main`, { approvedAvailability: true, locale });
    const ownedNames = [];
    for (const { page } of [reference, adapted]) {
      await assertGatewayBundleCard(page);
      await openPluginDetail(page, GATEWAY_BUNDLE);
      const detail = await assertGatewayBundleDetail(page, locale, true, { managedExplanation: page === adapted.page });
      if (page === adapted.page) ownedNames.push(...detail.rows);
    }
    await compare(reference, adapted, `plugin-manager-${locale}-gateway-bundle-detail`);
    for (const { page } of [reference, adapted]) {
      await page.$eval(`[data-plugin-detail] button[aria-label=${JSON.stringify(managerCopy(locale).backToList)}]`, button => button.click());
      await page.waitForSelector('[data-plugin-group="bundles"]');
    }
    for (const name of READONLY_OWNED_BUNDLES) {
      const expected = ownedOracle.bundles.find(bundle => bundle.name === name);
      for (const { page } of [reference, adapted]) {
        await assertOwnedBundleCards(page);
        await openPluginDetail(page, name);
        const detail = await assertReadonlyOwnedDetail(page, name, locale, expected, { policyExplanation: page === adapted.page });
        if (page === adapted.page) ownedNames.push(...detail.rows);
      }
      const writesBefore = await adapted.page.evaluate(() => window.__PLUGIN_PARITY__.requests.length);
      await adapted.page.$$eval('[data-plugin-detail] [role="switch"]', elements => elements.forEach(element => element.click()));
      assert.equal(await adapted.page.evaluate(() => window.__PLUGIN_PARITY__.requests.length), writesBefore, 'read-only native controls do not invoke Host operations');
      const refused = await adapted.page.evaluate(async ({ name, ids }) => {
        const { remotes, requests } = window.__PLUGIN_PARITY__;
        const before = requests.length;
        const results = [await remotes.manager.setBundleEnabled(name, false)];
        for (const id of ids) results.push(await remotes.manager.setPluginEnabled(id, false));
        return { refused: results.every(answer => !answer.ok), requests: requests.length - before };
      }, { name, ids: expected.rows.map(row => row.entryId) });
      assert.deepEqual(refused, { refused: true, requests: 0 }, 'forged read-only component operations fail before control HTTP');
      await compare(reference, adapted, `plugin-manager-${locale}-owned-${name.split(':')[1]}`, { approvedManagementPolicy: true, locale });
      for (const { page } of [reference, adapted]) {
        await page.$eval(`[data-plugin-detail] button[aria-label=${JSON.stringify(managerCopy(locale).backToList)}]`, button => button.click());
        await page.waitForSelector('[data-plugin-group="bundles"]');
      }
    }
    for (const name of LOCAL_MANAGEABLE_BUNDLES.filter(name => name !== GATEWAY_BUNDLE)) {
      for (const { page } of [reference, adapted]) {
        await openPluginDetail(page, name);
        const rows = await readOwnedDetailNames(page, name, locale, ownedOracle.bundles.find(bundle => bundle.name === name));
        if (page === adapted.page) ownedNames.push(...rows);
        await page.$eval(`[data-plugin-detail] button[aria-label=${JSON.stringify(managerCopy(locale).backToList)}]`, button => button.click());
        await page.waitForSelector('[data-plugin-group="bundles"]');
      }
    }
    assertOwnedComponentNames(ownedNames, ownedOracle);
    await openMorePlugins(reference.page); await openMorePlugins(adapted.page);
    for (const [side, { page }] of [['reference', reference], ['adapted', adapted]]) await assertOfficialCards(page, oracle.more, locale, oracle, { legacy: side === 'reference' });
    await compare(reference, adapted, `plugin-manager-${locale}-more`, { approvedAvailability: true, locale });
    const writesBefore = await adapted.page.evaluate(() => window.__PLUGIN_PARITY__.requests.filter(request => request.method !== 'GET').length);
    await adapted.page.$$eval('[data-plugin-package] [role="switch"]', elements => elements.forEach(element => element.click()));
    await settle(adapted.page);
    assert.equal(await adapted.page.evaluate(() => window.__PLUGIN_PARITY__.requests.filter(request => request.method !== 'GET').length), writesBefore, 'disabled official switches cannot send mutations');
    for (const name of REPRESENTATIVE_OFFICIAL_BUNDLES) {
      await openPluginDetail(reference.page, name); await openPluginDetail(adapted.page, name);
      for (const [side, { page }] of [['reference', reference], ['adapted', adapted]]) await assertUnavailablePluginDetail(page, name, locale, oracle, { legacy: side === 'reference', requireReason: false });
      await compare(reference, adapted, `plugin-manager-${locale}-${name.split('/')[1]}`, { approvedAvailability: true, locale });
      await backFromPluginDetail(reference.page, locale); await backFromPluginDetail(adapted.page, locale);
    }
    const denied = await adapted.page.evaluate(async names => {
      const { remotes, requests } = window.__PLUGIN_PARITY__;
      const before = requests.filter(request => request.method !== 'GET').length;
      const results = [];
      for (const name of names) results.push(await remotes.manager.setBundleEnabled(name, true));
      return { results, writes: requests.filter(request => request.method !== 'GET').length - before };
    }, oracle.bundles.map(bundle => bundle.name));
    assert.ok(denied.results.every(result => result.ok === false), 'all original unavailable packages reject direct enabling');
    assert.equal(denied.writes, 0, 'unavailable catalog must never write owner controls');
    assert.deepEqual(reference.errors, []); assert.deepEqual(adapted.errors, []);
    await reference.page.close(); await adapted.page.close();

    for (const state of ['native', 'skipped', 'failure:unmarked-platform', 'failure:invalid-marker', 'failure:operation', 'failure:metadata', 'failure:runtime', 'failure:marked-runtime', 'failure:request']) {
      const original = await open(locale, state, 'reference');
      const actual = await open(locale, state, 'adapted');
      assert.equal(await actual.page.$$eval('[data-deployment-unavailable]', elements => elements.length), 0, `${state}: a real failure or unmarked package never becomes deployment-unavailable`);
      if (state === 'native') assert.deepEqual(await actual.page.$$eval('[data-plugin-package]', elements => elements.map(element => element.getAttribute('data-plugin-status')).sort()), ['disabled', 'running'], 'native active and intentionally off packages both remain represented');
      if (state === 'skipped') {
        const card = '[data-plugin-package][data-plugin-status="not-running"]';
        assert.equal(await actual.page.$eval(card + ' [data-tone="danger"]', element => element.textContent), managerCopy(locale).statusNotRunning);
        assert.equal(await actual.page.$eval(card + ' [role="switch"]', element => element.getAttribute('aria-checked')), 'true');
      }
      if (state.startsWith('failure:') && state !== 'failure:request') {
        assert.equal(await actual.page.$eval('[data-plugin-package]', element => element.getAttribute('data-plugin-status')), 'problem');
        assert.ok(await actual.page.$('[data-plugin-package] [data-tone="danger"]'), `${state}: real problem remains visibly red`);
      }
      if (state === 'failure:metadata') assert.match(await actual.page.$eval('[data-package-meta-error]', element => element.textContent), /Invalid package metadata/u);
      await compare(original, actual, `plugin-manager-${locale}-${state.replace(':', '-')}`, { approvedDisabledSwitch: state === 'failure:marked-runtime' });
      if (['failure:operation', 'failure:metadata'].includes(state)) {
        const name = await original.page.$eval('[data-plugin-package]', element => element.getAttribute('data-plugin-package'));
        await openPluginDetail(original.page, name); await openPluginDetail(actual.page, name);
        assert.equal(await actual.page.$$eval('[data-deployment-unavailable]', elements => elements.length), 0);
        assert.ok(await actual.page.$('[data-plugin-detail] [data-tone="danger"]'));
        await compare(original, actual, `plugin-manager-${locale}-${state.replace(':', '-')}-detail`);
      }
      assert.deepEqual(original.errors, []); assert.deepEqual(actual.errors, []);
      await original.page.close(); await actual.page.close();
    }

    const management = await open(locale, 'management', 'adapted');
    const changed = await management.page.evaluate(async names => {
      const { remotes } = window.__PLUGIN_PARITY__;
      const results = [];
      for (const name of names) {
        const off = await remotes.manager.setBundleEnabled(name, false);
        const afterOff = await remotes.manager.listBundles();
        const on = await remotes.manager.setBundleEnabled(name, true);
        const afterOn = await remotes.manager.listBundles();
        results.push({ name, off, on, disabled: afterOff.ok && afterOff.value.find(bundle => bundle.name === name)?.enabled === false, enabled: afterOn.ok && afterOn.value.find(bundle => bundle.name === name)?.enabled === true });
      }
      return { results, denied: await remotes.manager.setBundleEnabled('@dsh-base/client-deepseek-provider', false) };
    }, LOCAL_MANAGEABLE_BUNDLES);
    for (const result of changed.results) {
      assert.equal(result.off.ok, true, `${result.name}: disable`); assert.equal(result.on.ok, true, `${result.name}: enable`);
      assert.equal(result.disabled, true); assert.equal(result.enabled, true);
      if (result.name.includes('cloudflare-think')) assert.equal(result.off.value.application, 'applied');
    }
    assert.equal(changed.denied.ok, false);
    await management.page.evaluate(() => window.__PLUGIN_PARITY__.refresh());
    await management.page.waitForFunction(() => window.__PLUGIN_PARITY__.source.getSnapshot().status === 'ready');
    await assertGatewayBundleCard(management.page);
    await openPluginDetail(management.page, GATEWAY_BUNDLE);
    await assertGatewayBundleDetail(management.page, locale);
    const beforeNativeClicks = await management.page.evaluate(() => window.__PLUGIN_PARITY__.requests.length);
    await management.page.$$eval('[data-plugin-row] [role="switch"]', elements => elements.forEach(element => element.click()));
    await settle(management.page);
    assert.equal(await management.page.evaluate(() => window.__PLUGIN_PARITY__.requests.length), beforeNativeClicks, 'readonly component switches do not invoke the Host');
    for (const enabled of [false, true]) {
      const before = await management.page.evaluate(() => window.__PLUGIN_PARITY__.control());
      await management.page.$eval('[data-plugin-detail] [role="switch"]', element => element.click());
      await management.page.waitForFunction(enabled => {
        const toggle = document.querySelector('[data-plugin-detail] [role="switch"]');
        return toggle?.getAttribute('aria-checked') === String(enabled) && !toggle.disabled;
      }, {}, enabled);
      const after = await management.page.evaluate(() => window.__PLUGIN_PARITY__.control());
      assert.equal(after.revision, before.revision + 1, 'one bundle action commits one owner revision');
      for (const component of GATEWAY_COMPONENTS) assert.equal(after.overrides[component.module]?.disabled, !enabled, 'both component selections change together');
      await assertGatewayBundleDetail(management.page, locale, enabled);
    }
    assert.deepEqual(management.errors, []);
    cases.push({ locale, state: 'management', bundles: LOCAL_MANAGEABLE_BUNDLES });
    await management.page.close();

    const readonly = await open(locale, 'readonly', 'adapted');
    assert.equal(await readonly.page.$$eval('[data-plugin-package]', elements => elements.length), 0);
    assert.equal(await readonly.page.evaluate(() => window.__PLUGIN_PARITY__.calls.some(call => call.endpoint.startsWith('pluginManager/'))), false, 'unavailable management must not call mutation/read manager endpoints');
    assert.deepEqual(readonly.errors, []);
    cases.push({ locale, state: 'readonly' });
    await readonly.page.close();

    const servedSearch = await open(locale, 'builtin:web-search:served', 'reference');
    const { page: searchPage } = servedSearch;
    const searchSection = 'section[aria-labelledby="plugin-config-web-search-section"]';
    const hint = locale === 'zh' ? /DeepSeek 服务端搜索.*不按次收费.*DeepSeek Search API/ : /DeepSeek server-side search.*no per-search charge.*DeepSeek Search API/;
    const guide = locale === 'zh' ? 'https://api-docs.deepseek.com/zh-cn/guides/search' : 'https://api-docs.deepseek.com/guides/search';
    assert.match(await searchPage.$eval(searchSection, section => section.innerText), hint);
    assert.equal(await searchPage.$eval(`${searchSection} a`, link => link.href), guide);
    assert.equal(await searchPage.$('section[aria-labelledby="plugin-config-web-fetch-section"] a'), null);
    assert.equal(await searchPage.$('#plugin-config-web-search-key'), null);
    await searchPage.click('#plugin-config-web-search-provider');
    const providerLabel = locale === 'zh' ? 'DeepSeek 服务端搜索' : 'DeepSeek server-side search';
    await searchPage.locator(`::-p-aria([name="${providerLabel}"][role="menuitem"])`).click();
    await searchPage.waitForSelector('#plugin-config-web-search-key');
    assert.equal(await searchPage.$eval('#plugin-config-web-search-provider', button => button.innerText), providerLabel);
    assert.doesNotMatch(await searchPage.$eval(searchSection, section => section.innerText), hint);
    assert.equal(await searchPage.$(`${searchSection} a`), null);
    await searchPage.evaluate(() => window.dispatchEvent(new Event('parity:unmount')));
    await searchPage.waitForFunction(() => !window.__BUILTIN_PARITY__.registered() && !document.querySelector('[data-builtin-contract]'));
    assert.deepEqual(servedSearch.errors, []); assert.deepEqual(servedSearch.apiRequests, []);
    cases.push({ locale, state: 'official-web-search-auto-to-explicit' });
    await searchPage.close();

    for (const id of ['subagent', 'web-search', 'agent-loop', 'shell']) {
      const original = await open(locale, `builtin:${id}`, 'reference');
      const unavailable = await open(locale, `builtin:${id}`, 'adapted');
      const reason = await unavailable.page.$eval('[data-builtin-unavailable]', element => element.textContent);
      assert.ok(reason?.length > 10, `${id}: unavailable reason is visible`);
      if (locale === 'zh') assert.match(reason, /[\u4e00-\u9fff]/u);
      for (const { page } of [original, unavailable]) {
        const states = await page.evaluate(() => window.__BUILTIN_PARITY__.snapshots());
        assert.ok(Object.values(states).every(value => value.available === false), `${id}: real official controllers report unavailable forms`);
        assert.ok(await page.$$eval('[data-builtin-contract] input,[data-builtin-contract] select,[data-builtin-contract] textarea', elements => elements.every(element => element.matches(':disabled'))));
        if (id === 'web-search') {
          assert.equal(await page.$('#plugin-config-web-search-provider, #plugin-config-web-fetch-provider'), null);
          assert.equal(await page.$('[data-builtin-contract] a'), null, 'an unavailable Host does not advertise automatic search');
        }
      }
      // The extra explanation is an explicit Host availability seam. Check it
      // above, then compare every pixel of the original form without that text.
      await unavailable.page.addStyleTag({ content: '[data-builtin-unavailable]{display:none!important}' });
      await compare(original, unavailable, `plugin-manager-${locale}-builtin-${id}`);
      assert.deepEqual(original.apiRequests, []); assert.deepEqual(unavailable.apiRequests, [], 'unavailable built-ins never probe private Host services');
      assert.deepEqual(original.errors, []); assert.deepEqual(unavailable.errors, []);
      await original.page.close(); await unavailable.page.close();
    }
  }
  const lock = JSON.parse(await readFile(resolve(app, '../../dsh-source.lock.json'), 'utf8'));
  await writeFile(resolve(output, 'plugin-manager-report.json'), JSON.stringify({ ok: true, upstream: lock.commit, scope: 'Pinned official page versus the marked availability fork and real inventory seam. Explicitly asserted approved deployment-unavailable differences are excluded only for core text/geometry/pixel comparisons of en/zh main, every More viewport and representative details. Native states and real request/operation/metadata/runtime failures retain full unmasked official parity. A separate marked runtime failure asserts the fail-closed switch, normalizes only that reference disabled property, and compares every error label, message and pixel. Also covers all 18 catalog candidates, neutral Tag styling, disabled controls, no fabricated runtime, mutation refusal, all owned bundles covering every independently composed component, three independently writable bundles, read-only ownership/refusal coverage, the unified two-component Gateway detail with unmasked official parity and localized readonly component explanations, single-revision Gateway group toggles, unavailable management and built-in wrappers. No whole-app or deployed Host claim.', official: { all: oracle.bundles.map(bundle => bundle.name), main: oracle.main, more: oracle.more, hiddenByOfficialUi: oracle.hidden }, cases }, null, 2));
  console.log(`plugin manager non-empty official catalog/reference/management: ${cases.length} Chromium cases passed`);
} finally {
  await closeAcceptanceBrowser(browser); await server?.close();
}
