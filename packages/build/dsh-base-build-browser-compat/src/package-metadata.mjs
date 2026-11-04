/** Resolve one statically known package-metadata read before bundling for Workers. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** @returns {import('vite').Plugin} */
export function sourcePackageMetadata({ sourceRoot }) {
  const packageRoot = join(sourceRoot, 'packages/llm/llm');
  const sourcePath = join(packageRoot, 'src/attribution.ts');
  const manifestPath = join(packageRoot, 'package.json');
  return {
    name: 'dsh-base:source-package-metadata',
    enforce: 'pre',
    transform(code, id) {
      if (id !== sourcePath) return null;
      // This is the package's exported public manifest, never deployment/user
      // configuration. Review the seam if the pinned source changes its read.
      const call = /\bcreateRequire\(import\.meta\.url\)\(['"]\.\.\/package\.json['"]\)/gu;
      if ([...code.matchAll(call)].length !== 1
        || !/import\s*\{\s*createRequire\s*\}\s*from\s*['"]node:module['"]/u.test(code)) {
        throw new Error('Pinned LLM attribution package-metadata read changed; review the build seam');
      }
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (manifest.name !== '@deepseek-ai/dsh-llm' || typeof manifest.version !== 'string' || manifest.version.length === 0
        || manifest.exports?.['./package.json'] !== './package.json') {
        throw new Error('Pinned LLM attribution requires its exported package name and version');
      }
      this.addWatchFile(manifestPath);
      // Only the static read changes. Identity/header functions remain the
      // official implementation; the unused Node import is removed by bundling.
      return { code: code.replace(call, `(${JSON.stringify({ version: manifest.version })})`), map: null };
    },
  };
}
