# @dsh-base/plugin-management

Shared plugin-management policy for the client composition and the Worker control plane.

The optional allowlist is **never hand-written**: it is generated from the
`toggleable: "L1"` capability-pack manifests by
`scripts/composition/generate-manageable-composition.mjs`
(`src/manageable.generated.ts`, gitignored). The pack manifests are the single
source; a hand-written list is a second truth that `check:packs` cannot verify.

Only members explicitly declared by an L1 pack can be toggled per account.
Authentication, HTTP, session/transport, persistence, layout, theme, locale,
renderer, and the management entry itself remain read-only. The Worker plane is
deployment-owned: the loader rejects an L1 pack that declares Worker members.

An explicit mapping connects package identities to Think runtime names (Gateway
to `cloudflare-ai-gateway`, fetch to `fetch`, and memory to `memory`); it does not
define another capability allowlist. Host projection and Think filtering share
this mapping. Adding an L1 Think member without its mapping fails instead of
guessing fetch from a package-name suffix.

A Session patch preserves existing fields in that scope and stores only explicit
overrides. Reads merge those fields over the current account defaults. A config
patch therefore neither resets the Session toggle nor freezes later account changes.

Cloudflare AI Gateway uses the official multi-row `BundleInfo` contract to manage
its settings card and platform model service together. It retains
`@dsh-base/client-gateway-provider` as its stable management identity; both runtime
plugins retain separate composition entries. Membership comes from the generated
`gateway-provider` pack. Owner toggles and resets accept either legacy member
identity and update both in one storage transaction and revision, protected by
compare-and-set. Session overrides and administrator deployment controls keep
their own semantics and are not coupled by the owner bundle.

Legacy accounts may have selected the card and provider independently. Owner
reads project the card from the Think provider selection, inheriting the original
enabled default when there is no Think override. Reads neither write nor advance
the revision, and a historical hidden-card preference cannot change model
execution selection. The next owner toggle persists both members atomically.
