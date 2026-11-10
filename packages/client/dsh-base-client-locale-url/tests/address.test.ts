/** URL locale prefix synchronization contract over the shared prefix module. */
import assert from "node:assert/strict";
import { activeLocale, addressFor, synchronizeLocaleAddress, type LocaleFace } from "../src/client/address.ts";

type Snapshot = { active: string };
function face(initial: string): LocaleFace & { writes: string[] } {
  let active = initial;
  const listeners = new Set<() => void>();
  const writes: string[] = [];
  return {
    writes,
    getSnapshot: () => ({ active } satisfies Snapshot),
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setLocale: (id) => { writes.push(id); active = id; for (const listener of [...listeners]) listener(); },
  };
}
function address(pathname: string, search = "", hash = ""): { location: { pathname: string; search: string; hash: string }; history: { state: unknown; replaceState: (state: unknown, title: string, url: string) => void }; writes: string[] } {
  const writes: string[] = [];
  return {
    location: { pathname, search, hash },
    history: { state: { dsh: true }, replaceState: (_state, _title, url) => { writes.push(url); } },
    writes,
  };
}

assert.equal(activeLocale(face("zh")), "zh");
assert.equal(activeLocale(face("xx")), "en", "an unknown active value falls back to the base locale");
assert.equal(addressFor({ pathname: "/", search: "", hash: "" }, "zh"), "/zh-CN");
assert.equal(addressFor({ pathname: "/app/session/1", search: "?a=1", hash: "#b" }, "zh"), "/zh-CN/app/session/1?a=1#b");
assert.equal(addressFor({ pathname: "/zh-CN/app/session/1", search: "", hash: "" }, "en"), "/app/session/1");
assert.equal(addressFor({ pathname: "/ja/app/workspace/w", search: "?x=1", hash: "" }, "fr"), "/fr/app/workspace/w?x=1");
assert.equal(addressFor({ pathname: "/app/session/1", search: "", hash: "" }, "en"), "/app/session/1", "English stays unprefixed");

// Switching language rewrites only the prefix and preserves path/query/hash.
{
  const locale = face("en");
  const a = address("/app/session/1", "?q=2", "#top");
  const dispose = synchronizeLocaleAddress(locale, a);
  assert.deepEqual(a.writes, [], "English on a bare address needs no rewrite");
  locale.setLocale("zh");
  assert.deepEqual(a.writes, ["/zh-CN/app/session/1?q=2#top"]);
  locale.setLocale("ru");
  assert.equal(a.writes.at(-1), "/ru/app/session/1?q=2#top");
  dispose();
}

// A canonical prefix at boot selects that language instead of forcing English.
{
  const locale = face("en");
  const a = address("/zh-CN/app/session/1");
  synchronizeLocaleAddress(locale, a);
  assert.deepEqual(locale.writes, ["zh"], "the canonical prefix selects Chinese at boot");
  assert.deepEqual(a.writes, [], "the boot address is already canonical");
}

// A bare address keeps the saved preference and materializes it in the URL.
{
  const locale = face("ja");
  const a = address("/app/session/9", "?x=1");
  synchronizeLocaleAddress(locale, a);
  assert.deepEqual(a.writes, ["/ja/app/session/9?x=1"], "the saved preference is mirrored into the prefix");
  assert.deepEqual(locale.writes, [], "a bare address never forces a locale change");
}

// The explicit base spelling normalizes to the bare address.
{
  const locale = face("en");
  const a = address("/en/app/session/9");
  synchronizeLocaleAddress(locale, a);
  assert.equal(a.writes.at(-1), "/app/session/9");
}

// The retired bare /zh path is not a prefix; the active locale wins.
{
  const locale = face("en");
  const a = address("/zh/app/session/9"); // locale-path:allow retired path must stay inert
  synchronizeLocaleAddress(locale, a);
  assert.deepEqual(locale.writes, [], "the retired path selects no language");
  assert.deepEqual(a.writes, [], "and no prefix is invented for it");
}
console.log("locale url: boot prefix selects the language, switching rewrites only the prefix, query/hash preserved, retired /zh inert");
