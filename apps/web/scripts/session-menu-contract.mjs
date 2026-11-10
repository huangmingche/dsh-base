/** Real built application: official menu, owner-scoped Markdown and browser ZIP download. */
import assert from 'node:assert/strict';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';

export async function assertSessionHeaderMenu({ page, browser, base, request, cookie, sessionId, historyText, artifacts }) {
  const menuButton = 'button[aria-label="More actions"]';
  await page.waitForSelector(menuButton, { visible: true, timeout: 20000 });
  const plugin = await page.evaluate(() => window.__DSH_BASE_PLUGINS__?.find(row => row.moduleName === '@deepseek-ai/dsh-session-log-export'));
  assert.equal(plugin?.origin, 'upstream');
  assert.equal(plugin?.fiberPhase, 'active', 'the actual official export plugin must be mounted, not just listed');
  const commands = await page.evaluate(async sessionId => {
    const method = 'commands/list';
    const response = await fetch(`/api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method, payload: { args: { sessionId } } }) });
    return { status: response.status, body: await response.json() };
  }, sessionId);
  assert.equal(commands.status, 200);
  assert.equal(commands.body.result?.ok, true, 'actual Cordis composition must expose the command service');
  assert.ok(commands.body.result.value.some(row => row.name === 'export' && row.definitionId === '@deepseek-ai/dsh-session-log-export'));
  const select = async label => {
    await page.waitForSelector('[role="menu"]', { visible: true });
    const row = await page.evaluateHandle(label => [...document.querySelectorAll('[role="menuitem"]')]
      .find(row => row.textContent.trim() === label), label);
    try {
      assert.ok(row.asElement(), `Missing official Session menu action: ${label}`);
      await row.asElement().click();
    } finally { await row.dispose(); }
  };
  await page.click(menuButton);
  assert.deepEqual(await page.$$eval('[role="menuitem"]', rows => rows.map(row => row.textContent.trim())), [
    'Copy Session as Markdown', 'Download session log', 'Feedback',
  ], 'preserve the menu owned by the pinned official release');
  await page.screenshot({ path: join(artifacts, 'session-menu.png') });
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role="menu"]', { hidden: true });

  const markdownPath = `/api/session.markdown?${new URLSearchParams({ sessionId })}`;
  const denied = await request(markdownPath);
  assert.equal(denied.status, 401, 'anonymous users cannot export private conversations');
  const response = await request(markdownPath, { headers: { cookie } });
  assert.equal(response.status, 200);
  const markdown = await response.text();
  assert.ok(markdown.includes(historyText), 'export reads the real durable conversation');
  assert.match(response.headers.get('cache-control') ?? '', /no-store/u);
  const context = browser.defaultBrowserContext();
  let cdp;
  try {
    await context.overridePermissions(base, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
    await page.bringToFront();
    await page.click(menuButton);
    await select('Copy Session as Markdown');
    await page.waitForFunction(() => [...document.querySelectorAll('[role="alert"]')].some(element =>
      element.textContent === 'Session copied as Markdown.' && element.getClientRects().length > 0
      && getComputedStyle(element).visibility !== 'hidden'));
    assert.equal(await page.$$eval('[role="alert"]', elements => elements.find(element =>
      element.textContent === 'Session copied as Markdown.')?.textContent), 'Session copied as Markdown.');
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), markdown, 'official copy action writes the complete Host response');

    const downloads = join(artifacts, 'session-downloads');
    await mkdir(downloads, { recursive: true });
    const filename = `dsh-session-${sessionId.replace(/[^A-Za-z0-9_-]/gu, '_')}.zip`;
    const destination = join(downloads, filename);
    await rm(destination, { force: true });
    cdp = await page.createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
    await page.click(menuButton);
    await select('Download session log');
    await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.textContent.includes('Session download started'));
    let zip;
    for (let i = 0; i < 100; i++) {
      try { zip = await readFile(destination); break; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(zip, 'browser must finish saving the real ZIP, beyond the HEAD probe');
    const entries = unzipSync(zip);
    const logs = Object.entries(entries).filter(([name]) => name.endsWith('.jsonl'));
    assert.ok(logs.length > 0, 'the official archive includes a Session log');
    assert.ok(logs.some(([, bytes]) => strFromU8(bytes).includes(historyText)), 'download contains the real durable turn');
    await page.keyboard.press('Escape');
    await page.waitForSelector('[role="dialog"]', { hidden: true });
    await page.click(menuButton);
    await select('Feedback');
    await page.waitForSelector('[role="dialog"] textarea[aria-label="Feedback details"]');
    assert.equal(await page.$eval('[role="dialog"] textarea', element => element.readOnly), true);
    assert.ok(await page.$eval('[role="dialog"]', dialog => [...dialog.querySelectorAll('button:disabled')]
      .some(button => button.textContent.includes('no conversation log feedback service'))), 'feedback keeps the official unavailable submission state');
    await page.keyboard.press('Escape');
    await page.waitForSelector('[role="dialog"]', { hidden: true });
    return { officialPluginActive: true, copyMatchesDurableMarkdown: true, browserZipSaved: true, archiveEntries: Object.keys(entries).length, anonymousExportStatus: denied.status, feedbackSubmissionDisabled: true };
  } finally {
    try {
      if (cdp) await cdp.send('Browser.setDownloadBehavior', { behavior: 'default' });
    } finally {
      try { if (cdp) await cdp.detach(); }
      finally { await context.clearPermissionOverrides(); }
    }
  }
}
