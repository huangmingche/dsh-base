import assert from 'node:assert/strict'
import { createSignedOutGatewayStore, GatewayStore } from '../src/client/gateway-store.ts'

let loads: Array<(value: { platformEnabled: boolean; providers?: Record<string, { available: boolean; catalog: Array<{ id: string; label: string }> }> }) => void> = []
let failures = 1
const events: Array<() => void> = []
const fakeCtx = {
  get: () => ({ load: () => {
    if (failures > 0) { failures -= 1; return Promise.reject(new Error('fixture read failure')) }
    return new Promise(resolve => { loads.push(value => resolve(value)) })
  } }),
  remote: { $on: (_name: string, callback: () => void) => { events.push(callback); return () => undefined } },
  on: (_name: string, callback: () => void) => { events.push(callback); return () => undefined },
} as never
const store = new GatewayStore(fakeCtx)
let notifications = 0
store.subscribe(() => { notifications += 1 })
store.start()
await new Promise(resolve => setTimeout(resolve, 0))
assert.equal(store.snapshot().kind, 'error', 'initial read failure is surfaced')
const retry = store.load()
loads.shift()!({ platformEnabled: true, providers: { 'cloudflare-ai-gateway': { available: true, catalog: [{ id: 'cloudflare-ai-gateway/deepseek-flash', label: 'Flash' }] } } })
await retry
assert.equal(store.snapshot().kind, 'ready', 'retry recovers')
assert.deepEqual((store.snapshot() as { value: { providers: Record<string, { available: boolean }> } }).value.providers['cloudflare-ai-gateway'].available, true)
// Real invalidation refresh.
events[0]?.()
await new Promise(resolve => setTimeout(resolve, 0))
loads.shift()!({ platformEnabled: true, providers: { 'cloudflare-ai-gateway': { available: false, catalog: [] } } })
await new Promise(resolve => setTimeout(resolve, 0))
assert.equal((store.snapshot() as { value: { providers: Record<string, { available: boolean }> } }).value.providers['cloudflare-ai-gateway'].available, false)
// Generation fencing: the newer response wins even when the older arrives later.
const oldLoad = store.load(); const oldResolve = loads.shift()!
const newLoad = store.load(); const newResolve = loads.shift()!
newResolve({ platformEnabled: true, providers: { 'cloudflare-ai-gateway': { available: true, catalog: [] } } })
await newLoad
oldResolve({ platformEnabled: false, providers: { 'cloudflare-ai-gateway': { available: false, catalog: [] } } })
await oldLoad
assert.equal(store.snapshot().kind, 'ready')
assert.equal((store.snapshot() as { value: { providers: Record<string, { available: boolean }> } }).value.providers['cloudflare-ai-gateway'].available, true, 'stale response cannot overwrite')
const beforeDispose = notifications
store.dispose()
events[0]?.()
assert.equal(notifications, beforeDispose, 'disposed store unsubscribes invalidations')
console.log('gateway provider store: error/retry, invalidation refresh, stale-response fencing and disposal passed')

// A public declaration cannot be promoted into an observed account/deployment answer.
const originalFetch = globalThis.fetch
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
let anonymousReads = 0, anonymousListeners = 0
globalThis.fetch = async () => { anonymousReads += 1; throw new Error('anonymous Gateway must not fetch') }
Object.defineProperty(globalThis, 'window', { configurable: true, value: {
  addEventListener: () => { anonymousListeners += 1; throw new Error('anonymous Gateway must not install focus listeners') },
} })
try {
  const catalog = [{ id: 'cloudflare-ai-gateway/deepseek-flash', label: 'Flash' }]
  const anonymous = createSignedOutGatewayStore(catalog)
  const first = anonymous.snapshot()
  let updates = 0
  const unsubscribe = anonymous.subscribe(() => { updates += 1 })
  anonymous.start(); anonymous.start()
  await Promise.all([anonymous.load(), anonymous.load()])
  assert.equal(anonymous.snapshot(), first, 'useSyncExternalStore receives a stable immutable snapshot')
  assert.deepEqual(first, { kind: 'signed-out', catalog: [{ id: catalog[0].id, label: 'Flash' }] })
  assert.equal('value' in first, false, 'no private platformEnabled/provider availability is fabricated')
  catalog[0].label = 'Caller changed the input'
  catalog.push({ id: 'extra', label: 'Another input' })
  assert.deepEqual(first, { kind: 'signed-out', catalog: [{ id: 'cloudflare-ai-gateway/deepseek-flash', label: 'Flash' }] }, 'caller mutations cannot alter published declarations')
  assert.ok(Object.isFrozen(first) && first.kind === 'signed-out' && Object.isFrozen(first.catalog) && Object.isFrozen(first.catalog[0]))
  unsubscribe()
  assert.equal(updates, 0, 'start/load never upgrade anonymous authority or publish observed availability')
  assert.deepEqual(createSignedOutGatewayStore().snapshot(), { kind: 'signed-out', catalog: [] }, 'catalog is optional and must be supplied explicitly')
  assert.equal(anonymousReads, 0); assert.equal(anonymousListeners, 0)
} finally {
  globalThis.fetch = originalFetch
  if (originalWindow === undefined) Reflect.deleteProperty(globalThis, 'window')
  else Object.defineProperty(globalThis, 'window', originalWindow)
}
console.log('gateway signed-out view: immutable public declarations, stable snapshot, no reads/listeners or authority upgrade passed')
