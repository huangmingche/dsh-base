/** Owner-scoped Agent Durable Object naming contract. */
import assert from "node:assert/strict";
import { agentName, isOwnedAgentName, ownerIdOf } from "../src/agent-name.ts";

assert.equal(agentName("u-1", "s-1"), "owner:u-1:s-1");
assert.equal(agentName(undefined, "s-1"), "s-1");
assert.equal(ownerIdOf("owner:u-1:default-v23"), "u-1");
assert.equal(ownerIdOf("u-1:default-v23"), undefined);
assert.equal(ownerIdOf("owner::default-v23"), undefined);
assert.equal(ownerIdOf(undefined), undefined);
assert.equal(isOwnedAgentName("owner:u-1:s-1", "u-1"), true);
assert.equal(isOwnedAgentName("owner:u-2:s-1", "u-1"), false);
assert.equal(isOwnedAgentName("s-1", "u-1"), false);
// Two owners that pick the same Session id must never share an Agent instance.
assert.notEqual(agentName("u-1", "shared-session"), agentName("u-2", "shared-session"));

console.log("session-host: owner-scoped Agent names passed");
