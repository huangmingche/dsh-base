/** Acceptance inventory parsed independently from manifests/profile, never from generated projections. */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
const root = resolve(import.meta.dirname, '../../../..');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
export const READONLY_OWNED_BUNDLES = ['dsh-base:base', 'dsh-base:ai-chat-core', 'dsh-base:global', 'dsh-base:plugin-management',
  'dsh-base:waffo', 'dsh-base:email', 'dsh-base:google-auth', 'dsh-base:account-profile', 'dsh-base:user-admin',
  'dsh-base:api-keys', 'dsh-base:entitlements', 'dsh-base:files', 'dsh-base:newsletter', 'dsh-base:contact',
  'dsh-base:notifications', 'dsh-base:crisp', 'dsh-base:cache', 'dsh-base:dashboard'];
export const EDITABLE_OWNED_BUNDLES = ['@dsh-base/client-gateway-provider', '@dsh-base/cloudflare-think-fetch', '@dsh-base/cloudflare-think-memory'];
export const ALL_OWNED_BUNDLES = [...READONLY_OWNED_BUNDLES, ...EDITABLE_OWNED_BUNDLES];
/** Runtime package prefixes do not imply product authorship. The SaaS business
 * integrations are Dsh-base; R2 Files and KV Cache identify Cloudflare products
 * in both planes. Keep this independent, explicit oracle separate from metadata. */
const DSH_BASE_BUSINESS_COMPONENTS = new Set([
  '@dsh-base/cloudflare-worker-payment-waffo', '@dsh-base/cloudflare-worker-email',
  '@dsh-base/cloudflare-worker-google-auth', '@dsh-base/cloudflare-worker-account-profile',
  '@dsh-base/cloudflare-worker-user-admin', '@dsh-base/cloudflare-worker-api-keys',
  '@dsh-base/cloudflare-worker-entitlements', '@dsh-base/cloudflare-worker-newsletter',
  '@dsh-base/cloudflare-worker-contact', '@dsh-base/cloudflare-worker-notifications',
  '@dsh-base/cloudflare-worker-crisp', '@dsh-base/cloudflare-worker-operations-dashboard',
]);
const CLOUDFLARE_PRODUCT_CLIENTS = new Set(['@dsh-base/client-files', '@dsh-base/client-cache']);
const isCloudflareComponent = moduleName => moduleName === '@dsh-base/client-gateway-provider'
  || CLOUDFLARE_PRODUCT_CLIENTS.has(moduleName)
  || (!DSH_BASE_BUSINESS_COMPONENTS.has(moduleName) && /^@dsh-base\/cloudflare-(?:worker|think)-/.test(moduleName));
export const OWNED_BUNDLE_TITLES = {
  'dsh-base:waffo': { en: 'Dsh-base Waffo Pancake payments', zh: 'Dsh-base Waffo Pancake 支付' },
  'dsh-base:email': { en: 'Dsh-base Email', zh: 'Dsh-base 邮件' },
  'dsh-base:google-auth': { en: 'Dsh-base Google sign-in', zh: 'Dsh-base Google 登录' },
  'dsh-base:account-profile': { en: 'Dsh-base Account profile', zh: 'Dsh-base 账号资料' },
  'dsh-base:user-admin': { en: 'Dsh-base User management', zh: 'Dsh-base 用户管理' },
  'dsh-base:api-keys': { en: 'Dsh-base API keys', zh: 'Dsh-base API 密钥' },
  'dsh-base:entitlements': { en: 'Dsh-base Plan access', zh: 'Dsh-base 套餐权限' },
  'dsh-base:files': { en: 'Cloudflare Files', zh: 'Cloudflare 文件' },
  'dsh-base:newsletter': { en: 'Dsh-base Newsletter', zh: 'Dsh-base 邮件订阅' },
  'dsh-base:contact': { en: 'Dsh-base Contact', zh: 'Dsh-base 联系支持' },
  'dsh-base:notifications': { en: 'Dsh-base Notifications', zh: 'Dsh-base 业务通知' },
  'dsh-base:crisp': { en: 'Dsh-base Crisp support', zh: 'Dsh-base Crisp 客服' },
  'dsh-base:cache': { en: 'Cloudflare KV cache', zh: 'Cloudflare KV 缓存' },
  'dsh-base:dashboard': { en: 'Dsh-base Operations', zh: 'Dsh-base 运营概览' },
  'dsh-base:base': { en: 'Dsh-base Core features', zh: 'Dsh-base 基础功能' },
  'dsh-base:ai-chat-core': { en: 'Dsh-base AI chat', zh: 'Dsh-base AI 对话' },
  'dsh-base:global': { en: 'Dsh-base Global', zh: 'Dsh-base 全局' },
  'dsh-base:plugin-management': { en: 'Dsh-base Plugin management', zh: 'Dsh-base 插件管理' },
  '@dsh-base/client-gateway-provider': { en: 'Cloudflare AI Gateway', zh: 'Cloudflare AI Gateway' },
  '@dsh-base/cloudflare-think-fetch': { en: 'Cloudflare Web fetch', zh: 'Cloudflare 网页抓取' },
  '@dsh-base/cloudflare-think-memory': { en: 'Cloudflare Memory', zh: 'Cloudflare 记忆' },
};
export function assertComponentPrefix(title, moduleName) {
  const prefix = isCloudflareComponent(moduleName) ? 'Cloudflare' : 'Dsh-base';
  assert.ok(title?.startsWith(`${prefix} `), `${moduleName}: expected exact ${prefix} ownership prefix, got ${title}`);
  assert.doesNotMatch(title, /^(Cloudflare |Dsh-base ){2}/u, 'a title contains its ownership prefix once');
}
export function assertOwnedComponentNames(rows, expected) {
  assert.deepEqual(rows.map(row => row.id).sort(), expected.rows.map(row => row.entryId).sort(), 'every owned component has one displayed title');
  for (const row of rows) assertComponentPrefix(row.title, expected.rows.find(source => source.entryId === row.id).moduleName);
  return Object.fromEntries(rows.map(row => [row.id, row.title]).sort(([a], [b]) => a.localeCompare(b)));
}
export async function readOwnedDetailNames(page, name, locale, expected) {
  const detail = await page.$eval(`[data-plugin-detail="${name}"]`, element => ({ title: element.querySelector('h3')?.textContent.trim(), rows: [...element.querySelectorAll('[data-plugin-row]')].map(row => ({ id: row.getAttribute('data-plugin-row'), title: row.querySelector('[class*="rowId"]')?.textContent.trim() })) }));
  assert.equal(detail.title, OWNED_BUNDLE_TITLES[name][locale], 'bundle detail and main card use the same exact product name');
  assertOwnedComponentNames(detail.rows, expected);
  return detail.rows;
}
export async function assertInventoryNames(page, expectedTitles, expected) {
  const rows = await page.$$eval('[data-plugin-scope] [data-plugin-module]', elements => elements.filter(element => element.getAttribute('data-plugin-module')?.startsWith('@dsh-base/')).map(element => ({ id: element.getAttribute('data-plugin-entry'), title: element.querySelector('[class*="cardTitle"]')?.textContent.trim() })));
  const titles = assertOwnedComponentNames(rows, expected);
  assert.deepEqual(titles, expectedTitles, 'all owned names match between component details and the full Settings inventory');
  return titles;
}

export const ownershipLabel = (locale, policy = 'required') => policy === 'deployment'
  ? locale === 'zh' ? '由部署管理' : 'Managed by the deployment'
  : locale === 'zh' ? '应用所需' : 'Required by the app';

export function readOwnedPluginInventory() {
  const profile = json(join(root, 'apps/web/composition.profile.json')).client;
  const packs = readdirSync(join(root, 'packs'), { withFileTypes: true }).filter(row => row.isDirectory()).map(row => json(join(root, 'packs', row.name, 'pack.json')));
  const rows = [];
  for (const [folder, plane, key] of [['client', 'client', 'client'], ['cloudflare-worker', 'worker', 'worker'], ['cloudflare-think', 'think', 'agent']]) {
    for (const directory of readdirSync(join(root, 'packages', folder), { withFileTypes: true }).filter(row => row.isDirectory())) {
      const path = join(root, 'packages', folder, directory.name, 'package.json');
      if (!existsSync(path)) continue;
      const manifest = json(path);
      const metadata = manifest.dshBase?.[key];
      if (!metadata?.id) continue;
      const composed = plane === 'client' ? profile.find(row => row.name === manifest.name) ?? metadata : metadata;
      const memberships = packs.filter(pack => (pack.planes[plane] ?? []).some(row => (typeof row === 'string' ? row : row.name) === manifest.name));
      assert.equal(memberships.length, 1, `${manifest.name}: every real plugin must belong to exactly one pack`);
      const [pack] = memberships;
      const bundle = pack.id === 'gateway-provider' ? EDITABLE_OWNED_BUNDLES[0]
        : pack.id === 'optional-think' ? manifest.name : `dsh-base:${pack.id}`;
      rows.push({ entryId: composed.id, moduleName: manifest.name, plane, origin: composed.origin ?? 'custom', enabled: composed.disabled !== true,
        fiberPhase: plane === 'think' || composed.disabled === true ? null : 'active',
        order: composed.order ?? 100, bundle, packId: pack.id });
    }
  }
  rows.sort((a, b) => a.order - b.order || a.entryId.localeCompare(b.entryId));
  assert.equal(new Set(rows.map(row => row.entryId)).size, rows.length);
  assert.deepEqual([...new Set(rows.map(row => row.bundle))].sort(), [...ALL_OWNED_BUNDLES].sort());
  return { rows, bundles: ALL_OWNED_BUNDLES.map(name => ({ name, rows: rows.filter(row => row.bundle === name) })) };
}

export async function assertOwnedBundleCards(page) {
  const locale = await page.evaluate(() => document.documentElement.lang.startsWith('zh') ? 'zh' : 'en');
  const cards = await page.$$eval('[data-plugin-group="bundles"] [data-plugin-package]', elements => elements.map(element => {
    const toggle = element.querySelector('[role="switch"]');
    return { name: element.getAttribute('data-plugin-package'), title: element.querySelector('button[aria-describedby]')?.textContent.trim(), disabled: toggle?.matches(':disabled'), checked: toggle?.getAttribute('aria-checked') === 'true', unavailable: element.querySelector('[data-deployment-unavailable]') !== null };
  }));
  assert.deepEqual(cards.map(card => card.name).sort(), [...ALL_OWNED_BUNDLES].sort(), 'all owned function bundles are visible, independently of management permission');
  for (const card of cards) {
    assert.equal(card.title, OWNED_BUNDLE_TITLES[card.name][locale], 'all installed cards use their exact localized owner-prefixed names');
    assert.equal(card.disabled, READONLY_OWNED_BUNDLES.includes(card.name));
    assert.equal(card.unavailable, false, 'being required does not make a plugin unavailable');
  }
  return cards;
}

export async function assertReadonlyOwnedDetail(page, name, locale, expected, { policyExplanation = true, hostSection = false } = {}) {
  const detail = await page.$eval(`[data-plugin-detail="${name}"]`, element => ({
    title: element.querySelector('h3')?.textContent.trim(),
    scope: element.querySelector('[data-plugin-management-scope]')?.textContent,
    // Configuration slots may contain editable settings for an administrator;
    // this assertion covers package/component enablement, not their form fields.
    toggles: [...element.querySelectorAll('[class*="detailActions"] > [class*="bundleToggle"] [role="switch"], [data-plugin-row] [role="switch"]')].map(toggle => ({ disabled: toggle.matches(':disabled'), title: toggle.getAttribute('title') })),
    rows: [...element.querySelectorAll('[data-plugin-row]')].map(row => ({ id: row.getAttribute('data-plugin-row'), text: row.textContent, title: row.querySelector('[class*="rowId"]')?.textContent.trim(),
      toggles: [...row.querySelectorAll('[role="switch"]')].map(toggle => ({ disabled: toggle.matches(':disabled'), title: toggle.getAttribute('title') })) })),
    statuses: [...element.querySelectorAll(':scope > p[role="status"]')].map(element => ({ text: element.textContent.trim(), color: getComputedStyle(element).color })),
  }));
  assert.equal(detail.title, OWNED_BUNDLE_TITLES[name][locale]);
  assert.deepEqual(detail.rows.map(row => row.id).sort(), expected.rows.map(row => row.entryId).sort(), `${name}: all declared components remain inspectable`);
  assert.ok(detail.toggles.length > 0 && detail.toggles.every(toggle => toggle.disabled), 'required bundles and components have no editable switches');
  if (policyExplanation) {
    assert.equal(detail.toggles[0].title, ownershipLabel(locale));
    assert.ok(detail.statuses.some(status => status.text === ownershipLabel(locale)), 'normal ownership is explained in detail');
  }
  if (hostSection) {
    assert.ok(detail.scope?.includes(ownershipLabel(locale)), 'detail slot receives the validated ownership policy');
    assert.ok(detail.scope?.includes(locale === 'zh' ? '此功能由应用统一管理，不能在这里停用。' : 'Managed as part of the app. It cannot be switched off here.'), 'scope explains required app functionality rather than a client-only restart setting');
  }
  for (const row of detail.rows) {
    const source = expected.rows.find(candidate => candidate.entryId === row.id);
    assertComponentPrefix(row.title, source.moduleName);
    assert.ok(row.text.includes(source.moduleName), 'real technical identity remains in official details');
    if (policyExplanation) for (const toggle of row.toggles) assert.equal(toggle.title, ownershipLabel(locale, source.plane === 'worker' ? 'deployment' : 'required'));
  }
  return detail;
}
