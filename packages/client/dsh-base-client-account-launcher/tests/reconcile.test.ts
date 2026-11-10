import assert from 'node:assert/strict'
import { test } from 'node:test'
import { launcherAction } from '../src/client/reconcile.ts'

test('anonymous with an empty slot registers', () => {
  assert.equal(launcherAction({ signedOut: true, foreignEntry: false, registered: false }), 'register')
})

test('anonymous with an existing registration is stable', () => {
  assert.equal(launcherAction({ signedOut: true, foreignEntry: false, registered: true }), 'none')
})

test('an unknown or signed-in account never registers', () => {
  assert.equal(launcherAction({ signedOut: false, foreignEntry: false, registered: false }), 'none')
  assert.equal(launcherAction({ signedOut: false, foreignEntry: false, registered: true }), 'dispose')
})

test('a foreign single-slot occupant wins and disposes our registration', () => {
  assert.equal(launcherAction({ signedOut: true, foreignEntry: true, registered: false }), 'none')
  assert.equal(launcherAction({ signedOut: true, foreignEntry: true, registered: true }), 'dispose')
})
