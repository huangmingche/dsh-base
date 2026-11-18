/** Normalize only the user-approved local whale image to the independent official atom.
 * Callers preserve raw captures first. No arbitrary image or other layout is changed. */
export async function normalizeOwnedArtwork(page, canonical) {
  return page.evaluate(canonical => {
    const changes = [];
    for (const image of document.querySelectorAll('[data-plugin-package] img,[data-plugin-detail] img,[data-plugin-row-detail] img')) {
      if (image.getAttribute('src') !== canonical) continue;
      const size = image.getAttribute('width');
      if (size !== '30' && size !== '36') throw new Error('Unexpected owned artwork size');
      const reference = document.querySelector(`[data-official-fish-reference="${size}"]`);
      if (!reference) throw new Error('Official FishLogo reference missing');
      const opticalWidth = size === '30' ? 20 : 24;
      if (Number(reference.querySelector('svg')?.getAttribute('width')) !== opticalWidth || reference.style.width !== `${size}px` || reference.style.height !== `${size}px`) throw new Error('Official FishLogo reference must preserve the artwork slot and approved optical size');
      const replacement = reference.cloneNode(true);
      replacement.removeAttribute('data-official-fish-reference');
      replacement.setAttribute('data-approved-owned-artwork-reference', '');
      image.replaceWith(replacement);
      changes.push({ image, replacement });
    }
    window.__OWNED_ARTWORK_RESTORES__ = changes;
    return changes.length;
  }, canonical);
}
export async function restoreOwnedArtwork(page) {
  await page.evaluate(() => {
    for (const { image, replacement } of window.__OWNED_ARTWORK_RESTORES__ ?? []) replacement.replaceWith(image);
    delete window.__OWNED_ARTWORK_RESTORES__;
  });
}
