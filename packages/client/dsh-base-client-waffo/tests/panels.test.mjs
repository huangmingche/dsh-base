/** Render real feature slots against unchanged pinned official controls without network requests. */
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
    if (specifier === '@dsh-base/client-auth-login/request') return { url: new URL('../../dsh-base-client-auth-login/src/client/request.ts', import.meta.url).href, shortCircuit: true };
    if (specifier === '@dsh-base/client-google-analytics/consent') return { url: new URL('../../dsh-base-client-google-analytics/src/client/consent.ts', import.meta.url).href, shortCircuit: true };
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
const { Button } = await import('@deepseek-ai/dsh-client-ui-primitives');
const { apply: applyPayment } = await import('../src/client/index.ts');
const { apply: applyEmail } = await import('../../dsh-base-client-email/src/client/index.ts');
const { PaymentPanel } = await import('../src/client/PaymentPanel.tsx');
const { EmailPanel } = await import('../../dsh-base-client-email/src/client/EmailPanel.tsx');
const { createPublicPluginConfigurations } = await import('../../dsh-base-client-public-navigation/src/client/public-configurations.ts');
const { locales: paymentLocales } = await import('../src/client/locales.ts');
const { locales: emailLocales } = await import('../../dsh-base-client-email/src/client/locales.ts');
const noop = () => {};
const base = { view: 'page', ensure: () => assert.fail('SSR never fetches'), reload: noop, checkout: noop, portal: noop, signIn: noop, language: 'en' };
const catalog = { provider: 'waffo', ready: true, plans: [{ id: 'pro', name: 'Pro', productId: 'prod-1', type: 'subscription', currency: 'USD' }] };
const renderPayment = (state, lang = 'en', view = 'page') => renderToStaticMarkup(React.createElement(PaymentPanel, { ...base, view, language: lang, t: key => paymentLocales[lang][key], usePayment: select => select(state) }));
const renderEmail = (state, lang = 'en', view = 'page') => renderToStaticMarkup(React.createElement(EmailPanel, { ...base, view, t: key => emailLocales[lang][key], useEmailStatus: select => select(state) }));
test('both plugins use the exact official bundle configuration keys and register no settings sections', () => {
  const core = new SlotCore(), cleanups = [];
  cleanups.push(core.register({ name: 'root', children: { 'plugins.bundle.config': { kind: 'keyed', scope: 'root' }, 'settings.section': { kind: 'list', scope: 'root' } } }, () => null));
  const publicPluginConfigurations = createPublicPluginConfigurations();
  const ctx = { publicPluginConfigurations, effect: setup => { cleanups.push(setup()); }, locale: { register: () => noop, getSnapshot: () => ({ active: 'en' }) },
    slots: { inject: (_name, setup) => { cleanups.push(setup()); }, register: (options, component) => core.register(options, component) } };
  applyPayment(ctx); applyEmail(ctx);
  assert.deepEqual(core.entriesOfSlot('plugins.bundle.config').map(entry => entry.options.key), ['dsh-base:waffo', 'dsh-base:email']);
  assert.equal(core.entriesOfSlot('settings.section').length, 0);
  assert.ok(publicPluginConfigurations.hasBundle('dsh-base:waffo') && publicPluginConfigurations.hasBundle('dsh-base:email'));
  for (const stop of cleanups.reverse()) stop?.();
  assert.equal(core.entriesOfSlot('plugins.bundle.config').length, 0);
  assert.ok(!publicPluginConfigurations.hasBundle('dsh-base:waffo') && !publicPluginConfigurations.hasBundle('dsh-base:email'));
});
test('guest checkout renders the unchanged official primary Button and never renders private orders', () => {
  const html = renderPayment({ status: 'ready', auth: 'guest', catalog });
  const reference = renderToStaticMarkup(React.createElement(Button, { size: 'sm', variant: 'primary', disabled: false, onClick: noop }, paymentLocales.en.signIn));
  assert.ok(html.includes(reference));
  assert.doesNotMatch(html, /data-payment-order/);
  assert.match(html, /final price and terms/);
});
test('disabled configuration, failures and refunded orders are represented honestly', () => {
  const disabled = renderPayment({ status: 'ready', auth: 'guest', catalog: { ...catalog, ready: false, plans: [] } });
  assert.match(disabled, /Payments are not configured/); assert.match(disabled, /disabled=""/);
  const error = renderPayment({ status: 'error', auth: 'unknown' }); assert.match(error, /role="alert"/);
  const order = { id: 'o1', planId: 'pro', type: 'subscription', status: 'active', periodEnd: null, refunded: true, entitled: false };
  const html = renderPayment({ status: 'ready', auth: 'signed-in', catalog, account: { orders: [order], portalAvailable: true } });
  assert.match(html, /Refunded/); assert.match(html, /No current access/);
  const email = renderEmail({ status: 'ready', email: { enabled: true, ready: true, provider: 'resend' } });
  assert.match(email, /configuration is ready/); assert.match(email, /does not confirm delivery/); assert.doesNotMatch(email, /<input|<form|type="submit"/);
});
test('all eight locales supply matching keys and readable summary text', () => {
  for (const [locale, dict] of Object.entries(paymentLocales)) {
    assert.deepEqual(Object.keys(dict).sort(), Object.keys(paymentLocales.en).sort());
    assert.deepEqual(Object.keys(emailLocales[locale]).sort(), Object.keys(emailLocales.en).sort());
    assert.ok(renderPayment({ status: 'idle', auth: 'unknown' }, locale, 'summary').length > 10);
    assert.ok(renderEmail({ status: 'idle' }, locale, 'summary').length > 10);
  }
});
test('payment panel displays declared plan prices and features, and keeps missing prices unknown', () => {
  const plan = { ...catalog.plans[0], price: { amount: '19.00', interval: 'month', intervalCount: 1 }, features: [{ id: 'platform-ai', label: 'Platform AI' }] };
  const html = renderPayment({ status: 'ready', auth: 'guest', catalog: { ...catalog, plans: [plan] } });
  assert.match(html, /\$19\.00 \/ 1 month/);
  assert.match(html, /Platform AI/);
  assert.match(html, /data-plan-price="declared"/);
  const unknown = renderPayment({ status: 'ready', auth: 'guest', catalog: { ...catalog, ready: false } }, 'zh');
  assert.doesNotMatch(unknown, /\$0|USD\s*0|0\.00/);
  assert.match(unknown, /data-plan-price="unavailable"/);
  assert.match(unknown, /disabled=""/);
});
