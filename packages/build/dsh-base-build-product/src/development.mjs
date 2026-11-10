/** Select a local runtime date from the product's actually installed workerd. */
import { createRequire } from 'node:module';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value)
  && !Number.isNaN(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
export function installedWorkerdDate(appRoot) {
  const pluginRequire = createRequire(realpathSync(join(appRoot, 'node_modules/@cloudflare/vite-plugin/package.json')));
  const miniflareRequire = createRequire(pluginRequire.resolve('miniflare/package.json'));
  const runtime = miniflareRequire('workerd');
  if (validDate(runtime.compatibilityDate)) return runtime.compatibilityDate;
  const version = miniflareRequire('workerd/package.json').version;
  const match = /^1\.(\d{4})(\d{2})(\d{2})\.\d+(?:[-+].*)?$/u.exec(version ?? '');
  const fallback = match && `${match[1]}-${match[2]}-${match[3]}`;
  if (!validDate(fallback)) throw new Error('Cannot read the installed workerd compatibility date; set DSH_LOCAL_COMPATIBILITY_DATE explicitly for development');
  return fallback;
}
export function selectDevelopmentDate({ command, productionDate, supportedDate, override }) {
  if (command !== 'serve') return undefined;
  if (!validDate(productionDate)) throw new Error('Invalid production compatibility date');
  if (override !== undefined) {
    if (!validDate(override)) throw new Error('DSH_LOCAL_COMPATIBILITY_DATE must be a valid YYYY-MM-DD date');
    return override;
  }
  if (!validDate(supportedDate)) throw new Error('Cannot read the installed workerd compatibility date; set DSH_LOCAL_COMPATIBILITY_DATE explicitly for development');
  return supportedDate < productionDate ? supportedDate : productionDate;
}
export function developmentDate(appRoot, command, productionDate, env = process.env) {
  if (command !== 'serve') return undefined;
  const override = env.DSH_LOCAL_COMPATIBILITY_DATE;
  const date = selectDevelopmentDate({ command, productionDate, override, supportedDate: override === undefined ? installedWorkerdDate(appRoot) : undefined });
  if (date !== productionDate) console.info(`dsh-base local development: compatibility date ${date}; production builds retain ${productionDate}`);
  return date;
}

/** Only the local auth origin is a mutable text binding. Native Cloudflare
 * .dev.vars handling otherwise supplies secret bindings, not text overrides. */
export function developmentWorkerOverrides(appRoot, { command, mode = 'development', consumer = false, compatibilityDate }, env = process.env) {
  if (command !== 'serve') return undefined;
  const config = { compatibilityDate };
  if (!consumer) return config;
  const file = [`.dev.vars.${mode}`, '.dev.vars'].map(name => join(appRoot, name)).find(existsSync);
  const values = file ? parseEnv(readFileSync(file, 'utf8')) : env;
  const value = values.AUTH_BASE_URL;
  if (!value) throw new Error(`Local development requires AUTH_BASE_URL in ${join(appRoot, '.dev.vars')} matching the browser origin (for example http://localhost:5173)`);
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Local AUTH_BASE_URL must be an HTTP(S) origin');
  return { ...config, env: { AUTH_BASE_URL: { type: 'text', value: url.origin } } };
}
