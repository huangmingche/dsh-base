/** Application selection is build configuration, never a runtime plugin roster. */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { baseRepoRoot, projectContext, productOutputPath } from './project-context.mjs';

const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const implicit = () => ({ version: 1, default: 'web', apps: [{ id: 'web', path: 'apps/web', platform: 'web' }] });

export function readApplications(root = baseRepoRoot) {
  const context = typeof root === 'object' ? root : projectContext(root);
  const file = join(context.productRoot, 'dsh.apps.json');
  const registry = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : implicit();
  if (!object(registry) || registry.version !== 1 || Object.keys(registry).some(key => !['version', 'default', 'apps'].includes(key))
    || !Array.isArray(registry.apps) || registry.apps.length === 0 || typeof registry.default !== 'string') {
    throw new Error('dsh.apps.json: expected version 1, default and a non-empty apps array');
  }
  const ids = new Set(), paths = new Set();
  for (const app of registry.apps) {
    if (!object(app) || Object.keys(app).some(key => !['id', 'path', 'platform'].includes(key))
      || typeof app.id !== 'string' || !slug.test(app.id) || typeof app.path !== 'string'
      || !/^apps\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(app.path)) throw new Error('dsh.apps.json: each app requires a unique slug id and an apps/<name> path');
    if (app.platform !== 'web') throw new Error(`${app.id}: unsupported application platform; only web is implemented`);
    if (ids.has(app.id) || paths.has(app.path)) throw new Error(`dsh.apps.json: duplicate application id or path: ${app.id}`);
    const actual = productOutputPath(context.productRoot, app.path);
    if (actual !== resolve(context.productRoot, app.path)) throw new Error(`${app.id}: application directories cannot traverse symbolic links`);
    ids.add(app.id); paths.add(app.path);
  }
  if (!ids.has(registry.default)) throw new Error('dsh.apps.json: default must reference a declared application');
  return registry;
}

export function cliApplication(args = process.argv.slice(2)) {
  const positions = args.flatMap((value, index) => value === '--app' ? [index] : []);
  if (positions.length > 1) throw new Error('--app may be specified only once');
  if (!positions.length) return undefined;
  const value = args[positions[0] + 1];
  if (!value || value.startsWith('--')) throw new Error('--app requires an application id');
  return value;
}

export function applicationContext(root = baseRepoRoot, options = {}) {
  if (typeof root === 'object' && root.appId && Object.keys(options).length === 0) return root;
  const context = typeof root === 'object' ? root : projectContext(root);
  const registry = readApplications(context);
  const explicit = options.app ?? cliApplication() ?? (options.env ?? process.env).DSH_APP;
  const byPath = options.appRoot === undefined ? undefined : registry.apps.find(app => resolve(context.productRoot, app.path) === resolve(options.appRoot));
  if (options.appRoot !== undefined && !byPath) throw new Error('Application root must match a declared dsh.apps.json application');
  if (byPath && explicit !== undefined && byPath.id !== explicit) throw new Error('Application id and application root disagree');
  const app = registry.apps.find(app => app.id === (explicit ?? byPath?.id ?? registry.default));
  if (!app) throw new Error(`Unknown application: ${explicit}; declare it in dsh.apps.json`);
  const isolated = context.consumer || app.path !== 'apps/web' || app.id !== 'web';
  const generatedRelative = app.path === 'apps/web' && app.id === 'web' ? '.artifacts/dsh' : `.artifacts/dsh/applications/${app.id}`;
  const generatedRoot = productOutputPath(context.productRoot, generatedRelative);
  if (generatedRoot !== resolve(context.productRoot, generatedRelative)) throw new Error('Application generated directory cannot traverse symbolic links');
  const appRoot = productOutputPath(context.productRoot, app.path);
  return { ...context, appId: app.id, appPath: app.path, appRoot, profilePath: join(appRoot, 'composition.profile.json'), isolated, generatedRoot };
}
