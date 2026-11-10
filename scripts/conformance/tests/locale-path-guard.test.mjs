/** LP0 guard: one prefix implementation, no hand-written literals, consumers wired. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { auditLocalePath } from "../check-locale-path.mjs";

const MODULE_SOURCE = "export const LOCALE_IDS = ['zh','en'] as const;\n";

function fixture(t, { files = {}, consumers = [], consumerSource = "", withModule = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "dsh-locale-path-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  if (withModule) {
    mkdirSync(join(root, "packages/boot/dsh-base-locale-path/src"), { recursive: true });
    writeFileSync(join(root, "packages/boot/dsh-base-locale-path/src/index.ts"), MODULE_SOURCE);
  }
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  for (const consumer of consumers) {
    mkdirSync(join(root, consumer, "src"), { recursive: true });
    writeFileSync(join(root, consumer, "src/index.ts"), consumerSource);
  }
  return root;
}

const CONSUMER_SEO = "packages/cloudflare-worker/dsh-base-cloudflare-worker-seo";
const CONSUMER_URL = "packages/client/dsh-base-client-locale-url";
const CONSUMER_PENDING = "packages/client/dsh-base-client-pending";
const consumers = [
  { path: CONSUMER_SEO, pendingFor: null },
  { path: CONSUMER_URL, pendingFor: "P4b" },
  { path: CONSUMER_PENDING, pendingFor: "P5" },
];

test("a clean tree with no consumers has no violations", t => {
  const root = fixture(t, { files: { "packages/x/src/page.ts": "export const title = 'ok';\n" } });
  const result = auditLocalePath({ root, consumers: [] });
  assert.deepEqual(result.errors, []);
});

test("a hand-written locale prefix literal is a violation", t => {
  const root = fixture(t, { files: { "packages/x/src/page.ts": "export const path = '/zh/app/session/1';\n" } });
  const result = auditLocalePath({ root, consumers: [] });
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /hand-written locale prefix "\/zh"/u);
  assert.match(result.errors[0], /packages\/x\/src\/page\.ts/u);
});

test("a hand-written /zh-CN literal is a violation", t => {
  const root = fixture(t, { files: { "packages/x/src/page.ts": "export const legacy = \"/zh-CN\";\n" } });
  const result = auditLocalePath({ root, consumers: [] });
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /hand-written locale prefix "\/zh-CN"/u);
});

test("a second localizePath/stripLocale implementation is a violation", t => {
  const root = fixture(t, { files: { "packages/x/src/page.ts": "export function stripLocale(path: string) { return path }\n" } });
  const result = auditLocalePath({ root, consumers: [] });
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /defines its own stripLocale\(\)/u);
});

test("prefix literals in comments are not violations, code literals are", t => {
  const root = fixture(t, { files: { "packages/x/src/page.ts": "// legacy /zh-CN stays out of the code\nexport const clean = '/docs';\n" } });
  const result = auditLocalePath({ root, consumers: [] });
  assert.deepEqual(result.errors, []);
});

test("an existing consumer without the shared import is a violation; a missing consumer is pending", t => {
  const withImport = fixture(t, { consumers: [CONSUMER_SEO], consumerSource: "import { localizePath } from '../../../boot/dsh-base-locale-path/src/index.ts';\n" });
  assert.deepEqual(auditLocalePath({ root: withImport, consumers }).errors, []);
  assert.deepEqual(auditLocalePath({ root: withImport, consumers }).pendingConsumers, [
    { path: CONSUMER_URL, pendingFor: "P4b" },
    { path: CONSUMER_PENDING, pendingFor: "P5" },
  ]);

  const noImport = fixture(t, { consumers: [CONSUMER_SEO], consumerSource: "export const x = 1;\n" });
  const errors = auditLocalePath({ root: noImport, consumers }).errors;
  assert.equal(errors.length, 1);
  assert.match(errors[0], /must import @dsh-base\/locale-path/u);
});

test("a pending consumer must be bound to a card, not left as a permanent exemption", t => {
  const root = fixture(t, { consumers: [CONSUMER_SEO], consumerSource: "import x from '../../../boot/dsh-base-locale-path/src/index.ts';\n" });
  const unbound = auditLocalePath({ root, consumers: [CONSUMER_SEO, CONSUMER_URL] });
  assert.equal(unbound.errors.length, 1);
  assert.match(unbound.errors[0], /not bound to a card/u);
  assert.deepEqual(unbound.pendingConsumers, []);
});

test("the retired bare /zh path in an acceptance script is a violation unless allowlisted", t => {
  const root = fixture(t, { files: { "apps/web/scripts/acceptance-x.mjs": "await page.goto(`${base}${locale === 'zh' ? '/zh' : ''}/app/session/${id}`);\n" } });
  const rejected = auditLocalePath({ root, consumers: [] });
  assert.equal(rejected.errors.length, 1);
  assert.match(rejected.errors[0], /acceptance-x\.mjs:\d+: hand-written locale prefix "\/zh"/u);
  assert.equal(rejected.scannedScripts, 1);

  const annotatedRoot = fixture(t, { files: { "apps/web/scripts/acceptance-x.mjs": "// locale-path:allow retired path must stay inert\nexport const retired = '/zh/app/session/1';\n" } });
  const annotated = auditLocalePath({ root: annotatedRoot, consumers: [] });
  assert.deepEqual(annotated.errors, [], "an annotated inertness assertion is allowed");
  assert.equal(annotated.scriptExceptions, 1, "the guard counts annotated exceptions");

  const inlineRoot = fixture(t, { files: { "apps/web/scripts/acceptance-z.mjs": "export const canonical = '/zh-CN/app/session/1'; // locale-path:allow canonical spelling probe\n" } });
  const inline = auditLocalePath({ root: inlineRoot, consumers: [] });
  assert.deepEqual(inline.errors, [], "an inline annotation permits one literal");
  assert.equal(inline.scriptExceptions, 1);
});

test("gitignored generated sources are skipped by the guard", t => {
  const root = fixture(t, { files: {
    ".gitignore": "packages/x/src/generated.ts\n",
    "packages/x/src/generated.ts": "export const prefix = '/ja/app/session/1';\n",
  } });
  const init = spawnSync("git", ["-C", root, "init", "-q"]);
  if (init.status !== 0) { t.skip("git is unavailable"); return; }
  const result = auditLocalePath({ root, consumers: [] });
  assert.deepEqual(result.errors, [], "a gitignored generated literal must not fail the guard");
  assert.equal(result.ignoredSources, 1);
});

test("the real repository has one implementation and no literals", () => {
  const result = auditLocalePath({ root: new URL("../../..", import.meta.url).pathname.replace(/\/$/u, "") });
  assert.deepEqual(result.errors, []);
  assert.ok(result.scanned > 100, `expected many production source files, scanned ${result.scanned}`);
});
