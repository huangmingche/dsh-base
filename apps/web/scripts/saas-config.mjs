/** Non-secret deployment settings. Credentials are Worker secrets, never JSON. */
import {parsePlans,parseFeatures,identifier} from '../../../packages/boot/dsh-base-payment-catalog/src/index.ts';
export const saasDefaults = Object.freeze({
  waffoEnabled: false, waffoEnvironment: "test", waffoStoreId: "", waffoPlans: [],
  emailEnabled: false, emailProvider: "cloudflare", emailFrom: "", emailCloudflareAccountId: "", emailVerificationRequired: false,
  googleEnabled: false, googleClientId: "", userAdminEnabled: true, apiKeysEnabled: true,
  filesEnabled: true, entitlementFeatures: [], entitlementOperations: {}, platformAiMaxOutputTokens: 0, newsletterEnabled: false, contactEnabled: false, contactSupportEmail: "",
  turnstileSiteKey: "", notificationsEnabled: false, crispEnabled: false, crispWebsiteId: "",
  cacheEnabled: false, cacheNamespaceId: "",
});
export function readSaasConfig(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("saas must be an object");
  for (const key of Object.keys(value)) if (!Object.hasOwn(saasDefaults, key)) throw new Error(`Unknown SaaS setting: ${key}; credentials belong in Worker secrets`);
  const result = { ...saasDefaults, ...value };
  for (const [key, fallback] of Object.entries(saasDefaults)) if (typeof result[key] !== typeof fallback) throw new Error(`Invalid SaaS setting: ${key}`);
  for (const [key, item] of Object.entries(result)) if (typeof item === "string" && (item.length > 4096 || /[\x00-\x1f\x7f]/u.test(item))) throw new Error(`Invalid SaaS setting: ${key}`);
  if (!["test", "prod"].includes(result.waffoEnvironment)) throw new Error("waffoEnvironment must be test or prod");
  if (!["cloudflare", "resend"].includes(result.emailProvider)) throw new Error("emailProvider must be cloudflare or resend");
  if (result.cacheNamespaceId && !/^[a-f\d]{32}$/iu.test(result.cacheNamespaceId)) throw new Error("cacheNamespaceId must be a KV namespace ID");
  if (result.cacheEnabled && !result.cacheNamespaceId) throw new Error("cacheEnabled requires an existing cacheNamespaceId");
  for (const field of ["waffoPlans", "entitlementFeatures"]) if (!Array.isArray(result[field]) || result[field].length > 100) throw new Error(`Invalid SaaS setting: ${field}`);
  const plans=parsePlans(result.waffoPlans),features=parseFeatures(result.entitlementFeatures);
  if(!plans)throw new Error('Invalid Waffo Pancake plan or declared display price');
  if(!features||features.some(feature=>feature.planIds.some(id=>!plans.some(plan=>plan.id===id))))throw new Error('Entitlement features must reference declared Waffo Pancake plan IDs');
  const operations=result.entitlementOperations;
  if(!operations||typeof operations!=='object'||Array.isArray(operations)||Object.keys(operations).length>100
    ||!Object.entries(operations).every(([operation,feature])=>identifier(operation)&&features.some(row=>row.id===feature)))throw new Error('Entitlement operations must reference declared feature IDs');
  if(!Number.isSafeInteger(result.platformAiMaxOutputTokens)||result.platformAiMaxOutputTokens<0||result.platformAiMaxOutputTokens>131072)throw new Error('platformAiMaxOutputTokens must be 0 (unchanged) or 1–131072');
  return structuredClone(result);
}
export function saasTextBindings(config) {
  return {
    WAFFO_ENABLED: String(config.waffoEnabled), WAFFO_ENVIRONMENT: config.waffoEnvironment, WAFFO_STORE_ID: config.waffoStoreId, WAFFO_PLANS_JSON: JSON.stringify(config.waffoPlans),
    EMAIL_ENABLED: String(config.emailEnabled), EMAIL_PROVIDER: config.emailProvider, EMAIL_FROM: config.emailFrom, EMAIL_CLOUDFLARE_ACCOUNT_ID: config.emailCloudflareAccountId,
    AUTH_EMAIL_VERIFICATION_REQUIRED: String(config.emailVerificationRequired), AUTH_GOOGLE_ENABLED: String(config.googleEnabled), GOOGLE_CLIENT_ID: config.googleClientId,
    USER_ADMIN_ENABLED: String(config.userAdminEnabled), API_KEYS_ENABLED: String(config.apiKeysEnabled), FILES_ENABLED: String(config.filesEnabled),
    ENTITLEMENTS_FEATURES_JSON: JSON.stringify(config.entitlementFeatures), ENTITLEMENTS_OPERATIONS_JSON: JSON.stringify(config.entitlementOperations),
    PLATFORM_AI_MAX_OUTPUT_TOKENS: config.platformAiMaxOutputTokens===0?'':String(config.platformAiMaxOutputTokens), NEWSLETTER_ENABLED: String(config.newsletterEnabled), CONTACT_ENABLED: String(config.contactEnabled),
    CONTACT_SUPPORT_EMAIL: config.contactSupportEmail, TURNSTILE_SITE_KEY: config.turnstileSiteKey, NOTIFICATIONS_ENABLED: String(config.notificationsEnabled),
    CRISP_ENABLED: String(config.crispEnabled), CRISP_WEBSITE_ID: config.crispWebsiteId, CACHE_ENABLED: String(config.cacheEnabled),
  };
}
