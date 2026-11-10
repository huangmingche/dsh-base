#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readDeploymentConfig, requireDeployableConfig } from "./deployment-config.mjs";
import { applyPluginSchema, pluginSchemas } from "./plugin-schemas.mjs";
const config = requireDeployableConfig(readDeploymentConfig());
const query = async sql => {
  const result = spawnSync("pnpm", ["exec", "cf", "d1", "query", config.authDatabaseId, `--sql=${sql}`], { cwd: new URL("../", import.meta.url), encoding: "utf8" });
  if (result.status !== 0) throw new Error("Plugin schema query failed; no deployment was started");
  const groups = JSON.parse(result.stdout);
  if (!Array.isArray(groups) || groups.length === 0 || groups.some(row => row.success !== true)) throw new Error("D1 did not confirm the plugin schema query");
  return groups.flatMap(row => row.results ?? []);
};
for (const schema of pluginSchemas()) { await applyPluginSchema(schema, query); console.log(`Applied additive schema: ${schema.name}`); }
