/** Public site-config payload uses the shared site document and never leaks authority. */
import assert from "node:assert/strict";
import { siteConfigPayload, createSiteSettingsHandler } from "../src/index.ts";
import { resolveDeploymentSiteSettings } from "../../../boot/dsh-base-site-config/src/settings.ts";

const values = resolveDeploymentSiteSettings({ SITE_BRAND_NAME: "DSH Base", SITE_DOCS_URL: "https://example.com" });
const documentTitles = Object.fromEntries(Object.entries(values.seo.locales).map(([locale, copy]) => [locale, copy.title]));
const stored = { revision: 3, values, source: "saved" as const };
assert.deepEqual(siteConfigPayload({}, stored), { documentTitles, brand: { name: "DSH Base" }, links: { docs: "https://example.com" } });
assert.deepEqual(siteConfigPayload({ SITE_ENVIRONMENT_LABEL: "  Staging " }, stored), { environmentLabel: "Staging", documentTitles, brand: { name: "DSH Base" }, links: { docs: "https://example.com" } });
assert.deepEqual(siteConfigPayload({ SITE_ENVIRONMENT_LABEL: "   ", SITE_BRAND_NAME: "Stale deployment brand", SITE_ADMIN_USER_IDS: '["private-admin-id"]' }, stored), { documentTitles, brand: { name: "DSH Base" }, links: { docs: "https://example.com" } });
assert.ok(!JSON.stringify(siteConfigPayload({ SITE_ADMIN_USER_IDS: '["private-admin-id"]' }, stored)).includes("private-admin-id"));
console.log("worker site config: shared public payload whitelist passed");

const analytics = siteConfigPayload({}, { ...stored, values: { ...values, analytics: { google: { enabled: true, measurementId: 'G-TEST1234', apiSecret: 'never-public' } } } } as any);
assert.deepEqual(analytics.analytics, { google: { enabled: true, measurementId: 'G-TEST1234', ready: false } });
assert.ok(!JSON.stringify(analytics).includes('never-public'));
assert.deepEqual(siteConfigPayload({}, { ...stored, values: { ...values, analytics: { google: { enabled: true } } } }).analytics, { google: { enabled: false, ready: false } });

const enabledValues = { ...values, analytics: { google: { enabled: true, measurementId: 'G-TEST1234' } } };
const service = { async read() { return { ...stored, values: enabledValues }; } };
const unmounted = createSiteSettingsHandler({ async session() { return { id: 'admin' }; } }, service);
const env = { SITE_ADMIN_USER_IDS: '["admin"]', GOOGLE_ANALYTICS_API_SECRET: 'fixture-only', SITE_ANALYTICS_LIMITER: { async limit() { return { success: true }; } } };
const publicResponse = await unmounted(new Request('https://site.test/api/site-config'), env);
assert.equal((await publicResponse!.json() as any).analytics.google.ready, false, 'credentials alone cannot advertise an unmounted provider');
const rejected = await unmounted(new Request('https://site.test/api/site-settings', {
  method: 'PUT', headers: { origin: 'https://site.test', 'content-type': 'application/json' },
  body: JSON.stringify({ expectedRevision: 3, values: enabledValues }),
}), env);
assert.equal(rejected!.status, 400, 'enabling without an active provider fails before persistence');
