import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Exercise the shipping parser with the exact independent-writer fixtures from the pinned DSH release. */
export async function checkOfficialWorkbooks(page, root) {
  const fixtures = join(root, ".submodules/deepseek-harness/packages/client/ui-sidebar-documentpreview/tests/fixtures");
  const parse = async (group, name) => {
    const bytes = await readFile(join(fixtures, group, name + ".xlsx"));
    return page.evaluate(data => window.parseWorkbook(data), Array.from(bytes));
  };
  const opc = ["comments", "table", "prefix", "part-name", "relative", "combined"];
  for (const name of opc) {
    const parsed = await parse("excel-opc", name);
    const sheet = parsed.sheets.find(sheet => sheet.name === "数据");
    assert.equal(sheet?.celldata.find(cell => cell.r === 0 && cell.c === 0)?.v.v, "Item", name);
    assert.equal(sheet.celldata.find(cell => cell.r === 1 && cell.c === 1)?.v.v, 42, name);
  }
  const reference = await parse("excel-xml", "rich");
  assert.equal(reference.sheets[0].celldata.find(cell => cell.r === 1 && cell.c === 1)?.v.v, 42);
  const equivalent = ["utf16-sheet", "utf16-metadata", "workbook-path", "styles-path", "strings-path", "cdata", "parts-path"];
  for (const name of equivalent) assert.deepEqual(await parse("excel-xml", name), reference, name);
  return { opc, equivalent: ["rich", ...equivalent] };
}

export async function checkReadOnlyWorkbook(page, bytes) {
  await page.evaluate(data => window.renderWorkbook(data), bytes);
  await page.waitForSelector("[data-excel-preview] canvas", { visible: true });
  const tabSelector = "[data-excel-preview] .luckysheet-sheets-item";
  await page.waitForFunction(selector => [...document.querySelectorAll(selector)].length === 2, {}, tabSelector);
  const tabs = await page.$$(tabSelector);
  assert.deepEqual(await Promise.all(tabs.map(tab => tab.evaluate(node => node.innerText.trim()))), ["Example", "Second"]);
  await tabs[1].click();
  await page.waitForFunction(() => document.querySelector("[data-excel-preview] .fortune-fx-input")?.textContent === "Selected second sheet");
  assert.equal(await page.$eval("[data-excel-preview] .fortune-fx-input", input => input.isContentEditable), false);
}
