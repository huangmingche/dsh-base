/** rc.5 minimal Workers surface: thin routes, static assets and a cookie session. */
import { Context } from "@deepseek-ai/cordis";
import * as httpPlugin from "@dsh-base/cloudflare-worker-http";
import {
  authConfigFromEnv, clearSessionCookie, hashPassword, issueSession, readCookie, SESSION_COOKIE, sessionCookie, verifySession,
  type AuthConfig,
} from "./auth.ts";
import { clientScript } from "./generated-client.ts";
import { homePage, loginPage, styles } from "./pages.ts";

const HTML_HEADERS = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" };
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const JS_HEADERS = { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=300" };
const CSS_HEADERS = { "content-type": "text/css; charset=utf-8", "cache-control": "public, max-age=300" };

function envRecord(env: unknown): Record<string, unknown> {
  return typeof env === "object" && env !== null ? env as Record<string, unknown> : {};
}

function redirect(location: string, setCookie?: string): Response {
  const headers = new Headers({ location });
  if (setCookie !== undefined) headers.set("set-cookie", setCookie);
  return new Response(null, { status: 303, headers });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function currentUser(request: Request, config: AuthConfig | undefined): Promise<string | undefined> {
  if (config === undefined) return undefined;
  const value = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  return value === undefined ? undefined : verifySession(config, value);
}

async function handle(request: Request, env: unknown): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (url.pathname === "/api/health") return json({ ok: true, upstream: "dsh-0.1.0-rc.5" });
  if (url.pathname === "/assets/app.css") return new Response(styles, { headers: CSS_HEADERS });
  if (url.pathname === "/assets/client.js") return new Response(clientScript, { headers: JS_HEADERS });

  const config = authConfigFromEnv(envRecord(env));
  const username = await currentUser(request, config);

  if (url.pathname === "/api/auth/session") {
    return json(username === undefined ? { authenticated: false } : { authenticated: true, username });
  }
  if (url.pathname === "/api/auth/sign-in" && request.method === "POST") {
    if (config === undefined) return json({ error: "auth_not_configured" }, 503);
    const form = new URLSearchParams(await request.text());
    const name = form.get("username") ?? "";
    const password = form.get("password") ?? "";
    if (name !== config.username || await hashPassword(password) !== config.passwordHash) return redirect("/login?error=invalid");
    return redirect("/", sessionCookie(await issueSession(config)));
  }
  if (url.pathname === "/api/auth/sign-out" && request.method === "POST") {
    return redirect("/login", clearSessionCookie);
  }

  if (url.pathname === "/login") {
    const error = url.searchParams.get("error") ?? undefined;
    return new Response(loginPage({ configured: config !== undefined, error }), { headers: HTML_HEADERS });
  }
  if (url.pathname === "/") return new Response(homePage({ username }), { headers: HTML_HEADERS });
  return undefined;
}

const ctx = new Context();
let booted: Promise<void> | undefined;

function httpFace(): httpPlugin.WorkerHttp {
  return (ctx as unknown as { http: httpPlugin.WorkerHttp }).http;
}

async function boot(): Promise<void> {
  booted ??= (async () => {
    await (ctx.plugin({ name: "http", apply: httpPlugin.apply } as never) as unknown as Promise<unknown>);
    httpFace().use((request, env) => handle(request, env));
  })();
  await booted;
}

export default {
  async fetch(request: Request, env: unknown): Promise<Response> {
    await boot();
    return httpFace().dispatch(request, env);
  },
};
