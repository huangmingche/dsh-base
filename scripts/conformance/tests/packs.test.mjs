import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { repoRoot } from "../lib.mjs";
import { canonicalAgentRows, canonicalClientRows, canonicalWorkerRows } from "../canonical-roster.mjs";
import { generateClientComposition, readClientComposition } from "../../composition/client.mjs";
import {
  auditPacks, auditToggleablePacks, readAgentRows, readClientRows, readPackManifests, readWorkerRows,
} from "../../composition/packs.mjs";

// The oracle is derived from package metadata, the composition profile and the
// pinned official inventory; it never reads packs/. Computing it once keeps the
// suite fast because it walks the official submodule.
const canonical = {
  client: canonicalClientRows(),
  worker: canonicalWorkerRows(),
  agent: canonicalAgentRows(),
};

const manifest = (id, overrides = {}) => ({
  id,
  planes: {},
  requires: [],
  config: {},
  toggleable: "none",
  uninstallImpact: "fixture pack; removal impact is documented here",
  reuse: { mode: "custom", official: [], reason: "fixture only" },
  ...overrides,
});

function fixture(t, packs) {
  const root = mkdtempSync(join(tmpdir(), "dsh-packs-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [directory, value] of Object.entries(packs)) {
    const dir = join(root, "packs", directory);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "pack.json"), JSON.stringify(value, null, 2));
  }
  return root;
}

test("pack manifests reproduce the canonical rosters row for row", () => {
  assert.deepEqual(readClientRows(), canonical.client);
  assert.deepEqual(readWorkerRows(), canonical.worker);
  assert.deepEqual(readAgentRows(), canonical.agent);
  assert.equal(generateClientComposition(readClientRows()), generateClientComposition(canonical.client));
});

test("the production client composition is pack-derived at the repository root", () => {
  assert.deepEqual(readClientComposition(), readClientRows());
});

test("roster order is stable: explicit order, then id; repeated reads agree", () => {
  for (const rows of [readClientRows(), readWorkerRows(), readAgentRows()]) {
    const sorted = [...rows].sort((left, right) => (left.order ?? 100) - (right.order ?? 100) || left.id.localeCompare(right.id));
    assert.deepEqual(rows, sorted);
  }
  assert.deepEqual(readClientRows(), readClientRows());
  assert.deepEqual(readWorkerRows(), readWorkerRows());
  assert.deepEqual(readAgentRows(), readAgentRows());
});

test("audit passes on the repository but detects coverage drift", () => {
  assert.equal(auditPacks(repoRoot, canonical).ok, true);

  const removed = canonical.worker[0];
  const missing = auditPacks(repoRoot, { ...canonical, worker: canonical.worker.slice(1) });
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.some(error => error === `worker: pack member ${removed.name} is absent from the canonical roster`), missing.errors.join("\n"));

  const absent = "@dsh-base/client-rightbar-extra";
  const extra = auditPacks(repoRoot, { ...canonical, client: canonical.client.filter(row => row.name !== absent) });
  assert.equal(extra.ok, false);
  assert.ok(extra.errors.some(error => error === `client: pack member ${absent} is absent from the canonical roster`), extra.errors.join("\n"));

  const phantom = { name: "@fixture/phantom", id: "client:phantom", origin: "custom", order: 1, module: "@fixture/phantom" };
  const covered = auditPacks(repoRoot, { ...canonical, client: [...canonical.client, phantom].sort((left, right) => (left.order ?? 100) - (right.order ?? 100) || left.id.localeCompare(right.id)) });
  assert.equal(covered.ok, false);
  assert.ok(covered.errors.some(error => error === `client: canonical member @fixture/phantom is absent from the pack rosters (packs: ai-chat-core, base, plugin-management)`), covered.errors.join("\n"));

  const orderDrift = canonical.client.map((row, index) => index === 0 ? { ...row, order: 999 } : row).sort((left, right) => (left.order ?? 100) - (right.order ?? 100) || left.id.localeCompare(right.id));
  const drift = auditPacks(repoRoot, { ...canonical, client: orderDrift });
  assert.equal(drift.ok, false);
  assert.ok(drift.errors.some(error => /^client: roster differs from the canonical roster at row \d+/u.test(error)), drift.errors.join("\n"));
});

test("an L1 pack may not contain a CLIENT_PLUGIN_POLICY.required member", () => {
  const required = ["@dsh-base/client-plugin-management"];
  const toggleable = manifest("toggleable-core", { planes: { client: ["@dsh-base/client-plugin-management"] }, toggleable: "L1" });
  const violation = auditToggleablePacks([toggleable], required);
  assert.equal(violation.length, 1);
  assert.match(violation[0], /toggleable-core/u);
  assert.match(violation[0], /@dsh-base\/client-plugin-management/u);
  const optionalOnly = auditToggleablePacks([manifest("optional", { planes: { client: ["@dsh-base/client-gateway-provider"] }, toggleable: "L1" })], required);
  assert.deepEqual(optionalOnly, []);
  assert.deepEqual(auditToggleablePacks([manifest("core", { planes: { client: required } })], required), []);
});

test("the loader fails closed on missing, duplicate, empty and broken packs", async t => {
  await t.test("missing packs/ directory", () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-packs-empty-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    assert.throws(() => readPackManifests(root), /capability-pack manifests are required/u);
    assert.throws(() => readClientRows(root), /capability-pack manifests are required/u);
  });
  await t.test("missing pack.json", () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-packs-missing-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, "packs", "broken"), { recursive: true });
    assert.throws(() => readPackManifests(root), /packs\/broken\/pack\.json is missing/u);
  });
  await t.test("duplicate pack id", () => {
    const root = fixture(t, { first: manifest("same", { planes: { worker: ["@dsh-base/cloudflare-worker-seo"] } }), second: manifest("same", { planes: { worker: ["@dsh-base/cloudflare-worker-seo"] } }) });
    assert.throws(() => readPackManifests(root), /duplicate pack id: same/u);
  });
  await t.test("declared but empty plane", () => {
    const root = fixture(t, { empty: manifest("empty", { planes: { client: [] } }) });
    assert.throws(() => readPackManifests(root), /planes\.client is declared empty; omit the plane instead/u);
  });
  await t.test("duplicate member across packs", () => {
    const root = fixture(t, {
      first: manifest("first", { planes: { client: ["@fixture/shared"] } }),
      second: manifest("second", { planes: { client: ["@fixture/shared"] } }),
    });
    assert.throws(() => readPackManifests(root), /client member @fixture\/shared is already in pack first/u);
  });
  await t.test("unknown requires target", () => {
    const root = fixture(t, { first: manifest("first", { planes: { worker: ["@dsh-base/cloudflare-worker-seo"] }, requires: ["ghost"] }) });
    assert.throws(() => readPackManifests(root), /requires unknown pack ghost/u);
  });
  await t.test("dependency cycle", () => {
    const root = fixture(t, {
      first: manifest("first", { planes: { worker: ["@dsh-base/cloudflare-worker-control"] }, requires: ["second"] }),
      second: manifest("second", { planes: { worker: ["@dsh-base/cloudflare-worker-seo"] }, requires: ["first"] }),
    });
    assert.throws(() => readPackManifests(root), /pack dependency cycle/u);
  });
  await t.test("pack without any plane member", () => {
    const root = fixture(t, { pack: manifest("pack") });
    assert.throws(() => readPackManifests(root), /pack declares no plane members/u);
  });
  await t.test("invalid toggleable value", () => {
    const root = fixture(t, { pack: manifest("pack", { toggleable: "L3" }) });
    assert.throws(() => readPackManifests(root), /toggleable must be L1 or none/u);
  });
  await t.test("missing uninstallImpact", () => {
    const root = fixture(t, { pack: { ...manifest("pack"), uninstallImpact: "" } });
    assert.throws(() => readPackManifests(root), /uninstallImpact/u);
  });
  await t.test("member without package metadata", () => {
    const root = fixture(t, { pack: manifest("pack", { planes: { client: ["@fixture/unknown"] } }) });
    assert.throws(() => readClientRows(root), /client member @fixture\/unknown has no dshBase\.client metadata/u);
  });
  await t.test("client object without id", () => {
    const root = fixture(t, { pack: manifest("pack", { planes: { client: [{ name: "@fixture/unknown" }] } }) });
    assert.throws(() => readClientRows(root), /client object @fixture\/unknown needs id/u);
  });
  await t.test("client object with a non-finite order", () => {
    const root = fixture(t, { pack: manifest("pack", { planes: { client: [{ name: "@fixture/unknown", id: "client:unknown", order: "first" }] } }) });
    assert.throws(() => readClientRows(root), /order must be a finite number/u);
  });
});
