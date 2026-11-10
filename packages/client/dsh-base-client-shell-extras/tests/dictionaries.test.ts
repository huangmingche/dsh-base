/** H1: every official locale must translate every More-menu key with a non-empty value. */
import assert from "node:assert/strict";
import { LOCALE_IDS } from "../../../boot/dsh-base-locale-path/src/index.ts";
import { MORE_DICTIONARIES } from "../src/client/more-copy.ts";

type Dictionary = Record<string, string>;
const dictionaries = MORE_DICTIONARIES as unknown as Record<string, Dictionary>;
const baseKeys = Object.keys(dictionaries.en).sort();
assert.ok(baseKeys.length > 0, "the English dictionary must not be empty");
for (const locale of LOCALE_IDS) {
  const dictionary = dictionaries[locale];
  assert.ok(dictionary !== undefined, `${locale}: dictionary is missing`);
  assert.deepEqual(Object.keys(dictionary).sort(), baseKeys, `${locale}: key set must match en exactly`);
  for (const key of baseKeys) {
    assert.equal(typeof dictionary[key], "string", `${locale}.${key}: value must be a string`);
    assert.notEqual(dictionary[key].trim(), "", `${locale}.${key}: value must not be empty`);
  }
}
assert.deepEqual(Object.keys(dictionaries).sort(), [...LOCALE_IDS].sort(), "dictionaries must cover the official locale ids and nothing else");
console.log(`shell extras dictionaries: ${LOCALE_IDS.length} locales x ${baseKeys.length} keys = ${LOCALE_IDS.length * baseKeys.length} non-empty entries`);
