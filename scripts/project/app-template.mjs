/** Thin application scaffolds: feature implementations remain in plugin packages. */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { readDeploymentConfig } from '../../apps/web/scripts/deployment-config.mjs';

export const jsonFile = value => JSON.stringify(value, null, 2) + '\n';
export function applicationFiles({ productRoot, baseRoot, namespace, id, appPath = `apps/${id}`, dependencies, workerName = `${namespace}-${id}`, authBaseUrl }) {
  const baseApp = JSON.parse(readFileSync(join(baseRoot, 'apps/web/package.json'), 'utf8'));
  const link = (file, target) => { const value = relative(join(productRoot, dirname(`${appPath}/${file}`)), join(baseRoot, target)).split('\\').join('/'); return value.startsWith('.') ? value : `./${value}`; };
  const deployment = readDeploymentConfig({}, undefined, {
    workerName, authBaseUrl: authBaseUrl ?? `https://${workerName}.example.com`,
    authDatabaseName: `${workerName}-auth`, authDatabaseId: '', filesBucket: `${workerName}-files`,
    brandName: namespace, signupEnabled: false, platformAiEnabled: false, siteAdminUserIds: [],
    indexing: { environment: 'production', enabled: false },
  });
  return { deployment, files: new Map(Object.entries({
    'package.json': jsonFile({ name: `@${namespace}/${id}`, private: true, type: 'module', version: baseApp.version, ...dependencies }),
    'composition.profile.json': jsonFile({ client: [] }),
    'deployment.example.json': jsonFile(deployment),
    'deployment.local.json': jsonFile(deployment),
    'index.html': readFileSync(join(baseRoot, 'apps/web/index.html'), 'utf8'),
    'vite.config.ts': `import { fileURLToPath } from 'node:url';\nimport { defineDshViteConfig } from '${link('vite.config.ts', 'packages/build/dsh-base-build-product/src/vite.mjs')}';\nexport default defineDshViteConfig({ appRoot: fileURLToPath(new URL('.', import.meta.url)), productRoot: fileURLToPath(new URL('../..', import.meta.url)) });\n`,
    'cloudflare.config.ts': `import * as cf from 'cf/config';\nimport { fileURLToPath } from 'node:url';\nimport { createDshCloudflareConfig } from '${link('cloudflare.config.ts', 'packages/build/dsh-base-build-product/src/cloudflare.mjs')}';\nexport default createDshCloudflareConfig(cf, { appRoot: fileURLToPath(new URL('.', import.meta.url)), productRoot: fileURLToPath(new URL('../..', import.meta.url)) });\n`,
    'src/server.ts': `export { default, DshAgent, AuthStoreObject, PluginControl, SessionHostObject, DshSubagent } from '${link('src/server.ts', 'apps/web/src/server')}';\n`,
    'src/client/main.tsx': `import '${link('src/client/main.tsx', 'apps/web/src/client/main')}';\n`,
    'src/env.d.ts': `/// <reference types="@cloudflare/workers-types" />\nexport type { Env } from '${link('src/env.d.ts', 'apps/web/src/env')}';\n`,
    '.dev.vars': `# Local development only. Production uses independent Worker Secrets.\n# Match AUTH_BASE_URL to the actual host/port printed by the dev server.\nAUTH_BASE_URL=http://localhost:5173\nAUTH_SECRET=${randomBytes(32).toString('base64url')}\nCREDENTIALS_KEY=${randomBytes(32).toString('base64')}\nAUTH_REGISTRATION_TOKEN=${randomBytes(32).toString('base64url')}\nPLUGIN_CONTROL_TOKEN=${randomBytes(32).toString('base64url')}\nAUTH_SIGNUP_ENABLED=false\nPLATFORM_AI_ENABLED=false\n`,
  }).map(([file, content]) => [`${appPath}/${file}`, content])) };
}
