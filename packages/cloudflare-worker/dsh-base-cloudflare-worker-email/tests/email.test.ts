import assert from "node:assert/strict";
import { test } from "node:test";
import { emailConfig, validateIntent } from "../src/config.ts";
import { renderEmail } from "../src/templates.ts";
import { sendProvider } from "../src/providers.ts";
import { createEmailService } from "../src/service.ts";
import { LOCALE_IDS } from "../../../boot/dsh-base-locale-path/src/index.ts";

const env = { AUTH_DB: { withSession() { throw new Error("should not access D1"); } } as never,
  AUTH_BASE_URL: "https://app.example.test", EMAIL_ENABLED: "true", EMAIL_PROVIDER: "resend",
  EMAIL_FROM: "Example <account@example.test>", RESEND_API_KEY: "fixture-only-api-key" };
const intent = { kind: "verify-email" as const, to: "reader@example.test", actionUrl: "https://app.example.test/api/auth/verify-email?token=fixture-secret", idempotencyKey: "fixture-secret" };

test("configuration requires explicit enablement and valid server-only settings", async () => {
  for (const candidate of [{}, { ...env, EMAIL_ENABLED: undefined }, { ...env, EMAIL_ENABLED: "false" }, { ...env, EMAIL_ENABLED: "TRUE" },
    { ...env, EMAIL_PROVIDER: "unknown" }, { ...env, RESEND_API_KEY: "" }, { ...env, AUTH_DB: undefined },
    { ...env, EMAIL_FROM: "ok@example.test\r\nBcc:other@example.test" }, { ...env, EMAIL_FROM: "a@example.test,b@example.test" },
    { ...env, AUTH_BASE_URL: "http://app.example.test" }, { ...env, AUTH_BASE_URL: "https://user:pass@app.example.test" },
    { ...env, AUTH_BASE_URL: "https://app.example.test/path" }]) assert.equal(emailConfig(candidate), undefined);
  assert.equal(emailConfig(env)?.endpoint, "https://api.resend.com/emails");
  assert.ok(emailConfig({ ...env, AUTH_BASE_URL: "http://localhost:8787" }));
  assert.equal(emailConfig({ ...env, EMAIL_PROVIDER: "cloudflare", EMAIL_CLOUDFLARE_ACCOUNT_ID: "../wrong", EMAIL_CLOUDFLARE_API_TOKEN: "fixture-only-token" }), undefined);
  let called = false;
  const service = createEmailService(async () => { called = true; throw new Error(); });
  await assert.rejects(service.sendTransactional({}, intent), { message: "email_unavailable" });
  assert.equal(called, false);
});

test("transactional intent rejects injection, unknown kinds and off-origin links before persistence", () => {
  const config = emailConfig(env)!;
  assert.equal(validateIntent(intent, config).origin, "https://app.example.test");
  for (const overrides of [{ to: "a@example.test,b@example.test" }, { to: "a@example.test\n" }, { kind: "newsletter" },
    { actionUrl: "https://evil.example/api/auth/verify-email?token=fixture" }, { actionUrl: "javascript:alert(1)" },
    { actionUrl: "https://app.example.test/marketing" }, { actionUrl: "https://app.example.test/api/auth/verify-email" },
    { actionUrl: `${intent.actionUrl}&callbackURL=${encodeURIComponent("https://evil.example")}` },
    { actionUrl: `${intent.actionUrl}&callbackURL=${encodeURIComponent("//evil.example")}` },
    { idempotencyKey: "" }]) assert.throws(() => validateIntent({ ...intent, ...overrides } as never, config), { message: "email_invalid_intent" });
  assert.ok(validateIntent({ ...intent, kind: "reset-password", actionUrl: "https://app.example.test/api/auth/reset-password/token?callbackURL=%2Flogin" }, config));
});

test("all eight locales produce escaped HTML plus plain text without remote assets", () => {
  for (const locale of LOCALE_IDS) {
    for (const kind of ["verify-email", "reset-password"] as const) {
      const rendered = renderEmail(kind, `${intent.actionUrl}&label=%3Cscript%3E`, locale);
      assert.ok(rendered.subject.length > 0);
      assert.match(rendered.html, /&amp;label=/);
      assert.ok(rendered.text.includes("&label="));
      assert.doesNotMatch(rendered.html, /<img|<script|<link/);
    }
  }
  assert.equal(renderEmail("verify-email", intent.actionUrl, "zh-CN").subject, "验证电子邮箱");
  assert.equal(renderEmail("verify-email", intent.actionUrl, "unrecognized").subject, "Verify your email address");
});

test("provider acceptance follows Cloudflare recipient results and Resend ids", async () => {
  const resend = emailConfig(env)!;
  const cloudflare = emailConfig({ ...env, EMAIL_PROVIDER: "cloudflare", EMAIL_CLOUDFLARE_ACCOUNT_ID: "a".repeat(32), EMAIL_CLOUDFLARE_API_TOKEN: "fixture-only-token" })!;
  const message = { from: resend.from, to: intent.to, ...renderEmail(intent.kind, intent.actionUrl) };
  for (const field of ["queued", "delivered"]) {
    assert.equal(await sendProvider(cloudflare, message, "hashed-key", async (endpoint, init) => {
      assert.equal(endpoint, `https://api.cloudflare.com/client/v4/accounts/${"a".repeat(32)}/email/sending/send`);
      assert.equal(init.redirect, "manual");
      assert.equal(new Headers(init.headers).has("idempotency-key"), false);
      assert.equal(JSON.parse(init.body as string).to, intent.to);
      return Response.json({ success: true, result: { [field]: [intent.to] } });
    }), "accepted");
  }
  assert.equal(await sendProvider(resend, message, "hashed-key", async (_, init) => {
    assert.equal(new Headers(init.headers).get("idempotency-key"), "dsh-email/hashed-key");
    return Response.json({ id: "provider-message-id" });
  }), "accepted");
  for (const [data, expected] of [
    [{ success: true, result: { permanent_bounces: [intent.to] } }, "rejected"],
    [{ success: false, errors: [{ message: "private data" }] }, "rejected"],
    [{ success: true, result: { delivered: ["other@example.test"] } }, "unknown"],
    [{ success: true }, "unknown"],
  ] as const) assert.equal(await sendProvider(cloudflare, message, "key", async () => Response.json(data)), expected);
  for (const status of [400, 401, 403, 429]) assert.equal(await sendProvider(resend, message, "key", async () => new Response("private body", { status })), "rejected");
  for (const status of [408, 409, 500, 503]) assert.equal(await sendProvider(resend, message, "key", async () => new Response("private body", { status })), "unknown");
  assert.equal(await sendProvider(resend, message, "key", async () => { throw new Error("recipient and token must not escape"); }), "unknown");
  assert.equal(await sendProvider(resend, message, "key", async () => new Response("x".repeat(33 * 1024))), "unknown");
  assert.equal(await sendProvider(resend, message, "key", async () => Response.json({})), "unknown");
});
