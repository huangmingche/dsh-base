/** Public template defaults plus explicit local/operator deployment configuration. */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readSaasConfig } from "./saas-config.mjs";

export const localDeploymentPath = fileURLToPath(new URL("../deployment.local.json", import.meta.url));
export const deploymentDefaults = Object.freeze({
  workerName: "dsh-base", authDatabaseName: "dsh-base-auth", authDatabaseId: "",
  filesBucket: "dsh-base-files", aiGatewayId: "", authBaseUrl: "http://localhost:5173",
  environmentLabel: "Local", brandName: "DSH Base", docsUrl: "",
  signupEnabled: false, platformAiEnabled: false, seo: Object.freeze({}),
  siteAdminUserIds: Object.freeze([]),
  saas: Object.freeze({}),
  indexing: Object.freeze({ environment: "staging", enabled: false }),
});
const environmentKeys = {
  workerName: "DSH_WORKER_NAME", authDatabaseName: "DSH_D1_DATABASE_NAME", authDatabaseId: "DSH_D1_DATABASE_ID",
  filesBucket: "DSH_R2_BUCKET_NAME", aiGatewayId: "DSH_AI_GATEWAY_ID", authBaseUrl: "DSH_AUTH_BASE_URL",
  environmentLabel: "DSH_ENVIRONMENT_LABEL", brandName: "DSH_BRAND_NAME", docsUrl: "DSH_DOCS_URL",
  signupEnabled: "DSH_SIGNUP_ENABLED", platformAiEnabled: "DSH_PLATFORM_AI_ENABLED",
  siteAdminUserIds: "DSH_SITE_ADMIN_USER_IDS",
  saas: "DSH_SAAS_JSON",
  indexing: "DSH_INDEXING_JSON",
};

export function readDeploymentConfig(env = process.env, path = env.DSH_DEPLOYMENT_CONFIG ?? localDeploymentPath, provided) {
  const local = provided ?? (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {});
  if (local === null || typeof local !== "object" || Array.isArray(local)) throw new Error("Deployment configuration must be an object");
  for (const key of Object.keys(local)) if (!Object.hasOwn(deploymentDefaults, key)) throw new Error(`Unknown deployment key: ${key}; never store secrets in deployment JSON`);
  const config = { ...deploymentDefaults, ...local };
  for (const [key, envKey] of Object.entries(environmentKeys)) if (env[envKey] !== undefined) {
    if (typeof deploymentDefaults[key] === "boolean") {
      if (!["true", "false"].includes(env[envKey])) throw new Error(`${envKey} must be true or false`);
      config[key] = env[envKey] === "true";
    } else if (key === "siteAdminUserIds" || key === "saas" || key === "indexing") {
      try { config[key] = JSON.parse(env[envKey]); }
      catch { throw new Error(`${envKey} must be ${key === "siteAdminUserIds" ? "a JSON array of verified account IDs" : "a JSON object"}`); }
    } else config[key] = env[envKey];
  }
  for (const [key, fallback] of Object.entries(deploymentDefaults)) if (typeof config[key] !== typeof fallback) throw new Error(`Invalid deployment value: ${key}`);
  if (config.seo === null || typeof config.seo !== "object" || Array.isArray(config.seo)) throw new Error("Invalid deployment value: seo");
  if (!Array.isArray(config.siteAdminUserIds) || config.siteAdminUserIds.length > 100
    || config.siteAdminUserIds.some(id => typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(id))
    || new Set(config.siteAdminUserIds).size !== config.siteAdminUserIds.length) throw new Error("Invalid deployment value: siteAdminUserIds; use unique verified account IDs");
  config.siteAdminUserIds = [...config.siteAdminUserIds];
  config.saas = readSaasConfig(config.saas);
  for (const key of ["workerName", "authDatabaseName", "filesBucket"]) if (!/^[a-z0-9][a-z0-9-]{0,62}$/u.test(config[key])) throw new Error(`Invalid resource name: ${key}`);
  const base = new URL(config.authBaseUrl);
  if (!["https:", "http:"].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== "/") throw new Error("DSH_AUTH_BASE_URL must be an HTTP(S) origin");
  config.authBaseUrl = base.origin;
  if (!config.indexing || typeof config.indexing !== "object" || Array.isArray(config.indexing)
    || Object.keys(config.indexing).some(key => !["environment", "enabled"].includes(key))
    || !["production", "staging", "development"].includes(config.indexing.environment)
    || typeof config.indexing.enabled !== "boolean") throw new Error("indexing requires an environment and explicit enabled flag");
  if (config.indexing.enabled && (config.indexing.environment !== "production" || base.protocol !== "https:"
    || /^(localhost|127\.0\.0\.1|\[::1\])$/u.test(base.hostname) || /(?:^|\.)example\.(com|org|net)$/u.test(base.hostname))) {
    throw new Error("Indexing requires an explicitly enabled production deployment with a real HTTPS origin");
  }
  if (config.indexing.enabled && config.seo.site?.url && new URL(config.seo.site.url).origin !== base.origin) throw new Error("Indexed site URL must match authBaseUrl");
  if (config.authDatabaseId !== "" && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(config.authDatabaseId)) throw new Error("DSH_D1_DATABASE_ID must be a D1 UUID");
  if (config.platformAiEnabled && config.aiGatewayId.trim() === "") throw new Error("Enabled platform AI requires DSH_AI_GATEWAY_ID");
  return config;
}

export function requireDeployableConfig(config) {
  if (config.authDatabaseId === "") throw new Error("Deployment requires an explicit DSH_D1_DATABASE_ID or deployment.local.json database id");
  const origin = new URL(config.authBaseUrl);
  if (origin.protocol !== "https:" || ["localhost", "127.0.0.1", "example.com"].includes(origin.hostname) || origin.hostname.endsWith(".example.com")) throw new Error("Deployment requires the real HTTPS DSH_AUTH_BASE_URL origin");
  return config;
}
