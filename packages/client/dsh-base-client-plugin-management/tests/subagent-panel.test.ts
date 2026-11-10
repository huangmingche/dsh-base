/** P7 UI copy: the restored subagent think row must explain "unavailable", not read-only composition. */
import assert from "node:assert/strict";
import { GATEWAY_PANEL_COPY, MANAGEMENT_PANEL_COPY, panelKey, SUBAGENT_MODULE, SUBAGENT_PANEL_KEY } from "../src/client/panel-copy.ts";

const subject = (name: string, enabled = true) => ({ kind: "pkg", pkg: { name, enabled } } as never);
const neverManageable = () => false;

assert.deepEqual(panelKey(subject(SUBAGENT_MODULE), neverManageable, neverManageable), SUBAGENT_PANEL_KEY,
  "the restored subagent row must use its explicit unavailable copy");
assert.deepEqual(SUBAGENT_PANEL_KEY, { title: "subagentTitle", body: "subagentBody" });
// The generic think branch stays read-only composition for every other Think row.
assert.deepEqual(panelKey(subject("@dsh-base/cloudflare-think-attachments"), neverManageable, neverManageable),
  { title: "thinkTitle", body: "thinkBody" });
assert.deepEqual(panelKey(subject("@dsh-base/cloudflare-worker-seo"), neverManageable, neverManageable),
  { title: "workerTitle", body: "workerBody" });
assert.deepEqual(panelKey(subject("@dsh-base/client-commands"), neverManageable, neverManageable),
  { title: "requiredTitle", body: "requiredBody" });
for (const enabled of [true, false]) {
  assert.deepEqual(panelKey(subject("@dsh-base/client-gateway-provider", enabled), () => false, () => true),
    { title: "gatewayTitle", body: "gatewayBody" }, "the unified Gateway bundle must not claim client-only next-start scope");
}
assert.deepEqual(panelKey(subject("@dsh-base/client-gateway-provider-other"), () => false, () => true),
  { title: "optionalTitle", body: "optionalBody" }, "the Gateway explanation is selected by exact bundle identity only");
assert.deepEqual(panelKey(subject("@dsh-base/cloudflare-think-fetch"), () => true, () => false),
  { title: "optionalTitle", body: "thinkManagedBody" });
assert.deepEqual(Object.keys(GATEWAY_PANEL_COPY).sort(), ['en', 'zh', 'ja', 'es', 'fr', 'de', 'ru', 'pt'].sort());
for (const copy of Object.values(GATEWAY_PANEL_COPY)) {
  assert.ok(copy.gatewayTitle.length > 0 && copy.gatewayBody.length > 0);
  assert.match(copy.gatewayBody, /API/u, "every locale preserves the independent API key scope");
}
assert.match(GATEWAY_PANEL_COPY.en.gatewayBody, /platform models and their settings for this account/u);
assert.match(GATEWAY_PANEL_COPY.en.gatewayBody, /Session settings take precedence/u);
assert.match(GATEWAY_PANEL_COPY.en.gatewayBody, /does not stop requests already running/u);
assert.match(GATEWAY_PANEL_COPY.zh.gatewayBody, /本账号的平台模型及其设置/u);
assert.match(GATEWAY_PANEL_COPY.zh.gatewayBody, /会话中的单独设置优先/u);
assert.match(GATEWAY_PANEL_COPY.zh.gatewayBody, /不会中断正在执行的请求/u);
assert.equal(panelKey({ kind: "item" } as never, neverManageable, neverManageable), undefined);
console.log("subagent panel: explicit unavailable copy wins over the generic read-only Think row; other subjects unchanged");

for (const enabled of [true, false]) {
  for (const name of ['dsh-base:base', 'dsh-base:ai-chat-core', 'dsh-base:plugin-management']) {
    const pkg = { name, enabled, readOnlyReason: 'unaddressable', managementPolicy: 'required' };
    assert.deepEqual(panelKey({ kind: 'pkg', pkg } as never, neverManageable, neverManageable),
      { title: 'requiredTitle', body: 'requiredBody' }, 'visible application bundles retain their policy explanation even when no component is active');
  }
  const pkg = { name: 'dsh-base:future-service', enabled, readOnlyReason: 'unaddressable', managementPolicy: 'deployment' };
  assert.deepEqual(panelKey({ kind: 'pkg', pkg } as never, neverManageable, neverManageable),
    { title: 'workerTitle', body: 'workerBody' });
}
assert.deepEqual(panelKey({ kind: 'pkg', pkg: { name: 'example', enabled: false, managementPolicy: 'required' } } as never, neverManageable, neverManageable),
  { title: 'unbundledTitle', body: 'unbundledBody' }, 'policy metadata cannot relabel a writable or ordinary disabled bundle');
for (const extension of [
  { readOnlyReason: 'role', managementPolicy: 'required' },
  { readOnlyReason: 'unaddressable', managementPolicy: 'unknown' },
]) {
  assert.deepEqual(panelKey({ kind: 'pkg', pkg: { name: 'example', enabled: false, ...extension } } as never, neverManageable, neverManageable),
    { title: 'unbundledTitle', body: 'unbundledBody' }, 'only a validated Host management policy changes the scope explanation');
}
assert.deepEqual(Object.keys(MANAGEMENT_PANEL_COPY).sort(), Object.keys(GATEWAY_PANEL_COPY).sort());
for (const copy of Object.values(MANAGEMENT_PANEL_COPY)) {
  assert.deepEqual(Object.keys(copy).sort(), Object.keys(MANAGEMENT_PANEL_COPY.en).sort());
  assert.ok(Object.values(copy).every(value => value.trim().length > 0));
}
assert.equal(MANAGEMENT_PANEL_COPY.zh.requiredTitle, '应用所需');
assert.equal(MANAGEMENT_PANEL_COPY.en.requiredTitle, 'Required by the app');
