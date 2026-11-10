/** The default shell keeps the official More menu and never loads retired extras. */
import assert from "node:assert/strict";
import { canonicalClientRows } from "../../../../scripts/conformance/canonical-roster.mjs";
import { generateClientComposition } from "../../../../scripts/composition/client.mjs";

const rows = canonicalClientRows();
const generated = generateClientComposition(rows);
for (const name of ["@dsh-base/client-shell-extras"]) {
  const row = rows.find(row => row.name === name);
  assert.ok(row, `${name}: disabled inventory remains inspectable`);
  assert.equal(row.disabled, true, `${name}: removed More additions must not start`);
  assert.ok(row.unavailableReason?.length > 0, `${name}: inventory explains retirement`);
  assert.ok(!generated.includes(`import(${JSON.stringify(row.module ?? row.name)})`), `${name}: disabled inventory cannot acquire a bundled resolver`);
}
const siteConfig = rows.find(row => row.name === '@dsh-base/client-site-config');
assert.ok(siteConfig, 'public site facts remain visible in composition');
assert.notEqual(siteConfig.disabled, true, 'site branding has a real consumer independent of More');
assert.ok(generated.includes(`import(${JSON.stringify(siteConfig.module ?? siteConfig.name)})`), 'the active public site service has a module resolver');
const official = rows.find(row => row.name === "@deepseek-ai/dsh-client-ui-entry-customization");
assert.ok(official, "the official More contribution remains in composition");
assert.equal(official.origin, "upstream");
assert.equal(official.disabled, true, "the original remains inventory while its marked availability fork runs");
assert.ok(!generated.includes(`import(${JSON.stringify(official.module ?? official.name)})`));
const adapted = rows.find(row => row.name === '@dsh-base/client-entry-customization');
assert.ok(adapted, 'the marked official More fork is present');
assert.equal(adapted.replaces, official.name);
assert.notEqual(adapted.disabled, true);
assert.ok(generated.includes(`import(${JSON.stringify(adapted.module ?? adapted.name)})`));
console.log("sidebar More: marked official availability fork active; original and retired product extras have no resolver; public site facts remain available for branding");
