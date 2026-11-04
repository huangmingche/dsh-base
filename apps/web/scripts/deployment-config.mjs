/** Public template defaults plus explicit local/operator deployment configuration. */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const localDeploymentPath = fileURLToPath(new URL("../deployment.local.json", import.meta.url));
export const deploymentDefaults = Object.freeze({
  workerName: "dsh-base", authDatabaseName: "dsh-base-auth", authDatabaseId: "",
  filesBucket: "dsh-base-files", aiGatewayId: "", authBaseUrl: "http://localhost:5173",
  environmentLabel: "Local", brandName: "DSH Base", docsUrl: "",
  signupEnabled: false, platformAiEnabled: false,
});
const environmentKeys = {
  workerName: "DSH_WORKER_NAME", authDatabaseName: "DSH_D1_DATABASE_NAME", authDatabaseId: "DSH_D1_DATABASE_ID",
  filesBucket: "DSH_R2_BUCKET_NAME", aiGatewayId: "DSH_AI_GATEWAY_ID", authBaseUrl: "DSH_AUTH_BASE_URL",
  environmentLabel: "DSH_ENVIRONMENT_LABEL", brandName: "DSH_BRAND_NAME", docsUrl: "DSH_DOCS_URL",
  signupEnabled: "DSH_SIGNUP_ENABLED", platformAiEnabled: "DSH_PLATFORM_AI_ENABLED",
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
    } else config[key] = env[envKey];
  }
  for (const [key, fallback] of Object.entries(deploymentDefaults)) if (typeof config[key] !== typeof fallback) throw new Error(`Invalid deployment value: ${key}`);
  for (const key of ["workerName", "authDatabaseName", "filesBucket"]) if (!/^[a-z0-9][a-z0-9-]{0,62}$/u.test(config[key])) throw new Error(`Invalid resource name: ${key}`);
  const base = new URL(config.authBaseUrl);
  if (!["https:", "http:"].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== "/") throw new Error("DSH_AUTH_BASE_URL must be an HTTP(S) origin");
  config.authBaseUrl = base.origin;
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
