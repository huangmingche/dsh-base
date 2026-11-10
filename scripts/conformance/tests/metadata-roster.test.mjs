import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { repoRoot } from "../lib.mjs";
import { readClientMetadataRows, readWorkerMetadataRows, readAgentMetadataRows } from "../../composition/metadata-roster.mjs";
import { auditPacks } from "../../composition/packs.mjs";

const workerName = name => `@dsh-base/cloudflare-worker-${name}`;
const agentName = name => `@dsh-base/cloudflare-think-${name}`;
const moduleSource = (symbol, marker) => `data:text/javascript,${encodeURIComponent(`export const ${symbol} = ${JSON.stringify(marker)};`)}`;

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "dsh-metadata-roster-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path, value) => {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, typeof value === "string" ? value : JSON.stringify(value));
  };
  // Copy the actual production scripts unchanged. Their import.meta.url-based
  // root now points at the fixture, so no repository output is ever written.
  for (const path of [
    "scripts/composition/generate-worker-composition.mjs",
    "scripts/composition/generate-agent-composition.mjs",
    "scripts/composition/metadata-roster.mjs",
    "scripts/composition/think-composition.mjs",
    "scripts/composition/project-context.mjs", "scripts/composition/applications.mjs",
    "scripts/build/product-paths.mjs",
    "scripts/conformance/lib.mjs",
  ]) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    copyFileSync(join(repoRoot, path), join(root, path));
  }
  for (const path of ["apps/web/src/worker", "apps/web/src/agent", "packages/cloudflare-worker", "packages/cloudflare-think"]) {
    mkdirSync(join(root, path), { recursive: true });
  }
  write("package.json", { type: "module" });
  // Only the loader's unrelated string brand is stubbed. The generated plugin
  // imports, exported rosters and module resolvers all execute unchanged.
  write("node_modules/@dsh-base/plugin-loader-static/package.json", {
    name: "@dsh-base/plugin-loader-static", type: "module", exports: "./index.js",
  });
  write("node_modules/@dsh-base/plugin-loader-static/index.js", "export const StaticPluginEntryId = value => value;\n");

  const worker = (name, overrides = {}) => {
    write(`packages/cloudflare-worker/${name}/package.json`, {
      name: workerName(name),
      dshBase: { worker: {
        id: `cloudflare:worker:${name}`, module: moduleSource("marker", name), origin: "custom", order: 10,
        ...overrides,
      } },
    });
  };
  const agent = (name, overrides = {}) => {
    write(`packages/cloudflare-think/${name}/package.json`, {
      name: agentName(name),
      dshBase: { agent: {
        id: `cloudflare:think:${name}`, module: moduleSource("plugin", name), export: "plugin", order: 10,
        ...overrides,
      } },
    });
  };
  worker("alpha"); worker("beta", { order: 20 });
  agent("alpha"); agent("beta", { order: 20 });

  let generation = 0;
  const generate = async plane => {
    const script = `scripts/composition/generate-${plane}-composition.mjs`;
    const result = spawnSync(process.execPath, [join(root, script)], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, `${script} failed:\n${result.stdout}\n${result.stderr}`);
    const output = join(root, "apps/web/src", plane, "generated-composition.ts");
    const source = readFileSync(output, "utf8");
    const generated = await import(`${pathToFileURL(output).href}?generation=${++generation}`);
    return { source, generated };
  };
  const production = () => ({
    client: readClientMetadataRows(root), worker: readWorkerMetadataRows(root), agent: readAgentMetadataRows(root),
  });
  const pack = () => write("packs/base/pack.json", {
    id: "base", planes: {
      worker: [workerName("alpha"), workerName("beta")],
      think: [agentName("alpha"), agentName("beta")],
    },
    requires: [], config: {}, toggleable: "none", uninstallImpact: "Fixture capability removal.",
    reuse: { mode: "custom", official: [], reason: "Local test fixture without upstream implementation." },
  });
  return { root, worker, agent, generate, production, pack };
}

test("the actual Worker generator consumes metadata module, id, origin and ordering without packs", async t => {
  const f = fixture(t);
  const before = await f.generate("worker");
  assert.deepEqual(before.generated.workerComposition.entries, [
    { id: "cloudflare:worker:alpha", name: workerName("alpha"), origin: "custom", disabled: false },
    { id: "cloudflare:worker:beta", name: workerName("beta"), origin: "custom", disabled: false },
  ]);
  assert.equal((await before.generated.workerComposition.modules[workerName("alpha")].load()).marker, "alpha");

  f.worker("alpha", {
    id: "cloudflare:worker:alpha-revised", module: moduleSource("marker", "revised worker"), origin: "fork", order: 30,
  });
  const after = await f.generate("worker");
  assert.notEqual(after.source, before.source);
  assert.deepEqual(after.generated.workerComposition.entries, [
    { id: "cloudflare:worker:beta", name: workerName("beta"), origin: "custom", disabled: false },
    { id: "cloudflare:worker:alpha-revised", name: workerName("alpha"), origin: "fork", disabled: false },
  ]);
  assert.equal((await after.generated.workerComposition.modules[workerName("alpha")].load()).marker, "revised worker");
});

test("the actual Think generator consumes metadata module, export, id and ordering without packs", async t => {
  const f = fixture(t);
  const before = await f.generate("agent");
  assert.deepEqual(before.generated.agentPlugins, ["alpha", "beta"]);

  f.agent("alpha", {
    id: "cloudflare:think:alpha-revised", module: moduleSource("revisedPlugin", "revised agent"), export: "revisedPlugin", order: 30,
  });
  const after = await f.generate("agent");
  assert.notEqual(after.source, before.source);
  assert.deepEqual(after.generated.agentPlugins, ["beta", "revised agent"]);
  assert.match(after.source, /import \{ revisedPlugin as plugin1 \}/u);
  assert.match(after.source, /\/\/ cloudflare:think:alpha-revised/u);
  assert.doesNotMatch(after.source, /\/\/ cloudflare:think:alpha\n/u);
});

for (const plane of ["worker", "agent"]) {
  test(`new ${plane} metadata drives the actual generator while a stale pack projection fails audit`, async t => {
    const f = fixture(t);
    f.pack();
    assert.equal(auditPacks(f.root, f.production()).ok, true);
    const packPath = join(f.root, "packs/base/pack.json");
    const priorPack = readFileSync(packPath, "utf8");
    const before = await f.generate(plane);

    // Adding a package without updating the capability grouping must still
    // reach production generation. The separate audit then blocks release.
    f[plane]("new-capability", { order: 5 });
    const after = await f.generate(plane);
    assert.notEqual(after.source, before.source);
    if (plane === "worker") {
      assert.deepEqual(after.generated.workerComposition.entries.map(row => row.name), [
        workerName("new-capability"), workerName("alpha"), workerName("beta"),
      ]);
      assert.equal((await after.generated.workerComposition.modules[workerName("new-capability")].load()).marker, "new-capability");
    } else {
      assert.deepEqual(after.generated.agentPlugins, ["new-capability", "alpha", "beta"]);
    }
    assert.equal(readFileSync(packPath, "utf8"), priorPack, "the pack fixture must remain stale");
    const audit = auditPacks(f.root, f.production());
    const name = plane === "worker" ? workerName("new-capability") : agentName("new-capability");
    const auditPlane = plane === "worker" ? "worker" : "think";
    assert.equal(audit.ok, false);
    assert.ok(audit.errors.some(error => error.startsWith(`${auditPlane}: canonical member ${name} is absent from the pack rosters`)), audit.errors.join("\n"));
  });
}
