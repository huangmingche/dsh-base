#!/usr/bin/env node
/** Initialize a template checkout without provisioning cloud resources or exposing secrets. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { readDeploymentConfig } from "../../apps/web/scripts/deployment-config.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!args[i]?.startsWith("--") || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("Usage: pnpm template:init --worker-name my-app --auth-base-url https://my-app.example.com [--d1-id UUID] [--d1-name NAME] [--r2-bucket NAME]");
  options[args[i].slice(2)] = args[i + 1];
}
const allowed = new Set(["worker-name", "auth-base-url", "d1-id", "d1-name", "r2-bucket", "gateway-id", "brand-name"]);
for (const key of Object.keys(options)) if (!allowed.has(key)) throw new Error(`Unknown option --${key}`);
if (!options["worker-name"] || !options["auth-base-url"]) throw new Error("--worker-name and --auth-base-url are required");
const path = resolve(root, "apps/web/deployment.local.json");
if (existsSync(path)) throw new Error("deployment.local.json already exists; edit it explicitly instead of overwriting existing deployment identities");
const config = JSON.parse(readFileSync(resolve(root, "apps/web/deployment.example.json"), "utf8"));
Object.assign(config, { workerName: options["worker-name"], authBaseUrl: options["auth-base-url"], authDatabaseName: options["d1-name"] ?? `${options["worker-name"]}-auth`, authDatabaseId: options["d1-id"] ?? "", filesBucket: options["r2-bucket"] ?? `${options["worker-name"]}-files`, aiGatewayId: options["gateway-id"] ?? "", brandName: options["brand-name"] ?? options["worker-name"] });
const validated = readDeploymentConfig({}, undefined, config);
writeFileSync(path, `${JSON.stringify(validated, null, 2)}\n`, { flag: "wx", mode: 0o600 });
const devVars = resolve(root, "apps/web/.dev.vars");
if (!existsSync(devVars)) writeFileSync(devVars, `# Local development only. Set independent production secrets with cf secrets.\nAUTH_SECRET=${randomBytes(32).toString("base64url")}\nCREDENTIALS_KEY=${randomBytes(32).toString("base64")}\nAUTH_REGISTRATION_TOKEN=${randomBytes(32).toString("base64url")}\nPLUGIN_CONTROL_TOKEN=${randomBytes(32).toString("base64url")}\nAUTH_SIGNUP_ENABLED=false\nPLATFORM_AI_ENABLED=false\n`, { flag: "wx", mode: 0o600 });
console.log("Created ignored deployment.local.json and local development secrets. No cloud resources or production secrets were changed. Add your D1 id and deploy origin, then configure independent production secrets before deployment.");
