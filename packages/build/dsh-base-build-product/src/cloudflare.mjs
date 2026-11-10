import { buildContext } from '../../../../scripts/build/product-paths.mjs';
import { readProductDeployment } from '../../../../scripts/project/deployment.mjs';
import { readApplications } from '../../../../scripts/composition/applications.mjs';
/** Cloudflare CLI project configuration for the dsh-base Worker and its assets. */

import { readDeploymentConfig } from "../../../../apps/web/scripts/deployment-config.mjs";
import { saasTextBindings } from "../../../../apps/web/scripts/saas-config.mjs";

export const workerCompatibilityDate = "2026-11-06";

export function createDshCloudflareConfig({ bindings, defineConfig, exports }, options = {}) {
const context = buildContext(options.productRoot, { app: options.app, appRoot: options.appRoot });
const deployment = options.deployment ?? (context.isolated || readApplications(context).apps.length > 1
  ? readProductDeployment(context.productRoot, { env: process.env, path: options.deploymentPath, app: context.appId })
  : readDeploymentConfig(process.env, options.deploymentPath));
return defineConfig({
  worker: {
    name: deployment.workerName,
    compatibilityDate: options.compatibilityDate ?? workerCompatibilityDate,
    compatibilityFlags: ["nodejs_compat"],
    entrypoint: options.entrypoint ?? "src/server.ts",
    observability: {
      traces: { enabled: true },
      // Workers Logs: invocation logs give deployment acceptance the raw
      // "zero outbound" and provider evidence. Billed per event; keep sampling 1.
      logs: { enabled: true },
    },
    assets: {
      notFoundHandling: "single-page-application",
      runWorkerFirst: true,
    },
    exports: {
      AuthStoreObject: exports.durableObject({ storage: "sqlite" }),
      DshAgent: exports.durableObject({ storage: "sqlite" }),
      SessionHostObject: exports.durableObject({ storage: "sqlite" }),
      PluginControl: exports.durableObject({ storage: "sqlite" }),
      // P7: the class is restored as an unavailable-compatibility export. The
      // former `state: "deleted"` tombstone was stale (the B-state deploy log
      // reported no same-name namespace to preserve), so the namespace starts
      // empty; no historical facet data is expected or claimed.
      DshSubagent: exports.durableObject({ storage: "sqlite" }),
    },
    env: {
      WORKER_VERSION: bindings.versionMetadata(),
      AI: bindings.ai({}),
      ASSETS: bindings.assets(),
      AUTH_DB: bindings.d1({ name: deployment.authDatabaseName, ...(deployment.authDatabaseId === "" ? {} : { id: deployment.authDatabaseId }) }),
      AUTH_STORE: bindings.durableObject({ worker: deployment.workerName, exportName: "AuthStoreObject" }),
      DshAgent: bindings.durableObject({ worker: deployment.workerName, exportName: "DshAgent" }),
      FILES: bindings.r2({ name: deployment.filesBucket }),
      // Reuse an explicitly selected KV namespace only when this optional plugin is enabled.
      CACHE: deployment.saas.cacheEnabled ? bindings.kv({ id: deployment.saas.cacheNamespaceId }) : undefined,
      ...Object.fromEntries(Object.entries(saasTextBindings(deployment.saas)).map(([key, value]) => [key, bindings.text(value)])),
      CREDENTIALS_KEY: bindings.secret(),
      AUTH_SECRET: bindings.secret(),
      AUTH_REGISTRATION_TOKEN: bindings.secret(),
      // GA4 is optional. GOOGLE_ANALYTICS_API_SECRET is installed as a Worker
      // secret only when enabling it; it is not a required application secret.
      SITE_ANALYTICS_LIMITER: bindings.rateLimit({ namespace: "763427", simple: { limit: 30, period: 60 } }),
      AUTH_SIGNUP_ENABLED: bindings.text(String(deployment.signupEnabled)),
      PLATFORM_AI_ENABLED: bindings.text(String(deployment.platformAiEnabled)),
      SESSION_HOST: bindings.durableObject({ worker: deployment.workerName, exportName: "SessionHostObject" }),
      DshSubagent: bindings.durableObject({ worker: deployment.workerName, exportName: "DshSubagent" }),
      PluginControl: bindings.durableObject({ worker: deployment.workerName, exportName: "PluginControl" }),
      // Stable storage identity shared with the Session Host. Never change for
      // a code deployment; schema migrations preserve this existing owner data.
      SESSION_HOST_GENERATION: bindings.text("default-v49"),
      // Public site facts served by /api/site-config (never secrets).
      SITE_ENVIRONMENT_LABEL: bindings.text(deployment.environmentLabel),
      SITE_DEPLOYMENT_ENVIRONMENT: bindings.text(deployment.indexing?.environment ?? "staging"),
      SITE_INDEXING_ENABLED: bindings.text(String(deployment.indexing?.enabled === true)),
      SITE_BRAND_NAME: bindings.text(deployment.brandName),
      SITE_ADMIN_USER_IDS: bindings.text(JSON.stringify(deployment.siteAdminUserIds)),
      SITE_DOCS_URL: bindings.text(deployment.docsUrl),
      AI_GATEWAY_ID: bindings.text(deployment.aiGatewayId),
      FETCH_ALLOWLIST: bindings.text("https://developers.cloudflare.com/**,https://ai-sdk.dev/**"),
      // Optional site SEO override: one JSON binding keeps the whole structure in
      // one deployment value.
      SITE_SEO_JSON: bindings.text(JSON.stringify(deployment.seo)),
      AUTH_BASE_URL: bindings.text(deployment.authBaseUrl),
    },
  },
});
}
