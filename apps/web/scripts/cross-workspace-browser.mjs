import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import { localizePath } from '../../../packages/boot/dsh-base-locale-path/src/index.ts';
import { acceptanceLaunchOptions, closeAcceptanceBrowser } from './acceptance-config.mjs';

const chip = 'button[aria-haspopup="menu"][class*="_workspace_"]';
const suffix = '?qa=cross-workspace%26return%3D1#selection%2Fworkspace';
const navigation = { waitUntil: 'domcontentloaded', timeout: 60_000 };
const loginUser = '[data-auth-dialog] input[name="username"]';
const loginPassword = '[data-auth-dialog] input[name="password"]';
const loginSubmit = '[data-auth-dialog] button[type="submit"]';

function route(kind, id) {
  return localizePath(`/app/${kind}/${encodeURIComponent(id)}`, 'zh') + suffix;
}

async function guardFixtures(page, base, workspaces) {
  const blocked = [];
  await page.setRequestInterception(true);
  page.on('request', async request => {
    const url = new URL(request.url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') return request.continue();
    if (url.origin !== base) return request.abort('blockedbyclient');
    if (request.method() === 'POST') {
      let body;
      try { body = JSON.parse(request.postData()); } catch { /* Some POSTs carry no JSON. */ }
      const host = url.pathname === '/api/session-host';
      const createSession = url.pathname === '/api/session/create' || (host && body?.method === 'create');
      const createWorkspace = url.pathname === '/api/workspace/create' || (host && body?.method === 'workspaceCreate');
      if (createWorkspace || createSession) {
        const args = host ? body?.params : body?.payload?.args?.request;
        if (createWorkspace || !workspaces.some(w => w.workspaceId === args?.workspaceId && w.sessionIds.includes(args?.sessionId))) {
          blocked.push(createWorkspace ? 'workspace creation' : 'unrecognized Session acquisition');
          return request.abort('blockedbyclient');
        }
      }
    }
    return request.continue();
  });
  return blocked;
}

async function clickSignOut(page, base) {
  await page.click('[data-signed-out="false"]');
  const findSignOut = selector => page.waitForFunction(selector => [...document.querySelectorAll(selector)]
    .find(el => el.getBoundingClientRect().width && /^(sign out|log out|退出登录)$/iu.test(el.textContent.trim())), {}, selector);
  const menuItem = await findSignOut('[role="menu"] [role="menuitem"]');
  await menuItem.asElement().click();
  const confirm = await findSignOut('[role="dialog"] button');
  const [response] = await Promise.all([
    page.waitForResponse(r => r.url() === base + '/api/auth/sign-out' && r.request().method() === 'POST'),
    confirm.asElement().click(),
  ]);
  assert.equal(response.status(), 200, 'Account menu sign-out');
}

async function signIn(page, base, credentials, destination) {
  await page.waitForSelector(loginUser, { visible: true });
  const login = new URL(page.url());
  const target = new URL(destination, base);
  assert.equal(login.origin, base);
  assert.equal(login.pathname, '/login');
  assert.equal(login.searchParams.get('next'), target.pathname + target.search);
  assert.equal(login.hash, target.hash);
  await page.type(loginUser, credentials.username);
  await page.click(loginSubmit);
  await page.waitForSelector(loginPassword, { visible: true });
  assert.equal(new URL(page.url()).origin, base);
  await page.type(loginPassword, credentials.password);
  const [signed, document] = await Promise.all([
    page.waitForResponse(r => r.url() === base + '/api/auth/sign-in/username' && r.request().method() === 'POST'),
    page.waitForNavigation(navigation),
    page.click(loginSubmit),
  ]);
  assert.equal(signed.status(), 200);
  assert.equal(document?.status(), 200);
  assert.equal(await page.evaluate(() => window.__workspaceEntry), target.href, 'Login returns to the complete original address');
}

async function pick(page, workspace) {
  await page.click(chip);
  const choice = await page.waitForFunction(({ workspaceId, path }) => {
    const row = document.querySelector(`[data-row-key="${CSS.escape('workspace:' + workspaceId)}"] [class*="projectText"] > span`);
    const entries = [...document.querySelectorAll('[role="menu"] button[role="menuitem"]')];
    // Duplicate titles are disambiguated by a tooltip containing the full workspace path.
    return entries.find(el => [...el.querySelectorAll('[title]')].some(span => span.title === path))
      ?? entries.find(el => el.textContent.trim() === row?.textContent.trim());
  }, {}, { workspaceId: workspace.workspaceId, path: workspace.path });
  await choice.asElement().click();
}

async function verifySelection(page, workspace, step, onCheck, expectedSession) {
  const ids = expectedSession ? [expectedSession] : workspace.sessionIds;
  const expected = ids.map(sessionId => ({ sessionId, url: route('session', sessionId) }));
  const handle = await page.waitForFunction((expected, workspaceId, chip) => {
    const url = location.pathname + location.search + location.hash;
    const match = expected.find(row => row.url === url);
    const row = document.querySelector(`[data-row-key="${CSS.escape('workspace:' + workspaceId)}"] [class*="projectText"] > span`);
    if (!match || !row?.textContent.trim() || document.querySelector(chip)?.textContent.trim() !== row.textContent.trim()) return false;
    return [...document.querySelectorAll('[data-conversation-session]')].some(el =>
      el.getBoundingClientRect().width && el.dataset.conversationSession === match.sessionId) && match;
  }, {}, expected, workspace.workspaceId, chip);
  const { sessionId, url } = await handle.jsonValue();
  await onCheck({ step, workspaceId: workspace.workspaceId, sessionId, url });
  return sessionId;
}

async function refreshAndSignInAgain(page, base, credentials, workspace, sessionId, name, onCheck) {
  const original = route('session', sessionId);
  const document = await page.reload(navigation);
  assert.equal(document?.status(), 200);
  assert.equal(await page.evaluate(() => window.__workspaceEntry), base + original);
  await verifySelection(page, workspace, name + '-refresh', onCheck, sessionId);
  await clickSignOut(page, base);
  await signIn(page, base, credentials, original);
  await verifySelection(page, workspace, name + '-same-tab-relogin', onCheck, sessionId);
}

async function revokeBrowserSession(context, base) {
  const cookie = (await context.cookies()).find(c => /^(?:__Secure-)?better-auth\.session_token$/u.test(c.name));
  if (!cookie) return;
  const response = await fetch(base + '/api/auth/sign-out', { method: 'POST', redirect: 'error',
    headers: { origin: base, 'content-type': 'application/json', cookie: cookie.name + '=' + cookie.value },
    body: '{}', signal: AbortSignal.timeout(30_000) });
  assert.equal(response.status, 200, 'Release the browser acceptance login');
}

/** Exercise both existing workspaces in one browser through the deployed picker and account menu. */
export async function verifyWorkspaceNavigation({ base, credentials, workspaces, onCheck }) {
  const [a, b] = workspaces;
  assert.equal(workspaces.length, 2);
  assert.notEqual(a.workspaceId, b.workspaceId);
  assert.ok(a.sessionIds.length && b.sessionIds.length, 'Both workspaces need an existing blank Session');
  const browser = await puppeteer.launch(acceptanceLaunchOptions());
  let context, blocked;
  try {
    context = await browser.createBrowserContext();
    const page = await context.newPage();
    page.setDefaultTimeout(45_000);
    await page.setViewport({ width: 1440, height: 1000 });
    blocked = await guardFixtures(page, base, workspaces);
    await page.evaluateOnNewDocument(() => { window.__workspaceEntry = location.href; });
    const entryA = route('workspace', a.workspaceId);
    await page.goto(base + entryA, navigation);
    await signIn(page, base, credentials, entryA);
    const sessionA = await verifySelection(page, a, 'A-workspace-login', onCheck);
    await pick(page, b);
    const sessionB = await verifySelection(page, b, 'A-to-B', onCheck);
    const entryB = route('workspace', b.workspaceId);
    const document = await page.goto(base + entryB, navigation);
    assert.equal(document?.status(), 200);
    assert.equal(await page.evaluate(() => window.__workspaceEntry), base + entryB);
    await verifySelection(page, b, 'B-workspace-link', onCheck, sessionB);
    await refreshAndSignInAgain(page, base, credentials, b, sessionB, 'B', onCheck);
    await pick(page, a);
    await verifySelection(page, a, 'B-to-A', onCheck, sessionA);
    await refreshAndSignInAgain(page, base, credentials, a, sessionA, 'A', onCheck);
    await pick(page, b);
    await verifySelection(page, b, 'A-to-B-repeat', onCheck, sessionB);
    await pick(page, a);
    await verifySelection(page, a, 'B-to-A-repeat', onCheck, sessionA);
  } finally {
    try {
      if (context) await revokeBrowserSession(context, base);
    } finally {
      await closeAcceptanceBrowser(browser);
    }
    if (blocked?.length) throw new Error('Existing workspace regression attempted ' + blocked.join(', '));
  }
}
