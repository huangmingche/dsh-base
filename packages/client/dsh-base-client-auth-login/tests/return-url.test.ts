import assert from "node:assert/strict";
import { loginDocumentReturnPath, loginReturnPath } from "../src/client/return-url.ts";
const origin = "https://app.example";
for (const path of [null, "//outside.example/", "/\\outside.example/", "https://outside.example/", "javascript:alert(1)", "data:text/html,hello"]) {
  assert.equal(loginReturnPath(path, origin), "/", String(path));
}
assert.equal(loginReturnPath("/app/session/one?view=full#tail", origin), "/app/session/one?view=full#tail");
assert.equal(loginReturnPath("https://app.example/app/workspace/one", origin), "/app/workspace/one");
for (const path of ["/app/session/session-id", "/zh-CN/app/workspace/workspace-id"]) {
  const next = `${path}?view=full&label=a%23b`;
  const login = new URL("/login", origin);
  login.searchParams.set("next", next);
  login.hash = "#cell%202";
  assert.equal(loginDocumentReturnPath(login), `${next}#cell%202`);
  login.searchParams.set("next", next + "#explicit");
  assert.equal(loginDocumentReturnPath(login), `${next}#explicit`);
}
const callback = new URL("/login?mode=reset-password&token=credential&next=%2Fapp%2Fsession%2Fone#callback", origin);
assert.equal(loginDocumentReturnPath(callback), "/app/session/one");
for (const next of ["", "//outside.example/", "https://app.example//outside.example/"]) {
  const login = new URL("/login#inherited", origin);
  login.searchParams.set("next", next);
  assert.equal(loginDocumentReturnPath(login), "/");
}
assert.equal(loginDocumentReturnPath(new URL("/login#inherited", origin)), "/");
console.log("login return path: same-origin navigation preserved; protocol-relative/backslash/external redirects rejected");
