/** Prepare only the product's local Vite D1 storage before starting its dev server. */
import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildContext } from '../build/product-paths.mjs';
import { productOutputPath } from '../composition/project-context.mjs';
import { applyProductSchemas } from './schemas.mjs';
import { readProductDeployment } from './deployment.mjs';
import { developmentDate } from '../../packages/build/dsh-base-build-product/src/development.mjs';

export function localDevelopmentPaths(root, options = {}) {
  const context = buildContext(root, options);
  const owned = suffix => {
    const file = `${context.appPath}/.cloudflare/${suffix}`;
    const path = productOutputPath(context.productRoot, file);
    if (path !== resolve(context.productRoot, file)) throw new Error('Local application state cannot traverse symbolic links');
    return path;
  };
  return { context, resourcePersistencePath: owned('state/v3'), resourceTmpPath: owned('tmp') };
}

export async function prepareLocalDevelopmentDatabase(root, env = process.env, options = {}) {
  const { context, resourcePersistencePath, resourceTmpPath } = localDevelopmentPaths(root, { ...options, env });
  const deployment = readProductDeployment(root, { env, app: context.appId });
  const pluginRequire = createRequire(realpathSync(join(context.appRoot, 'node_modules/@cloudflare/vite-plugin/package.json')));
  const { Miniflare } = pluginRequire('miniflare');
  const { workerCompatibilityDate } = await import('../../packages/build/dsh-base-build-product/src/cloudflare.mjs');
  const compatibilityDate = developmentDate(context.appRoot, 'serve', workerCompatibilityDate, env);
  // These are the Vite plugin's native Miniflare v5 persistence and binding
  // contracts; no production API, deployment credential or remote Worker runs.
  const mf = new Miniflare({
    host: '127.0.0.1', port: 0, telemetry: { enabled: false },
    resourcePersistencePath,
    resourceTmpPath,
    workers: [{ config: {
      name: deployment.workerName, compatibilityDate,
      manifest: { mainModule: 'schema.mjs', modules: { 'schema.mjs': { type: 'esm', contents: 'export default { fetch() { return new Response("local schema preparation") } }' } } },
      env: { AUTH_DB: { type: 'd1', name: deployment.authDatabaseName, ...(deployment.authDatabaseId ? { id: deployment.authDatabaseId } : {}) } },
    } }],
  });
  try {
    await mf.ready;
    const database = await mf.getD1Database('AUTH_DB', deployment.workerName);
    const count = await applyProductSchemas(root, async sql => (await database.prepare(sql).all()).results);
    console.log(`Local development database: ${count} auth/plugin schemas ready in ${resourcePersistencePath}`);
  } finally { await mf.dispose(); }
}
