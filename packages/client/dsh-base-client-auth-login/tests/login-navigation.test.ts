import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loginNavigation } from '../src/client/login-navigation.ts';
import { LOCALE_IDS, hreflangFor, localizePath } from '../../../boot/dsh-base-locale-path/src/index.ts';

test('private deep links dismiss to their public language home, never back into a login loop', () => {
  for (const locale of LOCALE_IDS) {
    const url = new URL('/login', 'https://app.example');
    url.searchParams.set('next', localizePath('/app/session/private?step=one', locale));
    assert.deepEqual(loginNavigation(url, 'en'), { locale, language: hreflangFor(locale), home: localizePath('/', locale) });
  }
});
test('external next cannot select a foreign return origin or override the document language', () => {
  const url = new URL('/login', 'https://app.example');
  url.searchParams.set('next', `https://outside.example${localizePath('/app/session/private', 'zh')}`);
  assert.deepEqual(loginNavigation(url, 'fr'), { locale: 'fr', language: 'fr', home: localizePath('/', 'fr') });
  url.searchParams.set('locale', 'ja');
  assert.equal(loginNavigation(url, 'en').locale, 'ja');
});
