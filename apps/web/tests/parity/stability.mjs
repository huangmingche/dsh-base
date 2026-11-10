/** H2: make pixel parity compare settled frames, not whatever the compositor had drawn. */
/**
 * Wait until CSS/Web Animations have finished and two frames have been painted.
 *
 * The screenshots compare full documents; a modal backdrop fading in or a panel
 * painting its first frame is a timing race, not a rendering difference. Settle
 * first, then let one quiet frame pass so the capture is deterministic.
 * @param page - puppeteer page.
 */
export async function settle(page) {
  // Do not bring the page to front: focus changes LCD text rasterization and
  // would make two otherwise identical pages differ at every glyph edge.
  await page.evaluate(async () => {
    // Web fonts load asynchronously; a capture while one side still renders a
    // fallback face produces text-edge antialiasing differences under load.
    if (document.fonts?.ready !== undefined) {
      await Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 3000))]);
    }
    if (typeof document.getAnimations === "function") {
      // Infinite animations (spinners, indeterminate progress) never finish;
      // waiting on them would hang the capture, so only finite effects count.
      const finite = document.getAnimations().filter(animation => {
        const timing = animation.effect?.getComputedTiming?.();
        return timing === undefined || timing.endTime === undefined || Number.isFinite(timing.endTime);
      });
      await Promise.race([
        Promise.all(finite.map(animation => animation.finished.catch(() => undefined))),
        new Promise(resolve => setTimeout(resolve, 2000)),
      ]);
    }
    // Two compositor frames are requested, but the wait is bounded and falls
    // back to timers because a background tab may throttle rAF indefinitely.
    await Promise.race([
      new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
      new Promise(resolve => setTimeout(resolve, 120)),
    ]);
  });
  await new Promise(resolve => setTimeout(resolve, 50));
}

/** Settled screenshot of one page. */
export async function stableScreenshot(page, options) {
  await settle(page);
  return page.screenshot(options);
}

/**
 * Capture both sides of a parity case and compare pixels after settling.
 *
 * A transient mismatch re-settles both sides and retries; retries are only a
 * fallback. Each retry is printed as `{"parityRetry":{label,attempts}}` so a
 * case that always needs them is visible instead of being masked.
 * @param label - case identity for the retry log.
 * @param captureA - first side capture returning a Buffer.
 * @param captureB - second side capture returning a Buffer.
 * @param attempts - maximum captures per side (default 3).
 * @returns the equal flag, attempt count and the last buffers.
 */
export async function stableCompare(label, captureA, captureB, attempts = 3) {
  let a, b;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    a = await captureA();
    b = await captureB();
    if (Buffer.from(a).equals(Buffer.from(b))) {
      if (attempt > 1) console.log(JSON.stringify({ parityRetry: { label, attempts: attempt } }));
      return { equal: true, attempts: attempt, a, b };
    }
  }
  console.log(JSON.stringify({ parityRetry: { label, attempts, failed: true } }));
  return { equal: false, attempts, a, b };
}
