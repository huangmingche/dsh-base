#!/usr/bin/env node
/** Deploy the plugin-owned additive D1 schema before publishing its Worker. */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { readDeploymentConfig, requireDeployableConfig } from "./deployment-config.mjs";

const config = requireDeployableConfig(readDeploymentConfig());
const sql = readFileSync(new URL("../../../packages/cloudflare-worker/dsh-base-cloudflare-worker-site-config/schema.sql", import.meta.url), "utf8");
// Bind the value explicitly: a schema starting with a SQL `--` comment must
// not be interpreted by the CLI as another option.
const result = spawnSync("pnpm", ["exec", "cf", "d1", "query", config.authDatabaseId, `--sql=${sql}`], {
  cwd: new URL("../", import.meta.url), encoding: "utf8",
});
if (result.status !== 0) throw new Error(`Site settings schema failed: ${result.stderr || result.error || result.stdout}`);
const rows = JSON.parse(result.stdout);
if (!Array.isArray(rows) || rows.length === 0 || rows.some(row => row.success !== true)) throw new Error("Site settings schema was not confirmed by D1");
console.log("Plugin-owned site settings schema applied.");
