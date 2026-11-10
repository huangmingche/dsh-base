import assert from 'node:assert/strict';
import test from 'node:test';
import { PaymentStore, paymentDestination, readCatalog, readAccount } from '../src/client/payment-store.ts';
const plan = { id: 'pro', productId: 'product-pro', type: 'subscription', currency: 'USD' };
const catalog = { provider: 'waffo', ready: true, plans: [plan] };
const account = { orders: [{ id: 'order-1', planId: 'pro', type: 'subscription', status: 'active', periodEnd: '2026-12-01T00:00:00Z', refunded: false, entitled: true }], portalAvailable: true };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
test('catalog and account accept only bounded typed server facts', () => {
  assert.deepEqual(readCatalog(catalog), catalog);
  for (const value of [{ ...catalog, ready: 'yes' }, { ...catalog, plans: [plan, plan] }, { ...catalog, plans: [{ ...plan, currency: 'arbitrary' }] }]) assert.equal(readCatalog(value), undefined);
  assert.deepEqual(readCatalog({...catalog,ready:false}),{...catalog,ready:false},'declared public prices may render while checkout is unavailable');
  assert.deepEqual(readAccount(account), account);
  assert.equal(readAccount({ ...account, orders: [{ ...account.orders[0], entitled: 'yes' }] }), undefined);
  assert.equal(readAccount({ ...account, orders: [{ ...account.orders[0], periodEnd: 'not-a-date' }] }), undefined);
});
test('only secure URLs on the reviewed provider host navigate, preserving its signed fragment', () => {
  const url = 'https://pancake.waffo.ai/store/example/checkout/id#token=fixture';
  assert.equal(paymentDestination({ url }), url);
  for (const url of ['javascript:alert(1)', '//pancake.waffo.ai/a', 'http://pancake.waffo.ai/a', 'https://pancake.waffo.ai.evil.test/a', 'https://user@pancake.waffo.ai/a', 'https://pancake.waffo.ai:444/a', 'https://example.com/a']) assert.equal(paymentDestination({ url }), undefined, url);
});
test('anonymous and disabled billing never read private orders or create a payment', async () => {
  for (const ready of [true, false]) {
    const calls: string[] = []; let signIns = 0;
    const store = new PaymentStore(async input => { const path = String(input); calls.push(path); return json(path.endsWith('get-session') ? null : ready ? catalog : { ...catalog, ready: false, plans: [] }); }, () => { signIns++; }, () => assert.fail('must not navigate'), () => 'zh');
    await store.reload(); await store.checkout('pro'); await store.portal();
    assert.deepEqual(calls.sort(), ['/api/auth/get-session', '/api/payments']);
    assert.equal(signIns, ready ? 2 : 0);
  }
  const calls: string[] = [];
  const store = new PaymentStore(async input => { calls.push(String(input)); return json(String(input).endsWith('get-session') ? { user: { id: 'user-1' } } : { ...catalog, ready: false, plans: [] }); }, () => {}, () => {}, () => 'en');
  await store.reload(); assert.equal(calls.includes('/api/payments/account'), false);
});
test('authenticated checkout retries preserve idempotency and never report access from a redirect', async () => {
  const requests: RequestInit[] = []; let navigated = ''; let attempt = 0;
  const store = new PaymentStore(async (input, init) => {
    const path = String(input);
    if (path.endsWith('get-session')) return json({ user: { id: 'user-1' } });
    if (path.endsWith('/account')) return json(account);
    if (path.endsWith('/checkout')) { requests.push(init!); if (++attempt === 1) throw new Error('connection lost'); return json({ id: 'checkout-1', url: 'https://pancake.waffo.ai/store/a/checkout/b#token=test' }); }
    return json(catalog);
  }, () => assert.fail('already authenticated'), url => { navigated = url; }, () => 'zh');
  await store.reload(); await store.checkout('missing'); assert.equal(requests.length, 0);
  await store.checkout('pro'); assert.equal(store.getSnapshot().actionFailed, true);
  await store.checkout('pro'); assert.ok(navigated.startsWith('https://pancake.waffo.ai/'));
  assert.equal(new Headers(requests[0]!.headers).get('Idempotency-Key'), new Headers(requests[1]!.headers).get('Idempotency-Key'));
  assert.deepEqual(JSON.parse(String(requests[1]!.body)), { planId: 'pro', returnPath: '/?payment=return', locale: 'zh' });
  assert.deepEqual(store.getSnapshot().account, account);
});
test('expired sessions erase private billing before requesting sign-in', async () => {
  let signIns = 0;
  const store = new PaymentStore(async input => String(input).endsWith('get-session') ? json({ user: { id: 'user-1' } }) : String(input).endsWith('/account') ? json(account) : String(input).endsWith('/portal') ? json({ error: 'unauthorized' }, 401) : json(catalog), () => { signIns++; }, () => assert.fail('must not navigate'), () => 'en');
  await store.reload(); assert.equal(store.getSnapshot().account?.orders.length, 1);
  await store.portal(); assert.equal(store.getSnapshot().auth, 'guest'); assert.equal(store.getSnapshot().account, undefined); assert.equal(signIns, 1);
});
test('disposed requests cannot publish or navigate', async () => {
  let release: ((value: Response) => void) | undefined;
  const store = new PaymentStore(async input => String(input).endsWith('get-session') ? json({ user: { id: 'user-1' } }) : String(input).endsWith('/account') ? json(account) : String(input).endsWith('/portal') ? new Promise(resolve => { release = resolve; }) : json(catalog), () => {}, () => assert.fail('disposed navigation'), () => 'en');
  await store.reload(); const request = store.portal(); store.dispose(); release!(json({ url: 'https://pancake.waffo.ai/portal#token=test' })); await request;
});
