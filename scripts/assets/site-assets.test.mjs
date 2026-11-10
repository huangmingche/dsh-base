import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { repoRoot } from '../conformance/lib.mjs';
import { readOfficialSiteMark, sha256 } from './official-site-mark.mjs';
import { ASSET_SIZES, DESIGN, DARK_VARIANTS, checkSiteAssets, icoFrames, pngSize, versionModule } from './generate-site-assets.mjs';

const asset = path => readFileSync(join(repoRoot, 'apps/web/public', path));
/** Decode the committed 8-bit RGBA PNGs to inspect maskability, not just metadata. */
function pixels(bytes) {
  const [width, height] = pngSize(bytes);
  assert.equal(bytes[24], 8); assert.equal(bytes[25], 6, 'RGBA assets retain alpha at rounded corners');
  const chunks = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset), kind = bytes.subarray(offset + 4, offset + 8).toString();
    if (kind === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const encoded = inflateSync(Buffer.concat(chunks)), rgba = Buffer.alloc(width * height * 4), stride = width * 4;
  assert.equal(encoded.length, height * (stride + 1));
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < height; y++) {
    const filter = encoded[y * (stride + 1)]; assert.ok(filter <= 4);
    for (let x = 0; x < stride; x++) {
      const at = y * stride + x, left = x >= 4 ? rgba[at - 4] : 0, up = y > 0 ? rgba[at - stride] : 0, corner = y > 0 && x >= 4 ? rgba[at - stride - 4] : 0;
      const prediction = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? Math.floor((left + up) / 2) : paeth(left, up, corner);
      rgba[at] = (encoded[y * (stride + 1) + 1 + x] + prediction) & 255;
    }
  }
  return { width, height, rgba };
}

test('all ten public assets and URL versions match the pinned official export provenance', () => {
  const { mark, provenance } = checkSiteAssets();
  assert.equal(mark.source.export, '.');
  assert.deepEqual(mark.source.symbols, ['FISH_LOGO_PATH', 'FISH_LOGO_VIEWBOX']);
  assert.equal(provenance.geometry.pathSha256, sha256(mark.path));
  assert.equal(Object.keys(provenance.assets).length, 10);
  assert.deepEqual(DARK_VARIANTS, { '/favicon.svg': '/favicon-dark.svg' });
  assert.equal(existsSync(join(repoRoot, 'scripts/assets/generate-site-assets.py')), false, 'the D-monogram generator is retired');
  const versions = versionModule(provenance.assets, provenance.source);
  assert.ok(versions.includes('export const SITE_ASSET_DARK_VARIANTS: Readonly<Record<string, string>>'));
  for (const path of Object.keys(ASSET_SIZES)) assert.ok(versions.includes(JSON.stringify(path)));
  const modified = structuredClone(provenance.assets);
  modified['/favicon.svg'].sha256 = sha256('old D monogram');
  assert.notEqual(versionModule(modified, provenance.source), versions, 'changed asset bytes must change their URL version');
});

test('theme SVGs carry the same official whale with fixed monochrome ink and no backplate or style', () => {
  const mark = readOfficialSiteMark();
  for (const [name, ink] of [['favicon.svg', '#000000'], ['favicon-dark.svg', '#ffffff']]) {
    const svg = asset(name).toString();
    assert.equal([...svg.matchAll(/<path\b/gu)].length, 1);
    assert.equal(svg.match(/<path d="([^"]+)"/u)?.[1], mark.path);
    assert.equal(svg.match(/<path[^>]+fill="([^"]+)"/u)?.[1], ink);
    assert.doesNotMatch(svg, /<style\b|\bstyle=|<rect\b|<circle\b|background|prefers-color-scheme/u, 'media selection belongs to the document link, not SVG styles');
    const placement = svg.match(/<svg x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)" viewBox="0 0 ([^ ]+) ([^"]+)"/u);
    assert.ok(placement);
    const [, x, y, width, height, vw, vh] = placement.map((value, index) => index === 0 ? value : Number(value));
    assert.ok(Math.abs(width / height - vw / vh) < 1e-12, 'floating-point placement preserves the official aspect ratio');
    assert.equal(x * 2 + width, 512); assert.equal(y * 2 + height, 512);
    assert.ok(width / 512 >= 0.86 && width / 512 <= 0.9, 'normal small icons keep the whale legible');
  }
});

test('installation tiles and sharing image retain their white whale on dark background', () => {
  for (const [path, expected] of Object.entries(ASSET_SIZES).filter(([path]) => path.endsWith('.png') && !path.startsWith('/favicon-'))) {
    assert.deepEqual(pngSize(asset(path)), expected);
    const { rgba } = pixels(asset(path));
    let white = 0, background = 0;
    for (let at = 0; at < rgba.length; at += 4) {
      if (rgba[at] > 240 && rgba[at + 1] > 240 && rgba[at + 2] > 240 && rgba[at + 3] === 255) white++;
      if (rgba[at] === 23 && rgba[at + 1] === 23 && rgba[at + 2] === 23 && rgba[at + 3] === 255) background++;
    }
    assert.ok(white > 0 && background > white, `${path}: white whale remains readable on dark neutral background`);
  }
});

test('website PNG and ICO fallbacks are black silhouettes with transparent non-corner backgrounds', () => {
  assert.equal(DESIGN.websiteFallback, '#000000', 'fallback ink follows the official default, never the earlier blue');
  const frames = icoFrames(asset('favicon.ico'));
  assert.ok(frames[0].bytes.equals(asset('favicon-16x16.png')));
  assert.ok(frames[1].bytes.equals(asset('favicon-32x32.png')));
  for (const { size, bytes } of frames) {
    const { width, height, rgba } = pixels(bytes);
    assert.deepEqual([width, height], [size, size]);
    let transparent = 0, black = 0;
    for (let at = 0; at < rgba.length; at += 4) {
      if (rgba[at + 3] === 0) transparent++;
      if (rgba[at + 3] > 0) assert.deepEqual([...rgba.subarray(at, at + 3)], [0, 0, 0], 'every painted pixel, including antialiasing, is black; no blue or backplate');
      if (rgba[at + 3] === 255) black++;
    }
    const alpha = (x, y) => rgba[(y * width + x) * 4 + 3];
    assert.equal(alpha(Math.floor(width / 2), 0), 0, 'top background is transparent away from corners');
    assert.equal(alpha(0, Math.floor(height / 2)), 0, 'side background is transparent away from corners');
    assert.ok(transparent > width * height / 2, 'only the whale silhouette is painted');
    assert.ok(black > 0, 'small favicon contains a visible solid black mark');
  }
});

test('maskable image is opaque and the whole whale stays inside the 80 percent safe circle', () => {
  const { width, height, rgba } = pixels(asset('icon-maskable-512.png'));
  let white = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 4;
    assert.equal(rgba[at + 3], 255, 'maskable background is full bleed');
    if (rgba[at] !== 23 || rgba[at + 1] !== 23 || rgba[at + 2] !== 23) {
      white++;
      assert.ok(Math.hypot(x + 0.5 - width / 2, y + 0.5 - height / 2) <= DESIGN.safeCircleRadius, 'no foreground pixel outside maskable safe circle');
    }
  }
  assert.ok(white > 20_000, 'maskable whale cannot be empty or microscopic');
});
