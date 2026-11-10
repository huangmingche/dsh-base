import assert from "node:assert/strict";
import { test } from "node:test";
import { isFetchAllowlist, resolveFetchAllowlist } from "../src/fetch-policy.ts";
import { validatePluginConfig } from "../src/index.ts";

const deployment = "https://developers.cloudflare.com/docs/**,https://ai-sdk.dev/reference/**";
const resolve = (allowlist: unknown, policy = deployment) => resolveFetchAllowlist(policy, { allowlist });

test("only absent or empty owner policies inherit the deployment list", () => {
  const expected = deployment.split(",");
  for (const config of [undefined, {}, { allowlist: [] }]) assert.deepEqual(resolveFetchAllowlist(deployment, config), expected);
  assert.deepEqual(resolveFetchAllowlist(undefined), ["https://developers.cloudflare.com/**", "https://ai-sdk.dev/**"]);
  for (const config of [null, [], "bad", { allowlist: null }, { allowlist: "bad" }, { unknown: true }]) {
    assert.throws(() => resolveFetchAllowlist(deployment, config), /fetch\/allowlist-invalid/u);
  }
});

test("normalizes HTTPS origins and paths before proving a subset", () => {
  for (const entry of [
    "https://developers.cloudflare.com/docs/guide",
    "https://developers.cloudflare.com/docs/",
    "https://developers.cloudflare.com/docs/tutorials/**",
    "https://developers.cloudflare.com/docs/*/intro",
    "https://developers.cloudflare.com/docs/**/intro",
    "https://ai-sdk.dev/reference/core/**",
  ]) assert.deepEqual(resolve([entry]), [entry]);
  assert.deepEqual(resolve(["HTTPS://DEVELOPERS.CLOUDFLARE.COM.:443/docs/a/../guide"]), ["https://developers.cloudflare.com/docs/guide"]);
  assert.deepEqual(resolve(["https://developers.cloudflare.com/docs/a/%2e%2e/guide"]), ["https://developers.cloudflare.com/docs/guide"]);
  assert.deepEqual(resolve(["https://developers.cloudflare.com"], "https://developers.cloudflare.com/**"), ["https://developers.cloudflare.com/**"]);
  assert.deepEqual(resolve(["https://developers.cloudflare.com/"], "https://developers.cloudflare.com"), ["https://developers.cloudflare.com/"]);
  assert.deepEqual(resolve(["https://developers.cloudflare.com/docs/**"], "HTTPS://DEVELOPERS.CLOUDFLARE.COM.:443"), ["https://developers.cloudflare.com/docs/**"]);
});

test("refuses authority, port and path widening, including mixed lists", () => {
  for (const entry of [
    "https://developers.cloudflare.com.attacker.example/docs/**",
    "https://developers.cloudflare.com:444/docs/**",
    "https://developers.cloudflare.com/docs-evil/**",
    "https://developers.cloudflare.com/docs*",
    "https://developers.cloudflare.com/doc*/**",
    "https://developers.cloudflare.com/**",
    "https://developers.cloudflare.com",
    "https://developers.cloudflare.com/docs/../private/**",
    "https://developers.cloudflare.com/docs/%2E%2E/private/**",
    "https://developers.cloudflare.com/docs/.%2e/private/**",
  ]) {
    assert.throws(() => resolve([entry]), /fetch\/allowlist-outside-deployment/u, entry);
    assert.throws(() => resolve(["https://developers.cloudflare.com/docs/guide", entry]), /fetch\/allowlist-outside-deployment/u, entry);
  }
});

test("rejects ambiguous syntax in owner validation and stored/runtime policy", () => {
  for (const entry of [
    "http://developers.cloudflare.com/docs/**",
    "https://developers.cloudflare.com@attacker.example/docs/**",
    "https://@developers.cloudflare.com/docs/**",
    "https://user:pass@developers.cloudflare.com/docs/**",
    "https://*.cloudflare.com/docs/**",
    "https://%2a.cloudflare.com/docs/**",
    "https://developers.cloudflare.com/docs/**?filter=only",
    "https://developers.cloudflare.com/docs/**#section",
    "https://developers.cloudflare.com/docs/\\../private/**",
    "https://developers.cloudflare.com/docs/%2f../private/**",
    "https://developers.cloudflare.com/docs/%5c../private/**",
    "https://developers.cloudflare.com/docs/%252e%252e/private/**",
    "https://developers.cloudflare.com/docs/%invalid",
    "https://developers.cloudflare.com/docs/\n**",
    "https:///developers.cloudflare.com/docs/**",
    "https://developers.cloudflare.com../docs/**",
    "not a URL",
    "",
    1,
    null,
  ]) {
    assert.equal(isFetchAllowlist([entry]), false, String(entry));
    assert.equal(validatePluginConfig("@dsh-base/cloudflare-think-fetch", { allowlist: [entry] }), "plugin-manager/config-invalid");
    assert.throws(() => resolve([entry]), /fetch\/allowlist-invalid/u, String(entry));
  }
  assert.equal(isFetchAllowlist(Array(17).fill("https://developers.cloudflare.com/docs/**")), false);
  for (const policy of [",", "https://developers.cloudflare.com/docs/**,", "http://example.test/**", "https://*.example.test/**"]) {
    assert.throws(() => resolveFetchAllowlist(policy), /fetch\/allowlist-invalid/u);
  }
});

test("exact and complex deployment patterns are never approximated as directory prefixes", () => {
  const exact = "https://developers.cloudflare.com/docs/guide";
  assert.deepEqual(resolve([exact], exact), [exact]);
  for (const candidate of [`${exact}*`, `${exact}/**`, `${exact}-other`]) {
    assert.throws(() => resolve([candidate], exact), /fetch\/allowlist-outside-deployment/u);
  }
  const complex = "https://developers.cloudflare.com/docs/*/intro";
  assert.deepEqual(resolve([complex], complex), [complex]);
  assert.throws(() => resolve(["https://developers.cloudflare.com/docs/**"], complex), /fetch\/allowlist-outside-deployment/u);
  const nested = "https://developers.cloudflare.com/docs/*/**";
  assert.throws(() => resolve(["https://developers.cloudflare.com/docs/**"], nested), /fetch\/allowlist-outside-deployment/u);
});
