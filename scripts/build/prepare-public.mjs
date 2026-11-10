#!/usr/bin/env node
/** Project shipped asset data into a consumer's output; never copy executable official source. */
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { isMain } from '../conformance/lib.mjs';
import { buildContext, cliProductRoot, generatedPath } from './product-paths.mjs';
import { ASSET_SIZES, versionModule } from '../assets/generate-site-assets.mjs';
import { readOfficialSiteMark, sha256 } from '../assets/official-site-mark.mjs';

export function prepareProductPublic(root, options = {}) {
  const context = buildContext(root, options);
  if (!context.isolated) return;
  const target = generatedPath(context, join(context.appPath, 'public'));
  const basePublic = join(context.baseRoot, 'apps/web/public');
  const appPublic = join(context.appRoot, 'public');
  // Reject an invalid input tree before deleting an earlier successful build.
  // In particular a public symlink must never alias this application's output.
  const validateSource = source => {
    if (!existsSync(source)) return;
    if (lstatSync(source).isSymbolicLink()) throw new Error(`Public assets cannot contain symbolic links: ${source}`);
    if (source === target || source.startsWith(target + sep) || target.startsWith(source + sep)) throw new Error('Public input and generated output must not overlap');
    if (lstatSync(source).isDirectory()) for (const name of readdirSync(source)) validateSource(join(source, name));
  };
  validateSource(basePublic);
  validateSource(appPublic);
  const provenance = JSON.parse(readFileSync(join(context.baseRoot, 'scripts/assets/site-assets.provenance.json'), 'utf8'));
  const mark = readOfficialSiteMark(root);
  if (JSON.stringify(provenance.source) !== JSON.stringify(mark.source)) throw new Error('Base public asset provenance does not match the pinned official source');
  for (const [path, expected] of Object.entries(provenance.assets)) {
    if (sha256(readFileSync(join(basePublic, path.slice(1)))) !== expected.sha256) throw new Error(`Base public asset is stale: ${path}`);
  }
  rmSync(target, { recursive: true, force: true });
  const retiredInventory = join(target, 'third-party-notices.txt');
  const copy = (source, output) => {
    if (output === retiredInventory || !existsSync(source)) return;
    if (lstatSync(source).isSymbolicLink()) throw new Error(`Public assets cannot contain symbolic links: ${source}`);
    if (lstatSync(source).isDirectory()) {
      mkdirSync(output, { recursive: true });
      for (const name of readdirSync(source)) copy(join(source, name), join(output, name));
    } else {
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, readFileSync(source));
    }
  };
  copy(basePublic, target);
  copy(appPublic, target);
  const assets = Object.fromEntries(Object.entries(ASSET_SIZES).map(([path, [width, height]]) => {
    const bytes = readFileSync(join(target, path.slice(1)));
    return [path, { sha256: sha256(bytes), bytes: bytes.length, width, height }];
  }));
  const versions = generatedPath(context, 'packages/boot/dsh-base-site-seo/src/assets.generated.ts');
  mkdirSync(dirname(versions), { recursive: true });
  writeFileSync(versions, versionModule(assets, mark.source));
  const provenancePath = generatedPath(context, 'scripts/assets/site-assets.provenance.json');
  mkdirSync(dirname(provenancePath), { recursive: true });
  writeFileSync(provenancePath, JSON.stringify({ ...provenance, assets }, null, 2) + '\n');
  console.log(`product public assets: ${target}`);
}
if (isMain(import.meta.url)) prepareProductPublic(cliProductRoot());
