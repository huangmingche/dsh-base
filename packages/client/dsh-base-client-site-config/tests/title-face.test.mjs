import assert from 'node:assert/strict';
import test from 'node:test';
import { createSiteTitleLocaleFace } from '../src/client/title-face.ts';

function observable(initial) {
  let value = initial;
  const listeners = new Set();
  return {
    getSnapshot: () => value,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    publish(next) { value = next; for (const listener of [...listeners]) listener(); },
    listenerCount: () => listeners.size,
  };
}
function fixture(initial = { config: { brand: { name: 'Default name' }, links: {} } }) {
  const localeState = observable({ revision: 1, active: 'en' });
  const bindings = new Map();
  const calls = [];
  const locale = { ...localeState, bind(namespace) {
    if (!bindings.has(namespace)) bindings.set(namespace, (key, params) => {
      calls.push({ namespace, key, params });
      return `${namespace}:${key}:${localeState.getSnapshot().active}:${params?.name ?? ''}`;
    });
    return bindings.get(namespace);
  } };
  const site = observable(initial);
  return { locale, site, calls, face: createSiteTitleLocaleFace(locale, site) };
}

test('only the common title key uses published site data; all other translation calls stay official', () => {
  const { locale, site, calls, face } = fixture();
  const common = face.bind('common');
  assert.equal(face.bind('common'), common, 'the binding keeps a stable identity');
  assert.equal(face.bind('settings'), locale.bind('settings'), 'other namespace bindings are untouched');
  assert.equal(common('brand.localBuild', { name: 'before' }), 'common:brand.localBuild:en:before', 'before public titles arrive, delegate instead of publishing the local brand default');
  site.publish({ config: { brand: { name: 'Brand' }, links: {}, documentTitles: { en: 'Saved {name} title', zh: '已保存标题' } } });
  const before = calls.length;
  assert.equal(common('brand.localBuild', { name: 'must not interpolate' }), 'Saved {name} title');
  assert.equal(calls.length, before, 'the title is literal public text, not a translation template');
  assert.equal(common('actions.save', { name: 'value' }), 'common:actions.save:en:value');
  assert.deepEqual(calls.at(-1), { namespace: 'common', key: 'actions.save', params: { name: 'value' } });
  assert.equal(face.bind('settings')('brand.localBuild'), 'settings:brand.localBuild:en:', 'a different namespace retains its official lookup and fallback');
  face.dispose();
});

test('locale and published title changes share a stable observable revision and localized fallback', () => {
  const { locale, site, face } = fixture({ config: { brand: { name: 'Saved brand' }, links: {}, documentTitles: { en: 'English title', zh: '中文标题' } } });
  const common = face.bind('common');
  let changes = 0;
  const stop = face.subscribe(() => { changes++; });
  const initial = face.getSnapshot();
  assert.equal(face.getSnapshot(), initial);
  assert.equal(common('brand.localBuild'), 'English title');
  locale.publish({ revision: 2, active: 'zh' });
  assert.equal(common('brand.localBuild'), '中文标题');
  assert.equal(face.getSnapshot().revision, initial.revision + 1);
  assert.equal(changes, 1);
  locale.publish({ revision: 3, active: 'ja' });
  assert.equal(common('brand.localBuild'), 'English title', 'an absent active-language title falls back to published English');
  site.publish({ config: { brand: { name: 'Saved brand' }, links: {}, documentTitles: {} } });
  assert.equal(common('brand.localBuild'), 'Saved brand', 'an explicitly published empty map falls back to the published name');
  assert.equal(changes, 3);
  const sameTitle = face.getSnapshot();
  site.publish({ config: { brand: { name: 'Saved brand' }, links: { docs: 'https://example.test' }, documentTitles: {} } });
  assert.equal(face.getSnapshot(), sameTitle, 'unrelated public links do not refresh all localized outlets');
  assert.equal(changes, 3);
  locale.publish({ revision: 4, active: 'ja' });
  assert.equal(changes, 4, 'dictionary changes still notify even when the title is unchanged');
  stop();
  locale.publish({ revision: 5, active: 'en' });
  assert.equal(changes, 4);
  face.dispose();
});

test('the face releases both source subscriptions and never retains disposed observers', () => {
  const { locale, site, face } = fixture();
  assert.equal(locale.listenerCount(), 1);
  assert.equal(site.listenerCount(), 1);
  let changes = 0;
  face.subscribe(() => { changes++; });
  const before = face.getSnapshot();
  face.dispose(); face.dispose();
  assert.equal(locale.listenerCount(), 0);
  assert.equal(site.listenerCount(), 0);
  face.subscribe(() => { throw new Error('disposed listener must not run'); });
  locale.publish({ revision: 2, active: 'zh' });
  site.publish({ config: { brand: { name: 'Later' }, links: {}, documentTitles: { zh: '之后' } } });
  assert.equal(face.getSnapshot(), before);
  assert.equal(changes, 0);
});
