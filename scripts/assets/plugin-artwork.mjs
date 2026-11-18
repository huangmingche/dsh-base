import { outputPath } from "../build/product-paths.mjs";
/** Build metadata artwork from the same pinned stable exports as the site icon. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../conformance/lib.mjs';
import { readOfficialSiteMark } from './official-site-mark.mjs';

export function generatePluginArtwork(check = false, root = repoRoot) {
  const mark = readOfficialSiteMark(root);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${mark.viewBox.width} ${mark.viewBox.height}"><path d="${mark.path}" fill="currentColor"/></svg>`;
  const source = `// Generated asset metadata; do not edit. No official implementation is copied.\n// ${mark.source.package} stable exports; ${mark.source.commit}; ${mark.source.license}.\nexport const DSH_BASE_PLUGIN_ICON = ${JSON.stringify(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)};\n`;
  const target = outputPath(root, 'packages/client/dsh-base-client-plugin-manager/src/client/brand-artwork.generated.ts', []);
  if (check) {
    let current; try { current = readFileSync(target, 'utf8'); } catch { /* Missing is stale. */ }
    if (current !== source) throw new Error('Plugin brand artwork is stale; regenerate the owned plugin inventory.');
  } else writeFileSync(target, source);
}
