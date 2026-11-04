#!/usr/bin/env node
/**
 * Regular browser-acceptance checklist for the staging deployment.
 *
 * Runs the browser scripts one after another on the same origin, records each
 * exit status, and exits non-zero when any required check fails. Staging
 * transport stalls are reported per script so a timeout in one surface does
 * not hide the result of the others.
 *
 * Usage:
 *   node scripts/acceptance-browser.mjs              # every browser script
 *   node scripts/acceptance-browser.mjs --only chat  # one script by short name
 *   DSH_BASE_URL=... node scripts/acceptance-browser.mjs
 */
import { remoteAcceptanceConfig, chromeExecutable, registrationHeaders, mayRegisterAcceptance } from "./acceptance-config.mjs";
import { spawnSync } from "node:child_process";

/** Ordered checklist: short name → script path + what it proves. */
const CHECKS = [
  { name: "official-ui", script: "scripts/acceptance-official-ui.mjs", proves: "official shell boot, composer, model menu, chat/tool turn" },
  { name: "approval-ui", script: "scripts/acceptance-approval-ui.mjs", proves: "approval card Allow once → resumed turn settles" },
  { name: "schedule-ui", script: "scripts/acceptance-schedule-ui.mjs", proves: "durable task visible in Automation tasks + Models provider row" },
  { name: "chat-interactions", script: "scripts/acceptance-chat-interactions.mjs", proves: "composer +, /, @ triggers render real actions/candidates" },
];

const args = process.argv.slice(2);
const onlyIndex = args.indexOf("--only");
const only = onlyIndex === -1 ? undefined : args[onlyIndex + 1];
if (only !== undefined && !CHECKS.some((check) => check.name === only)) {
  console.error(`unknown acceptance check: ${only}\nknown: ${CHECKS.map((check) => check.name).join(", ")}`);
  process.exit(2);
}
const { base, credentials } = remoteAcceptanceConfig();
const selected = only === undefined ? CHECKS : CHECKS.filter((check) => check.name === only);
console.log(`browser acceptance: ${selected.length} check(s) against ${base}`);

const results = [];
for (const check of selected) {
  const started = Date.now();
  console.log(`\n=== ${check.name}: ${check.proves}`);
  const result = spawnSync(process.execPath, [check.script], {
    cwd: new URL("..", import.meta.url).pathname,
    stdio: "inherit",
    env: { ...process.env, DSH_BASE_URL: base, SESSION_HOST_URL: base, DSH_ACCEPTANCE_USERNAME: credentials.username, DSH_ACCEPTANCE_PASSWORD: credentials.password, ...(credentials.email ? { DSH_ACCEPTANCE_EMAIL: credentials.email } : {}) },
    timeout: 15 * 60 * 1000,
  });
  const seconds = Math.round((Date.now() - started) / 1000);
  const ok = result.status === 0;
  results.push({ name: check.name, ok, seconds, status: result.status, signal: result.signal ?? undefined });
  console.log(`${ok ? "PASS" : "FAIL"} ${check.name} (${seconds}s)`);
}

console.log("\n=== acceptance summary");
for (const result of results) console.log(`${result.ok ? "PASS" : "FAIL"}  ${result.name}  ${result.seconds}s${result.signal === undefined ? "" : ` (signal ${result.signal})`}`);
const failed = results.filter((result) => !result.ok);
if (failed.length > 0) {
  console.error(`\n${failed.length} browser check(s) failed: ${failed.map((result) => result.name).join(", ")}`);
  console.error("If the failure is a staging sign-in/boot/socket stall, rerun the same script in a stable window and record the output.");
  process.exit(1);
}
console.log("\nall browser acceptance checks passed");
