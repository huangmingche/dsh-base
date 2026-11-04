/** User-visible operations must preserve Host truth rather than synthesize success. */
import assert from "node:assert/strict";
import { createDirectoryRemote } from "../src/client/directory-remote.ts";
import { createFixedAgentPresets } from "../src/client/fixed-agent-presets.ts";
import { createWorkspaceFilesRemote } from "../src/client/workspace-files-remote.ts";
import { readLocalAccount, signOutLocalAccount } from "../src/client/account-transport.ts";

const calls: unknown[] = [];
const refused = { ok: false, error: { code: "directory-picker/exists", message: "already exists", details: { path: "/work" } } };
const signal = new AbortController().signal;
const directories = createDirectoryRemote(() => ({ async call(...args: unknown[]) { calls.push(args); return refused; } }) as never);
assert.equal(await directories.list(undefined, signal), refused);
assert.equal(await directories.list("/work", signal), refused);
assert.equal(await directories.createDirectory("/", "work"), refused);
assert.equal(await directories.pick(signal), refused);
assert.deepEqual(calls, [
  ["/api", "directoryPicker/list", { args: {} }, signal],
  ["/api", "directoryPicker/list", { args: { path: "/work" } }, signal],
  ["/api", "directoryPicker/createDirectory", { args: { path: "/", name: "work" } }, undefined],
  ["/api", "directoryPicker/pick", { args: {} }, signal],
]);
const copy = {
  thinkName: "Cloudflare Think", thinkDescription: "fixed composition", unavailableReason: "host runtime unavailable", unavailableBadge: "Unavailable",
  readUnavailable: "no official declaration", selectUnavailable: "fixed runtime", creatorUnavailable: "no Cordis Host runner",
};
const presets = createFixedAgentPresets(() => copy);
const roster = (await presets.list()).value.presets;
assert.deepEqual(roster.map(({ id, isDefault }) => ({ id, isDefault })), [
  { id: "standard", isDefault: false }, { id: "ptc", isDefault: false },
  { id: "minimal", isDefault: false }, { id: "cordis", isDefault: false },
  { id: "dsh-base-think", isDefault: true },
]);
for (const id of ["standard", "ptc", "minimal", "cordis"]) {
  const row = roster.find(candidate => candidate.id === id)!;
  assert.equal(row.name, undefined, `${id} keeps official display resolution`);
  assert.equal(row.unavailable, "host runtime unavailable");
  assert.equal(row.broken, undefined);
  const document = await presets.read(id);
  assert.equal(document.ok, true);
  assert.ok(document.ok && document.value.content.includes("- id: persona"), `${id} keeps its official declaration`);
}
for (const inherited of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
  const refused = await presets.read(inherited);
  assert.equal(refused.ok, false, `${inherited} must not resolve`);
  assert.equal(!refused.ok && refused.error.code, "agent-preset/not-found", `${inherited} uses the official not-found code`);
}
const thinkRow = roster.find(candidate => candidate.id === "dsh-base-think")!;
assert.equal(thinkRow.name, "Cloudflare Think");
assert.equal(thinkRow.description, "fixed composition");
assert.equal(thinkRow.broken, undefined);
const thinkRead = await presets.read("dsh-base-think");
assert.equal(thinkRead.ok, false);
assert.equal(!thinkRead.ok && thinkRead.error.code, "agent-preset/unavailable");
for (const id of ["standard", "dsh-base-think"]) {
  const refused = await presets.select(id);
  assert.equal(refused.ok, false);
  assert.equal(!refused.ok && refused.error.code, "agent-preset/unavailable");
}

const requested: unknown[] = [];
const files = createWorkspaceFilesRemote(() => ({
  async read(...args: unknown[]) { requested.push(args); return { ok: false, error: { code: "gateway/invocation-unavailable", message: "missing", details: {} } }; },
  async readBytes() { throw Object.assign(new Error("offline"), { code: "transport/offline", details: { retryable: true } }); },
  async *changes() { throw new Error("stream unavailable"); },
}) as never);
assert.deepEqual(await files.read("s" as never, "actual.txt", { offset: 2, limit: 3 }), { ok: false, error: { code: "gateway/invocation-unavailable", message: "missing", details: {} } });
assert.deepEqual(requested, [["s", "actual.txt", { offset: 2, limit: 3 }]], "never substitutes conversation.md");
assert.deepEqual(await files.readBytes("s" as never, "actual.bin"), { ok: false, error: { code: "transport/offline", message: "offline", details: { retryable: true } } });
await assert.rejects(async () => { for await (const _ of files.changes("s" as never, "actual", signal)) {} }, /stream unavailable/);
assert.equal((await createWorkspaceFilesRemote(() => undefined).list("s" as never, "")).ok, false);

for (const status of [403, 500]) {
  const fetcher = async () => new Response("failed", { status });
  await assert.rejects(signOutLocalAccount(fetcher as typeof fetch), new RegExp(String(status)));
  await assert.rejects(readLocalAccount(fetcher as typeof fetch), new RegExp(String(status)));
}
const offline = async () => { throw new Error("offline"); };
await assert.rejects(signOutLocalAccount(offline as typeof fetch), /offline/);
await assert.rejects(readLocalAccount(offline as typeof fetch), /offline/);
assert.equal(await readLocalAccount((async () => new Response(null, { status: 401 })) as typeof fetch), null);
assert.deepEqual(await readLocalAccount((async () => Response.json({ user: { id: "owner", username: "Owner", email: "owner@example.test" } })) as typeof fetch), { id: "owner", username: "Owner", email: "owner@example.test" });
await signOutLocalAccount((async () => Response.json({ success: true })) as typeof fetch);
console.log("Host capability seams: directory protocol, fixed preset refusal, authoritative files and checked authentication outcomes passed");
