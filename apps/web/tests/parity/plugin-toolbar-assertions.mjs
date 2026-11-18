/** Pointer and clipping checks on the actual PluginManagerPage and its measured header. */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acceptanceLaunchOptions, closeAcceptanceBrowser } from '../../scripts/acceptance-config.mjs';

const railWidth = 56, height = 825;
const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

/** Set the frame around the production page. No changes to its measured nodes or overflow rules. */
async function sizeWorkspace(page, width, pageZoom, deviceScaleFactor, cssZoom) {
  const viewport = { width: Math.ceil(width * pageZoom), height: Math.ceil(height * pageZoom), deviceScaleFactor };
  await page.setViewport(viewport);
  // Chromium rounds native zoom at the physical window boundary. Request the
  // adjacent DIP when necessary to test the exact reported CSS viewport.
  const current = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  if (current.width !== width || current.height !== height) {
    await page.setViewport({ ...viewport, width: viewport.width + width - current.width, height: viewport.height + height - current.height });
  }
  await page.evaluate(({ railWidth, cssZoom }) => {
    Object.assign(document.querySelector('#root').style, {
      position: 'fixed', inset: `0 0 0 ${railWidth / cssZoom}px`, width: 'auto', height: 'auto', zoom: String(cssZoom),
    });
  }, { railWidth, cssZoom });
  await page.evaluate(frames);
  const frame = await page.evaluate(() => {
    const root = document.querySelector('#root'), bounds = root.getBoundingClientRect();
    return { left: bounds.left, right: bounds.right, width: innerWidth, height: innerHeight,
      scale: devicePixelRatio, zoom: Number(getComputedStyle(root).zoom) };
  });
  assert.equal(frame.width, width); assert.equal(frame.height, height);
  assert.ok(Math.abs(frame.left - railWidth) <= 1 && Math.abs(frame.right - frame.width) <= 1, 'the test page fits its workspace');
  assert.ok(Math.abs(frame.scale - pageZoom * deviceScaleFactor) < 0.01);
  assert.equal(frame.zoom, cssZoom, 'CSS zoom is independent of the browser zoom and screen scale');
}

async function readControls(page, offset) {
  await page.$eval('[data-plugin-body]', (scroller, offset) => { scroller.scrollTop = offset; }, offset);
  await page.evaluate(frames);
  return page.evaluate(() => {
    const scroller = document.querySelector('[data-plugin-body]');
    const header = scroller.querySelector('[data-plugin-bar][data-natural] header'), clip = header.getBoundingClientRect();
    const buttons = [...header.querySelectorAll('[data-plugin-toolbar] [role="group"] button')];
    const controls = buttons.map(button => {
      const r = button.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
      const hits = [[x,y], [r.x + 2,y], [r.right - 2,y], [x,r.y + 2], [x,r.bottom - 2]]
        .every(([x,y]) => button.contains(document.elementFromPoint(x,y)));
      const contained = r.left >= clip.left - 1 && r.right <= clip.right + 1 && r.top >= clip.top - 1 && r.bottom <= clip.bottom + 1;
      return { label: button.getAttribute('aria-label'), readable: contained && hits && !button.disabled,
        x, y, width: r.width, height: r.height, overflowRight: r.right - clip.right, overflowBottom: r.bottom - clip.bottom };
    });
    const note = header.querySelector('[data-plugin-toolbar] > [data-tone]');
    const noteRect = note?.getBoundingClientRect();
    const tabs = [...header.querySelectorAll('[role="tab"]')];
    const { addPlugin, chooseAddMethod, updatesFailed } = window.__PLUGIN_PARITY__.copy;
    return { scroll: scroller.scrollTop, controls, labels: [addPlugin, chooseAddMethod], updatesFailed,
      note: noteRect && { text: note.textContent, y: noteRect.y, bottom: noteRect.bottom,
        readable: noteRect.left >= clip.left - 1 && noteRect.right <= clip.right + 1 && noteRect.top >= clip.top - 1 && noteRect.bottom <= clip.bottom + 1 },
      tabs: tabs.map(tab => ({ label: tab.textContent, visible: tab.checkVisibility() })) };
  });
}

async function clickActions(page, controls) {
  const [primary, methods] = controls;
  await page.mouse.click(methods.x, methods.y);
  await page.waitForSelector('[role="menuitem"]', { visible: true });
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role="menuitem"]', { hidden: true });
  await page.mouse.click(primary.x, primary.y);
  await page.waitForSelector('[role="dialog"]', { visible: true });
  assert.equal(await page.evaluate(() => window.__PLUGIN_PARITY__.source.getSnapshot().install.open), true);
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role="dialog"]', { hidden: true });
}

/** Chromium page zoom affects layout-unit rounding independently of CSS zoom or device density. */
async function withNativeZoom(puppeteer, factor, deviceScale, run) {
  const profile = await mkdtemp(join(tmpdir(), 'dsh-plugin-toolbar-'));
  let browser;
  try {
    await mkdir(join(profile, 'Default'));
    await writeFile(join(profile, 'Default', 'Preferences'), JSON.stringify({
      partition: { default_zoom_level: { x: Math.log(factor) / Math.log(1.2) } },
    }));
    const options = acceptanceLaunchOptions();
    browser = await puppeteer.launch({ ...options, args: [...options.args, `--force-device-scale-factor=${deviceScale}`], userDataDir: profile });
    await run(browser);
  } finally {
    await closeAcceptanceBrowser(browser);
    await rm(profile, { recursive: true, force: true });
  }
}

/** Keep an unmodified official renderer as the control for the reported regression. */
export async function checkPluginToolbar({ browser, puppeteer, origin, official, owned, output }) {
  const results = [];
  const run = async (browser, pageZoom, deviceScaleFactor, sizes, cssZoom = 1, state = 'navigation') => {
    for (const locale of ['zh', 'en']) for (const side of ['reference', 'adapted']) {
      const page = await browser.newPage();
      try {
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.evaluateOnNewDocument(({ official, owned }) => {
          window.__PLUGIN_CATALOG_REFERENCE__ = official; window.__OWNED_PLUGIN_REFERENCE__ = owned;
        }, { official, owned });
        await page.goto(`${origin}/?${new URLSearchParams({ surface: 'plugin-manager', state, side, locale })}`);
        await page.waitForFunction(() => document.querySelector('[data-plugin-bar][data-natural]') && window.__PLUGIN_PARITY__?.source.getSnapshot().status === 'ready');
        await page.evaluate(() => { document.body.setAttribute('data-ds-dark-theme', ''); });
        if (state === 'toolbar-extensions') {
          await page.evaluate(() => window.__PLUGIN_PARITY__.refresh());
          await page.waitForFunction(() => document.querySelector('[data-plugin-toolbar] [data-tone="error"]') &&
            window.__PLUGIN_PARITY__.source.getSnapshot().refreshStatus === 'idle');
        }
        await page.evaluate(() => document.fonts.ready);
        for (const width of sizes) {
          await sizeWorkspace(page, width, pageZoom, deviceScaleFactor, cssZoom);
          for (const offset of width === 993 && pageZoom !== 1 || state === 'toolbar-extensions' ? [0, 17, 160] : [0, 160]) {
            const { controls, labels, scroll, tabs, note, updatesFailed } = await readControls(page, offset);
            assert.deepEqual(controls.map(item => item.label), labels);
            assert.ok(Math.abs(scroll - offset) <= 1, 'the fixture exercises expanded and compact headers');
            const intact = controls.every(item => item.readable);
            const test = { side, locale, state, width, pageZoom, deviceScaleFactor, cssZoom, offset, intact };
            if (state === 'toolbar-extensions') {
              assert.equal(note?.text, updatesFailed);
              assert.equal(tabs.length, 2);
              assert.ok(tabs.every(tab => tab.visible));
              if (side === 'adapted') {
                assert.ok(note.readable, `update status clipped: ${JSON.stringify({ ...test, note, controls })}`);
                if (width === 695 && offset === 0) assert.ok(note.y >= controls[0].y + controls[0].height / 2 - 1, 'the official narrow header wraps its update note below the actions');
              }
            }
            if (output && state === 'navigation' && locale === 'zh' && width === 993 && pageZoom === 1.1 && offset === 0) {
              await page.screenshot({ path: join(output, `toolbar-zh-993-native110-${side}.png`), captureBeyondViewport: false });
            }
            if (side === 'adapted' || (width === 993 && pageZoom === 1 && cssZoom === 1)) {
              assert.ok(intact, `toolbar clipped or obstructed: ${JSON.stringify({ ...test, controls })}`);
              await clickActions(page, controls);
            }
            results.push({ ...test, controls, note, tabs });
          }
        }
        assert.deepEqual(errors, []);
      } finally { await page.close(); }
    }
  };
  await run(browser, 1, 1.25, [993]);
  await run(browser, 1, 1.25, [993], 1.25);
  await run(browser, 1, 1, [993, 695], 1, 'toolbar-extensions');
  // The 56px rail and two 20px insets leave a 600px query container at width 696.
  // 993x825 is the reported viewport. Native 110% zoom on a 2x screen reproduces
  // the subpixel wrap on macOS; whether the reference clips depends on font metrics.
  await withNativeZoom(puppeteer, 1.1, 2, async zoomed => {
    await run(zoomed, 1.1, 2, [993, 695, 696, 697]);
    await run(zoomed, 1.1, 2, [695], 1, 'toolbar-extensions');
  });
  for (const row of results.filter(row => row.side === 'adapted' && row.pageZoom === 1 && row.cssZoom === 1)) {
    const ref = results.find(ref => ref.side === 'reference' && ['state', 'locale', 'width', 'pageZoom', 'cssZoom', 'offset'].every(k => ref[k] === row[k]));
    if (!ref.intact) continue;
    for (const [i, control] of row.controls.entries()) {
      for (const key of ['x', 'y', 'width', 'height']) {
        assert.ok(Math.abs(control[key] - ref.controls[i][key]) <= 1, `official 100% geometry differs: ${JSON.stringify({ row, ref, key })}`);
      }
    }
  }
  console.log(`plugin toolbar: ${results.filter(row => row.side === 'adapted').length} bilingual viewport/zoom/scroll combinations passed`);
  return results;
}
