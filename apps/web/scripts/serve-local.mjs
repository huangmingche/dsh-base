#!/usr/bin/env node
/** Serve the built Worker with isolated local D1/R2/DOs. No deployed resources or model credentials. */
import { createRequire } from "node:module";
import { readFileSync, realpathSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(realpathSync(join(app, "node_modules/@cloudflare/vite-plugin/package.json")));
const { Miniflare, convertV4MiniflareOptions } = require("miniflare");
const output = join(app, ".cloudflare/output/v0/workers/default");
const config = JSON.parse(readFileSync(join(output, "worker.config.json"), "utf8"));
const port = Number(process.env.DSH_LOCAL_PORT ?? 5179);
const bindings = Object.fromEntries(Object.entries(config.env).filter(([, row]) => row.type === "text").map(([key, row]) => [key, row.value]));
Object.assign(bindings, {
  AUTH_BASE_URL: `http://127.0.0.1:${port}`, AUTH_SECRET: randomBytes(32).toString("hex"),
  CREDENTIALS_KEY: randomBytes(32).toString("base64"), SITE_ENVIRONMENT_LABEL: "Local acceptance",
  AUTH_SIGNUP_ENABLED: "false",
  PLATFORM_AI_ENABLED: process.env.DSH_LOCAL_PLATFORM_AI === "1" ? "true" : "false",
  ...(process.env.DSH_LOCAL_PLATFORM_AI === "1" ? { AI_GATEWAY_ID: "local-fixture-gateway" } : {}),
  AUTH_REGISTRATION_TOKEN: process.env.DSH_LOCAL_REGISTRATION_TOKEN ?? randomBytes(32).toString("base64url"),
});
const directory = mkdtempSync(join(tmpdir(), "dsh-base-local-"));
const mf = new Miniflare(convertV4MiniflareOptions({
  host: "127.0.0.1", port, modulesRoot: join(output, "bundle"),
  modules: ["index.js", ...readdirSync(join(output, "bundle"), { recursive: true }).filter(file => file.endsWith(".js") && file !== "index.js")].map(file => ({ type: "ESModule", path: join(output, "bundle", file) })),
  compatibilityDate: process.env.DSH_LOCAL_COMPATIBILITY_DATE ?? config.compatibilityDate,
  compatibilityFlags: config.compatibilityFlags, bindings,
  ...(process.env.DSH_LOCAL_FORBID_OUTBOUND === "1" ? {
    outboundService: async request => {
      console.error(`LOCAL_OUTBOUND_REQUEST ${new URL(request.url).origin}`);
      return new Response("Outbound network is forbidden in local UI acceptance", { status: 503 });
    },
  } : {}),
  durableObjects: Object.fromEntries(Object.entries(config.env).filter(([, row]) => row.type === "durable-object").map(([name, row]) => [name, { className: row.exportName, useSQLite: true }])),
  durableObjectsPersist: join(directory, "do"), d1Databases: ["AUTH_DB"], d1Persist: join(directory, "d1"),
  r2Buckets: ["FILES"], r2Persist: join(directory, "r2"),
  assets: { directory: join(output, "assets"), binding: "ASSETS", run_worker_first: true, routerConfig: { has_user_worker: true },
    assetConfig: { not_found_handling: "single-page-application" } },
}));
await mf.ready;
const db = await mf.getD1Database("AUTH_DB");
for (const file of readdirSync(join(app, "migrations")).filter(file => file.endsWith(".sql")).sort()) {
  const sql = readFileSync(join(app, "migrations", file), "utf8").replace(/--[^\n]*/g, "");
  for (const statement of sql.split(";").filter(statement => statement.trim())) await db.prepare(statement).run();
}
console.log(`Local Worker ready: http://127.0.0.1:${port}; compatibility ${process.env.DSH_LOCAL_COMPATIBILITY_DATE ?? config.compatibilityDate}`);
console.log("Isolated local storage; AI provider unavailable. Use deployed acceptance separately for model execution.");
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => { await mf.dispose(); rmSync(directory, { recursive: true, force: true }); process.exit(0); });
