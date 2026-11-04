#!/usr/bin/env node
import { acceptanceLaunchOptions, closeAcceptanceBrowser } from "../../scripts/acceptance-config.mjs";
/** Pinned official directory browser and precise preset availability contracts, in Chromium. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
const app = resolve(import.meta.dirname, "../..");
const requireFromApp = createRequire(resolve(app, "package.json"));
const puppeteer = requireFromApp("puppeteer-core").default;
const vite = await import(requireFromApp.resolve("vite"));
const configFile = resolve(app, "vite.parity.config.ts");
const output = resolve(app, "dist/parity-evidence");
let server, browser;
const cases = [];
const snapshot = page => page.evaluate(() => ({
  text: document.body.innerText,
  controls: [...document.querySelectorAll("button,input")].map(element => {
    const b = element.getBoundingClientRect();
    return { tag: element.tagName, label: element.getAttribute("aria-label"), text: element.textContent, disabled: element.matches(":disabled"), rect: [b.x, b.y, b.width, b.height].map(n => Math.round(n * 100) / 100) };
  }),
}));
try {
  await mkdir(output, { recursive: true });
  await vite.build({ configFile, logLevel: "error" });
  server = await vite.preview({ configFile, logLevel: "error", preview: { host: "127.0.0.1", port: 0, strictPort: true } });
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await puppeteer.launch(acceptanceLaunchOptions());
  async function open(locale, surface, side, state) {
    const page = await browser.newPage();
    page.setDefaultTimeout(10000);
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(`${origin}/?${new URLSearchParams({ surface, locale, side, state })}`, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => window.__CAPABILITIES__ !== undefined);
    await page.evaluate(() => document.fonts.ready);
    if (surface === "directory") await page.waitForFunction(() => document.body.innerText.includes("existing"));
    if (surface === "agent-preset" && side === "reference") await page.evaluate(() => {
      // Mirror only the seam's real unavailability on the untouched official
      // reference: the fixed row has no declaration to read, and Creator mode
      // lacks its Cordis Host runner. Official rows keep their viewer.
      const fixture = window.__CAPABILITIES__;
      const copy = fixture.copy;
      const t = fixture.t;
      for (const card of document.querySelectorAll("li[data-agent-preset-id]")) {
        if (card.dataset.agentPresetId !== "dsh-base-think") continue;
        for (const button of card.querySelectorAll("button[data-tip]")) {
          if (button.dataset.tip !== t("view")) continue;
          button.disabled = true; button.setAttribute("aria-disabled", "true");
          button.title = copy.readUnavailable;
        }
      }
      const creator = [...document.querySelectorAll("button")].find(button => button.textContent?.trim() === t("creatorDraft"));
      if (creator !== undefined) {
        creator.disabled = true; creator.setAttribute("aria-disabled", "true");
        creator.title = copy.creatorUnavailable;
      }
    });
    return { page, errors };
  }
  for (const locale of ["en", "zh"]) for (const [surface, stateName] of [["directory", "default"], ["agent-preset", "built-in"], ["agent-preset", "broken"]]) {
    const reference = await open(locale, surface, "reference", stateName);
    const adapted = await open(locale, surface, "adapted", stateName);
    const name = `${surface}-${stateName}-${locale}`;
    assert.deepEqual(await snapshot(adapted.page), await snapshot(reference.page), `${name}: official text/control geometry`);
    for (const fixture of [reference, adapted]) await fixture.page.evaluate(() => document.activeElement?.blur());
    const a = await reference.page.screenshot({ path: resolve(output, `${name}-official.png`), captureBeyondViewport: false });
    const b = await adapted.page.screenshot({ path: resolve(output, `${name}-adapted.png`), captureBeyondViewport: false });
    assert.ok(Buffer.from(a).equals(Buffer.from(b)), `${name}: pinned reference pixels differ`);
    for (const fixture of [reference, adapted]) {
      const { page } = fixture;
      await page.bringToFront();
      if (surface === "directory") {
        await page.evaluate(locale => {
          const copy = window.__CAPABILITIES__.dictionaries["directory-browser"][locale];
          [...document.querySelectorAll("button")].find(button => button.textContent === copy["browser.newFolder"]).click();
          window.__CAPABILITIES__.setRefuseCreate(true);
        }, locale);
        await page.waitForSelector("input");
        const input = await page.$("input");
        await input.click({ clickCount: 3 });
        await input.type("Parity folder");
        const create = () => page.evaluate(locale => {
          const copy = window.__CAPABILITIES__.dictionaries["directory-browser"][locale];
          const button = [...document.querySelectorAll("button")].find(button => button.textContent.trim() === copy["browser.create"]);
          if (!button) throw new Error(`missing Create: ${document.body.innerText}`);
          button.click();
        }, locale);
        await create();
        await page.waitForFunction(() => document.body.innerText.includes("fixture duplicate"));
        assert.equal(await page.$eval("input", element => element.value), "Parity folder", "rejection preserves draft");
        await page.evaluate(() => window.__CAPABILITIES__.setRefuseCreate(false));
        await create();
        await page.waitForFunction(() => !document.querySelector("input") && document.body.innerText.includes("Parity folder"));
        await page.evaluate(locale => {
          const copy = window.__CAPABILITIES__.dictionaries["directory-browser"][locale];
          [...document.querySelectorAll("button")].find(button => button.textContent === copy["browser.open"]).click();
        }, locale);
        const calls = await page.evaluate(() => window.__CAPABILITIES__.calls);
        assert.deepEqual(calls.filter(call => call.endpoint === "directoryPicker/createDirectory").map(call => call.args), [{ path: "/", name: "Parity folder" }, { path: "/", name: "Parity folder" }]);
        assert.deepEqual(calls.filter(call => call.endpoint === "workspace/picked").map(call => call.args), [{ path: "/Parity folder" }]);
      } else {
        const state = await page.evaluate(() => {
          const t = window.__CAPABILITIES__.t;
          const cards = [...document.querySelectorAll("li[data-agent-preset-id]")].map(card => {
            const id = card.dataset.agentPresetId;
            const view = [...card.querySelectorAll("button[data-tip]")].find(button => button.dataset.tip === t("view"));
            return {
              id,
              text: (card.textContent ?? "").trim(),
              broken: card.querySelector('[role="alert"]') !== null,
              view: view === undefined ? null : { disabled: view.disabled, title: view.title },
            };
          });
          const creator = [...document.querySelectorAll("button")].find(button => button.textContent?.trim() === t("creatorDraft"));
          return {
            cards,
            creator: creator === undefined ? null : { disabled: creator.disabled, title: creator.title },
            thinkName: window.__CAPABILITIES__.copy.thinkName,
            readUnavailable: window.__CAPABILITIES__.copy.readUnavailable,
            creatorUnavailable: window.__CAPABILITIES__.copy.creatorUnavailable,
            helpLabels: [window.__CAPABILITIES__.t("modeExplanation"), window.__CAPABILITIES__.t("howToUse")],
            body: document.body.innerText,
          };
        });
        const calls = await page.evaluate(() => window.__CAPABILITIES__.calls);
        if (stateName === "built-in") {
          assert.equal(state.cards.length, 1);
          assert.equal(state.cards[0].id, "standard");
          assert.equal(state.cards[0].broken, false);
          assert.equal(state.cards[0].view.disabled, false);
          assert.equal(state.creator, null);
          // The unchanged official guidance must remain usable by keyboard.
          for (const label of state.helpLabels) {
            const selector = `button[aria-label^=${JSON.stringify(label + ":")}]`;
            assert.equal(await page.$eval(selector, button => button.disabled), false);
            await page.focus(selector); await page.keyboard.press("Enter");
            await page.waitForSelector('[role="dialog"]', { visible: true });
            assert.ok((await page.$eval('[role="dialog"]', element => element.textContent)).length > 100);
            await page.keyboard.press("Escape");
            await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
          }
          // Read one real official declaration in the unchanged viewer.
          await page.evaluate(() => {
            const card = document.querySelector('li[data-agent-preset-id="standard"]');
            card.querySelector('button[data-tip]').click();
          });
          await page.waitForSelector('[role="dialog"]', { visible: true });
          const documentText = await page.$eval('[role="dialog"] pre', element => element.textContent);
          assert.ok(documentText.includes("- id: persona"), "official declaration content rendered");
          assert.ok(documentText.includes("name: '@deepseek-ai/dsh-persona'"), "official declaration plugin name rendered");
          await page.keyboard.press("Escape");
          await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
          assert.deepEqual(await page.evaluate(() => window.__CAPABILITIES__.calls), [{ endpoint: "agentPresets/read", args: { id: "standard" } }]);
        } else {
          assert.ok(/Failed to load|加载失败/.test(state.body), "official broken badge stays visible");
          assert.deepEqual(state.cards.map(card => card.id), ["standard", "ptc", "minimal", "cordis", "dsh-base-think"]);
          for (const card of state.cards.slice(0, 4)) {
            assert.equal(card.broken, true, `${card.id} stays a broken official card`);
            assert.equal(card.view.disabled, false, `${card.id} declaration stays readable`);
          }
          const think = state.cards.at(-1);
          assert.equal(think.broken, false);
          assert.equal(think.view.disabled, true);
          assert.equal(think.view.title, state.readUnavailable);
          assert.ok(state.body.includes(state.thinkName));
          assert.notEqual(state.creator, null, "Creator entry stays visible");
          assert.equal(state.creator.disabled, true, "Creator entry is disabled");
          assert.equal(state.creator.title, state.creatorUnavailable);
          // Broken cards and the fixed row's reader/creator cannot act by mouse.
          await page.evaluate(() => {
            for (const card of document.querySelectorAll("li[data-agent-preset-id]")) {
              card.querySelector("button[aria-pressed]")?.click();
              if (card.dataset.agentPresetId === "dsh-base-think") card.querySelector("button[data-tip]")?.click();
            }
            const creator = [...document.querySelectorAll("button")].find(button => button.textContent?.trim() === window.__CAPABILITIES__.t("creatorDraft"));
            creator?.click();
          });
          // …or by Enter/Space on the focused unavailable controls.
          await page.evaluate(() => {
            for (const card of document.querySelectorAll("li[data-agent-preset-id]")) {
              const target = card.querySelector("button[aria-pressed]") ?? card.querySelector("button");
              target.focus();
              target.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
              target.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
              if (card.dataset.agentPresetId === "dsh-base-think") {
                const view = card.querySelector("button[data-tip]");
                view.focus();
                view.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
              }
            }
            const creator = [...document.querySelectorAll("button")].find(button => button.textContent?.trim() === window.__CAPABILITIES__.t("creatorDraft"));
            if (creator !== undefined) {
              creator.focus();
              creator.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
            }
          });
          assert.deepEqual(await page.evaluate(() => window.__CAPABILITIES__.calls), [], "unavailable preset actions cannot call the controller");
          // The fork keeps the complete declared roster for the composer; the
          // three/five-row Coding Tools filter and real menu are exercised by
          // the full local UI acceptance.
          const seatLabel = await page.evaluate(() => window.__CAPABILITIES__.seatState.current);
          assert.equal(seatLabel, "dsh-base-think");
          const menuItems = await page.evaluate(() => window.__CAPABILITIES__.seatState.options.map(option => option.id));
          assert.deepEqual(menuItems, ["standard", "ptc", "minimal", "cordis", "dsh-base-think"]);
        }
      }
      assert.deepEqual(fixture.errors, [], `${name}: browser errors`);
      await page.close();
    }
    // Platform availability is a tracked visual deviation from the official
    // red broken card: assert the adapted fork's neutral gray state directly.
    if (surface === "agent-preset" && stateName === "broken") {
      const gray = await open(locale, "agent-preset", "adapted", "default");
      try {
        const cards = await gray.page.$$eval("li[data-agent-preset-id]", elements => elements.map(element => ({
          id: element.dataset.agentPresetId,
          availability: element.dataset.availability,
          alert: element.querySelector('[role="alert"]') !== null,
          text: element.textContent ?? "",
          className: element.className,
          pressed: element.querySelector('button[aria-pressed]')?.getAttribute("aria-disabled"),
        })));
        assert.deepEqual(cards.map(card => card.id), ["standard", "ptc", "minimal", "cordis", "dsh-base-think"]);
        for (const card of cards.slice(0, 4)) {
          assert.equal(card.availability, "unavailable");
          assert.equal(card.alert, false, `${locale}:${card.id}: platform limitation must not be role=alert`);
          assert.match(card.className, /cardUnavailable/u);
          assert.doesNotMatch(card.className, /cardBroken/u);
          assert.ok(card.text.includes("Unavailable") || card.text.includes("不可用"), `${locale}:${card.id}: localized unavailable reason missing`);
          assert.equal(card.pressed, "true");
        }
        assert.equal(cards.at(-1).availability, "available");
        const grayShot = await gray.page.screenshot({ path: resolve(output, `agent-preset-unavailable-${locale}-adapted.png`), captureBeyondViewport: false });
        cases.push({ locale, surface: "agent-preset", state: "unavailable", screenshotSha256: createHash("sha256").update(grayShot).digest("hex"), interaction: "platform unavailable gray cards, no role=alert, declaration/guide viewer untouched" });
      } finally {
        await gray.page.close();
      }
    }
    cases.push({ locale, surface, state: stateName, screenshotSha256: createHash("sha256").update(a).digest("hex"), interaction: surface === "directory" ? "rejection retains draft; retry preserves args; chosen directory returned" : "official declarations readable; broken cards, fixed reader and Creator unavailable by pointer/keyboard; composer keeps the runnable fixed mode" });
  }
  const lock = JSON.parse(await readFile(resolve(app, "../../dsh-source.lock.json"), "utf8"));
  await writeFile(resolve(output, "host-capabilities-report.json"), JSON.stringify({ ok: true, upstream: lock.commit, scope: "Official directory browser, actual named fixed preset, and separate built-in-reference guide interaction over controlled fixtures. The built-in guide case does not claim that the Workers fixed preset implements official Standard. Not a whole-app or persistent Host test.", cases }, null, 2));
  console.log(`directory/preset official reference: ${cases.length} Chromium cases passed`);
} finally { await closeAcceptanceBrowser(browser); await server?.close(); }
