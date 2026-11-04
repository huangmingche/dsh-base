/** Durable feedback requires the Host revision and retains carrier/business failures. */
import assert from "node:assert/strict";
import { deleteMessageFeedback, listMessageFeedback, putMessageFeedback, type FeedbackTransport } from "../src/client/chat-feedback.ts";
import { createCredentialsRemote, createMessageFeedbackRemote } from "../src/client/persistence-remotes.ts";

let values: Record<string, unknown> = {};
let revision = 0;
let race: (() => void) | undefined;
const transport: FeedbackTransport = {
  async request(method, params = {}) {
    if (method === "settingsDescribe") return { revision, values: structuredClone(values) };
    if (method === "settingsMutate") {
      const duringWrite = race; race = undefined; duringWrite?.();
      assert.equal(typeof params.expectedRevision, "number", "every write must carry the revision it read");
      if (params.expectedRevision !== revision) throw Object.assign(new Error("concurrent write"), { code: "settings/conflict" });
      const ns = String(params.ns);
      const domain = (values[ns] ?? {}) as Record<string, Record<string, unknown>>;
      for (const op of params.ops as Array<{ op: string; path: string[]; value?: unknown }>) {
        values[ns] = domain;
        let target: Record<string, unknown> = domain;
        for (const segment of op.path.slice(0, -1)) target = (target[segment] ??= {}) as Record<string, unknown>;
        const last = op.path.at(-1)!;
        if (op.op === "set") target[last] = op.value;
        else delete target[last];
      }
      revision++;
      return { revision, values: structuredClone(values) };
    }
    throw new Error(`unexpected method ${method}`);
  },
};
assert.deepEqual(await listMessageFeedback(transport, "s1"), []);
const created = await putMessageFeedback(transport, { sessionId: "s1", messageId: "m1", rating: "positive", note: "good", ifVersion: null });
assert.equal(created.ok, true);
if (!created.ok) throw new Error("create failed");
assert.equal(typeof created.value.version, "string");
const conflict = await putMessageFeedback(transport, { sessionId: "s1", messageId: "m1", rating: "negative", ifVersion: null });
assert.deepEqual(conflict, { ok: false, error: { code: "version-conflict", current: created.value } });
const updated = await putMessageFeedback(transport, { sessionId: "s1", messageId: "m1", rating: "negative", ifVersion: created.value.version });
assert.equal(updated.ok, true);
if (!updated.ok) throw new Error("update failed");
assert.notEqual(updated.value.version, created.value.version);
assert.equal((await listMessageFeedback(transport, "s1"))[0]?.rating, "negative");
assert.deepEqual(await listMessageFeedback(transport, "s2"), []);

// A concurrent settings edit on a different namespace is retried, not overwritten.
race = () => { values.preferences = { language: "zh" }; revision++; };
const retried = await putMessageFeedback(transport, { sessionId: "s1", messageId: "m2", rating: "positive", ifVersion: null });
assert.equal(retried.ok, true);
assert.deepEqual(values.preferences, { language: "zh" });
// An item changed between read/write must surface its authoritative new version.
const concurrent = { ...updated.value, version: "other-tab", rating: "positive" };
race = () => { (values["dsh-base:feedback"] as any).s1.m1 = concurrent; revision++; };
const racedDelete = await deleteMessageFeedback(transport, { sessionId: "s1", messageId: "m1", ifVersion: updated.value.version });
assert.deepEqual(racedDelete, { ok: false, error: { code: "version-conflict", current: concurrent } });
assert.equal((await deleteMessageFeedback(transport, { sessionId: "s1", messageId: "m1", ifVersion: concurrent.version })).ok, true);
assert.equal((await listMessageFeedback(transport, "s1")).some(item => item.messageId === "m1"), false);

// The official controller consumes a carrier Result containing a business Result.
const remote = createMessageFeedbackRemote(transport);
const listed = await remote.list({ sessionId: "s1" });
assert.equal(listed.ok, true);
if (listed.ok) {
  assert.equal(listed.value.ok, true);
  assert.equal(listed.value.value.items[0]?.messageId, "m2");
}
const unavailable = createMessageFeedbackRemote();
assert.equal((await unavailable.list({ sessionId: "s1" })).ok, false);
assert.equal((await unavailable.put({ sessionId: "s1", messageId: "x", rating: "positive", ifVersion: null })).ok, false);
assert.equal((await unavailable.delete({ sessionId: "s1", messageId: "x", ifVersion: "v" })).ok, false);
const failedTransport: FeedbackTransport = { async request() { throw Object.assign(new Error("network failed"), { code: "host/offline", details: { retryable: true } }); } };
const failedFeedback = await createMessageFeedbackRemote(failedTransport).list({ sessionId: "s1" });
assert.deepEqual(failedFeedback, { ok: false, error: { code: "host/offline", message: "network failed", details: { retryable: true } } });
const noCredentials = createCredentialsRemote();
for (const result of [await noCredentials.describe(), await noCredentials.set("test", "secret"), await noCredentials.unset("test")]) assert.equal(result.ok, false);
for (const result of [await createCredentialsRemote(failedTransport).describe(), await createCredentialsRemote(failedTransport).set("test", "secret"), await createCredentialsRemote(failedTransport).unset("test")]) assert.deepEqual(result, failedFeedback);
const calls: unknown[] = [];
const credentials = createCredentialsRemote({ async request(method, params) { calls.push([method, params]); return { entries: { test: { configured: true, writable: true } } }; } });
assert.equal((await credentials.describe(["test"])).ok, true);
assert.equal((await credentials.set("test", "secret")).ok, true);
assert.equal((await credentials.unset("test")).ok, true);
assert.deepEqual(calls.map((call: any) => call[0]), ["credentialsDescribe", "credentialsSet", "credentialsUnset"]);
console.log("client persistence: durable feedback, CAS races, carrier/business envelopes and honest Host failures passed");
