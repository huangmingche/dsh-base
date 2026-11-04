/** Persistent writes must settle with the Host result, including refusals. */
import assert from "node:assert/strict";
import { createSettingsRemote } from "../src/client/settings-remote.ts";
import { createScheduleRemote } from "../src/client/schedule-remote.ts";
import { createPermissionCommands } from "../src/client/permission-command.ts";

const calls: unknown[][] = [];
const accepted: unknown[] = [];
const changes: unknown[] = [];
const view = { ns: "ui-settings", revision: 7, value: { enabled: true } };
let reply: unknown = { ok: true, value: view };
let thrown: Error | undefined;
const rpc = { call: async (...args: unknown[]) => {
  calls.push(args);
  if (thrown !== undefined) throw thrown;
  return reply;
} };
const settings = createSettingsRemote({ rpc: () => rpc as never, accepted: value => accepted.push(value), changed: value => changes.push(value) });
assert.deepEqual(await settings.mutate("ui-settings", [{ op: "set", path: ["enabled"], value: true }], 6), reply);
assert.deepEqual(calls.pop(), ["/api", "settings/mutate", { args: { ns: "ui-settings", ops: [{ op: "set", path: ["enabled"], value: true }], expectedRevision: 6 } }, undefined]);
assert.deepEqual(accepted, [view]);
assert.deepEqual(changes, [view]);
await settings.update("ui-settings", { enabled: false }, 7);
assert.deepEqual(calls.pop(), ["/api", "settings/update", { args: { ns: "ui-settings", patch: { enabled: false }, expectedRevision: 7 } }, undefined]);
await settings.replace("ui-settings", { enabled: true }, 8);
assert.deepEqual(calls.pop(), ["/api", "settings/replace", { args: { ns: "ui-settings", section: { enabled: true }, expectedRevision: 8 } }, undefined]);

for (const code of ["settings/conflict", "gateway/forbidden", "gateway/endpoint-unavailable", "settings/rejected"]) {
  reply = { ok: false, error: { code, message: "Host refused", details: { actual: 9 } } };
  const before = accepted.length;
  assert.equal(await settings.mutate("permission", [{ op: "set", path: ["defaultPreset"], value: "full-access" }]), reply);
  assert.equal(accepted.length, before, "a rejection must not update local state");
  assert.equal(changes.length, before, "a rejection must not emit an accepted-write invalidation");
}
thrown = new Error("network unavailable");
await assert.rejects(settings.update("ui-settings", { enabled: true }), error => error === thrown);
thrown = undefined;
assert.equal(await settings.openSettingsDocument(), reply, "native editor unavailability is not success");
reply = { ok: true, value: { writable: true, hasDocument: true, namespaces: [view] } };
const invalidations = changes.length;
await settings.describe();
assert.equal(changes.length, invalidations, "reading a namespace must not cause a reload loop");

let scheduleChanges = 0;
const schedule = createScheduleRemote({ rpc: () => rpc as never, changed: () => { scheduleChanges++; } });
reply = { ok: true, value: { id: "task", status: "paused" } };
const edit = { id: "task", action: "pause", expectedUpdatedAt: "2026-11-10T00:00:00Z" };
await schedule.edit(edit);
assert.deepEqual(calls.pop(), ["/api", "schedule/edit", { args: { request: edit } }], "pause/resume/delete actions must not be rewritten to update");
assert.equal(scheduleChanges, 1);
reply = { ok: false, error: { code: "schedule/input-invalid", message: "Invalid rule", details: { code: "invalid_rule" } } };
assert.equal(await schedule.create({ timing: { kind: "cron" } }), reply, "official UI needs the Host error details");
assert.equal(scheduleChanges, 1);
thrown = new Error("offline");
await assert.rejects(schedule.catalog(), error => error === thrown);

const commandCalls: unknown[] = [];
let commandReply: unknown = { ok: true, value: [{ name: "permission", description: "Official permission command" }] };
const commands = createPermissionCommands(() => ({ call: async (...args: unknown[]) => { commandCalls.push(args); return commandReply; } }) as never, () => "feedback unavailable");
assert.equal((await commands.list("session")).ok, true);
assert.deepEqual(commandCalls.pop(), ["/api", "commands/list", { args: { sessionId: "session" } }]);
commandReply = { ok: true, value: { commandId: "host-command", result: { kind: "success" } } };
assert.equal(await commands.execute("session", "/permission read-only"), commandReply);
assert.deepEqual(commandCalls.pop(), ["/api", "commands/execute", { args: { sessionId: "session", line: "/permission read-only", attachments: [] } }]);
commandReply = { ok: false, error: { code: "permission/denied", message: "refused" } };
assert.equal(await commands.execute("session", "/permission full-access"), commandReply);
commandReply = { ok: true, value: { accepted: true } };
assert.equal((await commands.execute("session", "/permission read-only")).ok, false, "an optimistic acknowledgement is not a durable official command receipt");
const beforeFeedback = commandCalls.length;
assert.deepEqual(await commands.execute("session", "/feedback note"), { ok: false, error: { code: "feedback/unavailable", message: "feedback unavailable", details: {} } });
assert.equal(commandCalls.length, beforeFeedback);
console.log("client seam: settings/schedule Host outcomes and durable official permission command receipts passed");
