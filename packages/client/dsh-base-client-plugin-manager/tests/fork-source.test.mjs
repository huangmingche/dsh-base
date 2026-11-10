/** Whole-package drift audit: every copied upstream source/resource is checked. */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../../../..');
const fork = resolve(import.meta.dirname, '..');
const upstream = resolve(root, '.submodules/deepseek-harness/packages/client/ui-plugin-manager');
const read = (base, path) => readFileSync(resolve(base, path), 'utf8');
const lock = JSON.parse(read(root, 'dsh-source.lock.json'));
const manifest = JSON.parse(read(fork, 'package.json'));
const files = base => readdirSync(base, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(resolve(base, entry.name)) : [resolve(base, entry.name)]);
const exactOnce = (source, needle, replacement = '') => {
  assert.equal(source.split(needle).length - 1, 1, `reviewed adaptation occurs exactly once: ${needle}`);
  return source.replace(needle, replacement);
};

/** Undo only reviewed Host, contribution and navigation edits, then demand byte identity. */
function officialText(path, text) {
  if (path === 'src/client/index.ts') {
    text = exactOnce(text, "import type {} from './group-summary.ts'\n");
    text = exactOnce(text, "          'dsh-base.plugins.group.summary': { kind: 'single', scope: 'root', inline: true },\n");
    return exactOnce(text, "import { z } from 'zod'\n\n/** Local static-loader contract; upstream client behavior is preserved below. */\nexport const name = '@dsh-base/client-plugin-manager'\nexport const Config = z.object({}).default({})\n\n");
  }
  if (path === 'src/client/manager-store.ts') {
    text = exactOnce(text, "import { readDeploymentAvailability, type DeploymentAvailability } from './availability.ts'\n");
    text = exactOnce(text, "import { readManagementPolicy, type ManagementPolicy } from './management-policy.ts'\n");
    for (let i = 0; i < 2; i += 1) {
      const marker = '  /** Explicit Host ownership, independent of visibility and runtime state. */\n  readonly managementPolicy?: ManagementPolicy\n';
      assert.equal(text.includes(marker), true); text = text.replace(marker, '');
    }
    text = exactOnce(text, '      ...readManagementPolicy(live) === undefined ? {} : { managementPolicy: readManagementPolicy(live) },\n');
    text = exactOnce(text, '    ...readManagementPolicy(bundle) === undefined ? {} : { managementPolicy: readManagementPolicy(bundle) },\n');
    text = exactOnce(text, "import { readManagedByBundle } from './bundle-management.ts'\n");
    text = exactOnce(text, '  /** Explicit Host explanation for a component controlled by its bundle. */\n  readonly managedByBundle?: string\n');
    text = exactOnce(text, '      ...readManagedByBundle(live) === undefined ? {} : { managedByBundle: readManagedByBundle(live) },\n');
    text = exactOnce(text, '  /** Explicit Host capability limitation, independent of installation and errors. */\n  readonly deploymentAvailability?: DeploymentAvailability\n');
    return exactOnce(text, '    ...readDeploymentAvailability(bundle) === undefined ? {} : { deploymentAvailability: readDeploymentAvailability(bundle) },\n');
  }
  if (path === 'src/client/PluginManagerPage.tsx') {
    text = exactOnce(text, "import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'", "import { useEffect, useId, useRef, useState, type ReactNode } from 'react'");
    text = exactOnce(text, "  const bodyRef = useRef<HTMLDivElement>(null)\n");
    text = exactOnce(text, "  // The pinned page shares one scroller across views. Reset only on a logical\n  // page change, before paint; refreshes and state updates keep reading position.\n  const scrollPageKey = JSON.stringify(!onInstalled ? ['tab', tab]\n    : openPkg !== undefined ? ['package', openPkg.name, openRow?.rowId ?? null]\n      : openItem !== undefined ? ['item', openItem.id]\n        : [showsMoreList ? 'more' : 'list'])\n  useLayoutEffect(() => {\n    const body = bodyRef.current\n    if (body === null) return\n    body.scrollTop = 0\n    body.scrollLeft = 0\n    // Returning to the main list reattaches its original header measurement\n    // before layout effects run. Synchronize that header with the new offset.\n    body.dispatchEvent(new Event('scroll'))\n  }, [scrollPageKey])\n");
    text = exactOnce(text, "<div className={css.pageBody} data-plugin-body ref={bodyRef}>", "<div className={css.pageBody} data-plugin-body>");
    text = exactOnce(text, "import type { PluginGroupSummaryProps } from './group-summary.ts'\n");
    text = exactOnce(text, "    | 'dsh-base.plugins.group.summary'\n");
    text = exactOnce(text, "  // Optional contribution receives the exact card projection, without another read or counting policy here.\n  const groupSummary = (group: PluginGroupSummaryProps['group']): ReactNode => {\n    const entries = group === 'basic'\n      ? ledger.items.map(item => ({ key: item.id, components: [] }))\n      : (group === 'extensions' ? extensions : group === 'bundles' ? mine : more)\n        .map(pkg => ({ key: pkg.name, components: pkg.rows.map(row => row.rowId) }))\n    return renderSlot('dsh-base.plugins.group.summary', { group, entries, status: state.status, className: css.sectionCount as string })\n  }\n");
    text = exactOnce(text, '<h3 className={css.groupTitle}>{heading}{groupSummary(id)}</h3>', '<h3 className={css.groupTitle}>{heading}</h3>');
    text = exactOnce(text, "<h1 className={css.pageTitle}>{t('moreTitle')}{groupSummary('more')}</h1>", "<h1 className={css.pageTitle}>{t('moreTitle')}</h1>");
    text = exactOnce(text, "import { deploymentAvailabilityStatus, readDeploymentAvailability, UNAVAILABLE_LABEL } from './availability.ts'\n");
    text = exactOnce(text, "import { MANAGEMENT_POLICY_LABELS, managementPolicyRef } from './management-policy.ts'\n");
    text = exactOnce(text, '    ...managementPolicyRef(pkg),\n');
    text = exactOnce(text, '      {...row.managementPolicy === undefined ? {} : { title: resolveText(MANAGEMENT_POLICY_LABELS[row.managementPolicy]) }}\n');
    text = exactOnce(text, '        {...pkg.managementPolicy === undefined ? {} : { title: resolveText(MANAGEMENT_POLICY_LABELS[pkg.managementPolicy]) }}\n');
    text = exactOnce(text, 'function EnableSwitch({ pkg, title, t, resolveText, busy, onSetEnabled }: {\n  readonly pkg: PackageView\n  readonly title: string\n  readonly t: Translate\n  readonly resolveText: ResolveText\n', 'function EnableSwitch({ pkg, title, t, busy, onSetEnabled }: {\n  readonly pkg: PackageView\n  readonly title: string\n  readonly t: Translate\n');
    assert.equal(text.split('<EnableSwitch pkg={pkg} title={title} t={t} resolveText={resolveText} busy=').length - 1, 2);
    text = text.replaceAll('<EnableSwitch pkg={pkg} title={title} t={t} resolveText={resolveText} busy=', '<EnableSwitch pkg={pkg} title={title} t={t} busy=');
    text = exactOnce(text, '{pkg.readOnlyReason === undefined ? null : <p className={pkg.managementPolicy === undefined ? css.reason : css.status} role="status">{pkg.managementPolicy === undefined ? managementText({ code: pkg.readOnlyReason }, t) : resolveText(MANAGEMENT_POLICY_LABELS[pkg.managementPolicy])}</p>}', '{pkg.readOnlyReason === undefined ? null : <p className={css.reason} role="status">{managementText({ code: pkg.readOnlyReason }, t)}</p>}');
    text = exactOnce(text, "import { managedByBundleLabels } from './bundle-management.ts'\n");
    text = exactOnce(text, 'function RowSwitch({ row, title, t, resolveText, busy, onChange }: {\n  readonly row: PackageRow\n  readonly title: string\n  readonly t: Translate\n  readonly resolveText: ResolveText\n', 'function RowSwitch({ row, title, t, busy, onChange }: {\n  readonly row: PackageRow\n  readonly title: string\n  readonly t: Translate\n');
    text = exactOnce(text, '      {...row.managedByBundle === undefined ? {} : { title: resolveText(managedByBundleLabels(row.managedByBundle)) }}\n');
    text = exactOnce(text, 'row={row} title={title} t={t} resolveText={resolveText} busy={toggle.busy(row)}', 'row={row} title={title} t={t} busy={toggle.busy(row)}');
    text = exactOnce(text, 'busy || readDeploymentAvailability(pkg) !== undefined || pkg.readOnlyReason', 'busy || pkg.readOnlyReason');
    text = exactOnce(text, "function packageStatus(pkg: PackageView): 'running' | 'disabled' | 'problem' | 'unavailable' {\n  const capabilityStatus = deploymentAvailabilityStatus(pkg)\n  if (capabilityStatus !== undefined) return capabilityStatus\n", "function packageStatus(pkg: PackageView): 'running' | 'disabled' | 'problem' {\n");
    for (const indent of [12, 10]) text = exactOnce(text, `${' '.repeat(indent)}{status === 'unavailable' ? <span data-deployment-unavailable><Tag tone="neutral">{resolveText(UNAVAILABLE_LABEL)}</Tag></span> : null}\n`);
    return exactOnce(text, "pkg.availability === 'missing' && status !== 'unavailable' ? <Tag", "pkg.availability === 'missing' ? <Tag");
  }
  return text;
}

test('complete pinned source, locale resources and license match apart from the reviewed adaptations', () => {
  assert.equal(manifest.dshBase.forkOf.commit, lock.commit);
  assert.equal(manifest.dshBase.forkOf.package, '@deepseek-ai/dsh-client-ui-plugin-manager');
  assert.equal(manifest.dshBase.client.replaces, manifest.dshBase.forkOf.package);
  assert.equal(manifest.dshBase.client.origin, 'fork');
  for (const folder of ['src', 'locale']) {
    for (const filename of files(resolve(upstream, folder))) {
      const path = relative(upstream, filename);
      assert.equal(officialText(path, read(fork, path)), read(upstream, path), path);
    }
  }
  assert.equal(read(fork, 'LICENSE'), read(resolve(root, '.submodules/deepseek-harness'), 'LICENSE'));
  assert.equal(manifest.exports['.'], './src/client/index.ts');
  assert.equal(manifest.exports['./client'], './src/client/index.ts');
  assert.equal(manifest.exports['./group-summary'], './src/client/group-summary.ts');
});
