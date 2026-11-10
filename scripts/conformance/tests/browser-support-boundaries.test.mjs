import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { checkBoundaries } from "../check-plugin-boundaries.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "dsh-browser-support-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path, value) => {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, typeof value === "string" ? value : JSON.stringify(value));
  };
  write("dsh-source.lock.json", { commit: "a".repeat(40) });
  const pkg = (group, name, dshBase = {}) => {
    const base = `packages/${group}/${name.replace("@dsh-base/", "")}`;
    write(`${base}/package.json`, { name, dshBase });
    return `${base}/src/index.ts`;
  };
  return { root, write, pkg };
}

const support = {
  boot: { kind: "browser-support" },
  reuse: { mode: "seam", official: [], reason: "Browser boot and transport compatibility only." },
};

test("browser support is client-plane code without becoming a composed plugin", t => {
  const f = fixture(t);
  const library = f.pkg("boot", "@dsh-base/client-support", support);
  const client = f.pkg("client", "@dsh-base/client-feature");
  f.write(library, 'import "react"; import type { ConnectionHandle } from "@deepseek-ai/dsh-client-connection/client";');
  f.write(client, 'import "@dsh-base/client-support";');
  assert.deepEqual(checkBoundaries(f.root).failures, []);
});

test("Worker, Think and neutral shared code cannot import browser support by name or path", t => {
  const f = fixture(t);
  f.pkg("boot", "@dsh-base/client-support", support);
  const worker = f.pkg("cloudflare-worker", "@dsh-base/cloudflare-worker-feature");
  const think = f.pkg("cloudflare-think", "@dsh-base/cloudflare-think-feature");
  const shared = f.pkg("boot", "@dsh-base/shared");
  f.write(worker, 'import "@dsh-base/client-support";');
  f.write(think, 'import "../../../boot/client-support/src/index.ts";');
  f.write(shared, 'import "@dsh-base/client-support";');
  const failures = checkBoundaries(f.root).failures;
  assert.equal(failures.length, 3);
  assert.ok(failures.every(failure => failure.includes("imports client package")));
});

test("the real browser compatibility package rejects server and shared consumers by name and path", t => {
  const f = fixture(t);
  const manifest = JSON.parse(readFileSync(new URL("../../../packages/boot/browser-compat/package.json", import.meta.url), "utf8"));
  f.write("packages/boot/browser-compat/package.json", manifest);
  f.write("packages/boot/browser-compat/src/node-fs.ts", "export const existsSync = () => false;");
  const client = f.pkg("client", "@dsh-base/client-feature");
  f.write(client, `import "${manifest.name}/src/node-fs.ts";`);
  assert.deepEqual(checkBoundaries(f.root).failures, []);

  for (const [group, name] of [
    ["cloudflare-worker", "@dsh-base/cloudflare-worker-feature"],
    ["cloudflare-think", "@dsh-base/cloudflare-think-feature"],
    ["boot", "@dsh-base/shared"],
  ]) {
    const source = f.pkg(group, name);
    f.write(source, `import "${manifest.name}/src/node-fs.ts";\nimport "../../../boot/browser-compat/src/node-fs.ts";`);
  }
  const failures = checkBoundaries(f.root).failures;
  assert.equal(failures.length, 6);
  for (const plane of ["worker", "think", "shared"]) {
    assert.equal(failures.filter(failure => failure.includes(`${plane} package`) && failure.includes(`imports client package ${manifest.name}`)).length, 2);
  }
});

test("browser support keeps client restrictions on Node, Workers SDKs and local server packages", t => {
  const f = fixture(t);
  const library = f.pkg("boot", "@dsh-base/client-support", support);
  f.pkg("cloudflare-worker", "@dsh-base/cloudflare-worker-feature");
  f.write(library, 'import "node:fs"; import "@cloudflare/think"; import "@dsh-base/cloudflare-worker-feature";');
  const failures = checkBoundaries(f.root).failures;
  assert.equal(failures.length, 3);
  assert.match(failures.join("\n"), /client package imports non-browser module node:fs/u);
  assert.match(failures.join("\n"), /imports worker package/u);
});

test("moving arbitrary browser code under boot without declaring support remains forbidden", t => {
  const f = fixture(t);
  const library = f.pkg("boot", "@dsh-base/client-undeclared");
  f.write(library, 'import "react"; import "@deepseek-ai/dsh-client-connection/client";');
  const failures = checkBoundaries(f.root).failures;
  assert.equal(failures.length, 2);
  assert.ok(failures.every(failure => failure.includes("shared package imports browser module")));
});

test("browser support cannot disguise a feature plugin or an undocumented custom implementation", t => {
  const f = fixture(t);
  f.pkg("boot", "@dsh-base/client-composed", { ...support, client: { id: "client:composed" } });
  f.pkg("boot", "@dsh-base/client-custom", { boot: support.boot, reuse: { mode: "custom" } });
  const failures = checkBoundaries(f.root).failures;
  assert.equal(failures.length, 2);
  assert.match(failures.join("\n"), /browser support libraries cannot declare runtime composition/u);
  assert.match(failures.join("\n"), /browser support libraries must record compatibility seam metadata/u);
});

test("support metadata cannot reclassify another directory or silently use an unknown kind", t => {
  const f = fixture(t);
  f.pkg("cloudflare-worker", "@dsh-base/cloudflare-worker-feature", support);
  f.pkg("boot", "@dsh-base/client-invalid", { ...support, boot: { kind: "anything" } });
  const failures = checkBoundaries(f.root).failures;
  assert.equal(failures.length, 2);
  assert.ok(failures.every(failure => failure.includes("boot support metadata requires packages/boot and kind = browser-support")));
});
