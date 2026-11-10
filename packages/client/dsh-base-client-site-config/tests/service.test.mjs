import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
registerHooks({ resolve(specifier, context, next) {
  if (specifier === '@dsh-base/site-config') return { url: new URL('../../../boot/dsh-base-site-config/src/index.ts', import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
} });
const { createSiteConfigService } = await import('../src/client/service.ts');
test('public snapshot refresh notifies consumers and a failed read retains the last good name', async () => {
  let reads = 0, changed = 0;
  const service = createSiteConfigService(async () => { reads++; return reads === 1 ? Response.json({ brand: { name: 'Saved brand' }, links: {}, environmentLabel: 'Staging' }) : new Response('', { status: 503 }); });
  const before = service.getSnapshot();
  assert.equal(service.getSnapshot(), before);
  service.subscribe(() => { changed++; });
  assert.equal(await service.refresh(), true);
  const published = service.getSnapshot();
  assert.equal(published.config.brand.name, 'Saved brand');
  assert.equal(changed, 1);
  assert.equal(await service.refresh(), false);
  assert.equal(service.getSnapshot(), published);
  assert.equal(changed, 1);
});
test('older public reads cannot overwrite a newer refresh after saving', async () => {
  const pending = [];
  const service = createSiteConfigService(() => new Promise(resolve => pending.push(resolve)));
  const old = service.refresh(), current = service.refresh();
  pending[1](Response.json({ brand: { name: 'New' } }));
  assert.equal(await current, true);
  pending[0](Response.json({ brand: { name: 'Old' } }));
  assert.equal(await old, false);
  assert.equal(service.getSnapshot().config.brand.name, 'New');
});
test('disposed service neither reads nor publishes', async () => {
  let reads = 0;
  const service = createSiteConfigService(async () => { reads++; return Response.json({ brand: { name: 'Unused' } }); });
  service.dispose();
  assert.equal(await service.refresh(), false);
  assert.equal(reads, 0);
});
