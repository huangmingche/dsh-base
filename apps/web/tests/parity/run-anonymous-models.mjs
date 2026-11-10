#!/usr/bin/env node
/** Direct pinned readonly editor parity, truthful public declarations and default-path parity. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { acceptanceLaunchOptions, closeAcceptanceBrowser } from '../../scripts/acceptance-config.mjs';
import { settle, stableCompare, stableScreenshot } from './stability.mjs';
const app = resolve(import.meta.dirname, '../..'), require = createRequire(resolve(app, 'package.json'));
const puppeteer = require('puppeteer-core'), vite = await import(require.resolve('vite'));
const configFile = resolve(app, 'vite.parity.config.ts');
const output = resolve(process.env.DSH_PARITY_OUTPUT ?? resolve(app, 'dist/parity-evidence/anonymous-models'));
const staleOnly = process.env.DSH_PARITY_ONLY === 'stale';
const report = { selection: staleOnly ? 'final stale-credential guards' : 'full layout and behavior', ok: false, scope: 'Public cards keep real unconfigured/unknown credential state. Their readonly editor is directly compared to pinned ProviderEditor; declaration-only section behavior is an explicit extension. Default ModelsSection paths are separately compared directly to the pinned implementation.', publicCases: [], defaultCases: [], staleCredentialCases: [], errors: [], requests: [] };
let browser, server;
const provider = '[data-anonymous-models] [data-public-provider="deepseek-official"]';
const editor = `${provider} [class*="editor"]:not([class*="editorHeader"]):not([class*="editorTitle"]):not([class*="editorRoute"]):not([class*="editorActions"])`;
const referenceEditor = '[data-reference-editor-container] > div';
const surface = (page, selector) => page.$eval(selector, root => {
  const origin = root.getBoundingClientRect();
  return { text: root.textContent, width: origin.width, height: origin.height,
    nodes: [root, ...root.querySelectorAll('*')].map(element => {
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
      return { tag: element.tagName, text: element.children.length ? null : element.textContent,
        role: element.getAttribute('role'), label: element.getAttribute('aria-label'), disabled: element.matches(':disabled'),
        value: 'value' in element ? element.value : null,
        rect: [rect.x - origin.x, rect.y - origin.y, rect.width, rect.height],
        style: Object.fromEntries(['display', 'alignItems', 'justifyContent', 'font', 'color', 'backgroundColor', 'border', 'borderRadius', 'cornerShape', 'padding', 'margin', 'gap', 'opacity'].map(key => [key, style[key]])),
      };
    }) };
});
try {
  await mkdir(output, { recursive: true }); await vite.build({ configFile, logLevel: 'error' });
  server = await vite.preview({ configFile, logLevel: 'error', preview: { host: '127.0.0.1', port: 0, strictPort: true } });
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`, launch = acceptanceLaunchOptions();
  browser = await puppeteer.launch({ ...launch, args: [...launch.args, '--disable-gpu'] });
  const open = async ({ locale, theme, width, side, mode = 'public', state = 'ready' }) => {
    const page = await browser.newPage(); page.setDefaultTimeout(12000);
    page.on('pageerror', error => report.errors.push({ locale, side, mode, state, message: error.message }));
    page.on('request', request => { const url = new URL(request.url()); if (url.pathname.startsWith('/api/') || url.origin !== origin && !url.protocol.startsWith('data')) report.requests.push({ locale, side, mode, state, url: request.url() }); });
    await page.setViewport({ width, height: 1000, deviceScaleFactor: 1 });
    await page.goto(`${origin}/?${new URLSearchParams({ surface: 'anonymous-models', locale, side, mode, state })}`, { waitUntil: 'networkidle0' });
    await page.evaluate(theme => document.body.toggleAttribute('data-ds-dark-theme', theme === 'dark'), theme);
    await page.waitForFunction(() => window.__ANONYMOUS_MODELS_PARITY__ !== undefined); await settle(page);
    return page;
  };
  const clickLabel = (page, selector, label) => page.$eval(selector, (root, text) => {
    const button = [...root.querySelectorAll('button')].find(element => element.textContent.trim() === text);
    if (!button) throw new Error(`Missing button: ${text}`); button.click();
  }, label);
  for (const locale of staleOnly ? [] : ['en', 'zh']) for (const theme of ['light', 'dark']) for (const width of [1280, 390]) {
    const label = `${locale}-${theme}-${width}`;
    const reference = await open({ locale, theme, width, side: 'reference' }), adapted = await open({ locale, theme, width, side: 'adapted' });
    await adapted.waitForSelector(`${provider} input[type="password"]`);
    const compareEditor = async (stage, setup) => {
      const box = await adapted.$eval(editor, element => { const rect = element.getBoundingClientRect(); return { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height }; });
      await reference.evaluate(frame => window.__ANONYMOUS_MODELS_PARITY__.setFrame(frame), { ...box, setup });
      for (const page of [reference, adapted]) { await page.mouse.move(0, 0); await page.evaluate(() => { window.scrollTo(0, 0); document.activeElement instanceof HTMLElement && document.activeElement.blur(); }); await settle(page); }
      const actual = await surface(adapted, editor), official = await surface(reference, referenceEditor);
      assert.deepEqual(actual, official, `${label}/${stage}: direct pinned readonly ProviderEditor DOM and styles`);
      const referenceBox = await reference.$eval(referenceEditor, element => { const rect = element.getBoundingClientRect(); return { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height }; });
      const pair = await stableCompare(`${label}/${stage}`,
        () => stableScreenshot(reference, { clip: referenceBox, captureBeyondViewport: true }),
        () => stableScreenshot(adapted, { clip: box, captureBeyondViewport: true }));
      await writeFile(resolve(output, `${label}-${stage}-official.png`), pair.a); await writeFile(resolve(output, `${label}-${stage}-adapted.png`), pair.b);
      assert.ok(pair.equal, `${label}/${stage}: exact pinned readonly editor pixels`);
      return { stage, directOfficialReference: true, exactPixels: true, width: actual.width, height: actual.height };
    };
    const stages = [await compareEditor('setup', true)];
    const state = await adapted.evaluate(() => {
      const { host, officialCopy, copy } = window.__ANONYMOUS_MODELS_PARITY__, snapshot = host.controller.store.getSnapshot();
      const root = document.querySelector('[data-anonymous-models]');
      return { status: snapshot.status, writable: snapshot.writable,
        rows: snapshot.rows.map(row => ({ id: row.entry.provider, active: row.entry.active, configured: row.configured, removable: row.removable, credentialUnknown: row.credential === undefined, apiKeyEnvAbsent: row.apiKeyEnv === undefined })),
        namespaces: [...snapshot.namespaces.values()].map(namespace => ({ ns: namespace.ns, user: namespace.user, secrets: namespace.secrets, revision: namespace.revision })),
        officialCopy, copy, title: root.querySelector('h2').textContent, intro: root.querySelector('h2 + p').textContent,
        configuredDots: root.querySelectorAll('[class*="credentialDotConfigured"], [data-tone="success"]').length,
        enabledFields: [...root.querySelectorAll('input, select, textarea')].filter(element => !element.disabled).length,
      };
    });
    assert.equal(state.status, 'ready'); assert.equal(state.writable, false);
    assert.deepEqual(state.rows.map(row => row.id), ['deepseek-official', 'cloudflare-ai-gateway']);
    assert.ok(state.rows.every(row => !row.active && !row.configured && !row.removable && row.credentialUnknown && row.apiKeyEnvAbsent));
    assert.ok(state.namespaces.every(namespace => Object.keys(namespace.user).length === 0 && namespace.secrets.length === 0 && namespace.revision === 0));
    assert.equal(state.title, state.officialCopy.title); assert.equal(state.intro, state.officialCopy.intro);
    assert.equal(state.configuredDots, 0); assert.equal(state.enabledFields, 0);
    await clickLabel(adapted, provider, state.officialCopy.apply);
    assert.deepEqual(await adapted.evaluate(() => window.__ANONYMOUS_MODELS_PARITY__.calls), []);
    for (const [page, selector] of [[reference, referenceEditor], [adapted, editor]]) await page.$eval(`${selector} summary`, element => element.click());
    stages.push(await compareEditor('customized', true));
    const readonly = await adapted.$eval(provider, root => [...root.querySelectorAll('input, textarea, select')].every(element => element.disabled));
    assert.equal(readonly, true, 'advanced fields stay readable and readonly');
    await clickLabel(adapted, provider, state.officialCopy.cancel); await adapted.waitForSelector(editor, { hidden: true });
    await clickLabel(adapted, provider, state.officialCopy.edit); await adapted.waitForSelector(editor);
    stages.push(await compareEditor('reopened', false));
    const gateway = '[data-anonymous-models] [data-gateway-provider="signed-out"]';
    await adapted.click(`${gateway} button`);
    const gatewayState = await adapted.$eval(gateway, element => {
      const button = element.querySelector('button'), panel = document.getElementById(button.getAttribute('aria-controls'));
      const { gatewayCopy, expectedModels } = window.__ANONYMOUS_MODELS_PARITY__;
      return { expanded: button.getAttribute('aria-expanded'), hidden: panel.hidden, text: panel.textContent, status: panel.querySelector('[role="status"]').textContent,
        fields: [...panel.querySelectorAll('[class*="field"] > [class*="advancedHint"]')].map(element => element.textContent), gatewayCopy, expectedModels,
        configuredDots: element.querySelectorAll('[class*="credentialDot"]').length };
    });
    assert.equal(gatewayState.expanded, 'true'); assert.equal(gatewayState.hidden, false); assert.equal(gatewayState.configuredDots, 0);
    assert.equal(gatewayState.status, gatewayState.gatewayCopy.signedOut); assert.equal(gatewayState.fields[1], gatewayState.gatewayCopy.signedOut);
    assert.equal(gatewayState.text.includes(gatewayState.gatewayCopy.unavailable), false); assert.equal(gatewayState.text.includes(gatewayState.gatewayCopy.available), false);
    for (const model of gatewayState.expectedModels) assert.ok(gatewayState.text.includes(model.label));
    await adapted.click(`${gateway} button`);
    await adapted.click('[data-anonymous-models] [class*="addButton"]');
    assert.deepEqual(await adapted.evaluate(() => window.__ANONYMOUS_MODELS_PARITY__.calls), ['local/signIn']);
    assert.equal(await adapted.$('[data-anonymous-models] [class*="addCard"]'), null);
    await adapted.click('[data-anonymous-models-sign-in]');
    assert.deepEqual(await adapted.evaluate(() => window.__ANONYMOUS_MODELS_PARITY__.calls), ['local/signIn', 'local/signIn']);
    const defensive = await adapted.evaluate(async () => {
      const { host, copy } = window.__ANONYMOUS_MODELS_PARITY__;
      return { reason: copy.signInRequired,
        save: await host.operations.writeSettings('llm-deepseek', [{ op: 'set', path: ['baseURL'], value: 'https://private.invalid' }], 0),
        credential: await host.operations.storeCredential('PRIVATE_KEY', 'not-a-real-key'), remove: await host.operations.removeCredential('PRIVATE_KEY'),
        publicDiscovery: await host.operations.discoverModels('llm-deepseek', { provider: 'deepseek-official' }),
        privateDiscovery: await host.operations.discoverModels('llm-deepseek', { provider: 'deepseek-official', apiKey: 'not-a-real-key' }),
      };
    });
    assert.deepEqual(defensive.save, { kind: 'refused', message: defensive.reason }); assert.equal(defensive.credential, defensive.reason); assert.equal(defensive.remove, defensive.reason);
    assert.equal(defensive.publicDiscovery.kind, 'found'); assert.deepEqual(defensive.privateDiscovery, { kind: 'refused', message: defensive.reason });
    await adapted.evaluate(() => { window.scrollTo(0, 0); document.activeElement instanceof HTMLElement && document.activeElement.blur(); });
    await adapted.screenshot({ path: resolve(output, `${label}-complete.png`), fullPage: true });
    report.publicCases.push({ locale, theme, width, state, stages, gatewayState, defensive, loginGate: true });
    await reference.close(); await adapted.close(); console.log(`anonymous models: ${label} passed`);
  }
  for (const locale of staleOnly ? [] : ['en', 'zh']) for (const theme of ['light', 'dark']) for (const state of ['ready', 'no-key', 'missing-key', 'empty', 'readonly', 'loading', 'error']) {
    const label = `default-${locale}-${theme}-${state}`;
    const reference = await open({ locale, theme, width: 1280, side: 'reference', mode: 'default', state });
    const adapted = await open({ locale, theme, width: 1280, side: 'adapted', mode: 'default', state });
    assert.deepEqual(await surface(adapted, '.permission-fixture'), await surface(reference, '.permission-fixture'), `${label}: unchanged default ModelsSection`);
    const pair = await stableCompare(label, () => stableScreenshot(reference, { captureBeyondViewport: false }), () => stableScreenshot(adapted, { captureBeyondViewport: false }));
    await writeFile(resolve(output, `${label}-official.png`), pair.a); await writeFile(resolve(output, `${label}-adapted.png`), pair.b);
    assert.ok(pair.equal, `${label}: exact default pinned ModelsSection pixels`);
    if (state === 'missing-key') {
      for (const current of [reference, adapted]) {
        const label = await current.evaluate(() => window.__ANONYMOUS_MODELS_PARITY__.officialCopy.cancel);
        await clickLabel(current, '.permission-fixture', label);
      }
      assert.deepEqual(await surface(adapted, '.permission-fixture'), await surface(reference, '.permission-fixture'), `${label}: default missing-key compact row`);
      assert.equal(await adapted.$$eval('[class*="credentialDotMissing"]', nodes => nodes.length), 1, 'owner default preserves confirmed missing-credential marker');
    }
    if (state === 'ready') assert.equal(await adapted.$$eval('[class*="credentialDotConfigured"]', nodes => nodes.length), 1, 'owner default preserves configured marker');
    assert.equal(await adapted.$('[data-public-provider]'), null, 'default path has no declaration marker');
    report.defaultCases.push({ locale, theme, state, directOfficialReference: true, exactPixels: true });
    await reference.close(); await adapted.close(); console.log(`anonymous models: ${label} passed`);
  }
  for (const state of ['stale-configured', 'stale-missing']) {
    const page = await open({ locale: 'en', theme: 'light', width: 1280, side: 'adapted', mode: 'public-stale', state });
    if (await page.$('input[type="password"]')) await clickLabel(page, '.permission-fixture', 'Cancel');
    const row = '[data-public-provider="deepseek-official"]';
    await page.waitForSelector(`${row} button`);
    assert.equal(await page.$$eval(`${row} [class*="credentialDot"]`, nodes => nodes.length), 0, `${state}: public mode suppresses stale credential facts`);
    await clickLabel(page, row, 'Edit');
    assert.equal(await page.$eval('input[type="password"]', input => input.disabled), true, 'public mode overrides stale writable owner state');
    const hint = await page.$eval('input[type="password"]', input => {
      const message = document.getElementById(input.getAttribute('aria-describedby'));
      const { officialCopy } = window.__ANONYMOUS_MODELS_PARITY__;
      return { text: message?.textContent, expected: officialCopy.keyFallbackUnchecked.replace('{hint}', 'DEEPSEEK_OFFICIAL_API_KEY'),
        confirmed: message?.className.includes('savedNotice') ?? false };
    });
    assert.equal(hint.text, hint.expected, `${state}: editor must not reveal stale configured/missing credential facts`);
    assert.equal(hint.confirmed, false);

    await page.click('[class*="addButton"]');
    assert.deepEqual(await page.evaluate(() => window.__ANONYMOUS_MODELS_PARITY__.calls), ['local/signIn']);
    assert.equal(await page.$('[class*="addCard"]'), null);
    report.staleCredentialCases.push({ state, credentialMarkers: 0, credentialHint: hint, writable: false, loginGate: true });
    await page.close();
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.requests, []); report.ok = true;
  console.log(JSON.stringify({ ok: true, publicCases: report.publicCases.length, defaultCases: report.defaultCases.length, staleCredentialCases: report.staleCredentialCases.length, output }));
} catch (error) { report.error = String(error?.stack ?? error); throw error; }
finally {
  try { await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2)); }
  finally {
    try { await closeAcceptanceBrowser(browser); }
    finally { await server?.httpServer.close(); }
  }
}
