import assert from "node:assert/strict";
import { controlledComposition, loadControl, ownerBootSelection, parseControlState } from "../src/client/control.ts";
import { accountSession } from "../src/client/account-session.ts";
import { MANAGEABLE_CLIENT_MODULES, MANAGEABLE_THINK_MODULES } from "../../dsh-base-plugin-management/src/index.ts";
import { PluginControl } from "../../../cloudflare-worker/dsh-base-cloudflare-worker-control/src/control.ts";

assert.throws(() => parseControlState({ revision: 1 }), /Invalid control state/);
assert.throws(() => parseControlState({ revision: 1, overrides: { plugin: { disabled: "false" } } }), /disabled/);
assert.throws(() => parseControlState({ revision: 1, overrides: { plugin: { config: { bad: () => {} } } } }), /configuration/);
assert.throws(() => parseControlState({ revision: -1, overrides: {} }), /Invalid/);
assert.deepEqual(parseControlState({ revision: 0, overrides: { p: { config: { nested: [true, null, "value", 42] } } } }).overrides.p.config?.nested, [true, null, "value", 42]);

// The allowlist is generated from `toggleable: "L1"` packs: gateway-provider
// contributes the client card, optional-think the two tools; the platform
// Gateway Think provider joins the Think list through the same pack.
assert.deepEqual([...MANAGEABLE_CLIENT_MODULES], ["@dsh-base/client-gateway-provider"]);
assert.deepEqual([...MANAGEABLE_THINK_MODULES], ["@dsh-base/cloudflare-think-ai-gateway", "@dsh-base/cloudflare-think-fetch", "@dsh-base/cloudflare-think-memory"]);

const originalFetch = globalThis.fetch;
try {
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    requests.push(String(input));
    if (String(input) === '/api/auth/get-session') return Response.json({ user: { id: 'owner', username: 'Owner', email: 'owner@example.test' } });
    return Response.json({ revision: 9, overrides: {
      "@dsh-base/client-deepseek-provider": { disabled: true },
      "@dsh-base/client-gateway-provider": { disabled: true, config: { value: 3 } },
      "@dsh-base/client-locale-url": { disabled: false },
    } });
  };
  let imports = 0;
  const module = { load: async () => { imports++; return (() => {}) as never; } };
  const entries = [
    { id: "core", name: "@dsh-base/client-deepseek-provider", origin: "custom" as const, disabled: false },
    { id: "optional", name: "@dsh-base/client-gateway-provider", origin: "custom" as const, disabled: false, config: { retained: true, value: 1 } },
    { id: "unbundled", name: "@dsh-base/client-locale-url", origin: "custom" as const, disabled: true },
  ];
  const result = await controlledComposition({ entries, modules: { "@dsh-base/client-deepseek-provider": module, "@dsh-base/client-gateway-provider": module } });
  assert.deepEqual(requests, ["/api/auth/get-session", "/api/plugin-manager"], "owner control checks the shared account before its private endpoint");
  assert.equal(result.entries[0]?.disabled, false, "required/core client plugins cannot be self-locked remotely");
  assert.equal(result.entries[1]?.disabled, true, "an allowlisted optional client module follows the persisted owner selection");
  assert.deepEqual(result.entries[1]?.config, { retained: true, value: 1 }, "a non-empty persisted config is refused for an empty-schema plugin");
  assert.equal(result.entries[2], entries[2], "unbundled/disabled inventory never acquires executable code");
  assert.equal(imports, 0, "control projection must not evaluate modules");
  const gateway = "@dsh-base/client-gateway-provider";
  const deployed = { entries, modules: { [gateway]: module } };
  const boot = ownerBootSelection(deployed, result, { [gateway]: async () => ({}) });
  assert.equal(boot.entries[1]?.disabled, false, "owner-disabled bundled plugins retain a Loader entry for later re-enablement");
  assert.deepEqual(boot.disableAfterBoot, [gateway], "only an owner-disabled deployed plugin needs post-boot disposal");
  for (const [modules, namespaces] of [[{}, { [gateway]: async () => ({}) }], [{ [gateway]: module }, {}]]) {
    const unavailable = ownerBootSelection({ entries, modules }, result, namespaces);
    assert.equal(unavailable.entries[1]?.disabled, true, "both module and namespace resolvers are required before first-pass activation");
    assert.deepEqual(unavailable.disableAfterBoot, [], "unbundled inventory must never require a Loader entry after boot");
  }
  for (const disabled of [true, false]) {
    globalThis.fetch = async () => Response.json({ revision: 10, overrides: { [gateway]: { disabled } } });
    const disabledDeployment = { entries: [{ ...entries[1]!, disabled: true }], modules: {} };
    const selected = await controlledComposition(disabledDeployment);
    const inventory = ownerBootSelection(disabledDeployment, selected, {});
    assert.equal(inventory.entries[0]?.disabled, true, "neither stale enable nor disable overrides can activate deployment-disabled inventory");
    assert.deepEqual(inventory.disableAfterBoot, [], "deployment-disabled rows are never searched for in the live Loader");
  }
  for (const [clientDisabled, thinkDisabled] of [[true, false], [false, true]] as const) {
    const ownerControl = new PluginControl({ storage: { get: async () => ({ revision: 3, overrides: {
      "@dsh-base/client-gateway-provider": { disabled: clientDisabled },
      "@dsh-base/cloudflare-think-ai-gateway": { disabled: thinkDisabled },
    } }) } } as never);
    globalThis.fetch = async () => ownerControl.fetch(new Request('https://control/api/plugin-manager'));
    const boot = await controlledComposition({ entries, modules: { "@dsh-base/client-gateway-provider": module } });
    assert.equal(boot.entries[1]?.disabled, thinkDisabled, "fresh boot consumes the normalized owner bundle without a migration write");
  }
  requests.length = 0;
  globalThis.fetch = async input => { requests.push(String(input)); return Response.json(null); };
  await accountSession.refresh();
  assert.equal(await controlledComposition({ entries, modules: {} }).then(value => value.entries), entries);
  assert.deepEqual(requests, ['/api/auth/get-session'], 'checked anonymous composition never probes private owner control');
  globalThis.fetch = async () => Response.json({ user: { id: 'owner', username: 'Owner', email: 'owner@example.test' } });
  await accountSession.refresh();
  for (const status of [401, 403, 500]) {
    globalThis.fetch = async () => new Response(null, { status });
    await assert.rejects(loadControl(), undefined, 'authenticated control failures cannot masquerade as empty overrides');
  }
  await assert.rejects(accountSession.refresh(), /500/);
  await assert.rejects(loadControl(), /500/, 'auth read failure cannot become anonymous composition');
  console.log("client control: owner selection is allowlisted by generated L1 packs, core cannot self-lock, disabled inventory stays inert");
} finally {
  globalThis.fetch = originalFetch;
}
