# @dsh-base/client-shell-extras

Disabled at the user's request. The sidebar More menu retains only Browse more plugins and Create your plugin from the pinned official `ui-entry-customization`. About <brand>, Contact support and Environment were custom additions, not official entries.

Package metadata and the pack roster both declare `disabled: true`. The build generates no module resolver and runtime registers no `dsh-base-more` slot. Source remains as an inactive implementation; the removal request supersedes the historical P6 deviation approval. Site branding now independently consumes the re-enabled `client-site-config` service. Its single public configuration read at application startup does not restore these menu entries.

Official source, labels, order and Browse navigation are unchanged. Retaining Create does not implement the official Creator preset: the Host still explicitly rejects unsupported `cordis`; removing the extension adds no such capability.

Validation: `tests/order.test.ts` checks the real generated composition has no executable resolver for sidebar extras while the public site service is active. `apps/web/scripts/acceptance-site-config-local.mjs` compares the rendered menu with exported official dictionaries, verifies the site name and one public configuration read per application boot, and checks that opening the menu adds no requests.
