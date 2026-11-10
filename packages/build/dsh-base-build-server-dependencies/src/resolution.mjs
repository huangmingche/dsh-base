/** Build/test resolution for the isolated server SDK peer environment. Never imported by runtime code. */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { buildContext } from '../../../../scripts/build/product-paths.mjs';
export const serverManifestPath = fileURLToPath(new URL('../package.json', import.meta.url));
export const serverRequire = createRequire(serverManifestPath);
export const serverPackageNames = Object.freeze(['@cloudflare/think', 'agents', '@cloudflare/computer']);
export function serverPackageName(specifier) {
  return serverPackageNames.find(name => specifier === name || specifier.startsWith(`${name}/`));
}
export function getServerManifestPath(productRoot) {
  if (productRoot === undefined) return serverManifestPath;
  const context = buildContext(productRoot);
  return context.consumer ? join(context.productRoot, 'packages/build/product-server-dependencies/package.json') : serverManifestPath;
}
export function serverPackageDirectory(name, productRoot) {
  if (!serverPackageNames.includes(name)) throw new Error(`Not an isolated server dependency: ${name}`);
  return resolve(getServerManifestPath(productRoot), '../node_modules', name);
}
