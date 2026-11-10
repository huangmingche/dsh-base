/** Independent product contract over the unchanged official bundle/row DOM. */
import assert from 'node:assert/strict';
import { assertOwnedBundleCards } from './owned-plugin-inventory-oracle.mjs';

export const GATEWAY_BUNDLE = '@dsh-base/client-gateway-provider';
export const GATEWAY_COMPONENTS = [
  { id: 'client:gateway-provider', module: GATEWAY_BUNDLE, en: 'Cloudflare Model settings', zh: 'Cloudflare 模型设置' },
  { id: 'cloudflare:think:ai-gateway', module: '@dsh-base/cloudflare-think-ai-gateway', en: 'Cloudflare Platform model service', zh: 'Cloudflare 平台模型服务' },
];

export async function assertGatewayBundleCard(page) {
  await assertOwnedBundleCards(page);
  const cards = await page.$$eval('[data-plugin-package^="@dsh-base/"]', elements => elements.map(element => ({
    name: element.getAttribute('data-plugin-package'),
    title: element.querySelector('button[aria-describedby]')?.textContent.trim(),
    switches: element.querySelectorAll('[role="switch"]').length,
  })));
  assert.equal(cards.length, 3, 'three editable capabilities, with Gateway grouped once');
  assert.equal(cards.filter(card => card.title === 'Cloudflare AI Gateway').length, 1);
  assert.equal(cards.some(card => card.name === GATEWAY_COMPONENTS[1].module), false, 'the execution component has no duplicate management card');
  assert.deepEqual(cards.find(card => card.name === GATEWAY_BUNDLE), { name: GATEWAY_BUNDLE, title: 'Cloudflare AI Gateway', switches: 1 });
  return cards;
}

export async function assertGatewayBundleDetail(page, locale, enabled = true, { managedExplanation = true } = {}) {
  const detail = await page.$eval(`[data-plugin-detail="${GATEWAY_BUNDLE}"]`, element => ({
    title: element.querySelector('h3')?.textContent.trim(),
    switches: [...element.querySelectorAll('[role="switch"]')].map(toggle => ({ disabled: toggle.matches(':disabled'), checked: toggle.getAttribute('aria-checked') === 'true' })),
    rows: [...element.querySelectorAll('[data-plugin-row]')].map(row => ({
      id: row.getAttribute('data-plugin-row'), title: row.querySelector('[class*="rowId"]')?.textContent.trim(), text: row.textContent,
      switches: [...row.querySelectorAll('[role="switch"]')].map(toggle => ({ disabled: toggle.matches(':disabled'), checked: toggle.getAttribute('aria-checked') === 'true', title: toggle.getAttribute('title') })),
    })),
  }));
  assert.equal(detail.title, 'Cloudflare AI Gateway');
  assert.deepEqual(detail.rows.map(row => row.id), GATEWAY_COMPONENTS.map(row => row.id), 'the original detail displays both real composition entries');
  assert.equal(detail.switches.filter(toggle => !toggle.disabled).length, 1, 'the bundle is the sole editable switch');
  assert.equal(detail.switches[0].checked, enabled);
  for (const [index, row] of detail.rows.entries()) {
    const expected = GATEWAY_COMPONENTS[index];
    assert.equal(row.title, expected[locale]);
    assert.ok(row.text.includes(expected.module), 'technical module identity stays inspectable');
    assert.deepEqual(row.switches.map(({ title, ...state }) => state), enabled ? [{ disabled: true, checked: true }] : [], 'official component switches are readonly, and hidden by the official page while the bundle is off');
    if (enabled && managedExplanation) assert.equal(row.switches[0].title, locale === 'zh' ? '由 Cloudflare AI Gateway 开关统一管理' : 'Managed by the Cloudflare AI Gateway switch', 'the disabled control explains its bundle owner rather than claiming it is required core');
  }
  return detail;
}

/** The real shell supplies this documented Host section through the official slot. */
export async function assertGatewayManagementScope(page, locale) {
  const expected = locale === 'zh' ? {
    title: '账号默认设置',
    body: '管理本账号的平台模型及其设置。会话中的单独设置优先；关闭不会中断正在执行的请求，也不影响自带 API Key。',
  } : {
    title: 'Account defaults',
    body: 'Controls platform models and their settings for this account. Session settings take precedence. Turning it off does not stop requests already running or affect your own API key.',
  };
  const text = await page.$eval(`[data-plugin-detail="${GATEWAY_BUNDLE}"] [data-plugin-management-scope]`, element => element.textContent);
  assert.ok(text.includes(expected.title), 'the Gateway scope names the unified account capability');
  assert.ok(text.includes(expected.body), 'the scope explains both components, Session exceptions, in-flight limits and independent BYOK');
  assert.doesNotMatch(text, /next page start|下次页面启动|Account-scoped client feature|账号级客户端功能/u, 'a unified Gateway is not described as a client-only restart setting');
  return expected;
}
