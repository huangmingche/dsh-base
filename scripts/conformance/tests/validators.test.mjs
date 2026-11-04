import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { checkBoundaries } from "../check-plugin-boundaries.mjs";
import { checkChatParity, requiredChatPackages } from "../check-chat-parity.mjs";
import { checkOfficialReuse } from "../check-official-reuse.mjs";
import { checkOfficialUiCoverage } from "../check-official-ui-coverage.mjs";
import { clientRows, importsIn, isPackageExported } from "../lib.mjs";
import { verifySource } from "../../dsh-source/verify.mjs";

const commit = "a".repeat(40);
const target = "@deepseek-ai/dsh-client-ui-sample";
const fork = { package: target, path: "packages/client/ui-sample", commit, license: "MIT" };
const reuse = { mode: "custom", official: [], reason: "This capability has no official package or forkable implementation." };

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "dsh-conformance-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path, value) => {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
  };
  write("dsh-source.lock.json", { repository: "https://github.com/deepseek-ai/deepseek-harness.git", referencePath: ".submodules/deepseek-harness", tag: "dsh-v0.2.2-rc.1", commit, tree: "b".repeat(40) });
  write(".submodules/deepseek-harness/packages/client/ui-sample/package.json", { name: target, license: "MIT", dsh: { client: { platform: "web" } }, exports: { ".": "./lib/index.js", "./client": "./lib/client.js", "./src/*": "./src/*", "./src/private/*": null } });
  write(".submodules/deepseek-harness/packages/bundle/web-app/cordis.patch.yml", `- insert:\n    - id: sample\n      name: '${target}'\n`);
  write("apps/web/composition.profile.json", { client: [{ name: target, id: "client:sample", origin: "upstream" }] });
  const pkg = (group, name, extra = {}) => {
    const directory = `${group}/${name.replace("@dsh-base/", "")}`;
    write(`packages/${directory}/package.json`, { name, exports: { ".": "./src/index.ts" }, dshBase: { reuse }, ...extra });
    return `packages/${directory}/src/index.ts`;
  };
  return { root, write, pkg };
}

test("boundary gate rejects scoped local package imports and subpath imports across planes", (t) => {
  const f = fixture(t);
  const source = f.pkg("client", "@dsh-base/client-a");
  f.pkg("cloudflare-think", "@dsh-base/cloudflare-think-b");
  f.write(source, 'import "@dsh-base/cloudflare-think-b";\nexport { b } from "@dsh-base/cloudflare-think-b/src/b.ts";');
  const result = checkBoundaries(f.root);
  assert.equal(result.failures.length, 2);
  assert.ok(result.failures.every((failure) => failure.includes("imports think package")));
});

test("boundary gate rejects relative cross-plane imports and unknown local packages", (t) => {
  const f = fixture(t);
  const source = f.pkg("client", "@dsh-base/client-a");
  f.pkg("cloudflare-worker", "@dsh-base/cloudflare-worker-b");
  f.write(source, 'import "../../../cloudflare-worker/cloudflare-worker-b/src/index.ts";\nimport "@dsh-base/client-missing";');
  const result = checkBoundaries(f.root);
  assert.equal(result.failures.length, 2);
  assert.match(result.failures.join("\n"), /imports worker package/);
  assert.match(result.failures.join("\n"), /unknown local package/);
});

test("boundary gate accepts same-plane and shared imports, rejects Node and browser dependencies", (t) => {
  const f = fixture(t);
  const client = f.pkg("client", "@dsh-base/client-a");
  f.pkg("client", "@dsh-base/client-b");
  f.pkg("boot", "@dsh-base/shared");
  f.write(client, 'import "@dsh-base/client-b";\nimport "@dsh-base/shared";');
  assert.deepEqual(checkBoundaries(f.root).failures, []);
  const worker = f.pkg("cloudflare-worker", "@dsh-base/cloudflare-worker-a");
  f.write(client, 'const fs = require("fs");\nimport "node:crypto";');
  f.write(worker, 'import "react-dom/server";');
  assert.equal(checkBoundaries(f.root).failures.length, 3);
});

test("boundary gate validates package and composition prefixes", (t) => {
  const f = fixture(t);
  f.pkg("cloudflare-worker", "@dsh-base/client-wrong", { dshBase: { worker: { id: "client:wrong" }, reuse } });
  assert.equal(checkBoundaries(f.root).failures.length, 2);
});

test("boundary gate distinguishes browser SDK entries from Workers runtime entries", (t) => {
  const f = fixture(t);
  const client = f.pkg("client", "@dsh-base/client-a");
  const worker = f.pkg("cloudflare-worker", "@dsh-base/cloudflare-worker-a");
  f.write(client, 'import "@cloudflare/think/react";\nimport "agents/react";');
  assert.deepEqual(checkBoundaries(f.root).failures, []);
  f.write(client, 'import "@cloudflare/think";\nimport "agents";');
  f.write(worker, 'import "@cloudflare/think/react";');
  assert.equal(checkBoundaries(f.root).failures.length, 3);
});

test("build plane permits Node only in declared build packages and prevents runtime imports", (t) => {
  const f = fixture(t);
  const build = f.pkg("build", "@dsh-base/build-vite", { dshBase: { build: { kind: "vite-plugin" }, reuse } });
  f.write(build, 'import "node:fs";');
  assert.deepEqual(checkBoundaries(f.root).failures, []);
  const client = f.pkg("client", "@dsh-base/client-a");
  const shared = f.pkg("boot", "@dsh-base/shared");
  f.write(client, 'import "@dsh-base/build-vite";');
  f.write(shared, 'import "node:fs";');
  assert.equal(checkBoundaries(f.root).failures.length, 2);
  f.pkg("build", "@dsh-base/build-bad", { dshBase: { build: { kind: "vite-plugin" }, worker: { id: "cloudflare:worker:bad" }, reuse } });
  assert.match(checkBoundaries(f.root).failures.join("\n"), /build-only packages cannot declare runtime composition/);
});

test("Host upload exception is exact, exported and pinned; client entry remains forbidden", (t) => {
  const f = fixture(t), name = "@deepseek-ai/dsh-client-file-upload", specifier = `${name}/src/http-route.ts`;
  f.write(".submodules/deepseek-harness/packages/client/file-upload/package.json", { name, exports: { "./src/*": "./src/*", "./client": "./lib/client.js" } });
  const path = f.pkg("cloudflare-worker", "@dsh-base/cloudflare-worker-upload");
  f.write(path, `import "${specifier}";`);
  assert.equal(checkBoundaries(f.root).failures.length, 1);
  f.pkg("cloudflare-worker", "@dsh-base/cloudflare-worker-upload", { dshBase: { reuse: { ...reuse, sourceEntries: [specifier], sourceReviewCommit: commit } } });
  assert.deepEqual(checkBoundaries(f.root).failures, []);
  f.write(path, `import "${name}/client";`);
  assert.equal(checkBoundaries(f.root).failures.length, 1);
  f.write(path, `import "${specifier}";`);
  f.pkg("cloudflare-worker", "@dsh-base/cloudflare-worker-upload", { dshBase: { reuse: { ...reuse, sourceEntries: [specifier], sourceReviewCommit: "old" } } });
  assert.equal(checkBoundaries(f.root).failures.length, 1);
});

test("dependency extraction handles side effects, CSS, require, re-exports and comments", () => {
  const source = '// import "ignored";\nimport "side-effect";\nexport { x } from "exported";\nconst p = import("dynamic");\nconst q = require("required");\n/* @import "ignored-css"; */\n@import "style.css";';
  assert.deepEqual(importsIn(source).map(({ specifier }) => specifier), ["side-effect", "exported", "dynamic", "required", "style.css"]);
  assert.equal(importsIn(source)[0].line, 2);
});

test("reuse gate rejects exact copied official implementation disguised as a seam", (t) => {
  const f = fixture(t);
  const source = Array.from({ length: 12 }, (_, index) => `export function officialOperation${index}(value) { return value + ${index}; }`).join("\n");
  f.write(".submodules/deepseek-harness/packages/client/ui-sample/src/implementation.ts", source);
  const local = f.pkg("client", "@dsh-base/client-copy", { dshBase: { reuse: { ...reuse, mode: "seam" } } });
  f.write(local, source);
  assert.match(checkOfficialReuse(f.root).failures.join("\n"), /unmarked exact official source copy/);
  f.pkg("client", "@dsh-base/client-copy", { dshBase: { forkOf: fork, reuse: { ...reuse, mode: "fork" } } });
  assert.ok(checkOfficialReuse(f.root).failures.every(failure => !failure.includes("unmarked exact official source copy")));
});

test("official exports fail closed for missing exports, null, exclusions and traversal", () => {
  assert.equal(isPackageExported({}), false);
  assert.equal(isPackageExported({ exports: { import: "./lib.js" } }), true);
  assert.equal(isPackageExported({ exports: { import: "./lib.js" } }, "./private"), false);
  const manifest = { exports: { "./src/*": "./src/*", "./src/private/*": null, "./src/secret.ts": null } };
  assert.equal(isPackageExported(manifest, "./src/allowed.ts"), true);
  for (const path of ["./src/private/x.ts", "./src/secret.ts", "./src/../secret.ts", "./src/%2e%2e/secret.ts", "./src/node_modules/x"]) assert.equal(isPackageExported(manifest, path), false, path);
});

test("reuse gate audits every runtime package even when dshBase is absent", (t) => {
  const f = fixture(t);
  for (const [group, name] of [["client", "@dsh-base/client-a"], ["client", "@dsh-base/client-b"], ["cloudflare-worker", "@dsh-base/cloudflare-worker-a"], ["cloudflare-think", "@dsh-base/cloudflare-think-a"]]) f.pkg(group, name, { dshBase: undefined });
  assert.equal(checkOfficialReuse(f.root).failures.length, 4);
});

test("reuse gate rejects unknown packages and unexported side-effect imports", (t) => {
  const f = fixture(t);
  const source = f.pkg("client", "@dsh-base/client-a");
  f.write(source, `import '${target}/private';\nimport '@deepseek-ai/not-in-the-pin';`);
  assert.equal(checkOfficialReuse(f.root).failures.length, 2);
});

test("reuse gate requires pin-reviewed source imports and rejects stale reviews", (t) => {
  const f = fixture(t);
  const specifier = `${target}/src/Component.tsx`;
  const source = f.pkg("client", "@dsh-base/client-a");
  f.write(source, `import { Component } from '${specifier}';`);
  assert.equal(checkOfficialReuse(f.root).failures.length, 2);
  f.pkg("client", "@dsh-base/client-a", { dshBase: { reuse: { ...reuse, sourceEntries: [specifier], sourceReviewCommit: commit } } });
  assert.deepEqual(checkOfficialReuse(f.root).failures, []);
  f.pkg("client", "@dsh-base/client-a", { dshBase: { reuse: { ...reuse, sourceEntries: [specifier], sourceReviewCommit: "c".repeat(40) } } });
  assert.ok(checkOfficialReuse(f.root).failures.some((failure) => failure.includes("sourceReviewCommit")));
});

test("reuse gate rejects filesystem access around official exports", (t) => {
  const f = fixture(t);
  const source = f.pkg("client", "@dsh-base/client-a");
  f.write(source, 'import "../../../../.submodules/deepseek-harness/packages/client/ui-sample/src/private.ts";');
  assert.match(checkOfficialReuse(f.root).failures.join("\n"), /through its package exports/);
});

test("reuse gate validates fork provenance, license and current pin", (t) => {
  const f = fixture(t);
  f.pkg("client", "@dsh-base/client-a", { dshBase: { forkOf: { ...fork, path: "packages/client/wrong", license: "wrong", commit: "c".repeat(40) } } });
  assert.equal(checkOfficialReuse(f.root).failures.length, 3);
});

test("chat gate fails for missing and disabled required packages", (t) => {
  const f = fixture(t);
  const rows = requiredChatPackages.map((name, i) => ({ name, id: `client:${i}`, origin: "upstream" }));
  f.write("apps/web/composition.profile.json", { client: rows });
  assert.deepEqual(checkChatParity(f.root).failures, []);
  rows[0].disabled = true;
  f.write("apps/web/composition.profile.json", { client: rows.slice(0, -1) });
  assert.equal(checkChatParity(f.root).failures.length, 2);
});

test("chat gate accepts only one pin-reviewed fork with the disabled official inventory", (t) => {
  const f = fixture(t);
  const replaced = "@deepseek-ai/dsh-client-ui-sidebar-right";
  const rows = requiredChatPackages.map((name, i) => ({ name, id: `client:${i}`, origin: "upstream", ...(name === replaced ? { disabled: true } : {}) }));
  const metadata = { client: { id: "client:sidebar-right", origin: "custom", replaces: replaced },
    reuse: { mode: "fork" }, forkOf: { package: replaced, path: "packages/client/ui-sidebar-right", commit, license: "MIT" } };
  f.pkg("client", "@dsh-base/client-sidebar-right", { dshBase: metadata });
  f.write("apps/web/composition.profile.json", { client: rows });
  assert.deepEqual(checkChatParity(f.root).failures, []);
  metadata.forkOf.commit = "stale";
  f.pkg("client", "@dsh-base/client-sidebar-right", { dshBase: metadata });
  assert.equal(checkChatParity(f.root).failures.length, 1);
  metadata.forkOf.commit = commit;
  f.pkg("client", "@dsh-base/client-sidebar-right", { dshBase: metadata });
  f.write("apps/web/composition.profile.json", { client: rows.filter(row => row.name !== replaced) });
  assert.equal(checkChatParity(f.root).failures.length, 1, "replacement may not hide official inventory");
  rows.find(row => row.name === replaced).disabled = false;
  f.write("apps/web/composition.profile.json", { client: rows });
  assert.equal(checkChatParity(f.root).failures.length, 1, "original and fork may not both execute");
});

test("UI declaration coverage rejects disabled official packages with no real replacement", (t) => {
  const f = fixture(t);
  assert.deepEqual(checkOfficialUiCoverage(f.root).failures, []);
  f.write("apps/web/composition.profile.json", { client: [{ name: target, id: "client:sample", origin: "upstream", disabled: true }] });
  assert.equal(checkOfficialUiCoverage(f.root).failures.length, 1);
  f.pkg("client", "@dsh-base/client-a", { dshBase: { client: { id: "client:a", origin: "custom", replaces: target }, reuse } });
  assert.match(checkOfficialUiCoverage(f.root).failures.join("\n"), /requires a pinned fork/);
});

test("UI coverage counts only active tracked replacements and rejects original/fork double activation", (t) => {
  const f = fixture(t);
  f.pkg("client", "@dsh-base/client-a", { dshBase: { client: { id: "client:a", origin: "custom", replaces: target }, forkOf: fork } });
  assert.match(checkOfficialUiCoverage(f.root).failures.join("\n"), /must remain disabled/);
  f.write("apps/web/composition.profile.json", { client: [{ name: target, id: "client:sample", origin: "upstream", disabled: true }] });
  assert.deepEqual(checkOfficialUiCoverage(f.root).failures, []);
  f.write("apps/web/composition.profile.json", { client: [{ name: target, id: "client:sample", origin: "upstream", disabled: true }, { name: "@dsh-base/client-a", id: "client:a", origin: "custom", disabled: true }] });
  assert.equal(checkOfficialUiCoverage(f.root).failures.length, 1);
});

test("UI coverage accepts only pin-reviewed exported component seams", (t) => {
  const f = fixture(t);
  f.write("apps/web/composition.profile.json", { client: [{ name: target, id: "client:sample", origin: "upstream", disabled: true }] });
  const metadata = { client: { id: "client:a", origin: "custom", replaces: target }, reuse: { mode: "seam", for: [target], reason: "Reuse exported official UI with an unavailable Host service.", sourceEntries: [`${target}/src/Component.tsx`], sourceReviewCommit: commit } };
  f.pkg("client", "@dsh-base/client-a", { dshBase: metadata });
  assert.deepEqual(checkOfficialUiCoverage(f.root).failures, []);
  metadata.reuse.sourceEntries = [`${target}/private`];
  f.pkg("client", "@dsh-base/client-a", { dshBase: metadata });
  assert.ok(checkOfficialUiCoverage(f.root).failures.length > 0);
});

test("UI coverage rejects duplicate rows, wrong origins and empty upstream parse", (t) => {
  const f = fixture(t);
  f.write("apps/web/composition.profile.json", { client: [{ name: target, id: "client:a", origin: "custom" }, { name: target, id: "client:a", origin: "custom" }] });
  assert.equal(checkOfficialUiCoverage(f.root).failures.length, 4);
  f.write(".submodules/deepseek-harness/packages/bundle/web-app/cordis.patch.yml", "# changed format\n");
  assert.match(checkOfficialUiCoverage(f.root).failures.join("\n"), /yielded no client packages/);
});

test("failed validation produces a nonzero command exit status", () => {
  const helper = new URL("../lib.mjs", import.meta.url).href;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `import {printResult} from ${JSON.stringify(helper)}; printResult('gate',{failures:['broken'],summary:''});`], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /broken/);
});

test("source gate validates the release tag target and rejects dirty source", (t) => {
  const f = fixture(t);
  const path = join(f.root, ".submodules/deepseek-harness");
  const git = (...args) => execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", "-c", "core.hooksPath=/dev/null", "-C", path, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10_000 }).trim();
  git("init", "-q"); git("add", "."); git("-c", "user.name=Conformance Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture");
  git("tag", "dsh-v0.2.2-rc.1");
  const lock = JSON.parse(readFileSync(join(f.root, "dsh-source.lock.json")));
  lock.commit = git("rev-parse", "HEAD"); lock.tree = git("rev-parse", "HEAD^{tree}");
  f.write("dsh-source.lock.json", lock);
  assert.deepEqual(verifySource(f.root).failures, []);
  f.write(".submodules/deepseek-harness/untracked.txt", "dirty");
  assert.match(verifySource(f.root).failures.join("\n"), /local changes or untracked/);
  git("add", "."); git("-c", "user.name=Conformance Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "next");
  lock.commit = git("rev-parse", "HEAD"); lock.tree = git("rev-parse", "HEAD^{tree}"); f.write("dsh-source.lock.json", lock);
  assert.match(verifySource(f.root).failures.join("\n"), /release tag.*not the locked commit/);
  lock.tag = "master"; f.write("dsh-source.lock.json", lock);
  assert.match(verifySource(f.root).failures.join("\n"), /must name an official dsh-v release/);
});

test("composed clients require dsh.client metadata, /client entry and real Config export", (t) => {
  const f = fixture(t);
  const metadata = { client: { id: "client:surface", origin: "custom" }, reuse };
  const pkg = { dshBase: metadata, exports: { ".": "./src/index.ts" } };
  const entry = f.pkg("client", "@dsh-base/client-surface", pkg);
  f.write(entry, "export const apply = () => {};");
  assert.match(checkOfficialReuse(f.root).failures.join("\n"), /dsh.client metadata/);
  assert.match(checkOfficialReuse(f.root).failures.join("\n"), /runtime \/client export/);
  pkg.dsh = { client: { platform: "web" } };
  pkg.exports["./client"] = "./src/index.ts";
  f.pkg("client", "@dsh-base/client-surface", pkg);
  assert.match(checkOfficialReuse(f.root).failures.join("\n"), /runtime Config schema/);
  f.write(entry, "export const Config = z.object({}).default({});");
  assert.deepEqual(checkOfficialReuse(f.root).failures, []);
});

test("client contract gate does not mistake comments, types or undefined placeholders for Config", (t) => {
  const f = fixture(t);
  const entry = f.pkg("client", "@dsh-base/client-surface", {
    dsh: { client: { platform: "web" } },
    exports: { "./client": "./src/index.ts" },
    dshBase: { client: { id: "client:surface", origin: "custom" }, reuse },
  });
  for (const source of [
    "// export const Config = z.object({});\nexport type Config = {};",
    'const sample = "export const Config = z.object({})";',
    "export const Config = undefined;",
    "const Config = null; export { Config };",
    "const schema = undefined; export { schema as Config };",
    "type Config = {}; export type { Config };",
    "declare const Config: unknown; export { Config };",
  ]) {
    f.write(entry, source);
    assert.match(checkOfficialReuse(f.root).failures.join("\n"), /runtime Config schema/, source);
  }
});

test("client contracts resolve local Config re-exports and reject absent or escaped entries", (t) => {
  const f = fixture(t);
  const metadata = { dsh: { client: { platform: "web" } }, exports: { "./client": { types: "./types/client.d.ts", import: "./src/index.ts" } }, dshBase: { client: { id: "client:surface", origin: "custom" }, reuse } };
  const entry = f.pkg("client", "@dsh-base/client-surface", metadata);
  f.write(entry, "export { schema as Config } from './schema.ts';");
  f.write(entry.replace("index.ts", "schema.ts"), "export const schema = z.object({}).default({});");
  assert.deepEqual(checkOfficialReuse(f.root).failures, []);
  f.write(entry, "export * from './schema.ts';");
  f.write(entry.replace("index.ts", "schema.ts"), "export const Config = z.object({}).default({});");
  assert.deepEqual(checkOfficialReuse(f.root).failures, []);
  for (const target of ["./src/missing.ts", "../escaped.ts"]) {
    metadata.exports["./client"] = target;
    f.pkg("client", "@dsh-base/client-surface", metadata);
    assert.match(checkOfficialReuse(f.root).failures.join("\n"), /missing or outside/);
  }
  metadata.exports["./client"] = { types: "./types/client.d.ts" };
  f.pkg("client", "@dsh-base/client-surface", metadata);
  assert.match(checkOfficialReuse(f.root).failures.join("\n"), /runtime \/client export/);
});

test("utility client packages without dshBase.client need no loader Config or client entry", (t) => {
  const f = fixture(t);
  const entry = f.pkg("client", "@dsh-base/client-utility");
  f.write(entry, "export const helper = () => 1;");
  assert.deepEqual(checkOfficialReuse(f.root).failures, []);
});

test("public document routes require exact unique paths and survive disabled profile overrides", (t) => {
  const f = fixture(t);
  const metadata = { dsh: { client: { platform: "web" } }, exports: { "./client": "./src/index.ts" }, dshBase: { client: { id: "client:login", origin: "custom", documentRoutes: ["/login"] }, reuse } };
  const entry = f.pkg("client", "@dsh-base/client-login", metadata);
  f.write(entry, "export const Config = z.object({}).default({});");
  assert.deepEqual(checkOfficialReuse(f.root).failures, []);
  for (const value of [null, "login", [], ["/login", "/login"], ["//foreign"], ["/login?next=/"], ["/login#x"], ["/*"], ["/../login"], ["/login/"], [42]]) {
    metadata.dshBase.client.documentRoutes = value;
    f.pkg("client", "@dsh-base/client-login", metadata);
    assert.match(checkOfficialReuse(f.root).failures.join("\n"), /documentRoutes/, JSON.stringify(value));
  }
  metadata.dshBase.client.documentRoutes = ["/login"];
  f.pkg("client", "@dsh-base/client-login", metadata);
  f.write("apps/web/composition.profile.json", { client: [{ name: "@dsh-base/client-login", id: "client:login", origin: "custom", disabled: true }] });
  assert.deepEqual(clientRows(f.root)[0].documentRoutes, ["/login"]);
});
