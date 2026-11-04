#!/usr/bin/env node
/** Provision one isolated account with a private operator token; print no credentials. */
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const raw = process.env.DSH_BASE_URL ?? process.env.SESSION_HOST_URL;
if (!raw) throw new Error("Set DSH_BASE_URL explicitly");
const base = new URL(raw);
if (base.protocol !== "https:" || base.username || base.password || base.pathname !== "/" || base.search || base.hash) throw new Error("DSH_BASE_URL must be the intended HTTPS origin");
const token = process.env.AUTH_REGISTRATION_TOKEN;
if (!token || token.length < 32) throw new Error("Set AUTH_REGISTRATION_TOKEN from your private operator secret");
const username = `accept_${randomBytes(10).toString("hex")}`;
const credentials = { base: base.origin, username, email: `${username}@example.test`, password: randomBytes(32).toString("base64url") };
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const output = resolve(root, ".artifacts/acceptance", `${username}.json`);
mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
writeFileSync(output, `${JSON.stringify(credentials, null, 2)}\n`, { flag: "wx", mode: 0o600 });
const response = await fetch(`${base.origin}/api/auth/sign-up/email`, {
  method: "POST", headers: { "content-type": "application/json", origin: base.origin, "x-dsh-registration-token": token },
  body: JSON.stringify({ ...credentials, name: "Isolated acceptance" }), signal: AbortSignal.timeout(30_000),
});
if (!response.ok) throw new Error(`Provisioning failed with HTTP ${response.status}; private recovery credentials saved at ${output}`);
console.log(`Acceptance account provisioned. Set DSH_ACCEPTANCE_CONFIG=${output}`);
