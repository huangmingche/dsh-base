import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LOGIN_LOCALE_IDS, PENDING_LOGIN_LOCALES, REUSED_SIGN_IN_SOURCES, loginCopy, resolveLoginLocale,
} from "../src/client/locales.ts";

// The official DSH dictionaries define eight locales; the login surface keeps the
// same id set and must never invent a ninth path id such as `zh-CN`.
assert.deepEqual([...LOGIN_LOCALE_IDS], ["zh", "en", "ja", "es", "fr", "de", "pt", "ru"]);

// Incoming values come from document.documentElement.lang: the official runtime
// writes `zh-CN` for zh and bare ids otherwise. Resolve by primary subtag.
const resolution = {
  "zh-CN": "zh", "zh-Hans": "zh", zh: "zh",
  en: "en", "en-US": "en",
  ja: "ja", "ja-JP": "ja",
  es: "es", "es-ES": "es",
  fr: "fr", "fr-FR": "fr",
  de: "de", "de-AT": "de",
  pt: "pt", "pt-BR": "pt",
  ru: "ru", "ru-RU": "ru",
  "xx-YY": "en", "": "en", unknown: "en",
} as const;
for (const [input, expected] of Object.entries(resolution)) {
  assert.equal(resolveLoginLocale(input), expected, `resolve ${JSON.stringify(input)}`);
}
assert.equal(resolveLoginLocale(null), "en", "missing locale falls back to English");
assert.equal(resolveLoginLocale(undefined), "en", "undefined locale falls back to English");

// Every locale resolves to a complete dictionary with exactly the English keys,
// so a partially filled table can never ship a missing string.
const englishKeys = Object.keys(loginCopy("en")).sort();
assert.equal(englishKeys.length, 22, "login surface has 22 visible keys");
assert.ok(!englishKeys.includes("signOut"), "the login page never reuses signOut");
for (const locale of LOGIN_LOCALE_IDS) {
  const copy = loginCopy(locale);
  assert.deepEqual(Object.keys(copy).sort(), englishKeys, `${locale}: key set matches en`);
  for (const key of englishKeys) assert.equal(typeof (copy as Record<string, unknown>)[key], "string", `${locale}.${key}`);
}

const pin = JSON.parse(readFileSync(new URL("../../../../dsh-source.lock.json", import.meta.url), "utf8")).commit.slice(0, 8);
const officialLines = readFileSync(new URL("../../../../.submodules/deepseek-harness/packages/client/ui-settings-account/src/client/locales.ts", import.meta.url), "utf8").split("\n");

// Officially reused vocabulary: values and their machine-checkable source
// comments (`package@pin / file:line / key / value`) must agree for all 8 locales.
for (const locale of LOGIN_LOCALE_IDS) {
  const source = REUSED_SIGN_IN_SOURCES[locale];
  assert.match(source, /^ui-settings-account@[0-9a-f]{8} \/ locales\.ts:\d+ \/ signIn \/ .+$/u, `${locale}: source comment format`);
  const value = source.split(" / ").at(-1);
  assert.equal(loginCopy(locale).signIn, value, `${locale}: signIn matches the recorded official value`);
  assert.equal(source.includes(`@${pin}`), true, `${locale}: source records the current pin short sha`);
  const line = Number(source.match(/locales\.ts:(\d+)/u)?.[1]);
  assert.ok(officialLines[line - 1]?.match(/'?(?:signIn)'?:\s*'([^']+)'/u)?.[1] === value, `${locale}: pinned source line contains the actual translation`);
}
assert.equal(loginCopy("ja").signIn, "ログイン", "ja uses the official ログイン, not サインイン");
assert.equal(loginCopy("de").signIn, "Melden Sie sich an");
assert.equal(loginCopy("ru").signIn, "Войти");

// CEO-approved FINAL tables: all eight locales are fully translated and no
// locale falls back to English; every value is a non-empty product string.
assert.deepEqual([...PENDING_LOGIN_LOCALES], [], "no locale is pending");
for (const locale of LOGIN_LOCALE_IDS) {
  const copy = loginCopy(locale) as Record<string, string>;
  for (const [key, value] of Object.entries(copy)) assert.ok(value.trim() !== "", `${locale}.${key} must not be empty`);
  assert.equal(copy.signIn, REUSED_SIGN_IN_SOURCES[locale].split(" / ").at(-1), `${locale}: official signIn is live`);
  if (locale !== "en") assert.notEqual(copy.signInTitle, loginCopy("en").signInTitle, `${locale}: localized title, not an English fallback`);
  if (locale !== "en") assert.notEqual(copy.registrationClosed, loginCopy("en").registrationClosed, `${locale}: localized policy copy`);
}
assert.equal(loginCopy("ja").signInTitle, "DeepSeek Harness Base にログイン");
assert.equal(loginCopy("fr").signIn, "Connectez-vous", "fr reuses the official signIn value recorded in the review list");
assert.equal(loginCopy("de").checkingPolicy, "Registrierungsverfügbarkeit wird geprüft…");
console.log("login locales: 8 official ids, BCP-47 normalization, 22-key alignment, FINAL tables with official signIn vocabulary passed");
