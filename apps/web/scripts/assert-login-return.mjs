import assert from "node:assert/strict";

/** Follow an anonymous private link through a real password login in a fresh browser context. */
export async function assertLoginReturn(browser, account, target, selectedPath) {
  target.search = "?view=a%23b&filter=one%20two";
  target.hash = "#section%202";
  const context = await browser.createBrowserContext();
  try {
    const page = await context.newPage();
    // Capture the return document before any client-side navigation.
    await page.evaluateOnNewDocument(() => { window.__loginReturnEntry = location.href; });
    await page.goto(target.href, { waitUntil: "domcontentloaded" });
    const login = new URL(page.url());
    assert.equal(login.pathname, "/login");
    assert.equal(login.searchParams.get("next"), target.pathname + target.search);
    assert.equal(login.hash, target.hash, "the browser carries the incoming fragment onto the login page");

    await page.waitForSelector('input[name="username"]', { visible: true });
    await page.type('input[name="username"]', account.username);
    await page.click("button[type=submit]");
    await page.waitForSelector('input[name="password"]', { visible: true });
    await page.type('input[name="password"]', account.password);
    const [signIn, document] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/sign-in/username"
        && response.request().method() === "POST"),
      page.waitForNavigation({ waitUntil: "domcontentloaded" }),
      page.click("button[type=submit]"),
    ]);
    assert.equal(signIn.status(), 200);
    assert.equal(document?.status(), 200);
    assert.equal(await page.evaluate(() => window.__loginReturnEntry), target.href, "login restores the full original address");
    // A Workspace opens its saved blank Session after the original document loads.
    const selectedId = decodeURIComponent(selectedPath.split("/").at(-1));
    await page.waitForFunction((path, id) => location.pathname === path
      && Array.from(document.querySelectorAll("[data-conversation-session]")).some(node => node.dataset.conversationSession === id),
    { timeout: 60000 }, selectedPath, selectedId);
    assert.equal(page.url(), target.origin + selectedPath + target.search + target.hash, "selection keeps the query and fragment");
    return target.pathname;
  } finally {
    await context.close();
  }
}
