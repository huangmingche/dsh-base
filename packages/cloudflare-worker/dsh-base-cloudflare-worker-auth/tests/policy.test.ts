import assert from "node:assert/strict";
import { createPublicPages } from "../../dsh-base-cloudflare-worker-public-pages/src/index.ts";
import { registerHooks } from "node:module";
import { authPolicyResponse, isBlockedIdentity } from "../src/policy.ts";
let authCalls = 0;
let sessionCalls = 0;
const authOptions: any[] = [];
let authUser: any = { id: "existing-owner", username: "normal", email: "normal@example.test" };
(globalThis as any).__testAuth = (options: unknown) => { authOptions.push(options); return { api: { async getSession() { sessionCalls++; return authUser === undefined ? null : { user: authUser }; } }, async handler() { authCalls += 1; return Response.json({ user: authUser }); } }; };
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") return { url: `data:text/javascript,${encodeURIComponent('export const waitUntil = promise => { void promise.catch(() => {}); };')}`, shortCircuit: true };
  if (specifier === "better-auth") return { url: `data:text/javascript,${encodeURIComponent('export const betterAuth = options => globalThis.__testAuth(options);')}`, shortCircuit: true };
  if (specifier === "better-auth/plugins/username") return { url: `data:text/javascript,${encodeURIComponent('export const username = () => ({});')}`, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { apply } = await import("../src/index.ts");
const handlers: any[] = [];
const ctx: any = { publicPages: createPublicPages(), inject(names: string[], setup: (ctx: any) => void) { if (names.every(name => ctx[name])) setup(ctx); }, http: { use(handler: any) { handlers.push(handler); } }, effect(fn: any) { fn(); }, provide(name: string, value: unknown) { ctx[name] = value; }, get(name: string) { return ctx[name]; } };
apply(ctx);
const handler = handlers[0];
const token = "a".repeat(40);
const env = { AUTH_DB: {}, AUTH_BASE_URL: "https://app.example.test", AUTH_SECRET: "s".repeat(40), AUTH_REGISTRATION_TOKEN: token };
const signup = (headers: Record<string, string> = {}, username = "newuser", suffix = "") => new Request(`https://app.example.test/api/auth/sign-up/email${suffix}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ username, email: `${username}@example.test`, password: "random-private-password" }) });
assert.deepEqual(await (await handler(new Request("https://app.example.test/api/auth-policy"), env)).json(), { signUpEnabled: false, googleEnabled: false,
  email: { enabled: false, ready: false, provider: null }, passwordResetEnabled: false, emailVerificationEnabled: false, emailVerificationRequired: false });
assert.equal(authCalls, 0);
assert.equal((await handler(signup(), env)).status, 403);
assert.equal((await handler(signup({}, "newuser", "/"), env)).status, 403);
assert.equal((await handler(signup({ "x-dsh-registration-token": "wrong" }), env)).status, 403);
assert.equal(authCalls, 0);
assert.equal((await handler(signup({ "x-dsh-registration-token": token }), env)).status, 200);
assert.equal((await handler(signup(), { ...env, AUTH_SIGNUP_ENABLED: "true" })).status, 200);
assert.equal((await handler(signup({ "x-dsh-registration-token": token }, "DshBaseAcceptance"), env)).status, 403);
assert.equal(isBlockedIdentity({ username: 42 as never }), false);
assert.equal((await ctx.auth.session(new Request("https://app.example.test/api/session-host"), env)).id, "existing-owner");
assert.equal(authOptions.length, 1);
assert.equal(authOptions[0].rateLimit.storage, "database");
assert.equal(authOptions[0].rateLimit.customStorage, undefined);
assert.deepEqual(authOptions[0].advanced.ipAddress.ipAddressHeaders, ["cf-connecting-ip"]);
await ctx.auth.session(new Request("https://app.example.test/api/session-host"), { ...env, AUTH_SECRET: "rotated-secret-".repeat(4) });
assert.equal(authOptions.length, 2, "same D1 binding must not retain an old signing secret");
await ctx.auth.session(new Request("https://next.example.test/api/session-host"), { ...env, AUTH_BASE_URL: "https://next.example.test" });
assert.equal(authOptions.length, 3, "same D1 binding must not retain an old trusted origin");
await ctx.auth.session(new Request("https://app.example.test/api/session-host"), env);
const beforeMailChange = authOptions.length;
ctx.email = { ready: () => true };
await ctx.auth.session(new Request("https://app.example.test/api/session-host"), env);
assert.equal(authOptions.length, beforeMailChange + 1, "late email service activation rebuilds auth hooks");
assert.equal(typeof authOptions.at(-1).emailAndPassword.sendResetPassword, "function");
delete ctx.email;
await ctx.auth.session(new Request("https://app.example.test/api/session-host"), env);
assert.equal(authOptions.length, beforeMailChange + 2, "email service disposal removes cached hooks");
assert.equal(authOptions.at(-1).emailAndPassword.sendResetPassword, undefined);
authUser = { id: "legacy-data-kept", username: "dshbaseacceptance", email: "legacy@example.test" };
assert.equal(await ctx.auth.session(new Request("https://app.example.test/api/session-host"), env), undefined);
assert.equal(await (await handler(new Request("https://app.example.test/api/auth/get-session"), env)).json(), null);
assert.equal((await handler(new Request("https://app.example.test/api/session-host"), env)).status, 401);
assert.equal((await authPolicyResponse(signup({ "x-dsh-registration-token": "short" }), { AUTH_REGISTRATION_TOKEN: "short" }))?.status, 403);
console.log("auth: closed default registration, explicit provisioning, public policy, normal users and blocked legacy sessions passed");

// Metadata stays public even for address-bar navigations; each producer owns its response.
authUser = undefined;
const beforeResources = sessionCalls;
for (const path of ["/sitemap.xml", "/robots.txt", "/manifest.webmanifest", "/zh-CN/manifest.webmanifest", "/llms.txt", "/ja/llms.txt"]) {
  for (const method of ["GET", "HEAD"]) {
    assert.equal(await handler(new Request(`https://app.example.test${path}`, { method, headers: { accept: "text/html" } }), env), undefined, `${method} ${path}: no login redirect`);
  }
}
for (const path of ["/third-party-notices.txt", "/third-party/document-preview.txt"]) {
  for (const method of ["GET", "HEAD"]) {
    for (const accept of ["text/html", "text/plain"]) {
      const request = new Request(`https://app.example.test${path}`, { method, headers: { accept } });
      const response = await handler(request, env);
      assert.equal(response.status, 404, `${method} ${path} (${accept})`);
      assert.equal(await response.text(), method === "HEAD" ? "" : "Not found");
    }
  }
}
assert.equal(sessionCalls, beforeResources, "metadata and missing inventory requests do not read account sessions");
for (const path of ["/llms.txt/private", "/private/llms.txt", "/zh/llms.txt", "/agent/abc", "/zh-CN/workspace/ws_a", "/app/unknown/abc",
  "/zh-CN/third-party-notices.txt", "/third-party-notices.txt/private", "/third-party-notices.txt.bak"]) {
  for (const method of ["GET", "HEAD"]) {
    const response = await handler(new Request(`https://app.example.test${path}`, { method, headers: { accept: "text/html" } }), env);
    assert.equal(response.status, 404, `${method} ${path}: unknown document`);
  }
}
assert.equal(sessionCalls, beforeResources, "unknown documents return 404 without querying private sessions");
for (const path of ["/app/session/abc-123", "/zh-CN/app/workspace/ws_a?view=one"]) {
  const response = await handler(new Request(`https://app.example.test${path}`, { headers: { accept: "text/html" } }), env);
  assert.equal(response.status, 302, "private document remains protected");
  assert.equal(new URL(response.headers.get("location")).searchParams.get("next"), path);
}
ctx.publicPages.register("cloudflare:worker:fixture-docs", {async list(){return [{path:"/docs/guide",access:"public",status:"published",publishedAt:"2020-01-01",availableLocales:["zh"],indexable:true}];}});
const beforePublished=sessionCalls;
assert.equal(await handler(new Request("https://app.example.test/zh-CN/docs/guide",{headers:{accept:"text/html"}}),env),undefined);
assert.equal((await handler(new Request("https://app.example.test/docs/guide",{headers:{accept:"text/html"}}),env)).status,404,"unpublished language does not grant a route");
assert.equal(sessionCalls,beforePublished);
console.log("auth metadata allowlist: exact resources remain public to GET/HEAD HTML navigations without session reads");
for (const path of ['/en//evil.test/path', '/EN//evil.test/path']) {
  const response = await handler(new Request('https://app.example.test' + path, {headers:{accept:'text/html'}}),env);
  assert.equal(response.status,301);
  assert.equal(new URL(response.headers.get('location')).origin,'https://app.example.test','canonical locale redirect remains on the current origin');
}
