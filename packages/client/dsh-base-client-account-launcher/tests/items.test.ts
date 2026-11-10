import assert from 'node:assert/strict'
import { test } from 'node:test'
import { launcherItemStates } from '../src/client/items.ts'
import { SUPPORTED_LOCALES, UNAVAILABLE_REASONS, assertOfficialLabels, unavailableReason } from '../src/client/locales.ts'

test('rows keep the official order and only feedback is disabled', () => {
  assert.deepEqual(launcherItemStates(), [
    { id: 'settings', disabled: false },
    { id: 'contact', disabled: true },
    { id: 'signin', disabled: false },
  ])
})

test('the feedback reason is complete for every shipped locale', () => {
  for (const locale of SUPPORTED_LOCALES) {
    const reason = unavailableReason(locale)
    assert.equal(typeof reason, 'string')
    assert.ok(reason.length > 0, locale)
    assert.notEqual(reason, UNAVAILABLE_REASONS.en + locale)
  }
  assert.equal(new Set(SUPPORTED_LOCALES.map(unavailableReason)).size, SUPPORTED_LOCALES.length)
})

test('locale ids normalize to their base language and fall back to English', () => {
  assert.equal(unavailableReason('zh-CN'), UNAVAILABLE_REASONS.zh)
  assert.equal(unavailableReason('pt_BR'), UNAVAILABLE_REASONS.pt)
  assert.equal(unavailableReason('fr-FR'), UNAVAILABLE_REASONS.fr)
  assert.equal(unavailableReason('xx'), UNAVAILABLE_REASONS.en)
})

test('a raw-key translation fails explicitly instead of shipping half copy', () => {
  const labels: Record<string, string> = { menu: 'Account menu', more: 'More', settings: 'Settings', contactUs: 'Feedback', signIn: 'Sign in' }
  assert.doesNotThrow(() => assertOfficialLabels(key => labels[key] ?? key))
  for (const missing of Object.keys(labels)) {
    assert.throws(() => assertOfficialLabels(key => key === missing ? missing : labels[key] ?? key), /not bound/u)
  }
})
