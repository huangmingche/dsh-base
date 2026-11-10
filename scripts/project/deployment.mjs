/** Product deployment identity never falls back to the base template defaults. */
import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { deploymentDefaults, readDeploymentConfig, requireDeployableConfig } from '../../apps/web/scripts/deployment-config.mjs';
import { applicationContext, readApplications } from '../composition/applications.mjs';

export function productDeploymentPath(productRoot, env = process.env, explicitPath, options = {}) {
  const context = applicationContext(productRoot, { ...options, env });
  const selected = explicitPath ?? env.DSH_DEPLOYMENT_CONFIG;
  const local = join(context.appRoot, 'deployment.local.json');
  const path = selected === undefined
    ? (existsSync(local) ? local : join(context.appRoot, 'deployment.example.json'))
    : resolve(productRoot, selected);
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`Product deployment configuration is missing: ${path}`);
  return path;
}

export function readProductDeployment(productRoot, { env = process.env, path, app, requireDeployable = false } = {}) {
  const context = applicationContext(productRoot, { app, env });
  const config = readDeploymentConfig(env, productDeploymentPath(productRoot, env, path, { app: context.appId }));
  const isBaseWeb = !context.consumer && context.appId === 'web' && context.appPath === 'apps/web' && existsSync(join(productRoot, 'dsh-source.lock.json'));
  if (!isBaseWeb) for (const key of ['workerName', 'authDatabaseName', 'filesBucket']) {
    if (config[key] === deploymentDefaults[key]) throw new Error(`Product ${key} must use an independent resource name; the base template identity is reserved`);
  }
  // Deployment overrides belong only to the selected app. Compare peers using
  // their own configurations, never the current process's shared overrides.
  for (const peer of readApplications(productRoot).apps.filter(candidate => candidate.id !== context.appId)) {
    const other = readDeploymentConfig({}, productDeploymentPath(productRoot, {}, undefined, { app: peer.id }));
    for (const key of ['workerName', 'authDatabaseName', 'authDatabaseId', 'filesBucket', 'authBaseUrl']) {
      const identity = key === 'authDatabaseId' ? config[key].toLowerCase() : config[key];
      const peerIdentity = key === 'authDatabaseId' ? other[key].toLowerCase() : other[key];
      if (identity !== '' && identity === peerIdentity) throw new Error(`Application ${context.appId} shares ${key} with ${peer.id}; applications require independent deployment resources`);
    }
    if (config.saas.cacheEnabled && other.saas.cacheEnabled && config.saas.cacheNamespaceId === other.saas.cacheNamespaceId) {
      throw new Error(`Application ${context.appId} shares a KV namespace with ${peer.id}; applications require independent deployment resources`);
    }
  }
  return requireDeployable ? requireDeployableConfig(config) : config;
}
