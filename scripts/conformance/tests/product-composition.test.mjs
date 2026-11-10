import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { productOutputPath, projectContext, verifyProject } from "../../composition/project-context.mjs";
import { localPackages, officialPackages } from "../lib.mjs";
import { readClientMetadataRows, readWorkerMetadataRows, readAgentMetadataRows } from "../../composition/metadata-roster.mjs";
import { auditPacks, readPackManifests } from "../../composition/packs.mjs";
import { checkBoundaries } from "../check-plugin-boundaries.mjs";
import { checkOfficialReuse } from "../check-official-reuse.mjs";
import { checkOfficialUiCoverage } from "../check-official-ui-coverage.mjs";

const reuse = { mode: "custom", official: [], reason: "Product-specific behavior has no official equivalent to mount or fork." };
const snapshot = root => Object.fromEntries(readdirSync(root, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => {
  const path = join(entry.parentPath, entry.name);
  return [path.slice(root.length), readFileSync(path, "utf8")];
}));

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "dsh-product-composition-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const base = join(root, ".submodules/dsh-base");
  const write = (path, value) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value));
  };
  write(join(root, "dsh.project.json"), { version: 1, base: ".submodules/dsh-base", namespace: "my-product" });
  write(join(base, "dsh-source.lock.json"), { commit: "a".repeat(40) });
  write(join(base, ".submodules/deepseek-harness/packages/client/ui/package.json"), {
    name: "@deepseek-ai/dsh-client-ui-sample", license: "MIT", exports: { "./client": "./src/client.ts" }, dsh: { client: { platform: "web" } },
  });
  write(join(base, "apps/web/composition.profile.json"), { client: [{
    name: "@deepseek-ai/dsh-client-ui-sample", id: "client:official:ui", origin: "upstream", order: 1, disabled: true,
  }] });
  const pkg = (owner, plane, suffix, changes = {}) => {
    const scope = owner === base ? "dsh-base" : "my-product";
    const prefix = { client: "client", worker: "cloudflare-worker", agent: "cloudflare-think" }[plane];
    const group = { client: "client", worker: "cloudflare-worker", agent: "cloudflare-think" }[plane];
    const name = `@${scope}/${prefix}-${suffix}`;
    const meta = { id: `${{ client: "client:", worker: "cloudflare:worker:", agent: "cloudflare:think:" }[plane]}${scope === "dsh-base" ? "" : `${scope}:`}${suffix}`, module: name, origin: "custom", order: 10, ...(plane === "agent" ? { export: "plugin" } : {}) };
    const manifest = { name, exports: { ".": "./src/index.ts", "./client": "./src/index.ts" }, ...(plane === "client" ? { dsh: { client: { platform: "web" } } } : {}), dshBase: { [plane]: meta, reuse }, ...changes };
    const path = join(owner, `packages/${group}/${suffix}`);
    write(join(path, "package.json"), manifest);
    write(join(path, "src/index.ts"), "export const Config = {}; export const plugin = {};\n");
    return { manifest, path, name };
  };
  const baseline = [pkg(base, "client", "core"), pkg(base, "worker", "core"), pkg(base, "agent", "core")];
  const pack = (owner, id, entries, changes = {}) => {
    const planes = {};
    for (const item of entries) {
      const key = item.manifest.dshBase.client ? "client" : item.manifest.dshBase.worker ? "worker" : "think";
      (planes[key] ??= []).push(item.name);
    }
    if (owner === base) planes.client.unshift({ name: "@deepseek-ai/dsh-client-ui-sample", id: "client:official:ui", origin: "upstream", order: 1, disabled: true, module: "@deepseek-ai/dsh-client-ui-sample" });
    write(join(owner, `packs/${id.replaceAll(":", "-")}/pack.json`), { id, planes, requires: [], config: {}, toggleable: "none", uninstallImpact: "Removing this pack removes its product capability.", reuse, ...changes });
  };
  pack(base, "base", baseline);
  return { root, base, write, pkg, pack, baseline };
}

const rosters = root => ({ client: readClientMetadataRows(root), worker: readWorkerMetadataRows(root), agent: readAgentMetadataRows(root) });

test("an empty consumer inherits the exact base rosters and only reads the nested official source", t => {
  const f = fixture(t), before = snapshot(f.base);
  assert.deepEqual(rosters(f.root), rosters(f.base));
  assert.deepEqual(readPackManifests(f.root), readPackManifests(f.base));
  assert.equal(auditPacks(f.root, rosters(f.root)).ok, true);
  assert.equal(projectContext(f.root).generatedRoot, join(f.root, ".artifacts/dsh"));
  assert.ok([...officialPackages(f.root).values()].every(entry => entry.path.startsWith(f.base)));
  assert.deepEqual(snapshot(f.base), before);
});

test("all three product planes extend composition, inventory ownership and packs without changing the base", t => {
  const f = fixture(t), before = snapshot(f.base);
  const additions = [f.pkg(f.root, "client", "feature"), f.pkg(f.root, "worker", "feature"), f.pkg(f.root, "agent", "feature")];
  f.pack(f.root, "my-product:feature", additions, { requires: ["base"] });
  const rows = rosters(f.root);
  for (const [plane, item] of ["client", "worker", "agent"].map((plane, index) => [plane, additions[index]])) assert.ok(rows[plane].some(row => row.name === item.name));
  assert.equal(localPackages(f.root).filter(entry => entry.ownerRoot === f.root).length, 3);
  assert.equal(auditPacks(f.root, rows).ok, true);
  assert.deepEqual(checkBoundaries(f.root).failures, []);
  assert.deepEqual(checkOfficialReuse(f.root).failures, []);
  assert.deepEqual(snapshot(f.base), before);
});

test("consumer profiles may configure only their own declared client identities", t => {
  const f = fixture(t), item = f.pkg(f.root, "client", "feature");
  const profile = rows => f.write(join(f.root, "apps/web/composition.profile.json"), { client: rows });
  profile([{ name: item.name, config: { enabled: true }, disabled: true }]);
  assert.deepEqual(readClientMetadataRows(f.root).find(row => row.name === item.name).config, { enabled: true });
  profile([{ name: f.baseline[0].name, disabled: true }]);
  assert.throws(() => readClientMetadataRows(f.root), /only its own/);
  profile([{ name: item.name, module: f.baseline[0].name }]);
  assert.throws(() => readClientMetadataRows(f.root), /cannot replace metadata module/);
});

test("package, composition and pack collisions and permission broadening fail closed", t => {
  const f = fixture(t), item = f.pkg(f.root, "client", "feature");
  f.pkg(f.root, "client", "duplicate", { ...item.manifest });
  assert.throws(() => localPackages(f.root), /duplicate local package name/);
  rmSync(join(f.root, "packages/client/duplicate"), { recursive: true });
  f.pack(f.root, "my-product:feature", [item], { toggleable: "L1" });
  assert.throws(() => readPackManifests(f.root), /deployment-owned/);
  f.pack(f.root, "my-product:feature", [f.baseline[0]]);
  assert.throws(() => readPackManifests(f.root), /only their own/);
  f.pack(f.root, "my-product:feature", [item]);
  f.pkg(f.root, "client", "duplicate", { ...item.manifest, name: "@my-product/client-second", dshBase: { ...item.manifest.dshBase, client: { ...item.manifest.dshBase.client, module: "@my-product/client-second" } } });
  assert.throws(() => readClientMetadataRows(f.root), /duplicate composition id/);
});

test("product packages cannot bypass their exports or cross runtime planes through either root", t => {
  const f = fixture(t), item = f.pkg(f.root, "client", "feature");
  f.write(join(item.path, "src/index.ts"), 'import "@dsh-base/cloudflare-worker-core"; import "@my-product/client-missing";');
  const failures = checkBoundaries(f.root).failures.join("\n");
  assert.match(failures, /imports worker package/);
  assert.match(failures, /unknown local package @my-product\/client-missing/);
  f.write(join(item.path, "package.json"), { ...item.manifest, dshBase: { ...item.manifest.dshBase, client: { ...item.manifest.dshBase.client, module: "@dsh-base/client-core" } } });
  assert.throws(() => localPackages(f.root), /own package/);
});

test("product build dependency packages use their own scope without gaining a runtime plane", t => {
  const f = fixture(t);
  f.write(join(f.root, "packages/build/product-server-dependencies/package.json"), { name: "@my-product/build-server-dependencies", dshBase: { build: { kind: "dependency-environment" }, reuse } });
  assert.deepEqual(checkBoundaries(f.root).failures, []);
});

test("consumer composition rejects a product fork replacing a disabled official plugin", t => {
  const f = fixture(t), name = "@deepseek-ai/dsh-client-ui-sample";
  f.write(join(f.base, ".submodules/deepseek-harness/packages/bundle/web-app/cordis.patch.yml"), `- insert:\n    - id: sample\n      name: '${name}'\n`);
  const item = f.pkg(f.root, "client", "replacement");
  f.write(join(item.path, "package.json"), { ...item.manifest, dshBase: {
    client: { ...item.manifest.dshBase.client, origin: "fork", replaces: name },
    reuse: { ...reuse, mode: "fork", official: [name] },
    forkOf: { package: name, path: "packages/client/ui", commit: "a".repeat(40), license: "MIT" },
  } });
  assert.throws(() => readClientMetadataRows(f.root), /product client composition is additive; replaces is not supported/);
  assert.throws(() => checkOfficialUiCoverage(f.root), /product client composition is additive; replaces is not supported/);
});

test("consumer metadata and profiles reject every explicit replacement value, including disabled entries", t => {
  const f = fixture(t), item = f.pkg(f.root, "client", "feature");
  for (const value of ["@deepseek-ai/dsh-client-ui-sample", "@dsh-base/client-core", "", " ", null, false, 0, {}, []]) {
    for (const disabled of [false, true]) {
      f.write(join(item.path, "package.json"), { ...item.manifest, dshBase: { ...item.manifest.dshBase,
        client: { ...item.manifest.dshBase.client, replaces: value, disabled },
      } });
      assert.throws(() => readClientMetadataRows(f.root), /product client composition is additive; replaces is not supported/);
      f.write(join(item.path, "package.json"), item.manifest);
      f.write(join(f.root, "apps/web/composition.profile.json"), { client: [{ name: item.name, replaces: value, disabled }] });
      assert.throws(() => readClientMetadataRows(f.root), /product client composition is additive; replaces is not supported/);
      f.write(join(f.root, "apps/web/composition.profile.json"), { client: [] });
    }
  }
  assert.ok(readClientMetadataRows(f.root).some(row => row.name === item.name && row.replaces === undefined));
});

test("consumer composition preserves reviewed base forks while adding custom and seam plugins", t => {
  const f = fixture(t), name = "@deepseek-ai/dsh-client-ui-sample";
  f.write(join(f.base, ".submodules/deepseek-harness/packages/bundle/web-app/cordis.patch.yml"), `- insert:\n    - id: sample\n      name: '${name}'\n`);
  const item = f.baseline[0];
  f.write(join(item.path, "package.json"), { ...item.manifest, dshBase: {
    client: { ...item.manifest.dshBase.client, origin: "fork", replaces: name },
    reuse: { ...reuse, mode: "fork", official: [name] },
    forkOf: { package: name, path: "packages/client/ui", commit: "a".repeat(40), license: "MIT" },
  } });
  const before = snapshot(f.base), added = f.pkg(f.root, "client", "feature"), seam = f.pkg(f.root, "client", "host-adapter");
  f.write(join(seam.path, "package.json"), { ...seam.manifest, dshBase: { ...seam.manifest.dshBase,
    reuse: { mode: "seam", official: [name], reason: "Provides the existing official Host service without replacing the official client identity." },
  } });
  f.pack(f.root, "my-product:feature", [added, seam], { requires: ["base"] });
  const rows = readClientMetadataRows(f.root);
  assert.deepEqual(rows.filter(row => ![added.name, seam.name].includes(row.name)), readClientMetadataRows(f.base));
  assert.ok([added.name, seam.name].every(name => rows.some(row => row.name === name && row.replaces === undefined)));
  assert.equal(rows.find(row => row.name === item.name).replaces, name);
  assert.equal(rows.find(row => row.name === name).disabled, true);
  assert.equal(auditPacks(f.root, rosters(f.root)).ok, true);
  assert.deepEqual(checkOfficialReuse(f.root).failures, []);
  assert.deepEqual(checkOfficialUiCoverage(f.root).failures, []);
  assert.deepEqual(snapshot(f.base), before);
  f.write(join(f.base, "apps/web/composition.profile.json"), { client: [{ name, id: "client:official:ui", origin: "upstream" }] });
  assert.match(checkOfficialUiCoverage(f.root).failures.join("\n"), /must remain disabled/);
});

test("consumer context rejects an escaping base and generated symlinks into the base", t => {
  const f = fixture(t);
  mkdirSync(join(f.root, ".artifacts"));
  symlinkSync(f.base, join(f.root, ".artifacts/dsh"));
  assert.throws(() => projectContext(f.root), /outside the read-only base/);
  rmSync(join(f.root, ".artifacts/dsh"));
  f.write(join(f.root, "dsh.project.json"), { version: 1, base: "../base", namespace: "my-product" });
  assert.throws(() => projectContext(f.root), /nested relative submodule/);
});

test("every product output rejects child symlinks into a dependency or outside the product", t => {
  const f = fixture(t);
  mkdirSync(join(f.root, "apps/web"), { recursive: true });
  symlinkSync(f.base, join(f.root, "apps/web/linked"));
  assert.throws(() => productOutputPath(f.root, "apps/web/linked/generated.ts"), /read-only dependency/);
  mkdirSync(join(f.root, ".artifacts/dsh"), { recursive: true });
  symlinkSync(dirname(f.root), join(f.root, ".artifacts/dsh/escaped"));
  assert.throws(() => productOutputPath(f.root, ".artifacts/dsh/escaped/generated.ts"), /escapes the product/);
  symlinkSync(join(dirname(f.root), "missing-product-output"), join(f.root, ".artifacts/dsh/dangling.ts"));
  assert.throws(() => productOutputPath(f.root, ".artifacts/dsh/dangling.ts"));
  assert.equal(productOutputPath(f.root, "apps/web/src/generated.ts"), join(f.root, "apps/web/src/generated.ts"));
});

test("verifyProject requires a real registered gitlink instead of trusting a directory", t => {
  const f = fixture(t);
  execFileSync("git", ["init", "-q", f.root]);
  assert.throws(() => verifyProject(f.root));
});

test("verifyProject pins both submodules, rejects dirty bases and accepts an explicitly updated gitlink", t => {
  const f = fixture(t), upstream = projectContext(f.root).upstreamRoot;
  const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgSign=false", "-c", "tag.gpgSign=false", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const commit = cwd => { git(cwd, "add", "--all"); git(cwd, "commit", "-qm", "Fixture"); return git(cwd, "rev-parse", "HEAD"); };
  git(upstream, "init", "-q");
  const upstreamCommit = commit(upstream);
  git(upstream, "tag", "dsh-v0.1.0");
  f.write(join(f.base, "dsh-source.lock.json"), { repository: "https://github.com/deepseek-ai/deepseek-harness.git", referencePath: ".submodules/deepseek-harness", tag: "dsh-v0.1.0", commit: upstreamCommit, tree: git(upstream, "rev-parse", "HEAD^{tree}") });
  f.write(join(f.base, ".gitmodules"), '[submodule "deepseek-harness"]\n\tpath = .submodules/deepseek-harness\n\turl = https://github.com/deepseek-ai/deepseek-harness.git\n');
  git(f.base, "init", "-q");
  const baseCommit = commit(f.base);
  f.write(join(f.root, ".gitmodules"), '[submodule "dsh-base"]\n\tpath = .submodules/dsh-base\n\turl = https://example.invalid/dsh-base.git\n');
  git(f.root, "init", "-q");
  commit(f.root);
  assert.equal(verifyProject(f.root).baseCommit, baseCommit);
  f.write(join(f.base, "untracked.txt"), "unreviewed\n");
  assert.throws(() => verifyProject(f.root), /clean read-only submodules/);
  rmSync(join(f.base, "untracked.txt"));
  f.write(join(f.base, "release.txt"), "next release\n");
  const nextCommit = commit(f.base);
  assert.throws(() => verifyProject(f.root), /HEAD does not match/);
  git(f.root, "add", "--", ".submodules/dsh-base");
  assert.equal(verifyProject(f.root).baseCommit, nextCommit);
});
