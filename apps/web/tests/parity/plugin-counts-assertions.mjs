/** Category counts describe rendered entries; they never describe enabled fibers. */
import assert from 'node:assert/strict';
import { readOwnedPluginInventory } from './owned-plugin-inventory-oracle.mjs';
import { readOfficialPluginCatalog } from './official-plugin-catalog-oracle.mjs';
const owned = readOwnedPluginInventory();
const official = readOfficialPluginCatalog();

export async function assertCategoryCounts(page, locale, { more = false, components = owned.rows.length, bundles = owned.bundles.length, basic = 4, extensions = official.main.length } = {}) {
  const rows = await page.$$eval('[data-plugin-category-count]', elements => elements.map(element => {
    const group = element.getAttribute('data-plugin-category-count');
    const container = document.querySelector(`[data-plugin-group="${group}"]`);
    const heading = element.closest('h1,h3');
    const titleRects = [];
    const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (element.contains(node) || !node.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      titleRects.push(...[...range.getClientRects()].filter(rect => rect.width > 0).map(rect => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom })));
    }
    const countRange = document.createRange(); countRange.selectNodeContents(element);
    const countRects = [...countRange.getClientRects()].filter(rect => rect.width > 0).map(rect => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }));
    const style = getComputedStyle(element);
    const paletteProbe = document.createElement('span');
    paletteProbe.style.color = 'var(--dsw-alias-label-secondary)'; heading.append(paletteProbe);
    const officialSecondaryColor = getComputedStyle(paletteProbe).color; paletteProbe.remove();
    const titleEnd = titleRects.at(-1), countStart = countRects[0];
    const spacing = { gap: countStart.left - titleEnd.right, baselineBottomDelta: Math.abs(countStart.bottom - titleEnd.bottom), lines: countRects.length,
      rawText: element.textContent, fontSize: style.fontSize, lineHeight: style.lineHeight, fontWeight: style.fontWeight,
      color: style.color, officialSecondaryColor };

    return { group, spacing, count: Number(element.getAttribute('data-count')), components: Number(element.getAttribute('data-component-count')),
      text: element.textContent.trim(), label: element.getAttribute('aria-label'), className: element.className,
      tag: element.closest('h1,h3')?.tagName,
      inlineAncestors: (() => { const tags = []; let node = element.parentElement; while (node && !['H1', 'H3'].includes(node.tagName)) { tags.push({ tag: node.tagName, slot: node.getAttribute('data-slot'), display: getComputedStyle(node).display }); node = node.parentElement; } return tags; })(),
      visibleCards: container?.querySelectorAll(group === 'basic' ? '[data-plugin-item]' : '[data-plugin-package]').length ?? 0,
      unavailableCards: container?.querySelectorAll('[data-plugin-package] [data-deployment-unavailable]').length ?? 0,
      overflow: element.getBoundingClientRect().right > document.documentElement.clientWidth + 1,
    };
  }));
  assert.deepEqual(rows.map(row => row.group).sort(), more ? ['more'] : ['basic', 'bundles', 'extensions']);
  for (const row of rows) {
    const expected = { basic, extensions, bundles, more: official.more.length }[row.group];
    assert.equal(row.count, expected, `${row.group}: category count`);
    assert.equal(row.count, row.visibleCards, `${row.group}: count is derived from the cards actually shown`);
    assert.match(row.className, /sectionCount/u, 'count uses the existing official text style');
    assert.equal(row.overflow, false, 'count stays within the viewport');
    assert.ok(Math.abs(row.spacing.gap - 10) < 0.1, `${row.group}: text ranges are separated by 10px, got ${row.spacing.gap}`);
    assert.equal(row.spacing.lines, 1, 'normal widths keep the summary together');
    assert.equal(row.spacing.rawText, row.spacing.rawText.trim(), 'spacing does not come from text whitespace');
    assert.equal(row.spacing.fontWeight, '400', 'auxiliary text does not inherit the heading weight');
    assert.equal(row.spacing.fontSize, '12px');
    assert.equal(row.spacing.lineHeight, '18px');
    assert.equal(row.spacing.color, row.spacing.officialSecondaryColor, 'official secondary text color is retained');
    const label = row.group === 'bundles'
      ? locale === 'zh' ? `${bundles} 个插件包 · ${components} 个组件` : `${bundles} bundles · ${components} components`
      : row.group === 'basic'
        ? locale === 'zh' ? `${expected} 项配置` : `${expected} configuration entries`
        : locale === 'zh' ? `${expected} 个插件` : `${expected} plugins`;
    assert.equal(row.label, label, 'count has the exact accessible localized description');
    if (row.group === 'bundles') {
      assert.equal(row.components, components, 'installed count includes each real composition component');
      assert.equal(row.text, label);
    } else assert.equal(row.text, String(expected));
    if (row.group === 'extensions' || row.group === 'more') assert.equal(row.unavailableCards, expected, 'unavailable official plugins remain included');
    assert.equal(row.tag, more ? 'H1' : 'H3');
    for (const wrapper of row.inlineAncestors) {
      assert.equal(wrapper.tag, 'SPAN', 'the official renderer contributes only inline slot anchors inside the heading');
      assert.ok(['inline', 'contents'].includes(wrapper.display));
    }
  }
  return rows;
}

/** Limit only the existing title area, then restore it before the strict absent-plugin comparison. */
export async function assertWrappedCategoryCount(page) {
  const measured = await page.$eval('[data-plugin-category-count="bundles"]', element => {
    const heading = element.closest('h3');
    const originalStyle = heading.getAttribute('style');
    const text = element.textContent;
    try {
      heading.style.width = '200px'; heading.style.maxWidth = '200px'; heading.style.flex = '0 0 200px';
      const rect = value => { const r = value.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
      const titleRanges = [], walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (element.contains(node) || !node.textContent.trim()) continue;
        const range = document.createRange(); range.selectNodeContents(node);
        titleRanges.push(...[...range.getClientRects()].filter(r => r.width > 0).map(r => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })));
      }
      const range = document.createRange(); range.selectNodeContents(element);
      const countRanges = [...range.getClientRects()].filter(r => r.width > 0).map(r => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom }));
      return { heading: rect(heading), count: rect(element), titleRanges, countRanges, text, afterText: element.textContent,
        overflow: heading.scrollWidth > heading.clientWidth, viewportOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
    } finally {
      if (originalStyle === null) heading.removeAttribute('style'); else heading.setAttribute('style', originalStyle);
    }
  });
  assert.equal(measured.overflow, false, 'constrained 200px heading has no horizontal overflow');
  assert.equal(measured.viewportOverflow, false, 'constrained heading does not widen the page');
  assert.equal(measured.afterText, measured.text, 'wrapping retains the whole localized summary');
  assert.ok(measured.count.top >= measured.titleRanges.at(-1).bottom - 1, 'summary wraps to the next line when title and count do not fit together');
  for (const count of measured.countRanges) {
    assert.ok(count.left >= measured.heading.left && count.right <= measured.heading.right + 1, 'all count text stays inside the constrained title area');
    for (const title of measured.titleRanges) assert.ok(count.right <= title.left || count.left >= title.right || count.bottom <= title.top || count.top >= title.bottom, 'title and count text never overlap');
  }
  return measured;
}
