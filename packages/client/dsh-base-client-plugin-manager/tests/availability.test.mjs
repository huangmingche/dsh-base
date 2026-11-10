import '../../../cloudflare-worker/dsh-base-cloudflare-worker-session-host/tests/official-runtime-hook.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire, registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { deploymentAvailabilityStatus, readDeploymentAvailability, UNAVAILABLE_LABEL } from '../src/client/availability.ts';
import { managedByBundleLabels, readManagedByBundle } from '../src/client/bundle-management.ts';
import { builtinAvailability } from '../../dsh-base-client-plugin-management/src/client/builtin-copy.ts';

const app = createRequire(new URL('../../../../apps/web/package.json', import.meta.url));
const { transformSync } = app('esbuild');
const sourceRoot = new URL('../src/', import.meta.url).href;
registerHooks({
  load(url, context, next) {
    if (url.startsWith(sourceRoot) && url.endsWith('.ts')) return { format: 'module', shortCircuit: true, source: transformSync(readFileSync(new URL(url), 'utf8'), { loader: 'ts', format: 'esm', target: 'es2022' }).code };
    return next(url, context);
  },
});
const { packageView } = await import('../src/client/manager-store.ts');

const catalog = () => ({
  name: '@deepseek-ai/dsh-experimental-voice-input-bundle', official: true,
  availability: 'missing', installed: false, enabled: false, optional: true,
  removable: false, updatable: false, listedByDefault: true, rows: [], overrides: [],
  deploymentAvailability: 'not-adapted',
});

test('the actual package projection preserves explicit Host capability absence without inventing an error', () => {
  const projected = packageView(catalog(), []);
  assert.equal(projected.deploymentAvailability, 'not-adapted');
  assert.equal(projected.error, undefined);
  assert.equal(projected.installed, false);
  assert.equal(projected.enabled, false);
  assert.deepEqual(projected.rows, []);
  assert.equal(deploymentAvailabilityStatus(projected), 'unavailable');
  for (const marker of [undefined, null, false, 'unknown', { reason: 'not-adapted' }]) {
    const value = packageView({ ...catalog(), deploymentAvailability: marker }, []);
    assert.equal(Object.hasOwn(value, 'deploymentAvailability'), false);
    assert.equal(deploymentAvailabilityStatus(value), undefined);
  }
});

test('the neutral catalog status requires explicit missing/uninstalled/off/row-free Host facts', () => {
  for (const patch of [
    { official: false }, { availability: 'installation' }, { installed: true }, { enabled: true },
    { installTarget: { spec: 'example', version: '1.0.0' } },
    { rows: [{ rowId: 'entry', moduleName: 'example' }] },
  ]) {
    const value = packageView({ ...catalog(), ...patch }, []);
    assert.equal(deploymentAvailabilityStatus(value), undefined, JSON.stringify(patch));
  }
  assert.equal(readDeploymentAvailability(null), undefined);
  assert.equal(readDeploymentAvailability([]), undefined);
});

test('real Host, metadata and failed-row diagnostics win while the explicit marker remains non-actionable', () => {
  const operationError = { code: 'operation-error', diagnostic: 'Real package load failure' };
  const error = packageView({ ...catalog(), error: operationError }, []);
  assert.equal(error.error, operationError);
  assert.equal(deploymentAvailabilityStatus(error), 'problem');
  const metadata = packageView({ ...catalog(), meta: { error: 'Invalid package metadata' } }, []);
  assert.equal(deploymentAvailabilityStatus(metadata), 'problem');
  const failed = packageView({ ...catalog(), rows: [{ rowId: 'entry', moduleName: 'example', entryId: 'entry' }] }, [
    { entryId: 'entry', moduleName: 'example', enabled: true, fiberPhase: 'failed', diagnostic: 'Original startup failure' },
  ]);
  assert.equal(failed.rows[0].diagnostic, 'Original startup failure');
  assert.equal(deploymentAvailabilityStatus(failed), 'problem');
  for (const view of [error, metadata, failed]) assert.equal(readDeploymentAvailability(view), 'not-adapted');
  // Unmarked packages continue into the unchanged official error/status path.
  const native = packageView({ ...catalog(), deploymentAvailability: undefined, error: { code: 'unsupported-platform' } }, []);
  assert.equal(deploymentAvailabilityStatus(native), undefined);
  assert.equal(native.error.code, 'unsupported-platform');
});

test('the neutral label matches the existing built-in availability capsule in all eight locales', () => {
  assert.equal(Object.keys(UNAVAILABLE_LABEL).length, 8);
  for (const [locale, label] of Object.entries(UNAVAILABLE_LABEL)) {
    assert.equal(label, builtinAvailability('shell', locale).label);
  }
});

test('grouped component explanation preserves real entry state and read-only management semantics', () => {
  const bundle = { ...catalog(), official: false, availability: 'installation', installed: true, enabled: true,
    deploymentAvailability: undefined, rows: [{ rowId: 'client:gateway-provider', moduleName: '@dsh-base/client-gateway-provider', entryId: 'client:gateway-provider' }] };
  const component = { entryId: 'client:gateway-provider', moduleName: '@dsh-base/client-gateway-provider', enabled: true,
    fiberPhase: 'active', readOnlyReason: 'unaddressable', managedByBundle: 'Cloudflare AI Gateway' };
  const view = packageView(bundle, [component]);
  assert.deepEqual(view.rows[0], {
    rowId: component.entryId, moduleName: component.moduleName, entryId: component.entryId,
    enabled: true, phase: 'active', readOnlyReason: 'unaddressable', managedByBundle: 'Cloudflare AI Gateway',
  });
  assert.equal(view.readOnlyReason, undefined, 'the bundle switch stays independently manageable');
  for (const managedByBundle of [undefined, null, '', '  ', false, 7, {}, [], ['Gateway']]) {
    const row = packageView(bundle, [{ ...component, managedByBundle }]).rows[0];
    assert.equal(Object.hasOwn(row, 'managedByBundle'), false);
    assert.equal(row.readOnlyReason, 'unaddressable');
    assert.equal(row.phase, 'active');
  }
  for (const readOnlyReason of [undefined, 'management-required', 'unknown']) {
    const row = packageView(bundle, [{ ...component, readOnlyReason }]).rows[0];
    assert.equal(Object.hasOwn(row, 'managedByBundle'), false, 'metadata cannot relabel another refusal or turn a writable row into a grouped component');
  }
  for (const value of [null, [], false, 'Gateway']) assert.equal(readManagedByBundle(value), undefined);
  assert.equal(readManagedByBundle({ ...component, managedByBundle: '  Cloudflare AI Gateway  ' }), 'Cloudflare AI Gateway');
});

test('grouped component tooltip is localized without replacing the official reason dictionaries', () => {
  const labels = managedByBundleLabels('Cloudflare AI Gateway');
  assert.deepEqual(Object.keys(labels).sort(), Object.keys(UNAVAILABLE_LABEL).sort());
  assert.equal(labels.en, 'Managed by the Cloudflare AI Gateway switch');
  assert.equal(labels.zh, '由 Cloudflare AI Gateway 开关统一管理');
  for (const label of Object.values(labels)) assert.match(label, /Cloudflare AI Gateway/u);
});

test('explicit management policy preserves visibility and true runtime state without changing permission', async () => {
  const { readManagementPolicy, managementPolicyRef, MANAGEMENT_POLICY_LABELS } = await import('../src/client/management-policy.ts');
  for (const managementPolicy of ['required', 'deployment']) {
    const bundle = { ...catalog(), official: false, availability: 'installation', installed: true, enabled: true,
      deploymentAvailability: undefined, readOnlyReason: 'unaddressable', managementPolicy,
      rows: [{ rowId: 'owned', moduleName: 'owned', entryId: 'owned' }] };
    const plugin = { entryId: 'owned', moduleName: 'owned', enabled: true, fiberPhase: 'active', readOnlyReason: 'unaddressable', managementPolicy };
    const view = packageView(bundle, [plugin]);
    assert.equal(view.managementPolicy, managementPolicy);
    assert.deepEqual(managementPolicyRef(view), { readOnlyReason: 'unaddressable', managementPolicy }, 'detail slot receives the validated Host policy');
    assert.equal(view.rows[0].managementPolicy, managementPolicy);
    assert.equal(view.rows[0].phase, 'active');
    assert.equal(view.enabled, true);
    assert.equal(view.installed, true);
    assert.equal(view.readOnlyReason, 'unaddressable');
    assert.equal(view.deploymentAvailability, undefined, 'read-only ownership is not an unavailable capability');
    assert.deepEqual(Object.keys(MANAGEMENT_POLICY_LABELS[managementPolicy]).sort(), Object.keys(UNAVAILABLE_LABEL).sort());
    for (const value of [undefined, null, '', 'unknown', false, 42, {}, []]) {
      const invalid = packageView({ ...bundle, managementPolicy: value }, [{ ...plugin, managementPolicy: value }]);
      assert.equal(invalid.managementPolicy, undefined);
      assert.deepEqual(managementPolicyRef(invalid), {});
      assert.equal(invalid.rows[0].managementPolicy, undefined);
    }
    for (const readOnlyReason of [undefined, 'management-required', 'unknown']) {
      assert.equal(readManagementPolicy({ managementPolicy, readOnlyReason }), undefined, 'ownership labels never authorize or relabel unrelated refusal states');
    }
  }
  assert.equal(MANAGEMENT_POLICY_LABELS.required.zh, '应用所需');
  assert.equal(MANAGEMENT_POLICY_LABELS.deployment.en, 'Managed by the deployment');
});
