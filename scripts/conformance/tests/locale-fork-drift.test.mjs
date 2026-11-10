/** Fork must be pinned official + exactly the registered source edits. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { APPROVED_EDITS, verifyLocaleFork } from "../check-locale-fork-drift.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const OFFICIAL_INDEX = [
  "import { createLanguageRowStore } from './settings-store.ts'",
  "",
  "export type { LanguageOptionRow, LanguageRowState } from './settings-store.ts'",
  "export type { CommonKey } from '../locales/index.ts'",
  "",
  "const METADATA = {",
  "  zh: { label: '中文', fallback: 'en' },",
  "} as const",
  "export const inject = ['slots', 'remote', 'configForms']",
  "export function apply(ctx) {",
  "  ctx.slots.installLocale(locale)",
  "}",
  "",
].join("\n");
const OFFICIAL_OTHER = "export const zhDict = { hello: '你好' };\n";

/** Build a minimal official + fork tree with optional mutations. */
function fixture(t, { forkIndex, officialIndex = OFFICIAL_INDEX, officialOther = OFFICIAL_OTHER, forkOther = OFFICIAL_OTHER, extraFile = false, missingFile = false }) {
  const root = mkdtempSync(join(tmpdir(), "dsh-locale-fork-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const official = join(root, "official");
  const fork = join(root, "fork");
  mkdirSync(join(official, "client"), { recursive: true });
  mkdirSync(join(official, "locales"), { recursive: true });
  mkdirSync(join(fork, "client"), { recursive: true });
  mkdirSync(join(fork, "locales"), { recursive: true });
  writeFileSync(join(official, "client/index.ts"), officialIndex);
  writeFileSync(join(official, "locales/zh.ts"), officialOther);
  const approved = APPROVED_EDITS.reduce((text, edit) => text.replace(edit.from, edit.to), officialIndex);
  writeFileSync(join(fork, "client/index.ts"), forkIndex ?? approved);
  if (!missingFile) writeFileSync(join(fork, "locales/zh.ts"), forkOther);
  if (extraFile) writeFileSync(join(fork, "client/extra.ts"), "export {};\n");
  return { forkSrc: join(fork), officialSrc: join(official) };
}

const verify = (paths, overrides = {}) => verifyLocaleFork({
  ...paths,
  pinCommit: "66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db",
  forkCommit: "66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db",
  forkPackage: "@deepseek-ai/dsh-client-locale",
  forkPath: "packages/client/locale",
  ...overrides,
});

test("the repository fork equals the pinned official package plus the approved edits", () => {
  const manifest = JSON.parse(readFileSync(join(repoRoot, "packages/client/dsh-base-client-locale-label/package.json"), "utf8"));
  const pinCommit = JSON.parse(readFileSync(join(repoRoot, "dsh-source.lock.json"), "utf8")).commit;
  const errors = verifyLocaleFork({
    forkSrc: join(repoRoot, "packages/client/dsh-base-client-locale-label/src"),
    officialSrc: join(repoRoot, ".submodules/deepseek-harness/packages/client/locale/src"),
    pinCommit,
    forkCommit: manifest.dshBase?.forkOf?.commit,
    forkPackage: manifest.dshBase?.forkOf?.package,
    forkPath: manifest.dshBase?.forkOf?.path,
  });
  assert.deepEqual(errors, []);
  assert.equal(manifest.dshBase?.reuse?.mode, "fork", "reuse.mode must stay fork");
  assert.deepEqual(manifest.dshBase?.reuse?.official, ["@deepseek-ai/dsh-client-locale"]);
});

test("an unapproved source difference is rejected", t => {
  const paths = fixture(t, { forkOther: "export const zhDict = { hello: '你好', leaked: true };\n" });
  const errors = verify(paths);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /unapproved difference in src\/locales\/zh\.ts/u);
});

test('omitting any required site-title seam edit fails the exact source guard', t => {
  const approved = APPROVED_EDITS.reduce((text, edit) => text.replace(edit.from, edit.to), OFFICIAL_INDEX);
  for (const edit of APPROVED_EDITS.filter(edit => edit.name.startsWith('site-title-'))) {
    const errors = verify(fixture(t, { forkIndex: approved.replace(edit.to, edit.from) }));
    assert.ok(errors.some(error => error.includes('differs from "pinned official + approved edits"')), edit.name);
  }
});

test("an unapproved edit inside the forked index is rejected", t => {
  const mutated = APPROVED_EDITS.reduce((text, edit) => text.replace(edit.from, edit.to), OFFICIAL_INDEX).replace("} as const", "  extra: true,\n} as const");
  const errors = verify(fixture(t, { forkIndex: mutated }));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /src\/client\/index\.ts differs from "pinned official \+ approved edits"/u);
});

test("a missing or extra fork file is rejected", t => {
  assert.match(verify(fixture(t, { missingFile: true }))[0], /fork is missing official file src\/locales\/zh\.ts/u);
  assert.match(verify(fixture(t, { extraFile: true }))[0], /fork has file src\/client\/extra\.ts/u);
});

test("an official change that breaks an approved edit anchor fails closed", t => {
  const officialIndex = OFFICIAL_INDEX.replace("zh: { label: '中文', fallback: 'en' }", "zh: { label: '中文（中国）', fallback: 'en' }");
  const errors = verify(fixture(t, { officialIndex, forkIndex: null }));
  assert.ok(errors.some(error => /approved edit "zh-display-label" matched 0 times/u.test(error)), errors.join("\n"));
});

test("a fork registration committed to another pin is rejected", t => {
  const errors = verify(fixture(t, {}), { forkCommit: "9dd9e8725d058ca94d58af537f9d9ad21bab88dc" });
  assert.ok(errors.some(error => /does not match the pinned commit/u.test(error)), errors.join("\n"));
});
