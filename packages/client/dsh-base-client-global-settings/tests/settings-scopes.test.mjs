/** Actual slot registrations and rendered official controls, with no network or app fixture. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire, registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { registerOfficialSourceHooks } from '../../../../scripts/build/official-source-hook.mjs';
registerOfficialSourceHooks();
const app = createRequire(new URL('../../../../apps/web/package.json', import.meta.url));
const { transformSync } = app('esbuild');
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@dsh-base/site-config/settings') return { url: new URL('../../../boot/dsh-base-site-config/src/settings.ts', import.meta.url).href, shortCircuit: true };
    if (specifier === 'react' || specifier.startsWith('react/') || specifier.startsWith('react-dom') || specifier === 'zod') return next(specifier, { ...context, parentURL: new URL('../../../../apps/web/package.json', import.meta.url).href });
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith('.css')) return { format: 'module', shortCircuit: true, source: 'export default new Proxy({}, { get: (_, key) => String(key) })' };
    if (url.endsWith('.tsx')) return { format: 'module', shortCircuit: true, source: transformSync(readFileSync(new URL(url), 'utf8'), { loader: 'tsx', jsx: 'automatic', format: 'esm', target: 'es2022' }).code };
    return next(url, context);
  },
});
const React = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');
const { SlotCore } = await import('@deepseek-ai/dsh-client-ui-slots');
const { Switch } = await import('@deepseek-ai/dsh-client-ui-primitives');
const { rowConfigKey } = await import('@deepseek-ai/dsh-client-ui-plugin-manager/src/client/config-ledger.ts');
const { apply } = await import('../src/client/index.ts');
const { GlobalSettings } = await import('../src/client/GlobalSettings.tsx');
const { resetPageFields } = await import('../src/client/fields.ts');
const { locales } = await import('../src/client/locales.ts');
const { resolveDeploymentSiteSettings } = await import('../../../boot/dsh-base-site-config/src/settings.ts');
const values = () => ({ ...resolveDeploymentSiteSettings({}), seo: { ...resolveDeploymentSiteSettings({}).seo,
  pages: { '/': { title: 'Home', description: 'Public home', keywords: ['home'], image: '/og.png', priority: '0.7', changefreq: 'weekly', lastmod: '2026-11-15' } } } });
function render(scope, { canEdit = true, view = 'page', locale = 'en' } = {}) {
  const current = values();
  const state = { status: 'ready', baseline: { revision: 1, source: 'saved', canEdit, values: current }, draft: current, dirty: false, saving: false, saved: false, issues: [] };
  return renderToStaticMarkup(React.createElement(GlobalSettings, { scope, view, initialLocale: locale, t: key => locales[locale][key],
    useGlobalSettings: select => select(state), ensure() { throw new Error('SSR must not fetch settings'); }, edit() {}, save() {}, reload() {}, discard() {} }));
}
const fields = html => [...html.matchAll(/data-global-field="([^"]+)"/gu)].map(match => match[1]);

test('actual apply contributes the global form and seven exact official row keys sharing one document store', () => {
  const core = new SlotCore(), cleanups = [];
  cleanups.push(core.register({ name: 'root', children: { 'plugins.bundle.config': { kind: 'keyed', scope: 'root' }, 'plugins.row.config': { kind: 'keyed', scope: 'root' } } }, () => null));
  const ctx = {
    effect: setup => { cleanups.push(setup()); },
    locale: { register: () => () => {}, getSnapshot: () => ({ active: 'zh' }) }, siteConfig: { refresh() {} },
    slots: { inject: (_name, setup) => { cleanups.push(setup()); }, register: (options, component) => core.register(options, component) },
  };
  apply(ctx);
  const bundle = core.entriesOfSlot('plugins.bundle.config');
  assert.equal(bundle.length, 1); assert.equal(bundle[0].options.key, 'dsh-base:global');
  const rows = core.entriesOfSlot('plugins.row.config');
  const ids = ['cloudflare:worker:seo', 'cloudflare:worker:sitemap', 'cloudflare:worker:robots', 'cloudflare:worker:manifest', 'cloudflare:worker:llms', 'client:google-analytics', 'cloudflare:worker:google-analytics'];
  assert.deepEqual(rows.map(row => row.options.key), ids.map(id => rowConfigKey('dsh-base:global', id)));
  const faces = [bundle[0], ...rows].map(entry => entry.inject());
  assert.deepEqual(faces.map(face => face.scope), ['global', 'seo', 'sitemap', 'robots', 'manifest', 'llms', 'googleAnalytics', 'googleAnalytics']);
  assert.ok(faces.every(face => face.hooks.globalSettings === faces[0].hooks.globalSettings));
  assert.ok(faces.every(face => face.initialLocale === 'zh'));
  for (const stop of cleanups.reverse()) stop?.();
  assert.equal(core.entriesOfSlot('plugins.row.config').length, 0);
});

test('each capability renders only its own fields; the global editor retains the complete document', () => {
  assert.deepEqual(fields(render('sitemap')), ['priority', 'changefreq', 'lastmod'].map(key => `seo.pages./.${key}`));
  assert.deepEqual(fields(render('robots')), ['seo.robots.disallow', 'seo.robots.extraLines']);
  assert.deepEqual(fields(render('manifest')), ['seo.icons.svg', 'seo.icons.icon192', 'seo.icons.icon512', 'seo.icons.maskable512', 'seo.manifest.shortName', 'seo.manifest.themeColor', 'seo.manifest.backgroundColor', 'seo.manifest.display']);
  assert.deepEqual(fields(render('llms')), ['seo.llms.enabled', 'seo.llms.introduction', 'seo.llms.guidance']);
  assert.deepEqual(fields(render('googleAnalytics')), ['analytics.google.enabled', 'analytics.google.measurementId', 'analytics.conversions.mode', 'analytics.conversions.campaigns']);
  const seo = fields(render('seo'));
  assert.ok(seo.includes('seo.locales.en.title') && seo.includes('seo.image.url') && seo.includes('seo.pages./.title'));
  assert.ok(seo.every(path => !/^(?:links\.|analytics\.|seo\.(?:llms|robots|manifest)\.)/u.test(path)));
  assert.ok(!seo.some(path => /\.(?:priority|changefreq|lastmod|icon192|icon512|maskable512)$/u.test(path)));
  const all = new Set(fields(render('global')));
  for (const scope of ['seo', 'sitemap', 'robots', 'manifest', 'llms', 'googleAnalytics']) for (const field of fields(render(scope))) assert.ok(all.has(field), field);
  assert.ok(all.has('links.docs') && all.has('links.supportEmail') && all.has('links.github'));
});

test('readers see the same official switches disabled, with honest defaults and no custom controls', () => {
  for (const [scope, key, checked] of [['llms', 'llmsEnabled', true], ['googleAnalytics', 'googleEnabled', false]]) {
    for (const canEdit of [true, false]) {
      const reference = renderToStaticMarkup(React.createElement(Switch, { label: locales.en[key], checked, disabled: !canEdit, onChange() {} }));
      const actual = render(scope, { canEdit });
      assert.ok(actual.includes(reference), `${scope} must directly render the unchanged official Switch`);
      if (!canEdit) assert.match(actual, /Only site administrators/);
    }
  }
});

test('scope summaries and labels are present in all eight official locales', () => {
  for (const [locale, dictionary] of Object.entries(locales)) {
    assert.deepEqual(Object.keys(dictionary).sort(), Object.keys(locales.en).sort());
    for (const scope of ['global', 'seo', 'sitemap', 'robots', 'manifest', 'llms', 'googleAnalytics']) {
      const summary = render(scope, { view: 'summary', locale });
      assert.ok(summary.length > 0); assert.doesNotMatch(summary, /<(?:input|button|textarea|select)\b/u);
    }
  }
});

test('resetting one page capability preserves the other capability and removes an empty override', () => {
  const page = values().seo.pages['/'];
  assert.deepEqual(resetPageFields(page, '/', 'seo'), { priority: '0.7', changefreq: 'weekly', lastmod: '2026-11-15' });
  assert.deepEqual(resetPageFields(page, '/', 'sitemap'), { title: 'Home', description: 'Public home', keywords: ['home'], image: '/og.png' });
  assert.equal(resetPageFields({ priority: '0.7' }, '/', 'sitemap'), undefined);
  assert.equal(resetPageFields(page, '/', 'global'), undefined);
  assert.equal(page.title, 'Home', 'reset does not mutate the existing draft');
});
