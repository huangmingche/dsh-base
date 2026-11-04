/** Cloudflare CLI project configuration for the dsh-base Worker and its assets. */
import { bindings, defineConfig, exports } from "cf/config";
import { readDeploymentConfig } from "./scripts/deployment-config.mjs";

const deployment = readDeploymentConfig();

export default defineConfig({
  worker: {
    name: deployment.workerName,
    compatibilityDate: "2026-11-06",
    compatibilityFlags: ["nodejs_compat"],
    entrypoint: "src/server.ts",
    observability: { traces: { enabled: true } },
    assets: {
      notFoundHandling: "single-page-application",
      runWorkerFirst: true,
    },
    exports: {
      AuthStoreObject: exports.durableObject({ storage: "sqlite" }),
      DshAgent: exports.durableObject({ storage: "sqlite" }),
      SessionHostObject: exports.durableObject({ storage: "sqlite" }),
      // Retired with Commit 1: both classes were removed from code, but their
      // provisioned namespaces remain in the account. Tombstones let the
      // deploy reconcile the orphans instead of failing upload validation.
      DshSubagent: exports.durableObject({ state: "deleted" }),
      PluginControl: exports.durableObject({ state: "deleted" }),
    },
    env: {
      WORKER_VERSION: bindings.versionMetadata(),
      ASSETS: bindings.assets(),
      AUTH_DB: bindings.d1({ name: deployment.authDatabaseName, ...(deployment.authDatabaseId === "" ? {} : { id: deployment.authDatabaseId }) }),
      AUTH_STORE: bindings.durableObject({ worker: deployment.workerName, exportName: "AuthStoreObject" }),
      DshAgent: bindings.durableObject({ worker: deployment.workerName, exportName: "DshAgent" }),
      FILES: bindings.r2({ name: deployment.filesBucket }),
      CREDENTIALS_KEY: bindings.secret(),
      AUTH_SECRET: bindings.secret(),
      AUTH_REGISTRATION_TOKEN: bindings.secret(),
      AUTH_SIGNUP_ENABLED: bindings.text(String(deployment.signupEnabled)),
      SESSION_HOST: bindings.durableObject({ worker: deployment.workerName, exportName: "SessionHostObject" }),
      // Stable storage identity shared with the Session Host. Never change for
      // a code deployment; schema migrations preserve this existing owner data.
      SESSION_HOST_GENERATION: bindings.text("default-v49"),
      FETCH_ALLOWLIST: bindings.text("https://developers.cloudflare.com/**,https://ai-sdk.dev/**"),
      AUTH_BASE_URL: bindings.text(deployment.authBaseUrl),
    },
  },
});
