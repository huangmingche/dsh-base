/** Observe the actual scroll viewport without correcting navigation after a click. */
import assert from 'node:assert/strict';
import { settle } from './stability.mjs';

export async function navigationObservation(page, { detailSelector, backLabel } = {}) {
  return page.evaluate(({ detailSelector, backLabel }) => {
    const body = document.querySelector('[data-plugin-body]');
    const detail = detailSelector ? document.querySelector(detailSelector) : null;
    const box = element => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return { text: element.textContent.trim(), top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right,
        visible: rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth && hit !== null && element.contains(hit) };
    };
    const viewport = body.getBoundingClientRect();
    const firstVisibleRow = [...document.querySelectorAll('[data-plugin-row]')].find(row => { const rect = row.getBoundingClientRect(); return rect.bottom > viewport.top && rect.top < viewport.bottom; });
    const readingAnchor = firstVisibleRow ? { row: firstVisibleRow.getAttribute('data-plugin-row'), relativeY: firstVisibleRow.getBoundingClientRect().top - viewport.top } : null;
    return { readingAnchor, scrollTop: body.scrollTop, scrollLeft: body.scrollLeft, scrollHeight: body.scrollHeight, clientHeight: body.clientHeight,
      title: box(detail ? detail.querySelector('h3') : document.querySelector('[data-plugin-panel] h1')),
      back: backLabel ? box((detail ?? document).querySelector(`button[aria-label=${JSON.stringify(backLabel)}]`)) : null,
      intro: box(document.querySelector('[data-plugin-header-part="intro"]')),
      rowCount: detail?.querySelectorAll('[data-plugin-row]').length ?? 0 };
  }, { detailSelector, backLabel });
}
export async function scrollToNavigationTarget(page, selector, offset = 180) {
  await page.$eval('[data-plugin-body]', (body, { selector, offset }) => {
    const target = document.querySelector(selector);
    if (!target) throw new Error(`Missing navigation target: ${selector}`);
    body.scrollTop += target.getBoundingClientRect().top - body.getBoundingClientRect().top - offset;
    body.dispatchEvent(new Event('scroll'));
  }, { selector, offset });
  await settle(page);
}
export function assertNavigationTop(observation, { back = true, list = false } = {}) {
  assert.equal(observation.scrollTop, 0, 'new logical view starts at the top');
  assert.equal(observation.scrollLeft, 0);
  assert.equal(observation.title?.visible, true, 'view title is actually visible and unobstructed');
  if (back) assert.equal(observation.back?.visible, true, 'back control is actually visible and unobstructed');
  if (list) assert.equal(observation.intro?.visible, true, 'the original list header expands again at the top');
}
