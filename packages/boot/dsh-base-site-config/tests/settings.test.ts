import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveDeploymentSiteSettings, validateSiteSettingsValues } from "../src/settings.ts";

const values = () => structuredClone(resolveDeploymentSiteSettings()) as any;
function rejects(edit: (value: any) => void, field: RegExp): void {
  const value = values(); edit(value);
  const result = validateSiteSettingsValues(value);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.issues.join("\n"), field);
}

test("one complete document migrates explicit SEO identity before the legacy brand", () => {
  const defaults = resolveDeploymentSiteSettings();
  assert.deepEqual(validateSiteSettingsValues(defaults), { ok: true, value: defaults });
  const legacy = resolveDeploymentSiteSettings({ SITE_BRAND_NAME: "Legacy", SITE_DOCS_URL: "https://docs.example.test" });
  assert.equal(legacy.seo.site.name, "Legacy");
  assert.equal(legacy.links.docs, "https://docs.example.test");
  const explicit = resolveDeploymentSiteSettings({ SITE_BRAND_NAME: "Legacy", SITE_SEO_JSON: '{"site":{"name":"Published identity"}}' });
  assert.equal(explicit.seo.site.name, "Published identity");
  assert.deepEqual(resolveDeploymentSiteSettings({ SITE_DOCS_URL: "javascript:bad", SITE_SUPPORT_EMAIL: "invalid" }).links, {});
});

test("strict publication rejects partial documents, unknown fields and forged authority", () => {
  for (const field of ["seo", "links"]) rejects(value => { delete value[field]; }, /required field/);
  rejects(value => { value.canEdit = true; }, /canEdit: unknown/);
  rejects(value => { value.seo.site.admin = true; }, /admin: unknown/);
  rejects(value => { value.seo.locales.xx = value.seo.locales.en; }, /xx: unknown/);
  rejects(value => { delete value.seo.locales.zh; }, /zh: required/);
  rejects(value => { value.seo.locales.en.title = " "; }, /title/);
  rejects(value => { value.seo.locales.en.title = "x".repeat(301); }, /title/);
  rejects(value => { value.seo.image.width = 0; }, /width/);
  rejects(value => { value.seo.image.height = 1.5; }, /height/);
  rejects(value => { value.seo.manifest.backgroundColor = "red"; }, /backgroundColor/);
  rejects(value => { value.seo.manifest.display = "fullscreen"; }, /display/);
});

test("public URL fields refuse executable URLs, credentials and ambiguous asset paths", () => {
  for (const url of ["javascript:alert(1)", "data:image/svg+xml,bad", "//evil.test/icon.svg", "/\\evil.test/icon.svg", "https://user:password@cdn.test/icon.svg", "/bad\nicon.svg"]) {
    rejects(value => { value.seo.icons.svg = url; }, /icons.svg/);
    rejects(value => { value.seo.image.url = url; }, /image.url/);
  }
  for (const url of ["https://example.test/path", "https://example.test/?x=1", "https://example.test/#part", "https://u:p@example.test/"]) rejects(value => { value.seo.site.url = url; }, /site.url/);
  rejects(value => { value.links.docs = "https://u:p@example.test"; }, /links.docs/);
  rejects(value => { value.links.supportEmail = "a\nb@example.test"; }, /links.supportEmail/);
});

test("sitemap settings only address implemented public pages and keep private routes excluded", () => {
  for (const path of ["/app/session/private", "/login", "/app/workspace", "/api", "/imaginary-guides"]) rejects(value => { value.seo.pages = { [path]: { title: "Private" } }; }, /registered public pages/);
  rejects(value => { value.seo.pages = { "/": { lastmod: "2026-02-30" } }; }, /lastmod/);
  rejects(value => { value.seo.pages = { "/": { priority: "1.1" } }; }, /priority/);
  rejects(value => { value.seo.robots = { extraLines: ["User-agent: *"] }; }, /User-agent/);
  rejects(value => { value.seo.robots = { disallow: ["/safe\nAllow: /"] }; }, /disallow/);
});

test("valid optional values can be removed and full publication is normalized without mutating drafts", () => {
  const value = values();
  value.seo.site.name = "  New identity  ";
  value.seo.site.url = "https://example.test/";
  value.seo.locales.en.keywords = [];
  value.seo.pages = { "/": { priority: "0.7", lastmod: "2026-11-14", changefreq: "monthly" } };
  value.seo.robots = { disallow: ["/internal"], extraLines: ["# Public site"] };
  value.links = { supportEmail: "help@example.test" };
  const result = validateSiteSettingsValues(value);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.seo.site.name, "New identity");
    assert.equal(result.value.seo.site.url, "https://example.test");
    assert.deepEqual(result.value.seo.locales.en.keywords, []);
    assert.deepEqual(result.value.seo.pages, value.seo.pages);
    assert.equal(value.seo.site.name, "  New identity  ");
  }
});

test("independent discovery and analytics settings preserve old documents and reject unsafe activation", () => {
  const legacy = values();
  assert.equal(legacy.analytics, undefined);
  assert.equal(legacy.seo.llms, undefined);
  assert.deepEqual(validateSiteSettingsValues(legacy), { ok: true, value: legacy });
  rejects(value => { value.analytics = { google: { enabled: true } }; }, /measurementId/);
  for (const measurementId of ['', 'UA-123-1', 'G-x', 'G-ABCD<script>', 'https://example.test']) {
    rejects(value => { value.analytics = { google: { enabled: true, measurementId } }; }, /measurementId/);
  }
  rejects(value => { value.analytics = { google: { enabled: 'true', measurementId: 'G-TEST1234' } }; }, /enabled/);
  rejects(value => { value.analytics = { google: { enabled: false, apiSecret: 'never-public' } }; }, /apiSecret/);
  rejects(value => { value.analytics = { google: { enabled: true, measurementId: 'G-TEST1234', ready: true } }; }, /ready/);
  rejects(value => { value.seo.llms = { enabled: 'yes' }; }, /llms.enabled/);
  rejects(value => { value.seo.llms = { guidance: 'a'.repeat(8193) }; }, /guidance/);
  const current = values();
  current.analytics = { google: { enabled: true, measurementId: ' G-TEST1234 ' } };
  current.seo.llms = { enabled: false, introduction: ' Public summary ', guidance: 'Read the public pages.' };
  const result = validateSiteSettingsValues(current);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value.analytics, { google: { enabled: true, measurementId: 'G-TEST1234' } });
    assert.deepEqual(result.value.seo.llms, { enabled: false, introduction: 'Public summary', guidance: 'Read the public pages.' });
  }
});

test('conversion tracking is explicit, modes validated and campaign labels bounded',()=>{
  const value=values();value.analytics={conversions:{mode:'aggregate',campaigns:['launch']}};
  assert.equal(validateSiteSettingsValues(value).ok,true);
  for(const mode of ['yes','on',''])rejects(value=>{value.analytics={conversions:{mode}};},/mode/);
  rejects(value=>{value.analytics={conversions:{mode:'google'}};},/measurementId/);
  for(const campaigns of [['user@example.test'],['launch','launch'],Array.from({length:65},(_,i)=>`c${i}`)])rejects(value=>{value.analytics={conversions:{mode:'aggregate',campaigns}};},/campaigns/);
  value.analytics={google:{enabled:false,measurementId:'G-TEST1234'},conversions:{mode:'google'}};
  assert.equal(validateSiteSettingsValues(value).ok,true,'anonymous pageviews and consented conversions have independent switches');
});
