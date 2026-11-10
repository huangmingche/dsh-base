import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dialogCopy } from '../src/client/dialog-locales.ts';
import { LOGIN_LOCALE_IDS } from '../src/client/locales.ts';
import { LOGIN_REQUEST_EVENT, requestLogin } from '../src/client/request.ts';

test('all dialog states and unavailable providers are explained in every official language', () => {
  const baseline = dialogCopy('en');
  for (const locale of LOGIN_LOCALE_IDS) {
    const words = dialogCopy(locale);
    assert.deepEqual(Object.keys(words), Object.keys(baseline));
    for (const value of Object.values(words)) assert.ok(value.trim());
    if (locale !== 'en') assert.notEqual(words.unavailable, baseline.unavailable);
    assert.ok(words.intro.includes('Dsh-base'), 'local account identity cannot imply ChatGPT authentication');
  }
  assert.equal(dialogCopy('zh-CN'), dialogCopy('zh'));
});

test('a login request only publishes UI intent and preserves the requested return path', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const target = new EventTarget();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
  try {
    const events: unknown[] = [];
    target.addEventListener(LOGIN_REQUEST_EVENT, event => events.push((event as CustomEvent).detail));
    requestLogin(); requestLogin({ mode: 'register', next: '/zh-CN/?panel=plugins' });
    assert.deepEqual(events, [{}, { mode: 'register', next: '/zh-CN/?panel=plugins' }]);
  } finally {
    if (original) Object.defineProperty(globalThis, 'window', original);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
