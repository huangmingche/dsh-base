/** Build/test resolution for the isolated server SDK peer environment. Never imported by runtime code. */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
export const serverManifestPath = fileURLToPath(new URL('../package.json', import.meta.url));
export const serverRequire = createRequire(serverManifestPath);
export const serverPackageNames = Object.freeze(['@cloudflare/think', 'agents', '@cloudflare/computer']);
export function serverPackageName(specifier) {
  return serverPackageNames.find(name => specifier === name || specifier.startsWith(`${name}/`));
}
export function serverPackageDirectory(name) {
  if (!serverPackageNames.includes(name)) throw new Error(`Not an isolated server dependency: ${name}`);
  return resolve(serverManifestPath, '../node_modules', name);
}
