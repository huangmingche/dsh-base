/** Browser address codec contract: official locale ids are prefixes, English is bare. */
import assert from "node:assert/strict";
import { LOCALE_IDS, localizePath } from "../../../boot/dsh-base-locale-path/src/index.ts";
import { addressInCurrentLocale, mirroredAddress, parseAddress, sessionPath, workspacePath } from "../src/client/routes.ts";

assert.deepEqual(parseAddress("/"), { kind: "home" });
assert.deepEqual(parseAddress(""), { kind: "home" });
assert.deepEqual(parseAddress("/app/session/abc-123"), { kind: "session", id: "abc-123" });
assert.deepEqual(parseAddress("/app/session/abc-123/"), { kind: "session", id: "abc-123" });
assert.deepEqual(sessionPath("a b"), "/app/session/a%20b");
assert.deepEqual(parseAddress(sessionPath("a b")), { kind: "session", id: "a b" });
assert.deepEqual(parseAddress("/app/workspace/ws_123"), { kind: "workspace", id: "ws_123" });
assert.deepEqual(parseAddress(workspacePath("ws_123")), { kind: "workspace", id: "ws_123" });
const sessionId = "00000000-0000-4000-8000-000000000001";
assert.equal(sessionPath(sessionId), `/app/session/${sessionId}`);
assert.equal(workspacePath("ws_" + sessionId), `/app/workspace/ws_${sessionId}`);
assert.deepEqual(parseAddress("/agent/" + sessionId), { kind: "home" });
assert.deepEqual(parseAddress("/zh-CN/workspace/ws_" + sessionId), { kind: "home" });
assert.deepEqual(parseAddress("/app/session/a/b"), { kind: "home" });
assert.deepEqual(parseAddress("/app/session/"), { kind: "home" });
assert.deepEqual(parseAddress("/app/session/%E0%A4%A"), { kind: "home" });
assert.deepEqual(parseAddress("/login"), { kind: "home" });
assert.deepEqual(parseAddress("/projects"), { kind: "home" });

// Every official locale prefix resolves to the same Session/Workspace address.
for (const locale of LOCALE_IDS) {
  assert.deepEqual(parseAddress(localizePath("/app/session/abc", locale)), { kind: "session", id: "abc" }, locale);
  assert.deepEqual(parseAddress(`${localizePath("/app/session/abc", locale)}/`), { kind: "session", id: "abc" }, `${locale} trailing slash`);
  assert.deepEqual(parseAddress(localizePath("/app/workspace/ws_1", locale)), { kind: "workspace", id: "ws_1" }, locale);
}

// Chinese uses the canonical /zh-CN path prefix; the retired bare /zh path is an
// ordinary SPA route again and must not restore a Session.
assert.deepEqual(parseAddress("/app/session/zh-CN/abc"), { kind: "home" });
assert.deepEqual(parseAddress("/zh-CN/app/session/a%20b/"), { kind: "session", id: "a b" });
assert.deepEqual(parseAddress("/zh-CN/app/workspace/ws_123"), { kind: "workspace", id: "ws_123" });
assert.deepEqual(parseAddress("/zh-CN"), { kind: "home" });
assert.deepEqual(parseAddress("/zh/app/session/abc"), { kind: "home" }, "the retired bare /zh path is inert");
assert.deepEqual(parseAddress("/zh-CN-not-a-prefix/app/session/id"), { kind: "home" });
assert.deepEqual(parseAddress("/zh-CN-agent"), { kind: "home" });

// Mirroring an official navigation keeps the reader's language prefix.
assert.equal(addressInCurrentLocale(sessionPath("second"), "/zh-CN/app/session/first"), "/zh-CN/app/session/second");
assert.equal(addressInCurrentLocale(workspacePath("one"), "/zh-CN"), "/zh-CN/app/workspace/one");
assert.equal(addressInCurrentLocale("/", "/zh-CN/app/session/gone"), "/zh-CN");
assert.equal(addressInCurrentLocale(sessionPath("second"), "/ja/app/workspace/ws"), "/ja/app/session/second");
assert.equal(addressInCurrentLocale(sessionPath("second"), "/app/session/first"), "/app/session/second");
assert.equal(addressInCurrentLocale("/", "/zh-CN-not-a-prefix"), "/");
assert.equal(addressInCurrentLocale("/app/session/second", "/en/app/session/first"), "/app/session/second", "/en/* normalizes to the unprefixed address");

// Mirroring a navigation into the address bar keeps the deep link's query and
// hash: dropping them is what silently rewrote /zh-CN/app/session/:id?keep=1#probe
// into a bare path a few seconds after boot.
assert.equal(mirroredAddress(sessionPath("second"), "/zh-CN/app/session/first", "?keep=1", "#probe"), "/zh-CN/app/session/second?keep=1#probe");
assert.equal(mirroredAddress(workspacePath("ws_2"), "/ja/app/workspace/ws_1", "?tab=files", ""), "/ja/app/workspace/ws_2?tab=files");
assert.equal(mirroredAddress("/", "/zh-CN/app/session/gone", "?keep=1", "#probe"), "/zh-CN?keep=1#probe");
assert.equal(mirroredAddress(sessionPath("second"), "/app/session/first", "", ""), "/app/session/second", "no query and hash adds no suffix");
assert.equal(mirroredAddress(sessionPath("second"), "/en/app/session/first", "?keep=1", "#probe"), "/app/session/second?keep=1#probe", "/en/* normalizes while keeping the deep link");

console.log("route address: parse and build passed for 8 locales, canonical /zh-CN prefix, retired /zh inert, query and hash preserved when mirroring");
