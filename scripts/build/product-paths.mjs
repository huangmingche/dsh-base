/** Build paths for a product consuming the base as a read-only submodule. */
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { projectContext, productOutputPath } from '../composition/project-context.mjs';
import { applicationContext } from '../composition/applications.mjs';
const baseRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export function cliProductRoot(args = process.argv.slice(2)) {
  const index = args.indexOf('--root');
  if (index >= 0 && (!args[index + 1] || args[index + 1].startsWith('--'))) throw new Error('--root requires a product directory');
  return resolve(index >= 0 ? args[index + 1] : process.env.DSH_PRODUCT_ROOT ?? baseRoot);
}
export function buildContext(root = baseRoot, options = {}) {
  const context = applicationContext(root, options);
  const typecheckRoot = productOutputPath(context.productRoot, context.isolated ? join(relative(context.productRoot, context.generatedRoot), '.artifacts/typecheck') : '.artifacts/typecheck');
  if (context.isolated && !typecheckRoot.startsWith(context.generatedRoot + sep)) throw new Error('Typecheck output escapes the application generated directory');
  return { ...context, typecheckRoot };
}
function appRelative(context, path) {
  return path === 'apps/web' || path.startsWith('apps/web/') ? context.appPath + path.slice('apps/web'.length) : path;
}
export function generatedPath(root, path) {
  if (isAbsolute(path) || path.split(/[\\/]/u).includes('..')) throw new Error(`Invalid generated relative path: ${path}`);
  const context = applicationContext(root);
  const target = appRelative(context, path);
  const output = productOutputPath(context.productRoot, context.isolated ? join(relative(context.productRoot, context.generatedRoot), target) : target);
  if (context.isolated && !output.startsWith(context.generatedRoot + sep)) throw new Error('Generated output escapes the application generated directory');
  return output;
}
export function outputPath(root, path, args = process.argv.slice(2)) {
  const index = args.indexOf('--output');
  if (index >= 0 && (!args[index + 1] || args[index + 1].startsWith('--'))) throw new Error('--output requires a path');
  const context = applicationContext(root);
  const output = index >= 0 ? productOutputPath(context.productRoot, relative(context.productRoot, resolve(args[index + 1]))) : generatedPath(context, path);
  if (context.consumer && (output === context.baseRoot || output.startsWith(context.baseRoot + sep))) throw new Error('Consumer output must not write into the read-only base');
  if (context.isolated && !output.startsWith(context.generatedRoot + sep)) throw new Error('Application output must stay in its own generated directory');
  if (!args.includes('--check') && !process.argv.includes('--check')) mkdirSync(dirname(output), { recursive: true });
  return output;
}
export function generatedModulePath(root, path) {
  const context = applicationContext(root);
  if (!context.isolated || path === context.generatedRoot || path.startsWith(context.generatedRoot + sep)) return undefined;
  if (!path.startsWith(context.baseRoot + sep) && !path.startsWith(context.appRoot + sep)) return undefined;
  const owner = path.startsWith(context.baseRoot + sep) ? context.baseRoot : context.productRoot;
  const local = relative(owner, path);
  if (local.startsWith('..') || isAbsolute(local) || !(local.startsWith('packages' + sep) || local.startsWith(join('apps', 'web') + sep) || local.startsWith(context.appPath + sep)) || local.split(sep).includes('node_modules')) return undefined;
  if (!/(?:\.generated\.(?:ts|mjs|js)|generated-composition(?:\.ts)?)$/u.test(local)) return undefined;
  const generated = generatedPath(context, local.endsWith('generated-composition') ? local + '.ts' : local);
  return generated;
}
