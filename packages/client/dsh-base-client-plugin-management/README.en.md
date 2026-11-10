# @dsh-base/client-plugin-management

Application scope: the default workbench loads after sign-in. Signed-out states described below are component or Host contracts exercised in isolation.

Management seam for the official Plugins page. It fills unavailable entries and
management explanations through the pinned official `plugins.item`,
`plugins.detail.section` and `plugins.row.config` slots; it never replaces the official Plugins list, install/update/uninstall,
error/loading/empty states or page styling.

Manageable optional capabilities are generated from `toggleable: "L1"` pack
manifests: Think fetch, memory and AI Gateway, plus the client Gateway provider
card. The Worker plane is deployment-owned; Think selections are projected by the
Session Host on the next turn from the owner's persisted choice. Required client
shell entries cannot self-lock, and unbundled inventory cannot be enabled. Copy
matches the official manager page across the 8 supported locales.

The client Gateway card and Think Gateway provider remain two real components,
managed together by one account-scoped Cloudflare AI Gateway bundle switch. The
official detail slot selects eight-language scope copy by exact bundle identity:
the switch controls the model settings card and default platform model availability
for the account. Explicit Session overrides remain effective; disabling it does
not cancel in-flight requests or affect the owner's own API key. After a successful
persisted toggle, the official `llm/adapters-updated` notification refreshes the
model selector and Gateway status; peer tabs also re-read the Host after the
selection broadcast. Account/Session enablement cannot override deployment opt-out.
Gateway disablement does not disable BYOK or fetch. Its detail explanation no longer
claims a client-only feature that applies only on the next page start.

The official Plugins page toggles read and change owner defaults; changing the
Session or locale never mixes Session overrides into these controls. The existing
fetch allowlist editor retains owner/current-Session scopes, subscribing to the
official `uiSession.adapter.current` instead of parsing a URL. Session changes
reload the editor; stale read/save responses cannot replace the new editor. Saves
recheck their target and are blocked until it is loaded or if the Session has
gone away, without falling back to an owner write.

Absent official Subagent, Web search and fetch, Agent loop and Shell configuration entries remain in the original `plugins.item` slots. Their titles, artwork, order, descriptions and detail forms reuse exported pinned official Card/controller implementations. Registration occurs only when the real settings describe omits the corresponding namespace; unknown or failed reads do not establish absence. Form scopes are explicitly unavailable, read-only and refuse writes; no settings namespace is invented. An official Tag and eight-language explanation state the Workers/Think limitation. The original entry takes over when a real namespace appears, with official slot priority preventing duplicate transition registrations. Catalog-only experimental bundles also state that they are metadata, not installed or running, and cannot be activated here. This seam preserves official slot and settings-card structures; the separate fork described below owns the approved list availability presentation.

Validation: `node --test packages/client/dsh-base-client-plugin-management/tests/builtin-availability.test.mjs` exercises actual official Cards, controllers and SlotCore: all four unavailable entries, original descriptions, no private requests, original-entry takeover, duplicate registration prevention and eight-language explanations.

`node packages/client/dsh-base-client-plugin-management/tests/subagent-panel.test.ts` checks the exact Gateway bundle branch, enabled/disabled states, lookalike-name isolation, eight-language scope copy and unchanged other detail branches.

List-level deployment availability labels belong to the separate marked official client-plugin-manager fork. This seam continues to supply the specific Workers explanation through the official detail slot.

Own plugin copy follows the pinned official metadata and detail text: names state purpose and descriptions use short action sentences. Account scope, deployment limits and unavailable reasons belong in status or details, without package names, runtime-plane terms or historical audit notes in feature descriptions. The detail slot uses Host `managementPolicy` metadata to distinguish “Required by the app” from deployment management; read-only controls do not hide plugins. This extension is used only with the existing `unaddressable` read-only reason; unknown fields retain the original explanation. Existing official entry names and descriptions are unchanged.

`subagent-panel.test.ts` also covers complete dictionaries for all eight locales, read-only policy versus disabled state, and refusal to relabel unknown or writable entries through policy metadata.
