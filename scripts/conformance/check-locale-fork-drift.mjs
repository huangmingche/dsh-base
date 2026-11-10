#!/usr/bin/env node
/**
 * Drift guard: the locale-label fork must stay "official + approved edits".
 *
 * The fork permanently replaces `@deepseek-ai/dsh-client-locale`, so an unmarked
 * upstream drift would silently ship an almost-official locale implementation.
 * This check re-derives the fork from the pinned official source and fails on any
 * unapproved difference, on a missing replacement anchor (official changed the text the
 * replacement depends on), or when `dshBase.forkOf.commit` no longer matches the
 * pinned commit.
 *
 * Upgrade procedure (ADR §9.5): bump the pin → run this check → judge each new
 * difference → sync official behavior / keep and register our own → the check must
 * return to exactly the explicitly approved edits.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const FORK_ROOT = "packages/client/dsh-base-client-locale-label";
const FORK_INDEX = "client/index.ts";

/** Approved differences, expressed as deterministic single-hit edits. */
export const APPROVED_EDITS = Object.freeze([
  {
    name: "config-reexport",
    from: "export type { LanguageOptionRow, LanguageRowState } from './settings-store.ts'\n",
    to: "export type { LanguageOptionRow, LanguageRowState } from './settings-store.ts'\nexport { Config } from '../index.ts'\n",
  },
  {
    name: "zh-display-label",
    from: "  zh: { label: '中文', fallback: 'en' },",
    to: "  zh: { label: '简体中文', fallback: 'en' },",
  },
  {
    name: "site-title-host-import",
    from: "import { createLanguageRowStore } from './settings-store.ts'\n",
    to: "import { createLanguageRowStore } from './settings-store.ts'\nimport type {} from '@dsh-base/client-site-config/client'\nimport { createSiteTitleLocaleFace } from '@dsh-base/client-site-config/title-face'\n",
  },
  {
    name: "site-title-host-dependency",
    from: "export const inject = ['slots', 'remote', 'configForms']",
    to: "export const inject = ['slots', 'remote', 'configForms', 'siteConfig']",
  },
  {
    name: "site-title-locale-face",
    from: "  ctx.slots.installLocale(locale)",
    to: "  const titleFace = createSiteTitleLocaleFace(locale, ctx.siteConfig)\n  ctx.effect(() => () => { titleFace.dispose() }, 'locale: public site title')\n  ctx.slots.installLocale(titleFace)",
  },
]);

const listFiles = (root, base = root) => {
  const out = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(path, base));
    else out.push(relative(base, path).split("\\").join("/"));
  }
  return out.sort();
};

/**
 * @param {{ forkSrc: string, officialSrc: string, pinCommit: string, forkCommit: string, forkPackage: string, forkPath: string }} input
 * @returns {string[]} violations; empty means the fork is exactly official + approved edits
 */
export function verifyLocaleFork({ forkSrc, officialSrc, pinCommit, forkCommit, forkPackage, forkPath }) {
  const errors = [];
  if (forkPackage !== "@deepseek-ai/dsh-client-locale") errors.push(`dshBase.forkOf.package must be @deepseek-ai/dsh-client-locale, got ${String(forkPackage)}`);
  if (forkPath !== "packages/client/locale") errors.push(`dshBase.forkOf.path must be packages/client/locale, got ${String(forkPath)}`);
  if (forkCommit !== pinCommit) errors.push(`dshBase.forkOf.commit ${String(forkCommit)} does not match the pinned commit ${pinCommit}; bump the fork registration together with the pin`);
  if (!existsSync(forkSrc)) return [...errors, `fork source missing: ${forkSrc}`];
  if (!existsSync(officialSrc)) return [...errors, `pinned official source missing: ${officialSrc}`];

  const forkFiles = listFiles(forkSrc);
  const officialFiles = listFiles(officialSrc);
  const missing = officialFiles.filter(file => !forkFiles.includes(file));
  const extra = forkFiles.filter(file => !officialFiles.includes(file));
  for (const file of missing) errors.push(`fork is missing official file src/${file}`);
  for (const file of extra) errors.push(`fork has file src/${file} that the pinned official package does not have`);
  if (errors.length > 0) return errors;

  for (const file of officialFiles) {
    if (file === FORK_INDEX) continue;
    const official = readFileSync(join(officialSrc, file));
    const fork = readFileSync(join(forkSrc, file));
    if (!official.equals(fork)) errors.push(`unapproved difference in src/${file}: only ${FORK_INDEX} may differ (${APPROVED_EDITS.map(edit => edit.name).join(", ")})`);
  }

  let expected = readFileSync(join(officialSrc, FORK_INDEX), "utf8");
  for (const edit of APPROVED_EDITS) {
    const hits = expected.split(edit.from).length - 1;
    if (hits !== 1) {
      errors.push(`approved edit "${edit.name}" matched ${hits} times in the pinned official ${FORK_INDEX}; the official source changed and the fork needs a manual sync (ADR §9.5)`);
      continue;
    }
    expected = expected.replace(edit.from, edit.to);
  }
  if (errors.length === 0) {
    const actual = readFileSync(join(forkSrc, FORK_INDEX), "utf8");
    if (actual !== expected) errors.push(`src/${FORK_INDEX} differs from "pinned official + approved edits" (${APPROVED_EDITS.map(edit => edit.name).join(", ")})`);
  }
  return errors;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pinCommit = JSON.parse(readFileSync(join(repoRoot, "dsh-source.lock.json"), "utf8")).commit;
  const manifest = JSON.parse(readFileSync(join(repoRoot, FORK_ROOT, "package.json"), "utf8"));
  const errors = verifyLocaleFork({
    forkSrc: join(repoRoot, FORK_ROOT, "src"),
    officialSrc: join(repoRoot, ".submodules/deepseek-harness/packages/client/locale/src"),
    pinCommit,
    forkCommit: manifest.dshBase?.forkOf?.commit,
    forkPackage: manifest.dshBase?.forkOf?.package,
    forkPath: manifest.dshBase?.forkOf?.path,
  });
  if (errors.length > 0) {
    console.error(`locale fork drift: ${errors.length} violation(s)`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exitCode = 1;
  } else {
    console.log(`locale fork drift: src/ equals the pinned official package plus ${APPROVED_EDITS.length} approved edits (${APPROVED_EDITS.map(edit => edit.name).join(", ")}) at ${pinCommit.slice(0, 8)}`);
  }
}
