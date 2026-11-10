import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SUPPORTED_LOCALES } from '../src/client/locales.ts'
import { ACCOUNT_SIGN_IN_COPY, MODELS_COPY, accountSignInCopy, modelsCopy } from '../src/client/locales.ts'

test('appended local-account copy is complete and distinguishes Platform availability in every locale', () => {
  for (const locale of SUPPORTED_LOCALES) {
    const copy = accountSignInCopy(locale)
    assert.deepEqual(Object.keys(copy).sort(), ['description', 'platformUnavailable', 'signIn', 'title'])
    for (const [key, value] of Object.entries(copy)) assert.ok(value.trim().length > 0, `${locale}: ${key}`)
    assert.match(copy.title, /Dsh-base/u, `${locale}: local account identity remains explicit`)
    assert.match(copy.platformUnavailable, /DeepSeek (?:Platform|平台)/u, `${locale}: unavailable integration is named separately`)
    assert.notEqual(copy.description, copy.platformUnavailable)
  }
  assert.equal(new Set(SUPPORTED_LOCALES.map(locale => accountSignInCopy(locale).description)).size, SUPPORTED_LOCALES.length)
  assert.equal(new Set(SUPPORTED_LOCALES.map(locale => accountSignInCopy(locale).platformUnavailable)).size, SUPPORTED_LOCALES.length)
})

test('anonymous Models copy requests access without claiming provider configuration in all eight locales', () => {
  assert.equal(SUPPORTED_LOCALES.length, 8)
  assert.deepEqual(Object.keys(MODELS_COPY).sort(), [...SUPPORTED_LOCALES].sort())
  for (const locale of SUPPORTED_LOCALES) {
    const copy = modelsCopy(locale)
    assert.deepEqual(Object.keys(copy).sort(), ['signIn', 'signInRequired'], `${locale}: only access copy is supplied`)
    for (const [key, value] of Object.entries(copy)) assert.ok(value.trim().length > 0, `${locale}: ${key}`)
    assert.equal(copy.signIn, accountSignInCopy(locale).signIn, `${locale}: the shared local sign-in action`)
    assert.doesNotMatch(copy.signInRequired, /not configured|未配置|没有配置|已停用|disabled|missing key/iu,
      `${locale}: anonymous state is not a credential or deployment configuration verdict`)
  }
  assert.equal(new Set(SUPPORTED_LOCALES.map(locale => modelsCopy(locale).signInRequired)).size,
    SUPPORTED_LOCALES.length, 'every locale has its own access explanation')
})

test('regional ids fall back to their base language and unknown ids to English', () => {
  assert.equal(modelsCopy('zh-CN'), MODELS_COPY.zh)
  assert.equal(modelsCopy('pt_BR'), MODELS_COPY.pt)
  assert.equal(modelsCopy('xx'), MODELS_COPY.en)
  assert.equal(accountSignInCopy('ja-JP'), ACCOUNT_SIGN_IN_COPY.ja)
  assert.equal(accountSignInCopy('xx'), ACCOUNT_SIGN_IN_COPY.en)
})
