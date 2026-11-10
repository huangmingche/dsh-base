/** One additive schema sequence for local development and explicit deployment. */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildContext } from '../build/product-paths.mjs';
import { applyPluginSchema, pluginSchemas } from '../../apps/web/scripts/plugin-schemas.mjs';

/** Existing auth migrations precede plugin ALTER statements. Reuse the additive
 * schema applicator so repeated local or explicitly requested deployment preparation preserve existing local accounts. */
export async function applyProductSchemas(root, query) {
  const context = buildContext(root);
  const directory = join(context.baseRoot, 'apps/web/migrations');
  const schemas = existsSync(directory) ? readdirSync(directory).filter(name => name.endsWith('.sql')).sort().map(name => ({
    name: `base-auth:${name}`,
    sql: readFileSync(join(directory, name), 'utf8')
      .replace(/\bCREATE TABLE (?!IF NOT EXISTS)/gu, 'CREATE TABLE IF NOT EXISTS ')
      .replace(/\bCREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/gu, (_, unique = '') => `CREATE ${unique}INDEX IF NOT EXISTS `),
  })) : [];
  schemas.push(...pluginSchemas(root));
  for (const schema of schemas) await applyPluginSchema(schema, query);
  return schemas.length;
}
