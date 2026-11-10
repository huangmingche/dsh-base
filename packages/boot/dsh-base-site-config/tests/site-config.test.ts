/** Product site configuration merge/validation contract. */
import assert from "node:assert/strict";
import { DEFAULT_SITE_CONFIG, mergeSiteConfig, parseSiteRuntimeConfig } from "../src/index.ts";

assert.equal(DEFAULT_SITE_CONFIG.brand.name, "DSH Base");
assert.deepEqual(DEFAULT_SITE_CONFIG.links, {});
assert.deepEqual(mergeSiteConfig(undefined), DEFAULT_SITE_CONFIG);
const merged = mergeSiteConfig({
  brand: { name: "  Mk Base  ", logoLight: "/logo.png", logoDark: "" },
  links: { docs: " https://example.com/docs ", supportEmail: "", github: "https://github.com/example/repo" },
});
assert.equal(merged.brand.name, "Mk Base");
assert.equal(merged.brand.logoLight, "/logo.png");
assert.equal(merged.brand.logoDark, undefined);
assert.equal(merged.links.docs, "https://example.com/docs");
assert.equal(merged.links.supportEmail, undefined);
assert.equal(merged.links.github, "https://github.com/example/repo");
assert.ok(Object.isFrozen(merged));
assert.equal(mergeSiteConfig({ brand: { name: "   " } }).brand.name, "DSH Base");
assert.deepEqual(parseSiteRuntimeConfig(undefined), { config: {} });
assert.deepEqual(parseSiteRuntimeConfig({ environmentLabel: "  Staging ", brand: { name: "DSH Base" }, links: { docs: "https://example.com" }, secret: "x" }), { environmentLabel: "Staging", config: { brand: { name: "DSH Base" }, links: { docs: "https://example.com" } } });
// H1: link values are opened with window.open/anchors, so only absolute HTTP(S)
// survives; a javascript: binding is treated as unconfigured, never executed.
assert.deepEqual(mergeSiteConfig({ links: { docs: "javascript:alert(1)" } }).links, {}, "javascript: docs must be treated as unset");
assert.deepEqual(mergeSiteConfig({ links: { docs: "JavaScript:alert(1)" } }).links, {}, "scheme check is case-insensitive");
assert.deepEqual(mergeSiteConfig({ links: { github: "ftp://example.test/repo" } }).links, {}, "non-HTTP(S) github is unset");
assert.equal(mergeSiteConfig({ links: { docs: "HTTPS://example.com/docs" } }).links.docs, "HTTPS://example.com/docs");
assert.equal(mergeSiteConfig({ links: { docs: " http://example.com/docs " } }).links.docs, "http://example.com/docs");
assert.deepEqual(mergeSiteConfig({ links: { supportEmail: "support@example.test" } }).links, { supportEmail: "support@example.test" }, "mailto rows keep the mailbox value");
assert.deepEqual(mergeSiteConfig({ links: { docs: "javascript:alert(1)", supportEmail: "support@example.test" } }).links, { supportEmail: "support@example.test" }, "one rejected link does not drop the rest");
assert.deepEqual(parseSiteRuntimeConfig({ environmentLabel: "   " }), { config: {} });
assert.deepEqual(parseSiteRuntimeConfig({ environmentLabel: 42, brand: { name: 42 }, links: { docs: "" } }), { config: { links: { docs: "" } } });
console.log("site config: merge and runtime parsing passed");

const titles = { en: 'Saved page', zh: '页面标题' };
assert.deepEqual(mergeSiteConfig({ documentTitles: titles }).documentTitles, titles);
assert.deepEqual(parseSiteRuntimeConfig({ documentTitles: { ...titles, xx: 'unknown', ja: 42 } }).config.documentTitles, titles);
assert.equal(mergeSiteConfig({ documentTitles: {} }).documentTitles, undefined);
assert.equal(parseSiteRuntimeConfig({ documentTitles: null }).config.documentTitles, undefined);

for (const google of [null, {}, { enabled: true }, { enabled: 'true', measurementId: 'G-TEST1234' }, { enabled: true, measurementId: '<script>' }]) {
  assert.notEqual(parseSiteRuntimeConfig({ analytics: { google } }).config.analytics?.google?.enabled, true);
}
const safeAnalytics = { google: { enabled: true, measurementId: 'G-TEST1234' } };
assert.deepEqual(mergeSiteConfig({ analytics: safeAnalytics }).analytics, safeAnalytics);
assert.deepEqual(parseSiteRuntimeConfig({ analytics: { google: { ...safeAnalytics.google, userId: 'private', apiSecret: 'secret' } } }).config.analytics, safeAnalytics);
