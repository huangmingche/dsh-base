import assert from "node:assert/strict";
import { inspectComposition } from "../src/client/inspection.ts";

const entries = [
  { id: "official", name: "official", origin: "upstream" as const, disabled: true },
  { id: "fork", name: "fork", origin: "custom" as const, disabled: false, replaces: "official" },
  { id: "missing", name: "missing", origin: "upstream" as const, disabled: false },
];
let observed = inspectComposition(entries, [{ name: "fork", phase: "pending" }]);
assert.equal(observed.length, 3);
assert.equal(observed[0]?.fiberPhase, null);
assert.equal(observed[1]?.origin, "custom");
assert.equal(observed[1]?.fiberPhase, "pending");
assert.equal(observed[2]?.fiberPhase, null);
observed = inspectComposition(entries, [{ name: "fork", phase: "failed" }, { name: "official", phase: "active" }]);
assert.equal(observed[1]?.fiberPhase, "failed");
assert.equal(observed[0]?.enabled, false);
assert.equal(observed[0]?.fiberPhase, "active", "unexpected activation of a disabled row stays observable");
assert.equal(observed[1]?.replaces, "official");
console.log("client inspection: provenance, disabled inventory and observed lifecycle passed");
