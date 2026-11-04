/** Drive the untouched official controller through the real persistence seam. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../../../..");
const { build } = createRequire(resolve(root, "apps/web/package.json"))("esbuild");
const official = "@deepseek-ai/dsh-client-ui-message-feedback/src/client/controller.ts";
const built = await build({ stdin: { contents: `export { MessageFeedbackController } from ${JSON.stringify(official)}; export { createMessageFeedbackRemote } from ${JSON.stringify(resolve(import.meta.dirname, "../src/client/persistence-remotes.ts"))};`, resolveDir: root, loader: "ts" }, bundle: true, write: false, platform: "node", format: "esm", target: "es2022", plugins: [{ name: "official-pinned-controller", setup(builder) {
  builder.onResolve({ filter: /^@deepseek-ai\// }, args => args.path === official ? { path: resolve(root, ".submodules/deepseek-harness/packages/client/ui-message-feedback/src/client/controller.ts") } : undefined);
} }] });
const { MessageFeedbackController, createMessageFeedbackRemote } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);
let values = {}, revision = 0, offline = false;
const transport = { async request(method, params = {}) {
  if (offline) throw new Error("offline");
  if (method === "settingsDescribe") return { values: structuredClone(values), revision };
  assert.equal(method, "settingsMutate");
  if (params.expectedRevision !== revision) throw Object.assign(new Error("conflict"), { code: "settings/conflict" });
  const domain = values[params.ns] ??= {};
  for (const op of params.ops) {
    const [session, message] = op.path;
    const items = domain[session] ??= {};
    if (op.op === "set") items[message] = structuredClone(op.value);
    else delete items[message];
  }
  revision++;
  return { values, revision };
} };
const remote = createMessageFeedbackRemote(transport);
const first = new MessageFeedbackController(remote, "session");
const second = new MessageFeedbackController(remote, "session");
assert.deepEqual(await first.ensure(), { ok: true });
assert.deepEqual(await second.ensure(), { ok: true });
assert.equal(first.getSnapshot().status, "ready");
assert.deepEqual(await first.rate("message", "positive", { text: "Useful" }), { ok: true });
assert.equal(first.getSnapshot().items.get("message").rating, "positive");
const conflict = await second.rate("message", "negative");
assert.equal(conflict.ok, false);
assert.equal(conflict.error.code, "version-conflict");
assert.deepEqual(second.getSnapshot().items.get("message"), first.getSnapshot().items.get("message"), "the official controller reconciles the authoritative conflict item");
assert.deepEqual(await second.rate("message", "negative"), { ok: true });
assert.deepEqual(await second.retract("message", "negative"), { ok: true });
assert.equal(second.getSnapshot().items.size, 0);
offline = true;
assert.equal((await first.resync()).ok, false);
assert.equal(first.getSnapshot().status, "error");
assert.equal(first.getSnapshot().items.size, 1, "read failure preserves the official controller's last committed view");
first.dispose(); second.dispose();
console.log("official feedback controller: carrier/business contract, create, conflict reconciliation, retry, delete and offline recovery passed");
