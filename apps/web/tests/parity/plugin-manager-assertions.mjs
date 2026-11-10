/** Shared DOM assertions used by the isolated reference and real Worker shell. */
import assert from 'node:assert/strict';
import { registerOfficialSourceHooks } from '../../../../scripts/build/official-source-hook.mjs';
registerOfficialSourceHooks();
const { en, zh } = await import('@deepseek-ai/dsh-client-ui-plugin-manager/src/client/locales.ts');

export const managerCopy = locale => locale === 'zh' ? zh : en;
export const unavailableLabel = locale => locale === 'zh' ? '不可用' : 'Unavailable';
export async function pluginCards(page) {
  return page.$$eval('[data-plugin-package]', elements => elements.map(element => {
    const toggle = element.querySelector('[role="switch"],input[type="checkbox"]');
    return {
      name: element.getAttribute('data-plugin-package'), text: element.innerText,
      group: element.closest('[data-plugin-group]')?.getAttribute('data-plugin-group'),
      status: element.getAttribute('data-plugin-status'),
      disabled: toggle?.matches(':disabled') ?? false,
      checked: toggle?.getAttribute('aria-checked') === 'true' || toggle?.checked === true,
      icon: element.querySelector('img')?.getAttribute('src'),
      tags: [...element.querySelectorAll('[data-tone]')].map(tag => ({ text: tag.textContent.trim(), tone: tag.getAttribute('data-tone') })),
      unavailableCount: element.querySelectorAll('[data-deployment-unavailable]').length,
      statusMessages: [...element.querySelectorAll('[role="status"]')].map(node => node.textContent.trim()).filter(Boolean),
    };
  }));
}
export async function assertOfficialCards(page, names, locale, oracle, { legacy = false } = {}) {
  const cards = await pluginCards(page);
  assert.deepEqual(cards.filter(card => card.name.startsWith('@deepseek-ai/')).map(card => card.name), names, `${locale}: official visible catalog and ordering`);
  for (const name of names) {
    const card = cards.find(card => card.name === name);
    const expected = oracle.bundles.find(bundle => bundle.name === name);
    assert.equal(card.disabled, true, `${name}: unavailable switch remains visibly disabled`);
    assert.equal(card.checked, false, `${name}: unavailable capability is never presented as running`);
    assert.equal(card.status, legacy ? 'problem' : 'unavailable');
    assert.ok(card.text.includes(expected.meta.title[locale]), `${name}: original localized title`);
    assert.ok(card.text.includes(expected.meta.description[locale]), `${name}: original localized description`);
    if (legacy) {
      assert.ok(card.text.includes(managerCopy(locale).reasonUnsupportedPlatform), `${name}: actual pinned legacy platform-error presentation`);
    } else {
      assert.equal(card.unavailableCount, 1, `${name}: one explicit availability badge`);
      assert.ok(card.tags.some(tag => tag.text === unavailableLabel(locale) && tag.tone === 'neutral'), `${name}: the same neutral capsule as built-in unavailable settings`);
      assert.ok(card.tags.every(tag => tag.tone !== 'danger'), `${name}: expected deployment limit is not red failure`);
      assert.ok(!card.tags.some(tag => [managerCopy(locale).statusProblem, managerCopy(locale).statusNotInstalled].includes(tag.text)), `${name}: no error or installation clutter in the list`);
      assert.deepEqual(card.statusMessages, [], `${name}: list does not repeat platform-error paragraphs`);
      assert.ok(!card.text.includes(managerCopy(locale).reasonUnsupportedPlatform), `${name}: no misleading host-OS explanation`);
    }
    assert.equal(card.icon, expected.meta.icon, `${name}: original artwork`);
  }
  if (!legacy) {
    const palette = await page.evaluate(() => {
      const reference = document.querySelector('[data-builtin-unavailable] [data-tone="neutral"], [data-neutral-tag-reference] [data-tone="neutral"]');
      const actual = document.querySelector('[data-deployment-unavailable] [data-tone="neutral"]');
      const styleOf = element => {
        const style = getComputedStyle(element);
        return Object.fromEntries(['fontSize', 'lineHeight', 'fontWeight', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderRadius', 'backgroundColor', 'color'].map(name => [name, style[name]]));
      };
      return reference && actual ? { reference: styleOf(reference), actual: styleOf(actual) } : null;
    });
    if (palette !== null) assert.deepEqual(palette.actual, palette.reference, 'unavailable capsule uses the same official neutral Tag geometry and palette as the built-ins');
  }
  return cards;
}
export async function openMorePlugins(page) {
  await page.$eval('[data-plugin-group="extensions"] > div button', button => button.click());
  await page.waitForSelector('[data-plugin-group="more"]');
}
export async function openPluginDetail(page, name) {
  await page.$eval(`[data-plugin-package="${name}"] button:not([role="switch"])`, button => button.click());
  await page.waitForSelector(`[data-plugin-detail="${name}"]`);
}
export async function assertUnavailablePluginDetail(page, name, locale, oracle, { legacy = false, requireReason = true } = {}) {
  const detail = await page.$eval(`[data-plugin-detail="${name}"]`, element => ({
    text: element.innerText,
    switches: [...element.querySelectorAll('[role="switch"],input[type="checkbox"]')].map(toggle => ({ disabled: toggle.matches(':disabled'), checked: toggle.getAttribute('aria-checked') === 'true' || toggle.checked === true })),
    rows: element.querySelectorAll('[data-plugin-row]').length,
    tags: [...element.querySelectorAll('[data-tone]')].map(tag => ({ text: tag.textContent.trim(), tone: tag.getAttribute('data-tone') })),
    unavailableCount: element.querySelectorAll('[data-deployment-unavailable]').length,
    deploymentReason: element.querySelector('[data-plugin-management-scope]')?.textContent ?? '',
  }));
  const expected = oracle.bundles.find(bundle => bundle.name === name);
  assert.ok(detail.text.includes(name), 'detail preserves the actual official package identity');
  assert.ok(detail.text.includes(expected.meta.title[locale]));
  assert.ok(detail.tags.some(tag => tag.text === managerCopy(locale).statusNotInstalled), 'detail keeps the truthful installation fact');
  if (legacy) {
    assert.ok(detail.text.includes(managerCopy(locale).reasonUnsupportedPlatform));
  } else {
    assert.equal(detail.unavailableCount, 1);
    assert.ok(detail.tags.some(tag => tag.text === unavailableLabel(locale) && tag.tone === 'neutral'));
    assert.ok(detail.tags.every(tag => tag.tone !== 'danger'));
    assert.ok(!detail.text.includes(managerCopy(locale).reasonUnsupportedPlatform), 'detail does not blame the host operating system');
    if (requireReason) {
      assert.equal(detail.deploymentReason, locale === 'zh'
        ? '当前部署不可用此插件尚未适配当前部署，暂时无法安装或启用。'
        : 'Unavailable in this deploymentThis plugin has not been adapted to this deployment and cannot be installed or enabled here.',
      'detail gives the exact localized deployment limitation; installation facts and disabled state are asserted separately');
    }
  }
  assert.ok(detail.switches.length > 0);
  assert.ok(detail.switches.every(toggle => toggle.disabled && !toggle.checked));
  assert.equal(detail.rows, 0, 'catalog-only metadata cannot fabricate runtime rows');
  return detail;
}
export async function backFromPluginDetail(page, locale) {
  const label = managerCopy(locale).backToPackage.replace('{name}', managerCopy(locale).moreTitle);
  await page.$eval(`[data-plugin-detail] button[aria-label=${JSON.stringify(label)}]`, button => button.click());
  await page.waitForSelector('[data-plugin-group="more"]');
}
