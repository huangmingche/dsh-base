import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../../..");
const Excel = createRequire(resolve(root, "apps/web/package.json"))("exceljs");
const hostTests = resolve(root, "packages/cloudflare-worker/dsh-base-cloudflare-worker-session-host/tests");

export async function checkWorkspaceWorkbook(page) {
  const workbook = new Excel.Workbook();
  const sheet = workbook.addWorksheet("Workspace");
  const rows = 2000;
  for (let row = 1; row <= rows; row++) {
    // Unique cell contents keep the compressed XLSX above the binary page size.
    const contents = Array.from({ length: 8 }, (_, col) =>
      createHash("sha512").update(`${row}/${col}`).digest("hex")).join("");
    sheet.addRow([row, contents]);
  }
  const original = Buffer.from(await workbook.xlsx.writeBuffer());
  assert.ok(original.length > 1024 * 1024, "The fixture must cross the first binary page");
  const read = spawnSync(process.execPath, [
    "--import", resolve(hostTests, "official-runtime-hook.mjs"), "--experimental-strip-types",
    resolve(hostTests, "workspace-file-roundtrip.ts"),
  ], { cwd: root, input: original, maxBuffer: original.length + 1024 * 1024 });
  if (read.error) throw read.error;
  assert.equal(read.status, 0, read.stderr.toString());
  assert.deepEqual(read.stdout, original, "Reading a complete workspace file must preserve every byte");
  const parsed = await page.evaluate(async (base64, lastRow) => {
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    const { sheets } = await window.parseWorkbook(bytes);
    const cells = sheets[0].celldata;
    return {
      sheet: sheets[0].name,
      rows: cells.filter(cell => cell.c === 0).length,
      last: cells.find(cell => cell.r === lastRow - 1 && cell.c === 0)?.v.v,
    };
  }, read.stdout.toString("base64"), rows);
  assert.deepEqual(parsed, { sheet: "Workspace", rows, last: rows });
}
