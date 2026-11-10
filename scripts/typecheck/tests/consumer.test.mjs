import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import test from "node:test";
import { buildContext } from "../../build/product-paths.mjs";
import { baseRepoRoot } from "../../composition/project-context.mjs";
import { checkedOwnedFiles, createTypecheckProgram, parseTypecheckProject } from "../compiler.mjs";
import { serverPackageDirectory } from "../../../packages/build/dsh-base-build-server-dependencies/src/resolution.mjs";

const ts = createRequire(join(baseRepoRoot, "apps/web/package.json"))("typescript");
function put(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value));
  return path;
}
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "dsh-consumer-types-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const base = join(root, ".submodules/dsh-base");
  mkdirSync(base, { recursive: true });
  put(join(root, "dsh.project.json"), { version: 1, base: ".submodules/dsh-base", namespace: "fixture" });
  return buildContext(root);
}
function own(context, group, product, source) {
  const owner = product ? context.productRoot : context.baseRoot;
  const namespace = product ? "fixture" : "dsh-base";
  const directory = join(owner, "packages", group, `${namespace}-${group}-example`);
  put(join(directory, "package.json"), { name: `@${namespace}/${group}-example` });
  return put(join(directory, "src/index.ts"), source);
}
function compile(context, files, paths = {}) {
  const raw = { compilerOptions: { strict: true, noEmit: true, skipLibCheck: true, target: "ES2024", module: "ESNext", moduleResolution: "Bundler", allowImportingTsExtensions: true, types: [], paths }, files };
  const parsed = parseTypecheckProject(ts, raw, context);
  const program = createTypecheckProgram(ts, { rootNames: parsed.fileNames, options: parsed.options }, context);
  return { parsed, program, diagnostics: [...parsed.errors, ...ts.getPreEmitDiagnostics(program)] };
}

test("consumer relative imports and root files use product output even when stale base output exists", t => {
  const context = fixture(t);
  const source = own(context, "client", false, 'import { value } from "./fixture.generated.ts"; export const checked: "product" = value;');
  const stale = put(join(dirname(source), "fixture.generated.ts"), 'export const value = "stale";');
  const generated = put(join(context.generatedRoot, "packages/client/dsh-base-client-example/src/fixture.generated.ts"), 'export const value = "product";');
  const checked = compile(context, [source, stale]);
  assert.deepEqual(checked.diagnostics.map(item => ts.flattenDiagnosticMessageText(item.messageText, "\n")), []);
  assert(checked.program.getSourceFile(generated));
  assert.equal(checked.program.getSourceFile(stale), undefined);
  assert(checkedOwnedFiles("client", checked.parsed.fileNames, context).includes(".artifacts/dsh/packages/client/dsh-base-client-example/src/fixture.generated.ts"));
  assert.equal(readFileSync(stale, "utf8"), 'export const value = "stale";');
  rmSync(stale);
  assert.deepEqual(compile(context, [source]).diagnostics.map(item => ts.flattenDiagnosticMessageText(item.messageText, "\n")), [], "fresh base checkouts need no generated source files");
  put(stale, 'export const value = "stale";');
  rmSync(generated);
  assert(compile(context, [source]).diagnostics.length > 0, "missing product output must not fall back to stale base output");
});

test("strict checks and omitted-source protection cover base and product client, Worker and Think", t => {
  const context = fixture(t);
  const files = [false, true].flatMap(product => ["client", "cloudflare-worker", "cloudflare-think"].map(group => own(context, group, product, 'export const value: string = 123;')));
  const checked = compile(context, files);
  const errors = checked.diagnostics.filter(item => item.code === 2322);
  assert.equal(errors.length, 6);
  assert.equal(checkedOwnedFiles("client", checked.parsed.fileNames, context).length, 2);
  assert.equal(checkedOwnedFiles("worker", checked.parsed.fileNames, context).length, 4);
  for (const file of files) {
    const plane = file.includes("/client/") ? "client" : "worker";
    assert.throws(() => checkedOwnedFiles(plane, checked.parsed.fileNames.filter(path => path !== file), context), /silently excluded/);
  }
});

test("base source resolves browser and isolated server declarations from product with no base node_modules", t => {
  const context = fixture(t);
  const browser = put(join(context.appRoot, "node_modules/browser-sdk/index.d.ts"), 'export interface Browser { product: true }');
  const server = put(join(context.productRoot, "packages/build/product-server-dependencies/node_modules/server-sdk/index.d.ts"), 'export interface Server { product: true }');
  const source = own(context, "cloudflare-worker", false, 'import type { Browser } from "browser-sdk"; import type { Server } from "server-sdk"; export const value: Browser & Server = { product: true };');
  const checked = compile(context, [source], { "browser-sdk": [browser], "server-sdk": [server] });
  assert.deepEqual(checked.diagnostics.map(item => ts.flattenDiagnosticMessageText(item.messageText, "\n")), []);
  assert(checked.program.getSourceFile(browser));
  assert(checked.program.getSourceFile(server));
  assert.equal(existsSync(join(context.baseRoot, "node_modules")), false);
  assert.equal(existsSync(join(context.baseRoot, "apps/web/node_modules")), false);
  assert.equal(context.typecheckRoot, join(context.productRoot, ".artifacts/dsh/.artifacts/typecheck"));
  assert.equal(serverPackageDirectory("@cloudflare/think", context.productRoot), join(context.productRoot, "packages/build/product-server-dependencies/node_modules/@cloudflare/think"));
});

test("pinned official generated source remains in the upstream checkout", t => {
  const context = fixture(t);
  const official = put(join(context.upstreamRoot, "packages/util/official-bundles/src/catalog.generated.ts"), 'export const official = "pinned";');
  const checked = compile(context, [official]);
  assert.deepEqual(checked.diagnostics.map(item => ts.flattenDiagnosticMessageText(item.messageText, "\n")), []);
  assert(checked.program.getSourceFile(official));
  assert.deepEqual(checked.parsed.fileNames, [official]);
});
