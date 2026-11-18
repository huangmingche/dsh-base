#!/usr/bin/env node
/** Short, read-only brand regression over the real plugin manager and metadata seam. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { acceptanceLaunchOptions, closeAcceptanceBrowser } from '../../scripts/acceptance-config.mjs';
import { readOfficialPluginCatalog } from './official-plugin-catalog-oracle.mjs';
import { readOwnedPluginInventory, OWNED_BUNDLE_TITLES, assertComponentPrefix } from './owned-plugin-inventory-oracle.mjs';
import { normalizeOwnedArtwork, restoreOwnedArtwork } from './owned-plugin-artwork-reference.mjs';
import { readOfficialSiteMark } from '../../../../scripts/assets/official-site-mark.mjs';
import { CLOUDFLARE_PLUGIN_ICON } from '../../../../packages/client/dsh-base-client-session-adapter/src/client/cloudflare-plugin-icon.ts';

const app = resolve(import.meta.dirname, '../..'), require = createRequire(resolve(app, 'package.json'));
const vite = await import(require.resolve('vite')), puppeteer = require('puppeteer-core');
const output = resolve(process.env.DSH_PARITY_OUTPUT ?? resolve(app, 'dist/parity-evidence/owned-plugin-artwork'));
const configFile = resolve(app, 'vite.parity.config.ts'), outDir = resolve(process.env.DSH_PARITY_BUILD_DIR ?? resolve(app, 'dist/parity-owned-artwork'));
const owned = readOwnedPluginInventory(), official = readOfficialPluginCatalog(), mark = readOfficialSiteMark();
const cloudflareHash = createHash('sha256').update(Buffer.from(CLOUDFLARE_PLUGIN_ICON.split(',')[1], 'base64')).digest('hex');
assert.equal(cloudflareHash, '1c87883a8d8037c52d0dfe59f328ebbaac09e86243c0d927ece8847d3b6051fc', 'Cloudflare artwork remains the reviewed original');
const cases = [], errors = [], report = { ok: false, cases, errors };
let browser, server;
const quoted = value => JSON.stringify(value);
const card = name => `[data-plugin-package=${quoted(name)}] [class*="cardIcon"]`;
const detail = name => `[data-plugin-detail=${quoted(name)}] > [class*="detailTop"] [class*="cardIcon"]`;
const row = id => `[data-plugin-row=${quoted(id)}] [class*="rowIcon"]`;
const rowDetail = '[data-plugin-row-detail] > [class*="detailTop"] [class*="cardIcon"]';
const sourceFor = id => owned.rows.find(row => row.entryId === id);
// Independent approved dimensions: original artwork slots and optical whale widths.
const whaleWidths = { 30: 20, 36: 24 };
function componentBrand(name, title) { assertComponentPrefix(title, name); return title.startsWith('Dsh-base ') ? 'dsh' : 'cloudflare'; }

async function show(page, view, selector) {
  await page.evaluate(view => window.__PLUGIN_PARITY__.showView(view), view);
  await page.waitForSelector(selector);
}
async function checkIcons(page, seats) {
  const actual = await page.evaluate(seats => {
    const read = seat => {
      const frame = document.querySelector(seat.selector);
      if (!frame) throw new Error(`Missing artwork seat: ${seat.selector}`);
      const marker = frame.querySelector('[data-dsh-brand-artwork]'), svg = marker?.querySelector('svg'), path = svg?.querySelector('path');
      const image = frame.querySelector('img');
      const reference = document.querySelector(`[data-official-fish-reference="${seat.size}"] svg`);
      const css = getComputedStyle(frame);
      const dimensions = element => { const box = element?.getBoundingClientRect(); return box ? [box.width, box.height] : null; };
      const centerDelta = (child, parent) => { const a = child?.getBoundingClientRect(), b = parent?.getBoundingClientRect(); return a && b ? [a.x + a.width / 2 - b.x - b.width / 2, a.y + a.height / 2 - b.y - b.height / 2] : null; };
      return { id: seat.id, frame: [parseFloat(css.width), parseFloat(css.height)], marker: !!marker,
        image: image?.getAttribute('src') ?? null, imageSize: image ? [Number(image.getAttribute('width')), Number(image.getAttribute('height'))] : null,
        slot: dimensions(marker), renderedWhale: dimensions(svg), slotCenter: centerDelta(marker, frame), whaleCenter: centerDelta(svg, marker),
        path: path?.getAttribute('d'), viewBox: svg?.getAttribute('viewBox'), width: Number(svg?.getAttribute('width')), height: Number(svg?.getAttribute('height')),
        fill: path ? getComputedStyle(path).fill : null, display: marker ? marker.style.display : null,
        reference: { path: reference.querySelector('path').getAttribute('d'), viewBox: reference.getAttribute('viewBox'), fill: getComputedStyle(reference.querySelector('path')).fill } };
    };
    return seats.map(read);
  }, seats);
  for (const [index, icon] of actual.entries()) {
    const seat = seats[index]; assert.deepEqual(icon.frame, [seat.frame, seat.frame], `${seat.id}: original frame geometry`);
    if (seat.brand === 'dsh') {
      assert.equal(icon.marker, true, `${seat.id}: owned whale is rendered`); assert.equal(icon.image, null);
      assert.equal(icon.path, mark.path); assert.equal(icon.path, icon.reference.path);
      assert.equal(icon.viewBox, `0 0 ${mark.viewBox.width} ${mark.viewBox.height}`); assert.equal(icon.viewBox, icon.reference.viewBox);
      const opticalWidth = whaleWidths[seat.size], opticalHeight = opticalWidth * mark.viewBox.height / mark.viewBox.width;
      assert.deepEqual(icon.slot, [seat.size, seat.size], `${seat.id}: original square artwork slot`);
      assert.equal(icon.width, opticalWidth); assert.ok(Math.abs(icon.height - opticalHeight) < 0.00001);
      assert.ok(Math.abs(icon.renderedWhale[0] - opticalWidth) < 0.02 && Math.abs(icon.renderedWhale[1] - opticalHeight) < 0.02, `${seat.id}: optical whale size and aspect ratio`);
      assert.ok([...icon.slotCenter, ...icon.whaleCenter].every(delta => Math.abs(delta) < 0.02), `${seat.id}: whale and square slot stay centered`);
      assert.equal(icon.fill, icon.reference.fill, `${seat.id}: manual-theme primary ink matches official FishLogo`); assert.equal(icon.display, 'inline-flex');
    } else { assert.equal(icon.marker, false, `${seat.id}: other artwork is never rewritten`); assert.equal(icon.image, seat.src ?? CLOUDFLARE_PLUGIN_ICON); assert.deepEqual(icon.imageSize, [seat.size, seat.size], `${seat.id}: other artwork dimensions unchanged`); }
  }
  return actual;
}
async function compareAtom(page, selector, size, label) {
  const target = `${selector} [data-dsh-brand-artwork]`;
  await page.$eval(target, element => element.scrollIntoView({ block: 'center' }));
  const original = await (await page.$(target)).screenshot();
  await page.evaluate(({ target, size }) => {
    const actual = document.querySelector(`${target} svg`), reference = document.querySelector(`[data-official-fish-reference="${size}"] svg`);
    window.__ARTWORK_ATOM__ = { actual, reference, home: reference.parentElement };
    actual.replaceWith(reference);
  }, { target, size });
  try {
    const expected = await (await page.$(target)).screenshot();
    assert.ok(Buffer.from(original).equals(Buffer.from(expected)), `${label}: unchanged official FishLogo pixels at the same position`);
    await writeFile(resolve(output, `${label}.png`), original);
  } finally {
    await page.evaluate(() => { const { actual, reference, home } = window.__ARTWORK_ATOM__; reference.replaceWith(actual); home.append(reference); delete window.__ARTWORK_ATOM__; });
  }
}

try {
  await mkdir(output, { recursive: true });
  await vite.build({ configFile, logLevel: 'error', build: { outDir, emptyOutDir: true } });
  server = await vite.preview({ configFile, logLevel: 'error', build: { outDir }, preview: { host: '127.0.0.1', port: 0, strictPort: true } });
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await puppeteer.launch(acceptanceLaunchOptions());
  for (const locale of ['en', 'zh']) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage(); page.setDefaultTimeout(10000);
    const width = locale === 'en' ? 1280 : 390;
    await page.setViewport({ width, height: 1000, deviceScaleFactor: 1 });
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme === 'dark' ? 'light' : 'dark' }]);
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', request => { if (new URL(request.url()).origin === origin || request.url().startsWith('data:')) void request.continue(); else { errors.push(`Unexpected network: ${new URL(request.url()).origin}`); void request.abort(); } });
    await page.evaluateOnNewDocument(({ owned, official }) => { window.__OWNED_PLUGIN_REFERENCE__ = owned; window.__PLUGIN_CATALOG_REFERENCE__ = official; }, { owned, official: official.bundles });
    await page.goto(`${origin}/?${new URLSearchParams({ surface: 'plugin-manager', state: 'artwork', side: 'adapted', locale })}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => window.__PLUGIN_PARITY__?.source.getSnapshot().status === 'ready');
    await page.evaluate(theme => { document.body.toggleAttribute('data-ds-dark-theme', theme === 'dark'); }, theme);
    assert.equal(await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches), theme !== 'dark', 'OS preference is deliberately opposite to manual theme');
    const result = await page.evaluate(() => window.__PLUGIN_PARITY__.remotes.manager.listBundles()); assert.equal(result.ok, true);
    const byName = new Map(result.value.map(bundle => [bundle.name, bundle]));
    for (const expected of official.bundles) assert.equal(byName.get(expected.name)?.meta.icon, expected.meta.icon, `${expected.name}: official metadata artwork unchanged`);
    const canonical = byName.get('dsh-base:base').meta.icon;
    assert.match(canonical, /^data:image\/svg\+xml;base64,/);
    const canonicalShape = await page.evaluate(svg => { const doc = new DOMParser().parseFromString(svg, 'image/svg+xml'); return { path: doc.querySelector('path')?.getAttribute('d'), viewBox: doc.documentElement.getAttribute('viewBox'), invalid: !!doc.querySelector('parsererror') }; }, Buffer.from(canonical.split(',')[1], 'base64').toString());
    assert.deepEqual(canonicalShape, { path: mark.path, viewBox: `0 0 ${mark.viewBox.width} ${mark.viewBox.height}`, invalid: false });
    const cardSeats = owned.bundles.map(bundle => {
      const expectedTitle = OWNED_BUNDLE_TITLES[bundle.name][locale], meta = byName.get(bundle.name).meta;
      assert.equal(meta.title[locale], expectedTitle);
      const brand = expectedTitle.startsWith('Dsh-base ') ? 'dsh' : 'cloudflare';
      assert.equal(meta.icon, brand === 'dsh' ? canonical : CLOUDFLARE_PLUGIN_ICON);
      return { id: bundle.name, selector: card(bundle.name), size: 36, frame: 48, brand };
    });
    const mainIcons = await checkIcons(page, cardSeats);
    await compareAtom(page, card('dsh-base:base'), 36, `${locale}-${theme}-bundle-list`);
    await page.screenshot({ path: resolve(output, `${locale}-${theme}-list.png`) });
    let components = 0, dshComponents = 0, rowSample;
    for (const bundle of owned.bundles) {
      await show(page, { kind: 'package', name: bundle.name }, `[data-plugin-detail=${quoted(bundle.name)}]`);
      await checkIcons(page, [{ ...cardSeats.find(seat => seat.id === bundle.name), selector: detail(bundle.name) }]);
      const actualRows = await page.$$eval('[data-plugin-row]', rows => rows.map(row => ({ id: row.getAttribute('data-plugin-row'), title: row.querySelector('[class*="rowId"]').textContent.trim() })));
      assert.deepEqual(actualRows.map(row => row.id).sort(), bundle.rows.map(row => row.entryId).sort());
      const seats = actualRows.map(item => {
        const source = sourceFor(item.id), brand = componentBrand(source.moduleName, item.title);
        const metadata = byName.get(bundle.name).rows.find(row => row.rowId === item.id).meta;
        assert.equal(metadata.icon, brand === 'dsh' ? canonical : CLOUDFLARE_PLUGIN_ICON, `${item.id}: component metadata icon`);
        if (brand === 'dsh') { dshComponents++; rowSample ??= { bundle: bundle.name, id: item.id }; }
        return { id: item.id, selector: row(item.id), size: 30, frame: 40, brand };
      });
      await checkIcons(page, seats); components += seats.length;
      if (bundle.name === 'dsh-base:base') {
        await compareAtom(page, detail(bundle.name), 36, `${locale}-${theme}-bundle-detail`);
        await page.screenshot({ path: resolve(output, `${locale}-${theme}-detail.png`) });
        await compareAtom(page, seats.find(seat => seat.brand === 'dsh').selector, 30, `${locale}-${theme}-component-row`);
      }
    }
    assert.equal(components, owned.rows.length);
    await show(page, { kind: 'row', name: rowSample.bundle, rowId: rowSample.id }, '[data-plugin-row-detail]');
    await checkIcons(page, [{ id: rowSample.id, selector: rowDetail, size: 36, frame: 48, brand: 'dsh' }]);
    await compareAtom(page, rowDetail, 36, `${locale}-${theme}-component-detail`);
    // A live manual-theme transition must update the mounted atom without consulting OS preference.
    const beforeFill = await page.$eval(`${rowDetail} path`, path => getComputedStyle(path).fill);
    await page.evaluate(() => document.body.toggleAttribute('data-ds-dark-theme'));
    const switched = await checkIcons(page, [{ id: rowSample.id, selector: rowDetail, size: 36, frame: 48, brand: 'dsh' }]);
    assert.notEqual(switched[0].fill, beforeFill);
    await page.evaluate(() => document.body.toggleAttribute('data-ds-dark-theme'));
    await show(page, { kind: 'more' }, '[data-plugin-group="more"]');
    await checkIcons(page, official.more.map(name => ({ id: name, selector: card(name), size: 36, frame: 48, brand: 'official', src: byName.get(name).meta.icon })));
    assert.equal(await page.evaluate(() => window.__PLUGIN_PARITY__.requests.filter(request => request.method !== 'GET').length), 0);
    cases.push({ locale, theme, width, oppositeSystemTheme: true, bundles: cardSeats.length, components, dshBundles: mainIcons.filter(icon => icon.marker).length, dshComponents, whaleWidths, artworkSlots: [30, 36], frames: [40, 48], centered: true, fourSurfaceOfficialPixels: true, liveThemeTransition: true, officialIcons: official.more.length, mutations: 0 });
    // Exercise the full-suite's tightly scoped reference normalization once.
    if (locale === 'en' && theme === 'light') {
      await page.goto(`${origin}/?surface=plugin-manager&state=artwork&side=reference&locale=en`, { waitUntil: 'networkidle0' });
      await page.waitForFunction(() => window.__PLUGIN_PARITY__?.source.getSnapshot().status === 'ready');
      const imagesBefore = await page.$$eval('img', images => images.map(image => image.getAttribute('src')));
      await page.screenshot({ path: resolve(output, 'reference-before-approved-brand.png') });
      const count = await normalizeOwnedArtwork(page, canonical);
      assert.equal(count, cardSeats.filter(seat => seat.brand === 'dsh').length);
      const remaining = await page.$$eval('img', images => images.map(image => image.getAttribute('src')));
      assert.deepEqual(remaining, imagesBefore.filter(src => src !== canonical), 'normalization preserves every other image');
      await restoreOwnedArtwork(page);
      assert.deepEqual(await page.$$eval('img', images => images.map(image => image.getAttribute('src'))), imagesBefore, 'normalization is fully reversible');
    }
    await page.close(); console.log(`owned artwork ${locale}/${theme}/${width}: ${cardSeats.length} bundles, ${components} components, four surfaces passed`);
  }
  assert.deepEqual(errors, []); report.ok = true;
  console.log(JSON.stringify({ ok: true, cases: cases.length, output }));
} catch (error) { report.error = String(error.stack ?? error); throw error; }
finally { await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2)); await closeAcceptanceBrowser(browser); await server?.close(); }
