/** Inspect only a caller-created, closed acceptance profile, never a user's browser. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { inflateSync } from "node:zlib";

function decodeBitmap(bytes) {
  assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), "Chrome favicon bitmap is PNG");
  let width, height;
  const compressed = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4);
      assert.deepEqual([...chunk.subarray(8)], [8, 6, 0, 0, 0], "Chrome stores non-interlaced 8-bit RGBA PNGs");
    }
    if (type === "IDAT") compressed.push(chunk);
    offset += length + 12;
  }
  assert.ok(width > 0 && height > 0, "bitmap has dimensions");
  const raw = inflateSync(Buffer.concat(compressed)), stride = width * 4;
  assert.equal(raw.length, (stride + 1) * height, "complete PNG scanlines");
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    assert.ok(filter <= 4, "supported PNG filter");
    for (let x = 0; x < stride; x++) {
      const at = y * stride + x;
      const left = x >= 4 ? pixels[at - 4] : 0;
      const above = y > 0 ? pixels[at - stride] : 0;
      const upperLeft = y > 0 && x >= 4 ? pixels[at - stride - 4] : 0;
      const predictor = left + above - upperLeft;
      const distances = [Math.abs(predictor - left), Math.abs(predictor - above), Math.abs(predictor - upperLeft)];
      const paeth = distances[0] <= distances[1] && distances[0] <= distances[2] ? left : distances[1] <= distances[2] ? above : upperLeft;
      const correction = [0, left, above, Math.floor((left + above) / 2), paeth][filter];
      pixels[at] = (raw[y * (stride + 1) + x + 1] + correction) & 255;
    }
  }
  return { width, height, pixels };
}

export function verifySelectedFavicons({ profile, pages, output }) {
  assert.equal(pages.length, 2, "both browser themes need actual selected favicon evidence");
  assert.deepEqual(pages.map(page => page.scheme).sort(), ["dark", "light"], "both distinct browser themes are verified");
  assert.equal(new Set(pages.map(page => page.url)).size, pages.length, "theme pages have independent database mappings");
  const database = new DatabaseSync(join(profile, "Default", "Favicons"), { readOnly: true });
  try {
    const query = database.prepare(`SELECT f.url AS icon_url, b.width, b.height, b.image_data
      FROM icon_mapping m JOIN favicons f ON f.id = m.icon_id
      JOIN favicon_bitmaps b ON b.icon_id = f.id
      WHERE m.page_url = ? AND f.icon_type = 1 ORDER BY b.width, b.height`);
    return pages.map(page => {
      const rows = query.all(page.url);
      assert.ok(rows.length > 0, `${page.scheme}: Chrome persisted the chosen tab favicon`);
      const sizes = new Set();
      const variants = rows.map((row, index) => {
        assert.equal(row.icon_url, page.expectedIconUrl, `${page.scheme}: Chrome actually selected the theme SVG, not a competing fallback`);
        const bytes = Buffer.from(row.image_data);
        const { width, height, pixels } = decodeBitmap(bytes);
        assert.equal(width, row.width); assert.equal(height, row.height);
        assert.equal(width, height, "selected favicon is square");
        sizes.add(width);
        let transparent = 0, opaque = 0, partial = 0, wrongInk = 0, alphaSum = 0;
        const ink = page.scheme === "dark" ? 255 : 0;
        for (let at = 0; at < pixels.length; at += 4) {
          const alpha = pixels[at + 3];
          alphaSum += alpha;
          if (alpha === 0) transparent++;
          else if (alpha === 255) opaque++;
          else partial++;
          if (alpha >= 250 && [0, 1, 2].some(channel => Math.abs(pixels[at + channel] - ink) > 2)) wrongInk++;
        }
        assert.ok(transparent > width * height * 0.30, `${page.scheme}: selected bitmap has a transparent background`);
        // Native 16px downsampling spreads solid pixels across antialiased
        // edges. Integrated alpha measures visible area without rejecting it.
        const coverage = alphaSum / (255 * width * height);
        assert.ok(coverage > 0.10 && opaque > 0, `${page.scheme}: selected ${width}px bitmap has a visible whale`);
        assert.ok(partial > 0, `${page.scheme}: selected bitmap preserves antialiasing`);
        assert.equal(wrongInk, 0, `${page.scheme}: actual selected bitmap is ${ink === 0 ? "black" : "white"}`);
        const file = `selected-favicon-${page.scheme}-${width}x${height}-${index}.png`;
        writeFileSync(join(output, file), bytes);
        return { file, width, height, sha256: createHash("sha256").update(bytes).digest("hex"), transparent, opaque, partial, coverage, wrongInk };
      });
      assert.ok(sizes.has(16) && sizes.has(32), `${page.scheme}: native 16px and 32px tab bitmaps are verified`);
      return { page: page.url, scheme: page.scheme, selectedIcon: page.expectedIconUrl, variants };
    });
  } finally { database.close(); }
}
