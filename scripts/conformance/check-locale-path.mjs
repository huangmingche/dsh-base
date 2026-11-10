#!/usr/bin/env node
/**
 * LP0 single-source guard for public URL language prefixes (ADR §13.2).
 *
 * The prefix rules live only in `packages/boot/dsh-base-locale-path`. Production
 * code may not hand-write `/zh`, `/ja`, `…` or the legacy `/zh-CN`, and may not
 * define its own strip/localize helpers. Every known consumer must import the
 * shared module once it exists (clients land in P5/P4b).
 *
 * Deployment acceptance scripts under `apps/web/scripts` are not shipped code,
 * but a hand-written prefix there silently tests the wrong page when the rule
 * changes (`/zh` is an ordinary SPA route again). They must import the shared
 * module; a literal that deliberately asserts canonicalization or inertness is
 * allowed only on a line annotated `// locale-path:allow <reason>`, and the
 * summary prints how many annotated exceptions were used.
 *
 * Comments are stripped before scanning so a doc mentioning `/zh` is not a
 * violation; a quoted path or a second helper implementation is.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MODULE_DIR = "packages/boot/dsh-base-locale-path";
const MODULE_IMPORT = "@dsh-base/locale-path";
const MODULE_IMPORT_PATTERN = /from\s+["'][^"']*dsh-base-locale-path[^"']*["']/u;
// A consumer that does not exist yet is pending *and* bound to the card that
// lands it. The entry must be deleted when a card is cancelled, otherwise a
// pending row would become a permanent exemption.
const CONSUMERS = [
  { path: "packages/cloudflare-worker/dsh-base-cloudflare-worker-seo", pendingFor: null },
  { path: "packages/client/dsh-base-client-locale-url", pendingFor: null },  // P4b landed
  { path: "packages/client/dsh-base-client-route-address", pendingFor: null },  // P5 landed
];
// Production sources. Acceptance harnesses under apps/web/scripts get the
// separate retired-`/zh` pass below.
const SCAN_ROOTS = ["packages", "apps/web/src"];
const SCRIPT_ROOTS = ["apps/web/scripts"];
/** Inline annotation that permits one deliberate prefix literal in a script. */
const SCRIPT_ALLOW = /\/\/\s*locale-path:allow\s+\S/u;
// Canonical value, retired value, case aliases and sibling ids all count as a
// hand-written prefix; `en` is the explicit base spelling of the same surface.
const PREFIX_LITERAL = /(?:^|[^A-Za-z0-9_\-/])\/(zh-CN|zh|en|ja|es|fr|de|pt|ru)(?=[/?#"'`]|$)/iu;
const EXTENSIONS = [".ts", ".tsx", ".mjs", ".js"];
const PREFIX_TOKENS = ["zh", "ja", "es", "fr", "de", "pt", "ru"];
const HELPER_NAMES = ["stripLocale", "localizePath", "splitLocalePath", "isLocalePrefix", "prefixFor", "hreflangFor"];

/**
 * Paths git ignores (generated composition files, build output). They are not
 * reviewed source, and their presence must not flip a guard from green to red.
 * A non-git directory (unit-test fixture) yields no exclusions.
 */
const gitIgnored = (root, files) => {
  if (files.length === 0) return new Set();
  const relativePaths = files.map(file => relative(root, file).split("\\").join("/"));
  const result = spawnSync("git", ["-C", root, "check-ignore", "--stdin"], { input: relativePaths.join("\n"), encoding: "utf8" });
  if (typeof result.stdout !== "string" || result.stdout === "") return new Set();
  return new Set(result.stdout.split("\n").filter(Boolean));
};

const stripComments = text => text
  .replace(/\/\*[\s\S]*?\*\//gu, "")
  .replace(/(^|[^:])\/\/[^\n]*/gu, "$1");

const listSourceFiles = root => {
  const files = [];
  const walk = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (["node_modules", "dist", "tests", ".artifacts", ".git"].includes(entry.name)) continue;
        walk(path);
        continue;
      }
      if (EXTENSIONS.some(extension => entry.name.endsWith(extension))) files.push(path);
    }
  };
  walk(root);
  return files;
};

/**
 * @param {{ root: string, moduleDir?: string, consumers?: Array<{ path: string, pendingFor?: string | null } | string> }} options
 * @returns {{ errors: string[], pendingConsumers: Array<{ path: string, pendingFor: string | null }>, scanned: number, scannedScripts: number, scriptExceptions: number, ignoredSources: number }}
 */
export function auditLocalePath({ root, moduleDir = MODULE_DIR, consumers = CONSUMERS }) {
  const errors = [];
  const pendingConsumers = [];
  const modulePath = join(root, moduleDir);
  if (!existsSync(modulePath)) {
    return { errors: [`shared module missing: ${moduleDir}`], pendingConsumers, scanned: 0, scannedScripts: 0, scriptExceptions: 0, ignoredSources: 0 };
  }

  const allFiles = SCAN_ROOTS.flatMap(scanRoot => {
    const directory = join(root, scanRoot);
    return existsSync(directory) && statSync(directory).isDirectory() ? listSourceFiles(directory) : [];
  });
  const ignoredFiles = gitIgnored(root, allFiles);
  const files = allFiles.filter(file => !ignoredFiles.has(relative(root, file).split("\\").join("/")));
  for (const file of files) {
    const relativePath = relative(root, file).split("\\").join("/");
    if (relativePath.startsWith(`${moduleDir}/`)) continue;
    const source = stripComments(readFileSync(file, "utf8"));
    const literal = PREFIX_LITERAL.exec(source);
    if (literal !== null) {
      errors.push(`${relativePath}: hand-written locale prefix "/${literal[1]}" — import ${MODULE_IMPORT} instead`);
    }
    for (const helper of HELPER_NAMES) {
      const definition = new RegExp(`\\b(?:function|const|let|var)\\s+${helper}\\b`, "u");
      if (definition.test(source)) errors.push(`${relativePath}: defines its own ${helper}() — the shared module is the only implementation`);
    }
  }

  const allScriptFiles = SCRIPT_ROOTS.flatMap(scanRoot => {
    const directory = join(root, scanRoot);
    return existsSync(directory) && statSync(directory).isDirectory() ? listSourceFiles(directory) : [];
  });
  const ignoredScripts = gitIgnored(root, allScriptFiles);
  const scriptFiles = allScriptFiles.filter(file => !ignoredScripts.has(relative(root, file).split("\\").join("/")));
  let scriptExceptions = 0;
  for (const file of scriptFiles) {
    const relativePath = relative(root, file).split("\\").join("/");
    const lines = readFileSync(file, "utf8").split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (/^\s*(?:\/\/|\/?\*)/u.test(line)) continue;
      const literal = PREFIX_LITERAL.exec(stripComments(line));
      if (literal === null) continue;
      if (SCRIPT_ALLOW.test(line) || SCRIPT_ALLOW.test(lines[index - 1] ?? "")) { scriptExceptions += 1; continue; }
      errors.push(`${relativePath}:${index + 1}: hand-written locale prefix "/${literal[1]}" — import ${MODULE_IMPORT}, or annotate // locale-path:allow <reason> for a deliberate inertness assertion`);
    }
  }

  for (const consumer of consumers) {
    const { path: consumerPath, pendingFor = null } = typeof consumer === "string" ? { path: consumer } : consumer;
    const directory = join(root, consumerPath);
    if (!existsSync(directory)) {
      if (pendingFor === null) errors.push(`${consumerPath}: missing consumer is not bound to a card — annotate pendingFor or remove the row`);
      else pendingConsumers.push({ path: consumerPath, pendingFor });
      continue;
    }
    const consumerFiles = listSourceFiles(directory);
    const imports = consumerFiles.some(file => MODULE_IMPORT_PATTERN.test(readFileSync(file, "utf8")));
    if (!imports) errors.push(`${consumerPath}: must import ${MODULE_IMPORT} instead of local prefix logic`);
  }
  return {
    errors, pendingConsumers, scanned: files.length, scannedScripts: scriptFiles.length, scriptExceptions,
    ignoredSources: allFiles.length - files.length + allScriptFiles.length - scriptFiles.length,
  };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = auditLocalePath({ root: repoRoot });
  if (result.errors.length > 0) {
    console.error(`locale path: ${result.errors.length} violation(s)`);
    for (const error of result.errors) console.error(`  - ${error}`);
    process.exitCode = 1;
  } else {
    const pending = result.pendingConsumers.length === 0
      ? "all consumers wired"
      : `pending consumers: ${result.pendingConsumers.map(({ path, pendingFor }) => `${path.split("/").at(-1)} (${pendingFor})`).join(", ")}`;
    console.log(`locale path: ${result.scanned} source files + ${result.scannedScripts} acceptance scripts, one prefix implementation in ${MODULE_DIR} (${pending}); ${result.scriptExceptions} annotated script exception(s); ${result.ignoredSources} gitignored file(s) skipped`);
  }
}
