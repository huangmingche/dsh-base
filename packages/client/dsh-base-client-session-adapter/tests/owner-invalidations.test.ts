import assert from "node:assert/strict";
import { subscribeOwnerInvalidations } from "../src/client/owner-invalidations.ts";

class Source extends EventTarget {
  closed = 0;
  close() { this.closed++; }
  message(value: unknown, type = "message") { this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(value) })); }
}
const source = new Source();
const events: string[] = [], errors: Error[] = [];
const dispose = subscribeOwnerInvalidations({ url: "/api/session-host/changes", source: url => { assert.equal(url, "/api/session-host/changes"); return source; }, emit: event => events.push(event), error: error => errors.push(error) });
const all = ["settings/document-updated", "permission-presets/catalog-changed", "schedule/changed", "credentials/reference-updated", "credentials/record-updated"];
source.dispatchEvent(new Event("open"));
source.message({ type: "invalidate", revision: 0, topics: [] });
assert.deepEqual(events.splice(0), all, "initial baseline closes the eager-read/subscription race");
source.message({ type: "invalidate", revision: 1, topics: ["settings"] });
assert.deepEqual(events.splice(0), ["settings/document-updated", "permission-presets/catalog-changed"]);
source.message({ type: "invalidate", revision: 1, topics: ["schedule"] });
source.message({ type: "invalidate", revision: 0 });
assert.deepEqual(events, [], "duplicate/old revisions do not create refresh loops");
source.message({ type: "invalidate", revision: 2, topics: ["schedule"] }, "invalidate");
assert.deepEqual(events.splice(0), ["schedule/changed"]);
source.message({ type: "invalidate", revision: 3, topics: ["credentials"] });
assert.deepEqual(events.splice(0), all.slice(3));
source.dispatchEvent(new Event("open"));
source.message({ type: "invalidate", revision: 3, topics: [] });
assert.deepEqual(events.splice(0), all, "reconnect baseline refreshes even without a new mutation");
source.message({ type: "invalidate", revision: 4 });
assert.deepEqual(events.splice(0), all);
source.message({ type: "invalidate", revision: "5", topics: ["settings"] });
assert.equal(errors.length, 1); assert.deepEqual(events, []);
source.message({ type: "invalidate", revision: 5, topics: ["settings"] });
assert.deepEqual(events.splice(0), ["settings/document-updated", "permission-presets/catalog-changed"], "invalid frames cannot advance the accepted cursor");
dispose(); dispose(); assert.equal(source.closed, 1);
source.message({ type: "invalidate", revision: 6 });
assert.deepEqual(events, [], "disposed fibers cannot refresh official stores");
console.log("owner invalidations: initial/reconnect baselines, topic delivery, monotonic cursor, malformed frame rejection and fiber disposal passed");
