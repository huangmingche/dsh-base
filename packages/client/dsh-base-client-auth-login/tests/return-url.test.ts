import assert from "node:assert/strict";
import { loginReturnPath } from "../src/client/return-url.ts";
const origin = "https://app.example";
for (const path of [null, "//outside.example/", "/\\outside.example/", "https://outside.example/", "javascript:alert(1)", "data:text/html,hello"]) {
  assert.equal(loginReturnPath(path, origin), "/", String(path));
}
assert.equal(loginReturnPath("/agent/one?view=full#tail", origin), "/agent/one?view=full#tail");
assert.equal(loginReturnPath("https://app.example/workspace/one", origin), "/workspace/one");
console.log("login return path: same-origin navigation preserved; protocol-relative/backslash/external redirects rejected");
