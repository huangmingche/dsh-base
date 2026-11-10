/** Unit tests: the anonymous-panel extension must not change official nav rows. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { sectionNavState } from '../src/client/panel-rows.ts'

test('official rows carry no disabled state', () => {
  assert.deepEqual(sectionNavState({ id: 'general', order: 0, label: 'General' }), { disabled: false, disabledReason: undefined })
})

test('a row opts in with disabled and keeps its localized reason', () => {
  assert.deepEqual(
    sectionNavState({ id: 'models', order: 10, label: 'Models', disabled: true, disabledReason: 'Available after sign-in.' }),
    { disabled: true, disabledReason: 'Available after sign-in.' },
  )
})

test('disabled without a reason still disables and exposes no copy', () => {
  assert.deepEqual(sectionNavState({ id: 'plugins', order: 15, label: 'Plugins', disabled: true }), { disabled: true, disabledReason: undefined })
})

test('explicit false is identical to an absent field', () => {
  assert.deepEqual(
    sectionNavState({ id: 'general', order: 0, label: 'General', disabled: false }),
    sectionNavState({ id: 'general', order: 0, label: 'General' }),
  )
})

test('a reason on an enabled row is ignored', () => {
  assert.deepEqual(
    sectionNavState({ id: 'general', order: 0, label: 'General', disabledReason: 'stale copy' }),
    { disabled: false, disabledReason: undefined },
  )
})
