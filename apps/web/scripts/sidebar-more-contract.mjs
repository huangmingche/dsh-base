/** Independent pinned official copy plus rendered assertions for sidebar More. */
import assert from "node:assert/strict";
import { registerOfficialSourceHooks } from "../../../scripts/build/official-source-hook.mjs";
registerOfficialSourceHooks();
const menuCopy = await import("@deepseek-ai/dsh-client-ui-entry-customization/src/client/locales.ts");
const sidebarCopy = await import("@deepseek-ai/dsh-client-ui-sidebar/src/client/locales.ts");

export const RETIRED_MORE_PLUGINS = ["@dsh-base/client-shell-extras"];

/** Checks the real menu and follows only Browse; Creator execution is not asserted. */
export async function assertOfficialSidebarMore(page, locale, { screenshot } = {}) {
  const labels = menuCopy[locale];
  const triggerLabel = sidebarCopy[locale]?.["panels.more"];
  assert.ok(labels && triggerLabel, `${locale}: pinned official dictionaries exist`);
  const trigger = `button[aria-haspopup="menu"][aria-label=${JSON.stringify(triggerLabel)}]`;
  await page.waitForSelector(trigger, { visible: true, timeout: 30000 });
  await page.click(trigger);
  // Plugin navigation follows the authenticated official Host baseline. Await
  // its real presence, without treating transient absence as the final menu.
  await page.waitForFunction(label => [...document.querySelectorAll('[role="menuitem"]')].some(row => row.textContent.trim() === label), { timeout: 30000 }, labels.install);
  const rows = await page.$$eval('[role="menuitem"]', elements => elements.map(element => ({
    text: element.textContent.trim(),
    disabled: element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true',
  })));
  assert.deepEqual(rows.map(row => row.text), [labels.install, labels.create], `${locale}: sidebar More contains only the two pinned official entries in order`);
  assert.equal(rows[0].disabled, false, `${locale}: real plugin navigation is usable`);
  if (screenshot) await page.screenshot({ path: screenshot, captureBeyondViewport: false });
  await page.evaluate(label => [...document.querySelectorAll('[role="menuitem"]')].find(row => row.textContent.trim() === label).click(), labels.install);
  await page.waitForFunction(() => document.querySelector('[data-plugin-group="extensions"]') !== null && document.querySelector('[role="menu"]') === null, { timeout: 30000 });
  assert.equal(await page.$('[role="dialog"]'), null, `${locale}: official Browse opens the main plugin list rather than an install dialog`);
  const retired = await page.evaluate(names => names.map(name => {
    const row = window.__DSH_BASE_PLUGINS__?.find(entry => entry.moduleName === name);
    return row && { moduleName: row.moduleName, enabled: row.enabled, fiberPhase: row.fiberPhase, origin: row.origin };
  }), RETIRED_MORE_PLUGINS);
  for (let index = 0; index < RETIRED_MORE_PLUGINS.length; index++) {
    assert.deepEqual(retired[index], { moduleName: RETIRED_MORE_PLUGINS[index], enabled: false, fiberPhase: null, origin: "custom" }, `${locale}: retired custom contribution remains inert inventory`);
  }
  const siteConfig = await page.evaluate(() => {
    const row = window.__DSH_BASE_PLUGINS__?.find(entry => entry.moduleName === '@dsh-base/client-site-config');
    return row && { moduleName: row.moduleName, enabled: row.enabled, fiberPhase: row.fiberPhase, origin: row.origin };
  });
  assert.deepEqual(siteConfig, { moduleName: '@dsh-base/client-site-config', enabled: true, fiberPhase: 'active', origin: 'custom' }, `${locale}: public site facts support branding without restoring custom More entries`);
  return { locale, rows, browseOpenedMainList: true, creatorInvoked: false, retired, siteConfig };
}
