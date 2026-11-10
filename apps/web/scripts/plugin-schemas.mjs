/** Plugin-owned additive schema inventory, shared by local and remote provisioning. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { localPackages, repoRoot } from "../../../scripts/conformance/lib.mjs";
import { projectContext } from "../../../scripts/composition/project-context.mjs";
export function pluginSchemas(root = repoRoot) {
  const { baseRoot } = projectContext(root);
  return localPackages(root).filter(pkg => pkg.manifest.dshBase?.worker && existsSync(join(pkg.directoryPath, "schema.sql")))
    // Product schemas may extend base tables regardless of alphabetical scope.
    // Within each owner layer the existing deterministic package order remains.
    .sort((a, b) => Number(a.ownerRoot !== baseRoot) - Number(b.ownerRoot !== baseRoot) || a.manifest.name.localeCompare(b.manifest.name))
    .map(pkg => ({ name: pkg.manifest.name, sql: readFileSync(join(pkg.directoryPath, "schema.sql"), "utf8") }));
}
export async function applyPluginSchema(schema, query) {
  const statements = schema.sql.replace(/--[^\n]*/gu, "").split(";").map(sql => sql.trim()).filter(Boolean);
  for (const statement of statements) {
    const alter = /^ALTER TABLE "?([a-zA-Z_][a-zA-Z0-9_]*)"? ADD COLUMN "?([a-zA-Z_][a-zA-Z0-9_]*)"? (TEXT|INTEGER)(?: DEFAULT (?:0|1|NULL))?$/iu.exec(statement);
    if (alter) {
      const columns = await query(`PRAGMA table_info("${alter[1]}")`);
      if (columns.length === 0) throw new Error(`${schema.name}: base table ${alter[1]} is missing`);
      const existing = columns.find(row => row.name === alter[2]);
      if (existing) {
        if (existing.type.toUpperCase() !== alter[3].toUpperCase()) throw new Error(`${schema.name}: incompatible existing column ${alter[2]}`);
        continue;
      }
    } else if (!/^CREATE (?:TABLE|(?:UNIQUE )?INDEX) IF NOT EXISTS\s/iu.test(statement)) {
      throw new Error(`${schema.name}: only reviewed additive schema statements can be applied automatically`);
    }
    await query(statement);
  }
}
